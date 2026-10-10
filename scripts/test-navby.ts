/**
 * Изолированные тесты адаптера Nav.by и правил модуля «Пробег и связь»
 * на мок-ответах (без сети и без базы):
 *  - разбор позиций (штатное движение, пустые/нулевые значения);
 *  - повторная метка времени и измерения не по порядку;
 *  - сетевые сценарии 401/403/429/5xx/таймаут (ограниченные ретраи);
 *  - сопоставление автопарка (однозначность и конфликты);
 *  - уведомления без дублей (cooldown, окно въезда в РФ, восстановление).
 * Запуск: npm run test:navby
 */
import { NavbyClient } from '../server/navby/client.ts';
import { normalizePosition, normalizeNavbyObject, decideNewSample } from '../server/navby/parse.ts';
import { matchFleet, plateNormalize } from '../server/navby/match.ts';
import { planAlerts, alertNoUpdatesId, alertRfOverId } from '../server/navby/alerts.ts';
import { parseNavbyDateTimeToMs, navbyDayKey, navbyTimeKey } from '../server/navby/config.ts';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}${extra ? ` ${extra}` : ''}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra ? ` ${extra}` : ''}`);
  }
};
const eq = (name: string, a: unknown, b: unknown): void =>
  check(name, JSON.stringify(a) === JSON.stringify(b), `(${JSON.stringify(a)} == ${JSON.stringify(b)})`);

/** Мок-ответ позиции: реальная форма из живого чтения (10.10.2026). */
const liveSample = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  latitude: 53.8366133,
  longitude: 27.7411666,
  datetime: '2026-10-10 14:17:31',
  datetime_unix: 1791631051,
  azimuth: 139,
  object_uid: '352093080153272',
  speed: 0,
  sattelite: 14,
  object_name: 'АР 9694-7',
  auto_number: 'АР 9694-7',
  garage_number: '',
  phone_number: '375445228115',
  phone_number2: 0,
  fuel_card_number: null,
  object_id: 5210757,
  zazh: 0,
  gsm_lev: 4,
  place: '223017, Беларусь, Минск, проспект Партизанский, 199/1',
  country: 'Беларусь',
  country_shot: 'by',
  odom_can: 1130369.7750000001,
  odom_can_priod: 4,
  odom_virt: 0,
  ...over,
});

// ─────────────────────────── 1. Разбор позиции ───────────────────────────
console.log('== 1. Разбор current-position ==');
{
  const s = normalizePosition(liveSample());
  check('позиция разобрана', s != null);
  eq('координаты', [s?.lat, s?.lon], [53.8366133, 27.7411666]);
  eq('время координаты (из unix)', s?.coordAtMs, 1791631051 * 1000);
  eq('исходная строка времени сохранена', s?.coordAt, '2026-10-10 14:17:31');
  eq('скорость 0 — валидное «стоит»', s?.speed, 0);
  eq('одометр km', s?.odoKm, 1130369.7750000001);
  eq('одометр присутствует', s?.odoPresent, true);
  eq('качество одометра ok', s?.odoQuality, 'ok');
  eq('источник одометра', s?.odoSource, 'navby.odom_can');
  eq('odom_virt=0 → нет виртуального одометра', s?.odoVirtKm, null);
}

console.log('== 2. Пустые и нулевые значения ==');
{
  const noOdo = normalizePosition(liveSample({ odom_can: null }));
  eq('odom_can=null → значение null, не 0', noOdo?.odoKm, null);
  eq('odom_can=null → качество absent', noOdo?.odoQuality, 'absent');
  eq('odom_can=null → odoPresent=false', noOdo?.odoPresent, false);

  const zeroOdo = normalizePosition(liveSample({ odom_can: 0, prob: 0 }));
  eq('odom_can=0 (нет данных CAN) → значение null, не 0', zeroOdo?.odoKm, null);
  eq('odom_can=0 → качество zero_missing', zeroOdo?.odoQuality, 'zero_missing');

  const virt = normalizePosition(liveSample({ odom_virt: 1128241.078 }));
  eq('odom_virt>0 сохраняется отдельно', virt?.odoVirtKm, 1128241.078);

  eq('адрес сохраняется (get_address)', normalizePosition(liveSample())?.place != null, true);
  const noAddr = normalizePosition(liveSample({ place: '', country: null, country_shot: null }));
  eq('place="" → null', noAddr?.place, null);
  eq('country_shot=null → null', noAddr?.countryCode, null);

  eq('нет координат → запись непригодна', normalizePosition(liveSample({ latitude: null })), null);
  eq('lat=0,lon=0 → запись непригодна', normalizePosition(liveSample({ latitude: 0, longitude: 0 })), null);
  eq('нет времени → запись непригодна', normalizePosition(liveSample({ datetime_unix: null, datetime: null })), null);
}

console.log('== 3. Повторная метка времени и порядок ==');
{
  eq('первое измерение — новое', decideNewSample(null, 1000), { isNew: true, reason: 'new' });
  eq('строго новее — новое', decideNewSample(1000, 1001), { isNew: true, reason: 'new' });
  eq('та же метка — НЕ новое', decideNewSample(1000, 1000), { isNew: false, reason: 'same_timestamp' });
  eq('старее — не пишем (не откатываем)', decideNewSample(1000, 999), { isNew: false, reason: 'older' });
  // Время координаты: пояс +03:00 (Минск) — подтверждено живым ответом.
  eq('разбор "2026-10-10 14:17:31" (+03) → UTC', parseNavbyDateTimeToMs('2026-10-10 14:17:31'), Date.UTC(2026, 9, 10, 11, 17, 31));
  eq('день истории — по поясу API', navbyDayKey(Date.UTC(2026, 9, 10, 22, 30, 0)), '20261011');
  eq('ключ времени истории', navbyTimeKey(Date.UTC(2026, 9, 10, 11, 17, 31, 250)), '141731250');
}

console.log('== 4. vehicle-list ==');
{
  const o = normalizeNavbyObject({ object_id: 138180, object_uid: '132200000000030', name: 'АК 9289-7', auto_number: 'АК 9289-7', garage_number: '', status: '0' });
  eq('status "0" → paused', o?.status, 'paused');
  eq('IMEI сохранён', o?.uid, '132200000000030');
  const a = normalizeNavbyObject({ object_id: 5210757, object_uid: '352093080153272', name: 'АР 9694-7', auto_number: 'АР 9694-7', status: '1' });
  eq('status "1" → active', a?.status, 'active');
  eq('без object_id — запись отбрасывается', normalizeNavbyObject({ name: 'X' }), null);
}

// ───────────────────────── 5. Клиент: ретраи и статусы ─────────────────────
console.log('== 5. Клиент: 401/403/429/5xx/таймаут ==');
{
  const jsonRes = (status: number, body: unknown) => ({
    status,
    text: async () => JSON.stringify(body),
  });
  const okItems = jsonRes(200, { root: { result: { items: [liveSample()] } } });

  /** Очередь ответов; URL учитывается для get-token. */
  const mockFetch = (plan: Array<{ match: string; res?: { status: number; text: () => Promise<string> }; throw?: string }>, calls: string[]) =>
    (async (url: string) => {
      calls.push(String(url));
      const step = plan.shift();
      if (!step || !String(url).includes(step.match)) throw new Error(`unexpected call ${url}`);
      if (step.throw) throw new Error(step.throw);
      return step.res as Response;
    }) as unknown as typeof fetch;
  const noSleep = async () => {};

  // 401 → переполучение токена → повтор успешен
  {
    const calls: string[] = [];
    const client = new NavbyClient({
      base: 'https://nav.by',
      staticToken: 'stale-token',
      login: 'u', password: 'p',
      fetchImpl: mockFetch([
        { match: 'vehicle-list', res: jsonRes(401, { error: 'unauthorized' }) },
        { match: 'get-token', res: jsonRes(200, { status: 'OK', token: 'fresh-token-length-36-000000000000' }) },
        { match: 'vehicle-list', res: okItems },
      ], calls),
      sleep: noSleep,
      log: () => {},
    });
    const r = await client.getVehicleList();
    check('401 → переполучение токена и повтор', r.ok && r.data?.length === 1);
    eq('порядок вызовов', calls.map((c) => c.split('?')[0].split('/').pop()), ['vehicle-list', 'get-token', 'vehicle-list']);
  }

  // 401 без кредов и без токена → not_configured, без ретраев
  {
    const calls: string[] = [];
    const client = new NavbyClient({ base: 'https://nav.by', fetchImpl: mockFetch([], calls), sleep: noSleep, log: () => {} });
    const r = await client.getVehicleList();
    check('401-сценарий без кредов → not_configured', !r.ok && r.error?.kind === 'not_configured');
    eq('ни одного HTTP-вызова', calls.length, 0);
  }

  // 403 → сразу запрет, повтор не выполняется
  {
    const calls: string[] = [];
    const client = new NavbyClient({
      base: 'https://nav.by', staticToken: 't',
      fetchImpl: mockFetch([{ match: 'vehicle-list', res: jsonRes(403, { error: 'forbidden' }) }], calls),
      sleep: noSleep, log: () => {},
    });
    const r = await client.getVehicleList();
    check('403 → kind=forbidden', !r.ok && r.error?.kind === 'forbidden');
    eq('403 не повторяется', r.attempts, 1);
  }

  // 429 → ретрай с задержкой, затем успех
  {
    const delays: number[] = [];
    const calls: string[] = [];
    const client = new NavbyClient({
      base: 'https://nav.by', staticToken: 't',
      fetchImpl: mockFetch([
        { match: 'current-position', res: jsonRes(429, { error: 'rate limit' }) },
        { match: 'current-position', res: jsonRes(200, { root: { result: { items: [liveSample()] } } }) },
      ], calls),
      sleep: async (ms: number) => { delays.push(ms); },
      log: () => {},
    });
    const r = await client.getCurrentPositions();
    check('429 → повтор и успех', r.ok && r.data?.samples.length === 1);
    check('429 → пауза перед повтором', delays.length === 1 && delays[0] >= 3000, `(${delays.join(',')})`);
  }

  // 5xx → ретраи ограничены, затем успех
  {
    const calls: string[] = [];
    const client = new NavbyClient({
      base: 'https://nav.by', staticToken: 't',
      fetchImpl: mockFetch([
        { match: 'vehicle-list', res: jsonRes(500, {}) },
        { match: 'vehicle-list', res: jsonRes(503, {}) },
        { match: 'vehicle-list', res: okItems },
      ], calls),
      sleep: noSleep, log: () => {},
    });
    const r = await client.getVehicleList();
    check('5xx → ретраи и успех с 3-й попытки', r.ok && r.attempts === 3);
  }

  // 5xx все три попытки → ошибка server, не более 3 попыток
  {
    const calls: string[] = [];
    const client = new NavbyClient({
      base: 'https://nav.by', staticToken: 't',
      fetchImpl: mockFetch([
        { match: 'vehicle-list', res: jsonRes(502, {}) },
        { match: 'vehicle-list', res: jsonRes(502, {}) },
        { match: 'vehicle-list', res: jsonRes(502, {}) },
      ], calls),
      sleep: noSleep, log: () => {},
    });
    const r = await client.getVehicleList();
    check('5xx подряд → kind=server, ровно 3 попытки', !r.ok && r.error?.kind === 'server' && r.attempts === 3);
  }

  // таймаут → kind=timeout после ограниченных ретраев
  {
    const calls: string[] = [];
    const client = new NavbyClient({
      base: 'https://nav.by', staticToken: 't',
      fetchImpl: mockFetch([
        { match: 'vehicle-list', throw: 'The operation was aborted' },
        { match: 'vehicle-list', throw: 'The operation was aborted' },
        { match: 'vehicle-list', throw: 'The operation was aborted' },
      ], calls),
      sleep: noSleep, log: () => {},
    });
    const r = await client.getVehicleList();
    check('таймаут → kind=timeout, 3 попытки', !r.ok && r.error?.kind === 'timeout' && r.attempts === 3);
  }

  // счётчик попыток при 200 → attempts=1
  {
    const calls: string[] = [];
    const client = new NavbyClient({ base: 'https://nav.by', staticToken: 't', fetchImpl: mockFetch([{ match: 'vehicle-list', res: okItems }], calls), sleep: noSleep, log: () => {} });
    const r = await client.getVehicleList();
    eq('штатный вызов — одна попытка', r.attempts, 1);
  }
}

// ─────────────────────────── 6. Сопоставление ──────────────────────────────
console.log('== 6. Сопоставление автопарка ==');
{
  eq('транслитерация «О421ХХ31» ↔ «O421XX31»', plateNormalize('О421ХХ31'), plateNormalize('O421XX31'));
  eq('пробелы/дефисы игнорируются', plateNormalize('АО 8807-7'), plateNormalize('AO88077'));

  const cars = [
    { carKey: 'c1', plate: 'АО 8807-7', label: 'АО 8807-7' },
    { carKey: 'c2', plate: 'Х671ОВ31', label: 'Х671ОВ31' },
    { carKey: 'c3', plate: null, label: '671' },
  ];
  const objects = [
    { objectId: 'o1', uid: '111', autoNumber: 'AO 8807-7', name: 'AO 8807-7', status: 'active' },
    { objectId: 'o2', uid: '222', autoNumber: 'O418XX31', name: 'O418XX31', status: 'active' },
    { objectId: 'o3', uid: '333', autoNumber: 'X671OB31', name: 'X671OB31', status: 'active' },
    { objectId: 'o4', uid: '444', autoNumber: '', name: 'AM 0216-7', status: 'paused' },
  ];
  const m = matchFleet(cars, objects);
  eq('однозначные пары найдены', m.auto.length, 2);
  eq('АО88077 привязан к o1', m.auto.find((a) => a.carKey === 'c1')?.objectId, 'o1');
  eq('Х671ОВ31 (кир↔лат) привязан к o3', m.auto.find((a) => a.carKey === 'c2')?.objectId, 'o3');
  check('автомобиль без номера остался несопоставленным', m.unmatchedCars.some((c) => c.carKey === 'c3'));
  check('объект без совпадения остался несопоставленным', m.unmatchedObjects.some((o) => o.objectId === 'o2'));

  // Дубликаты госномера на стороне портала → конфликт, автопривязки нет.
  const dup = matchFleet(
    [
      { carKey: 'd1', plate: 'АВ 1111-1', label: '' },
      { carKey: 'd2', plate: 'AB11111', label: '' },
    ],
    [{ objectId: 'x1', uid: null, autoNumber: 'AB 1111-1', name: '', status: 'active' }],
  );
  eq('дубликат номера в портале → конфликт', dup.conflicts.length, 1);
  eq('дубликат: автопар нет', dup.auto.length, 0);

  // Дубликат на стороне Nav.by → тоже конфликт.
  const dup2 = matchFleet(
    [{ carKey: 'c9', plate: 'АЕ 6052-7', label: '' }],
    [
      { objectId: 'y1', uid: null, autoNumber: 'AE 6052-7', name: '', status: 'active' },
      { objectId: 'y2', uid: null, autoNumber: 'АЕ60527', name: '', status: 'paused' },
    ],
  );
  eq('дубликат номера в Nav.by → конфликт', dup2.conflicts.length, 1);
  eq('дубликат Nav.by: автопар нет', dup2.auto.length, 0);

  // Приостановленные объекты не мешают: пара активный портал + один объект.
  const pausedOnly = matchFleet(
    [{ carKey: 'c10', plate: 'Т017ММ31', label: '' }],
    [{ objectId: 'p1', uid: null, autoNumber: 'Т017ММ31', name: '', status: 'paused' }],
  );
  eq('приостановленный объект привязывается (статус виден в UI)', pausedOnly.auto.length, 1);
}

// ─────────────────────────── 7. Уведомления ────────────────────────────────
console.log('== 7. Уведомления: без дублей, окно РФ, восстановление ==');
{
  const H = 3_600_000;
  const cfg = { enabled: true, staleHours: 24, rfWindowHours: 48, replyRemindHours: 72, cooldownHours: 12, maxAlertsPerRun: 30, roles: ['admin'] };
  const nowMs = Date.UTC(2026, 9, 10, 12, 0, 0);
  const staleCar = { carKey: 'c1', plate: 'АО 8807-7', coordAtMs: nowMs - 30 * H, requests: [] };

  const a1 = planAlerts({ nowMs, cars: [staleCar], rfEntries: {}, config: cfg, state: {} });
  eq('устаревшее авто → одно уведомление', a1.length, 1);
  eq('тип no_updates', a1[0]?.kind, 'no_updates');
  eq('детерминированный id', a1[0]?.id, alertNoUpdatesId('c1'));

  const state1 = { [alertNoUpdatesId('c1')]: { lastAtMs: nowMs - 1 * H, lastKind: 'no_updates', active: true } };
  const a2 = planAlerts({ nowMs, cars: [staleCar], rfEntries: {}, config: cfg, state: state1 });
  eq('повтор в пределах cooldown — НЕ дублируется', a2.length, 0);

  const a3 = planAlerts({ nowMs: nowMs + 13 * H, cars: [staleCar], rfEntries: {}, config: cfg, state: state1 });
  check('после cooldown — обновление той же записи', a3.length === 1 && a3[0]?.action === 'upsert');
  check('после cooldown id не меняется (одно событие)', a3[0]?.id === alertNoUpdatesId('c1'));

  const rf = { c1: { atMs: nowMs - 10 * H } };
  const a4 = planAlerts({ nowMs, cars: [staleCar], rfEntries: rf, config: cfg, state: state1 });
  check('в окне ожидания после въезда РФ нет новых уведомлений', !a4.some((x) => x.action === 'upsert'));
  check('открытое no_updates закрывается на время окна', a4.some((x) => x.action === 'remove' && x.id === alertNoUpdatesId('c1')));

  const rfOld = { c1: { atMs: nowMs - 60 * H } };
  const a5 = planAlerts({ nowMs, cars: [staleCar], rfEntries: rfOld, config: cfg, state: state1 });
  check('окно РФ истекло, данных нет → rf_window_over', a5.some((x) => x.action === 'upsert' && x.kind === 'rf_window_over'));
  check('no_updates при этом закрывается (одно событие)', a5.some((x) => x.action === 'remove' && x.id === alertNoUpdatesId('c1')));

  const freshCar = { carKey: 'c1', plate: 'АО 8807-7', coordAtMs: nowMs - 1 * H, requests: [] };
  const a6 = planAlerts({ nowMs, cars: [freshCar], rfEntries: {}, config: cfg, state: { ...state1, [alertRfOverId('c1')]: { lastAtMs: nowMs - 20 * H, lastKind: 'rf_window_over', active: true } } });
  check('свежие данные → закрытие открытых', a6.some((x) => x.action === 'remove' && x.id === alertRfOverId('c1')));
  check('свежие данные → одно restored', a6.filter((x) => x.kind === 'restored').length === 1);

  const a7 = planAlerts({ nowMs, cars: [staleCar], rfEntries: {}, config: { ...cfg, enabled: false }, state: {} });
  eq('уведомления выключены в настройках → пусто', a7.length, 0);

  const reqCar = {
    carKey: 'c2', plate: 'АК 3186-7', coordAtMs: nowMs - 1 * H,
    requests: [
      { id: 'r1', status: 'awaiting_reply', createdAtMs: nowMs - 100 * H, updatedAtMs: nowMs - 100 * H },
      { id: 'r2', status: 'master_needed', createdAtMs: nowMs - 2 * H, updatedAtMs: nowMs - 2 * H },
    ],
  };
  const a8 = planAlerts({ nowMs, cars: [reqCar], rfEntries: {}, config: cfg, state: {} });
  check('нет ответа дольше срока → reply_overdue', a8.some((x) => x.kind === 'reply_overdue'));
  check('требуется мастер → master_needed', a8.some((x) => x.kind === 'master_needed'));
  const a9 = planAlerts({ nowMs, cars: [{ ...reqCar, requests: [{ id: 'r1', status: 'closed', createdAtMs: nowMs - 100 * H, updatedAtMs: nowMs - 1 * H }] }], rfEntries: {}, config: cfg, state: {} });
  eq('закрытое обращение не напоминает', a9.filter((x) => x.kind === 'reply_overdue').length, 0);
}

console.log(`\nИтог: ${passed} проверок пройдено, ${failed} провалено.`);
if (failed > 0) process.exit(1);

/**
 * migrate-fleet-cards — миграция карточек автопарка Ratipa Portal (фаза 1).
 *
 * ВЫПОЛНЯЕТ РЕШЕНИЯ ВЛАДЕЛЬЦА (одобрено 15.10.2026):
 *   1. «без В.» (drivers/dr_1787831393161) → ОТСУТСТВИЕ водителя:
 *      у сцепки couplings/AP96977 и карточки tractors/AP96977 удаляются ссылки
 *      (driverId) и имя-кэш «без В.»; кэш водителя в карточке (данные Пешко)
 *      очищается полностью; затем удаляется сама служебная запись. Запись
 *      зарплаты 09/09/2026 — ИСТОРИЯ, не меняется. Реестр drivers/PESHKOSIARHEI
 *      НЕ трогается (ссылок у него нет).
 *   2. Огрызки реестра drivers/dr_1791975260584 («Шерамет») и
 *      drivers/dr_1791975506622 («Калинин») удаляются (после повторной
 *      проверки: ни одна ветка на них не ссылается).
 *   3. Бархатов в ТЕКУЩИХ записях AP96967 (сцепка, карточка, активная запись
 *      «Учёта выезда»): id CHARNIAUSKIULADZISLAU — слот реестра «Бархатов Денис
 *      Владимирович». Кэш-поля (ФИО, паспорт/personalId/birthDate) приводятся
 *      к реестру Бархатова. АРХИВНЫЕ строки baza и история зарплат — НЕ
 *      меняются. Поля, где стоит значение, которого нет в реестре Бархатова
 *      (passportStart/End/IssuedBy — данные Чернявского при пустом реестре) —
 *      НЕ перезаписываются, выводятся в отчёт.
 *   4. 19 групп дублей карточек tractors (кириллица/пробелы → латиница):
 *      непустые поля переносятся в основную (латинскую) запись, двойник
 *      удаляется, на основной пишется след mergedFrom/mergedAt, ссылки
 *      обновляются. Канонический вид ключа = как у портала: uppercase,
 *      без пробелов/дефисов, кириллица → латиница (AO88067, AK31867).
 *   5. Тестовые карточки: PROBE 0001, ПР 9001-9, ПР 9002-9, ПР 9004-9, «671» —
 *      удаляются (после проверки ссылок; «671» — пустой огрызок без ссылок).
 *   6. 15 битых ключей (хвостовой пробел, первым свойством вложен номер
 *      прицепа): 14 сливаются в нормальные карточки (п.4), «AP 8340-7 »
 *      чинится: ключ нормализуется в AP83407, вложенный номер прицепа
 *      переносится в trailerNumber; второй дубль «AP 8340-7» сливается туда же.
 *   7. В карточке BB40627 удаляется неправдоподобная дата рождения «10.07.2026».
 *
 * РЕЖИМЫ:
 *   npx tsx scripts/migrate-fleet-cards.ts                  # фаза 1: предварительный отчёт (ничего не пишет)
 *   npx tsx scripts/migrate-fleet-cards.ts --apply --yes    # фаза 1: применить (бэкап + проверка чтением)
 *   npx tsx scripts/migrate-fleet-cards.ts --verify         # фаза 1: проверка конечного состояния (без записи)
 *
 *   npx tsx scripts/migrate-fleet-cards.ts --phase2                  # фаза 2: отчёт (перенос vehicleFleet→tractors + чистка мёртвых веток)
 *   npx tsx scripts/migrate-fleet-cards.ts --phase2 --apply --yes    # фаза 2: применить (снимки веток + бэкапы + проверка)
 *   npx tsx scripts/migrate-fleet-cards.ts --phase2 --verify         # фаза 2: проверка состояния
 *
 * ФАЗА 2 (чистка мёртвых веток): переносит lastPassportVerificationYear/status
 * из vehicleFleet в tractors (по вариантам ключа), затем удаляет ветки, где
 * чтений/записей в коде нет. Ветки с живыми потребителями ИЛИ с уникальными
 * данными НЕ удаляются и выводятся в отчёт (см. KEPT_BRANCHES).
 *
 * БЕЗОПАСНОСТЬ:
 *   · каждый удаляемый/меняемый путь — из жёсткого списка (никаких эвристик);
 *   · перед записью КАЖДАЯ затрагиваемая и КАЖДАЯ удаляемая запись целиком
 *     сохраняется в ~/.hermes/cache/scratch/fleet-data/backups/<stamp>/ с манифестом;
 *   · перед применением «до»-значения пересверяются с живой базой (правки из UI
 *     между расчётом и записью не затираются — изменившееся пропускается);
 *   · перед удалением anything проверяются ссылки по всем ключевым веткам;
 *   · всё применяется одной multi-path записью (PATCH в корень, только листовые
 *     пути — вложенные поля не теряются);
 *   · повторный запуск идемпотентен (условия пересчитываются из текущих данных).
 */
import { mkdirSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const DB = process.env.RATIPA_DB || 'https://ratipa-portal-default-rtdb.firebaseio.com';
const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const YES = ARGS.includes('--yes');
const VERIFY = ARGS.includes('--verify');
const QUIET = ARGS.includes('--json');
const FLEET_DIR = join(homedir(), '.hermes', 'cache', 'scratch', 'fleet-data');
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Obj).sort();
    const kb = Object.keys(b as Obj).sort();
    if (ka.join(',') !== kb.join(',')) return false;
    return ka.every((k) => deepEqual((a as Obj)[k], (b as Obj)[k]));
  }
  return false;
};

// ---------- каноническая нормализация (как в портале: sources.ts / useFleet.ts) ----------
const CYR2LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ё: 'E',
};
const normKey = (x: unknown): string => String(x ?? '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
const canonPlate = (x: unknown): string => normKey(x).split('').map((ch) => CYR2LAT[ch] ?? ch).join('');

async function fetchAll(path: string): Promise<unknown> {
  // Ключи записей бывают с пробелами и кириллицей («АК 3186-7 », «АО 3920-7 ») —
  // кодируем URL, слэши сохраняем.
  const res = await fetch(encodeURI(`${DB}/${path}.json`));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return await res.json();
}
async function patchRoot(updates: Record<string, unknown>): Promise<boolean> {
  const res = await fetch(`${DB}/.json`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updates),
  });
  return res.ok;
}
const getLeaf = (tree: unknown, leafPath: string[]): unknown => {
  let cur: unknown = tree;
  for (const p of leafPath) cur = asObj(cur)[p];
  return cur;
};
const hasLeaf = (tree: unknown, leafPath: string[]): boolean => {
  let cur: unknown = tree;
  for (const p of leafPath) {
    if (!cur || typeof cur !== 'object' || !(p in (cur as Obj))) return false;
    cur = (cur as Obj)[p];
  }
  return true;
};

// ================= ЖЁСТКИЕ СПИСКИ (одобренный владельцем объём) =================

/** 19 групп дублей карточек: кириллица/пробелы → каноническая латиница. */
const CARD_MERGES: Array<{ target: string; sources: string[] }> = [
  { target: 'AK31867', sources: ['АК 3186-7'] },
  { target: 'AH96587', sources: ['АН 9658-7', 'АН 9658-7 '] },
  { target: 'AO39207', sources: ['АО 3920-7 '] },
  { target: 'AO39217', sources: ['АО 3921-7'] },
  { target: 'AO44507', sources: ['АО 4450-7 '] },
  { target: 'AO44517', sources: ['АО 4451-7'] },
  { target: 'AO81337', sources: ['АО 8133-7 '] },
  { target: 'AO88067', sources: ['АО 8806-7'] },
  { target: 'AC02477', sources: ['АС 0247-7 '] },
  { target: 'AC02497', sources: ['АС 0249-7 '] },
  { target: 'AC33927', sources: ['АС 3392-7 '] },
  { target: 'AC33937', sources: ['АС 3393-7 '] },
  { target: 'AS54487', sources: ['АС 5448-7 '] },
  { target: 'AX64207', sources: ['АХ 6420-7 '] },
  { target: 'BB40627', sources: ['ВВ 4062-7 '] },
  { target: 'O271XE31', sources: ['О271ХЕ31'] },
  { target: 'O418XX31', sources: ['О418ХХ31 '] },
  { target: 'O971TY31', sources: ['О971ТУ31 '] },
  { target: 'X229TE31', sources: ['Х229ТЕ31 '] },
];
/** Битый ключ без нормальной карточки: починка (нормализация ключа + trailerNumber). */
const CARD_REPAIR = {
  target: 'AP83407',
  sources: ['AP 8340-7', 'AP 8340-7 '],
  carNumber: 'AP 8340-7',
  vehicleNumbers: 'AP 8340-7',
};
/** Тестовые карточки (после проверки ссылок). */
const TEST_CARDS = ['PROBE 0001', 'ПР 9001-9', 'ПР 9002-9', 'ПР 9004-9', '671'];
/** Огрызки реестра водителей (после проверки ссылок). */
const STUB_DRIVERS = ['dr_1791975260584', 'dr_1791975506622'];
/** «без В.» → отсутствие водителя. */
const BEZ_V = {
  driverId: 'dr_1787831393161',
  couplingId: 'AP96977',
  cardId: 'AP96977',
  couplingClear: ['driverId', 'driverName', 'driverNameRu'],
  cardClear: [
    'driverId', 'driverName', 'driverNameRu', 'driverNameLat', 'birthDate',
    'passportNumber', 'passportStart', 'passportEnd', 'passportIssuedBy',
    'personalId', 'licenseNumber', 'phones',
  ],
};
/** Бархатов: текущие записи AP96967 (архив и зарплаты не трогаются). */
const BARKHATOV = {
  driverId: 'CHARNIAUSKIULADZISLAU',
  couplingId: 'AP96967',
  cardId: 'AP96967',
  activeBazaId: '-P2qZhhIP7-F5mFewEj0',
  nameExpected: 'Бархатов Денис Владимирович',
  fields: {
    name: 'Бархатов Денис Владимирович',
    birthDate: '01.02.1978',
    passport: 'МР5070640',
    personalId: '3010278М083РВ4',
  },
};
/** Обновление ссылок на починенный ключ AP 8340-7 → AP83407. */
const REF_UPDATES: Array<{ path: string; record: string; field: string; from: string; to: string }> = [
  { path: 'baza/-P3FTqoi3ZC9rbE68N5r/couplingId', record: 'baza/-P3FTqoi3ZC9rbE68N5r', field: 'couplingId', from: 'AP 8340-7', to: 'AP83407' },
  { path: 'archive/-P3FTqoi3ZC9rbE68N5r/couplingId', record: 'archive/-P3FTqoi3ZC9rbE68N5r', field: 'couplingId', from: 'AP 8340-7', to: 'AP83407' },
];
/** BB40627: удалить искажённую дату рождения. */
const BB_FIX = { card: 'BB40627', field: 'birthDate' };

// ================= ФАЗА 2: чистка мёртвых веток =================
const PHASE2 = ARGS.includes('--phase2');

/** Ветки, безопасно удаляемые (0 чтений/записей в коде везде; содержимое — легаси/замещённое). */
const DEAD_BRANCHES: Array<{ branch: string; reason: string }> = [
  { branch: 'dozvolsTypesV3', reason: 'типы дозволов V3 — замещены dozvolsTypesV4 (те же TR A/TR B/RUS); ключи V3 нигде не читаются' },
  { branch: 'dozvolsUsersV4', reason: 'легаси-пользователь дозволов (логин + пароль plaintext) — замещён единым users_list; 0 ссылок; удаление также убирает устаревшие учётные данные из базы' },
  { branch: 'gpsLinks', reason: 'GPS-ссылки устаревшего формата (*/from-settings) — замещены appSettings.gpsBeltranssputnikUrl/gpsWialonUrl/gpsEraGlonassUrl (живой GPS-блокнот «Диспозиции»/табеля читает appSettings); 0 ссылок' },
  { branch: 'salaryTariffGroups', reason: 'одиночная легаси-группа («3123», 0.125) без ссылок; живые тарифные группы — directories.rateGroups (c2, dir_*)' },
];
/** Ветки, НЕ удаляемые: найдены чтения/записи в живом коде ЛИБО уникальные данные (владельцу в отчёт). */
const KEPT_BRANCHES: Array<{ branch: string; verdict: string }> = [
  { branch: 'vehicleFleet', verdict: 'НЕ удалена: живые чтения/записи — server agentApi.ts (сущность vehicles → vehicleFleet, роутер подключён в server.ts), боты kz-bot / mail-agent / ratipa-dispatcher-bot (через agent-API), проекты ratipa-dozvola-redesign / ratipa-baza-standalone / ratipa-salary-standalone / ratipa-api. Полезные поля перенесены в tractors; удаление — после отключения этих потребителей.' },
  { branch: 'premiums_app', verdict: 'НЕ удалена: живые приложения премий (~/premia, ~/premii-site, ~/premii2) читают/пишут/удаляют ветку; внутри — черновик «Премии за август 2026» (меморандум, сотрудники)' },
  { branch: 'driverTaskTemplates', verdict: 'НЕ удалена: живое приложение ~/ratipa-tasks (Vercel «tasks-ratipa») читает и пишет шаблоны заданий' },
  { branch: 'taskCounter', verdict: 'НЕ удалена: счётчик номеров заданий приложения ~/ratipa-tasks (COUNTER_PATH), значение 8' },
  { branch: 'taskHistory', verdict: 'НЕ удалена: журнал изменений заданий приложения ~/ratipa-tasks (HISTORY_PATH)' },
  { branch: 'bamapTirLossLastData', verdict: 'НЕ удалена: уникальная запись формы TIR-утраты (29.06.2026, БАМАП, «retained», 14 волетов) — не повторяется в живых ветках; загрузчик формы из кода удалён ранее, но данные — решение владельца' },
  { branch: 'dozvolsRegistryV2', verdict: 'НЕ удалена: 2 записи пермитов («Турция Двусторонний tr 24241», «Турция Транзит 1421421», 13.05.2026, офис) — в V4-реестре (370) их нет, номера сохранились только в dozvolsHistoryV2' },
  { branch: 'generalRoutesDb', verdict: 'НЕ удалена: уникальный справочник 30 маршрутов («страна — страна») — не повторяется в живых ветках; решение владельца' },
  { branch: 'ratipa_permits_quotas', verdict: 'НЕ удалена: уникальная таблица квот (5 стран: cost/limit) — не повторяется в живых ветках; решение владельца' },
];

/** Ветки для проверки ссылок. */
const SCAN_BRANCHES = [
  'couplings', 'tractors', 'baza', 'archive', 'baza_cars', 'salaryHistory',
  'ferryCouples', 'driverTasks', 'documents', 'trips_dashboard', 'ratipa_loading_plan', 'tripTimeline',
];

// ================= план =================
type Op =
  | { kind: 'del'; path: string; record: string; note: string }
  | { kind: 'unset'; path: string; record: string; field: string; note: string }
  | { kind: 'set'; path: string; record: string; field: string; before: unknown; after: unknown; note: string }
  | { kind: 'put'; path: string; record: string; value: Obj; note: string };

interface Ctx {
  drivers: Obj; tractors: Obj; couplings: Obj; baza: Obj; archive: Obj; baza_cars: Obj;
  salary: Obj; scan: Record<string, unknown>;
}

async function loadCtx(): Promise<Ctx> {
  const [drivers, tractors, couplings, baza, archive, baza_cars, salary] = await Promise.all([
    fetchAll('drivers'), fetchAll('tractors'), fetchAll('couplings'), fetchAll('baza'),
    fetchAll('archive'), fetchAll('baza_cars'), fetchAll('salaryHistory'),
  ]);
  const scan: Record<string, unknown> = {};
  const rest = ['ferryCouples', 'driverTasks', 'documents', 'trips_dashboard', 'ratipa_loading_plan', 'tripTimeline'];
  for (const br of rest) scan[br] = await fetchAll(br);
  scan['couplings'] = couplings; scan['tractors'] = tractors; scan['baza'] = baza;
  scan['archive'] = archive; scan['baza_cars'] = baza_cars; scan['salaryHistory'] = salary;
  return {
    drivers: asObj(drivers), tractors: asObj(tractors), couplings: asObj(couplings), baza: asObj(baza),
    archive: asObj(archive), baza_cars: asObj(baza_cars), salary: asObj(salary), scan,
  };
}

/** Поиск подстроки токена в ветке (для отчёта о ссылках). */
function countIn(tree: unknown, token: string): number {
  const str = JSON.stringify(tree);
  let n = 0; let i = 0;
  while ((i = str.indexOf(token, i)) !== -1) { n++; i += token.length; }
  return n;
}

/** Сбор ссылок на driverId по веткам (структурно). */
function driverIdRefs(ctx: Ctx, id: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const collect = (branch: string, list: Obj) => {
    for (const [k, v] of Object.entries(list)) {
      if (s(asObj(v).driverId) === id) (out[branch] ||= []).push(k);
    }
  };
  collect('couplings', ctx.couplings); collect('tractors', ctx.tractors); collect('baza', ctx.baza);
  collect('archive', ctx.archive); collect('baza_cars', ctx.baza_cars);
  // salaryHistory (включая копии)
  const sal: string[] = [];
  for (const [k, v] of Object.entries(ctx.salary)) {
    if (k === 'flat' || k === 'months' || k === 'byDispatcher') continue;
    if (s(asObj(v).driverId) === id) sal.push(k);
  }
  if (sal.length) out['salaryHistory'] = sal;
  return out;
}

/** Известные поля карточек (всё остальное с объектным значением — артефакт битого ключа с номером прицепа). */
const KNOWN_CARD_FIELDS = new Set([
  'id', 'carNumber', 'vehicleNumbers', 'rate', 'rateGroupId', 'mergedFrom', 'mergedAt',
  'brand', 'brandModel', 'brandRu', 'brands', 'brandsLat', 'brandsRu', 'couplingId', 'tractorId',
  'dispatcher', 'dispatcherId', 'dispatcherName', 'driver2', 'driverId', 'driverName', 'driverNameLat',
  'driverNameRu', 'driverPhone', 'phone', 'phones', 'dimensions', 'lastPassportVerificationYear',
  'licenseNumber', 'passportEnd', 'passportIssuedBy', 'passportNumber', 'passportStart', 'personalId',
  'status', 'trailerBrand', 'trailerId', 'trailerMake', 'trailerNumber', 'vehicleType', 'weight',
]);

function buildPlan(ctx: Ctx, report: { ambiguous: string[]; conflicts: string[]; skipped: string[]; refs: Record<string, unknown> }) {
  const plan: Op[] = [];
  const { drivers, tractors, couplings, baza } = ctx;

  // ---------- A. «без В.» → отсутствие водителя ----------
  const coupl = asObj(couplings[BEZ_V.couplingId]);
  if (s(coupl.driverId) === BEZ_V.driverId) {
    for (const f of BEZ_V.couplingClear) {
      const leaf = ['couplings', BEZ_V.couplingId, f];
      if (hasLeaf(couplings, leaf.slice(1))) {
        plan.push({ kind: 'unset', path: leaf.join('/'), record: `couplings/${BEZ_V.couplingId}`, field: f, note: '«без В.» → отсутствие водителя: ссылка/кэш удаляется' });
      }
    }
  } else if (drivers[BEZ_V.driverId]) {
    report.skipped.push(`couplings/${BEZ_V.couplingId}: driverId ≠ «без В.» (${s(coupl.driverId) || '—'}) — пункт A не применяется к сцепке`);
  }
  const card = asObj(tractors[BEZ_V.cardId]);
  if (s(card.driverId) === BEZ_V.driverId) {
    for (const f of BEZ_V.cardClear) {
      const leaf = ['tractors', BEZ_V.cardId, f];
      if (hasLeaf(tractors, leaf.slice(1))) {
        plan.push({ kind: 'unset', path: leaf.join('/'), record: `tractors/${BEZ_V.cardId}`, field: f, note: 'карточка AP96977: кэш водителя (данные Пешко) очищается' });
      }
    }
  } else if (drivers[BEZ_V.driverId]) {
    report.skipped.push(`tractors/${BEZ_V.cardId}: driverId ≠ «без В.» (${s(card.driverId) || '—'}) — пункт A не применяется к карточке`);
  }
  // ссылки «без В.» до удаления записи
  const bezRefs = driverIdRefs(ctx, BEZ_V.driverId);
  report.refs['dr_1787831393161'] = bezRefs;
  const allowedBez: Record<string, string[]> = { couplings: [BEZ_V.couplingId], tractors: [BEZ_V.cardId] };
  const badBez: string[] = [];
  for (const [br, ids] of Object.entries(bezRefs)) {
    if (br === 'salaryHistory') continue; // история — не трогаем
    const allowed = allowedBez[br] || [];
    for (const id of ids) if (!allowed.includes(id)) badBez.push(`${br}/${id}`);
  }
  if (badBez.length) {
    report.conflicts.push(`УДАЛЕНИЕ dr_1787831393161 ПРОПУЩЕНО: неожиданные ссылки: ${badBez.join(', ')}`);
  } else if (drivers[BEZ_V.driverId]) {
    plan.push({ kind: 'del', path: `drivers/${BEZ_V.driverId}`, record: `drivers/${BEZ_V.driverId}`, note: 'служебная запись «без В.» — ссылки сняты в этом же применении' });
  }

  // ---------- B. огрызки реестра ----------
  for (const stub of STUB_DRIVERS) {
    const refs = driverIdRefs(ctx, stub);
    report.refs[stub] = refs;
    const name = s(asObj(drivers[stub]).name);
    if (!drivers[stub]) continue;
    if (Object.keys(refs).length) {
      report.conflicts.push(`УДАЛЕНИЕ drivers/${stub} «${name}» ПРОПУЩЕНО: найдены ссылки ${JSON.stringify(refs)}`);
    } else {
      plan.push({ kind: 'del', path: `drivers/${stub}`, record: `drivers/${stub}`, note: `огрызок реестра «${name}» — ссылок нет` });
    }
  }

  // ---------- C. Бархатов в текущих записях ----------
  const bark = asObj(drivers[BARKHATOV.driverId]);
  const barkName = s(bark.name);
  report.refs['BARKHATOV'] = { registryName: barkName, passport: s(bark.passport), personalId: s(bark.personalId), birthDate: s(bark.birthDate) };
  if (barkName !== BARKHATOV.nameExpected) {
    report.conflicts.push(`реестр ${BARKHATOV.driverId}: имя «${barkName}» ≠ ожидаемого «${BARKHATOV.nameExpected}» — пункт C не применяется`);
  } else {
    const setIfNeeded = (record: string, field: string, want: string, note: string) => {
      const tree = record.startsWith('couplings/') ? ctx.couplings : record.startsWith('tractors/') ? ctx.tractors : asObj(ctx.scan['baza']);
      const branchObj = asObj(tree);
      const within = asObj(branchObj[record.split('/')[1]]);
      const cur = within[field];
      const curStr = s(cur);
      if (curStr === want) return; // уже так
      if (!curStr && !(field in within)) return; // нет поля — не выдумываем
      if (!curStr) {
        report.ambiguous.push(`${record}/${field}: пусто, реестр даёт «${want}» — заполнение не требуется (карточка и так без данных)`);
        return;
      }
      plan.push({ kind: 'set', path: `${record}/${field}`, record, field, before: cur, after: want, note });
    };
    // сцепка
    setIfNeeded(`couplings/${BARKHATOV.couplingId}`, 'driverName', BARKHATOV.fields.name, 'AP96967 (сцепка): ФИО → реестр Бархатова');
    setIfNeeded(`couplings/${BARKHATOV.couplingId}`, 'driverNameRu', BARKHATOV.fields.name, 'AP96967 (сцепка): ФИО → реестр Бархатова');
    // карточка
    setIfNeeded(`tractors/${BARKHATOV.cardId}`, 'driverName', BARKHATOV.fields.name, 'AP96967 (карточка): ФИО → реестр Бархатова');
    setIfNeeded(`tractors/${BARKHATOV.cardId}`, 'driverNameRu', BARKHATOV.fields.name, 'AP96967 (карточка): ФИО → реестр Бархатова');
    setIfNeeded(`tractors/${BARKHATOV.cardId}`, 'birthDate', BARKHATOV.fields.birthDate, 'AP96967 (карточка): дата рождения → реестр Бархатова');
    setIfNeeded(`tractors/${BARKHATOV.cardId}`, 'passportNumber', BARKHATOV.fields.passport, 'AP96967 (карточка): паспорт → реестр Бархатова');
    setIfNeeded(`tractors/${BARKHATOV.cardId}`, 'personalId', BARKHATOV.fields.personalId, 'AP96967 (карточка): личный № → реестр Бархатова');
    // активная запись «Учёта выезда»
    setIfNeeded(`baza/${BARKHATOV.activeBazaId}`, 'driverName', BARKHATOV.fields.name, 'AP96967 (активный учёт): ФИО → реестр Бархатова; driverRaw (исходный текст) не трогается');
    setIfNeeded(`baza/${BARKHATOV.activeBazaId}`, 'driverShortNameRu', BARKHATOV.fields.name, 'AP96967 (активный учёт): ФИО → реестр Бархатова');
    // контролируемый отчёт: значения, которых нет в реестре Бархатова
    const cardRec = asObj(ctx.tractors[BARKHATOV.cardId]);
    for (const f of ['passportStart', 'passportEnd', 'passportIssuedBy']) {
      const v = s(cardRec[f]);
      if (v) report.ambiguous.push(`tractors/${BARKHATOV.cardId}/${f} = «${v}» (у Чернявского; в реестре Бархатова пусто) — НЕ перезаписано, ждёт решения владельца`);
    }
    if (s(cardRec.phone)) report.ambiguous.push(`tractors/${BARKHATOV.cardId}/phone = «${s(cardRec.phone)}» — в реестре такого поля нет`);
    else report.ambiguous.push(`tractors/${BARKHATOV.cardId}/phone пусто; в реестре Бархатова отдельный phone «${s(bark.phone)}» — не подставлялся`);
    report.ambiguous.push(`baza/${BARKHATOV.activeBazaId}/driverRaw = «${s(asObj(ctx.baza[BARKHATOV.activeBazaId]).driverRaw)}» (исходный текст) — НЕ перезаписан (история)`);
  }

  // ---------- D. слияние дублей карточек ----------
  const mergeOne = (target: string, sources: string[]) => {
    const tgt = asObj(tractors[target]);
    if (!Object.keys(tgt).length) {
      report.conflicts.push(`СЛИЯНИЕ ПРОПУЩЕНО: нет основной карточки tractors/${target} (${sources.join(', ')})`);
      return;
    }
    const existingFrom: string[] = Array.isArray(tgt.mergedFrom) ? (tgt.mergedFrom as unknown[]).map(s) : [];
    const newFrom: string[] = [];
    for (const srcKey of sources) {
      const src = asObj(tractors[srcKey]);
      if (!Object.keys(src).length) continue; // уже слито (идемпотентность)
      newFrom.push(srcKey);
      // перенос непустых полей
      for (const [f, sv] of Object.entries(src)) {
        if (['id', 'carNumber', 'vehicleNumbers', 'mergedFrom', 'mergedAt'].includes(f)) continue;
        if (f === 'rate' || f === 'rateGroupId') {
          const tv = tgt[f];
          if (sv === undefined || sv === '' || sv === null) continue;
          if (tv === undefined || tv === '' || tv === null) {
            plan.push({ kind: 'set', path: `tractors/${target}/${f}`, record: `tractors/${target}`, field: f, before: tv ?? null, after: sv, note: `${f} из двойника ${srcKey}` });
            tgt[f] = sv;
          } else if (JSON.stringify(tv) !== JSON.stringify(sv)) {
            report.conflicts.push(`tractors/${target}: ${f} — у основной «${JSON.stringify(tv)}», у двойника ${srcKey} «${JSON.stringify(sv)}» — НЕ изменено`);
          }
          continue;
        }
        if (sv && typeof sv === 'object' && !Array.isArray(sv)) {
          // артефакт битого ключа: НЕполевое имя свойства = номер прицепа,
          // значение — мини-запись «тягач / прицеп»
          if (!KNOWN_CARD_FIELDS.has(f) && /\d/.test(f)) {
            const trailerNo = f.trim();
            const tTrailer = s(tgt['trailerNumber']);
            if (!tTrailer) {
              plan.push({ kind: 'set', path: `tractors/${target}/trailerNumber`, record: `tractors/${target}`, field: 'trailerNumber', before: null, after: trailerNo, note: `вложенный номер прицепа из двойника ${srcKey}` });
              tgt['trailerNumber'] = trailerNo;
            } else if (canonPlate(tTrailer) !== canonPlate(trailerNo)) {
              report.conflicts.push(`tractors/${target}: trailerNumber у основной «${tTrailer}», вложенный у двойника ${srcKey} «${trailerNo}» — НЕ изменено`);
            }
          } else {
            report.conflicts.push(`tractors/${target}: непустое вложенное свойство «${f}» у двойника ${srcKey} — ${JSON.stringify(sv).slice(0, 120)} — НЕ перенесено`);
          }
          continue;
        }
        const svStr = s(sv);
        if (!svStr) continue;
        const tvStr = s(tgt[f]);
        if (!tvStr) {
          plan.push({ kind: 'set', path: `tractors/${target}/${f}`, record: `tractors/${target}`, field: f, before: tgt[f] ?? null, after: sv, note: `поле из двойника ${srcKey}` });
          tgt[f] = sv;
        } else if (f === 'trailerNumber' && canonPlate(tvStr) === canonPlate(svStr)) {
          // формат-вариант того же номера — ок
        } else if (tvStr !== svStr) {
          report.conflicts.push(`tractors/${target}: ${f} — у основной «${tvStr}», у двойника ${srcKey} «${svStr}» — НЕ изменено`);
        }
      }
    }
    if (newFrom.length) {
      const merged = [...new Set([...existingFrom, ...newFrom])].sort();
      plan.push({
        kind: 'set', path: `tractors/${target}/mergedFrom`, record: `tractors/${target}`, field: 'mergedFrom',
        before: existingFrom.length ? existingFrom : null, after: merged, note: 'след слияния дублей',
      });
      plan.push({ kind: 'set', path: `tractors/${target}/mergedAt`, record: `tractors/${target}`, field: 'mergedAt', before: tgt['mergedAt'] ?? null, after: STAMP, note: 'штамп слияния' });
      for (const srcKey of newFrom) {
        plan.push({ kind: 'del', path: `tractors/${srcKey}`, record: `tractors/${srcKey}`, note: `двойник слит в ${target} (mergedFrom)` });
      }
    }
  };
  for (const g of CARD_MERGES) mergeOne(g.target, g.sources);

  // ---------- D2. починка AP 8340-7 → AP83407 ----------
  const repairSourcesPresent = CARD_REPAIR.sources.filter((k) => Object.keys(asObj(tractors[k])).length);
  if (repairSourcesPresent.length) {
    const tgtNew = asObj(tractors[CARD_REPAIR.target]);
    let trailerNo = '';
    // вложенный номер прицепа: свойство-«номер» с объектным значением
    for (const srcKey of repairSourcesPresent) {
      const src = asObj(tractors[srcKey]);
      for (const [f, sv] of Object.entries(src)) {
        if (sv && typeof sv === 'object' && !Array.isArray(sv) && !KNOWN_CARD_FIELDS.has(f) && /\d/.test(f)) {
          trailerNo = trailerNo || f.trim();
        }
      }
    }
    if (!Object.keys(tgtNew).length) {
      const value: Obj = {
        id: CARD_REPAIR.target,
        carNumber: CARD_REPAIR.carNumber,
        vehicleNumbers: CARD_REPAIR.vehicleNumbers,
        ...(trailerNo ? { trailerNumber: trailerNo } : {}),
        mergedFrom: [...CARD_REPAIR.sources].sort(),
        mergedAt: STAMP,
      };
      plan.push({ kind: 'put', path: `tractors/${CARD_REPAIR.target}`, record: `tractors/${CARD_REPAIR.target}`, value, note: 'починка битого ключа: канонический ключ + номер прицепа в trailerNumber' });
      for (const srcKey of repairSourcesPresent) {
        plan.push({ kind: 'del', path: `tractors/${srcKey}`, record: `tractors/${srcKey}`, note: `битый дубль слит в ${CARD_REPAIR.target}` });
      }
    } else {
      for (const srcKey of repairSourcesPresent) {
        plan.push({ kind: 'del', path: `tractors/${srcKey}`, record: `tractors/${srcKey}`, note: `битый дубль слит в ${CARD_REPAIR.target} (карточка уже есть)` });
      }
      const from = Array.isArray(tgtNew.mergedFrom) ? (tgtNew.mergedFrom as unknown[]).map(s) : [];
      plan.push({ kind: 'set', path: `tractors/${CARD_REPAIR.target}/mergedFrom`, record: `tractors/${CARD_REPAIR.target}`, field: 'mergedFrom', before: from.length ? from : null, after: [...new Set([...from, ...CARD_REPAIR.sources])].sort(), note: 'след слияния' });
    }
  }

  // ---------- E. тестовые карточки ----------
  for (const k of TEST_CARDS) {
    const rec = asObj(tractors[k]);
    if (!Object.keys(rec).length) continue;
    const structural: string[] = [];
    for (const [cid, cv] of Object.entries(ctx.couplings)) if (s(asObj(cv).tractorId) === k || cid === k) structural.push(`couplings/${cid}`);
    for (const [bid, bv] of Object.entries(ctx.baza)) if (s(asObj(bv).couplingId) === k || s(asObj(bv).carId) === k) structural.push(`baza/${bid}`);
    for (const [aid, av] of Object.entries(ctx.archive)) if (s(asObj(av).couplingId) === k || s(asObj(av).carId) === k) structural.push(`archive/${aid}`);
    for (const [sid, sv] of Object.entries(ctx.salary)) {
      if (sid === 'flat' || sid === 'months' || sid === 'byDispatcher') continue;
      if (s(asObj(sv).carId) === k) structural.push(`salaryHistory/${sid}`);
    }
    report.refs[`test:${k}`] = { structural };
    if (structural.length) {
      report.conflicts.push(`УДАЛЕНИЕ tractors/${k} ПРОПУЩЕНО: структурные ссылки ${structural.join(', ')}`);
    } else {
      plan.push({ kind: 'del', path: `tractors/${k}`, record: `tractors/${k}`, note: 'тестовая/мусорная карточка (ссылок нет)' });
    }
  }

  // ---------- F. BB40627: искажённая дата рождения ----------
  const bb = asObj(tractors[BB_FIX.card]);
  const bd = s(bb[BB_FIX.field]);
  if (bd) {
    plan.push({ kind: 'unset', path: `tractors/${BB_FIX.card}/${BB_FIX.field}`, record: `tractors/${BB_FIX.card}`, field: BB_FIX.field, note: `неправдоподобная дата рождения «${bd}» — удаляется (решение владельца)` });
  }

  // ---------- G. ссылки AP 8340-7 → AP83407 ----------
  for (const r of REF_UPDATES) {
    const tree = r.record.startsWith('baza/') ? ctx.baza : ctx.archive;
    const within = asObj(asObj(tree)[r.record.split('/')[1]]);
    const cur = s(within[r.field]);
    if (cur === r.to) continue;
    if (cur !== r.from) {
      report.skipped.push(`${r.path}: текущее «${cur}» ≠ ожидаемого «${r.from}» — пропущено`);
      continue;
    }
    plan.push({ kind: 'set', path: r.path, record: r.record, field: r.field, before: cur, after: r.to, note: 'ссылка на починенный ключ карточки' });
  }

  return plan;
}

// ================= применение =================
function opSummary(op: Op): string {
  switch (op.kind) {
    case 'del': return `DELETE ${op.path} — ${op.note}`;
    case 'unset': return `UNSET  ${op.path} — ${op.note}`;
    case 'set': return `SET    ${op.path}: ${JSON.stringify(op.before)} → ${JSON.stringify(op.after)} — ${op.note}`;
    case 'put': return `PUT    ${op.path} (новая запись) — ${op.note}`;
  }
}

// ================= ФАЗА 2: перенос vehicleFleet + чистка мёртвых веток =================
const L2C: Record<string, string> = { A: 'А', B: 'В', E: 'Ё', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х', I: 'І' };
/** Варианты ключа как в портале (sources.ts: keyVariants): как есть + кириллица→латиница + латиница→кириллица. */
const keyVariants = (x: unknown): string[] => {
  const raw = normKey(x);
  if (!raw) return [];
  const set = new Set<string>([raw]);
  set.add(raw.split('').map((ch) => CYR2LAT[ch] ?? ch).join(''));
  set.add(raw.split('').map((ch) => L2C[ch] ?? ch).join(''));
  return [...set].filter(Boolean);
};

interface VfOp { source: string; target: string; field: string; before: unknown; after: unknown; note: string }

/** Полный расчёт переноса vehicleFleet → tractors (используется и в отчёте, и в --verify). */
function planVf(vf: Obj, tr: Obj, cps: Obj, tl: Obj): { sets: VfOp[]; conflicts: string[]; unmatched: string[]; noops: number } {
  const tIndex = new Map<string, Set<string>>();
  const addIdx = (m: Map<string, Set<string>>, x: unknown, key: string) => {
    for (const v of keyVariants(x)) {
      let set = m.get(v);
      if (!set) { set = new Set(); m.set(v, set); }
      set.add(key);
    }
  };
  for (const [k, v] of Object.entries(tr)) {
    addIdx(tIndex, k, k);
    const r = asObj(v);
    addIdx(tIndex, r.id, k);
    addIdx(tIndex, String(r.carNumber ?? '').split('/')[0], k);
    addIdx(tIndex, String(r.vehicleNumbers ?? '').split('/')[0], k);
  }
  const cIndex = new Map<string, Set<string>>();
  for (const [k, v] of Object.entries(cps)) {
    addIdx(cIndex, k, k);
    const r = asObj(v);
    addIdx(cIndex, r.id, k);
    addIdx(cIndex, r.tractorId, k);
    addIdx(cIndex, String(r.carNumber ?? '').split('/')[0], k);
  }
  const tlKeys = new Set<string>();
  for (const [k, v] of Object.entries(tl)) {
    const r = asObj(v);
    for (const x of [k, r.id, r.trailerNumber]) for (const vv of keyVariants(x)) tlKeys.add(vv);
  }

  const setMap = new Map<string, VfOp>();
  const conflicts: string[] = [];
  const unmatched: string[] = [];
  let noops = 0;
  for (const [k, vRaw] of Object.entries(vf)) {
    const v = asObj(vRaw);
    let tgts = new Set<string>();
    for (const x of keyVariants(k)) for (const t of tIndex.get(x) ?? []) tgts.add(t);
    if (!tgts.size) {
      const cpsHits = new Set<string>();
      for (const x of keyVariants(k)) for (const c of cIndex.get(x) ?? []) cpsHits.add(c);
      for (const c of cpsHits) {
        const tid = s(asObj(cps[c]).tractorId) || c;
        for (const x of keyVariants(tid)) for (const t of tIndex.get(x) ?? []) tgts.add(t);
      }
    }
    if (!tgts.size) {
      const trHits = keyVariants(k).filter((x) => tlKeys.has(x));
      unmatched.push(`${k} — ${JSON.stringify(v)}${trHits.length ? ` (прицепы: ${trHits.join(', ')})` : ' (ни карточки, ни сцепки, ни прицепа)'}`);
      continue;
    }
    for (const t of tgts) {
      const trec = asObj(tr[t]);
      for (const f of ['lastPassportVerificationYear', 'status'] as const) {
        const val = v[f];
        if (val === undefined || val === null || val === '') continue;
        const cur = trec[f];
        const empty = cur === undefined || cur === null || cur === '';
        const mapKey = `${t}|${f}`;
        const existing = setMap.get(mapKey);
        if (empty) {
          if (!existing) setMap.set(mapKey, { source: k, target: t, field: f, before: cur ?? null, after: val, note: `vehicleFleet/${k} → tractors/${t} (сверка по вариантам ключа)` });
          else if (String(existing.after) !== String(val)) conflicts.push(`tractors/${t}/${f}: источники vehicleFleet дают разные значения (${JSON.stringify(existing.after)} из ${existing.source} и ${JSON.stringify(val)} из ${k}) — НЕ изменено`);
        } else if (String(cur) !== String(val)) {
          conflicts.push(`tractors/${t}/${f}: в карточке «${String(cur)}», в vehicleFleet/${k} «${String(val)}» — НЕ перезаписано (оба непустые, решение владельца)`);
        } else noops++;
      }
    }
  }
  return { sets: [...setMap.values()], conflicts, unmatched, noops };
}

/** Число записей узла: массив → длина, объект → ключи, скаляр → 1. */
const nodeCount = (raw: unknown): number => (Array.isArray(raw) ? raw.length : raw && typeof raw === 'object' ? Object.keys(asObj(raw)).length : 1);

async function phase2() {
  const mode = VERIFY ? 'ПРОВЕРКА СОСТОЯНИЯ' : APPLY ? (YES ? 'ПРИМЕНЕНИЕ ИЗМЕНЕНИЙ' : '--apply без --yes — запись запрещена') : 'предварительный отчёт (без записи)';
  if (!QUIET) console.log(`migrate-fleet-cards · фаза 2 (перенос vehicleFleet + чистка мёртвых веток)\nРежим: ${mode}\nБаза: ${DB}\n`);

  const [vfRaw, trRaw, cpsRaw, tlRaw] = await Promise.all([fetchAll('vehicleFleet'), fetchAll('tractors'), fetchAll('couplings'), fetchAll('trailers')]);
  const vf = asObj(vfRaw), tr = asObj(trRaw), cps = asObj(cpsRaw), tl = asObj(tlRaw);

  if (VERIFY) {
    const problems: string[] = [];
    for (const d of DEAD_BRANCHES) if ((await fetchAll(d.branch)) !== null) problems.push(`ветка ${d.branch} ещё существует — удаление не выполнено`);
    for (const k of KEPT_BRANCHES) if ((await fetchAll(k.branch)) === null) problems.push(`ветка ${k.branch} отсутствует (не должна была удаляться — проверь!)`);
    const vfPlan = planVf(vf, tr, cps, tl);
    if (vfPlan.sets.length) problems.push(`перенос vehicleFleet не завершён: осталось ${vfPlan.sets.length} значений (${vfPlan.sets.map((o) => `${o.target}/${o.field}`).join(', ')})`);
    if (problems.length) { console.log(`ФАЗА 2 ПРОВЕРКА: проблемы (${problems.length}):`); for (const p of problems) console.log(`  ! ${p}`); process.exitCode = 1; }
    else console.log(`ФАЗА 2 ПРОВЕРКА: перенос выполнен, мёртвые ветки удалены, живые на месте. ✓ (осознанных конфликтов: ${vfPlan.conflicts.length}, без сопоставления: ${vfPlan.unmatched.length})`);
    return;
  }

  // ---- план переноса vehicleFleet → tractors ----
  const { sets, conflicts, unmatched, noops } = planVf(vf, tr, cps, tl);

  // ---- план удаления мёртвых веток ----
  const delOps: Array<{ branch: string; count: number; reason: string }> = [];
  for (const d of DEAD_BRANCHES) {
    const raw = await fetchAll(d.branch);
    if (raw !== null) {
      delOps.push({ branch: d.branch, count: nodeCount(raw), reason: d.reason });
    }
  }

  // ---- отчёт ----
  if (!QUIET) {
    console.log('=== ПЕРЕНОС vehicleFleet → tractors (полезные поля) ===');
    console.log(`  операций к записи: ${sets.length}; уже совпадало: ${noops}; конфликтов (в отчёт): ${conflicts.length}; не сопоставлено: ${unmatched.length}`);
    for (const o of sets) console.log(`  + tractors/${o.target}/${o.field} = ${JSON.stringify(o.after)}  (${o.before === null ? 'пусто' : JSON.stringify(o.before)} ← ${o.note})`);
    if (conflicts.length) { console.log('\n  КОНФЛИКТЫ (НЕ перезаписано):'); for (const c of conflicts) console.log(`  ! ${c}`); }
    if (unmatched.length) { console.log('\n  НЕ СОПОСТАВЛЕНО (в отчёт, без записи):'); for (const u of unmatched) console.log(`  ~ ${u}`); }
    console.log('\n=== УДАЛЕНИЕ МЁРТВЫХ ВЕТОК (после бэкапа) ===');
    for (const d of delOps) console.log(`  DELETE ${d.branch} (${d.count} записей) — ${d.reason}`);
    if (!delOps.length) console.log('  (нечего удалять — уже удалено)');
    console.log('\n=== ОСТАВЛЕНЫ (в отчёт владельцу) ===');
    for (const k of KEPT_BRANCHES) { const raw = await fetchAll(k.branch); const n = raw === null ? '—' : (typeof raw === 'object' || Array.isArray(raw) ? nodeCount(raw) : 'скаляр'); console.log(`  · ${k.branch} (${n}): ${k.verdict}`); }
  }

  mkdirSync(FLEET_DIR, { recursive: true });
  const planReport = {
    when: new Date().toISOString(), db: DB, mode: APPLY && YES ? 'apply' : 'dry-run', phase: 'branches',
    totals: { vfSets: sets.length, conflicts: conflicts.length, unmatched: unmatched.length, branchDeletes: delOps.length },
    vfSets: sets, conflicts, unmatched, branchDeletes: delOps, kept: KEPT_BRANCHES,
  };
  const planPath = join(FLEET_DIR, `migration-fleet-branches-${STAMP}.json`);
  writeFileSync(planPath, JSON.stringify(planReport, null, 2), 'utf8');
  writeFileSync(join(FLEET_DIR, 'migration-fleet-branches.latest.json'), JSON.stringify(planReport, null, 2), 'utf8');
  if (!QUIET) console.log(`\nОтчёт-план: ${planPath}`);

  if (!APPLY) { if (!QUIET) console.log('Изменений не внесено. Для применения: npx tsx scripts/migrate-fleet-cards.ts --phase2 --apply --yes'); return; }
  if (!YES) { console.error('\nОТКАЗ: для реальной записи нужен явный флаг --yes.'); process.exitCode = 2; return; }

  // ---- применение ----
  const backupDir = join(FLEET_DIR, 'backups', STAMP);
  const branchesDir = join(backupDir, 'branches');
  mkdirSync(branchesDir, { recursive: true });
  const manifest: Record<string, unknown> = { when: new Date().toISOString(), db: DB, phase: 'branches', stamp: STAMP, planFile: planPath, records: {}, branchBackups: {} };

  // 1) перенос полей (со свежей сверкой «до»)
  const touched = [...new Set(sets.map((o) => o.target))];
  const fresh = new Map<string, Obj>();
  for (const t of touched) fresh.set(t, asObj(await fetchAll(`tractors/${t}`)));
  const updates: Record<string, unknown> = {};
  const applied: VfOp[] = [];
  for (const o of sets) {
    const rec = fresh.get(o.target) ?? {};
    const cur = rec[o.field];
    if (deepEqual(cur ?? null, o.after)) continue;
    if (!deepEqual(cur ?? null, o.before)) { if (!QUIET) console.log(`  ~ tractors/${o.target}/${o.field}: значение изменилось (${JSON.stringify(cur)}) — пропущено`); continue; }
    updates[`tractors/${o.target}/${o.field}`] = o.after;
    applied.push(o);
  }
  // бэкап затрагиваемых карточек
  for (const [t, rec] of fresh) {
    const fname = `tractors__${t}.json`;
    writeFileSync(join(backupDir, fname), JSON.stringify(rec, null, 2), 'utf8');
    (manifest.records as Record<string, string>)[`tractors/${t}`] = fname;
  }
  if (Object.keys(updates).length) {
    const ok = await patchRoot(updates);
    if (!ok) { console.error('ОШИБКА записи PATCH (перенос полей)'); process.exitCode = 1; return; }
    if (!QUIET) console.log(`\nПеренос: записано путей: ${Object.keys(updates).length}`);
    const fail: string[] = [];
    for (const o of applied) {
      const rec = asObj(await fetchAll(`tractors/${o.target}`));
      if (!deepEqual(rec[o.field] ?? null, o.after)) fail.push(`tractors/${o.target}/${o.field}`);
    }
    if (fail.length) { console.error(`ПРОВЕРКА ПЕРЕНОСА НЕ ПРОШЛА: ${fail.join(', ')}`); process.exitCode = 1; return; }
    if (!QUIET) console.log(`Проверка чтением: все ${applied.length} перенесённых значений на месте ✓`);
  } else if (!QUIET) console.log('\nПеренос: нечего записывать (всё уже перенесено).');

  // 2) удаление мёртвых веток — сначала полный снимок ветки + манифест, затем DELETE
  for (const d of delOps) {
    const rawFresh = await fetchAll(d.branch);
    if (rawFresh === null) { if (!QUIET) console.log(`  ${d.branch}: уже отсутствует`); continue; }
    const count = nodeCount(rawFresh);
    const fname = `${d.branch}.json`;
    writeFileSync(join(branchesDir, fname), JSON.stringify(rawFresh, null, 2), 'utf8');
    (manifest.branchBackups as Record<string, unknown>)[d.branch] = { file: `branches/${fname}`, records: count, reason: d.reason, deletedAt: new Date().toISOString() };
    const res = await fetch(encodeURI(`${DB}/${d.branch}.json`), { method: 'DELETE' });
    if (!res.ok) { console.error(`  ОШИБКА удаления ${d.branch}: HTTP ${res.status}`); process.exitCode = 1; continue; }
    const after = await fetchAll(d.branch);
    if (after !== null) { console.error(`  ${d.branch}: НЕ удалилась`); process.exitCode = 1; }
    else if (!QUIET) console.log(`  Удалено: ${d.branch} (${count} записей; бэкап branches/${fname})`);
  }
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
  if (!QUIET) console.log(`\nБэкап фазы 2: ${backupDir} (карточек: ${Object.keys(manifest.records as Obj).length}, веток: ${Object.keys(manifest.branchBackups as Obj).length})`);
  if (!QUIET) console.log('Повторный запуск идемпотентен: условия пересчитываются из текущих данных.');
}

async function main() {
  if (PHASE2) { await phase2(); return; }
  if (!QUIET) {
    const mode = VERIFY ? 'ПРОВЕРКА СОСТОЯНИЯ' : APPLY ? (YES ? 'ПРИМЕНЕНИЕ ИЗМЕНЕНИЙ' : '--apply без --yes — запись запрещена') : 'предварительный отчёт (без записи)';
    console.log(`migrate-fleet-cards · фаза 1 (карточки)\nРежим: ${mode}\nБаза: ${DB}\n`);
  }

  const report = { ambiguous: [] as string[], conflicts: [] as string[], skipped: [] as string[], refs: {} as Record<string, unknown> };
  const ctx = await loadCtx();
  if (!QUIET) {
    console.log(`Ветки: drivers ${Object.keys(ctx.drivers).length}, tractors ${Object.keys(ctx.tractors).length}, couplings ${Object.keys(ctx.couplings).length}, baza ${Object.keys(ctx.baza).length}, archive ${Object.keys(ctx.archive).length}, baza_cars ${Object.keys(ctx.baza_cars).length}\n`);
  }

  const plan = buildPlan(ctx, report);
  const byKind = (k: Op['kind']) => plan.filter((p) => p.kind === k);

  if (VERIFY) {
    const problems: string[] = [];
    // 1) удалённые ключи не должны существовать
    for (const g of CARD_MERGES) for (const src of g.sources) if (ctx.tractors[src]) problems.push(`остался двойник tractors/${src}`);
    for (const src of CARD_REPAIR.sources) if (ctx.tractors[src] && !ctx.tractors[CARD_REPAIR.target]) problems.push(`остался битый ключ tractors/${src}`);
    for (const k of TEST_CARDS) if (ctx.tractors[k]) problems.push(`осталась тестовая карточка tractors/${k}`);
    for (const d of STUB_DRIVERS) if (ctx.drivers[d]) problems.push(`остался огрызок drivers/${d}`);
    if (ctx.drivers[BEZ_V.driverId]) problems.push(`осталась служебная запись drivers/${BEZ_V.driverId}`);
    // 2) отсутствие висячих ссылок после миграции
    for (const [cid, cv] of Object.entries(ctx.couplings)) {
      const tId = s(asObj(cv).tractorId) || cid;
      if (!ctx.tractors[tId]) problems.push(`висячая ссылка couplings/${cid}.tractorId=${tId}`);
      const dId = s(asObj(cv).driverId);
      if (dId && !ctx.drivers[dId]) problems.push(`висячая ссылка couplings/${cid}.driverId=${dId}`);
    }
    // 3) состояние полей
    const cAP = asObj(ctx.couplings[BEZ_V.couplingId]);
    if (s(cAP.driverId) || s(cAP.driverName) || s(cAP.driverNameRu)) problems.push(`couplings/${BEZ_V.couplingId}: остались поля водителя`);
    const tAP77 = asObj(ctx.tractors[BEZ_V.cardId]);
    for (const f of BEZ_V.cardClear) if (f in tAP77 && tAP77[f] !== '') problems.push(`tractors/${BEZ_V.cardId}: осталось поле ${f}`);
    if (s(tAP77.driverId)) problems.push(`tractors/${BEZ_V.cardId}: остался driverId`);
    const tAP67 = asObj(ctx.tractors[BARKHATOV.cardId]);
    for (const [f, want] of [['driverName', BARKHATOV.fields.name], ['driverNameRu', BARKHATOV.fields.name], ['birthDate', BARKHATOV.fields.birthDate], ['passportNumber', BARKHATOV.fields.passport], ['personalId', BARKHATOV.fields.personalId]] as Array<[string, string]>) {
      if (s(tAP67[f]) !== want) problems.push(`tractors/${BARKHATOV.cardId}/${f} = «${s(tAP67[f])}» ≠ «${want}»`);
    }
    const bb = asObj(ctx.tractors[BB_FIX.card]);
    if (s(bb[BB_FIX.field])) problems.push(`tractors/${BB_FIX.card}/${BB_FIX.field} = «${s(bb[BB_FIX.field])}» — не удалено`);
    const merged = asObj(ctx.tractors[CARD_REPAIR.target]);
    if (!Object.keys(merged).length) problems.push(`нет починенной карточки tractors/${CARD_REPAIR.target}`);
    else if (!s(merged.trailerNumber)) problems.push(`tractors/${CARD_REPAIR.target}: trailerNumber пуст`);
    for (const g of CARD_MERGES) {
      const t = asObj(ctx.tractors[g.target]);
      const from = Array.isArray(t.mergedFrom) ? (t.mergedFrom as unknown[]) : [];
      for (const src of g.sources) if (!from.some((x) => String(x) === src)) problems.push(`tractors/${g.target}: mergedFrom не содержит «${src}»`);
    }
    if (problems.length) {
      console.log(`ПРОВЕРКА: НАЙДЕНЫ ПРОБЛЕМЫ (${problems.length}):`);
      for (const p of problems) console.log(`  ! ${p}`);
      process.exitCode = 1;
    } else {
      console.log('ПРОВЕРКА: всё в порядке — дубли слиты, ссылки целы, поля соответствуют решению владельца. ✓');
    }
    return;
  }

  // ---------- отчёт плана ----------
  if (!QUIET) {
    console.log('=== ПЛАН (жёсткий список, одобрено владельцем) ===');
    const labels: Array<[Op['kind'], string]> = [
      ['put', 'Починка AP83407 (новая карточка)'],
      ['set', 'Изменения полей'],
      ['unset', 'Удаление полей'],
      ['del', 'Удаление записей (дубли/тесты/огрызки)'],
    ];
    for (const [k, label] of labels) {
      const items = byKind(k);
      console.log(`\n${label}: ${items.length}`);
      for (const it of items) console.log(`  ${opSummary(it)}`);
    }
    console.log(`\nИТОГО операций: ${plan.length}; удаляется записей: ${byKind('del').length}; затрагивается записей: ${new Set(plan.map((p) => p.record)).size}`);
    console.log('\n=== ССЫЛКИ (проверка перед удалением) ===');
    for (const [k, v] of Object.entries(report.refs)) console.log(`  · ${k}: ${JSON.stringify(v)}`);
    console.log('\n=== НЕОДНОЗНАЧНОЕ (не меняется, в отчёт) ===');
    for (const a of report.ambiguous) console.log(`  ~ ${a}`);
    if (report.conflicts.length) {
      console.log('\n=== КОНФЛИКТЫ / ПРОПУСКИ ===');
      for (const c of report.conflicts) console.log(`  ! ${c}`);
    }
    if (report.skipped.length) {
      console.log('\n=== ПРОПУЩЕНО (не совпало ожидание) ===');
      for (const c of report.skipped) console.log(`  ~ ${c}`);
    }
  }

  mkdirSync(FLEET_DIR, { recursive: true });
  const planReport = {
    when: new Date().toISOString(), db: DB, mode: APPLY && YES ? 'apply' : 'dry-run', phase: 'cards',
    totals: { ops: plan.length, deletes: byKind('del').length, records: new Set(plan.map((p) => p.record)).size },
    plan, ambiguous: report.ambiguous, conflicts: report.conflicts, skipped: report.skipped, refs: report.refs,
  };
  const planPath = join(FLEET_DIR, `migration-fleet-cards-${STAMP}.json`);
  writeFileSync(planPath, JSON.stringify(planReport, null, 2), 'utf8');
  writeFileSync(join(FLEET_DIR, 'migration-fleet-cards.latest.json'), JSON.stringify(planReport, null, 2), 'utf8');
  if (!QUIET) console.log(`\nОтчёт-план: ${planPath}`);

  if (!APPLY) {
    if (!QUIET) console.log('Изменений не внесено. Для применения: npx tsx scripts/migrate-fleet-cards.ts --apply --yes');
    return;
  }
  if (!YES) { console.error('\nОТКАЗ: для реальной записи нужен явный флаг --yes.'); process.exitCode = 2; return; }
  if (!plan.length) { if (!QUIET) console.log('\nПлан пуст (всё уже применено) — повторный запуск ничего не меняет. ✓'); return; }

  // ---------- применение ----------
  // 1. Свежая сверка каждого листа + полный бэкап затрагиваемых и удаляемых записей
  const touchedRecords = [...new Set(plan.map((p) => p.record))];
  const fresh = new Map<string, Obj>();
  for (const rec of touchedRecords) fresh.set(rec, asObj(await fetchAll(rec)));

  const updates: Record<string, unknown> = {};
  const appliedOps: Op[] = [];
  const dropped: string[] = [];
  for (const op of plan) {
    const tree = fresh.get(op.record) ?? {};
    if (op.kind === 'del') {
      if (!Object.keys(tree).length) { dropped.push(`${op.path}: уже отсутствует`); continue; }
      updates[op.path] = null; appliedOps.push(op); continue;
    }
    if (op.kind === 'put') {
      if (Object.keys(tree).length) { dropped.push(`${op.path}: уже существует`); continue; }
      updates[op.path] = op.value; appliedOps.push(op); continue;
    }
    const leaf = op.path.split('/').slice(2);
    const exists = hasLeaf(tree, leaf);
    if (op.kind === 'unset') {
      if (!exists) { dropped.push(`${op.path}: поля уже нет`); continue; }
      updates[op.path] = null; appliedOps.push(op); continue;
    }
    // set
    const cur = exists ? getLeaf(tree, leaf) : null;
    if (deepEqual(cur, op.after)) { dropped.push(`${op.path}: уже целевое значение`); continue; }
    if (!deepEqual(cur, op.before)) { dropped.push(`${op.path}: значение изменилось после расчёта (${JSON.stringify(cur)} ≠ ожидаемого ${JSON.stringify(op.before)}) — пропущено`); continue; }
    updates[op.path] = op.after; appliedOps.push(op);
  }
  if (dropped.length && !QUIET) {
    console.log(`\nПропущено при свежей сверке: ${dropped.length}`);
    for (const d of dropped) console.log(`  ~ ${d}`);
  }

  // 2. Бэкап — ПОЛНЫЕ копии всех затрагиваемых и удаляемых записей
  const backupDir = join(FLEET_DIR, 'backups', STAMP);
  mkdirSync(backupDir, { recursive: true });
  const files: Record<string, string> = {};
  for (const [rec, tree] of fresh) {
    const fname = rec.replace(/\//g, '__') + '.json';
    writeFileSync(join(backupDir, fname), JSON.stringify(tree ?? null, null, 2), 'utf8');
    files[rec] = fname;
  }
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({
    when: new Date().toISOString(), db: DB, phase: 'cards', stamp: STAMP,
    planFile: planPath, operations: plan.length, applied: appliedOps.length,
    records: files, deletions: appliedOps.filter((o) => o.kind === 'del').map((o) => o.path),
    plan, ambiguous: report.ambiguous, conflicts: report.conflicts, skipped: report.skipped, dropped,
  }, null, 2), 'utf8');
  if (!QUIET) console.log(`Бэкап: ${backupDir} (${Object.keys(files).length} записей, полные копии)`);

  if (!Object.keys(updates).length) { if (!QUIET) console.log('После сверки не осталось изменений — запись не требуется. ✓'); return; }

  // 3. Одна multi-path запись
  const ok = await patchRoot(updates);
  if (!ok) { console.error('ОШИБКА записи PATCH'); process.exitCode = 1; return; }
  if (!QUIET) console.log(`Записано путей: ${Object.keys(updates).length}`);

  // 4. Проверка чтением
  const fail: string[] = [];
  const checkRecs = [...new Set(appliedOps.filter((o) => o.kind !== 'del' && o.kind !== 'put').map((o) => o.record))];
  for (const rec of checkRecs) {
    const tree = asObj(await fetchAll(rec));
    for (const op of appliedOps) {
      if (op.record !== rec || op.kind === 'del' || op.kind === 'put') continue;
      const leaf = op.path.split('/').slice(2);
      const cur = hasLeaf(tree, leaf) ? getLeaf(tree, leaf) : null;
      const want = op.kind === 'unset' ? null : (op as { after: unknown }).after;
      const same = op.kind === 'unset' ? !hasLeaf(tree, leaf) : deepEqual(cur, want);
      if (!same) fail.push(`${op.path}: ожидали ${JSON.stringify(want)}, получили ${JSON.stringify(cur)}`);
    }
  }
  for (const op of appliedOps.filter((o) => o.kind === 'del')) {
    const tree = asObj(await fetchAll(op.record));
    if (Object.keys(tree).length) fail.push(`${op.path}: запись не удалилась`);
  }
  for (const op of appliedOps.filter((o) => o.kind === 'put')) {
    const tree = asObj(await fetchAll(op.path));
    if (op.kind === 'put' && !deepEqual(tree, op.value)) fail.push(`${op.path}: новая запись не совпадает`);
  }
  if (fail.length) {
    console.error('ПРОВЕРКА ЧТЕНИЕМ НЕ ПРОШЛА:');
    for (const f of fail) console.error(`  ! ${f}`);
    process.exitCode = 1;
  } else if (!QUIET) {
    console.log(`Проверка чтением: все ${appliedOps.length} операций подтверждены ✓`);
    console.log('Повторный запуск не создаст дублей: условия пересчитываются из текущих данных.');
  }
}

main().catch((e) => { console.error('Сбой миграции:', e); process.exitCode = 1; });

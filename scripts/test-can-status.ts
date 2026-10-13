/**
 * Тесты индикатора поступления CAN-данных (чистая логика canStatusCore):
 * фазы, пороги свежести, различия текущего поступления и истории, технические
 * состояния («Загрузка», «Не удалось проверить») и подписи фаз.
 *
 * Покрывает требования владельца из ТЗ по разделу «Пробег и связь»:
 *  - состояние — по фактическому получению CAN-данных машины (не по API в целом и
 *    не по GPS-координатам);
 *  - НЕИЗМЕННОЕ показание при поступающих данных — это «Поступают данные»;
 *  - отдельно различаются текущее поступление и наличие истории за период;
 *  - при ошибке чтения — «Не удалось проверить», при загрузке — «Загрузка…»;
 *  - отсутствие показаний одометра — «CAN-одометр не передается»;
 *  - пороги выведены из реальной реализации (canSweepMin = 60 мин, intervalSec).
 *
 * Запуск: npx tsx scripts/test-can-status.ts  (или npm run test:can-status)
 */
import {
  CAN_HISTORY_FRESH_MS,
  CAN_PHASE_LABEL,
  CAN_SWEEP_MIN_DEFAULT,
  CAN_STATUS_LOADING,
  CAN_STATUS_TIMEOUT_MS,
  computeCanCarStatus,
  snapshotFreshMs,
  type CanCarPhase,
  type CanStatusRaw,
} from '../src/components/modules/mileageComms/canStatusCore';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra: unknown = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra !== '' ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
};

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.parse('2026-10-13T19:00:00+03:00');

/** Сырые факты: измерение истории + покрытие + окно чтения (вчера 00:00 +03). */
const raw = (o: Partial<CanStatusRaw> = {}): CanStatusRaw => ({
  lastMeas: null,
  measCount: 0,
  covLastMs: null,
  covFilledAtMs: null,
  windowFromMs: Date.parse('2026-10-12T00:00:00+03:00'),
  loadedAtMs: NOW,
  ...o,
});

const meas = (ageMs: number, valueKm = 868_712): CanStatusRaw['lastMeas'] => ({
  tMs: NOW - ageMs,
  valueKm,
  precision: 'km_int',
  receivedAtMs: NOW - ageMs + 20 * MIN,
});

const snap = (o: { ageMs: number; km?: number | null; quality?: string | null }): {
  odoQuality: string | null;
  odoKm: number | null;
  coordAtMs: number | null;
} => ({
  odoQuality: o.quality === undefined ? 'ok' : o.quality,
  odoKm: o.km === undefined ? 868_712 : o.km,
  coordAtMs: NOW - o.ageMs,
});

const phaseOf = (p: {
  raw: CanStatusRaw | null;
  error?: string | null;
  current?: { odoQuality?: string | null; odoKm?: number | null; coordAtMs?: number | null } | null;
  intervalSec?: number;
}): CanCarPhase =>
  computeCanCarStatus({
    raw: p.raw,
    error: p.error ?? null,
    current: p.current ?? null,
    nowMs: NOW,
    intervalSec: p.intervalSec ?? 300,
  }).phase;

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Технические состояния: загрузка и ошибка чтения');
{
  check('нет данных чтения и нет ошибки → «Загрузка…»', phaseOf({ raw: null }) === 'loading');
  check('подпись загрузки — «Загрузка…»', CAN_PHASE_LABEL.loading === 'Загрузка…');
  check('ошибка чтения → фаза error', phaseOf({ raw: null, error: 'не удалось прочитать' }) === 'error');
  check('подпись ошибки — «Не удалось проверить» (техническое состояние)', CAN_PHASE_LABEL.error === 'Не удалось проверить');
  const err = computeCanCarStatus({ raw: null, error: 'сеть', current: snap({ ageMs: 5 * MIN }), nowMs: NOW, intervalSec: 300 });
  check('ошибка важнее данных снимка: живые координаты не выдают за подтверждённое состояние', err.phase === 'error' && err.error === 'сеть');
  check('таймаут чтения — 12 с', CAN_STATUS_TIMEOUT_MS === 12_000);
  check('константа загрузки — фаза loading', CAN_STATUS_LOADING.phase === 'loading');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Пороги выведены из реальной реализации');
{
  check('canSweepMin = 60 мин (дефолт съёма)', CAN_SWEEP_MIN_DEFAULT === 60);
  check('порог истории = 2 × canSweepMin = 2 ч', CAN_HISTORY_FRESH_MS === 2 * HOUR);
  check('снимок: max(3 × intervalSec, 20 мин) при 300 с → 20 мин', snapshotFreshMs(300) === 20 * MIN);
  check('снимок: max(3 × intervalSec, 20 мин) при 900 с → 45 мин', snapshotFreshMs(900) === 45 * MIN);
  check('снимок: мусорный intervalSec → дефолт 300 с', snapshotFreshMs(Number.NaN) === 20 * MIN && snapshotFreshMs(0) === 20 * MIN);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Свежие измерения: flowing');
{
  check('измерение 30 мин назад → «Поступают данные»', phaseOf({ raw: raw({ lastMeas: meas(30 * MIN), measCount: 1 }) }) === 'flowing');
  check('измерение РОВНО на пороге 2 ч → «Поступают данные»', phaseOf({ raw: raw({ lastMeas: meas(2 * HOUR), measCount: 1 }) }) === 'flowing');
  check('измерение 2 ч + 1 мин → уже не свежее', phaseOf({ raw: raw({ lastMeas: meas(2 * HOUR + MIN), measCount: 1, covLastMs: NOW - 2 * HOUR }) }) === 'stale');
  check('свежий снимок с одометром (10 мин) → «Поступают данные»', phaseOf({ raw: raw({ measCount: 0 }), current: snap({ ageMs: 10 * MIN }) }) === 'flowing');
  check('снимок 21 мин назад → не свежий, но передача БЫЛА: «Не поступают данные»', phaseOf({ raw: raw({}), current: snap({ ageMs: 21 * MIN }) }) === 'stale');
  const st = computeCanCarStatus({ raw: raw({ lastMeas: meas(15 * MIN), measCount: 3 }), error: null, current: null, nowMs: NOW, intervalSec: 300 });
  check('время показания — время измерения истории', st.lastMeasMs === NOW - 15 * MIN && st.lastReadingMs === NOW - 15 * MIN);
  check('значение показания отдаётся для подсказки', st.lastMeasValueKm === 868_712 && st.lastMeasPrecision === 'km_int');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Неизменное показание при поступающих данных — это «Поступают данные»');
{
  const same1 = raw({ lastMeas: meas(35 * MIN, 868_712), measCount: 1, covLastMs: NOW - 35 * MIN });
  const same2 = raw({ lastMeas: meas(15 * MIN, 868_712), measCount: 2, covLastMs: NOW - 15 * MIN });
  check('две записи с ОДИНАКОВЫМ значением, разные времена → flowing', phaseOf({ raw: same1 }) === 'flowing' && phaseOf({ raw: same2 }) === 'flowing');
  check('значение не менялось — фаза не понижается (стоянка ≠ отсутствие данных)', phaseOf({ raw: same2 }) === 'flowing');
  check('время показания берётся из последней по времени записи, а не из изменения значения', computeCanCarStatus({ raw: same2, error: null, current: null, nowMs: NOW, intervalSec: 300 }).lastMeasMs === NOW - 15 * MIN);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('5. Отсутствие поступления и отсутствие показаний');
{
  const old = raw({ lastMeas: meas(5 * HOUR), measCount: 4, covLastMs: NOW - 70 * MIN });
  const st = computeCanCarStatus({ raw: old, error: null, current: null, nowMs: NOW, intervalSec: 300 });
  check('старая история → «Не поступают данные»', st.phase === 'stale');
  check('подпись «Не поступают данные»', CAN_PHASE_LABEL.stale === 'Не поступают данные');
  check('время показания = максимум из источников (покрытие свежее измерения)', st.lastReadingMs === NOW - 70 * MIN);
  check('история есть, но не свежая — это НЕ «нет показаний»', st.phase !== 'no_odometer');

  check('пусто совсем → «CAN-одометр не передается»', phaseOf({ raw: raw({}) }) === 'no_odometer');
  check('подпись «CAN-одометр не передается» — как в ТЗ', CAN_PHASE_LABEL.no_odometer === 'CAN-одометр не передается');
  check('снимок БЕЗ одометра (координаты есть, odom_can пуст) → не доказательство', phaseOf({ raw: raw({}), current: snap({ ageMs: 5 * MIN, km: null, quality: 'absent' }) }) === 'no_odometer');
  check('нулевое показание (odom_can = 0) — «нет данных», не ноль км', phaseOf({ raw: raw({}), current: snap({ ageMs: 5 * MIN, km: 0 }) }) === 'no_odometer');
  check('старый снимок вне окна чтения — не доказательство передачи', phaseOf({ raw: raw({ windowFromMs: NOW - 30 * MIN }), current: snap({ ageMs: 3 * HOUR }) }) === 'no_odometer');
  check('съём был, измерений нет (покрытие без точек) → одометр не передаётся', phaseOf({ raw: raw({ covFilledAtMs: NOW - 40 * MIN }) }) === 'no_odometer');
  check('покрытие с последним измерением дня → «Не поступают данные» (история есть)', phaseOf({ raw: raw({ covLastMs: NOW - 3 * HOUR }) }) === 'stale');
}

// ────────────────────────────────────────────────────────────────────────────
console.log('6. Единство подписей фаз');
{
  const phases: CanCarPhase[] = ['flowing', 'stale', 'no_odometer', 'loading', 'error'];
  const labels = phases.map((p) => CAN_PHASE_LABEL[p]);
  check('подписи всех пяти фаз заданы', labels.every((l) => typeof l === 'string' && l.length > 3), labels);
  check('подписи различимы', new Set(labels).size === labels.length, labels);
  check('состояние поступления и отсутствия истории — разные подписи', CAN_PHASE_LABEL.flowing !== CAN_PHASE_LABEL.stale);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('');
if (failed) {
  console.error(`ПРОВАЛ: ${failed} из ${passed + failed} проверок не прошли.`);
  process.exit(1);
}
console.log(`Все проверки пройдены: ${passed}.`);

/**
 * Статус поступления CAN-данных (показаний одометра, поле odom_can) по
 * конкретной машине — источник индикатора «Поступают / Не поступают данные».
 *
 * Здесь — ЧТЕНИЕ фактов из базы (эта часть работает с Firebase). Чистая логика
 * (типы, пороги, решение о фазе) вынесена в ./canStatusCore и реэкспортируется
 * отсюда, чтобы потребители и тесты пользовались одним путём импорта.
 *
 * Учитываются ТОЛЬКО фактические получения показаний одометра ИМЕННО этой
 * машины (не факт успешного ответа API вообще и не свежесть GPS-координат):
 *  1) telemetry_can_history/<car>/<день> — измерения с РЕАЛЬНЫМ временем (tMs)
 *     и временем получения порталом (rAt): object-stat-data / city-or-track /
 *     parking-movement-report (см. server/navby/collector.ts);
 *  2) telemetry_current/<car> — снимок поллера: позиция + odom_can; засчитывается
 *     ТОЛЬКО когда в снимке реально есть показание одометра (odoQuality='ok' и
 *     odoKm>0) — снимок без одометра это «координаты без CAN», не доказательство;
 *  3) telemetry_can_coverage/<car>/<день> — факт съёма по машине (filledAt) и
 *     последнее записанное измерение дня (lastMs) — фолбэк для времени показания.
 *
 * Различаем текущее поступление и наличие истории: старая история не доказывает,
 * что данные идут СЕЙЧАС; пусто в периоде ≠ нет текущей связи. Неизменное
 * показание не является «отсутствием данных» — состояние считается по факту
 * получения записей, а не по изменению значения.
 */

import { get, ref } from 'firebase/database';
import { database, useFirebase } from '../../../api';
import { canDayKey, dayBoundsFromKey, normalizeCanRecord } from './engine/canSeries';
import { CAN_STATUS_TIMEOUT_MS, type CanStatusRaw } from './canStatusCore';

/** Чистая логика и пороги — в canStatusCore; реэкспорт, чтобы импорт остался одним. */
export * from './canStatusCore';

/** Префикс веток телеметрии — как ROOT в server/navby (store.ts). */
const ROOT = 'telemetry';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}: превышено время ожидания`)), ms)),
  ]);
}

/**
 * Чтение фактов о поступлении CAN-данных машины: дневные папки истории за
 * сегодня и вчера + покрытие по машине. Бросает исключение, если прочитать
 * не удалось (отличаем «данных нет» от «не удалось проверить»).
 */
export async function readCanStatusRaw(carKey: string, nowMs: number): Promise<CanStatusRaw> {
  if (!useFirebase) throw new Error('База данных недоступна');
  const todayKey = canDayKey(nowMs);
  const yesterdayKey = canDayKey(nowMs - 86_400_000);
  const [todaySnap, ySnap, covSnap] = await withTimeout(
    Promise.all([
      get(ref(database, `${ROOT}_can_history/${carKey}/${todayKey}`)),
      get(ref(database, `${ROOT}_can_history/${carKey}/${yesterdayKey}`)),
      get(ref(database, `${ROOT}_can_coverage/${carKey}`)),
    ]),
    CAN_STATUS_TIMEOUT_MS,
    'чтение данных машины',
  );

  let lastMeas: CanStatusRaw['lastMeas'] = null;
  let measCount = 0;
  for (const snap of [todaySnap, ySnap]) {
    const node = snap.val() as Record<string, Record<string, unknown>> | null;
    if (!node) continue;
    for (const rec of Object.values(node)) {
      const p = normalizeCanRecord(rec);
      if (!p) continue;
      measCount += 1;
      if (!lastMeas || p.xMs > lastMeas.tMs) {
        lastMeas = { tMs: p.xMs, valueKm: p.valueKm, precision: p.precision, receivedAtMs: p.receivedAtMs };
      }
    }
  }

  const cov = covSnap.val() as Record<string, Record<string, unknown>> | null;
  let covLastMs: number | null = null;
  let covFilledAtMs: number | null = null;
  for (const rec of Object.values(cov || {})) {
    if (!rec) continue;
    const lastMs = typeof rec.lastMs === 'number' && Number.isFinite(rec.lastMs) ? rec.lastMs : null;
    if (lastMs != null && (covLastMs == null || lastMs > covLastMs)) covLastMs = lastMs;
    const filled = typeof rec.filledAt === 'string' ? Date.parse(rec.filledAt) : NaN;
    if (Number.isFinite(filled) && (covFilledAtMs == null || filled > covFilledAtMs)) covFilledAtMs = filled;
  }

  const bounds = dayBoundsFromKey(yesterdayKey);
  return {
    lastMeas,
    measCount,
    covLastMs,
    covFilledAtMs,
    windowFromMs: bounds ? bounds.fromMs : nowMs - 2 * 86_400_000,
    loadedAtMs: Date.now(),
  };
}

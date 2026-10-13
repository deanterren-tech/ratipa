/**
 * ЧИСТАЯ логика индикатора поступления CAN-данных (без Firebase) — вынесена из
 * canStatus.ts, чтобы её можно было проверять тестом в node и переиспользовать
 * в карточке/таблице. Здесь только типы, пороги и решение о фазе.
 *
 * Пороги выведены из реальной реализации (числа не выдуманы):
 *  - съём измерений истории: server/navby/config.ts → CAN_COLLECT_DEFAULTS.canSweepMin
 *    = 60 мин (почасовые окна object-stat-data). CAN_HISTORY_FRESH_MS = 2 × canSweepMin
 *    — допускаем один пропущенный/задёржанный цикл съёма;
 *  - снимки поллера: max(3 × intervalSec, 20 мин) — та же формула, что в движке серий
 *    (classifyCanSync); intervalSec по умолчанию 300 с (telemetry_config в базе
 *    отсутствует → работают дефолты кода).
 */
import type { CanPoint } from './engine/canSeries';

export type CanCarPhase = 'loading' | 'error' | 'flowing' | 'stale' | 'no_odometer';

/** Подписи фаз: технические состояния («Загрузка», «Не удалось проверить») — не статусы проверки пробега. */
export const CAN_PHASE_LABEL: Record<CanCarPhase, string> = {
  flowing: 'Поступают данные',
  stale: 'Не поступают данные',
  no_odometer: 'CAN-одометр не передается',
  loading: 'Загрузка…',
  error: 'Не удалось проверить',
};

/** Дефолт съёма истории: server/navby/config.ts → CAN_COLLECT_DEFAULTS.canSweepMin. */
export const CAN_SWEEP_MIN_DEFAULT = 60;

/** Порог «данные не поступают» для измерений истории: 2 × canSweepMin. */
export const CAN_HISTORY_FRESH_MS = 2 * CAN_SWEEP_MIN_DEFAULT * 60_000;

/** Таймаут чтения статуса: зависшая сеть даёт «Не удалось проверить», а не вечную «Загрузку». */
export const CAN_STATUS_TIMEOUT_MS = 12_000;

/** «Свежий снимок» поллера: max(3 × intervalSec, 20 мин). */
export function snapshotFreshMs(intervalSec: number): number {
  const sec = Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : 300;
  return Math.max(3 * sec * 1000, 20 * 60_000);
}

/** Сырые факты чтения (до вычисления фазы): только то, что реально лежит в базе. */
export interface CanStatusRaw {
  /** Последнее измерение истории из прочитанных дней (сегодня + вчера). */
  lastMeas: { tMs: number; valueKm: number; precision: CanPoint['precision']; receivedAtMs: number | null } | null;
  /** Сколько измерений найдено в окне чтения. */
  measCount: number;
  /** Покрытие: последнее записанное измерение (lastMs) и последний факт съёма (filledAt) по машине. */
  covLastMs: number | null;
  covFilledAtMs: number | null;
  /** Начало вчерашнего дня (+03): снимок старше окна чтения — устаревшее состояние, а не доказательство передачи. */
  windowFromMs: number;
  loadedAtMs: number;
}

export interface CanCarStatus {
  phase: CanCarPhase;
  /** Компактное «последнее полученное показание» — максимум из источников (мс). */
  lastReadingMs: number | null;
  /** Последнее измерение истории (реальное время измерения). */
  lastMeasMs: number | null;
  lastMeasValueKm: number | null;
  lastMeasPrecision: CanPoint['precision'] | null;
  lastMeasReceivedAtMs: number | null;
  /** Последний снимок поллера с одометром (время координаты; времени измерения в API нет). */
  lastSnapMs: number | null;
  lastSnapValueKm: number | null;
  /** Сколько измерений истории найдено в окне чтения (сегодня+вчера). */
  measCount: number;
  /** Факт последнего съёма истории по машине (coverage.filledAt). */
  covFilledAtMs: number | null;
  error: string | null;
}

const EMPTY_STATUS: Omit<CanCarStatus, 'phase'> = {
  lastReadingMs: null,
  lastMeasMs: null,
  lastMeasValueKm: null,
  lastMeasPrecision: null,
  lastMeasReceivedAtMs: null,
  lastSnapMs: null,
  lastSnapValueKm: null,
  measCount: 0,
  covFilledAtMs: null,
  error: null,
};

export const CAN_STATUS_LOADING: CanCarStatus = { phase: 'loading', ...EMPTY_STATUS };

/** Минимальные поля снимка поллера, нужные решению (совместимо с McCurrent). */
export interface CanStatusCurrent {
  odoQuality?: string | null;
  odoKm?: number | null;
  coordAtMs?: number | null;
}

/**
 * Фаза индикатора:
 *  flowing     — есть СВЕЖЕЕ получение: измерение истории в пределах 2 ч ИЛИ
 *                снимок с одометром в пределах max(3×intervalSec, 20 мин);
 *  stale       — показания одометра по машине есть (измерения/покрытие/снимок
 *                в окне чтения), но новых поступлений нет;
 *  no_odometer — показаний одометра нет вовсе: история пуста, покрытие без
 *                измерений, снимков с одометром в окне чтения нет.
 * Неизменное значение одометра фазу НЕ понижает: считается факт получения
 * записей, а не изменение значения.
 */
export function computeCanCarStatus(params: {
  raw: CanStatusRaw | null;
  error: string | null;
  current: CanStatusCurrent | null | undefined;
  nowMs: number;
  intervalSec: number;
}): CanCarStatus {
  const { raw, error, current, nowMs, intervalSec } = params;
  if (error) return { phase: 'error', ...EMPTY_STATUS, error };
  if (!raw) return CAN_STATUS_LOADING;

  const odoKm = current?.odoKm;
  const snapOk =
    Boolean(current) &&
    current!.odoQuality === 'ok' &&
    typeof odoKm === 'number' &&
    Number.isFinite(odoKm) &&
    odoKm > 0 &&
    Number.isFinite(current!.coordAtMs);
  const snap = snapOk ? { ms: current!.coordAtMs as number, km: odoKm as number } : null;

  const meas = raw.lastMeas;
  const flowingMeas = Boolean(meas && nowMs - meas.tMs <= CAN_HISTORY_FRESH_MS);
  const flowingSnap = Boolean(snap && nowMs - snap.ms <= snapshotFreshMs(intervalSec));
  const flowing = flowingMeas || flowingSnap;

  const snapEvidence = Boolean(snap && snap.ms >= raw.windowFromMs);
  const hasEvidence = Boolean(meas || raw.covLastMs != null || snapEvidence);

  const phase: CanCarPhase = flowing ? 'flowing' : hasEvidence ? 'stale' : 'no_odometer';

  const candidates: number[] = [];
  if (meas) candidates.push(meas.tMs);
  if (snap) candidates.push(snap.ms);
  if (raw.covLastMs != null) candidates.push(raw.covLastMs);
  const lastMs = candidates.length ? Math.max(...candidates) : null;

  return {
    phase,
    lastReadingMs: lastMs,
    lastMeasMs: meas ? meas.tMs : null,
    lastMeasValueKm: meas ? meas.valueKm : null,
    lastMeasPrecision: meas ? meas.precision : null,
    lastMeasReceivedAtMs: meas ? meas.receivedAtMs : null,
    lastSnapMs: snap ? snap.ms : null,
    lastSnapValueKm: snap ? snap.km : null,
    measCount: raw.measCount,
    covFilledAtMs: raw.covFilledAtMs,
    error: null,
  };
}

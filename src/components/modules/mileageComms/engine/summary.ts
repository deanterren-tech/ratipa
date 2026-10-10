/**
 * Сводка по рейсу и вспомогательные функции (объединение интервалов,
 * GPS-сравнение на сопоставимых участках). Никаких «ущербов» и вердиктов:
 * только наблюдаемые значения с подписями об ограничениях.
 */

import type {
  GainInterval, GainKind, Interval, MeasureSample, Stop, StopAnalysis, TechEvent, TripEventRow, TripSummary, UnknownPeriod,
} from './types';
import type { CheckParams } from './params';
import { gpsKmInRange, odoDelta, pairSpeedKmh } from './gps';
import { coveredMs, dataGaps, sortDedupeSamples, markStale, sliceWindow } from './samples';
import { splitSegments } from './tech';
import { fmtDMYHM, fmtKm } from './format';

export const FLAGGED_NOTE = 'Не является подтверждённым завышением: сумма приростов на отмеченных интервалах без пересечений (перекрытия устранены).';

/** Объединение пересекающихся интервалов. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = [...list].sort((a, b) => a.fromMs - b.fromMs || a.toMs - b.toMs);
  const out: Interval[] = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && iv.fromMs <= last.toMs) {
      last.toMs = Math.max(last.toMs, iv.toMs);
    } else {
      out.push({ fromMs: iv.fromMs, toMs: iv.toMs });
    }
  }
  return out;
}

/** Классификация интервала пары измерений для второго графика. */
function pairKind(
  prev: MeasureSample,
  cur: MeasureSample,
  gapInside: boolean,
  stopEventKind: 'A' | 'B' | null,
  stopId: string | null,
): { kind: GainKind; quality: GainInterval['quality'] } {
  if (prev.odoSource && cur.odoSource && prev.odoSource !== cur.odoSource) return { kind: 'reset', quality: 'reset' };
  if (prev.odoKm != null && cur.odoKm != null && cur.odoKm < prev.odoKm - 0.001) return { kind: 'reset', quality: 'reset' };
  if (prev.odoKm == null || cur.odoKm == null) return { kind: 'normal', quality: 'no_odo' };
  if (gapInside) return { kind: 'gap', quality: 'gap' };
  if (stopId && stopEventKind === 'A') return { kind: 'stop_rise', quality: 'ok' };
  if (stopId && stopEventKind === 'B') return { kind: 'resume', quality: 'ok' };
  return { kind: 'normal', quality: 'ok' };
}

/** Интервалы приростов между соседними измерениями (второй график). */
export function buildGains(
  samples: MeasureSample[],
  fromMs: number,
  toMs: number,
  params: CheckParams,
  stopById: Map<string, { stop: Stop; analysis: StopAnalysis }>,
): GainInterval[] {
  const out: GainInterval[] = [];
  const slack = 6 * 3_600_000;
  const relevant = samples.filter((s) => s.atMs >= fromMs - slack && s.atMs <= toMs + slack);
  for (let i = 1; i < relevant.length; i += 1) {
    const prev = relevant[i - 1];
    const cur = relevant[i];
    const mid = (prev.atMs + cur.atMs) / 2;
    if (cur.atMs < fromMs || prev.atMs > toMs) continue;
    const dtMs = cur.atMs - prev.atMs;
    if (dtMs <= 0) continue;
    const gapInside = dtMs > params.dataGapMin * 60_000;
    const delta = odoDelta(prev, cur);
    const rate = delta != null ? delta / (dtMs / 3_600_000) : null;
    // Связь со стоянкой: пара лежит внутри интервала стоянки.
    let stopId: string | null = null;
    let stopEventKind: 'A' | 'B' | null = null;
    for (const { stop, analysis } of stopById.values()) {
      if (mid >= stop.startMs && mid <= stop.endMs) {
        stopId = stop.id;
        stopEventKind = analysis.scenario === 'A' || analysis.scenario === 'B' ? analysis.scenario : null;
        break;
      }
    }
    const { kind, quality } = pairKind(prev, cur, gapInside, stopEventKind, stopId);
    out.push({
      fromMs: prev.atMs,
      toMs: cur.atMs,
      durationMin: dtMs / 60_000,
      fromOdoKm: prev.odoKm,
      toOdoKm: cur.odoKm,
      deltaKm: delta,
      rateKmh: rate,
      kind,
      stopId,
      gapInside,
      invalid: pairSpeedKmh(prev, cur) != null && (pairSpeedKmh(prev, cur) as number) > params.gpsMaxSegmentKmh && delta == null,
      quality,
    });
  }
  return out;
}

export interface SummaryInput {
  window: { fromMs: number; toMs: number };
  samples: MeasureSample[];
  stops: Array<{ stop: Stop; analysis: StopAnalysis }>;
  events: TripEventRow[];
  techEvents: TechEvent[];
  plan: { planKm: number | null; factKm: number | null; sourceLabel: string };
  resolvedEventIds: string[];
  params: CheckParams;
}

export function buildSummary(input: SummaryInput): { summary: TripSummary; unknowns: UnknownPeriod[] } {
  const { window, stops, events, plan, resolvedEventIds, params } = input;
  const samples = markStale(sortDedupeSamples(input.samples), params);
  const { inWindow, before } = sliceWindow(samples, window.fromMs, window.toMs);

  const unknowns: UnknownPeriod[] = dataGaps(inWindow, window.fromMs, window.toMs, params).map((g) => ({
    ...g,
    reason: inWindow.length ? 'Нет измерений дольше порога разрыва — неизвестный период (не стоянка)' : 'Измерений за период нет',
  }));

  const totalWindowMs = Math.max(0, window.toMs - window.fromMs);
  const verifiedMs = coveredMs(inWindow, window.fromMs, window.toMs, params);
  const dataCompletenessPct = totalWindowMs > 0 ? Math.round((verifiedMs / totalWindowMs) * 100) : 0;

  /* ── Прирост одометра за рейс ── */
  const odoSamples = inWindow.filter((s) => s.odoKm != null);
  let odoGainKm: number | null = null;
  let odoGainReason: string | null = null;
  let baselineKm: number | null = null;
  let lastOdoKm: number | null = null;
  if (!odoSamples.length) {
    odoGainReason = 'Одометр за период не передаётся — прирост не вычислить.';
  } else {
    const segments = splitSegments(inWindow, window.fromMs, window.toMs);
    const contextBaseline = before && before.odoKm != null ? before : null;
    const base = contextBaseline ?? odoSamples[0];
    baselineKm = base.odoKm;
    lastOdoKm = odoSamples[odoSamples.length - 1].odoKm;
    if (segments.length > 1) {
      odoGainReason = `В периоде несколько участков счётчика (${segments.length}): ${segments
        .slice(1)
        .map((s) => s.breakReason || 'разрыв')
        .join(', ')}. Прирост за рейс корректно не вычисляется.`;
    } else if (baselineKm != null && lastOdoKm != null && lastOdoKm < baselineKm - 0.001) {
      odoGainReason = 'Показания в конце ниже начальных (сброс/замена счётчика) — прирост корректно не вычисляется.';
    } else if (baselineKm != null && lastOdoKm != null) {
      odoGainKm = lastOdoKm - baselineKm;
    }
  }

  /* ── GPS-сравнение на сопоставимых участках ── */
  const gps = gpsKmInRange(inWindow, window.fromMs, window.toMs, params);
  const gpsCoveredKm: number | null = gps.pairs > 0 ? gps.km : null;
  let odoOnGpsIntervalsKm: number | null = null;
  let gpsCoverageMs = 0;
  if (gps.pairs > 0) {
    let odoSum = 0;
    let odoOk = true;
    for (const iv of gps.intervals) {
      gpsCoverageMs += iv.toMs - iv.fromMs;
      const inside = inWindow.filter((s) => s.atMs >= iv.fromMs && s.atMs <= iv.toMs && s.odoKm != null);
      if (inside.length >= 2) {
        const d = (inside[inside.length - 1].odoKm as number) - (inside[0].odoKm as number);
        if (d >= -0.001) odoSum += Math.max(0, d);
        else odoOk = false;
      }
    }
    odoOnGpsIntervalsKm = odoOk ? odoSum : null;
  }
  const gpsCoveragePct = totalWindowMs > 0 ? Math.round((gpsCoverageMs / totalWindowMs) * 100) : 0;
  const gpsCompareNote =
    gps.pairs > 0
      ? `Сравнение только на покрытых участках (${gpsCoveragePct}% времени рейса; пар измерений ${gps.pairs}${gps.excludedPairs ? `, исключено ${gps.excludedPairs}` : ''}). Результат не распространяется на весь рейс.`
      : 'Пригодной истории GPS за период недостаточно — сравнение не выполняется.';

  /* ── События ── */
  const eventsOnStops = events.filter((e) => e.stopId != null).length;
  const eventsInMotion = events.filter((e) => e.stopId == null).length;
  const checkEvents = events.filter((e) => e.severity === 'check');
  const openChecks = checkEvents.filter((e) => !resolvedEventIds.includes(e.id)).length;
  const stopsWithEvents = stops.filter((s) => s.analysis.scenario != null).length;

  /* ── Прирост на отмеченных интервалах (без пересечений) ── */
  const riseIntervals = checkEvents.map((e) => e.riseInterval).filter((iv): iv is Interval => iv != null);
  const merged = mergeIntervals(riseIntervals);
  let flaggedGainKm: number | null = null;
  if (merged.length) {
    let sum = 0;
    let ok = true;
    for (const iv of merged) {
      const inside = inWindow.filter((s) => s.atMs >= iv.fromMs && s.atMs <= iv.toMs && s.odoKm != null);
      if (inside.length >= 2) {
        const d = (inside[inside.length - 1].odoKm as number) - (inside[0].odoKm as number);
        if (d >= 0) sum += d;
        else ok = false;
      } else {
        ok = false;
      }
    }
    flaggedGainKm = ok ? sum : null;
  }

  const summary: TripSummary = {
    odoGainKm,
    odoGainReason,
    baselineKm,
    lastOdoKm,
    planKm: plan.planKm,
    factKm: plan.factKm,
    declaredSourceLabel: plan.sourceLabel,
    gpsCoveredKm,
    odoOnGpsIntervalsKm,
    gpsCoveragePct: gps.pairs > 0 ? gpsCoveragePct : null,
    gpsCompareNote,
    verifiedMs,
    unknownMs: Math.max(0, totalWindowMs - verifiedMs),
    totalWindowMs,
    dataCompletenessPct,
    stopsTotal: stops.length,
    stopsWithEvents,
    eventsOnStops,
    eventsInMotion,
    openChecks,
    flaggedGainKm,
    flaggedNote: FLAGGED_NOTE,
  };
  return { summary, unknowns };
}

/** Подпись сравнения GPS ↔ одометр (километры и проценты) для карточки. */
export function gpsCompareLabel(summary: TripSummary): string {
  if (summary.gpsCoveredKm == null || summary.odoOnGpsIntervalsKm == null) return '—';
  const diff = summary.odoOnGpsIntervalsKm - summary.gpsCoveredKm;
  const pct = summary.gpsCoveredKm > 0 ? (diff / summary.gpsCoveredKm) * 100 : null;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${fmtKm(diff)}${pct != null ? ` (${sign}${pct.toFixed(1)}%)` : ''}`;
}

/** Короткий ярлык интервала для подсказок. */
export const intervalLabel = (iv: Interval): string => `${fmtDMYHM(iv.fromMs)} → ${fmtDMYHM(iv.toMs)}`;

/**
 * Композиция движка: полный анализ рейса одной чистой функцией.
 *
 * Вход: окно рейса, измерения портала (с контекстом), интервалы отчёта Nav.by
 * (или null — недоступен), история привязок, технические отметки, параметры.
 * Выход: стоянки, сценарии, события, приросты, участки, сводка.
 */

import type {
  MeasureSample, ParkingIntervalRaw, TechMarkRecord, TripAnalysisResult, TripWindow,
} from './types';
import type { CheckParams } from './params';
import { markStale, sortDedupeSamples, sliceWindow } from './samples';
import { pickStops } from './stops';
import { analyzeStop, eventsFromGaps, eventsFromMotion, eventsFromStops } from './analysis';
import { buildGains, buildSummary } from './summary';
import { medianPosition } from './gps';
import {
  detectDataTechEvents, detectMappingTechEvents, techEventsFromMarks, splitSegments,
  type MappingHistoryLite,
} from './tech';

export interface ReportMeta {
  available: boolean;
  reason: string | null;
  fetchedAt: string | null;
}

export interface AnalyzeTripInput {
  window: TripWindow;
  /** Измерения портала: уже отсортированные; допускается контекст за границами окна. */
  samples: MeasureSample[];
  /** Интервалы отчёта Nav.by, обрезанные сервером; null — отчёт недоступен. */
  reportIntervals: ParkingIntervalRaw[] | null;
  reportMeta: ReportMeta;
  mappingHistory: MappingHistoryLite[];
  techMarks: TechMarkRecord[];
  /** Идентификаторы событий, закрытых/принятых сотрудником (журнал проверки). */
  resolvedEventIds: string[];
  plan: { planKm: number | null; factKm: number | null; sourceLabel: string };
  params: CheckParams;
}

export function analyzeTrip(input: AnalyzeTripInput): TripAnalysisResult {
  const { window, reportMeta, mappingHistory, techMarks, resolvedEventIds, plan, params } = input;
  const samples = markStale(sortDedupeSamples(input.samples), params);
  const { inWindow } = sliceWindow(samples, window.fromMs, window.toMs);

  // 1) Стоянки: отчёт Nav.by либо расчёт портала.
  const stopsResult = pickStops({
    reportAvailable: reportMeta.available,
    reportReason: reportMeta.reason,
    intervals: input.reportIntervals || [],
    samples,
    fromMs: window.fromMs,
    toMs: window.toMs,
    params,
  });

  // 2) Технические события (данные + привязки + отметки) и участки счётчика.
  const techEvents = [
    ...detectDataTechEvents(inWindow),
    ...detectMappingTechEvents(mappingHistory, window.fromMs, window.toMs),
    ...techEventsFromMarks(techMarks, window.fromMs, window.toMs),
  ].sort((a, b) => a.atMs - b.atMs);
  const segments = splitSegments(inWindow, window.fromMs, window.toMs);

  // 3) Анализ стоянок и «место» (медиана позиций внутри стоянки).
  const stops = stopsResult.stops.map((stop) => {
    if (stop.lat == null || stop.lon == null) {
      const med = medianPosition(samples.filter((s) => s.atMs >= stop.startMs && s.atMs <= stop.endMs));
      if (med) stop = { ...stop, lat: med.lat, lon: med.lon };
    }
    return { stop, analysis: analyzeStop(stop, samples, params) };
  });

  // 4) Приросты между измерениями (второй график) и события.
  const stopById = new Map(stops.map((s) => [s.stop.id, s]));
  const gains = buildGains(samples, window.fromMs, window.toMs, params, stopById);
  const stopEvents = eventsFromStops(stops, techEvents);
  const gapEvents = eventsFromGaps(gains, stopEvents, params, techEvents);
  const motionEvents = eventsFromMotion(gains, samples, params, techEvents, [...stopEvents, ...gapEvents]);
  const events = [...stopEvents, ...gapEvents, ...motionEvents].sort((a, b) => a.interval.fromMs - b.interval.fromMs);

  // 5) Сводка.
  const { summary, unknowns } = buildSummary({
    window, samples, stops, events, techEvents, plan, resolvedEventIds, params,
  });

  return {
    window,
    segments,
    stops,
    unknowns,
    gains,
    techEvents,
    events,
    summary,
    report: { available: reportMeta.available, reason: reportMeta.reason, fetchedAt: reportMeta.fetchedAt },
    samplesInWindow: inWindow.length,
  };
}

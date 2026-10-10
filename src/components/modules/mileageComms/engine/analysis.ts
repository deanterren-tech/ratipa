/**
 * Анализ стоянок и построение событий рейса (три сценария уточнённого ТЗ).
 *
 *  А. Рост во время наблюдаемой стоянки — свежие измерения подтверждают
 *     отсутствие движения, показания одометра растут (внутри стоянки).
 *  Б. Необычное изменение при возобновлении движения — частые данные вокруг;
 *     темп прироста между измерениями не соответствует наблюдаемому интервалу.
 *  В. Прирост через разрыв данных — увеличение видно, но момент и обстоятельства
 *     неизвестны → «Прирост через разрыв — требуется проверка» (НЕ «скачок на стоянке»).
 *
 * Если первое измерение после стоянки получено уже в движении, прирост НЕ
 * приписывается стоянке: сценарий А считается только по измерениям внутри
 * стоянки, прирост при возобновлении учитывается отдельно.
 */

import type {
  GainInterval, Interval, MeasureSample, Stop, StopAnalysis, TripEventRow, ScenarioKind, TechEvent,
} from './types';
import type { CheckParams } from './params';
import { fmtDMYHM, fmtDuration, fmtKm, fmtNum } from './format';
import { gpsKmInRange } from './gps';
import { hasGapInside, intervalCrossesGap, maxGapBetween } from './samples';

const isStill = (s: MeasureSample, params: CheckParams): boolean =>
  s.speed == null || s.speed <= params.stopSpeedKmh;

/** Анализ одной стоянки. samples — уже отсортированные и помеченные (stale). */
export function analyzeStop(stop: Stop, samples: MeasureSample[], params: CheckParams): StopAnalysis {
  const preMs = params.preWindowMin * 60_000;
  const postMs = params.postWindowMin * 60_000;

  // Последнее пригодное измерение до стоянки (в окне «до», иначе — ближайшее ранее).
  let before: MeasureSample | null = null;
  for (const s of samples) {
    if (s.atMs >= stop.startMs) break;
    if (s.odoKm != null) before = s;
  }
  const beforeFar = before != null && stop.startMs - before.atMs > preMs;

  // Измерения во время стоянки: включают последнее измерение на границе окончания
  // (оно ещё «внутри» — движение начнётся после), «после» ищется строго далее.
  const during = samples.filter((s) => s.atMs >= stop.startMs && s.atMs <= stop.endMs && (s.odoKm != null || s.posValid));
  const after = samples.find((s) => s.atMs > stop.endMs) || null;
  const afterFar = after != null && after.atMs - stop.endMs > postMs;

  const odoBeforeKm = before?.odoKm ?? null;
  const odoAfterKm = after?.odoKm ?? null;

  const limits: string[] = [];
  if (before == null) limits.push('Нет пригодного измерения одометра до стоянки — прирост до/после не вычислить.');
  else if (beforeFar) limits.push(`Последнее измерение до стоянки старше окна анализа: ${fmtDMYHM(before.atMs)}.`);
  if (after == null) limits.push('После стоянки измерений нет — прирост по завершению стоянки не вычислить.');
  else if (afterFar) limits.push(`Первое измерение после стоянки получено позже окна анализа: ${fmtDMYHM(after.atMs)}.`);

  // Прирост ВНУТРИ стоянки — только по «стоящим» измерениям (без движения).
  const stillDuringOdo = during.filter((s) => isStill(s, params) && s.odoKm != null);
  let riseWithinStopKm: number | null = null;
  let riseWithinSpanMs: number | null = null;
  let withinDense = true;
  if (stillDuringOdo.length >= 2) {
    const first = stillDuringOdo[0];
    const last = stillDuringOdo[stillDuringOdo.length - 1];
    riseWithinStopKm = (last.odoKm as number) - (first.odoKm as number);
    riseWithinSpanMs = last.atMs - first.atMs;
    const gap = maxGapBetween(stillDuringOdo);
    withinDense = gap != null && gap <= params.confirmMaxGapMin * 60_000;
    if (!withinDense) limits.push('Измерения внутри стоянки редкие (есть разрывы) — наблюдение неполное.');
  } else if (stillDuringOdo.length === 1) {
    limits.push('Внутри стоянки лишь одно пригодное измерение — рост во время стоянки не подтверждён.');
  } else if (during.length > 0) {
    limits.push('Измерений с одометром внутри стоянки нет — динамика во время стоянки неизвестна.');
  } else {
    limits.push('Измерений внутри стоянки нет — отсутствие сообщений не является подтверждением стоянки.');
  }

  // Прирост при возобновлении: от последнего известного до первого «после».
  const lastKnown = stillDuringOdo.length ? stillDuringOdo[stillDuringOdo.length - 1] : before;
  let riseResumeKm: number | null = null;
  let resumeRateKmh: number | null = null;
  let resumeAlreadyMoving = false;
  let resumeDtMs: number | null = null;
  if (lastKnown && after && lastKnown.odoKm != null && after.odoKm != null) {
    riseResumeKm = after.odoKm - lastKnown.odoKm;
    resumeDtMs = after.atMs - lastKnown.atMs;
    resumeRateKmh = resumeDtMs > 0 ? riseResumeKm / (resumeDtMs / 3_600_000) : null;
    resumeAlreadyMoving = !isStill(after, params);
  }

  const riseKm = odoBeforeKm != null && odoAfterKm != null ? odoAfterKm - odoBeforeKm : null;

  // Разрывы на наблюдаемом интервале.
  const gapsInside: Interval[] = [];
  const gapFrom = lastKnown && before && lastKnown.atMs === before.atMs ? before.atMs : lastKnown?.atMs ?? stop.startMs;
  if (after && after.atMs > gapFrom) {
    // собрать интервалы разрывов между измерениями на отрезке
    const slice = samples.filter((s) => s.atMs >= gapFrom && s.atMs <= after.atMs);
    for (let i = 1; i < slice.length; i += 1) {
      const d = slice[i].atMs - slice[i - 1].atMs;
      if (d > params.dataGapMin * 60_000) gapsInside.push({ fromMs: slice[i - 1].atMs, toMs: slice[i].atMs });
    }
  }
  const gapCrossed = after != null && intervalCrossesGap(samples, gapFrom, after.atMs, params);

  // GPS на том же наблюдаемом интервале.
  const gpsFrom = gapFrom;
  const gpsTo = after ? after.atMs : stop.endMs;
  const gps = gpsTo > gpsFrom ? gpsKmInRange(samples, gpsFrom, gpsTo, params) : null;
  const gpsKmSameInterval = gps && gps.pairs > 0 ? gps.km : null;

  /* ── Сценарии ── */
  let scenario: ScenarioKind = null;
  let severity: 'none' | 'info' | 'check' = 'none';
  let title: string | null = null;
  let rule: string | null = null;
  const explanation: string[] = [];

  const gapText = gapsInside.length
    ? `На интервале есть разрыв(ы) данных: ${gapsInside.map((g) => `${fmtDMYHM(g.fromMs)} → ${fmtDMYHM(g.toMs)}`).join('; ')}.`
    : 'Разрывов данных на наблюдаемом интервале нет.';

  if (
    riseResumeKm != null && riseResumeKm >= params.gapRiseKm &&
    resumeDtMs != null && resumeDtMs > 0 && gapCrossed
  ) {
    scenario = 'C';
    severity = 'check';
    title = 'Прирост через разрыв — требуется проверка';
    rule = 'Увеличение показаний видно между измерениями, но между ними был период без данных: момент и обстоятельства изменения неизвестны.';
    explanation.push(
      `${fmtKm(riseResumeKm)} между ${fmtDMYHM(gapFrom)} и ${fmtDMYHM(after?.atMs ?? stop.endMs)}.`,
      gapText,
      'Событие НЕ называется «скачком на стоянке»: период без данных не подтверждает ни стоянку, ни момент изменения.',
    );
  } else if (
    riseResumeKm != null && riseResumeKm >= params.resumeMinDeltaKm &&
    resumeRateKmh != null && resumeRateKmh > params.resumeMaxKmh
  ) {
    scenario = 'B';
    severity = 'check';
    title = 'Необычное изменение при возобновлении движения';
    rule = `Темп прироста между измерениями (${fmtNum(resumeRateKmh)} км/ч) не соответствует наблюдаемому интервалу (порог ${params.resumeMaxKmh} км/ч) при частых данных.`;
    explanation.push(
      `${fmtKm(riseResumeKm)} между ${fmtDMYHM(gapFrom)} и ${fmtDMYHM(after?.atMs ?? stop.endMs)} (${fmtDuration(resumeDtMs ?? 0)}).`,
      gapText,
      resumeAlreadyMoving
        ? `Первое измерение после стоянки получено уже в движении (${fmtNum(after?.speed ?? null)} км/ч): прирост отнесён к возобновлению движения, а не к стоянке.`
        : 'Данные вокруг стоянки частые — границы интервала прироста наблюдаемы.',
    );
  } else if (riseWithinStopKm != null && riseWithinStopKm >= params.riseEventKm && withinDense) {
    scenario = 'A';
    severity = 'check';
    title = 'Прирост во время подтверждённой стоянки';
    rule = `Показания одометра выросли на ${fmtKm(riseWithinStopKm)} между измерениями внутри стоянки, при этом измерения подтверждают отсутствие движения.`;
    explanation.push(
      `Измерений «стоя» внутри стоянки: ${stillDuringOdo.length}; интервал между первым и последним: ${fmtDuration(riseWithinSpanMs ?? 0)}.`,
      'Свежие измерения внутри стоянки (скорость и позиции не показывают движения) фиксируют прирост — основание для проверки.',
      gapText,
    );
  } else if (riseWithinStopKm != null && riseWithinStopKm >= params.riseInfoKm) {
    severity = 'info';
    explanation.push(
      `Прирост внутри стоянки ${fmtKm(riseWithinStopKm)} — ниже порога события (${fmtKm(params.riseEventKm)}).`,
      withinDense ? gapText : 'Наблюдение неполное: измерения внутри стоянки редкие.',
    );
  }

  if (scenario == null && severity !== 'info') {
    explanation.push('Признаков необычного прироста на этой стоянке не найдено.');
  }
  if (riseKm != null) explanation.push(`Прирост одометра между измерением до и после стоянки: ${fmtKm(riseKm)}.`);
  if (gps) {
    explanation.push(
      gps.pairs > 0
        ? `GPS-пробег на том же интервале: ${fmtKm(gps.km)} (пар измерений: ${gps.pairs}${gps.excludedPairs ? `, исключено как выбросы/разрывы: ${gps.excludedPairs}` : ''}).`
        : 'GPS-пробег на том же интервале не рассчитан (нет пригодных пар координат).',
    );
  }

  return {
    stopId: stop.id,
    before,
    during,
    after,
    odoBeforeKm,
    odoAfterKm,
    riseKm,
    riseWithinStopKm,
    riseResumeKm,
    resumeRateKmh,
    scenario,
    severity,
    title,
    rule,
    explanation,
    limits,
    gpsKmSameInterval,
    gapsInside,
    resumeAlreadyMoving,
  };
}

/** Полная причина: events из анализа стоянок. */
export function eventsFromStops(
  stops: Array<{ stop: Stop; analysis: StopAnalysis }>,
  techEvents: TechEvent[],
): TripEventRow[] {
  const out: TripEventRow[] = [];
  for (const { stop, analysis } of stops) {
    if (!analysis.scenario || analysis.severity === 'none') continue;
    const kind: TripEventRow['kind'] =
      analysis.scenario === 'A' ? 'stop_A' : analysis.scenario === 'B' ? 'stop_B' : 'gap_rise';
    const lastKnown = analysis.during.length ? analysis.during[analysis.during.length - 1] : analysis.before;
    const riseFrom = lastKnown?.atMs ?? analysis.before?.atMs ?? stop.startMs;
    const riseTo = analysis.after?.atMs ?? stop.endMs;
    const riseAmount = analysis.scenario === 'A' ? analysis.riseWithinStopKm : analysis.riseResumeKm;
    const nearTech = techEvents.find((t) => Math.abs(t.atMs - stop.startMs) <= 12 * 3_600_000) || null;
    out.push({
      id: `ev:${stop.id}`,
      kind,
      severity: analysis.severity === 'check' ? 'check' : 'info',
      title: analysis.title || 'Событие стоянки',
      stopId: stop.id,
      interval: { fromMs: stop.startMs, toMs: stop.endMs },
      deltaKm: riseAmount,
      riseInterval: riseAmount != null ? { fromMs: riseFrom, toMs: riseTo } : null,
      riseKm: riseAmount,
      rule: analysis.rule || '',
      explanation: analysis.explanation,
      techNearby: nearTech,
    });
  }
  return out;
}

/** Пересечение интервалов (строгое — смежные интервалы не считаются пересечением). */
const overlaps = (a: Interval, b: Interval): boolean => a.fromMs < b.toMs && b.fromMs < a.toMs;

/**
 * События «Прирост через разрыв» по интервалам приростов БЕЗ соседней стоянки
 * (в движении). Не дублируют события стоянок: интервалы с уже найденным
 * событием не повторяются.
 */
export function eventsFromGaps(
  gains: GainInterval[],
  existing: TripEventRow[],
  params: CheckParams,
  techEvents: TechEvent[],
): TripEventRow[] {
  const out: TripEventRow[] = [];
  for (const g of gains) {
    if (!g.gapInside || g.deltaKm == null || g.deltaKm < params.gapRiseKm) continue;
    const iv = { fromMs: g.fromMs, toMs: g.toMs };
    if (existing.some((e) => e.riseInterval && overlaps(e.riseInterval, iv))) continue;
    const nearTech = techEvents.find((t) => Math.abs(t.atMs - g.fromMs) <= 12 * 3_600_000) || null;
    out.push({
      id: `evg:${g.fromMs}:${g.toMs}`,
      kind: 'gap_rise',
      severity: 'check',
      title: 'Прирост через разрыв — требуется проверка',
      stopId: g.stopId,
      interval: iv,
      deltaKm: g.deltaKm,
      riseInterval: iv,
      riseKm: g.deltaKm,
      rule: 'Увеличение показаний видно между измерениями, но между ними был период без данных: момент и обстоятельства изменения неизвестны.',
      explanation: [
        `${fmtKm(g.deltaKm)} между ${fmtDMYHM(g.fromMs)} и ${fmtDMYHM(g.toMs)} (${fmtDuration(g.toMs - g.fromMs)}).`,
        'Событие НЕ называется «скачком на стоянке»: период без данных не подтверждает момент изменения.',
      ],
      techNearby: nearTech,
    });
  }
  return out;
}

/** События в движении: темп прироста между измерениями выше предельного. */
export function eventsFromMotion(
  gains: GainInterval[],
  samples: MeasureSample[],
  params: CheckParams,
  techEvents: TechEvent[],
  existing: TripEventRow[] = [],
): TripEventRow[] {
  const out: TripEventRow[] = [];
  const byMs = new Map(samples.map((s) => [s.atMs, s]));
  for (const g of gains) {
    if (g.invalid || g.gapInside || g.deltaKm == null || g.deltaKm < params.resumeMinDeltaKm) continue;
    if (g.kind === 'stop_rise' || g.kind === 'resume' || g.kind === 'reset') continue;
    if (g.rateKmh == null || g.rateKmh <= params.moveMaxKmh) continue;
    const iv = { fromMs: g.fromMs, toMs: g.toMs };
    // Тот же интервал уже описан событием стоянки/разрыва — не дублируем.
    if (existing.some((e) => e.riseInterval && overlaps(e.riseInterval, iv))) continue;
    const from = byMs.get(g.fromMs);
    const to = byMs.get(g.toMs);
    if (!from || !to) continue;
    const nearTech = techEvents.find((t) => Math.abs(t.atMs - g.fromMs) <= 3_600_000) || null;
    out.push({
      id: `evm:${g.fromMs}:${g.toMs}`,
      kind: 'move_rate',
      severity: 'check',
      title: 'Несоответствие темпа прироста в движении',
      stopId: g.stopId,
      interval: { fromMs: g.fromMs, toMs: g.toMs },
      deltaKm: g.deltaKm,
      riseInterval: { fromMs: g.fromMs, toMs: g.toMs },
      riseKm: g.deltaKm,
      rule: `Темп прироста одометра ${fmtNum(g.rateKmh)} км/ч выше разумного предела (${params.moveMaxKmh} км/ч) при длительности интервала ${fmtDuration(g.toMs - g.fromMs)}.`,
      explanation: [
        `${fmtKm(g.deltaKm)} между ${fmtDMYHM(g.fromMs)} и ${fmtDMYHM(g.toMs)} (${fmtDuration(g.toMs - g.fromMs)}).`,
        'Интервал между измерениями не содержит разрывов данных — прирост наблюдаем.',
      ],
      techNearby: nearTech,
    });
  }
  return out;
}

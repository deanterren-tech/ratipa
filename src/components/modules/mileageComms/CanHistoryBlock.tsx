/**
 * Блок «История CAN-пробега» в карточке автомобиля (уточнённая спецификация).
 *
 * Одна и та же постоянная история измерений по машине в трёх режимах:
 * день / рейс / произвольный период. Два синхронизированных графика:
 *  - CanLineChart — абсолютное показание либо «прирост от начала периода»;
 *  - GainChart — приросты между измерениями (длительность интервала, сбросы,
 *    разрывы, связь со стоянкой) — переиспользуется из графиков рейса.
 *
 * Честность данных:
 *  - снимки портала (время измерения в API отсутствует) помечаются явно;
 *  - отрицательные изменения/сбросы не скрываются;
 *  - интервалы через разрыв не сглаживаются;
 *  - четыре состояния синхронизации различаются, покрытие дня и частота
 *    измерений показываются фактическими;
 *  - догрузка выполняется сервером (исторические методы Nav.by) и
 *    пересчитывает график; поздние измерения встают на своё место.
 *
 * Производительность: грузится ТОЛЬКО выбранная машина и её окно; long-period
 * рисуется прореживанием (мин/макс/сбросы сохраняются), при приближении —
 * исходные измерения.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CalendarDays, Gauge, Info, RefreshCw, Route } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { SectionHeader, StatusText } from '../../../ui/components';
import { mcService } from './mcService';
import type { McConfig, McCurrent, McMapping } from './mcTypes';
import { resolveTripWindow, factDaysOfStages, type TripCandidate } from './engine/binding';
import { fmtDMY, fmtDMYHM, fmtDuration, fmtKm, fmtNum } from './engine/format';
import type { CheckParams } from './engine/params';
import type { MeasureSample, Stop } from './engine/types';
import { pickStops } from './engine/stops';
import {
  CAN_SOURCE_LABEL, CAN_SOURCE_SHORT, buildCanGains, canDayKey, canSeriesStats, classifyCanSync,
  dayBoundsFromKey, decimateCanPoints, detectCanGaps, mergeCanPoints,
  snapshotPointsFromSamples, type CanPoint,
} from './engine/canSeries';
import CanLineChart from './charts/CanLineChart';
import GainChart from './charts/GainChart';

interface Props {
  carKey: string;
  plate: string;
  mapping: McMapping | null;
  trips: TripCandidate[];
  /** Состояние этапов таймлайна (для фактических дат рейса) — стабильная ссылка. */
  stagesStore: Record<string, Record<string, unknown>>;
  nowMs: number;
  params: CheckParams;
  current: McCurrent | undefined;
  config: McConfig;
}

type Mode = 'day' | 'trip' | 'period';
type ViewMode = 'abs' | 'gain';

const parseLocalInput = (v: string): number | null => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};
const fmtLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
const keyToDateInput = (key: string): string => `${key.slice(0, 4)}-${key.slice(4, 6)}-${key.slice(6, 8)}`;
const dateInputToKey = (v: string): string | null => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v.replace(/-/g, '') : null);

export default function CanHistoryBlock(props: Props) {
  const { carKey, plate, mapping, trips, stagesStore, nowMs, params, current, config } = props;

  const [mode, setMode] = useState<Mode>('day');
  const [dayKey, setDayKey] = useState<string>(() => canDayKey(nowMs));
  const [tripKey, setTripKey] = useState<string>(() => trips[0]?.key || '');
  const [periodFrom, setPeriodFrom] = useState<string>(() => fmtLocalInput(nowMs - 7 * 86_400_000));
  const [periodTo, setPeriodTo] = useState<string>(() => fmtLocalInput(nowMs));
  const [view, setView] = useState<ViewMode>('abs');
  const [zoom, setZoom] = useState<{ fromMs: number; toMs: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillNote, setBackfillNote] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const [points, setPoints] = useState<CanPoint[]>([]);
  const [samples, setSamples] = useState<MeasureSample[]>([]);
  const [coverage, setCoverage] = useState<Record<string, Record<string, unknown>>>({});
  const [stops, setStops] = useState<Stop[]>([]);
  const [reportReason, setReportReason] = useState<string | null>(null);
  const [collectState, setCollectState] = useState<Record<string, unknown> | null>(null);
  const loadSeq = useRef(0);
  const autoBackfillTried = useRef<Set<string>>(new Set());

  useEffect(() => mcService.subscribeCanCollectState(setCollectState), []);

  const selectedTrip: TripCandidate | null = useMemo(
    () => trips.find((t) => t.key === tripKey) || trips[0] || null,
    [trips, tripKey],
  );

  // Фактические дни рейса — из состояния этапов; функция стабильна, пока
  // не изменился stagesStore (стабильная ссылка из подписки таймлайна).
  const factDaysFor = useCallback((tripId: string) => factDaysOfStages(stagesStore, tripId), [stagesStore]);

  // Сигнатура списка рейсов — примитив для зависимостей (сам массив
  // пересоздаётся при каждом рендере родителя, идентичность нестабильна).
  const tripsSig = useMemo(() => trips.map((t) => `${t.key}:${t.dateStart}:${t.dateEnd}`).join('|'), [trips]);

  const window = useMemo(() => {
    if (mode === 'day') {
      const b = dayBoundsFromKey(dayKey);
      return b ? { fromMs: b.fromMs, toMs: b.toMs, label: `День ${fmtDMY(b.fromMs)}`, note: null as string | null } : null;
    }
    if (mode === 'trip') {
      const trip = trips.find((t) => t.key === tripKey) || trips[0];
      if (!trip) return null;
      const res = resolveTripWindow({ candidate: trip, carKey, factDays: factDaysFor(trip.id), override: null, nowMs });
      if (!res.window) return { fromMs: 0, toMs: 0, label: 'Рейс', note: res.needClarification || 'Не удалось определить границы рейса' };
      return { fromMs: res.window.fromMs, toMs: res.window.toMs, label: `Рейс ${fmtDMY(res.window.fromMs)} → ${res.window.ongoing ? 'сейчас' : fmtDMY(res.window.toMs)}`, note: res.window.sourceLabel };
    }
    const f = parseLocalInput(periodFrom);
    const t = parseLocalInput(periodTo);
    if (f == null || t == null || t <= f) return { fromMs: 0, toMs: 0, label: 'Период', note: 'Укажите корректные границы периода' };
    return { fromMs: f, toMs: t, label: `Период ${fmtDMYHM(f)} → ${fmtDMYHM(t)}`, note: null as string | null };
    // Достаточно примитивных зависимостей: пересборка массивов/объектов
    // родителем (штормы перерисовок) окно не меняет и запросы не шлёт.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dayKey, tripKey, tripsSig, factDaysFor, carKey, nowMs, periodFrom, periodTo]);

  const winFrom = window?.fromMs ?? 0;
  const winTo = window?.toMs ?? 0;
  const winRef = useRef(window);
  winRef.current = window;
  const mappingId = mapping?.navbyObjectId || '';
  const windowKey = window ? `${winFrom}|${winTo}` : 'none';

  useEffect(() => {
    setZoom(null);
    setBackfillNote(null);
  }, [windowKey, mode]);

  const load = useCallback(async (): Promise<void> => {
    const win = winRef.current;
    if (!win || win.toMs <= win.fromMs || !mappingId) return;
    const seq = ++loadSeq.current;
    setLoading(true);
    const fromPad = win.fromMs - 12 * 3_600_000;
    const toPad = win.toMs + 12 * 3_600_000;
    const [pts, hist, cov, rep] = await Promise.all([
      mcService.readCanHistoryRange(carKey, fromPad, toPad),
      mcService.readHistoryRange(carKey, fromPad, toPad),
      mcService.readCanCoverage(carKey),
      mcService.fetchParkingReport(carKey, win.fromMs, win.toMs),
    ]);
    if (seq !== loadSeq.current) return;
    setPoints(pts);
    setSamples(hist);
    setCoverage(cov);
    setReportReason(rep.ok ? null : (rep.reason || 'отчёт недоступен'));
    const stopsRes = pickStops({
      reportAvailable: rep.ok,
      reportReason: rep.reason || null,
      intervals: rep.intervals || [],
      samples: hist,
      fromMs: win.fromMs,
      toMs: win.toMs,
      params,
    });
    setStops(stopsRes.stops);

    // Автодогрузка: за период нет НИ одного измерения (в самом окне, не в
    // запасных ±12 ч!) и покрытия нет — один раз на окно просим сервер
    // загрузить историю (исторические методы). Запасные точки соседних дней
    // НЕ считаются данными периода (иначе день выглядел бы «пусто без причин»).
    const dayKeys = new Set<string>();
    for (let t = win.fromMs; t <= win.toMs; t += 12 * 3_600_000) dayKeys.add(canDayKey(Math.min(t, win.toMs)));
    const covDays = [...dayKeys].filter((k) => cov[k]);
    const spanDays = (win.toMs - win.fromMs) / 86_400_000;
    const winKeyLocal = `${win.fromMs}|${win.toMs}`;
    const ptsInWin = pts.filter((p) => p.xMs >= win.fromMs && p.xMs <= win.toMs);
    if (
      ptsInWin.length === 0
      && covDays.length === 0
      && spanDays <= 40
      && !autoBackfillTried.current.has(winKeyLocal)
    ) {
      autoBackfillTried.current.add(winKeyLocal);
      setBackfilling(true);
      setBackfillNote('История за период не загружена — запрашиваем у источника…');
      const bf = await mcService.fetchCanBackfill(carKey, win.fromMs, win.toMs);
      if (seq !== loadSeq.current) return;
      setBackfilling(false);
      setBackfillNote(bf.ok
        ? `Догружено: сегменты ${bf.segPoints ?? 0}, оконные измерения ${bf.statPoints ?? 0} (новых ${bf.written ?? 0}, повторных ${bf.duplicates ?? 0}).`
        : `Догрузка не удалась: ${bf.reason}`);
      if (bf.ok) setReloadTick((x) => x + 1);
    }
    setLoading(false);
  }, [carKey, mappingId, params, winFrom, winTo]);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  /* ── Производные данные ── */
  const mergedAll = useMemo(() => mergeCanPoints([...points, ...snapshotPointsFromSamples(samples)]), [points, samples]);

  const merged = useMemo(() => {
    if (!window) return [];
    return mergedAll.filter((p) => p.xMs >= window.fromMs && p.xMs <= window.toMs);
  }, [mergedAll, window]);

  const stats = useMemo(() => canSeriesStats(merged), [merged]);

  const stopsById = useMemo(() => {
    const m = new Map<string, Stop>();
    for (const s of stops) m.set(s.id, s);
    return m;
  }, [stops]);

  const gains = useMemo(() => {
    if (!window) return [];
    return buildCanGains(mergedAll, window.fromMs, window.toMs, params, stopsById);
  }, [mergedAll, window, params, stopsById]);

  const gaps = useMemo(() => (window ? detectCanGaps(merged, window.fromMs, window.toMs, params.dataGapMin) : []), [merged, window, params.dataGapMin]);

  const carHasOdometer = useMemo(() => {
    if (current) return current.odoPresent ?? (current.odoKm != null && current.odoKm > 0);
    if (mergedAll.some((p) => p.valueKm > 0)) return true;
    if (stats.count === 0 && Object.keys(coverage).length === 0) return null;
    return null;
  }, [current, mergedAll, stats.count, coverage]);

  const sync = useMemo(() => {
    if (!window) return null;
    const dayKeys = new Set<string>();
    for (let t = window.fromMs; t <= window.toMs; t += 12 * 3_600_000) dayKeys.add(canDayKey(Math.min(t, window.toMs)));
    // Покрытие считается по дням окна: запись съёма ИЛИ сохранённые измерения
    // именно этого окна (запасные точки соседних дней не считаются).
    const storedInWindow = points.some((p) => p.xMs >= window.fromMs && p.xMs <= window.toMs);
    const hasCoverage = [...dayKeys].some((k) => coverage[k]) || storedInWindow;
    return classifyCanSync({
      points: merged,
      carHasOdometer,
      hasCoverage,
      window,
      nowMs,
      snapshotIntervalMs: Math.max(60_000, (config.intervalSec || 300) * 1000),
    });
  }, [window, merged, carHasOdometer, coverage, points, nowMs, config.intervalSec]);

  /* ── Зум и диапазон графиков ── */
  const range = zoom ?? (window ? { fromMs: window.fromMs, toMs: window.toMs } : { fromMs: 0, toMs: 0 });
  const rangeSpanMs = Math.max(1, range.toMs - range.fromMs);
  const isZoomed = Boolean(zoom);

  const chartPoints = useMemo(() => {
    const inRange = merged.filter((p) => p.xMs >= range.fromMs && p.xMs <= range.toMs);
    // Агрегация только для длинных периодов; при приближении — исходные измерения.
    if (rangeSpanMs <= 3 * 86_400_000 || inRange.length <= params.maxChartPoints) return inRange;
    return decimateCanPoints(inRange, params.maxChartPoints);
  }, [merged, range, rangeSpanMs, params.maxChartPoints]);

  const relBase = useMemo(() => {
    if (view !== 'gain') return null;
    const first = merged.find((p) => p.xMs >= window!.fromMs);
    return first ? first.valueKm : null;
  }, [view, merged, window]);

  const anchorMs = stats.lastMs ?? (window ? window.toMs : nowMs);
  const applyPreset = (spanMs: number) => {
    if (!window) return;
    const toMs = Math.min(window.toMs, Math.max(anchorMs, window.fromMs + spanMs));
    setZoom({ fromMs: Math.max(window.fromMs, toMs - spanMs), toMs });
  };

  const zoomToInterval = (a: number, b: number) => {
    if (!window) return;
    const pad = Math.max(5 * 60_000, (b - a) * 0.15);
    setZoom({ fromMs: Math.max(window.fromMs, a - pad), toMs: Math.min(window.toMs, b + pad) });
  };

  /* ── Подсказка точки ── */
  const tooltipOf = useCallback((p: CanPoint, prev: CanPoint | null): string => {
    const lines: string[] = [];
    if (p.tMs != null) lines.push(`время измерения: ${fmtDMYHM(p.tMs)}`);
    else if (p.coordAtMs != null) lines.push(`время измерения неизвестно (в API нет); время координаты снимка: ${fmtDMYHM(p.coordAtMs)}`);
    else lines.push('время измерения неизвестно');
    lines.push(`показание: ${fmtKm(p.valueKm, p.precision === 'km_int' ? 0 : 3)}`);
    if (prev) {
      const delta = p.valueKm - prev.valueKm;
      lines.push(`предыдущее: ${fmtKm(prev.valueKm, prev.precision === 'km_int' ? 0 : 3)} (${prev.tMs != null ? fmtDMYHM(prev.tMs) : 'снимок'})`);
      lines.push(`прирост: ${delta >= 0 ? '+' : ''}${fmtNum(delta, 2)} км${delta < -0.5 ? ' — СБРОС/уменьшение счётчика' : delta < -0.02 ? ' (уменьшение)' : ''}`);
      lines.push(`время между измерениями: ${fmtDuration(p.xMs - prev.xMs)}`);
    }
    const srcLabels = (p.mergedSources || [p.source]).map((s) => CAN_SOURCE_LABEL[s]);
    lines.push(`источник: ${srcLabels.join(' + ')}${p.precision === 'km_int' ? ' (округление источника до км)' : ''}`);
    if (p.kind === 'snapshot') lines.push('это снимок портала, а не измерение трекера — время измерения в API отсутствует');
    if (p.revised) lines.push('значение уточнялось источником при повторной выгрузке');
    if (p.receivedAtMs != null) lines.push(`получено порталом: ${fmtDMYHM(p.receivedAtMs)}`);
    return lines.join('\n');
  }, []);

  /* ── Дни окна (для чипов и разделителей) ── */
  const dayList = useMemo(() => {
    if (!window) return [];
    const keys: string[] = [];
    for (let t = window.fromMs; t <= window.toMs; t += 12 * 3_600_000) {
      const k = canDayKey(Math.min(t, window.toMs));
      if (!keys.includes(k)) keys.push(k);
    }
    return keys.map((k) => {
      const b = dayBoundsFromKey(k)!;
      const dayPts = merged.filter((p) => p.xMs >= b.fromMs && p.xMs <= b.toMs);
      const st = canSeriesStats(dayPts);
      return { key: k, fromMs: b.fromMs, count: dayPts.length, measured: st.measuredCount, firstMs: st.firstMs, lastMs: st.lastMs, coverage: coverage[k] };
    });
  }, [window, merged, coverage]);

  const suspicious = useMemo(() => {
    const items = gains.filter((g) =>
      g.kind === 'reset'
      || (g.kind === 'gap' && Math.abs(g.deltaKm ?? 0) >= params.gapRiseKm)
      || g.kind === 'stop_rise'
      || (g.kind === 'resume' && (g.deltaKm ?? 0) >= params.resumeMinDeltaKm),
    );
    return items.sort((a, b) => a.fromMs - b.fromMs);
  }, [gains, params]);

  const collect = collectState as {
    lastRunAt?: string; lastSweepAtMs?: number; lastBackfillAtMs?: number; mode?: string;
    sweepStat?: { windows?: number; cars?: number; points?: number };
  } | null;

  const snapshotCadenceMin = Math.round((config.intervalSec || 300) / 60);

  return (
    <div className={`${UI.bar} !rounded-xl flex flex-col gap-3`} data-testid="mc-can-history-block">
      <SectionHeader
        icon={<Gauge className="w-4 h-4" />}
        tone="graphite"
        title={`История CAN-пробега — ${plate}`}
        subtitle="Постоянные измерения одометра по выбранной машине: из исторических методов Nav.by (реальные времена) и снимков портала."
      />

      {/* Управление: режим, дата/рейс/период, вид */}
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <div className="inline-flex rounded-lg border border-[#E5E7EB] overflow-hidden" role="tablist" aria-label="Режим периода">
          {([['day', 'День'], ['trip', 'Рейс'], ['period', 'Период']] as Array<[Mode, string]>).map(([m, label]) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              className={`px-3 py-1.5 font-medium ${mode === m ? 'bg-[#121316] text-white' : 'bg-white text-[#4B5563] hover:bg-[#F9FAFB]'}`}
              onClick={() => setMode(m)}
              data-testid={`mc-can-mode-${m}`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'day' && (
          <label className="inline-flex items-center gap-1.5">
            <CalendarDays className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" />
            <input
              type="date"
              className={UI.input + ' !py-1 !min-h-0 text-[11px]'}
              value={keyToDateInput(dayKey)}
              max={keyToDateInput(canDayKey(nowMs))}
              onChange={(e) => { const k = dateInputToKey(e.target.value); if (k) setDayKey(k); }}
              data-testid="mc-can-day-input"
            />
            <button type="button" className={UI.buttonLink} onClick={() => setDayKey(canDayKey(nowMs))}>Сегодня</button>
          </label>
        )}

        {mode === 'trip' && (
          <span className="inline-flex items-center gap-1.5">
            <Route className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" />
            {trips.length === 0 ? (
              <span className="text-[#9CA3AF]">у машины нет рейсов в «Плане дохода»</span>
            ) : (
              <select className={UI.select + ' !min-h-0 !py-1 text-[11px] max-w-[300px]'} value={selectedTrip?.key || ''} onChange={(e) => setTripKey(e.target.value)} data-testid="mc-can-trip-select">
                {trips.map((t) => (
                  <option key={t.key} value={t.key}>{t.dateStart || '—'} → {t.dateEnd || '—'}{t.direction ? ` · ${t.direction.slice(0, 24)}` : ''}</option>
                ))}
              </select>
            )}
          </span>
        )}

        {mode === 'period' && (
          <span className="inline-flex items-center gap-1.5">
            <input type="datetime-local" className={UI.input + ' !py-1 !min-h-0 text-[11px]'} value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} data-testid="mc-can-period-from" />
            <span className="text-[#9CA3AF]">→</span>
            <input type="datetime-local" className={UI.input + ' !py-1 !min-h-0 text-[11px]'} value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} data-testid="mc-can-period-to" />
          </span>
        )}

        <div className="inline-flex rounded-lg border border-[#E5E7EB] overflow-hidden ml-auto" role="tablist" aria-label="Вид показаний">
          {([['abs', 'Абсолютное показание'], ['gain', 'Прирост от начала']] as Array<[ViewMode, string]>).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              className={`px-3 py-1.5 font-medium ${view === v ? 'bg-[#121316] text-white' : 'bg-white text-[#4B5563] hover:bg-[#F9FAFB]'}`}
              onClick={() => setView(v)}
              data-testid={`mc-can-view-${v}`}
            >
              {label}
            </button>
          ))}
        </div>

        <button type="button" className={UI.buttonGhost + ' !py-1 !min-h-0 text-[11px] inline-flex items-center gap-1'} onClick={() => setReloadTick((x) => x + 1)} data-testid="mc-can-refresh">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Обновить
        </button>
        <button
          type="button"
          className={UI.buttonGhost + ' !py-1 !min-h-0 text-[11px]'}
          disabled={backfilling || !window || window.toMs <= window.fromMs}
          onClick={async () => {
            if (!window) return;
            setBackfilling(true);
            setBackfillNote('Догружаем историю за период…');
            const bf = await mcService.fetchCanBackfill(carKey, window.fromMs, window.toMs);
            setBackfilling(false);
            setBackfillNote(bf.ok
              ? `Догружено: сегменты ${bf.segPoints ?? 0}, оконные измерения ${bf.statPoints ?? 0} (новых ${bf.written ?? 0}, повторных ${bf.duplicates ?? 0}).`
              : `Догрузка не удалась: ${bf.reason}`);
            if (bf.ok) setReloadTick((x) => x + 1);
          }}
          data-testid="mc-can-backfill"
        >
          {backfilling ? 'Догрузка…' : 'Догрузить историю за период'}
        </button>
      </div>

      {(backfillNote || window?.note) && (
        <div className="text-[10.5px] text-[#6B7280] leading-relaxed">
          {backfillNote && <span>{backfillNote} </span>}
          {window?.note && <span>{window.note}.</span>}
        </div>
      )}

      {!mapping?.navbyObjectId ? (
        <div className="text-[11px] text-[#6B7280]">Машина не сопоставлена с объектом Nav.by — история недоступна.</div>
      ) : !window || window.toMs <= window.fromMs ? (
        <div className="text-[11px] text-[#6B7280]">{window?.note || 'Период не задан.'}</div>
      ) : (
        <>
          {/* Состояние синхронизации и полнота */}
          <div className="flex flex-wrap items-center gap-2 text-[10.5px] text-[#4B5563]">
            {sync && (
              <span data-testid="mc-can-sync-state" className="inline-flex items-center gap-1.5">
                <StatusText color={sync.state === 'ok' ? 'emerald' : sync.state === 'no_change_fresh' ? 'blue' : sync.state === 'no_new_measurements' ? 'amber' : 'grey'}>
                  {sync.label}
                </StatusText>
              </span>
            )}
            <span>измерений с подтверждённым временем: <b>{stats.measuredCount}</b>; снимков: <b>{stats.snapshotCount}</b></span>
            {stats.medianIntervalMs != null && <span>медианный интервал: <b>{fmtDuration(stats.medianIntervalMs)}</b></span>}
            <span>снимки портала — каждые ~{snapshotCadenceMin} мин{collect?.lastSweepAtMs ? `; последний оконный съём: ${fmtDMYHM(collect.lastSweepAtMs)}` : ''}{collect?.lastBackfillAtMs ? `; сегменты: ${fmtDMYHM(collect.lastBackfillAtMs)}` : ''}</span>
            {stats.resets > 0 && <span className="text-rose-700 font-medium">сбросов/уменьшений: {stats.resets}</span>}
          </div>
          <div className="text-[10px] text-[#6B7280] leading-relaxed">{sync?.hint}</div>

          {/* Зум-пресеты */}
          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]">
            <span className="text-[#9CA3AF]">Масштаб:</span>
            <button type="button" className={UI.buttonLink} onClick={() => setZoom(null)} data-testid="mc-can-zoom-reset">Весь период</button>
            <button type="button" className={UI.buttonLink} onClick={() => applyPreset(6 * 3_600_000)} data-testid="mc-can-preset-6h">Последние 6 ч</button>
            <button type="button" className={UI.buttonLink} onClick={() => applyPreset(3_600_000)} data-testid="mc-can-preset-1h">Последний час</button>
            <button type="button" className={UI.buttonLink} onClick={() => applyPreset(15 * 60_000)} data-testid="mc-can-preset-15m">15 минут</button>
            {isZoomed && <span className="text-[#6B7280]">показано: {fmtDMYHM(range.fromMs)} → {fmtDMYHM(range.toMs)}{chartPoints.length < merged.filter((p) => p.xMs >= range.fromMs && p.xMs <= range.toMs).length ? ' (прорежено)' : ''}</span>}
            {isZoomed && rangeSpanMs > 3 * 86_400_000 && <span className="text-[#6B7280]">длинный период — отображение агрегировано (мин/макс/сбросы сохранены); приблизьте для исходных измерений</span>}
          </div>

          {/* Дни рейса/периода: переход к конкретному дню */}
          {(mode === 'trip' || mode === 'period') && dayList.length > 1 && (
            <div className="flex flex-wrap gap-1.5 text-[10.5px]">
              {dayList.map((d) => (
                <button
                  key={d.key}
                  type="button"
                  className={`px-2 py-1 rounded-md border ${d.count ? 'border-[#E5E7EB] bg-white hover:bg-[#F9FAFB]' : 'border-dashed border-[#E5E7EB] text-[#9CA3AF]'}`}
                  title={`${fmtDMY(d.fromMs)}: измерений ${d.count}${d.firstMs ? `, с ${fmtDMYHM(d.firstMs)} по ${fmtDMYHM(d.lastMs)}` : ''}`}
                  onClick={() => { setMode('day'); setDayKey(d.key); }}
                  data-testid={`mc-can-day-chip-${d.key}`}
                >
                  {fmtDMY(d.fromMs).slice(0, 5)} <span className="text-[#9CA3AF]">({d.count})</span>
                </button>
              ))}
            </div>
          )}

          {loading ? (
            <div className="text-[11px] text-[#6B7280] py-6 text-center">Загружаем историю измерений выбранной машины…</div>
          ) : (
            <>
              <CanLineChart
                window={window}
                range={range}
                points={chartPoints}
                mode={view}
                baseKm={relBase}
                gapMs={params.dataGapMin * 60_000}
                gaps={gaps}
                stops={stops}
                dayMarks={dayList.filter((d) => d.fromMs > window.fromMs).map((d) => d.fromMs)}
                tooltipOf={tooltipOf}
                onBrush={(a, b) => zoomToInterval(a, b)}
                onResetZoom={() => setZoom(null)}
              />

              <div className="mt-1">
                <div className="text-[11px] font-semibold text-[#121316] mb-1">Приросты между измерениями (синхронизировано с графиком выше)</div>
                <GainChart
                  range={range}
                  gains={gains}
                  stops={stops}
                  selectedStopId={null}
                  onSelectGain={(g) => zoomToInterval(g.fromMs, g.toMs)}
                  maxBars={220}
                />
              </div>

              {/* Полнота периода: первое/последнее, количество, разрывы, покрытие */}
              <details className="text-[10.5px] text-[#4B5563]">
                <summary className="cursor-pointer select-none text-[#121316] font-medium">Полнота истории и покрытие источника</summary>
                <div className="mt-1.5 grid gap-1.5">
                  <div className="grid grid-cols-[minmax(90px,auto)_1fr] gap-x-2 gap-y-1">
                    <span className="text-[#9CA3AF]">Измерения периода</span>
                    <span>
                      {stats.count
                        ? `первое: ${stats.firstMs ? fmtDMYHM(stats.firstMs) : '—'} · последнее: ${stats.lastMs ? fmtDMYHM(stats.lastMs) : '—'} · всего: ${stats.count}`
                        : 'измерений нет'}
                    </span>
                    <span className="text-[#9CA3AF]">Разрывы (&gt;{params.dataGapMin} мин)</span>
                    <span>
                      {gaps.length === 0 ? 'нет' : gaps.slice(0, 6).map((g) => `${fmtDMYHM(g.fromMs)} → ${fmtDMYHM(g.toMs)} (${fmtDuration(g.toMs - g.fromMs)})`).join('; ') + (gaps.length > 6 ? ` … всего ${gaps.length}` : '')}
                    </span>
                    <span className="text-[#9CA3AF]">Источники периода</span>
                    <span>
                      {Object.entries(stats.bySource).map(([s, n]) => `${CAN_SOURCE_SHORT[s as CanPoint['source']]}: ${n}`).join(' · ') || '—'}
                    </span>
                    <span className="text-[#9CA3AF]">Стоянки</span>
                    <span>{stops.length ? `${stops.length} (отчёт Nav.by${reportReason ? `: ${reportReason}` : ''})` : reportReason ? `отчёт недоступен (${reportReason})` : 'нет'}</span>
                    <span className="text-[#9CA3AF]">Ограничения источника</span>
                    <span>
                      Nav.by отдаёт измерения одометра на границах окон отчётов и сегментов, а не каждое сообщение трекера; при простое машины измерений нет
                      (это не «ноль км»); у снимков портала нет времени измерения в API; подсегментные изменения между измерениями источник не показывает.
                    </span>
                  </div>
                  {dayList.length > 0 && (
                    <div className="mt-1">
                      <div className="text-[#9CA3AF] mb-1">По дням:</div>
                      <div className="grid gap-0.5">
                        {dayList.map((d) => {
                          const cov = d.coverage as Record<string, { ok?: boolean; pts?: number }> | undefined;
                          const covBits: string[] = [];
                          if (cov?.sw) covBits.push(`окна: ${cov.sw.ok ? `✓ ${cov.sw.pts ?? 0}` : 'ошибка'}`);
                          if (cov?.cs) covBits.push(`сегменты: ${cov.cs.ok ? `✓ ${cov.cs.pts ?? 0}` : 'ошибка'}`);
                          if (cov?.ps) covBits.push(`стоянки-отчёт: ${cov.ps.ok ? `✓ ${cov.ps.pts ?? 0}` : 'ошибка'}`);
                          return (
                            <div key={d.key} className="flex flex-wrap gap-x-2">
                              <span className="w-[86px] shrink-0">{fmtDMY(d.fromMs)}</span>
                              <span>
                                измерений: {d.count} (подтв. {d.measured})
                                {d.count ? `, ${fmtDMYHM(d.firstMs)} → ${fmtDMYHM(d.lastMs)}` : ''}
                                {covBits.length ? ` · ${covBits.join(' · ')}` : ' · съём ещё не выполнялся — «Догрузить историю»'}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              </details>

              {/* Подозрительные интервалы */}
              {suspicious.length > 0 && (
                <div className="text-[10.5px]">
                  <div className="font-semibold text-[#121316] mb-1 flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                    Требует внимания ({suspicious.length}) — приросты и сбросы
                  </div>
                  <div className="grid gap-1">
                    {suspicious.slice(0, 12).map((g, i) => (
                      <div key={`${g.fromMs}:${i}`} className="flex flex-wrap items-center gap-2">
                        <span className={g.kind === 'reset' ? 'text-rose-700 font-medium' : g.kind === 'stop_rise' ? 'text-rose-700' : g.kind === 'gap' ? 'text-[#6B7280]' : 'text-amber-700'}>
                          {g.kind === 'reset' ? 'уменьшение/сброс счётчика' : g.kind === 'stop_rise' ? 'прирост в течение стоянки' : g.kind === 'gap' ? 'прирост через разрыв данных (момент неизвестен)' : 'прирост при возобновлении'}
                        </span>
                        <span>{fmtDMYHM(g.fromMs)} → {fmtDMYHM(g.toMs)}</span>
                        <span>{g.deltaKm != null ? `${g.deltaKm >= 0 ? '+' : ''}${fmtNum(g.deltaKm, 2)} км` : '—'}</span>
                        <span className="text-[#9CA3AF]">за {fmtDuration(g.toMs - g.fromMs)}</span>
                        <button type="button" className={UI.buttonLink} onClick={() => zoomToInterval(g.fromMs, g.toMs)} data-testid={`mc-can-zoom-${i}`}>приблизить</button>
                      </div>
                    ))}
                    {suspicious.length > 12 && <div className="text-[#9CA3AF]">… и ещё {suspicious.length - 12}</div>}
                  </div>
                  <div className="text-[10px] text-[#9CA3AF] mt-1">
                    Уменьшение показания и разрывы не скрываются. Если между измерениями данных не было, прирост не приписывается стоянке — это «прирост через разрыв».
                  </div>
                </div>
              )}

              <div className="text-[10px] text-[#9CA3AF] flex items-start gap-1.5">
                <Info className="w-3 h-3 shrink-0 mt-px" aria-hidden="true" />
                Поздние (догруженные) измерения автоматически встают на своё место и пересчитывают графики; обновите после «Догрузить историю», если данные ещё поступали.
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

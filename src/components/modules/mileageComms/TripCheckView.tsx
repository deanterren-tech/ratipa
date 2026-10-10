/**
 * Подробный анализ рейса (вкладка «Проверка пробега»):
 * границы с источником, сводка, главный график накопленного пробега и
 * синхронный график приростов, таблица стоянок, разбор стоянки (измерения
 * до/во время/после, основания, ограничения), события, журнал проверки,
 * техотметки, комментарии и переход к обращению в поддержку.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronUp, Clock, FileText, Gauge, Info, ListFilter, MapPin, Settings2, Wrench } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { FilterPills, ModalShell, StatusText } from '../../../ui/components';
import type { UserProfile } from '../../../types';
import type { McCheckRecords } from './mcTypes';
import { MC_CHECK_PARAM_LABELS, type CheckParams } from './engine/params';
import { resolveTripWindow, type TripCandidate } from './engine/binding';
import { analyzeTrip } from './engine/compose';
import { fmtDMHM, fmtDMYHM, fmtDuration, fmtKm, fmtNum } from './engine/format';
import { gpsCompareLabel } from './engine/summary';
import type {
  BoundsOverride, MeasureSample, ParkingIntervalRaw, Stop, TripAnalysisResult, TripEventRow,
} from './engine/types';
import type { MappingHistoryLite } from './engine/tech';
import MileageChart from './charts/MileageChart';
import GainChart from './charts/GainChart';
import type { ChartPt } from './charts/chartUtils';
import { useToast } from '../../ToastProvider';
import { mcService } from './mcService';

export interface TripResultBrief {
  status: string;
  statusColor: 'emerald' | 'amber' | 'rose' | 'grey' | 'blue';
  stopsWithEvents: number;
  otherEvents: number;
  completeness: number | null;
  odoGainKm: number | null;
  /** Покрытие GPS-сравнения (доля времени), null — пригодных данных нет. */
  gpsCoveragePct: number | null;
}

interface Props {
  carKey: string;
  plate: string;
  candidate: TripCandidate;
  factDays: number[];
  override: BoundsOverride | null;
  nowMs: number;
  samples: MeasureSample[];
  report: { available: boolean; reason: string | null; fetchedAt: string | null; intervals: ParkingIntervalRaw[] | null };
  checkRecords: McCheckRecords;
  mappingHistory: MappingHistoryLite[];
  params: CheckParams;
  user: UserProfile;
  canEvents: boolean;
  canRules: boolean;
  loading: boolean;
  onReload: () => void;
  onCreateRequest: (problem: string) => void;
  onResultBrief?: (brief: TripResultBrief) => void;
}

const pad = (ms: number) => 20 * 60_000;

const fmtLocalInput = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const parseLocalInput = (v: string): number | null => {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
};

const SCENARIO_LABEL: Record<string, { label: string; color: 'rose' | 'amber' | 'emerald' | 'grey' }> = {
  A: { label: 'Рост на стоянке', color: 'rose' },
  B: { label: 'Изменение при возобновлении', color: 'amber' },
  C: { label: 'Прирост через разрыв — требуется проверка', color: 'rose' },
};

export default function TripCheckView(props: Props) {
  const {
    carKey, plate, candidate, factDays, override, nowMs, samples, report, checkRecords,
    mappingHistory, params, user, canEvents, canRules, loading, onReload, onCreateRequest, onResultBrief,
  } = props;
  const { toast } = useToast();

  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [zoom, setZoom] = useState<'trip' | 'stop' | 'event'>('trip');
  const [stopsFilter, setStopsFilter] = useState<'events' | 'all'>('events');
  const [eventsNearStopsOnly, setEventsNearStopsOnly] = useState(false);
  const [paramsOpen, setParamsOpen] = useState(false);
  const [paramsDraft, setParamsDraft] = useState<CheckParams>(params);
  const [journalOpen, setJournalOpen] = useState(false);
  const [boundsOpen, setBoundsOpen] = useState(false);
  const [techOpen, setTechOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => setParamsDraft(params), [params]);

  const windowRes = useMemo(
    () => resolveTripWindow({ candidate, carKey, factDays, override, nowMs }),
    [candidate, carKey, factDays, override, nowMs],
  );

  const resolvedEventIds = useMemo(() => Object.keys(checkRecords.resolved || {}), [checkRecords.resolved]);
  const techMarks = useMemo(() => Object.values(checkRecords.tech || {}), [checkRecords.tech]);
  const notes = useMemo(
    () => Object.entries(checkRecords.notes || {}).map(([id, n]) => ({ id, ...n })).sort((a, b) => b.atMs - a.atMs),
    [checkRecords.notes],
  );

  const analysis: TripAnalysisResult | null = useMemo(() => {
    if (!windowRes.window) return null;
    return analyzeTrip({
      window: windowRes.window,
      samples,
      reportIntervals: report.intervals,
      reportMeta: { available: report.available, reason: report.reason, fetchedAt: report.fetchedAt },
      mappingHistory,
      techMarks,
      resolvedEventIds,
      plan: {
        planKm: candidate.planKm,
        factKm: candidate.factKm,
        sourceLabel: '«План дохода» (totalKm — план; factKm — заявленный факт)',
      },
      params,
    });
  }, [windowRes.window, samples, report, mappingHistory, techMarks, resolvedEventIds, candidate.planKm, candidate.factKm, params]);

  // Колбэк результата — через ref, чтобы эффект не зависел от идентичности пропса
  // (иначе родительский setState зацикливает пересчёт «Maximum update depth»).
  const onResultBriefRef = useRef(onResultBrief);
  onResultBriefRef.current = onResultBrief;
  const lastBriefRef = useRef<string>('');
  useEffect(() => {
    if (!analysis) return;
    const s = analysis.summary;
    let status = 'Без выявленных расхождений на проверенных участках';
    let color: TripResultBrief['statusColor'] = 'emerald';
    if (s.dataCompletenessPct < 20 && s.stopsTotal === 0 && s.odoGainKm == null) {
      status = 'Недостаточно данных';
      color = 'rose';
    } else if (s.openChecks > 0) {
      status = `Требуется проверка (открытых событий: ${s.openChecks})`;
      color = 'rose';
    } else if (s.eventsOnStops + s.eventsInMotion > 0) {
      status = 'Есть отмеченные события (проверены)';
      color = 'amber';
    } else if (s.dataCompletenessPct < 60) {
      status = 'Недостаточно данных для полного вывода';
      color = 'amber';
    }
    const brief: TripResultBrief = {
      status,
      statusColor: color,
      stopsWithEvents: s.stopsWithEvents,
      otherEvents: s.eventsInMotion,
      completeness: s.dataCompletenessPct,
      odoGainKm: s.odoGainKm,
      gpsCoveragePct: s.gpsCoveragePct,
    };
    const fingerprint = JSON.stringify(brief);
    if (fingerprint === lastBriefRef.current) return;
    lastBriefRef.current = fingerprint;
    onResultBriefRef.current?.(brief);
  }, [analysis]);

  const selectedStop = analysis?.stops.find((s) => s.stop.id === selectedStopId) || null;
  const eventsSorted = analysis?.events || [];
  const selectedEvent = eventsSorted.find((e) => e.id === selectedEventId) || null;

  const range = useMemo(() => {
    if (!analysis) return { fromMs: nowMs - 86_400_000, toMs: nowMs };
    const w = analysis.window;
    if (zoom === 'stop' && selectedStop) {
      return { fromMs: Math.max(w.fromMs, selectedStop.stop.startMs - pad(0)), toMs: Math.min(w.toMs, selectedStop.stop.endMs + pad(0)) };
    }
    if (zoom === 'event' && selectedEvent) {
      const iv = selectedEvent.riseInterval || selectedEvent.interval;
      return { fromMs: Math.max(w.fromMs, iv.fromMs - pad(0) * 3), toMs: Math.min(w.toMs, iv.toMs + pad(0) * 3) };
    }
    return { fromMs: w.fromMs, toMs: w.toMs };
  }, [analysis, zoom, selectedStop, selectedEvent, nowMs]);

  /* ── Данные графиков: накопленный пробег по участкам (без склейки разрывов) ── */
  const chartPolylines = useMemo(() => {
    if (!analysis) return [];
    const w = analysis.window;
    const baseline = analysis.summary.baselineKm;
    const gapMs = params.dataGapMin * 60_000;
    const inWindow = samples.filter((s) => s.atMs >= w.fromMs && s.atMs <= w.toMs).sort((a, b) => a.atMs - b.atMs);
    const segIndexAt = (t: number): number => {
      const seg = analysis.segments.find((sg) => t >= sg.fromMs && t <= sg.toMs);
      return seg ? seg.index : -1;
    };
    const odoLines: Array<{ id: string; kind: 'odo'; label: string; points: ChartPt[] }> = [];
    let current: ChartPt[] = [];
    let prev: MeasureSample | null = null;
    let seg = -2;
    const flush = () => {
      if (current.length >= 2) odoLines.push({ id: `odo${odoLines.length}`, kind: 'odo', label: 'Прирост одометра (измеренные участки)', points: current });
      else if (current.length === 1) odoLines.push({ id: `odo${odoLines.length}`, kind: 'odo', label: 'Единичное измерение', points: current });
      current = [];
    };
    for (const s of inWindow) {
      if (s.odoKm == null || baseline == null) {
        flush();
        prev = s;
        continue;
      }
      const segOf = segIndexAt(s.atMs);
      if (prev && (s.atMs - prev.atMs > gapMs || segOf !== seg)) flush();
      seg = segOf;
      current.push({ atMs: s.atMs, km: s.odoKm - baseline, odoKm: s.odoKm });
      prev = s;
    }
    flush();

    // GPS-пробег: только пригодные пары; линии разрываются на разрывах и выбросах.
    const gpsLines: Array<{ id: string; kind: 'gps'; label: string; points: ChartPt[] }> = [];
    let gpsAcc = 0;
    let gpsCur: ChartPt[] = [];
    let gpsPrev: MeasureSample | null = null;
    const flushGps = () => {
      if (gpsCur.length >= 2) gpsLines.push({ id: `gps${gpsLines.length}`, kind: 'gps', label: 'Накопленный GPS-пробег (пригодные участки)', points: gpsCur });
      gpsCur = [];
    };
    for (const s of inWindow) {
      if (!s.posValid || s.lat == null || s.lon == null) {
        flushGps();
        gpsPrev = null;
        continue;
      }
      if (gpsPrev && gpsPrev.lat != null && gpsPrev.lon != null) {
        const dt = s.atMs - gpsPrev.atMs;
        if (dt > 0 && dt <= params.gpsMaxGapMin * 60_000) {
          const kmh = (gpsKm(s, gpsPrev) / (dt / 3_600_000));
          if (kmh <= params.gpsMaxSegmentKmh) {
            gpsAcc += gpsKm(s, gpsPrev);
            if (!gpsCur.length) gpsCur.push({ atMs: gpsPrev.atMs, km: gpsAcc });
            gpsCur.push({ atMs: s.atMs, km: gpsAcc });
          } else {
            flushGps();
          }
        } else {
          flushGps();
        }
      }
      gpsPrev = s;
    }
    flushGps();
    return [...odoLines, ...gpsLines];
  }, [analysis, samples, params.dataGapMin, params.gpsMaxGapMin, params.gpsMaxSegmentKmh]);

  if (!windowRes.window) {
    return (
      <div className={`${UI.bar} !rounded-xl flex items-start gap-2.5`} data-testid="mc-trip-need-clarification">
        <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-px" aria-hidden="true" />
        <div className="text-[11px] leading-relaxed text-[#4B5563]">
          <div className="font-semibold text-[#121316]">Период анализа не определён — требуется уточнение</div>
          {windowRes.needClarification}
          {canEvents && (
            <button type="button" className={`${UI.buttonGhost} mt-2`} onClick={() => setBoundsOpen(true)} data-testid="mc-bounds-edit">
              Уточнить границы вручную
            </button>
          )}
        </div>
      </div>
    );
  }

  const w = windowRes.window;
  const s = analysis?.summary || null;
  const reportMethodLabel = report.available
    ? 'Отчёт Nav.by «Стоянка-движение»'
    : `Расчёт портала по последовательности измерений (${report.reason || 'отчёт недоступен'})`;

  const filteredStops = (analysis?.stops || []).filter((x) => stopsFilter === 'all' || x.analysis.scenario != null);
  const filteredEvents = eventsSorted.filter((e) => {
    if (!eventsNearStopsOnly) return true;
    return e.stopId != null || e.techNearby != null;
  });

  const selectStop = (id: string | null) => {
    setSelectedStopId(id);
    setSelectedEventId(null);
    setZoom(id ? 'stop' : 'trip');
  };
  const selectEvent = (e: TripEventRow | null) => {
    if (!e) {
      setSelectedEventId(null);
      setZoom('trip');
      return;
    }
    setSelectedEventId(e.id);
    if (e.stopId) setSelectedStopId(e.stopId);
    setZoom('event');
  };
  const nextEvent = (dir: 1 | -1) => {
    if (!eventsSorted.length) return;
    const idx = eventsSorted.findIndex((e) => e.id === selectedEventId);
    const nextIdx = idx < 0 ? 0 : (idx + dir + eventsSorted.length) % eventsSorted.length;
    selectEvent(eventsSorted[nextIdx]);
    toast(`Событие ${nextIdx + 1} из ${eventsSorted.length}: ${eventsSorted[nextIdx].title}`, 'info');
  };

  const problemTextOf = (e: TripEventRow | null, stop: Stop | null): string => {
    if (e) {
      return [
        `Проверка пробега по рейсу ${candidate.dateStart || '—'} → ${candidate.dateEnd || '—'} (${plate}).`,
        `Событие: ${e.title}.`,
        e.deltaKm != null ? `Прирост на интервале: ${fmtKm(Math.abs(e.deltaKm))}.` : '',
        e.rule,
        `Интервал: ${e.interval.fromMs}–${e.interval.toMs}.`,
      ].filter(Boolean).join(' ');
    }
    if (stop) {
      return `Проверка пробега: стоянка ${fmtDMYHM(stop.startMs)} → ${fmtDMYHM(stop.endMs)} (${plate}). Требуется уточнение показаний одометра.`;
    }
    return `Проверка пробега по рейсу (${plate}): данные требуют проверки.`;
  };

  const saveNote = async () => {
    if (!noteDraft.trim() || !analysis) return;
    setSaving(true);
    try {
      await mcService.addCheckNote({
        carKey, tripKey: candidate.key, user,
        action: 'Комментарий проверяющего',
        note: noteDraft,
        stopId: selectedStopId,
      });
      setNoteDraft('');
      toast('Комментарий сохранён в журнале проверки', 'success');
    } catch (err) {
      toast(`Не удалось сохранить комментарий: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const resolveEventById = async (eventId: string, resolve: boolean) => {
    setSaving(true);
    try {
      if (resolve) {
        await mcService.resolveEvent({ carKey, tripKey: candidate.key, eventId, note: noteDraft || undefined, user });
        toast('Событие отмечено проверенным (комментарий сохранён)', 'success');
      } else {
        await mcService.unresolveEvent({ carKey, tripKey: candidate.key, eventId, user });
        toast('Событие возвращено в проверку', 'info');
      }
      setNoteDraft('');
    } catch (err) {
      toast(`Не удалось сохранить: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const selectedStopEvent = selectedStop ? eventsSorted.find((e) => e.stopId === selectedStop.stop.id) || null : null;

  const isResolved = selectedEvent ? resolvedEventIds.includes(selectedEvent.id) : false;

  return (
    <div className="flex flex-col gap-4" data-testid="mc-trip-view">
      {/* ── Границы и источник стоянок ── */}
      <div className={`${UI.bar} !rounded-xl`}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-[#4B5563]">
          <span className="font-semibold text-[#121316]">Границы анализа:</span>
          <span data-testid="mc-window-dates">{fmtDMYHM(w.fromMs)} → {w.toMs > nowMs && w.ongoing ? 'текущий момент' : fmtDMYHM(w.toMs)}</span>
          <span className={UI.chip} data-testid="mc-window-source">{w.sourceLabel}</span>
          {w.ongoing && <StatusText color="amber">предварительно (рейс не завершён)</StatusText>}
          <span className="text-[#9CA3AF]">Стоянки: {reportMethodLabel}{report.fetchedAt ? ` · получен ${fmtDMYHM(Date.parse(report.fetchedAt))}` : ''}</span>
          <span className="flex-1" />
          <button type="button" className={UI.buttonGhost} onClick={onReload} disabled={loading} data-testid="mc-reload">
            {loading ? 'Загрузка…' : 'Обновить данные'}
          </button>
          {canEvents && (
            <button type="button" className={UI.buttonGhost} onClick={() => setBoundsOpen(true)} data-testid="mc-bounds-edit">
              Уточнить границы
            </button>
          )}
        </div>
        {w.warnings.length > 0 && (
          <ul className="mt-1.5 text-[10px] text-[#6B7280] list-disc pl-4">
            {w.warnings.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        )}
      </div>

      {/* ── Сводка по рейсу ── */}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5" data-testid="mc-summary">
          <SummaryCard
            label="Прирост одометра за рейс"
            value={s.odoGainKm != null ? fmtKm(s.odoGainKm) : '—'}
            sub={s.odoGainKm != null
              ? `от ${s.baselineKm?.toFixed(1) ?? '—'} до ${s.lastOdoKm?.toFixed(1) ?? '—'} км (odom_can, источник не подтверждён физически)`
              : (s.odoGainReason || 'не вычислить')}
            testid="mc-summary-odo"
          />
          <SummaryCard
            label="Заявленный километраж"
            value={candidate.factKm != null ? fmtKm(candidate.factKm, 0) : candidate.planKm != null ? `${fmtKm(candidate.planKm, 0)} (план)` : '—'}
            sub={`План: ${candidate.planKm != null ? fmtKm(candidate.planKm, 0) : '—'} · Факт: ${candidate.factKm != null ? fmtKm(candidate.factKm, 0) : '—'} · источник: «План дохода» (totalKm/factKm)`}
            testid="mc-summary-declared"
          />
          <SummaryCard
            label="Сравнение с GPS (сопоставимые участки)"
            value={gpsCompareLabel(s)}
            sub={s.gpsCompareNote}
            testid="mc-summary-gps"
          />
          <SummaryCard
            label="Полнота данных"
            value={`${s.dataCompletenessPct}%`}
            sub={`проверяемые интервалы: ${fmtDuration(s.verifiedMs)} · непроверяемые: ${fmtDuration(s.unknownMs)}`}
            testid="mc-summary-completeness"
          />
          <SummaryCard
            label="Стоянки"
            value={`${s.stopsTotal}`}
            sub={`состояния с событиями: ${s.stopsWithEvents}`}
            testid="mc-summary-stops"
          />
          <SummaryCard
            label="События"
            value={`${s.eventsOnStops} / ${s.eventsInMotion}`}
            sub="на стоянках / в движении"
            testid="mc-summary-events"
          />
          <SummaryCard
            label="Открытые проверки"
            value={`${s.openChecks}`}
            sub={s.openChecks > 0 ? 'отмеченные события без подтверждения' : 'все отмеченные события проверены'}
            tone={s.openChecks > 0 ? 'rose' : undefined}
            testid="mc-summary-open"
          />
          <SummaryCard
            label="Прирост на отмеченных интервалах"
            value={s.flaggedGainKm != null ? fmtKm(s.flaggedGainKm) : '—'}
            sub={s.flaggedNote}
            testid="mc-summary-flagged"
          />
        </div>
      )}

      {/* ── Графики ── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold text-[#6B7280]">Масштаб:</span>
        <FilterPills
          ariaLabel="Масштаб графиков"
          items={[
            { key: 'trip', label: 'Весь рейс' },
            ...(selectedStop ? [{ key: 'stop', label: 'Выбранная стоянка' }] : []),
            ...(selectedEvent ? [{ key: 'event', label: 'Выбранное событие' }] : []),
          ]}
          active={selectedStop || selectedEvent ? zoom : 'trip'}
          onChange={(k) => setZoom(k as 'trip' | 'stop' | 'event')}
        />
        <span className="flex-1" />
        <button type="button" className={UI.buttonGhost} onClick={() => nextEvent(-1)} disabled={!eventsSorted.length} data-testid="mc-event-prev">← Предыдущее событие</button>
        <button type="button" className={UI.buttonDark} onClick={() => nextEvent(1)} disabled={!eventsSorted.length} data-testid="mc-event-next">Следующее событие →</button>
        {selectedEvent && isResolved && <StatusText color="emerald">событие отмечено проверенным</StatusText>}
      </div>

      {analysis && (
        <div className="bg-white border border-[#E5E7EB] rounded-xl p-3">
          <div className="text-[11px] font-semibold text-[#121316] flex items-center gap-1.5 mb-2">
            <Gauge className="w-3.5 h-3.5" aria-hidden="true" /> Накопленный пробег от начала рейса (X — время, Y — км от начала)
          </div>
          <MileageChart
            window={analysis.window}
            range={range}
            polylines={chartPolylines}
            stops={analysis.stops.map((x) => x.stop)}
            unknowns={analysis.unknowns}
            techEvents={analysis.techEvents}
            events={analysis.events}
            selectedStopId={selectedStopId}
            selectedEventId={selectedEventId}
            onSelectStop={selectStop}
            onSelectEvent={(id) => {
              const e = id ? eventsSorted.find((x) => x.id === id) || null : null;
              selectEvent(e);
            }}
            maxPoints={params.maxChartPoints}
            odoSourceLabel="одометр (odom_can)"
            gpsPartial={(s?.gpsCoveragePct ?? 0) < 99}
          />
          <div className="mt-3 text-[11px] font-semibold text-[#121316] mb-2">Приросты между измерениями (синхронизировано с графиком выше)</div>
          <GainChart
            range={range}
            gains={analysis.gains}
            stops={analysis.stops.map((x) => x.stop)}
            selectedStopId={selectedStopId}
            onSelectGain={(g) => {
              const stopEvent = g.stopId ? analysis.events.find((e) => e.stopId === g.stopId) || null : null;
              if (stopEvent) selectEvent(stopEvent);
              else if (g.stopId) selectStop(g.stopId);
              else {
                setZoom('trip');
                setSelectedEventId(null);
                toast(`Интервал ${fmtDMHM(g.fromMs)} → ${fmtDMHM(g.toMs)}: ${g.deltaKm != null ? fmtKm(g.deltaKm) : 'нет данных одометра'}${g.gapInside ? ' (через разрыв данных)' : ''}`, 'info');
              }
            }}
          />
        </div>
      )}

      {/* ── Таблица стоянок ── */}
      {analysis && (
        <div className="flex flex-col gap-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-semibold text-[#121316] flex items-center gap-1.5"><ListFilter className="w-3.5 h-3.5" aria-hidden="true" /> Стоянки</span>
            <FilterPills
              ariaLabel="Фильтр стоянок"
              items={[
                { key: 'events', label: `Только с событиями (${analysis.summary.stopsWithEvents})` },
                { key: 'all', label: `Все стоянки (${analysis.summary.stopsTotal})` },
              ]}
              active={stopsFilter}
              onChange={(k) => setStopsFilter(k)}
            />
            <span className="flex-1" />
            <label className="flex items-center gap-1.5 text-[11px] text-[#4B5563] cursor-pointer">
              <input
                type="checkbox"
                className={UI.checkbox}
                checked={eventsNearStopsOnly}
                onChange={(e) => setEventsNearStopsOnly(e.target.checked)}
                data-testid="mc-events-near-stops"
              />
              Только события около стоянок
            </label>
          </div>

          <div className={UI.tableWrap} data-testid="mc-stops-table">
            <table className={UI.table}>
              <thead>
                <tr className={UI.theadRow}>
                  <th className={UI.th}>Дата и время</th>
                  <th className={UI.th}>Место</th>
                  <th className={UI.th}>Длительность</th>
                  <th className={UI.th}>Одометр до → после</th>
                  <th className={UI.th}>Прирост (наблюдаемый интервал)</th>
                  <th className={UI.th}>Полнота данных</th>
                  <th className={UI.th}>Результат</th>
                  <th className={UI.th}>Действие</th>
                </tr>
              </thead>
              <tbody>
                {filteredStops.map(({ stop, analysis: a }, i) => {
                  const scen = a.scenario ? SCENARIO_LABEL[a.scenario] : null;
                  return (
                    <tr key={stop.id} className={UI.tr + (stop.id === selectedStopId ? ' bg-[#F3F4F6]' : '')} data-testid={`mc-stop-row-${i}`}>
                      <td className={UI.tdMono}>
                        {fmtDMHM(stop.startMs)}
                        <div className="text-[10px] text-[#9CA3AF] font-normal">→ {fmtDMHM(stop.endMs)}</div>
                      </td>
                      <td className={UI.td}>
                        {stop.lat != null && stop.lon != null
                          ? <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />{stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}</span>
                          : <span className="text-[#9CA3AF]">неизвестно</span>}
                        <div className="text-[10px] text-[#9CA3AF]">{stop.category === 'confirmed' ? 'подтверждённая' : 'предполагаемая'} · {stop.method === 'navby_parking_report' ? 'отчёт Nav.by' : 'расчёт портала'}</div>
                      </td>
                      <td className={UI.td}>{fmtDuration(stop.durationMin * 60_000)}</td>
                      <td className={UI.td}>
                        {a.odoBeforeKm != null || a.odoAfterKm != null
                          ? `${a.odoBeforeKm?.toFixed(1) ?? '—'} → ${a.odoAfterKm?.toFixed(1) ?? '—'}`
                          : <span className="text-[#9CA3AF]">одометр не передаётся</span>}
                      </td>
                      <td className={UI.td}>
                        {a.riseKm != null ? fmtKm(a.riseKm) : '—'}
                        {a.riseWithinStopKm != null && a.riseWithinStopKm > 0.05 && (
                          <div className="text-[10px] text-[#9CA3AF]">внутри стоянки: {fmtKm(a.riseWithinStopKm)}</div>
                        )}
                      </td>
                      <td className={UI.td}>
                        {stop.quality.samplesInside} измер. {stop.quality.maxGapMs != null ? `· макс. пауза ${fmtDuration(stop.quality.maxGapMs)}` : ''}
                        {stop.quality.tags.length > 0 && <div className="text-[10px] text-amber-600">{stop.quality.tags.join('; ')}</div>}
                      </td>
                      <td className={UI.td}>
                        {scen
                          ? <StatusText color={scen.color}>{scen.label}</StatusText>
                          : a.severity === 'info'
                            ? <StatusText color="blue">прирост ниже порога</StatusText>
                            : <span className="text-[#6B7280]">без событий</span>}
                      </td>
                      <td className={UI.td}>
                        <button type="button" className={UI.buttonLink} onClick={() => selectStop(stop.id)} data-testid={`mc-stop-show-${i}`}>
                          Показать на графике
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {filteredStops.length === 0 && (
                  <tr><td className={UI.td} colSpan={8}>
                    {stopsFilter === 'events' ? 'Стоянок с событиями нет — переключитесь на «Все стоянки».' : 'Стоянки за период не найдены.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* ── Разбор выбранной стоянки ── */}
          {selectedStop && (
            <StopDetail
              stop={selectedStop.stop}
              analysis={selectedStop.analysis}
              samples={samples}
              params={params}
              notes={notes.filter((n) => n.stopId === selectedStop.stop.id)}
              canEvents={canEvents}
              noteDraft={noteDraft}
              setNoteDraft={setNoteDraft}
              saving={saving}
              onSaveNote={saveNote}
              onResolve={() => selectedStopEvent && resolveEventById(selectedStopEvent.id, true)}
              onUnresolve={() => selectedStopEvent && resolveEventById(selectedStopEvent.id, false)}
              isResolved={selectedStopEvent != null && resolvedEventIds.includes(selectedStopEvent.id)}
              onCreateRequest={() => onCreateRequest(problemTextOf(selectedStopEvent, selectedStop.stop))}
              onClose={() => selectStop(null)}
            />
          )}
        </div>
      )}

      {/* ── События и журнал ── */}
      {analysis && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <div className="text-[11px] font-semibold text-[#121316]">События рейса ({filteredEvents.length}{eventsNearStopsOnly ? ` из ${eventsSorted.length}` : ''})</div>
            <div className="flex flex-col gap-1.5" data-testid="mc-events-list">
              {filteredEvents.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => selectEvent(e)}
                  className={`text-left ${UI.bar} !rounded-lg hover:bg-[#F9FAFB] transition-colors ${e.id === selectedEventId ? '!border-[#121316]' : ''}`}
                  data-testid={`mc-event-${e.id}`}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <StatusText color={e.severity === 'check' ? 'rose' : 'amber'}>{e.title}</StatusText>
                    {resolvedEventIds.includes(e.id) && <StatusText color="emerald">проверено</StatusText>}
                    {e.techNearby && <span className={UI.chip}><Wrench className="w-3 h-3 inline mr-1" aria-hidden="true" />рядом техотметка</span>}
                  </div>
                  <div className="text-[10px] text-[#6B7280] mt-0.5">
                    {fmtDMYHM(e.interval.fromMs)} → {fmtDMYHM(e.interval.toMs)}
                    {e.deltaKm != null ? ` · ${fmtKm(Math.abs(e.deltaKm))}` : ''}
                  </div>
                  {canEvents && (
                    <div className="mt-1 flex gap-2">
                      {resolvedEventIds.includes(e.id)
                        ? <span className={UI.buttonLink} onClick={(ev) => { ev.stopPropagation(); void resolveEventById(e.id, false); }} data-testid={`mc-event-unresolve-${e.id}`}>Вернуть в проверку</span>
                        : <span className={UI.buttonLink} onClick={(ev) => { ev.stopPropagation(); void resolveEventById(e.id, true); }} data-testid={`mc-event-resolve-${e.id}`}>Отметить проверенным</span>}
                    </div>
                  )}
                </button>
              ))}
              {!filteredEvents.length && <div className="text-[11px] text-[#6B7280]">Событий нет{eventsNearStopsOnly ? ' (снять фильтр «только около стоянок»)' : ''}.</div>}
            </div>
            {canEvents && (
              <div className="flex gap-2">
                <button type="button" className={UI.buttonGhost} onClick={() => setTechOpen(true)} data-testid="mc-tech-add">
                  <Wrench className="w-3.5 h-3.5" aria-hidden="true" /> Добавить техотметку
                </button>
                <button type="button" className={UI.buttonGhost} onClick={() => setJournalOpen(true)} data-testid="mc-journal-open">
                  <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Журнал проверки
                </button>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2" data-testid="mc-tech-list">
            <div className="text-[11px] font-semibold text-[#121316]">Технические отметки на шкале рейса</div>
            {analysis.techEvents.length === 0 && <div className="text-[11px] text-[#6B7280]">Технических событий и отметок за период нет.</div>}
            {analysis.techEvents.map((t) => (
              <div key={t.id} className="text-[11px] text-[#4B5563] flex items-center gap-2">
                <span className="w-2 h-2 bg-[#7C3AED] inline-block" style={{ clipPath: 'polygon(50% 0, 100% 50%, 50% 100%, 0 50%)' }} aria-hidden="true" />
                <span className="font-medium text-[#121316]">{t.label}</span>
                <span className="text-[#9CA3AF]">{fmtDMYHM(t.atMs)}</span>
                {t.detail && <span className="text-[10px] text-[#9CA3AF] truncate">{t.detail}</span>}
              </div>
            ))}
            <div className="text-[10px] text-[#9CA3AF]">
              Техотметка показывается на шкале и не закрывает событие автоматически — статус проверки меняет сотрудник.
            </div>
          </div>
        </div>
      )}

      {/* ── Параметры проверки ── */}
      <div>
        <button type="button" className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6B7280] hover:text-[#121316]" onClick={() => setParamsOpen((v) => !v)} data-testid="mc-params-toggle">
          <Settings2 className="w-3.5 h-3.5" aria-hidden="true" /> Параметры проверки (окна анализа и пороги)
          {paramsOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>
        {paramsOpen && (
          <div className="mt-2 bg-white border border-[#E5E7EB] rounded-xl p-3" data-testid="mc-params-panel">
            <div className="text-[10px] text-[#9CA3AF] mb-2">Предварительные параметры наблюдения, не универсальные нормы. Изменения применяются ко всем проверкам.</div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {(Object.keys(MC_CHECK_PARAM_LABELS) as Array<keyof CheckParams>).map((key) => (
                <label key={key} className="flex flex-col gap-0.5">
                  <span className={UI.fieldLabel} title={MC_CHECK_PARAM_LABELS[key].hint}>{MC_CHECK_PARAM_LABELS[key].label}, {MC_CHECK_PARAM_LABELS[key].unit}</span>
                  <input
                    type="number"
                    className={UI.inputSm}
                    value={paramsDraft[key]}
                    min={0}
                    step={key.includes('Km') || key.includes('M') ? 0.05 : 1}
                    disabled={!canRules}
                    onChange={(e) => setParamsDraft((d) => ({ ...d, [key]: Number(e.target.value) }))}
                  />
                </label>
              ))}
            </div>
            {canRules ? (
              <button
                type="button"
                className={`${UI.buttonDark} mt-3`}
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  try {
                    await mcService.saveCheckConfig({ patch: paramsDraft, user });
                    toast('Параметры проверки сохранены', 'success');
                  } finally {
                    setSaving(false);
                  }
                }}
                data-testid="mc-params-save"
              >
                Сохранить параметры
              </button>
            ) : (
              <div className="mt-3 text-[10px] text-[#9CA3AF]">Изменение параметров доступно роли с правом настройки правил («Правила проверки»).</div>
            )}
          </div>
        )}
      </div>

      {/* ── Диалоги ── */}
      <BoundsDialog
        isOpen={boundsOpen}
        onClose={() => setBoundsOpen(false)}
        fromMs={w.fromMs}
        toMs={w.toMs}
        hasOverride={!!override}
        saving={saving}
        onSave={async (from, to, comment) => {
          setSaving(true);
          try {
            await mcService.saveBoundsOverride({ carKey, tripKey: candidate.key, fromMs: from, toMs: to, comment, user });
            toast('Границы анализа уточнены — выполнен пересчёт с сохранением истории изменения', 'success');
            setBoundsOpen(false);
          } finally {
            setSaving(false);
          }
        }}
        onClear={async () => {
          setSaving(true);
          try {
            await mcService.clearBoundsOverride({ carKey, tripKey: candidate.key, user });
            toast('Границы возвращены к источнику рейса', 'info');
            setBoundsOpen(false);
          } finally {
            setSaving(false);
          }
        }}
      />

      <TechMarkDialog
        isOpen={techOpen}
        onClose={() => setTechOpen(false)}
        saving={saving}
        defaultAtMs={w.ongoing ? nowMs : Math.min(nowMs, w.toMs)}
        onSave={async (atMs, kind, comment) => {
          setSaving(true);
          try {
            await mcService.addTechMark({ carKey, tripKey: candidate.key, atMs, kind, comment, user });
            toast('Техническая отметка добавлена на шкалу рейса', 'success');
            setTechOpen(false);
          } finally {
            setSaving(false);
          }
        }}
      />

      <ModalShell isOpen={journalOpen} onClose={() => setJournalOpen(false)} title="Журнал проверки" subtitle={`${plate} · рейс ${candidate.dateStart || '—'} → ${candidate.dateEnd || '—'}`} icon={<FileText className="w-4 h-4" />}>
        <div className="flex flex-col gap-2">
          {notes.length === 0 && <div className="text-[11px] text-[#6B7280]">Записей пока нет.</div>}
          {notes.map((n) => (
            <div key={n.id} className="text-[11px] border-b border-[#E5E7EB] pb-1.5 last:border-0">
              <div className="flex flex-wrap gap-x-2">
                <span className="font-medium text-[#121316]">{n.action}</span>
                <span className="text-[#9CA3AF]">{fmtDMYHM(n.atMs)} · {n.by}</span>
              </div>
              {n.note && <div className="text-[#4B5563] mt-0.5">{n.note}</div>}
            </div>
          ))}
        </div>
      </ModalShell>
    </div>
  );
}

/* ─────────────────────────── Подкомпоненты ─────────────────────────── */

function SummaryCard({ label, value, sub, tone, testid }: { label: string; value: string; sub?: string; tone?: 'rose'; testid?: string }) {
  return (
    <div className="bg-white border border-[#E5E7EB] rounded-xl px-3.5 py-3 flex flex-col gap-0.5" data-testid={testid}>
      <span className="text-[10px] text-[#6B7280]">{label}</span>
      <span className={`text-sm font-bold leading-tight ${tone === 'rose' ? 'text-rose-600' : 'text-[#121316]'}`}>{value}</span>
      {sub && <span className="text-[9.5px] text-[#9CA3AF] leading-snug">{sub}</span>}
    </div>
  );
}

function SampleRow({ s, params }: { s: MeasureSample; params: CheckParams }) {
  const moving = s.speed != null && s.speed > params.stopSpeedKmh;
  return (
    <tr className={UI.tr}>
      <td className={UI.tdMono}>{fmtDMYHM(s.atMs)}</td>
      <td className={UI.td}>{s.speed != null ? `${fmtNum(s.speed, 0)} км/ч${moving ? ' · движение' : ' · стоит'}` : '—'}</td>
      <td className={UI.td}>{s.odoKm != null ? `${s.odoKm.toFixed(1)} км` : <span className="text-[#9CA3AF]">не передаётся</span>}</td>
      <td className={UI.td}>{s.posValid && s.lat != null && s.lon != null ? `${s.lat.toFixed(5)}, ${s.lon.toFixed(5)}` : <span className="text-[#9CA3AF]">координаты недоступны</span>}</td>
      <td className={UI.td}>
        {s.satellites != null ? `${s.satellites} спутн.` : '—'}
        {s.staleOnArrival && <div className="text-[10px] text-amber-600">координата устарела на момент получения</div>}
      </td>
    </tr>
  );
}

function StopDetail({
  stop, analysis: a, samples, params, notes, canEvents, noteDraft, setNoteDraft, saving,
  onSaveNote, onResolve, onUnresolve, isResolved, onCreateRequest, onClose,
}: {
  stop: Stop;
  analysis: import('./engine/types').StopAnalysis;
  samples: MeasureSample[];
  params: CheckParams;
  notes: Array<{ id: string; action: string; note?: string; by: string; atMs: number }>;
  canEvents: boolean;
  noteDraft: string;
  setNoteDraft: (v: string) => void;
  saving: boolean;
  onSaveNote: () => void;
  onResolve: () => void;
  onUnresolve: () => void;
  isResolved: boolean;
  onCreateRequest: () => void;
  onClose: () => void;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const rawSamples = samples
    .filter((s) => s.atMs >= stop.startMs - params.preWindowMin * 60_000 && s.atMs <= stop.endMs + params.postWindowMin * 60_000)
    .sort((x, y) => x.atMs - y.atMs);

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl p-4 flex flex-col gap-3" data-testid="mc-stop-detail">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="text-xs font-semibold text-[#121316]">Разбор стоянки</span>
        <span className={UI.chip}>{fmtDMHMLong(stop.startMs)} → {fmtDMHMLong(stop.endMs)}</span>
        <span className={UI.chip}>{fmtDuration(stop.durationMin * 60_000)}</span>
        <span className={UI.chip}>{stop.category === 'confirmed' ? 'подтверждённая' : 'предполагаемая'} · {stop.method === 'navby_parking_report' ? 'отчёт Nav.by' : 'расчёт портала'}</span>
        {stop.lat != null && stop.lon != null && (
          <span className={UI.chip}><MapPin className="w-3 h-3 inline mr-1" aria-hidden="true" />{stop.lat.toFixed(5)}, {stop.lon.toFixed(5)}</span>
        )}
        <span className="flex-1" />
        <button type="button" className={UI.buttonGhost} onClick={onClose}>Свернуть</button>
      </div>

      <div className="text-[10px] text-[#6B7280]">{stop.basis}</div>

      {/* Основания события */}
      {a.scenario && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5" data-testid="mc-stop-basis">
          <div className="text-[11px] font-semibold text-rose-700 flex items-center gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {a.title}
          </div>
          {a.rule && <div className="text-[11px] text-rose-700/90 mt-1">{a.rule}</div>}
          <ul className="mt-1.5 text-[11px] text-[#4B5563] list-disc pl-4 flex flex-col gap-0.5">
            {a.explanation.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          <div className="mt-1.5 text-[10px] text-[#9CA3AF]">Событие не закрывается наличием техотметки — проверку завершает сотрудник.</div>
        </div>
      )}
      {!a.scenario && (
        <div className="text-[11px] text-[#4B5563]">
          {a.explanation.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      )}

      {/* Ограничения данных */}
      {a.limits.length > 0 && (
        <div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2" data-testid="mc-stop-limits">
          <div className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide mb-1">Ограничения данных</div>
          <ul className="text-[11px] text-[#4B5563] list-disc pl-4 flex flex-col gap-0.5">
            {a.limits.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
        </div>
      )}

      {/* Измерения до / во время / после */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <SampleColumn title="Последнее перед стоянкой" samples={a.before ? [a.before] : []} params={params} empty="нет пригодного измерения" testid="mc-stop-detail-before" />
        <SampleColumn title={`Во время стоянки (${a.during.length})`} samples={a.during} params={params} empty="измерений внутри нет — отсутствие сообщений не является подтверждением стоянки" testid="mc-stop-detail-during" />
        <SampleColumn title="Первое после стоянки" samples={a.after ? [a.after] : []} params={params} empty="нет измерения после" testid="mc-stop-detail-after" />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[#6B7280]">
        <span>Прирост внутри стоянки: <b className="text-[#121316]">{a.riseWithinStopKm != null ? fmtKm(a.riseWithinStopKm) : '—'}</b></span>
        <span>Прирост при возобновлении: <b className="text-[#121316]">{a.riseResumeKm != null ? fmtKm(a.riseResumeKm) : '—'}{a.resumeRateKmh != null ? ` (темп ${fmtNum(a.resumeRateKmh)} км/ч)` : ''}</b></span>
        <span>GPS на том же интервале: <b className="text-[#121316]">{a.gpsKmSameInterval != null ? fmtKm(a.gpsKmSameInterval) : '—'}</b></span>
        {a.resumeAlreadyMoving && <span className="text-amber-600">первое измерение после стоянки уже в движении — прирост не приписывается стоянке</span>}
      </div>

      <button type="button" className={UI.buttonLink} onClick={() => setShowRaw((v) => !v)} data-testid="mc-stop-raw-toggle">
        {showRaw ? 'Скрыть' : 'Показать'} исходные измерения интервала ({rawSamples.length})
      </button>
      {showRaw && (
        <div className={UI.tableWrap}>
          <table className={UI.table} data-testid="mc-stop-raw-table">
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Время</th><th className={UI.th}>Скорость</th><th className={UI.th}>Одометр</th><th className={UI.th}>Координаты</th><th className={UI.th}>Качество</th>
              </tr>
            </thead>
            <tbody>{rawSamples.map((s) => <SampleRow key={s.atMs} s={s} params={params} />)}</tbody>
          </table>
        </div>
      )}

      {/* Комментарии и действия */}
      {canEvents && (
        <div className="flex flex-col gap-2">
          <textarea
            className={UI.textarea}
            rows={2}
            placeholder="Комментарий проверяющего (сохраняется в журнал рейса)"
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            data-testid="mc-note-input"
          />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={UI.buttonGhost} disabled={saving || !noteDraft.trim()} onClick={onSaveNote} data-testid="mc-note-save">
              Сохранить комментарий
            </button>
            {a.scenario && (isResolved
              ? <button type="button" className={UI.buttonGhost} disabled={saving} onClick={onUnresolve} data-testid="mc-event-return">Вернуть событие в проверку</button>
              : <button type="button" className={UI.buttonDark} disabled={saving} onClick={onResolve} data-testid="mc-event-resolve">Отметить событие проверенным</button>)}
            <button type="button" className={UI.buttonGhost} onClick={onCreateRequest} data-testid="mc-stop-request">
              Создать обращение в поддержку по стоянке
            </button>
          </div>
        </div>
      )}

      {notes.length > 0 && (
        <div className="text-[10px] text-[#6B7280] border-t border-[#E5E7EB] pt-2">
          <div className="font-semibold text-[#4B5563] mb-1">Комментарии по стоянке</div>
          {notes.map((n) => (
            <div key={n.id}>{fmtDMYHM(n.atMs)} · {n.by}: {n.note || n.action}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function SampleColumn({ title, samples, params, empty, testid }: { title: string; samples: MeasureSample[]; params: CheckParams; empty: string; testid: string }) {
  return (
    <div data-testid={testid}>
      <div className="text-[10px] font-semibold text-[#6B7280] uppercase tracking-wide mb-1">{title}</div>
      {samples.length === 0
        ? <div className="text-[11px] text-[#9CA3AF]">{empty}</div>
        : (
          <table className={UI.table}>
            <tbody>{samples.map((s) => <SampleRow key={s.atMs} s={s} params={params} />)}</tbody>
          </table>
        )}
    </div>
  );
}

function BoundsDialog({
  isOpen, onClose, fromMs, toMs, hasOverride, saving, onSave, onClear,
}: {
  isOpen: boolean;
  onClose: () => void;
  fromMs: number;
  toMs: number;
  hasOverride: boolean;
  saving: boolean;
  onSave: (from: number, to: number, comment?: string) => void;
  onClear: () => void;
}) {
  const [from, setFrom] = useState(fmtLocalInput(fromMs));
  const [to, setTo] = useState(fmtLocalInput(toMs));
  const [comment, setComment] = useState('');
  useEffect(() => {
    if (isOpen) {
      setFrom(fmtLocalInput(fromMs));
      setTo(fmtLocalInput(toMs));
      setComment('');
    }
  }, [isOpen, fromMs, toMs]);
  const fromParsed = parseLocalInput(from);
  const toParsed = parseLocalInput(to);
  const valid = fromParsed != null && toParsed != null && fromParsed < toParsed;
  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Уточнение границ анализа" subtitle="В источнике даты без времени — уточните точные границы рейса" icon={<Clock className="w-4 h-4" />}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={UI.fieldLabel}>Начало анализа</span>
          <input type="datetime-local" className={UI.inputSm} value={from} onChange={(e) => setFrom(e.target.value)} data-testid="mc-bounds-from" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={UI.fieldLabel}>Окончание анализа</span>
          <input type="datetime-local" className={UI.inputSm} value={to} onChange={(e) => setTo(e.target.value)} data-testid="mc-bounds-to" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={UI.fieldLabel}>Комментарий (причина уточнения)</span>
          <input type="text" className={UI.inputSm} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="mc-bounds-comment" />
        </label>
        <div className="text-[10px] text-[#9CA3AF] flex items-start gap-1.5">
          <Info className="w-3 h-3 mt-px shrink-0" aria-hidden="true" />
          Уточнение сохраняется в истории изменения: кто и когда изменил границы, и запускает пересчёт.
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {hasOverride && (
            <button type="button" className={UI.buttonGhost} disabled={saving} onClick={onClear} data-testid="mc-bounds-clear">Вернуть границы источника</button>
          )}
          <button type="button" className={UI.buttonGhost} onClick={onClose}>Отмена</button>
          <button type="button" className={UI.buttonDark} disabled={!valid || saving} onClick={() => valid && onSave(fromParsed as number, toParsed as number, comment)} data-testid="mc-bounds-save">
            Сохранить и пересчитать
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function TechMarkDialog({
  isOpen, onClose, saving, onSave, defaultAtMs,
}: {
  isOpen: boolean;
  onClose: () => void;
  saving: boolean;
  onSave: (atMs: number, kind: 'works' | 'tracker_replace' | 'odo_setting', comment?: string) => void;
  /** Время по умолчанию: для завершённого рейса — его окончание, иначе «сейчас». */
  defaultAtMs: number;
}) {
  const [at, setAt] = useState(fmtLocalInput(defaultAtMs));
  const [kind, setKind] = useState<'works' | 'tracker_replace' | 'odo_setting'>('works');
  const [comment, setComment] = useState('');
  useEffect(() => {
    if (isOpen) {
      setAt(fmtLocalInput(defaultAtMs));
      setKind('works');
      setComment('');
    }
  }, [isOpen, defaultAtMs]);
  const atParsed = parseLocalInput(at);
  return (
    <ModalShell isOpen={isOpen} onClose={onClose} title="Техническая отметка" subtitle="Отметка видна на шкале рейса и не закрывает события автоматически" icon={<Wrench className="w-4 h-4" />}>
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className={UI.fieldLabel}>Тип отметки</span>
          <select className={UI.select} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} data-testid="mc-tech-kind">
            <option value="works">Технические работы</option>
            <option value="tracker_replace">Замена трекера</option>
            <option value="odo_setting">Изменение настройки счётчика</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={UI.fieldLabel}>Время</span>
          <input type="datetime-local" className={UI.inputSm} value={at} onChange={(e) => setAt(e.target.value)} data-testid="mc-tech-at" />
        </label>
        <label className="flex flex-col gap-1">
          <span className={UI.fieldLabel}>Комментарий</span>
          <input type="text" className={UI.inputSm} value={comment} onChange={(e) => setComment(e.target.value)} data-testid="mc-tech-comment" />
        </label>
        <div className="flex justify-end gap-2">
          <button type="button" className={UI.buttonGhost} onClick={onClose}>Отмена</button>
          <button type="button" className={UI.buttonDark} disabled={atParsed == null || saving} onClick={() => atParsed != null && onSave(atParsed, kind, comment)} data-testid="mc-tech-save">
            Добавить отметку
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function fmtDMHMLong(ms: number): string {
  return fmtDMYHM(ms);
}

/** Локальная копия расстояния (haversine) для GPS-линии графика. */
function gpsKm(a: MeasureSample, b: MeasureSample): number {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return 0;
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return (2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(h)))) / 1000;
}

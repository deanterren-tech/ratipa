/**
 * Окно «Показания CAN-одометра» — отдельное ШИРОКОЕ окно (на мобильном —
 * полноэкранное) с ОДНИМ ступенчатым графиком абсолютных показаний одометра
 * выбранной машины.
 *
 * Что показывает: только график показаний одометра (источник — odom_can) и
 * период; никаких приростов, GPS-сравнения, стоянок, событий, полноты истории
 * и статусов проверки.
 *
 * Период: день / рейс / произвольный (начало и конец — дата И время). Выбор
 * рейса задаёт период и не запускает «анализ». Масштаб: выделение участка
 * мышью (brush-zoom), возврат ко всему периоду. Обновление — отдельной кнопкой.
 * На мобильном значения смотрят касанием с перемещением пальца (см.
 * CanOdomChart). Пустое состояние (рейс не начался / нет данных) — понятное,
 * без ошибок анализа.
 *
 * Поздний ответ не перетирает чужие данные: каждая загрузка помечается номером
 * последовательности; результат применяется, только если это последняя загрузка
 * этого окна (быстрое переключение машин/периодов безопасно).
 */

import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CalendarDays, Gauge, RefreshCw, X } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { openDatePicker } from '../../../utils/openDatePicker';
import { mcService } from './mcService';
import { CanStatusBadge } from './CanStatusBadge';
import type { CanCarStatus } from './canStatus';
import { MC_CHECK_DEFAULTS, type CheckParams } from './engine/params';
import { resolveTripWindow, factDaysOfStages, type TripCandidate } from './engine/binding';
import { canDayKey, canDayKeysInRange, dayBoundsFromKey, type CanPoint } from './engine/canSeries';
import { fmtDMY, fmtHM } from './engine/format';
import type { McCurrent } from './mcTypes';
import LoadingSpinner from '../../common/LoadingSpinner';
import CanOdomChart from './charts/CanOdomChart';

interface Props {
  carKey: string;
  plate: string;
  trips: TripCandidate[];
  stagesStore: Record<string, Record<string, unknown>>;
  /** Рейс, выбранный в таблице — задаёт стартовый период окна. */
  initialTripKey: string | null;
  current: McCurrent | undefined;
  intervalSec: number;
  status: CanCarStatus;
  nowMs: number;
  onRefreshStatus?: () => void;
  onClose: () => void;
}

/** История хранится ~120 дней, чтение ограничено 100 днями — период режем на 90. */
const MAX_PERIOD_MS = 90 * 86_400_000;
const READ_TIMEOUT_MS = 15_000;

const p2 = (n: number) => String(n).padStart(2, '0');

/** мс → YYYY-MM-DD (пояс портала +03) для скрытого input[type=date]. */
const msToDayInput = (ms: number): string => {
  const d = new Date(ms + 180 * 60_000);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
};
/** YYYY-MM-DD (пояс +03) → мс начала дня. */
const dayInputToMs = (v: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) - 180 * 60_000 : null;
};
/** мс → YYYY-MM-DDTHH:MM (пояс +03) для скрытого input[type=datetime-local]. */
const msToDtInput = (ms: number): string => {
  const d = new Date(ms + 180 * 60_000);
  return `${msToDayInput(ms)}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};
/** YYYY-MM-DDTHH:MM (пояс +03) → мс. */
const dtInputToMs = (v: string): number | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - 180 * 60_000 : null;
};
/** Дата портала: дд/мм/гггг. */
const fmtRuDate = (ms: number | null): string => (ms == null || !Number.isFinite(ms) ? '' : fmtDMY(ms).replace(/\./g, '/'));
/** Дата и время портала: дд/мм/гггг чч:мм. */
const fmtRuDt = (ms: number | null): string => (ms == null || !Number.isFinite(ms) ? '—' : `${fmtRuDate(ms)} ${fmtHM(ms)}`);
/** ISO-день (YYYY-MM-DD) → дд/мм/гггг. */
const ruIso = (s: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || '—');
};

/** Поле даты портала: текст дд/мм/гггг + скрытый input[type=date]. */
function DateField({ id, valueMs, onChangeMs, ariaLabel, minMs, maxMs }: {
  id: string;
  valueMs: number | null;
  onChangeMs: (ms: number) => void;
  ariaLabel: string;
  minMs?: number;
  maxMs?: number;
}) {
  return (
    <span className="relative inline-flex items-center">
      <input
        type="text"
        readOnly
        value={fmtRuDate(valueMs)}
        placeholder="ДД/ММ/ГГГГ"
        aria-label={ariaLabel}
        onClick={() => openDatePicker(id)}
        className={`${UI.input} !py-1 !min-h-0 text-[11px] w-[110px] pr-8 cursor-pointer`}
      />
      <input
        id={id}
        type="date"
        value={valueMs != null ? msToDayInput(valueMs) : ''}
        min={minMs != null ? msToDayInput(minMs) : undefined}
        max={maxMs != null ? msToDayInput(maxMs) : undefined}
        onChange={(e) => {
          const ms = dayInputToMs(e.target.value);
          if (ms != null) onChangeMs(ms);
        }}
        className="absolute inset-0 opacity-0 md:pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        aria-label={`${ariaLabel} — открыть календарь`}
        onClick={() => openDatePicker(id)}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer pointer-events-none md:pointer-events-auto"
      >
        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

/** Поле даты и времени портала: текст дд/мм/гггг чч:мм + скрытый datetime-local. */
function DateTimeField({ id, valueMs, onChangeMs, ariaLabel, minMs, maxMs }: {
  id: string;
  valueMs: number | null;
  onChangeMs: (ms: number) => void;
  ariaLabel: string;
  minMs?: number;
  maxMs?: number;
}) {
  return (
    <span className="relative inline-flex items-center">
      <input
        type="text"
        readOnly
        value={valueMs != null ? `${fmtRuDate(valueMs)} ${fmtHM(valueMs)}` : ''}
        placeholder="ДД/ММ/ГГГГ ЧЧ:ММ"
        aria-label={ariaLabel}
        onClick={() => openDatePicker(id)}
        className={`${UI.input} !py-1 !min-h-0 text-[11px] w-[150px] pr-8 cursor-pointer`}
      />
      <input
        id={id}
        type="datetime-local"
        value={valueMs != null ? msToDtInput(valueMs) : ''}
        min={minMs != null ? msToDtInput(minMs) : undefined}
        max={maxMs != null ? msToDtInput(maxMs) : undefined}
        onChange={(e) => {
          const ms = dtInputToMs(e.target.value);
          if (ms != null) onChangeMs(ms);
        }}
        className="absolute inset-0 opacity-0 md:pointer-events-none"
        tabIndex={-1}
        aria-hidden="true"
      />
      <button
        type="button"
        aria-label={`${ariaLabel} — открыть календарь`}
        onClick={() => openDatePicker(id)}
        className="absolute right-0.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer pointer-events-none md:pointer-events-auto"
      >
        <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

function EmptyBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="py-12 text-center" data-testid="mc-graph-empty">
      <div className="text-xs font-medium text-[#4B5563]">{title}</div>
      <div className="text-[11px] text-[#6B7280] mt-1 max-w-xl mx-auto">{text}</div>
    </div>
  );
}

type Mode = 'day' | 'trip' | 'period';

export default function CanGraphDialog(props: Props) {
  const { carKey, plate, trips, stagesStore, initialTripKey, current, intervalSec, status, nowMs, onRefreshStatus, onClose } = props;

  const [params, setParams] = useState<CheckParams>(MC_CHECK_DEFAULTS);
  useEffect(() => mcService.subscribeCheckConfig(setParams), []);

  const defaultTrip = useMemo(
    () => trips.find((t) => t.key === initialTripKey) || trips[0] || null,
    [trips, initialTripKey],
  );

  const [mode, setMode] = useState<Mode>(() => (defaultTrip ? 'trip' : 'day'));
  const [dayKey, setDayKey] = useState<string>(() => canDayKey(Date.now()));
  const [tripKey, setTripKey] = useState<string>(() => defaultTrip?.key || '');
  const [periodFromMs, setPeriodFromMs] = useState<number>(() => Date.now() - 86_400_000);
  const [periodToMs, setPeriodToMs] = useState<number>(() => Date.now());
  const [zoom, setZoom] = useState<{ fromMs: number; toMs: number } | null>(null);
  const [points, setPoints] = useState<CanPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const loadSeq = useRef(0);

  // Escape закрывает окно (оно верхнее).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const selectedTrip: TripCandidate | null = useMemo(
    () => trips.find((t) => t.key === tripKey) || defaultTrip,
    [trips, tripKey, defaultTrip],
  );
  const factDaysFor = useCallback((tripId: string) => factDaysOfStages(stagesStore, tripId), [stagesStore]);
  const tripsSig = useMemo(() => trips.map((t) => `${t.key}:${t.dateStart}:${t.dateEnd}`).join('|'), [trips]);

  /** Период по режиму: день / рейс / произвольный. Выбор рейса задаёт период и всё. */
  const periodInfo = useMemo(() => {
    if (mode === 'day') {
      const b = dayBoundsFromKey(dayKey);
      return b
        ? { window: { fromMs: b.fromMs, toMs: b.toMs }, reason: null as string | null }
        : { window: null, reason: 'Выберите дату.' };
    }
    if (mode === 'trip') {
      if (!selectedTrip) return { window: null, reason: 'У машины нет рейсов в «Плане дохода» — выберите день или произвольный период.' };
      const res = resolveTripWindow({
        candidate: selectedTrip,
        carKey,
        factDays: factDaysFor(selectedTrip.id),
        override: null,
        nowMs: Date.now(),
      });
      if (!res.window) {
        return { window: null, reason: 'Рейс ещё не начался или в нём не заданы даты — период не определить. Выберите день, другой рейс или произвольный период.' };
      }
      return { window: { fromMs: res.window.fromMs, toMs: res.window.toMs }, reason: null };
    }
    if (!Number.isFinite(periodFromMs) || !Number.isFinite(periodToMs) || periodToMs <= periodFromMs) {
      return { window: null, reason: 'Укажите корректные начало и конец периода: конец должен быть позже начала.' };
    }
    return { window: { fromMs: periodFromMs, toMs: periodToMs }, reason: null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, dayKey, tripKey, tripsSig, factDaysFor, carKey, nowMs, periodFromMs, periodToMs, selectedTrip]);

  const hasWindow = periodInfo.window != null;
  const clampInfo = useMemo(() => {
    const w = periodInfo.window;
    if (!w) return { fromMs: 0, toMs: 0, clamped: false };
    if (w.toMs - w.fromMs > MAX_PERIOD_MS) return { fromMs: w.toMs - MAX_PERIOD_MS, toMs: w.toMs, clamped: true };
    return { fromMs: w.fromMs, toMs: w.toMs, clamped: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodInfo.window != null, periodInfo.window?.fromMs, periodInfo.window?.toMs]);

  const winKey = hasWindow ? `${clampInfo.fromMs}|${clampInfo.toMs}` : 'none';

  useEffect(() => {
    setZoom(null);
  }, [winKey, mode]);

  useEffect(() => {
    if (!hasWindow) {
      loadSeq.current += 1;
      setPoints([]);
      setLoading(false);
      setLoadError(null);
      return;
    }
    const seq = loadSeq.current + 1;
    loadSeq.current = seq;
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    (async () => {
      // В проекте strictNullChecks выключен — не сужаем union по «!res.ok»,
      // используем единую форму результата с optional-полями.
      type LoadResult = { ok: boolean; points?: CanPoint[]; reason?: string };
      const res: LoadResult = await Promise.race<LoadResult>([
        mcService.readCanHistoryRangeStrict(carKey, clampInfo.fromMs, clampInfo.toMs),
        new Promise<LoadResult>((resolve) =>
          setTimeout(() => resolve({ ok: false, reason: 'превышено время ожидания чтения' }), READ_TIMEOUT_MS),
        ),
      ]);
      if (cancelled || seq !== loadSeq.current) return;
      if (!res.ok) {
        setLoading(false);
        setLoadError(res.reason || 'не удалось прочитать данные');
        return;
      }
      setPoints(res.points || []);
      setLoading(false);
    })().catch(() => {
      if (!cancelled && seq === loadSeq.current) {
        setLoading(false);
        setLoadError('не удалось прочитать данные');
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carKey, winKey, reloadTick, hasWindow]);

  const dayMarks = useMemo(() => {
    if (!hasWindow) return [];
    return canDayKeysInRange(clampInfo.fromMs, clampInfo.toMs, 100)
      .map((k) => dayBoundsFromKey(k)?.fromMs)
      .filter((v): v is number => v != null && v > clampInfo.fromMs && v <= clampInfo.toMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winKey, hasWindow]);

  const range = zoom ?? { fromMs: clampInfo.fromMs, toMs: clampInfo.toMs };
  const isZoomed = Boolean(zoom);

  const refresh = () => {
    setReloadTick((x) => x + 1);
    onRefreshStatus?.();
  };

  const periodLabel = useMemo(() => {
    if (mode === 'trip' && selectedTrip) {
      return `Рейс: ${ruIso(selectedTrip.dateStart)} → ${ruIso(selectedTrip.dateEnd)}${selectedTrip.direction ? ` · ${selectedTrip.direction.slice(0, 32)}` : ''}`;
    }
    if (mode === 'day') return `День: ${fmtRuDate(dayBoundsFromKey(dayKey)?.fromMs ?? null) || '—'}`;
    return `Период: ${fmtRuDt(periodFromMs)} → ${fmtRuDt(periodToMs)}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, selectedTrip, dayKey, periodFromMs, periodToMs]);

  const caption = hasWindow
    ? `Период: ${fmtRuDt(clampInfo.fromMs)} → ${fmtRuDt(clampInfo.toMs)}${
        isZoomed ? ` · показано: ${fmtRuDt(range.fromMs)} → ${fmtRuDt(range.toMs)}` : ''
      }${clampInfo.clamped ? ' · период ограничен 90 днями (срок хранения истории)' : ''}`
    : (periodInfo.reason || '');

  let body: ReactNode;
  if (!hasWindow) {
    body = <EmptyBlock title="Период не определён" text={periodInfo.reason || 'Выберите период.'} />;
  } else if (loading) {
    body = (
      <div className="py-14 flex flex-col items-center gap-2 text-[#6B7280]" data-testid="mc-graph-loading">
        <LoadingSpinner size={18} />
        <div className="text-[11px]">Загружаем показания одометра…</div>
      </div>
    );
  } else if (loadError) {
    body = (
      <div className="py-12 text-center" data-testid="mc-graph-error">
        <div className="text-xs font-medium text-[#4B5563]">Не удалось загрузить данные</div>
        <div className="text-[11px] text-[#6B7280] mt-1">{loadError}</div>
        <button type="button" className={UI.buttonGhost + ' mt-3'} onClick={refresh}>
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Повторить
        </button>
      </div>
    );
  } else if (points.length === 0) {
    body = (
      <EmptyBlock
        title="Нет CAN-данных за выбранный период"
        text="Источник не передал показаний одометра за это время. Текущее поступление данных по машине — в индикаторе выше; при необходимости выберите другой период."
      />
    );
  } else {
    body = (
      <CanOdomChart
        points={points}
        range={range}
        gapMs={(params.dataGapMin || 60) * 60_000}
        dayMarks={dayMarks}
        onBrush={(a, b) => setZoom({ fromMs: a, toMs: b })}
        onResetZoom={() => setZoom(null)}
      />
    );
  }

  /*
   * Подложка — как у остальных модалок портала (Dozvola/PlanDohod/AccountSettings):
   * умеренное полупрозрачное затемнение bg-black/40 + лёгкий blur, НЕ сплошной
   * тёмный слой (bg-slate-950 перекрывал весь экран и давал «чёрный фон»).
   * На телефоне правила index.css для [data-mobile-fullscreen] делают слой
   * прозрачным и растягивают диалог на весь экран.
   */
  return createPortal(
    <div
      className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-start justify-center overflow-y-auto overscroll-contain md:p-6"
      data-scroll-lock="modal"
      data-mobile-fullscreen
      role="dialog"
      aria-modal="true"
      aria-label={`Показания CAN-одометра — ${plate}`}
      data-testid="mc-graph-dialog"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full bg-white flex flex-col md:w-[min(1440px,96vw)] md:my-4 md:rounded-2xl md:border md:border-[#E5E7EB] md:shadow-[0_25px_60px_rgba(0,0,0,0.35)] md:max-h-[calc(100vh-2rem)] md:overflow-hidden">
        {/* Заголовок: номер автомобиля, рейс/период, индикатор данных, закрытие */}
        <div className="flex items-start justify-between gap-3 px-4 sm:px-6 py-4 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="p-2 bg-[#F3F4F6] text-[#121316] rounded-lg shrink-0">
              <Gauge className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[#121316] truncate" data-testid="mc-graph-title">
                Показания CAN-одометра — {plate}
              </h2>
              <div className="flex items-center gap-3 flex-wrap mt-1">
                <span className="text-xs text-[#6B7280]">{periodLabel}</span>
                <CanStatusBadge status={status} nowMs={nowMs} size="lg" />
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            data-testid="mc-graph-close"
            className="inline-flex items-center justify-center p-2 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Период и обновление — без лишних панелей */}
        <div className="px-4 sm:px-6 pt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <div className="inline-flex rounded-lg border border-[#E5E7EB] overflow-hidden" role="tablist" aria-label="Период графика">
            {([['day', 'День'], ['trip', 'Рейс'], ['period', 'Период']] as Array<[Mode, string]>).map(([m, label]) => (
              <button
                key={m}
                type="button"
                role="tab"
                aria-selected={mode === m}
                className={`px-3 py-1.5 font-medium ${mode === m ? 'bg-[#121316] text-white' : 'bg-white text-[#4B5563] hover:bg-[#F9FAFB]'}`}
                onClick={() => setMode(m)}
                data-testid={`mc-graph-mode-${m}`}
              >
                {label}
              </button>
            ))}
          </div>

          {mode === 'day' && (
            <span className="inline-flex items-center gap-1.5">
              <DateField
                id="mc-graph-day-picker"
                ariaLabel="Дата"
                valueMs={dayBoundsFromKey(dayKey)?.fromMs ?? null}
                onChangeMs={(ms) => setDayKey(canDayKey(ms))}
                maxMs={Date.now()}
              />
              <button type="button" className={UI.buttonLink} onClick={() => setDayKey(canDayKey(Date.now()))}>
                Сегодня
              </button>
            </span>
          )}

          {mode === 'trip' && (
            <span className="inline-flex items-center gap-1.5">
              {trips.length === 0 ? (
                <span className="text-[#9CA3AF]">у машины нет рейсов в «Плане дохода»</span>
              ) : (
                <select
                  className={UI.select + ' !min-h-0 !py-1 text-[11px] max-w-[300px]'}
                  value={selectedTrip?.key || ''}
                  onChange={(e) => setTripKey(e.target.value)}
                  data-testid="mc-graph-trip"
                >
                  {trips.map((t) => (
                    <option key={t.key} value={t.key}>
                      {ruIso(t.dateStart)} → {ruIso(t.dateEnd)}
                      {t.direction ? ` · ${t.direction.slice(0, 24)}` : ''}
                      {t.archived ? ' (архив)' : ''}
                    </option>
                  ))}
                </select>
              )}
            </span>
          )}

          {mode === 'period' && (
            <span className="inline-flex items-center gap-1.5">
              <DateTimeField id="mc-graph-period-from" ariaLabel="Начало периода" valueMs={periodFromMs} onChangeMs={setPeriodFromMs} maxMs={periodToMs} />
              <span className="text-[#9CA3AF]">→</span>
              <DateTimeField id="mc-graph-period-to" ariaLabel="Конец периода" valueMs={periodToMs} onChangeMs={setPeriodToMs} minMs={periodFromMs} />
            </span>
          )}

          <span className="flex-1" />

          {isZoomed && (
            <button type="button" className={UI.buttonLink} onClick={() => setZoom(null)} data-testid="mc-graph-zoom-reset">
              Весь период
            </button>
          )}
          <button
            type="button"
            className={UI.buttonGhost + ' !py-1 !min-h-0 text-[11px] inline-flex items-center gap-1'}
            onClick={refresh}
            data-testid="mc-graph-refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Обновить
          </button>
        </div>

        <div className="px-4 sm:px-6 pt-1 pb-2 text-[10.5px] text-[#6B7280]" data-testid="mc-graph-period-caption">
          {caption}
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-4 sm:px-6 pb-5" data-mc-graph-body>
          {body}
        </div>
      </div>
    </div>,
    document.body,
  );
}

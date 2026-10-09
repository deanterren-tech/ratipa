/**
 * Окно «Учёта выезда» для КОНКРЕТНОЙ машины и периода.
 *
 * Открывается по единому хелперу openVyezdPeriod (lib/vyezd) из всех мест:
 * полосы/отметки таймлайна, встроенный таймлайн карточек, обзор машины, прямая
 * ссылка #baza/vyezd/<id>. Окно живёт в модуле «Учёт выезда» (BazaModule) и
 * показывает:
 *  - шапку: госномер, диспетчер, период, статус;
 *  - мини-таймлайн машины за период (рейсы, база, ремонт, выделенный период);
 *  - сводку: дни в рейсе / на базе / в ремонте / без пересечений и итоговые
 *    показатели записи (те же формулы, что в карточке автомобиля);
 *  - список записей учёта выезда этой машины;
 *  - блок «Пояснения»: как считается период, что значит статус и предупреждения,
 *    что сделать для исправления (кнопки — в рамках текущих прав).
 *
 * Данные берутся из тех же источников, что у таймлайна (useTimelineData,
 * bazaToBasePeriods): расчёты периодов и бизнес-логика не дублируются и не
 * меняются. Единственное действие правки — существующая карточка записи
 * в BazaModule (openCarModal), со своими правами и журналом изменений.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ExternalLink, ListChecks, Route, Truck, Wrench } from 'lucide-react';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { buildDispatcherDirectory } from '../../../utils/dispatcher';
import { resolvePermission } from '../../../utils/permissions';
import type { AppSettings, UserProfile } from '../../../types';
import { useDialog } from '../../DialogProvider';
import { useTimelineData } from './useTimelineData';
import { CarMiniTimeline } from './TripCard';
import { useWindowHotkeys } from './lib/useWindowHotkeys';
import {
  bazaToBasePeriods,
  baseBarRange,
  baseDeviation,
  buildCarIndex,
  repairBarRange,
  type BasePeriod,
  type WholeTrip,
} from './lib/sources';
import { dayStr, fmtDM, fmtFull, tripSpan } from './lib/timeline';
import {
  nearestPeriodOf,
  replaceVyezdHash,
  tripRangeOf,
  VYEZD_STATUS,
  vyezdStatusIcon,
  vyezdStatusOf,
  vyezdSummaryOf,
  type ParsedVyezdRoute,
} from './lib/vyezd';

interface Props {
  /** Разобранный маршрут окна (#baza/vyezd/...). */
  target: ParsedVyezdRoute;
  /** Исходная запись из данных модуля «Учёт выезда» (любая его ветка), если есть. */
  record?: Record<string, unknown> | null;
  today: number;
  user: UserProfile;
  settings?: AppSettings | null;
  /** Право правки учёта выезда (кнопка «Исправить…»), как в списке модуля. */
  canEdit: boolean;
  /** Поверх окна открыта существующая карточка записи — Esc закрывает её первой. */
  editorOpen: boolean;
  onEditRecord: (recordId: string) => void;
  onOpenTrip: (tripKey: string) => void;
  /** Полный «Учёт выезда»: закрыть окно и показать запись в списке (прокрутка+подсветка). */
  onOpenFull: (recordId: string | null) => void;
  onClose: () => void;
  /** Переключить окно на другую запись этой машины (список записей, мини-таймлайн). */
  onSwitchPeriod: (periodId: string) => void;
}

/** Те же дни между датами, что в карточке автомобиля (календарные, включительно по дню). */
const daysBetweenNums = (a: number | null, b: number | null): string => {
  if (a == null || b == null) return '—';
  const d = b - a;
  return d >= 0 ? `${d} дн.` : '—';
};

export default function VyezdPeriodWindow({
  target,
  record,
  today,
  user,
  settings,
  canEdit,
  editorOpen,
  onEditRecord,
  onOpenTrip,
  onOpenFull,
  onClose,
  onSwitchPeriod,
}: Props) {
  const { showUnsaved } = useDialog();
  const data = useTimelineData();
  /** Асинхронные подписки: до их ответа показываем «загрузку», а не «не найдено». */
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setWaited(true), 2500);
    return () => window.clearTimeout(t);
  }, []);
  const canSeeTrips = resolvePermission(user, 'tripTimeline', settings?.rolePermissions) !== 'none' || user.role === 'root_admin';

  // Тот же справочник машин/диспетчеров, что у таймлайна — для конвертации
  // записи модуля тем же существующим конвертером (без копий логики).
  const dir = useMemo(
    () => buildDispatcherDirectory(data.dispatchers.map((d) => ({ id: d.id, name: d.name }))),
    [data.dispatchers],
  );
  const carIndex = useMemo(
    () =>
      buildCarIndex(
        data.fleetCars.map((c) => ({
          couplingId: c.carId,
          carNumber: c.carNumber,
          dispatcherId: c.dispatcherId,
          dispatcherName: c.dispatcherName,
        })),
      ),
    [data.fleetCars],
  );

  const period: BasePeriod | null = useMemo(() => {
    if (target.kind === 'period' && target.periodId) {
      const found = data.bases.find((p) => p.id === target.periodId);
      if (found) return found;
      if (record) {
        const conv = bazaToBasePeriods([record], carIndex, dir);
        if (conv.length) return conv[0];
      }
      return null;
    }
    const key = target.carKey || '';
    const num = target.carNumber || '';
    const norm = (s: string) => String(s || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
    const list = data.bases.filter(
      (p) => (key && p.carKey === key) || (num && norm(p.carNumber) === norm(num)),
    );
    return nearestPeriodOf(list, today);
  }, [target, data.bases, record, carIndex, dir, today]);

  /** Все периоды этой машины — список записей в окне (текущий включён). */
  const carPeriods = useMemo(() => {
    if (!period) return [];
    const list = data.bases.filter((p) => p.carKey && p.carKey === period.carKey);
    const has = list.some((p) => p.key === period.key);
    return [...(has ? list : [...list, period])].sort(
      (a, b) => (a.arrivalDay ?? a.repairStartDay ?? 0) - (b.arrivalDay ?? b.repairStartDay ?? 0),
    );
  }, [data.bases, period]);

  const carTrips = useMemo(
    () => (period ? data.trips.filter((t) => t.carKey === period.carKey) : []),
    [data.trips, period],
  );
  const carEvents = useMemo(() => {
    if (!period) return [];
    const plate = String(period.carNumber || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
    return data.events.filter((e) => String(e.carNumber || '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '') === plate);
  }, [data.events, period]);
  const tripRanges = useMemo(
    () => carTrips.map((t) => tripRangeOf(t)).filter((r): r is NonNullable<typeof r> => !!r),
    [carTrips],
  );
  const status = useMemo(() => (period ? vyezdStatusOf(period, today, tripRanges) : null), [period, today, tripRanges]);
  const summary = useMemo(() => (period ? vyezdSummaryOf(period, today, tripRanges) : null), [period, today, tripRanges]);

  /** Рейс для кнопки «Перейти к рейсу»: пересекающийся с периодом, иначе ближайший. */
  const jumpTrip: WholeTrip | null = useMemo(() => {
    if (!period || !carTrips.length) return null;
    const rb = baseBarRange(period, today);
    const a = rb?.a ?? period.arrivalDay ?? 0;
    const b = rb?.b ?? a;
    const spanOf = (t: WholeTrip) => {
      const ov = t.spanOverride || {};
      const sp = tripSpan(t);
      const s = ov.pMin ?? sp.pMin ?? null;
      const e = ov.pMax ?? sp.pMax ?? s;
      return s == null ? null : { s, e: Math.max(e ?? s, s) };
    };
    const overlap = carTrips.filter((t) => {
      const z = spanOf(t);
      return z != null && z.s <= b && z.e >= a;
    });
    const pool = overlap.length ? overlap : carTrips;
    return (
      [...pool].sort((x, y) => {
        const zx = spanOf(x);
        const zy = spanOf(y);
        const dx = zx ? Math.min(Math.abs(zx.s - a), Math.abs(zx.e - a)) : 1e9;
        const dy = zy ? Math.min(Math.abs(zy.s - a), Math.abs(zy.e - a)) : 1e9;
        return dx - dy;
      })[0] || null
    );
  }, [period, carTrips, today]);

  /**
   * Закрытие окна: собственных несохранённых правок у окна нет (правки идут
   * через существующую карточку записи), но выход идёт через тот же единый
   * брендированный диалог — при появлении правок поведение уже верное.
   */
  const [dirty] = useState(false);
  const requestClose = useCallback(() => {
    if (editorOpen) return; // сначала закроется карточка записи (свой Esc сверху)
    if (!dirty) {
      onClose();
      return;
    }
    void (async () => {
      const res = await showUnsaved({ changed: [] });
      if (res === 'stay') return;
      onClose();
    })();
  }, [dirty, editorOpen, onClose, showUnsaved]);

  useWindowHotkeys({ onEscape: requestClose });

  /** Переключение окна на другую запись машины: адрес заменяется (без новой записи истории). */
  const switchTo = useCallback(
    (periodId: string) => {
      if (!periodId) return;
      replaceVyezdHash({ periodId, carKey: period?.carKey || null });
      onSwitchPeriod(periodId);
    },
    [period?.carKey, onSwitchPeriod],
  );

  // ── Состояние «не найдено / загрузка» ──────────────────────────────────
  if (!period || !status || !summary) {
    const carLabel = target.carNumber ? ` ${formatPlate(target.carNumber)}` : '';
    return (
      <ModalShell
        isOpen
        onClose={onClose}
        title="Учёт выезда"
        subtitle={`Окно периода${carLabel}`}
        icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
        ariaLabel="Учёт выезда: окно периода"
        closeTitle="Закрыть · Esc"
        hotkeysManaged
        maxWidth="max-w-2xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2 w-full">
            <button type="button" data-ui="vyezd-open-full" onClick={() => onOpenFull(target.periodId)} className={UI.buttonGhost}>
              <ExternalLink className="w-4 h-4" aria-hidden="true" />
              Открыть полный учёт выезда
            </button>
            <button type="button" data-ui="vyezd-close" onClick={onClose} className={UI.buttonPrimary}>
              Закрыть
            </button>
          </div>
        }
      >
        <div className={UI.hint} data-ui="vyezd-window-missing">
          {waited
            ? target.kind === 'period'
              ? 'Запись учёта выезда не найдена: возможно, она удалена или перенесена. Полный список — в «Учёте выезда».'
              : 'По этой машине не найдено ни одной записи учёта выезда.'
            : 'Загрузка записи учёта выезда…'}
        </div>
      </ModalShell>
    );
  }

  const rb = baseBarRange(period, today);
  const rr = repairBarRange(period, today);
  const rdy = period.plannedReadyDay;
  const dev = baseDeviation(period, today);
  const isoOf = (n: number | null): string => (n == null ? '' : dayStr(n));
  const StatusIcon = vyezdStatusIcon(status.kind);
  const stColor = VYEZD_STATUS[status.kind];
  const carOnlyNote =
    target.kind === 'car' && period.id !== target.periodId
      ? 'Период в ссылке не указан — открыт ближайший период этой машины.'
      : '';
  const periodText = `${period.arrivalDay != null ? fmtDM(period.arrivalDay) : 'приезд не указан'} — ${
    period.departureDay != null ? fmtDM(period.departureDay) : 'выезд не указан'
  }`;
  const jumpTripRange = jumpTrip ? tripSpan(jumpTrip) : null;
  const jumpTripText = jumpTrip
    ? `${jumpTrip.route || jumpTrip.key}${
        jumpTripRange?.pMin != null ? ` (${fmtDM(jumpTripRange.pMin)} – ${jumpTripRange.pMax != null ? fmtDM(jumpTripRange.pMax) : '…'})` : ''
      }`
    : '';

  return (
    <ModalShell
      isOpen
      onClose={requestClose}
      title="Учёт выезда: период машины"
      subtitle={`${formatPlate(period.carNumber)} · запись ${period.key}`}
      icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Учёт выезда: окно периода машины"
      closeTitle="Закрыть · Esc"
      hotkeysManaged
      maxWidth="max-w-[min(1180px,94vw)]"
      footer={
        <div className="flex flex-wrap items-center justify-end gap-2 w-full">
          {canEdit ? (
            <button
              type="button"
              data-ui="vyezd-edit"
              onClick={() => onEditRecord(period.id)}
              className={`${UI.buttonGhost} mr-auto`}
              title="Открыть существующую карточку записи (права и журнал изменений — как в списке модуля)"
            >
              Исправить в учёте выезда
            </button>
          ) : null}
          <button type="button" data-ui="vyezd-open-full" onClick={() => onOpenFull(period.id)} className={UI.buttonGhost}>
            <ExternalLink className="w-4 h-4" aria-hidden="true" />
            Открыть полный учёт выезда
          </button>
          <button
            type="button"
            data-ui="vyezd-open-trip"
            onClick={() => jumpTrip && onOpenTrip(jumpTrip.key)}
            disabled={!jumpTrip || !canSeeTrips}
            className={UI.buttonGhost}
            title={
              !canSeeTrips
                ? 'Нет доступа к модулю «Таймлайн рейсов»'
                : jumpTrip
                  ? `Открыть рейс ${jumpTripText}`
                  : 'Рейсов по машине не найдено'
            }
          >
            <Route className="w-4 h-4" aria-hidden="true" />
            Перейти к рейсу
          </button>
          <button type="button" data-ui="vyezd-close" onClick={requestClose} className={UI.buttonPrimary}>
            Закрыть
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5" data-ui="vyezd-window" data-vyezd-window={period.key} data-vyezd-status={status.kind}>
        {/* Шапка: госномер, диспетчер, период, статус */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pb-4 border-b border-[#E5E7EB]">
          <span
            className="inline-flex items-center gap-1.5 h-6 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap"
            style={{ background: stColor.bg, color: stColor.text, border: `1px solid ${stColor.border}` }}
            data-ui="vyezd-status-chip"
          >
            <StatusIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            {status.label}
          </span>
          <span className="font-mono font-semibold text-sm text-[#121316] select-all">{formatPlate(period.carNumber)}</span>
          <span className="text-[11px] text-[#4B5563]">{period.dispatcherName || 'диспетчер не указан'}</span>
          <span className="text-[11px] text-[#4B5563]">
            период: <b className="text-[#121316]">{periodText}</b>
            {rb ? ` · ${rb.b - rb.a + 1} дн` : ''}
          </span>
          {period.archived ? <span className={UI.chip}>архив</span> : null}
        </div>

        {carOnlyNote ? (
          <div className="text-[11px] text-[#8A5A0A] bg-[#FBEFD4] border border-[#E3B04B] rounded-xl px-3 py-2" role="status">
            {carOnlyNote}
          </div>
        ) : null}

        {/* Мини-таймлайн машины за период: рейсы, база, ремонт, выделенный период */}
        <div className="flex flex-col gap-2">
          <h3 className={UI.sectionTitle}>Таймлайн машины за период</h3>
          {canSeeTrips ? (
            <CarMiniTimeline
              focusKey={null}
              carTrips={carTrips}
              carBases={carPeriods}
              carEvents={carEvents}
              stageTypes={data.stageTypes}
              today={today}
              highlightRange={rb ? { a: rb.a, b: rb.b } : null}
              onSelectTrip={(key) => onOpenTrip(key)}
              onOpenBasePeriod={(key) => {
                const p = data.bases.find((b) => b.key === key);
                if (p && p.id !== period.id) switchTo(p.id);
              }}
            />
          ) : (
            <div className={UI.hint}>
              Рейсы в мини-таймлайне скрыты: нет доступа к модулю «Таймлайн рейсов». Периоды базы и ремонта показаны ниже.
            </div>
          )}
        </div>

        {/* Сводка: дни по состояниям + итоговые показатели записи */}
        <div className="flex flex-col gap-2">
          <h3 className={UI.sectionTitle}>Сводка по периоду</h3>
          <div className="border border-[#E5E7EB] rounded-xl overflow-hidden text-[11px]">
            <div className="px-3 py-2 bg-[#F9FAFB] flex flex-wrap items-center gap-x-6 gap-y-1.5 text-[#4B5563]">
              <span className="inline-flex items-center gap-1.5">
                <Truck className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
                Дней на базе: <b className="text-[#121316] font-mono tabular-nums">{summary.total}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Route className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
                Дней в рейсе: <b className="text-[#121316] font-mono tabular-nums">{summary.tripDays}</b>
                {summary.trips.length ? (
                  <span className="text-[#6B7280]">
                    ({summary.trips.map((t) => `${t.label}${t.boundary ? ' — стык' : ''}`).join(', ')})
                  </span>
                ) : null}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <Wrench className="w-3.5 h-3.5 text-[#D97706]" aria-hidden="true" />
                Дней в ремонте: <b className="text-[#121316] font-mono tabular-nums">{summary.repairDays}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="w-3.5 h-3.5 text-[#6B7280]" aria-hidden="true" />
                Без пересечений с рейсом и ремонтом: <b className="text-[#121316] font-mono tabular-nums">{summary.freeDays}</b>
              </span>
            </div>
            <div className="px-3 py-2 text-[#4B5563] flex flex-col gap-1.5 border-t border-[#E5E7EB]">
              <span>
                План: приезд → срок готовности:{' '}
                <b className="text-[#121316]">
                  {period.arrivalDay != null || rdy != null
                    ? `${period.arrivalDay != null ? fmtFull(isoOf(period.arrivalDay)) : '—'} → ${rdy != null ? fmtFull(isoOf(rdy)) : 'срок готовности не указан'}`
                    : '—'}
                </b>
              </span>
              <span>
                Факт: приезд → фактический выезд:{' '}
                <b className="text-[#121316]">
                  {period.arrivalDay != null
                    ? `${fmtFull(isoOf(period.arrivalDay))} → ${period.departureDay != null ? fmtFull(isoOf(period.departureDay)) : 'выезд не указан'}`
                    : '—'}
                </b>
              </span>
              <span>
                Отклонение выезда от срока готовности: <b className={dev.kind === 'late' || dev.kind === 'overdue' ? 'text-rose-600' : dev.kind === 'early' ? 'text-emerald-600' : 'text-[#4B5563]'}>{dev.label}</b>
              </span>
              {rr ? (
                <span>
                  Ремонт: <b className="text-[#121316]">{fmtFull(isoOf(rr.a))} → {period.repairEndDay != null ? fmtFull(isoOf(period.repairEndDay)) : rr.capped ? 'до фактического выезда (окончание не указано)' : 'продолжается'}</b>
                </span>
              ) : null}
            </div>
            {/* Итоговые показатели записи — те же формулы и подписи, что в карточке автомобиля */}
            <div className="px-3 py-2 border-t border-[#E5E7EB] flex flex-wrap items-center gap-x-8 gap-y-2">
              <span className="text-[#6B7280]">Итоговые показатели записи:</span>
              <span className="inline-flex items-center gap-1.5">
                Дни отдыха водит.: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.arrivalDay, rdy)}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                Ожидание ремонта: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.arrivalDay, period.repairStartDay)}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                Дни ремонта: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.repairStartDay, period.repairEndDay)}</b>
              </span>
              <span className="inline-flex items-center gap-1.5">
                Общий простой: <b className="font-mono tabular-nums text-[#121316]">{daysBetweenNums(period.arrivalDay, period.departureDay)}</b>
              </span>
            </div>
          </div>
        </div>

        {/* Список записей учёта выезда этой машины */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <ListChecks className="w-4 h-4 text-[#6B7280]" aria-hidden="true" />
            <h3 className={UI.sectionTitle}>Записи учёта выезда этой машины ({carPeriods.length})</h3>
          </div>
          <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB]">
            {carPeriods.map((p) => {
              const ps = vyezdStatusOf(p, today, tripRanges);
              const pIcon = vyezdStatusIcon(ps.kind);
              const pColor = VYEZD_STATUS[ps.kind];
              const cur = p.key === period.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  data-ui="vyezd-record-row"
                  data-vyezd-record={p.key}
                  data-vyezd-current={cur ? '1' : undefined}
                  onClick={() => {
                    if (!cur) switchTo(p.id);
                  }}
                  className={`w-full text-left px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 transition-colors cursor-pointer ${
                    cur ? 'bg-[var(--accent-8)]' : 'hover:bg-[#F9FAFB]'
                  }`}
                  title={ps.reason}
                >
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold" style={{ color: pColor.text }}>
                    {(() => {
                      const I = pIcon;
                      return <I className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />;
                    })()}
                    {ps.short}
                  </span>
                  <span className="text-[11px] text-[#4B5563]">
                    база: {p.arrivalDay != null ? fmtDM(p.arrivalDay) : '—'} – {p.departureDay != null ? fmtDM(p.departureDay) : 'выезд не указан'}
                  </span>
                  {p.plannedReadyDay != null ? <span className="text-[11px] text-[#6B7280]">готовность: {fmtDM(p.plannedReadyDay)}</span> : null}
                  {p.repairStartDay != null ? (
                    <span className="text-[11px] text-[#B45309]">
                      ремонт: {fmtDM(p.repairStartDay)} – {p.repairEndDay != null ? fmtDM(p.repairEndDay) : 'не завершён'}
                    </span>
                  ) : null}
                  {p.archived ? <span className={UI.chip}>архив</span> : null}
                  {cur ? <span className={UI.chip}>открыта в окне</span> : null}
                  {p.warnings.length ? <span className="text-[10px] text-amber-700">предупреждения: {p.warnings.length}</span> : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Пояснения: как считается период, что значит статус, что сделать */}
        <div className="flex flex-col gap-2" data-ui="vyezd-explanations">
          <h3 className={UI.sectionTitle}>Пояснения</h3>
          <div className="border border-[#E5E7EB] rounded-xl overflow-hidden text-[11px]">
            <div className="px-3 py-2 text-[#4B5563] leading-relaxed border-b border-[#E5E7EB]">
              <b className="text-[#121316]">Как считается период.</b> Период «учёта выезда» — от даты приезда на базу до фактического выезда. Пока
              выезд не внесён, период показывается открытым до сегодняшней даты; сегодняшняя дата в данные не записывается, срок готовности не
              продлевается автоматически.
            </div>
            <div className="px-3 py-2 text-[#4B5563] leading-relaxed border-b border-[#E5E7EB]">
              <b className="text-[#121316]">Что значит статус «{status.label}».</b> {status.reason}
            </div>
            <div className="px-3 py-2 text-[#4B5563] leading-relaxed border-b border-[#E5E7EB]" data-ui="vyezd-conflicts">
              <b className="text-[#121316]">Пересечения с рейсами.</b>{' '}
              {status.conflicts.length ? (
                <span className="flex flex-col gap-1 mt-1">
                  {status.conflicts.map((c) => (
                    <span key={`${c.label}-${c.a}`} className={c.boundary ? 'text-[#6B7280]' : 'text-[#9F1239] font-medium'}>
                      • {c.label} {fmtDM(c.a)} – {fmtDM(c.b)}:{' '}
                      {c.boundary
                        ? `общий день стыка (${fmtDM(c.overlapA)}) — это не расхождение`
                        : `общих дней — ${c.days} (${fmtDM(c.overlapA)} – ${fmtDM(c.overlapB)}): проверьте даты`}
                    </span>
                  ))}
                </span>
              ) : (
                'Пересечений периода с рейсами этой машины нет.'
              )}
            </div>
            {period.warnings.length ? (
              <div className="px-3 py-2 border-b border-[#E5E7EB] text-[#8A5A0A] bg-[#FBEFD4]" role="alert">
                <b>Предупреждения записи.</b>{' '}
                <span className="flex flex-col gap-1 mt-1">
                  {period.warnings.map((w) => (
                    <span key={w}>• {w}</span>
                  ))}
                </span>
              </div>
            ) : (
              <div className="px-3 py-2 border-b border-[#E5E7EB] text-[#6B7280]">Предупреждений по датам записи нет.</div>
            )}
            <div className="px-3 py-2 text-[#4B5563] leading-relaxed">
              <b className="text-[#121316]">Что сделать.</b>{' '}
              {status.kind === 'no-departure'
                ? 'Если машина уже выехала — внесите фактический выезд'
                : status.kind === 'conflict'
                  ? 'Сверьте даты рейса и простоя: рейс правится в «Плане дохода», простой — в «Учёте выезда»'
                  : status.kind === 'active'
                    ? 'Действий не требуется: когда машина выедет, внесите фактический выезд — период закроется'
                    : 'Действий не требуется: период закрыт фактическим выездом'}
              {period.departureDay == null && period.plannedReadyDay != null && dev.kind !== 'overdue'
                ? ` (срок готовности — ${fmtDM(period.plannedReadyDay)})`
                : ''}
              .{' '}
              {canEdit ? (
                <button type="button" data-ui="vyezd-edit-inline" onClick={() => onEditRecord(period.id)} className="underline text-[var(--accent-ink)] font-medium cursor-pointer">
                  Открыть карточку записи
                </button>
              ) : (
                <span className="text-[#6B7280]">Изменение записи недоступно: нет права правки учёта выезда.</span>
              )}
            </div>
          </div>
          {jumpTrip ? (
            <div className={UI.hint}>
              Связанный рейс для перехода: {jumpTripText}
              {!canSeeTrips ? ' (переход скрыт: нет доступа к «Таймлайну рейсов»)' : ''}
            </div>
          ) : (
            <div className={UI.hint}>Рейсов по машине не найдено — переход к рейсу недоступен.</div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

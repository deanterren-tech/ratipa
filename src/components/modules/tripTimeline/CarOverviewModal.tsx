/**
 * Обзор машины: её рейсы (целые) и периоды «Учёта выезда» (база и ремонт),
 * а также встроенный таймлайн машины (единый компонент с карточкой рейса):
 * вся хронология — архивные, текущие и будущие рейсы, база, ремонт, готовность,
 * этапы и события; без выбранного рейса позиция — на сегодняшней дате.
 */
import { CalendarRange, Truck, Wrench } from 'lucide-react';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { dayStr, fmtFull, tripSpan } from './lib/timeline';
import { planBarLabelParts } from './PlanBarLabel';
import type { BasePeriod, WholeTrip } from './lib/sources';
import type { TimelineStageType, TimelineVehicleEvent } from '../../../types';
import { CarMiniTimeline } from './TripCard';
import { useWindowHotkeys } from './lib/useWindowHotkeys';

interface Props {
  carKey: string | null;
  carNumber: string;
  trips: WholeTrip[];
  bases: BasePeriod[];
  events: TimelineVehicleEvent[];
  stageTypes: TimelineStageType[];
  today: number;
  onSelectTrip: (tripKey: string) => void;
  onSelectPeriod: (periodKey: string) => void;
  /** Клик по маркеру события связанного рейса — открыть рейс и показать запись. */
  onOpenEventTrip?: (tripKey: string, eventId: string) => void;
  onClose: () => void;
}

const iso = (n: number | null): string => (n == null ? '' : dayStr(n));

export default function CarOverviewModal({
  carKey,
  carNumber,
  trips,
  bases,
  events,
  stageTypes,
  today,
  onSelectTrip,
  onSelectPeriod,
  onOpenEventTrip,
  onClose,
}: Props) {
  // Esc закрывает окно машины (общий хук окон модуля; календари/подтверждения
  // верхних слоёв перехватывают клавишу раньше). Вызов до раннего return — hooks-порядок стабилен.
  useWindowHotkeys({ onEscape: onClose });
  if (!carKey) return null;
  const myTrips = [...trips].sort(
    (a, b) => ((a.spanOverride?.pMin ?? tripSpan(a).pMin) ?? 0) - ((b.spanOverride?.pMin ?? tripSpan(b).pMin) ?? 0),
  );
  const myBases = [...bases].sort((a, b) => (a.arrivalDay ?? 0) - (b.arrivalDay ?? 0));

  return (
    <ModalShell
      isOpen={!!carKey}
      onClose={onClose}
      title={`Машина ${formatPlate(carNumber)}`}
      subtitle="Обзор рейсов и периодов на базе"
      icon={<Truck className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Обзор рейсов машины"
      closeTitle="Закрыть · Esc"
      hotkeysManaged
      maxWidth="max-w-[min(1200px,94vw)]"
    >
      <div className="flex flex-col gap-5">
        {/* Встроенный таймлайн машины — единый компонент (тот же, что в карточке
            рейса): вся хронология доступна прокруткой; выбранного рейса нет —
            позиция на сегодняшней дате */}
        <div className="flex flex-col gap-2">
          <h3 className={UI.sectionTitle}>Таймлайн машины</h3>
          <CarMiniTimeline
            focusKey={null}
            carTrips={trips}
            carBases={bases}
            carEvents={events}
            stageTypes={stageTypes}
            today={today}
            onSelectTrip={onSelectTrip}
            onOpenEventTrip={onOpenEventTrip}
            onOpenBasePeriod={onSelectPeriod}
          />
        </div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CalendarRange className="w-4 h-4 text-[#6B7280]" aria-hidden="true" />
            <h3 className={UI.sectionTitle}>Рейсы ({myTrips.length})</h3>
          </div>
          {myTrips.length ? (
            <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB]">
              {myTrips.map((t) => {
                const sp = tripSpan(t);
                const start = t.spanOverride?.pMin ?? sp.pMin ?? sp.fMin ?? null;
                const end = t.spanOverride?.pMax ?? sp.pMax ?? sp.fMax ?? null;
                const parts = planBarLabelParts(t);
                return (
                  <button
                    key={t.key}
                    type="button"
                    data-cov-trip={t.key}
                    onClick={() => onSelectTrip(t.key)}
                    title={parts.titleText}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#F9FAFB] transition-colors cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <span className="text-[11px] font-semibold text-[#121316]">
                      {parts.main}
                      {parts.meta ? <span className="text-[#6B7280] font-medium">{parts.meta}</span> : null}
                    </span>
                    {t.kind === 'plan' ? <span className={UI.chip}>из Плана дохода</span> : <span className={UI.chip}>ручной рейс</span>}
                    {t.archived ? <span className={UI.chip}>архив</span> : null}
                    <span className="text-[11px] text-[#6B7280]">
                      план: {fmtFull(iso(start))} – {fmtFull(iso(end))}
                    </span>
                    <span className="text-[11px] text-[#6B7280]">
                      факт: {sp.fMin != null ? `${fmtFull(iso(sp.fMin))} – ${sp.fMax != null ? fmtFull(iso(sp.fMax)) : 'окончание не указано'}` : 'Нет фактических данных'}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={UI.hint}>Нет рейсов в выбранном периоде.</div>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <Wrench className="w-4 h-4 text-[#D97706]" aria-hidden="true" />
            <h3 className={UI.sectionTitle}>Периоды «Учёта выезда» ({myBases.length})</h3>
          </div>
          {myBases.length ? (
            <div className="border border-[#E5E7EB] rounded-xl divide-y divide-[#E5E7EB]">
              {myBases.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  data-cov-base={p.key}
                  onClick={() => onSelectPeriod(p.key)}
                  className="w-full text-left px-3 py-2.5 hover:bg-[#F9FAFB] transition-colors cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <span className="text-[11px] font-semibold text-[#121316]">{p.causeLabel}</span>
                  <span className="text-[11px] text-[#6B7280]">
                    {p.departureDay != null
                      ? `простой на базе: ${fmtFull(iso(p.arrivalDay))} – ${fmtFull(iso(p.departureDay))}`
                      : `готовится к выезду (дата выезда не указана): ${p.arrivalDay != null ? fmtFull(iso(p.arrivalDay)) : '—'} – …`}
                  </span>
                  {p.repairStartDay != null ? (
                    <span className="text-[11px] text-[#B45309]">
                      ремонт: {fmtFull(iso(p.repairStartDay))} – {p.repairEndDay != null ? fmtFull(iso(p.repairEndDay)) : 'не завершён'}
                    </span>
                  ) : null}
                  {p.warnings.length ? <span className="text-[10px] text-amber-700">предупреждения: {p.warnings.length}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className={UI.hint}>Периодов на базе по этой машине нет.</div>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * Обзор машины: её рейсы (целые) и периоды «Учёта выезда» (база и ремонт).
 * Открывается кликом по названию машины на таймлайне. Позволяет выбрать
 * конкретный рейс — случайный не выбирается, если рейсов несколько.
 */
import { CalendarRange, Truck, Wrench } from 'lucide-react';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { dayStr, fmtFull, tripSpan } from './lib/timeline';
import type { BasePeriod, WholeTrip } from './lib/sources';

interface Props {
  carKey: string | null;
  carNumber: string;
  trips: WholeTrip[];
  bases: BasePeriod[];
  today: number;
  onSelectTrip: (tripKey: string) => void;
  onSelectPeriod: (periodKey: string) => void;
  onClose: () => void;
}

const iso = (n: number | null): string => (n == null ? '' : dayStr(n));

export default function CarOverviewModal({
  carKey,
  carNumber,
  trips,
  bases,
  onSelectTrip,
  onSelectPeriod,
  onClose,
}: Props) {
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
      maxWidth="max-w-2xl"
    >
      <div className="flex flex-col gap-5">
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
                return (
                  <button
                    key={t.key}
                    type="button"
                    data-cov-trip={t.key}
                    onClick={() => onSelectTrip(t.key)}
                    className="w-full text-left px-3 py-2.5 hover:bg-[#F9FAFB] transition-colors cursor-pointer flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <span className="text-[11px] font-semibold text-[#121316]">{t.route || 'без маршрута'}</span>
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
                    база: {fmtFull(iso(p.arrivalDay))} – {p.departureDay != null ? fmtFull(iso(p.departureDay)) : 'выезд не указан'}
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

/**
 * Статистика модуля: KPI по рейсам и срокам, таблица по типам этапов и
 * таблица загрузки машин за окно таймлайна (до сегодня). Все цифры считаются
 * из отфильтрованных по диспетчеру рейсов; загрузка — по фактической занятости
 * (любой рейс машины, как в прототипе).
 */
import { useMemo } from 'react';
import type { TimelineStageType, TimelineVehicleEvent } from '../../../types';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import {
  computeFleetLoad,
  computeKpi,
  computeStageTypeStats,
  fmtAvg,
  fmtDM,
  fmtFull,
} from './lib/timeline';
import { repairBarRange, type BasePeriod, type WholeTrip } from './lib/sources';

interface Props {
  /** Целые рейсы, отфильтрованные по вкладке диспетчера (включая архивные). */
  trips: WholeTrip[];
  /** Все рейсы модуля — для расчёта фактической загрузки. */
  allTrips: WholeTrip[];
  allEvents: TimelineVehicleEvent[];
  /** Периоды «Учёта выезда» (база и ремонт) по вкладке. */
  bases: BasePeriod[];
  stageTypes: TimelineStageType[];
  /** Окно таймлайна: с какого дня и по какой (обычно до сегодня). */
  from: number;
  to: number;
  /** Реальная сегодняшняя дата — KPI по критическим срокам считается от неё. */
  today: number;
}

export default function StatsBlock({ trips, allTrips, allEvents, bases, stageTypes, from, to, today }: Props) {
  const kpi = useMemo(() => computeKpi(trips, today), [trips, today]);
  const typeStats = useMemo(() => computeStageTypeStats(trips, stageTypes), [trips, stageTypes]);
  const loadRows = useMemo(() => {
    const plates = Array.from(new Set(trips.map((t) => t.carNumber).filter(Boolean)));
    // Дни ремонта: сегменты ремонта из «Учёта выезда» (открытые — до сегодня/выезда)
    const repairs: Record<string, Array<{ a: number; b: number }>> = {};
    bases.forEach((p) => {
      const r = repairBarRange(p, today);
      if (!r) return;
      (repairs[p.carNumber] = repairs[p.carNumber] || []).push({ a: r.a, b: r.b });
    });
    return computeFleetLoad(plates, allTrips, allEvents, repairs, from, to);
  }, [trips, allTrips, allEvents, bases, from, to, today]);

  const cards: Array<{ value: string; label: string; bad?: boolean }> = [
    { value: String(kpi.total), label: 'рейсов (с архивом)' },
    { value: String(kpi.withCritical), label: 'с крит. сроком' },
    { value: String(kpi.violated), label: 'сроки нарушены', bad: kpi.violated > 0 },
    { value: String(kpi.atRisk), label: 'под угрозой', bad: kpi.atRisk > 0 },
    { value: fmtAvg(kpi.avgDeviation), label: 'среднее откл. по этапам, дн' },
    { value: String(kpi.lateWithoutReason), label: 'просрочек без причины', bad: kpi.lateWithoutReason > 0 },
  ];

  return (
    <div className="flex flex-col gap-6 min-w-0">
      {/* KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="border border-[#E5E7EB] rounded-2xl bg-white px-3 py-2.5">
            <div className={`text-lg font-bold tabular-nums ${c.bad ? 'text-rose-600' : 'text-[#121316]'}`}>{c.value}</div>
            <div className="text-[10px] text-[#6B7280] leading-tight mt-0.5">{c.label}</div>
          </div>
        ))}
      </div>

      {/* По типам этапов */}
      <div className="flex flex-col gap-3">
        <h3 className={UI.sectionTitle}>Отклонения по типам этапов</h3>
        {typeStats.length === 0 ? (
          <p className={UI.hint}>Пока нет этапов с заполненными планом и фактом — статистика появится после первых замеров.</p>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className={UI.theadRow}>
                  <th className={UI.th}>Тип этапа</th>
                  <th className={UI.th}>Замеров</th>
                  <th className={UI.th}>Среднее откл., дн</th>
                  <th className={UI.th}>Макс. задержка</th>
                  <th className={UI.th}>В срок или раньше</th>
                </tr>
              </thead>
              <tbody>
                {typeStats.map((s) => (
                  <tr key={s.key} className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors">
                    <td className={UI.tdStrong}>{s.name}</td>
                    <td className={UI.td}>{s.count}</td>
                    <td className={`${UI.td} tabular-nums ${s.avg > 0 ? 'text-rose-600 font-semibold' : ''}`}>{fmtAvg(s.avg)}</td>
                    <td className={`${UI.td} tabular-nums`}>{s.maxDelay}</td>
                    <td className={`${UI.td} tabular-nums`}>{s.onTimePct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Загрузка машин */}
      <div className="flex flex-col gap-3">
        <h3 className={UI.sectionTitle}>
          Загрузка машин: {fmtDM(from)} – {fmtDM(to)} (до сегодня)
        </h3>
        {loadRows.length === 0 ? (
          <p className={UI.hint}>В окне нет машин с рейсами — заполните рейсы, и здесь появится загрузка.</p>
        ) : (
          <div className="w-full overflow-x-auto">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className={UI.theadRow}>
                  <th className={UI.th}>Машина</th>
                  <th className={UI.th}>В рейсе, дн</th>
                  <th className={UI.th}>Ремонт, дн</th>
                  <th className={UI.th}>Простой на базе, дн</th>
                  <th className={UI.th}>Загрузка</th>
                </tr>
              </thead>
              <tbody>
                {loadRows.map((r) => (
                  <tr key={r.plate} className="border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors">
                    <td className={UI.tdMono}>{formatPlate(r.plate)}</td>
                    <td className={UI.td}>{r.tripDays}</td>
                    <td className={UI.td}>{r.repairDays}</td>
                    <td className={UI.td}>{r.baseDays}</td>
                    <td className={`${UI.td} tabular-nums font-semibold text-[#121316]`}>{r.loadPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className={UI.hint}>
          «В рейсе» — день покрыт любым рейсом машины (включая архивные); «ремонт» — событие типа «Ремонт»; остальные дни — простой на базе («Учёт выезда»).
          {allTrips.length > trips.length ? ` Фильтр по диспетчеру сузил список машин: ${trips.length} из ${allTrips.length} рейсов.` : ''}
        </p>
      </div>

      {/* Параметры счёта */}
      <p className={UI.hint}>
        Период таймлайна начинается {fmtFull(
          new Date(from * 86400000).toISOString().slice(0, 10),
        )} — окно меняется вкладкой «Таймлайн», статистика следует за ним.
      </p>
    </div>
  );
}

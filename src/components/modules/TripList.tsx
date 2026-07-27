import React, { useState, useMemo } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { TripPlan } from '../../types';
import { MapPin, Archive } from 'lucide-react';

interface TripListProps {
  list: TripPlan[];
  archived: boolean;
  loadTripToForm: (trip: TripPlan) => void;
  handleTripDrop: (e: React.DragEvent, tripId: string) => void;
  finishTripToArchive: (trip: TripPlan, isModal?: boolean) => void;
  highlightedCar: string | null;
  getDispatcherColor: (dispatcher: string) => string;
}

export const TripList = React.memo(({
  list,
  archived,
  loadTripToForm,
  handleTripDrop,
  finishTripToArchive,
  highlightedCar,
  getDispatcherColor,
}: TripListProps) => {
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(null);

  const handleSort = (key: string) => {
    setSortConfig((prev) => {
      if (!prev || prev.key !== key) return { key, dir: 'desc' };
      if (prev.dir === 'desc') return { key, dir: 'asc' };
      return null;
    });
  };

  const renderSortIndicator = (sortKey: string) => {
    if (sortConfig?.key !== sortKey) return null;
    return (
      <span className="text-slate-500 ml-1">
        {sortConfig.dir === 'asc' ? '↑' : '↓'}
      </span>
    );
  };

  const sortedList = useMemo(() => {
    if (!sortConfig) return list;
    const { key, dir } = sortConfig;
    return [...list].sort((a, b) => {
      let valA: string | number = '';
      let valB: string | number = '';
      if (key === 'carNumber') {
        valA = a.carNumber || '';
        valB = b.carNumber || '';
      } else if (key === 'dateStart') {
        valA = a.dateStart || '';
        valB = b.dateStart || '';
      } else if (key === 'km') {
        valA = a.factKm || a.totalKm || 0;
        valB = b.factKm || b.totalKm || 0;
      } else if (key === 'freight') {
        valA = a.totalFreight || 0;
        valB = b.totalFreight || 0;
      } else if (key === 'profit') {
        valA = a.profitFact ?? a.profit ?? 0;
        valB = b.profitFact ?? b.profit ?? 0;
      }
      if (valA < valB) return dir === 'asc' ? -1 : 1;
      if (valA > valB) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [list, sortConfig]);

  return (
    <div className="flex flex-col gap-4 relative w-full">
      {/* Table Headers */}
      <div className="hidden lg:flex px-6 pb-3 border-b border-slate-200/40 text-xs font-medium text-slate-400 self-start w-full cursor-pointer select-none tracking-normal">
        <div
          className="min-w-[200px] hover:text-slate-700 transition flex items-center gap-1"
          onClick={() => handleSort('carNumber')}
        >
          Автомобиль {renderSortIndicator('carNumber')}
        </div>
        <div
          className="min-w-[140px] hover:text-slate-700 transition flex items-center gap-1"
          onClick={() => handleSort('dateStart')}
        >
          Даты {renderSortIndicator('dateStart')}
        </div>
        <div className="flex-1 min-w-[220px]">Маршрут</div>
        <div className="min-w-[320px] flex gap-4 pl-6 justify-end">
          <span
            className="w-20 hover:text-slate-700 transition flex items-center gap-1 justify-end"
            onClick={() => handleSort('km')}
          >
            Км {renderSortIndicator('km')}
          </span>
          <span
            className="w-20 hover:text-slate-700 transition flex items-center gap-1 justify-end"
            onClick={() => handleSort('freight')}
          >
            Фрахт {renderSortIndicator('freight')}
          </span>
          <span className="w-20 text-right">Расходы</span>
          <span
            className="w-24 hover:text-slate-700 transition flex items-center gap-1 justify-end"
            onClick={() => handleSort('profit')}
          >
            Прибыль {renderSortIndicator('profit')}
          </span>
          <span className="w-12 text-right">Дни</span>
          <span className="w-20 text-right">В день</span>
        </div>
      </div>

      <Virtuoso
        useWindowScroll
        data={sortedList}
        itemContent={(idx, trip) => {
          const firstLeg = trip.legs?.[0];
          const lastLeg = trip.legs?.[trip.legs.length - 1];
          const routeTitle =
            firstLeg?.from && lastLeg?.to
              ? `${firstLeg.from} ➔ ${lastLeg.to}`
              : 'Плечи маршрута';
          const cardBg = getDispatcherColor(trip.dispatcher || '');

          const isHighlighted =
            trip.carNumber &&
            highlightedCar === trip.carNumber.trim().toUpperCase();

          return (
            <div
              key={trip.id}
              data-trip-id={trip.id}
              onClick={() => loadTripToForm(trip)}
              className={`car-strip-item ${cardBg} rounded-2xl p-4.5 pl-5 border hover:shadow-[0_8px_30px_rgba(15,23,42,0.04)] hover:border-slate-300 transition-all duration-200 group relative flex flex-col xl:flex-row gap-5 items-start xl:items-center cursor-pointer mb-3 ${
                isHighlighted
                  ? 'border-amber-500 ring-2 ring-amber-500/25 shadow-[0_10px_25px_rgba(245,158,11,0.06)] scale-[1.002]'
                  : 'border-slate-200/60'
              }`}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData('tripId', trip.id);
                e.stopPropagation();
              }}
              onDragOver={(e) => {
                e.preventDefault();
              }}
              onDrop={(e) => {
                handleTripDrop(e, trip.id);
                e.stopPropagation();
              }}
            >
              {/* Left color accent strip */}
              <div
                className={`absolute left-0 top-0 bottom-0 w-1.5 ${trip.stripColor || 'bg-slate-200'} rounded-l-2xl`}
              />

              {/* Main block: Car & Direction */}
              <div className="flex flex-col gap-1 min-w-[200px] shrink-0">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-base font-bold text-slate-900 tracking-tight font-sans">
                    {trip.carNumber}
                  </span>
                  <span className="bg-slate-100 text-slate-600 text-[10px] font-medium px-2 py-0.5 rounded-full border border-slate-200/40 uppercase tracking-wider">
                    {trip.direction}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 font-medium">
                  Диспетчер:{' '}
                  <span className="text-slate-700 font-semibold">
                    {trip.dispatcher || trip.logist || '—'}
                  </span>
                </div>
              </div>

              {/* Date block */}
              <div className="flex flex-col gap-1 min-w-[140px] shrink-0 text-xs text-slate-500 font-sans">
                <div className="flex justify-between gap-4 items-center">
                  <span className="text-slate-400 text-[10px] font-medium uppercase tracking-wider">Старт</span>
                  <span className="text-slate-800 font-semibold font-mono">
                    {trip.dateStart
                      ? new Date(trip.dateStart).toLocaleDateString('ru-RU')
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-4 items-center">
                  <span className="text-slate-400 text-[10px] font-medium uppercase tracking-wider">Финиш</span>
                  <span className="text-slate-800 font-semibold font-mono">
                    {trip.dateEnd
                      ? new Date(trip.dateEnd).toLocaleDateString('ru-RU')
                      : '—'}
                  </span>
                </div>
              </div>

              {/* Itinerary */}
              <div className="flex-1 w-full bg-slate-50/20 rounded-xl p-3 border border-slate-200/40 min-w-[220px]">
                <div className="text-xs font-semibold text-slate-800 mb-2 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span className="tracking-tight text-slate-800 font-semibold">{routeTitle}</span>
                </div>
                {trip.legs && trip.legs.length > 0 ? (
                  <div className="flex flex-col gap-1 pl-1 border-l-2 border-slate-200/30 ml-1.5">
                    {trip.legs.map((leg, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-2 text-xs text-slate-500"
                      >
                        <div className="w-2 h-2 rounded-full bg-slate-200 border-white flex-shrink-0 -ml-[10px]" />
                        <span className="truncate">
                          {leg.from || '?'} ➔ {leg.to || '?'}
                        </span>
                        {leg.ferry > 0 && (
                          <span className="text-blue-500 text-[9px] font-medium bg-blue-50/50 px-1 py-0.5 rounded border border-blue-100">
                            ⛴ Ferry
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400 italic">Маршрут не задан</div>
                )}
              </div>

              {/* Metrics grid */}
              <div className="grid grid-cols-3 xl:flex xl:items-center gap-4 w-full xl:w-[320px] xl:pl-6 justify-between xl:justify-end border-t xl:border-t-0 border-slate-100 pt-3.5 xl:pt-0 shrink-0">
                <div className="flex flex-col gap-0.5 w-20 xl:text-right">
                  <span className="text-[10px] font-medium text-slate-400">Км</span>
                  <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums whitespace-nowrap">
                    {Math.round(trip.factKm || trip.totalKm || 0).toLocaleString('ru-RU')}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 w-20 xl:text-right">
                  <span className="text-[10px] font-medium text-slate-400">Фрахт</span>
                  <span className="text-xs font-semibold text-slate-700 font-mono tabular-nums whitespace-nowrap">
                    {Math.round(trip.totalFreight || 0).toLocaleString('ru-RU')}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 w-20 xl:text-right">
                  <span className="text-[10px] font-medium text-slate-400">Расходы</span>
                  <span className="text-xs font-semibold text-rose-600/90 font-mono tabular-nums whitespace-nowrap">
                    {Math.round(trip.totalExpenses !== undefined ? trip.totalExpenses : (trip.totalFreight - (trip.profit || 0))).toLocaleString('ru-RU')}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 w-24 xl:text-right">
                  <span className="text-[10px] font-medium text-slate-400">Прибыль</span>
                  <span className={`text-sm font-bold font-mono tabular-nums whitespace-nowrap ${(trip.profitFact ?? trip.profit ?? 0) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {Math.round(trip.profitFact ?? trip.profit ?? 0).toLocaleString('ru-RU')}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 w-12 text-right">
                  <span className="text-[10px] font-medium text-slate-400">Дни</span>
                  <span className="text-xs font-semibold font-mono text-slate-600 tabular-nums">
                    {trip.days || '—'}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5 w-20 text-right">
                  <span className="text-[10px] font-medium text-slate-400">В день</span>
                  <span className={`text-xs font-semibold font-mono tabular-nums ${Math.round((trip.profitFact ?? trip.profit ?? 0) / (trip.days || 1)) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                    {Math.round((trip.profitFact ?? trip.profit ?? 0) / (trip.days || 1)).toLocaleString('ru-RU')}
                  </span>
                </div>
              </div>

              {/* Archive button */}
              <div className="flex items-center gap-1.5 mt-2 xl:opacity-0 xl:group-hover:opacity-100 transition-all duration-150">
                {!archived && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      finishTripToArchive(trip);
                    }}
                    className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-md transition"
                    title="В архив"
                  >
                    <Archive className="w-3.5 h-3.5 stroke-[1.8]" />
                  </button>
                )}
              </div>
            </div>
          );
        }}
      />
    </div>
  );
});
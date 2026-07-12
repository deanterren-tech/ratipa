import React, { useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { TripPlan } from '../../types';

interface TripListProps {
  list: TripPlan[];
  archived: boolean;
  loadTripToForm: (trip: TripPlan) => void;
  handleTripDrop: (e: React.DragEvent, tripId: string) => void;
  finishTripToArchive: (trip: TripPlan, isModal?: boolean) => void;
  highlightedCar: string | null;
  getDispatcherColor: (dispatcher: string) => string;
  isArchived: boolean;
  finishTripToArchiveHandler: (trip: TripPlan) => void;
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
  return (
    <Virtuoso 
      useWindowScroll 
      data={list} 
      itemContent={(idx, trip) => {
          const firstLeg = trip.legs?.[0];
          const lastLeg = trip.legs?.[trip.legs.length - 1];
          const routeTitle =
            firstLeg?.from && lastLeg?.to
              ? `${firstLeg.from} ➔ ${lastLeg.to}`
              : "Плечи маршрута";
          const cardBg = getDispatcherColor(trip.dispatcher || "");
          
          const isHighlighted =
            trip.carNumber &&
            highlightedCar === trip.carNumber.trim().toUpperCase();
            
          return (
            <div
              key={trip.id}
              data-trip-id={trip.id}
              onClick={() => loadTripToForm(trip)}
              className={`car-strip-item ${cardBg} rounded-2xl p-4 pl-5 border hover:shadow-md transition group relative flex flex-col lg:flex-row gap-6 items-start lg:items-center cursor-pointer ${isHighlighted ? "border-amber-500 ring-2 ring-amber-500/20 shadow-[0_10px_25px_rgba(245,158,11,0.08)] scale-[1.01]" : "border-slate-200/50"}`}
              draggable={true}
              onDragStart={(e) => {
                e.dataTransfer.setData("tripId", trip.id);
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
              <div
                className={`absolute left-0 top-0 bottom-0 w-1.5 ${trip.stripColor || "bg-slate-200"} rounded-l-2xl`}
              />
              <div className="flex flex-col gap-1 min-w-[200px]">
                <div className="flex items-center gap-3 mb-1">
                  <span className="text-lg font-black text-slate-900 tracking-tight">
                    {trip.carNumber}
                  </span>
                  <span className="bg-slate-100 text-slate-600 text-[10px] font-black uppercase tracking-widest px-2.5 py-1 rounded-md font-mono">
                    {trip.direction}
                  </span>
                </div>
                <div className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-widest">
                  Диспетчер:{" "}
                  <span className="text-slate-600">
                    {trip.dispatcher || trip.logist || "—"}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition">
                  {!archived && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        finishTripToArchive(trip);
                      }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 rounded-lg transition"
                    >
                      Archive
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
      }}
    />
  );
});

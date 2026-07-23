import React, {useState, useEffect} from 'react'
import {
  X,
  Compass,
  Check,
  Globe,
  Navigation,
  MapPin,
  ChevronRight,
  Plus,
  Trash2
} from "lucide-react";
import {DistancePreset} from '../types'

interface MapRouteModalProps {
  isOpen: boolean;
  onClose: () => void;
  legIndex: number | null;
  leg: any;
  presets: DistancePreset[];
  onUpdateLegRoute: (index: number, updatedFields: any) => void;
  saveToDirectoryChecked?: boolean;
  setSaveToDirectoryChecked?: (val: boolean) => void;
  onApply: () => void;
}

// 9. Realize in code: buildGoogleMapUrl(...)
export function buildGoogleMapUrl(origin: string, destination: string, waypoints: string[] = []): string {
  const cleanOrigin = origin.trim();
  const cleanDestination = destination.trim();
  const validWaypoints = waypoints.map(wp => wp.trim()).filter(wp => wp !== "");
  
  if (validWaypoints.length > 0) {
    const daddr = [...validWaypoints, cleanDestination].map(encodeURIComponent).join("+to:");
    return `https://maps.google.com/maps?saddr=${encodeURIComponent(cleanOrigin)}&daddr=${daddr}&dirflg=d&t=m&output=embed`;
  } else {
    return `https://maps.google.com/maps?saddr=${encodeURIComponent(cleanOrigin)}&daddr=${encodeURIComponent(cleanDestination)}&dirflg=d&t=m&output=embed`;
  }
}

// 9. Realize in code: buildYandexMapUrl(...)
export function buildYandexMapUrl(origin: string, destination: string, waypoints: string[] = []): string {
  const points = [origin, ...waypoints, destination].map(p => p.trim()).filter(p => p !== "");
  const rtext = points.map(encodeURIComponent).join('~');
  return `https://yandex.ru/map-widget/v1/?rtext=${rtext}&rtt=auto&l=map&iframe=true`;
}

const MapRouteModal = ({
  isOpen,
  onClose,
  legIndex,
  leg,
  onUpdateLegRoute,
  saveToDirectoryChecked = false,
  setSaveToDirectoryChecked,
  onApply,
}: MapRouteModalProps) => {
  const [localOrigin, setLocalOrigin] = useState("");
  const [localDestination, setLocalDestination] = useState("");
  const [localWaypoints, setLocalWaypoints] = useState<string[]>([]);
  const [currentProvider, setCurrentProvider] = useState<"google" | "yandex">("google");
  const [manualDistanceKm, setManualDistanceKm] = useState<string>("");

  // Sync state only when the modal opens to avoid typing cursor jumps and race conditions
  useEffect(() => {
    if (isOpen && leg && legIndex !== null) {
      setLocalOrigin(leg.origin || leg.from || "");
      setLocalDestination(leg.destination || leg.to || "");
      const initialWaypoints = leg.waypoints || [];
      setLocalWaypoints(initialWaypoints);
      setCurrentProvider(leg.mapProvider === "yandex" ? "yandex" : "google");
      
      const currentDistance = leg.totalDistanceKm || leg.dist || leg.distance || 0;
      setManualDistanceKm(currentDistance > 0 ? currentDistance.toString() : "");
    }
  }, [isOpen]); // Handled cleanly to trigger on open state transition only

  if (!isOpen || legIndex === null || !leg) return null;

  // Sync point updates to parent dynamically without altering manual mileage
  const syncPointsToParent = (
    originVal: string,
    destVal: string,
    wpsVal: string[],
    providerVal: "google" | "yandex"
  ) => {
    const distanceValue = parseFloat(manualDistanceKm) || 0;
    onUpdateLegRoute(legIndex, {
      from: originVal,
      to: destVal,
      origin: originVal,
      destination: destVal,
      waypoints: wpsVal,
      mapProvider: providerVal,
      totalDistanceKm: distanceValue,
      dist: distanceValue,
      distance: distanceValue,
    });
  };

  // Event handlers for inputs
  const handleOriginChange = (val: string) => {
    setLocalOrigin(val);
    syncPointsToParent(val, localDestination, localWaypoints, currentProvider);
  };

  const handleDestinationChange = (val: string) => {
    setLocalDestination(val);
    syncPointsToParent(localOrigin, val, localWaypoints, currentProvider);
  };

  const handleWaypointChange = (index: number, val: string) => {
    const updated = [...localWaypoints];
    updated[index] = val;
    setLocalWaypoints(updated);
    syncPointsToParent(localOrigin, localDestination, updated, currentProvider);
  };

  const handleAddWaypoint = () => {
    const updated = [...localWaypoints, ""];
    setLocalWaypoints(updated);
    syncPointsToParent(localOrigin, localDestination, updated, currentProvider);
  };

  const handleRemoveWaypoint = (index: number) => {
    const updated = localWaypoints.filter((_, idx) => idx !== index);
    setLocalWaypoints(updated);
    syncPointsToParent(localOrigin, localDestination, updated, currentProvider);
  };

  const handleMapProviderChange = (provider: "google" | "yandex") => {
    setCurrentProvider(provider);
    syncPointsToParent(localOrigin, localDestination, localWaypoints, provider);
  };

  const handleMileageChange = (val: string) => {
    setManualDistanceKm(val);
    const numVal = parseFloat(val) || 0;
    onUpdateLegRoute(legIndex, {
      totalDistanceKm: numVal,
      dist: numVal,
      distance: numVal,
    });
  };

  const hasRoute = localOrigin.trim() !== "" && localDestination.trim() !== "";

  // Dynamic preview map URL using the standard buildGoogleMapUrl and buildYandexMapUrl functions
  const embedUrl =
    currentProvider === "yandex"
      ? buildYandexMapUrl(localOrigin, localDestination, localWaypoints)
      : buildGoogleMapUrl(localOrigin, localDestination, localWaypoints);

  // External link helpers
  const googleExternalUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(localOrigin)}&destination=${encodeURIComponent(localDestination)}${localWaypoints.length > 0 ? `&waypoints=${encodeURIComponent(localWaypoints.filter(w => w.trim() !== "").join("|"))}` : ""}`;
  
  const yandexPoints = [localOrigin, ...localWaypoints, localDestination].map((p) => p.trim()).filter((p) => p !== "");
  const yandexExternalUrl = `https://yandex.ru/maps/?rtext=${yandexPoints.map(encodeURIComponent).join("~")}&rtt=auto`;

  const totalMileageNum = parseFloat(manualDistanceKm) || 0;

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center p-0 md:p-4 bg-slate-900/60 backdrop-blur-sm overflow-hidden">
      <div className="bg-white w-full h-full md:h-[95vh] md:max-w-[98vw] md:rounded-3xl shadow-2xl overflow-hidden flex flex-col md:flex-row border border-slate-150 animate-fade-in">
        
        {/* Sidebar Controls - Compact, Elegant & Ultra-Clean */}
        <div className="w-full md:w-[350px] flex flex-col border-b md:border-b-0 md:border-r border-slate-150 bg-white h-[45%] md:h-full overflow-hidden shrink-0">
          
          {/* Top Header */}
          <div className="p-4 border-b border-slate-150 flex items-center justify-between bg-white shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="bg-emerald-50 text-emerald-600 p-2 rounded-xl border border-emerald-100">
                <Compass className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">
                  Маршрут плеча №{legIndex + 1}
                </h3>
                <span className="text-[9px] font-black uppercase text-slate-400 font-mono tracking-wider block">
                  Интерактивная карта
                </span>
              </div>
            </div>
            
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition cursor-pointer"
              title="Закрыть модальное окно"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Input Controls */}
          <div className="p-4 flex-1 overflow-y-auto space-y-4">
            
            {/* Start Point */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block"></span>
                Откуда
              </label>
              <input
                type="text"
                value={localOrigin}
                onChange={(e) => handleOriginChange(e.target.value)}
                placeholder="Город отправления..."
                className="w-full bg-white text-slate-800 font-bold border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500 transition shadow-2xs"
              />
            </div>

            {/* Intermediate Waypoints List */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 inline-block"></span>
                  Промежуточные пункты ({localWaypoints.length})
                </label>
                <button
                  type="button"
                  onClick={handleAddWaypoint}
                  className="text-[10px] font-black text-emerald-600 hover:text-emerald-700 flex items-center gap-0.5 transition cursor-pointer"
                >
                  <Plus className="w-3 h-3" />
                  <span>Добавить</span>
                </button>
              </div>

              {localWaypoints.length === 0 ? (
                <div className="text-[10px] text-slate-400 italic py-2 text-center bg-slate-50 border border-dashed border-slate-200 rounded-xl">
                  Без заездов
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[160px] overflow-y-auto pr-1 custom-scrollbar">
                  {localWaypoints.map((wp, idx) => (
                    <div key={idx} className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200">
                      <span className="text-[9px] font-bold text-slate-400 font-mono w-4 text-center">
                        {idx + 1}
                      </span>
                      <input
                        type="text"
                        value={wp}
                        onChange={(e) => handleWaypointChange(idx, e.target.value)}
                        placeholder="Введите город заезда..."
                        className="flex-1 bg-white border-none rounded-md px-1 py-1 text-xs font-bold text-slate-700 outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => handleRemoveWaypoint(idx)}
                        className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* End Point */}
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider font-mono flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 inline-block"></span>
                Куда
              </label>
              <input
                type="text"
                value={localDestination}
                onChange={(e) => handleDestinationChange(e.target.value)}
                placeholder="Город назначения..."
                className="w-full bg-white text-slate-800 font-bold border border-slate-200 rounded-xl px-3 py-2 text-xs outline-none focus:border-emerald-500 transition shadow-2xs"
              />
            </div>

            {/* Clean Map Provider Switcher */}
            <div className="bg-white p-3 rounded-xl border border-slate-200 space-y-1.5 shadow-2xs">
              <span className="text-[9px] font-black uppercase text-slate-400 font-mono tracking-wider block">
                Провайдер карты
              </span>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => handleMapProviderChange("google")}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-black transition flex items-center justify-center gap-1.5 border ${
                    currentProvider === "google"
                      ? "bg-slate-900 border-slate-900 text-[#70FC8E]"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Globe className="w-3.5 h-3.5" />
                  <span>Google Maps</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleMapProviderChange("yandex")}
                  className={`flex-1 py-1.5 rounded-lg text-[11px] font-black transition flex items-center justify-center gap-1.5 border ${
                    currentProvider === "yandex"
                      ? "bg-slate-900 border-slate-900 text-[#70FC8E]"
                      : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  <Navigation className="w-3.5 h-3.5" />
                  <span>Яндекс.Карты</span>
                </button>
              </div>
            </div>

            {/* PURELY MANUAL WORKING FIELD: Mileage input */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2 shadow-xs">
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-black uppercase text-slate-500 tracking-wider font-mono">
                  Итоговый пробег, км
                </label>
                <span className="text-[8px] font-bold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded uppercase font-mono tracking-wide">
                  Ручной ввод
                </span>
              </div>
              
              <div className="relative">
                <input
                  type="number"
                  value={manualDistanceKm}
                  onChange={(e) => handleMileageChange(e.target.value)}
                  placeholder="0"
                  className="w-full bg-white text-slate-800 font-extrabold border border-slate-200 rounded-xl px-4 py-2.5 text-base outline-none focus:border-emerald-500 transition shadow-2xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs font-black text-slate-400 select-none font-mono">
                  КМ
                </span>
              </div>
            </div>

            {/* Save to Directory Toggle */}
            {setSaveToDirectoryChecked && (
              <label className="flex items-center gap-2 cursor-pointer select-none border border-slate-200 rounded-xl px-3 py-2 bg-white shadow-2xs hover:bg-slate-50 transition">
                <input
                  type="checkbox"
                  checked={saveToDirectoryChecked}
                  onChange={(e) => setSaveToDirectoryChecked(e.target.checked)}
                  className="w-3.5 h-3.5 rounded text-emerald-600 border-slate-300 focus:ring-emerald-500 cursor-pointer"
                />
                <span className="text-[11px] font-bold text-slate-700 leading-tight">
                  Сохранить в справочник расстояний
                </span>
              </label>
            )}

          </div>

          {/* Clean Simplified Footer */}
          <div className="p-4 bg-white border-t border-slate-150 flex gap-2 shrink-0">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-bold text-xs uppercase tracking-wider transition cursor-pointer"
            >
              Отмена
            </button>
            <button
              onClick={onApply}
              disabled={totalMileageNum === 0}
              className={`flex-1 py-2 rounded-xl font-black text-xs uppercase tracking-wider transition cursor-pointer flex items-center justify-center gap-1 shadow-xs ${
                totalMileageNum > 0
                  ? "bg-slate-950 text-[#70FC8E] border border-black hover:bg-slate-800"
                  : "bg-slate-200 text-slate-400 cursor-not-allowed border-none"
              }`}
            >
              <Check className="w-3.5 h-3.5" />
              Применить
            </button>
          </div>

        </div>

        {/* Edge-to-Edge Massive Map - Purely integrated interactive iframe */}
        <div className="flex-1 relative h-[55%] md:h-full w-full bg-slate-100 flex flex-col overflow-hidden">
          
          {!hasRoute ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center bg-slate-50">
              <div className="w-16 h-16 bg-white rounded-3xl flex items-center justify-center text-slate-400 border border-slate-200 mb-4 shadow-2xs">
                <MapPin className="w-6 h-6 text-emerald-600 animate-bounce" />
              </div>
              <h4 className="text-xs font-black uppercase text-slate-700 tracking-wider">
                Карта готова к построению
              </h4>
              <p className="text-[10px] text-slate-400 leading-normal max-w-xs mt-1">
                Укажите пункт отправления и пункт назначения в левой панели для отображения полноценной интерактивной карты.
              </p>
            </div>
          ) : (
            <div className="flex-1 flex flex-col h-full relative">
              
              {/* Massive Map Frame Container (100% Edge-to-Edge) */}
              <div className="flex-1 relative w-full h-full bg-slate-200">
                <iframe
                  title="Интерактивная карта маршрута"
                  src={embedUrl}
                  className="w-full h-full border-none"
                  allowFullScreen
                />
              </div>

              {/* Minimalist Footnote Bar - Semi-transparent float over the map corner */}
              <div className="absolute bottom-4 left-4 right-4 md:left-auto md:right-4 z-10 p-3 bg-white/95 backdrop-blur-md rounded-2xl border border-slate-200/60 shadow-lg flex items-center justify-between gap-4 animate-fade-in max-w-sm">
                <div className="text-[10px] text-slate-600 font-bold flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Интерактивный {currentProvider === "yandex" ? "Яндекс" : "Google"} режим</span>
                </div>
                
                <div className="flex gap-1.5">
                  <a
                    href={googleExternalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 bg-slate-50 hover:bg-slate-150 border border-slate-200 rounded-lg text-[9px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1 transition"
                  >
                    <span>Google</span>
                    <ChevronRight className="w-3 h-3" />
                  </a>
                  <a
                    href={yandexExternalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-2.5 py-1 bg-slate-50 hover:bg-slate-150 border border-slate-200 rounded-lg text-[9px] font-black text-slate-600 uppercase tracking-wider flex items-center gap-1 transition"
                  >
                    <span>Яндекс</span>
                    <ChevronRight className="w-3 h-3" />
                  </a>
                </div>
              </div>

            </div>
          )}

        </div>

      </div>
    </div>
  );
}


export default React.memo(MapRouteModal);

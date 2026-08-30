import {useToast} from '../ToastProvider'
import {useDialog} from '../DialogProvider'
import React, {useState, useEffect, useMemo} from 'react'
import { normalizeRoadString } from '../../utils/format'
import {
  UserProfile,
  RouteCalculation,
  Leg,
  FerryTemplate,
  DistancePreset,
  RouteTemplate,
  DirectionPreset,
  AppSettings,
} from "../../types";
import {dbService, directoryService} from '../../api';
import CityAutocomplete from '../common/CityAutocomplete';
import {pdService} from '../../api';
import {
  Plus,
  Trash2,
  Save,
  MapPin,
  Calculator,
  Info,
  Ship,
  TrendingUp,
  FileSpreadsheet,
  Calendar,
  RefreshCw,
  Edit,
  Copy,
  X,
  Check,
  Search,
  FolderOpen,
  Clock,
  CreditCard,
  Landmark,
  Receipt,
  Map,
  Printer,
} from "lucide-react";
import MapRouteModal from "../MapRouteModal";
import {applyDistanceToField, recalculateLegRoute} from '../../utils/distanceCalculator'

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (window as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";
const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

const useMap = () => null;
const useMapsLibrary = (...args: any[]) => null;

function RouteDisplay({
  origin,
  destination,
  onDistance,
  avoidTolls,
  avoidHighways,
  avoidFerries,
  vehicleType,
  avoidKeywords,
  onRouteStatus,
  waypoints = [],
}: {
  origin: string;
  destination: string;
  onDistance: (km: number) => void;
  avoidTolls: boolean;
  avoidHighways: boolean;
  avoidFerries: boolean;
  vehicleType: string;
  avoidKeywords: string;
  onRouteStatus?: (status: {
    matches: string[];
    isAlternative: boolean;
    avoidedSuccessfully: boolean;
    attempted: boolean;
  }) => void;
  waypoints?: string[];
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const [debouncedOrigin, setDebouncedOrigin] = useState(origin);
  const [debouncedDestination, setDebouncedDestination] = useState(destination);
  const rendererRef = React.useRef<google.maps.DirectionsRenderer | null>(null);
  const polylinesRef = React.useRef<google.maps.Polyline[]>([]);
  const [pdSettings, setPdSettings] = useState<any>({
    routingProvider: "osrm",
    openRouteServiceApiKey: "",
  });
  const [globalSettings, setGlobalSettings] = useState<AppSettings | null>(null);
  const [offlineMode, setOfflineMode] = useState(() => localStorage.getItem('offline_mode') === 'true');

  useEffect(() => {
    const unsub = dbService.getSettings(setGlobalSettings);
    return unsub;
  }, []);

  useEffect(() => {
    const handleOfflineChange = () => {
      setOfflineMode(localStorage.getItem('offline_mode') === 'true');
    };
    window.addEventListener('ratipa-offline-mode-change', handleOfflineChange);
    return () => window.removeEventListener('ratipa-offline-mode-change', handleOfflineChange);
  }, []);

  useEffect(() => {
    const unsub = pdService.subscribePlanDohodSettings(setPdSettings);
    return unsub;
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedOrigin(origin);
      setDebouncedDestination(destination);
    }, 800);
    return () => clearTimeout(timer);
  }, [origin, destination]);

  useEffect(() => {
    if (!map) return;

    let active = true;

    // MANDATORY: Clear everything first to prevent old/random/accidental markers from staying on the map!
    polylinesRef.current.forEach((p) => {
      p.setMap(null);
      if ((p as any)._fallback_markers) {
        (p as any)._fallback_markers.forEach((m: any) => m.setMap(null));
      }
    });
    polylinesRef.current = [];

    if (rendererRef.current) {
      rendererRef.current.setMap(null);
    }

    if (!debouncedOrigin || !debouncedDestination) return;

    const isOrs = pdSettings?.routingProvider === "openrouteservice";

    if (isOrs) {
      runORS();
    } else {
      runOSRM();
    }

    async function runORS() {
      const apiKey = pdSettings?.openRouteServiceApiKey || "";
      const resolve = async (
        address: string,
      ): Promise<google.maps.LatLng | null> => {
        try {
          const res = await fetch(
            `/api/geocode?address=${encodeURIComponent(address)}`,
          );
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            const data = await res.json();
            if (
              data &&
              typeof data.lat === "number" &&
              typeof data.lng === "number"
            ) {
              return new google.maps.LatLng(data.lat, data.lng);
            }
          }
        } catch (err) {
          console.warn("Geocode proxy failed, trying Nominatim...", err);
        }

        try {
          const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
          const res = await fetch(url);
          if (res.ok) {
            const arr = await res.json();
            if (Array.isArray(arr) && arr.length > 0) {
              const lat = parseFloat(arr[0].lat);
              const lng = parseFloat(arr[0].lon);
              if (!isNaN(lat) && !isNaN(lng)) {
                return new google.maps.LatLng(lat, lng);
              }
            }
          }
        } catch (err) {
          console.error("Nominatim fallback failed:", err);
        }
        return null;
      };

      const activeWaypoints = waypoints.filter((w) => w && w.trim().length > 0);
      const coords = await Promise.all([
        resolve(debouncedOrigin),
        ...activeWaypoints.map((w) => resolve(w)),
        resolve(debouncedDestination),
      ]);

      if (!active) return;

      const validCoords = coords.filter(
        (c): c is google.maps.LatLng => c !== null,
      );
      if (validCoords.length < 2) return;

      let distanceKm = 0;
      let polylinePath: google.maps.LatLngLiteral[] = [];
      let avoidedSuccessfully = true;
      let matchedKeywords: string[] = [];
      let attempted = false;

      const keywordsToAvoid = avoidKeywords
        ? avoidKeywords
            .split(/[\s,;]+/)
            .map((k) => normalizeRoadString(k.trim()))
            .filter((k) => k.length > 0)
        : [];

      if (keywordsToAvoid.length > 0) {
        attempted = true;
      }

      if (apiKey && apiKey.trim() !== "") {
        const coordinates = validCoords.map((vc) => [vc.lng(), vc.lat()]);
        try {
          const response = await fetch(
            "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: apiKey,
              },
              body: JSON.stringify({
                coordinates: coordinates,
                preference: "fastest",
                options: {
                  avoid_features: [
                    ...(avoidTolls ? ["tollways"] : []),
                    ...(avoidHighways ? ["highways"] : []),
                    ...(avoidFerries ? ["ferries"] : []),
                  ],
                },
              }),
            },
          );

          if (!active) return;

          if (response.ok) {
            const data = await response.json();
            if (data.features && data.features[0]) {
              const feature = data.features[0];
              const distanceMeters = feature.properties?.summary?.distance || 0;
              const rawCoordinates = feature.geometry?.coordinates || [];
              polylinePath = rawCoordinates.map((coord: any) => ({
                lat: coord[1],
                lng: coord[0],
              }));
              distanceKm = Math.round(distanceMeters / 1000);

              if (keywordsToAvoid.length > 0 && feature.properties?.segments) {
                const matches: string[] = [];
                for (const segment of feature.properties.segments) {
                  if (segment.steps) {
                    for (const step of segment.steps) {
                      const stepName = normalizeRoadString(
                        step.name || "",
                      ).replace(/[-\s]/g, "");
                      for (const kw of keywordsToAvoid) {
                        const targetKw = kw.replace(/[-\s]/g, "");
                        if (stepName.includes(targetKw)) {
                          if (!matches.includes(kw)) matches.push(kw);
                        }
                      }
                    }
                  }
                }
                if (matches.length > 0) {
                  avoidedSuccessfully = false;
                  matchedKeywords = matches;
                }
              }
            }
          } else {
            console.warn(
              "OpenRouteService API returned error status:",
              response.status,
            );
          }
        } catch (e) {
          console.error("OpenRouteService API call failed:", e);
        }
      }

      if (polylinePath.length === 0) {
        polylinePath = validCoords.map((vc) => ({
          lat: vc.lat(),
          lng: vc.lng(),
        }));
        let totalMeters = 0;
        for (let i = 0; i < validCoords.length - 1; i++) {
          const p1 = validCoords[i];
          const p2 = validCoords[i + 1];
          const R = 6371e3;
          const lat1 = (p1.lat() * Math.PI) / 180;
          const lat2 = (p2.lat() * Math.PI) / 180;
          const deltaLat = ((p2.lat() - p1.lat()) * Math.PI) / 180;
          const deltaLng = ((p2.lng() - p1.lng()) * Math.PI) / 180;

          const a =
            Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) *
              Math.cos(lat2) *
              Math.sin(deltaLng / 2) *
              Math.sin(deltaLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          totalMeters += R * c;
        }
        distanceKm = Math.round((totalMeters / 1000) * 1.28);
      }

      // Draw polyline path
      const line = new google.maps.Polyline({
        path: polylinePath,
        geodesic: true,
        strokeColor: "#3b82f6",
        strokeWeight: 6,
        map: map,
      });
      polylinesRef.current.push(line);

      // Draw fallback markers
      const fallbackMarkers: google.maps.Marker[] = [];
      validCoords.forEach((coord, i) => {
        let label = "•";
        if (i === 0) label = "A";
        else if (i === validCoords.length - 1) label = "B";
        else label = String(i);

        const m = new google.maps.Marker({
          position: coord,
          map: map,
          label: { text: label, color: "#ffffff", fontWeight: "bold" },
        });
        fallbackMarkers.push(m);
      });
      (line as any)._fallback_markers = fallbackMarkers;

      onDistance(distanceKm);

      if (onRouteStatus) {
        onRouteStatus({
          matches: matchedKeywords,
          isAlternative: false,
          avoidedSuccessfully: avoidedSuccessfully,
          attempted: attempted,
        });
      }

      const bounds = new google.maps.LatLngBounds();
      validCoords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds);
    }

    async function runOSRM() {
      const resolve = async (
        address: string,
      ): Promise<google.maps.LatLng | null> => {
        try {
          const res = await fetch(
            `/api/geocode?address=${encodeURIComponent(address)}`,
          );
          const contentType = res.headers.get('content-type') || '';
          if (res.ok && contentType.includes('application/json')) {
            const data = await res.json();
            if (
              data &&
              typeof data.lat === "number" &&
              typeof data.lng === "number"
            ) {
              return new google.maps.LatLng(data.lat, data.lng);
            }
          }
        } catch (err) {
          console.warn("Geocode proxy failed, trying Nominatim...", err);
        }

        try {
          const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`;
          const res = await fetch(url);
          if (res.ok) {
            const arr = await res.json();
            if (Array.isArray(arr) && arr.length > 0) {
              const lat = parseFloat(arr[0].lat);
              const lng = parseFloat(arr[0].lon);
              if (!isNaN(lat) && !isNaN(lng)) {
                return new google.maps.LatLng(lat, lng);
              }
            }
          }
        } catch (err) {
          console.error("Nominatim fallback failed:", err);
        }
        return null;
      };

      const activeWaypoints = waypoints.filter((w) => w && w.trim().length > 0);
      const coords = await Promise.all([
        resolve(debouncedOrigin),
        ...activeWaypoints.map((w) => resolve(w)),
        resolve(debouncedDestination),
      ]);

      if (!active) return;

      const validCoords = coords.filter(
        (c): c is google.maps.LatLng => c !== null,
      );
      if (validCoords.length < 2) return;

      let distanceKm = 0;
      let polylinePath: google.maps.LatLngLiteral[] = [];
      let avoidedSuccessfully = true;
      let matchedKeywords: string[] = [];
      let attempted = false;

      const keywordsToAvoid = avoidKeywords
        ? avoidKeywords
            .split(/[\s,;]+/)
            .map((k) => normalizeRoadString(k.trim()))
            .filter((k) => k.length > 0)
        : [];

      if (keywordsToAvoid.length > 0) {
        attempted = true;
      }

      const mapboxUsage = globalSettings?.mapboxUsage;
      const bypassMapbox = mapboxUsage
        ? (mapboxUsage.count >= (mapboxUsage.limit || 100000) && !mapboxUsage.allowExceed)
        : false;

      const coordinates = validCoords
        .map((vc) => `${vc.lng()},${vc.lat()}`)
        .join(";");
      try {
        let response = null;
        let usedDirectMapbox = false;
        if (!offlineMode) {
          try {
            const bypassParam = bypassMapbox ? "&bypassMapbox=true" : "";
            response = await fetch(
              `/api/osrm-route?coordinates=${coordinates}&steps=true&alternatives=true${bypassParam}`,
            );
            if (!response.ok) {
              throw new Error("Proxy routing fetch returned error status");
            }
          } catch (proxyError) {
            console.warn("Proxy routing failed, trying direct Mapbox fallback:", proxyError);
            if (!bypassMapbox) {
              try {
                const mapboxToken = import.meta.env.VITE_MAPBOX_TOKEN || "";
                response = await fetch(
                  `https://api.mapbox.com/directions/v5/mapbox/driving/${coordinates}?geometries=geojson&overview=full&steps=true&alternatives=true&access_token=${mapboxToken}`,
                );
                if (!response.ok) {
                  throw new Error("Direct Mapbox fetch returned error status");
                }
                usedDirectMapbox = true;
              } catch (directError) {
                console.warn("Direct Mapbox fallback failed, trying public OSRM fallback:", directError);
                try {
                  response = await fetch(
                    `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=true`,
                  );
                } catch (ossError) {
                  console.error("All front-end Mapbox & OSRM routing attempts failed:", ossError);
                }
              }
            } else {
              try {
                response = await fetch(
                  `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=true`,
                );
              } catch (ossError) {
                console.error("All front-end OSRM routing attempts failed:", ossError);
              }
            }
          }
        }

        if (!active) return;

        if (response && response.ok) {
          const data = await response.json();
          if (data.source === "mapbox" || usedDirectMapbox) {
            dbService.incrementMapboxUsage();
          }
          if (data.code === "Ok" && data.routes && data.routes.length > 0) {
            let selectedRoute = data.routes[0];

            if (keywordsToAvoid.length > 0) {
              let foundClearRoute = false;
              for (const r of data.routes) {
                const matches: string[] = [];
                if (r.legs) {
                  for (const leg of r.legs) {
                    if (leg.steps) {
                      for (const step of leg.steps) {
                        const stepName = normalizeRoadString(
                          step.name || "",
                        ).replace(/[-\s]/g, "");
                        const stepRef = normalizeRoadString(
                          step.ref || "",
                        ).replace(/[-\s]/g, "");
                        for (const kw of keywordsToAvoid) {
                          const targetKw = kw.replace(/[-\s]/g, "");
                          if (
                            stepName.includes(targetKw) ||
                            stepRef.includes(targetKw)
                          ) {
                            if (!matches.includes(kw)) matches.push(kw);
                          }
                        }
                      }
                    }
                  }
                }
                const summaryNorm = normalizeRoadString(
                  r.summary || "",
                ).replace(/[-\s]/g, "");
                for (const kw of keywordsToAvoid) {
                  const targetKw = kw.replace(/[-\s]/g, "");
                  if (summaryNorm.includes(targetKw)) {
                    if (!matches.includes(kw)) matches.push(kw);
                  }
                }

                if (matches.length === 0) {
                  selectedRoute = r;
                  foundClearRoute = true;
                  break;
                }
              }

              if (!foundClearRoute) {
                avoidedSuccessfully = false;
                const r0 = data.routes[0];
                const mainMatches: string[] = [];
                if (r0.legs) {
                  for (const leg of r0.legs) {
                    if (leg.steps) {
                      for (const step of leg.steps) {
                        const stepName = normalizeRoadString(
                          step.name || "",
                        ).replace(/[-\s]/g, "");
                        const stepRef = normalizeRoadString(
                          step.ref || "",
                        ).replace(/[-\s]/g, "");
                        for (const kw of keywordsToAvoid) {
                          const targetKw = kw.replace(/[-\s]/g, "");
                          if (
                            stepName.includes(targetKw) ||
                            stepRef.includes(targetKw)
                          ) {
                            if (!mainMatches.includes(kw)) mainMatches.push(kw);
                          }
                        }
                      }
                    }
                  }
                }
                const summaryNorm = normalizeRoadString(
                  r0.summary || "",
                ).replace(/[-\s]/g, "");
                for (const kw of keywordsToAvoid) {
                  const targetKw = kw.replace(/[-\s]/g, "");
                  if (summaryNorm.includes(targetKw)) {
                    if (!mainMatches.includes(kw)) mainMatches.push(kw);
                  }
                }
                matchedKeywords = mainMatches;
              } else {
                avoidedSuccessfully = true;
                matchedKeywords = [];
              }
            }

            const distanceMeters = selectedRoute.distance || 0;
            const rawCoordinates = selectedRoute.geometry?.coordinates || [];
            polylinePath = rawCoordinates.map((coord: any) => ({
              lat: coord[1],
              lng: coord[0],
            }));
            distanceKm = Math.round(distanceMeters / 1000);
          }
        }
      } catch (e) {
        console.error("OSRM DohodModule failed:", e);
      }

      if (polylinePath.length === 0) {
        polylinePath = validCoords.map((vc) => ({
          lat: vc.lat(),
          lng: vc.lng(),
        }));
        let totalMeters = 0;
        for (let i = 0; i < validCoords.length - 1; i++) {
          const p1 = validCoords[i];
          const p2 = validCoords[i + 1];
          const R = 6371e3;
          const lat1 = (p1.lat() * Math.PI) / 180;
          const lat2 = (p2.lat() * Math.PI) / 180;
          const deltaLat = ((p2.lat() - p1.lat()) * Math.PI) / 180;
          const deltaLng = ((p2.lng() - p1.lng()) * Math.PI) / 180;

          const a =
            Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) *
              Math.cos(lat2) *
              Math.sin(deltaLng / 2) *
              Math.sin(deltaLng / 2);
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
          totalMeters += R * c;
        }
        distanceKm = Math.round((totalMeters / 1000) * 1.28);
      }

      // Draw polyline path
      const line = new google.maps.Polyline({
        path: polylinePath,
        geodesic: true,
        strokeColor: "#3b82f6",
        strokeWeight: 6,
        map: map,
      });
      polylinesRef.current.push(line);

      // Draw fallback markers
      const fallbackMarkers: google.maps.Marker[] = [];
      validCoords.forEach((coord, i) => {
        let label = "•";
        if (i === 0) label = "A";
        else if (i === validCoords.length - 1) label = "B";
        else label = String(i);

        const m = new google.maps.Marker({
          position: coord,
          map: map,
          label: { text: label, color: "#ffffff", fontWeight: "bold" },
        });
        fallbackMarkers.push(m);
      });
      (line as any)._fallback_markers = fallbackMarkers;

      onDistance(distanceKm);

      if (onRouteStatus) {
        onRouteStatus({
          matches: matchedKeywords,
          isAlternative: false,
          avoidedSuccessfully: avoidedSuccessfully,
          attempted: attempted,
        });
      }

      const bounds = new google.maps.LatLngBounds();
      validCoords.forEach((c) => bounds.extend(c));
      map.fitBounds(bounds);
    }

    return () => {
      active = false;
    };
  }, [
    map,
    debouncedOrigin,
    debouncedDestination,
    onDistance,
    avoidTolls,
    avoidHighways,
    avoidFerries,
    vehicleType,
    avoidKeywords,
    waypoints,
    pdSettings,
  ]);

  useEffect(() => {
    return () => {
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
        rendererRef.current = null;
      }
      polylinesRef.current.forEach((p) => {
        p.setMap(null);
        if ((p as any)._fallback_markers) {
          (p as any)._fallback_markers.forEach((m: any) => m.setMap(null));
        }
      });
      polylinesRef.current = [];
    };
  }, [map]);

  return null;
}

interface DohodModuleProps {
  user: UserProfile;
}

const CalculationCard = React.memo(({
  calc,
  user,
  copyHistoryToForm,
  openEditCalcModal,
  isSelected,
  onToggleSelect,
}: {
  calc: RouteCalculation;
  user: UserProfile;
  copyHistoryToForm: (calc: RouteCalculation) => void;
  openEditCalcModal: (calc: RouteCalculation) => void;
  isSelected?: boolean;
  onToggleSelect?: (id: string) => void;
}) => {
  const routePoints: string[] = [];
  calc.legs.forEach((l) => {
    if (l.from && routePoints[routePoints.length - 1] !== l.from)
      routePoints.push(l.from);
    if (l.to && routePoints[routePoints.length - 1] !== l.to)
      routePoints.push(l.to);
  });
  const routeTitle = routePoints.join(" ➔ ");

  // Result metrics calculations
  const totalKmValue =
    calc.km ||
    calc.legs.reduce(
      (acc, leg) => acc + Number(leg.dist || leg.distance || 0),
      0,
    );
  const daysValue = calc.days || 1;
  const profitValue = calc.netProfit || 0;
  const dailyProfitValue =
    calc.dailyProfit ||
    (daysValue > 0 ? profitValue / daysValue : 0);

  return (
    <div
      className={`p-5 bg-white border rounded-2xl shadow-sm hover:shadow-md transition duration-300 flex flex-col group ${
        isSelected
          ? "border-[#3765F6]/60 ring-2 ring-[#3765F6]/20 bg-blue-50/20"
          : "border-slate-200/50 hover:border-slate-300/80"
      }`}
    >
      <div className="flex items-start justify-between mb-4 pb-3 border-b border-slate-200/40 gap-4">
        {/* Checkbox */}
        {onToggleSelect && (
          <button
            type="button"
            onClick={() => onToggleSelect(calc.id)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl shrink-0 cursor-pointer transition-colors duration-150"
            title={isSelected ? "Снять выделение" : "Выбрать для печати"}
          >
            <div className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-all duration-150 ${
              isSelected
                ? "bg-slate-900 border-slate-900 text-white"
                : "border-slate-300 hover:border-[#3765F6] bg-white"
            }`}>
              {isSelected && (
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
          </button>
        )}
        <div className="flex flex-col gap-1 min-w-0">
          <div className="text-sm font-bold text-slate-900 uppercase tracking-tight flex items-center gap-1.5 flex-wrap">
            <span className="text-[#3765F6] font-mono">&rarr;</span>
            <span className="truncate">{routeTitle || "Без названия"}</span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 uppercase tracking-wider flex items-center gap-2 flex-wrap">
            <span>{calc.datetime}</span>
            <span className="text-slate-300">•</span>
            <span>Направление: <strong className="text-slate-700">{calc.globalDirection || calc.direction || "Не указано"}</strong></span>
            <span className="text-slate-300">•</span>
            <span>Логист: <strong className="text-slate-700">{calc.username || calc.logist || "Система"}</strong></span>
            {calc.additionalExpenses ? (
              <>
                <span className="text-slate-300">•</span>
                <span>Доп. расходы: <strong className="text-rose-600">{calc.additionalExpenses} €</strong></span>
                {Array.isArray(calc.expenseItems) && calc.expenseItems.length > 0 && (
                  <span className="text-[10px] text-slate-400 font-normal">
                    ({calc.expenseItems.map((e) => e.label || "—").join(", ")})
                  </span>
                )}
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            title="Дублировать в форму"
            onClick={() => copyHistoryToForm(calc)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 border border-slate-200/40 hover:border-emerald-200/50 bg-white/85 shadow-2xs hover:shadow-xs transition duration-150 cursor-pointer"
          >
            <Copy className="h-4 w-4" />
          </button>
          <button
            title="Изменить"
            onClick={() => openEditCalcModal(calc)}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-[#3765F6] hover:bg-blue-50 border border-slate-200/40 hover:border-blue-200/50 bg-white/85 shadow-2xs hover:shadow-xs transition duration-150 cursor-pointer"
          >
            <Edit className="h-4 w-4" />
          </button>
          {user.role === "root_admin" && (
            <button
              onClick={() =>
                dbService.deleteRouteCalculation(
                  calc.id,
                  user.name,
                  user.role,
                )
              }
              className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200/40 hover:border-rose-200/50 bg-white/85 shadow-2xs hover:shadow-xs transition duration-150 cursor-pointer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Accented metrics block (bento style) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-2xl flex flex-col justify-between min-h-[64px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 block mb-1">
            Доход (Чистый)
          </span>
          <span className="text-base font-bold text-emerald-600 font-mono tracking-tight leading-none">
            {Math.round(profitValue).toLocaleString("ru-RU")}{" "}
            <span className="text-xs font-normal">€</span>
          </span>
        </div>

        <div className="bg-slate-500/5 border border-slate-500/10 p-3 rounded-2xl flex flex-col justify-between min-h-[64px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-blue-600 block mb-1">
            Доход в день
          </span>
          <span className="text-base font-bold text-blue-700 font-mono tracking-tight leading-none">
            {Math.round(dailyProfitValue).toLocaleString("ru-RU")}{" "}
            <span className="text-xs font-normal">€/дн</span>
          </span>
        </div>

        <div className="bg-amber-500/5 border border-amber-500/10 p-3 rounded-2xl flex flex-col justify-between min-h-[64px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 block mb-1">
            Количество дней
          </span>
          <span className="text-base font-bold text-amber-700 font-mono tracking-tight leading-none">
            {daysValue}{" "}
            <span className="text-xs font-normal">дн</span>
          </span>
        </div>

        <div className="bg-slate-500/5 border border-slate-500/10 p-3 rounded-2xl flex flex-col justify-between min-h-[64px]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
            Километраж
          </span>
          <span className="text-base font-bold text-slate-600 font-mono tracking-tight leading-none">
            {Math.round(totalKmValue).toLocaleString("ru-RU")}{" "}
            <span className="text-xs font-normal">км</span>
          </span>
        </div>
      </div>

      {/* Visual rendering of calculation legs steps inside drop list */}
      <div className="mt-1 border-t border-slate-200/40 pt-3">
        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-2.5">
          Детализация по плечам
        </span>
        <div className="space-y-1.5">
          {calc.legs.map((l, i) => (
            <div
              key={i}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-2 px-3 bg-white/40 border border-slate-200/40 rounded-xl text-xs font-medium text-slate-600 hover:border-slate-300/60 hover:bg-white/60 transition"
            >
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-slate-100 text-slate-500 text-[9px] font-bold flex items-center justify-center font-mono select-none shrink-0">
                  {i + 1}
                </span>
                <span
                  className="text-slate-900 uppercase font-extrabold tracking-tight text-xs truncate max-w-[200px]"
                  title={`${l.from || "?"} ➔ ${l.to || "?"}`}
                >
                  {l.from || "?"} &rarr; {l.to || "?"}
                </span>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-mono justify-end text-slate-500">
                <span>{Math.round(l.dist || l.distance || 0).toLocaleString("ru-RU")} км</span>
                {Number(l.coeff || 0) > 0 && (
                  <span className="text-slate-400">Коэф: {l.coeff}</span>
                )}
                {Number(l.freight || 0) > 0 && (
                  <span className="text-emerald-600 font-bold">{Math.round(l.freight).toLocaleString("ru-RU")} €</span>
                )}
                {Number(l.infoRate || 0) > 0 && (
                  <span className="text-[#3765F6]">{Math.round(l.infoRate || 0).toLocaleString("ru-RU")} {l.infoCurrency || "USD"}</span>
                )}
                {Number(l.ferryCost || 0) > 0 && (
                  <span className="text-rose-500">Паром: {Math.round(l.ferryCost).toLocaleString("ru-RU")} €</span>
                )}
                {Number(l.additionalExpenses || l.otherExpenses || 0) > 0 && (
                  <span className="text-rose-500">Доп: {Math.round(l.additionalExpenses || l.otherExpenses || 0).toLocaleString("ru-RU")} €</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});

export default function DohodModule({ user }: DohodModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  
  const [calculationHistory, setCalculationHistory] = useState<
    RouteCalculation[]
  >([]);
  const [routeTemplates, setRouteTemplates] = useState<RouteTemplate[]>([]);
  const [ferries, setFerries] = useState<FerryTemplate[]>([]);
  const [distances, setDistances] = useState<DistancePreset[]>([]);
  const citiesList = useMemo(() => {
    const set = new Set<string>();
    distances.forEach((d) => { if (d.from) set.add(d.from); if (d.to) set.add(d.to); });
    return Array.from(set).sort();
  }, [distances]);
  const [directions, setDirections] = useState<DirectionPreset[]>([]);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);

  // Form State
  const [globalDirection, setGlobalDirection] = useState("Турция");

  // Date and Days
  const [tripStartDate, setTripStartDate] = useState<string>("");
  const [tripEndDate, setTripEndDate] = useState<string>("");
  const [tripDays, setTripDays] = useState<number>(1);
  const [additionalExpenses, setAdditionalExpenses] = useState<number>(0);
  const [expenseItems, setExpenseItems] = useState<{ label: string; amount: number }[]>([]);

  const [editingCalcId, setEditingCalcId] = useState<string | null>(null);
  const [editingCalcData, setEditingCalcData] = useState<
    Partial<RouteCalculation>
  >({});

  const [nbrbRates, setNbrbRates] = useState<
    Record<string, { scale: number; rate: number }>
  >({
    USD: { scale: 1, rate: 3.25 },
    EUR: { scale: 1, rate: 3.55 },
    RUB: { scale: 100, rate: 3.42 },
    BYN: { scale: 1, rate: 1.0 },
    TRY: { scale: 10, rate: 1.0 },
    KZT: { scale: 1000, rate: 7.2 },
    KGS: { scale: 100, rate: 3.7 },
    CNY: { scale: 10, rate: 4.5 },
    GEL: { scale: 1, rate: 1.2 },
    AMD: { scale: 1000, rate: 8.35 },
  });

  const [pdSettings, setPdSettings] = useState<any>({
    useDistanceLookup: false,
    googleMapsApiKey: "",
  });
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [mapLegIndex, setMapLegIndex] = useState<number | null>(null);
  const [mapKmResult, setMapKmResult] = useState<number>(0);
  const [saveToDirectoryChecked, setSaveToDirectoryChecked] = useState(false);
  const [mapAvoidTolls, setMapAvoidTolls] = useState(false);
  const [mapAvoidHighways, setMapAvoidHighways] = useState(false);
  const [mapAvoidFerries, setMapAvoidFerries] = useState(false);
  const [mapVehicleType, setMapVehicleType] = useState("TRUCK");
  const [mapAvoidKeywords, setMapAvoidKeywords] = useState("");
  const [mapWaypoints, setMapWaypoints] = useState<string[]>([]);

  const [mapAvoidedStatus, setMapAvoidedStatus] = useState<{
    attempted: boolean;
    avoidedSuccessfully: boolean;
    matches: string[];
  }>({ attempted: false, avoidedSuccessfully: false, matches: [] });

  const [legs, setLegs] = useState<Omit<Leg, "id">[]>([
    {
      from: "",
      to: "",
      dist: 0,
      emptyRun: 0,
      freight: 0,
      coeff: 0,
      infoRate: 0,
      infoCurrency: "USD",
      ferrySelectValue: "none",
      ferryCost: 0,
      additionalExpenses: 0,
      origin: "",
      destination: "",
      waypoints: [],
      mapProvider: "google",
      vehicleType: "truck",
      selectedRouteIndex: 0,
      routes: [],
      segments: [],
      totalDistanceKm: 0,
      manualOverride: false,
    },
  ]);
  const [legsBackup, setLegsBackup] = useState<Omit<Leg, "id">[] | null>(null);

  const [routeSearch, setRouteSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [activeHistoryDirectionTab, setActiveHistoryDirectionTab] =
    useState("Все");
  const [historyPage, setHistoryPage] = useState(7);
  const [selectedCalcIds, setSelectedCalcIds] = useState<Set<string>>(new Set());

  // Сброс пагинации при смене фильтра/поиска
  useEffect(() => { setHistoryPage(7); }, [historySearch, activeHistoryDirectionTab]);

  const uniqueDirections = useMemo(() => {
    return Array.from(
      new Set(calculationHistory.map((c) => c.globalDirection || c.direction).filter(Boolean)),
    );
  }, [calculationHistory]);

  const directionsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    calculationHistory.forEach((c) => {
      const dir = c.globalDirection || c.direction;
      if (dir) {
        counts[dir] = (counts[dir] || 0) + 1;
      }
    });
    return counts;
  }, [calculationHistory]);

  const filteredHistory = useMemo(() => {
    const searchLower = historySearch.toLowerCase().trim();
    if (!searchLower && activeHistoryDirectionTab === "Все") {
      return calculationHistory;
    }
    return calculationHistory.filter((c) => {
      const matchesSearch =
        !searchLower ||
        c.username?.toLowerCase().includes(searchLower) ||
        c.logist?.toLowerCase().includes(searchLower) ||
        JSON.stringify(c.legs).toLowerCase().includes(searchLower) ||
        (c.globalDirection || c.direction || "").toLowerCase().includes(searchLower);
      const matchesTab =
        activeHistoryDirectionTab === "Все" ||
        (c.globalDirection || c.direction) === activeHistoryDirectionTab;
      return matchesSearch && matchesTab;
    });
  }, [calculationHistory, historySearch, activeHistoryDirectionTab]);

  const visibleHistory = useMemo(() => {
    return filteredHistory.slice(0, historyPage);
  }, [filteredHistory, historyPage]);

  useEffect(() => {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 10);
    setTripStartDate(today.toISOString().split("T")[0]);
    setTripEndDate(nextWeek.toISOString().split("T")[0]);

    const diffDays =
      Math.ceil(
        Math.abs(nextWeek.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      ) || 1;
    setTripDays(diffDays);

    const subHistory = dbService.getRouteCalculations(setCalculationHistory, 100);
    const subRouteTpl = dbService.getRouteTemplates(setRouteTemplates);
    const subFerries = dbService.getFerryTemplates(setFerries);
    const subDistances = dbService.getDistances(setDistances);
    const subDirs = directoryService.getDirectionsMap((data: Record<string, number>) => {
      if (data) {
        const list: DirectionPreset[] = Object.keys(data).map((key) => ({
          id: key,
          name: key,
          coeff: Number(data[key] || 0),
        }));
        setDirections(list);
      } else {
        setDirections([]);
      }
    });
    const subPdSettings = pdService.subscribePlanDohodSettings(setPdSettings);

    // Fetch live NBRB rates directly with fallbacks
    fetch("https://api.nbrb.by/exrates/rates?periodicity=0")
      .then((res) => res.json())
      .then((data: any[]) => {
        const updated: Record<string, { scale: number; rate: number }> = {
          BYN: { scale: 1, rate: 1.0 },
          USD: { scale: 1, rate: 3.25 },
          EUR: { scale: 1, rate: 3.55 },
          RUB: { scale: 100, rate: 3.42 },
          TRY: { scale: 10, rate: 1.0 },
          KZT: { scale: 1000, rate: 7.2 },
          KGS: { scale: 100, rate: 3.7 },
          CNY: { scale: 10, rate: 4.5 },
          GEL: { scale: 1, rate: 1.2 },
          AMD: { scale: 1000, rate: 8.35 },
        };
        if (Array.isArray(data)) {
          data.forEach((item) => {
            if (
              item &&
              [
                "USD",
                "EUR",
                "RUB",
                "TRY",
                "KZT",
                "KGS",
                "CNY",
                "GEL",
                "AMD",
              ].includes(item.Cur_Abbreviation)
            ) {
              updated[item.Cur_Abbreviation] = {
                scale: item.Cur_Scale || 1,
                rate: item.Cur_OfficialRate,
              };
            }
          });
        }
        setNbrbRates(updated);
      })
      .catch((err) => {
        console.warn("Failed to fetch NBRB rates:", err);
      });

    return () => {
      subHistory();
      subRouteTpl();
      subDistances();
      subDirs();
      subPdSettings();
    };
  }, []);

  useEffect(() => {
    if (tripStartDate && tripEndDate) {
      const s = new Date(tripStartDate).getTime();
      const e = new Date(tripEndDate).getTime();
      if (e >= s) {
        const d = Math.ceil((e - s) / (1000 * 3600 * 24)) || 1;
        setTripDays(d);
      }
    }
  }, [tripStartDate, tripEndDate]);

  useEffect(() => {
    if (
      directions.length > 0 &&
      !directions.find((d) => d.name === globalDirection)
    ) {
      setGlobalDirection(directions[0].name);
    }
  }, [directions]);

  const addLegRowAfter = (index: number) => {
    const newLeg = {
      from: "",
      to: "",
      dist: 0,
      freight: 0,
      coeff: getDirCoeff(),
      infoRate: 0,
      infoCurrency: "USD",
      ferrySelectValue: "none",
      ferryCost: 0,
      additionalExpenses: 0,
      origin: "",
      destination: "",
      waypoints: [],
      mapProvider: "google" as const,
      vehicleType: "truck" as const,
      selectedRouteIndex: 0,
      routes: [],
      segments: [],
      totalDistanceKm: 0,
      manualOverride: false,
    };
    const newLegs = [...legs];
    newLegs.splice(index + 1, 0, newLeg);
    setLegs(newLegs);
  };

  const removeLeg = (index: number) => {
    if (legs.length <= 1) return;
    setLegs(legs.filter((_, i) => i !== index));
  };

  const getDirCoeff = () => {
    const found = directions.find((d) => d.name === globalDirection);
    return found ? found.coeff : 0;
  };

  const handleGlobalDirectionChange = (
    e: React.ChangeEvent<HTMLSelectElement>,
  ) => {
    const val = e.target.value;
    setGlobalDirection(val);
    const found = directions.find((d) => d.name === val);
    const coeff = found ? found.coeff : 0;
    setLegs(legs.map((l) => ({ ...l, coeff })));
  };

  const openMapRouteModal = (
    idx: number,
    origin?: string,
    destination?: string,
  ) => {
    const leg = legs[idx];
    if (!leg) return;

    // Backup current legs state in case they cancel
    setLegsBackup(JSON.parse(JSON.stringify(legs)));

    // Ensure route fields exist or are initialized with sensible defaults
    const fromVal = leg.from || origin || "";
    const toVal = leg.to || destination || "";

    const updated = recalculateLegRoute(
      fromVal,
      toVal,
      leg.waypoints || [],
      leg.mapProvider || "google",
      leg.vehicleType || "truck",
      leg.selectedRouteIndex || 0,
      distances
    );

    setLegs((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], ...updated };
      return copy;
    });

    setMapLegIndex(idx);
    setMapModalOpen(true);
  };

  const cancelMapRoute = () => {
    if (legsBackup) {
      setLegs(legsBackup);
      setLegsBackup(null);
    }
    setMapModalOpen(false);
    setMapLegIndex(null);
  };

  const applyMapRoute = () => {
    if (mapLegIndex !== null) {
      const leg = legs[mapLegIndex];
      if (saveToDirectoryChecked && leg.origin && leg.destination && leg.totalDistanceKm) {
        dbService.saveDistance(
          {
            id: "dist_" + Date.now(),
            from: leg.origin.trim(),
            to: leg.destination.trim(),
            distance: leg.totalDistanceKm,
          },
          user.name,
          user.role,
        );
      }
    }
    setLegsBackup(null);
    setMapModalOpen(false);
    setMapLegIndex(null);
    setSaveToDirectoryChecked(false);
  };

  const handleCityBlur = (idx: number) => {
    // Already calculated instantly on city input changes in updateLeg!
  };

  const updateLeg = (
    index: number,
    updatedFields: Partial<Omit<Leg, "id"> & { isManual?: boolean; distanceSource?: string; isApproximate?: boolean; manualOverride?: boolean }>,
  ) => {
    setLegs((prevLegs) => {
      const newLegs = prevLegs.map((l, i) => {
        if (i === index) {
          let merged = { ...l, ...updatedFields } as any;

          // If they edited the distance directly, turn on manualOverride
          if (updatedFields.dist !== undefined || updatedFields.distance !== undefined) {
            const manualDist = updatedFields.dist !== undefined ? updatedFields.dist : updatedFields.distance;
            merged.manualOverride = true;
            merged.isManual = true;
            merged.dist = manualDist;
            merged.distance = manualDist;
            merged.totalDistanceKm = manualDist;
            merged.distanceSource = "manual";
            merged.isApproximate = false;
          }

          // If from or to is changing, and they didn't explicitly pass dist/distance
          if (
            (updatedFields.from !== undefined || updatedFields.to !== undefined) &&
            updatedFields.dist === undefined &&
            updatedFields.distance === undefined
          ) {
            // endpoint changed -> reset manualOverride and run route calculation
            merged.manualOverride = false;
            merged.isManual = false;
            merged.origin = merged.from;
            merged.destination = merged.to;

            const res = recalculateLegRoute(
              merged.from,
              merged.to,
              merged.waypoints || [],
              merged.mapProvider || "google",
              merged.vehicleType || "truck",
              merged.selectedRouteIndex || 0,
              distances
            );

            merged = { ...merged, ...res };
          }

          // Auto-populate emptyRun (доезд)
          if (
            updatedFields.from !== undefined ||
            updatedFields.to !== undefined
          ) {
            const prevTo = i === 0 ? "Минск" : prevLegs[i - 1]?.to || legs[i - 1]?.to;
            if (prevTo && merged.from) {
              const emptyRunRes = applyDistanceToField(prevTo, merged.from, distances);
              if (emptyRunRes.estimatedRouteKm > 0) {
                merged.emptyRun = emptyRunRes.estimatedRouteKm;
              }
            }
          }

          if (updatedFields.ferrySelectValue !== undefined) {
            if (updatedFields.ferrySelectValue === "none") {
              merged.ferryCost = 0;
            } else if (updatedFields.ferrySelectValue !== "custom") {
              const tpl = ferries[parseInt(updatedFields.ferrySelectValue)];
              if (tpl) merged.ferryCost = tpl.eur || tpl.price || 0;
            }
          }

          return merged;
        }
        return l;
      });

      // If current leg's 'to' destination was changed, the next leg's 'prevTo' changes!
      if (updatedFields.to !== undefined && newLegs[index + 1]) {
        const nextLeg = { ...newLegs[index + 1] } as any;
        if (nextLeg.from && !nextLeg.manualOverride) {
          const emptyRunRes = applyDistanceToField(updatedFields.to, nextLeg.from, distances);
          if (emptyRunRes.estimatedRouteKm > 0) {
            nextLeg.emptyRun = emptyRunRes.estimatedRouteKm;
            newLegs[index + 1] = nextLeg;
          }
        }
      }

      return newLegs;
    });
  };

  const handleInfoRateBlur = (index: number) => {
    const leg = legs[index];
    if (!leg || !leg.infoRate || leg.infoCurrency === "EUR") return;
    triggerConversionCheck(index, leg.infoRate, leg.infoCurrency);
  };

  const handleCurrencyChange = (index: number, newCurrency: string) => {
    const leg = legs[index];
    if (!leg || !leg.infoRate || newCurrency === "EUR") return;
    triggerConversionCheck(index, leg.infoRate, newCurrency);
  };

  const triggerConversionCheck = (
    index: number,
    infoRate: number,
    infoCurrency: string,
  ) => {
    const rateX = nbrbRates[infoCurrency]
      ? nbrbRates[infoCurrency].rate / nbrbRates[infoCurrency].scale
      : 0;
    const rateEur = nbrbRates["EUR"] ? nbrbRates["EUR"].rate : 1;
    const proposedFreight =
      rateEur > 0 ? Math.round((infoRate * rateX) / rateEur) : 0;

    const currentFreight = legs[index]?.freight || 0;
    if (proposedFreight > 0 && Math.abs(currentFreight - proposedFreight) > 2) {
      // Auto-apply conversion immediately without confirmation dialog
      updateLeg(index, {
        freight: proposedFreight,
      });
    }
  };

  const findDistanceInPool = (c1: string, c2: string) => {
    if (!c1 || !c2) return null;
    const from = c1.trim().toLowerCase();
    const to = c2.trim().toLowerCase();
    const found = distances.find((d) => {
      const a = d.from.trim().toLowerCase();
      const b = d.to.trim().toLowerCase();
      return (a === from && b === to) || (a === to && b === from);
    });
    return found ? found.distance : null;
  };

  const checkManualDistanceUpdate = (
    from: string,
    to: string,
    newDist: number,
  ) => {
    if (!from || !to || newDist <= 0) return;
    const matched = distances.find((d) => {
      const a = d.from.trim().toLowerCase();
      const b = d.to.trim().toLowerCase();
      return (
        (a === from.trim().toLowerCase() && b === to.trim().toLowerCase()) ||
        (a === to.trim().toLowerCase() && b === from.trim().toLowerCase())
      );
    });

    if (!matched || matched.distance !== newDist) {
      const q = matched
        ? `Изменить расстояние ${from} - ${to} в базе шаблонов с ${matched.distance} км на ${newDist} км?`
        : `Сохранить новое плечо ${from} - ${to} (${newDist} км) в общую базу шаблонов расстояний?`;

      setTimeout(async () => {
        if (await showConfirm(q)) {
          if (matched) {
            dbService.saveDistance(
              { ...matched, distance: newDist },
              user.name,
              user.role,
            );
          } else {
            dbService.saveDistance(
              { id: "dist_" + Date.now(), from, to, distance: newDist },
              user.name,
              user.role,
            );
          }
        }
      }, 100);
    }
  };

  // Sync coefficient if directions change
  useEffect(() => {
    const found = directions.find((d) => d.name === globalDirection);
    if (found) {
      setLegs((prev) => {
        let changed = false;
        const newLegs = prev.map((l) => {
          if (l.coeff !== found.coeff) {
             changed = true;
             return { ...l, coeff: found.coeff };
          }
          return l;
        });
        return changed ? newLegs : prev;
      });
    }
  }, [directions, globalDirection]);

  // Math totals exactly matching legacy
  const totalKm = legs.reduce(
    (acc, l) => acc + Number(l.totalDistanceKm || l.dist || l.distance || 0) + Number(l.emptyRun || 0),
    0,
  );
  const totalFreight = legs.reduce((acc, l) => acc + Number(l.freight || 0), 0);
  const totalFerryCosts = legs.reduce(
    (acc, l) => acc + Number(l.ferryCost || 0),
    0,
  );

  // Legacy logic: expenses = sum(dist * coeff + ferryCost) + leg additionalExpenses
  const totalExpenses = Number(additionalExpenses || 0) + legs.reduce((acc, l) => {
    return (
      acc +
      ((Number(l.totalDistanceKm || l.dist || l.distance || 0) + Number(l.emptyRun || 0)) * Number(l.coeff || 0) +
        Number(l.ferryCost || 0) +
        Number(l.additionalExpenses || 0))
    );
  }, 0);

  const totalProfit = totalFreight - totalExpenses;
  const currentDailyProfit = tripDays > 0 ? totalProfit / tripDays : 0;

  const saveCalculation = () => {
    if (legs.some((l) => !l.from && !l.to && !l.dist && !l.freight)) {
      toast("Калькулятор пуст пустой. Нечего сохранять.", 'info');
      return;
    }

    const newCalc: RouteCalculation = {
      id: "calc_" + Date.now(),
      legs: legs,
      direction: globalDirection,
      days: tripDays,
      km: totalKm,
      freight: totalFreight,
      expenses: totalExpenses,
      additionalExpenses: Number(additionalExpenses || 0),
      expenseItems: expenseItems.filter((x) => x.label.trim() || Number(x.amount || 0) > 0),
      netProfit: totalProfit,
      dailyProfit: currentDailyProfit,
      datetime: new Date().toLocaleString("ru-RU"),
      logist: user.name,
      username: user.name,
    };

    dbService.saveRouteCalculation(newCalc, user.name, user.role);
  };

  const saveCurrentAsTemplate = () => {
    const name = prompt("Введите название для нового шаблона мульти-рейса:");
    if (!name || !name.trim()) return;
    const validLegs = legs.filter((l) => l.from || l.to || l.dist || l.freight);
    if (validLegs.length === 0) {
      toast("Калькулятор пуст!", 'info');
      return;
    }
    dbService.saveRouteTemplate(
      {
        name: name.trim(),
        globalDir: globalDirection,
        legs: validLegs as any,
      },
      user.name,
      user.role,
    );
  };

  const loadTemplate = (tpl: RouteTemplate) => {
    if (tpl.globalDir) setGlobalDirection(tpl.globalDir);
    const newArray = tpl.legs.map((l: any) => ({
      from: l.from || "",
      to: l.to || "",
      dist: l.dist || l.distance || 0,
      emptyRun: l.emptyRun || 0,
      freight: l.freight || 0,
      infoRate: l.infoRate || 0,
      infoCurrency: l.infoCurrency || "USD",
      ferrySelectValue: l.ferrySelectValue || "none",
      ferryCost: l.ferryCost || l.ferry || 0,
      coeff: l.coeff || 0,
      additionalExpenses: l.additionalExpenses || l.otherExpenses || 0,
      origin: l.origin || l.from || "",
      destination: l.destination || l.to || "",
      waypoints: l.waypoints || [],
      mapProvider: l.mapProvider || "google",
      vehicleType: l.vehicleType || "truck",
      selectedRouteIndex: l.selectedRouteIndex || 0,
      routes: l.routes || [],
      segments: l.segments || [],
      totalDistanceKm: l.totalDistanceKm || l.dist || l.distance || 0,
      manualOverride: l.manualOverride !== undefined ? l.manualOverride : (l.isManual || false),
    }));
    setLegs(newArray);
  };

  const copyHistoryToForm = (calc: RouteCalculation) => {
    if (calc.direction || calc.globalDirection)
      setGlobalDirection(calc.direction || calc.globalDirection || "Турция");
    if (calc.days) setTripDays(calc.days);
    setAdditionalExpenses(calc.additionalExpenses || 0);
    setExpenseItems(Array.isArray(calc.expenseItems) ? calc.expenseItems : []);

    // Attempt reverse-engineer dates from days
    if (calc.days) {
      const start = new Date(tripStartDate || new Date());
      const end = new Date(start);
      end.setDate(start.getDate() + calc.days);
      setTripStartDate(start.toISOString().split("T")[0]);
      setTripEndDate(end.toISOString().split("T")[0]);
    }

    if (calc.legs && calc.legs.length > 0) {
      setLegs(
        calc.legs.map((l: any) => ({
          from: l.from || "",
          to: l.to || "",
          dist: l.dist || l.distance || 0,
          emptyRun: l.emptyRun || 0,
          freight: l.freight || 0,
          infoRate: l.infoRate || 0,
          infoCurrency: l.infoCurrency || "USD",
          ferrySelectValue: l.ferrySelectValue || "none",
          ferryCost: l.ferryCost || 0,
          coeff: l.coeff || 0,
          additionalExpenses: l.additionalExpenses || l.otherExpenses || 0,
          origin: l.origin || l.from || "",
          destination: l.destination || l.to || "",
          waypoints: l.waypoints || [],
          mapProvider: l.mapProvider || "google",
          vehicleType: l.vehicleType || "truck",
          selectedRouteIndex: l.selectedRouteIndex || 0,
          routes: l.routes || [],
          segments: l.segments || [],
          totalDistanceKm: l.totalDistanceKm || l.dist || l.distance || 0,
          manualOverride: l.manualOverride !== undefined ? l.manualOverride : (l.isManual || false),
        })),
      );
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const editHistoryEntry = (calc: RouteCalculation) => {
    copyHistoryToForm(calc);
    dbService.deleteRouteCalculation(calc.id, user.name, user.role);
  };

  const openEditCalcModal = (calc: RouteCalculation) => {
    setEditingCalcId(calc.id);
    setEditingCalcData(calc);
    // Подтянуть статьи расходов в основную форму для редактирования
    setAdditionalExpenses(Number(calc.additionalExpenses || 0));
    setExpenseItems(Array.isArray(calc.expenseItems) ? calc.expenseItems : []);
  };

  const closeEditCalcModal = () => {
    setEditingCalcId(null);
    setEditingCalcData({});
    setAdditionalExpenses(0);
    setExpenseItems([]);
  };

  // Selection for batch print
  const toggleSelectCalc = (id: string) => {
    setSelectedCalcIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedCalcIds(new Set(visibleHistory.map((c) => c.id)));
  };

  const deselectAll = () => {
    setSelectedCalcIds(new Set());
  };

  const printSelectedCalculations = () => {
    if (selectedCalcIds.size === 0) return;
    const selected = calculationHistory.filter((c) => selectedCalcIds.has(c.id));
    if (selected.length === 0) return;

    const printHtml = buildPrintHtml(selected);
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.top = "-10000px";
    iframe.style.left = "-10000px";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (!doc) {
      document.body.removeChild(iframe);
      return;
    }
    doc.open();
    doc.write(printHtml);
    doc.close();

    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();

    // Clean up after print
    setTimeout(() => {
      document.body.removeChild(iframe);
      setSelectedCalcIds(new Set());
    }, 1000);
  };

  const buildPrintHtml = (selected: RouteCalculation[]): string => {
    const legRows = (calc: RouteCalculation) => {
      return (calc.legs || [])
        .map(
          (l, i) => `<tr>
            <td>${i + 1}</td>
            <td>${l.from || "—"}</td>
            <td>${l.to || "—"}</td>
            <td>${Math.round(Number(l.emptyRun || 0)).toLocaleString("ru-RU")}</td>
            <td>${Math.round(Number(l.totalDistanceKm || l.dist || l.distance || 0)).toLocaleString("ru-RU")}</td>
            <td>${Math.round(Number(l.freight || 0)).toLocaleString("ru-RU")}</td>
            <td>${Math.round(Number(l.infoRate || 0)).toLocaleString("ru-RU")} ${l.infoCurrency || ""}</td>
            <td>${Math.round(Number(l.additionalExpenses || l.otherExpenses || 0)).toLocaleString("ru-RU")}</td>
          </tr>`,
        )
        .join("");
    };

    const calcBlock = (calc: RouteCalculation) => {
      const totalKm = calc.km ||
        calc.totalKm ||
        (calc.legs || []).reduce(
          (acc, l) => acc + Number(l.totalDistanceKm || l.dist || l.distance || 0) + Number(l.emptyRun || 0),
          0,
        );
      const days = calc.days || 1;
      const profit = calc.netProfit || 0;
      const daily = calc.dailyProfit || (days > 0 ? profit / days : 0);
      const freight = calc.freight || calc.totalFreight || 0;
      const expenses = calc.expenses || calc.totalExpenses || 0;
      const routePoints: string[] = [];
      calc.legs.forEach((l) => {
        if (l.from && routePoints[routePoints.length - 1] !== l.from) routePoints.push(l.from);
        if (l.to && routePoints[routePoints.length - 1] !== l.to) routePoints.push(l.to);
      });
      const routeTitle = routePoints.join(" → ");

      return `
        <div class="print-calc-block">
          <h2 class="print-calc-title">${escapeHtml(routeTitle || "Без названия")}</h2>
          <div class="print-meta">${escapeHtml(calc.datetime || calc.date || "")} | Направление: <strong>${escapeHtml(calc.globalDirection || calc.direction || "Не указано")}</strong> | Логист: <strong>${escapeHtml(calc.username || calc.logist || "Система")}</strong></div>

          <div class="print-metrics">
            <div class="print-metric">
              <span class="print-metric-label">Чистая прибыль</span>
              <span class="print-metric-value">${Math.round(profit).toLocaleString("ru-RU")} €</span>
            </div>
            <div class="print-metric">
              <span class="print-metric-label">Пробег общий</span>
              <span class="print-metric-value">${Math.round(totalKm).toLocaleString("ru-RU")} км</span>
            </div>
            <div class="print-metric">
              <span class="print-metric-label">Фрахт общий</span>
              <span class="print-metric-value">${Math.round(freight).toLocaleString("ru-RU")} €</span>
            </div>
            <div class="print-metric">
              <span class="print-metric-label">Расходы</span>
              <span class="print-metric-value">${Math.round(expenses).toLocaleString("ru-RU")} €</span>
            </div>
            <div class="print-metric">
              <span class="print-metric-label">Дней в пути</span>
              <span class="print-metric-value">${days}</span>
            </div>
            <div class="print-metric">
              <span class="print-metric-label">В день</span>
              <span class="print-metric-value">${Math.round(daily).toLocaleString("ru-RU")} €/дн</span>
            </div>
          </div>

          <table class="print-legs-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Откуда</th>
                <th>Куда</th>
                <th>Доезд км</th>
                <th>Пробег км</th>
                <th>Ставка €</th>
                <th>Инфо ставка</th>
                <th>Доп. расх. €</th>
              </tr>
            </thead>
            <tbody>
              ${legRows(calc)}
            </tbody>
          </table>
          ${calc.additionalExpenses && Number(calc.additionalExpenses) > 0 ? `
            <div class="print-additional-expenses">
              <span>Дополнительные расходы по рейсу: <strong>${Number(calc.additionalExpenses).toLocaleString("ru-RU")} €</strong></span>
              ${Array.isArray(calc.expenseItems) && calc.expenseItems.length > 0 ? `<span> (${calc.expenseItems.map((e) => e.label || "—").join(", ")})</span>` : ""}
            </div>
          ` : ""}
        </div>
      `;
    };

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Сводка расчётов</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      font-size: 11px;
      color: #1e293b;
      background: #fff;
      padding: 20px;
    }
    @page {
      size: A4;
      margin: 15mm;
    }
    .print-header {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      margin-bottom: 16px;
      padding-bottom: 8px;
      border-bottom: 2px solid #334155;
      text-align: center;
    }
    .print-calc-block {
      margin-bottom: 20px;
      padding-bottom: 16px;
      border-bottom: 1px solid #cbd5e1;
      page-break-inside: avoid;
    }
    .print-calc-block:last-child {
      border-bottom: none;
    }
    .print-calc-title {
      font-size: 13px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 4px;
    }
    .print-meta {
      font-size: 9px;
      color: #64748b;
      margin-bottom: 10px;
    }
    .print-metrics {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px;
      margin-bottom: 10px;
    }
    .print-metric {
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 6px 8px;
    }
    .print-metric-label {
      display: block;
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #94a3b8;
      margin-bottom: 2px;
    }
    .print-metric-value {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: #0f172a;
      font-family: "SF Mono", Consolas, monospace;
    }
    .print-legs-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
      margin-top: 6px;
    }
    .print-legs-table th {
      background: #f1f5f9;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      font-size: 8px;
      color: #475569;
      padding: 5px 4px;
      text-align: left;
      border: 1px solid #e2e8f0;
    }
    .print-legs-table td {
      padding: 4px;
      border: 1px solid #e2e8f0;
      font-size: 9px;
    }
    .print-legs-table td:nth-child(n+4) {
      text-align: right;
      font-family: "SF Mono", Consolas, monospace;
    }
    .print-additional-expenses {
      font-size: 9px;
      color: #64748b;
      margin-top: 6px;
      padding: 4px 6px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 3px;
    }
    @media print {
      body { padding: 0; }
      .print-header { margin-top: 0; }
      .print-calc-block { page-break-inside: avoid; }
    }
    .print-no-print { display: none; }
  </style>
</head>
<body>
  <div class="print-header">Сводка расчётов — Калькуляция дохода</div>
  ${selected.map((c) => calcBlock(c)).join("")}
  <script>
    window.onload = function() { window.print(); };
  </script>
</body>
</html>`;
  };

  const escapeHtml = (text: string | undefined | null): string => {
    if (!text) return "";
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  };

  const saveEditCalcModal = () => {
    if (!editingCalcId) return;

    const totalKm = (editingCalcData.legs || []).reduce(
      (acc, leg) => acc + (leg.totalDistanceKm || leg.dist || leg.distance || 0) + (leg.emptyRun || 0),
      0,
    );
    const totalFreight = (editingCalcData.legs || []).reduce(
      (acc, leg) => acc + (leg.freight || 0),
      0,
    );

    const days = editingCalcData.days || 1;
    const dailyProfit = (editingCalcData.netProfit || 0) / Math.max(days, 1);

    dbService.updateRouteCalculation(
      editingCalcId,
      {
        ...editingCalcData,
        additionalExpenses: Number(additionalExpenses || 0),
        expenseItems: expenseItems.filter((x) => x.label.trim() || Number(x.amount || 0) > 0),
        totalKm,
        totalFreight,
        dailyProfit,
      },
      user.name,
      user.role,
    );

    closeEditCalcModal();
  };

  // Date and Days helper
  const extractDays = (txt: string): number | null => {
    const lower = txt.toLowerCase();
    // Ищем паттерны вроде "5 дней", "на 10 дн", "рейс 7 суток", "круг 14 дней", "12 суток"
    const m =
      lower.match(/(\d+)\s*(?:дней|дн\.|дн|суток|сут\.|сут|дня|день|сутки)/i) ||
      lower.match(
        /(?:круг|рейс|на|срок|время)\s*(\d+)\s*(?:дней|дн\.|дн|суток|сут\.|сут|дня|день|сутки)?/i,
      );
    if (m) {
      return parseInt(m[1], 10);
    }
    return null;
  };

  

  return (
    <div className="w-full space-y-6 font-sans">
      
      

      {/* Main Left Workspace */}
      <div className="w-full space-y-6">
        {/* Header Block */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col sm:flex-row justify-between gap-4 items-center">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">Модуль Доход</span>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <Calculator className="w-7 h-7 text-slate-800" />
              Калькуляция дохода
            </h1>
            <p className="text-sm text-slate-500 font-medium mt-1">
              Моделирование и расчет экономики рейсов, расходов и прибыли
            </p>
          </div>
        </div>


        {/* Table Container */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col">
          <h2 className="text-sm font-bold text-slate-900 tracking-tight pb-4 border-b border-slate-200/40 mb-6 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-900">
              <MapPin className="h-5 w-5 text-[#3765F6]" />{" "}
              Конструктор плеч маршрута
            </span>
            <select
              value={globalDirection}
              onChange={handleGlobalDirectionChange}
              className="ml-4 px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none w-48 shadow-sm focus:border-[#3765F6] focus:bg-white min-h-[44px]"
            >
              {directions.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </h2>

          <div className="hidden lg:block w-full pb-4 custom-scrollbar overflow-x-auto">
            <table className="w-full border-collapse relative">
              <thead className="sticky top-0 bg-slate-50 z-20 shadow-[inset_0_-1px_0_rgba(226,232,240,0.4)]">
                <tr>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left rounded-tl-xl w-8">
                    #
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-48">
                    Откуда
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-48">
                    Куда
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-28">
                    Доезд км
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-36">
                    Пробег км
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-28">
                    Ставка €
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-28">
                    Инфо ставка
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-24">
                    Валюта
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-56">
                    Паром
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-28">
                    Доп. расх. €
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-left w-20">
                    Коэф.
                  </th>
                  <th className="p-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 text-right rounded-tr-xl w-24">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/30">
                {legs.map((leg, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-slate-50/40 transition"
                  >
                    <td className="p-2 text-xs font-semibold text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="p-2">
                      <CityAutocomplete
                        value={leg.from}
                        onChange={(v) => updateLeg(idx, { from: v })}
                        onBlur={() => handleCityBlur(idx)}
                        cities={citiesList}
                        placeholder="Откуда"
                        className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                    </td>
                    <td className="p-2">
                      <CityAutocomplete
                        value={leg.to}
                        onChange={(v) => updateLeg(idx, { to: v })}
                        onBlur={() => handleCityBlur(idx)}
                        cities={citiesList}
                        placeholder="Куда"
                        className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        value={leg.emptyRun || ""}
                        onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                        onBlur={() => {
                          const prevTo = idx === 0 ? "Минск" : legs[idx - 1]?.to;
                          if (prevTo && leg.from && leg.emptyRun && leg.emptyRun > 0) {
                            checkManualDistanceUpdate(prevTo, leg.from, leg.emptyRun);
                          }
                        }}
                        className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1">
                        <div className="relative flex items-center">
                          <input
                            type="number"
                            value={leg.totalDistanceKm || leg.dist || leg.distance || ""}
                            onChange={(e) =>
                              updateLeg(idx, {
                                dist: Number(e.target.value),
                                distance: Number(e.target.value),
                                totalDistanceKm: Number(e.target.value),
                              })
                            }
                            onBlur={(e) =>
                              checkManualDistanceUpdate(
                                leg.from,
                                leg.to,
                                Number(e.target.value),
                              )
                            }
                            title={leg.manualOverride ? "Введён вручную" : "Расчёт по карте"}
                            className={`w-full pl-2 pr-8 py-2 bg-white/45 border rounded-xl text-xs font-bold focus:bg-white focus:border-[#3765F6] outline-none transition shadow-2xs ${
                              leg.manualOverride 
                                ? "border-amber-300 text-amber-950 bg-amber-50/10 focus:border-amber-500" 
                                : "border-slate-200/50 text-slate-900"
                            }`}
                          />
                          <div className="absolute right-1 flex items-center gap-1">
                            {leg.manualOverride && (
                              <span 
                                className="w-1.5 h-1.5 rounded-full bg-amber-500" 
                                title="Ручной ввод километража (кликните на «Маршрут» для восстановления привязки)"
                              />
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                openMapRouteModal(idx, leg.from, leg.to)
                              }
                              title="Маршрут"
                              className="text-slate-400 hover:text-blue-500 hover:bg-slate-100 p-1 rounded-md transition cursor-pointer"
                            >
                              <Map className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        value={leg.freight || ""}
                        onChange={(e) =>
                          updateLeg(idx, { freight: Number(e.target.value) })
                        }
                        className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                    </td>
                    <td className="p-2 relative group">
                      <input
                        type="number"
                        value={leg.infoRate || ""}
                        onChange={(e) =>
                          updateLeg(idx, { infoRate: Number(e.target.value) })
                        }
                        onBlur={() => handleInfoRateBlur(idx)}
                        className="w-full pr-8 px-2 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                      {leg.infoRate > 0 && leg.infoCurrency !== "EUR" && (
                        <button
                          type="button"
                          onClick={() =>
                            triggerConversionCheck(
                              idx,
                              leg.infoRate,
                              leg.infoCurrency,
                            )
                          }
                          title="Конвертировать по курсу НБРБ"
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#3765F6] transition p-1 cursor-pointer"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="p-2">
                      <select
                        value={leg.infoCurrency}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateLeg(idx, { infoCurrency: val });
                          handleCurrencyChange(idx, val);
                        }}
                        className="w-full px-1.5 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs leading-tight overflow-hidden text-ellipsis"
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="RUB">RUB</option>
                        <option value="BYN">BYN</option>
                      </select>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-col gap-1 w-full min-w-[140px]">
                        <select
                          value={leg.ferrySelectValue || "none"}
                          onChange={(e) =>
                            updateLeg(idx, { ferrySelectValue: e.target.value })
                          }
                          className="w-full px-2 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs font-sans"
                        >
                          <option value="none">Без парома</option>
                          {ferries.map((f, i) => (
                            <option key={f.id} value={i}>
                              {f.from} ➔ {f.to} ({f.eur || f.price}€)
                            </option>
                          ))}
                          <option value="custom">Ввести вручную ✎</option>
                        </select>
                        {leg.ferrySelectValue === "custom" && (
                          <input
                            type="number"
                            value={leg.ferryCost || ""}
                            placeholder="Цена €"
                            onChange={(e) =>
                              updateLeg(idx, {
                                ferryCost: Number(e.target.value),
                              })
                            }
                            className="w-full px-2 py-1.5 bg-yellow-50/50 border border-yellow-200/60 rounded-xl text-[10px] font-semibold outline-none focus:bg-white transition"
                          />
                        )}
                      </div>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        value={leg.additionalExpenses || ""}
                        placeholder="0"
                        onChange={(e) =>
                          updateLeg(idx, {
                            additionalExpenses: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                        className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        step="0.01"
                        value={
                          leg.coeff === undefined ? getDirCoeff() : leg.coeff
                        }
                        onChange={(e) =>
                          updateLeg(idx, { coeff: Number(e.target.value) })
                        }
                        className="w-full px-1 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs text-center"
                      />
                    </td>
                    <td className="p-2 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => addLegRowAfter(idx)}
                        className="w-9 h-9 inline-flex items-center justify-center rounded-xl bg-blue-50/50 hover:bg-blue-100 text-blue-600 border border-blue-100/30 hover:border-blue-200/50 transition cursor-pointer min-h-[44px] min-w-[44px]"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeLeg(idx)}
                        disabled={legs.length <= 1}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-rose-50/50 hover:bg-rose-100 text-rose-600 border border-rose-100/30 hover:border-rose-200/50 transition disabled:opacity-30 cursor-pointer"

                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards View */}
          <div className="block lg:hidden space-y-4 pr-1 pb-4">
            {legs.map((leg, idx) => (
              <div key={idx} className="bg-white rounded-2xl p-4 border border-slate-200/50 shadow-sm flex flex-col gap-4 relative">
                <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100/50 px-2 py-1 rounded-lg border border-slate-200/30">#{idx + 1}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => addLegRowAfter(idx)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-blue-50/50 hover:bg-blue-100 text-blue-600 border border-blue-100/30 transition cursor-pointer shadow-sm"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => removeLeg(idx)}
                      disabled={legs.length <= 1}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-rose-50/50 hover:bg-rose-100 text-rose-600 border border-rose-100/30 transition disabled:opacity-30 cursor-pointer shadow-sm"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Откуда</span>
                    <CityAutocomplete
                      value={leg.from}
                      onChange={(v) => updateLeg(idx, { from: v })}
                      onBlur={() => handleCityBlur(idx)}
                      cities={citiesList}
                      placeholder="Откуда"
                      className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Куда</span>
                    <CityAutocomplete
                      value={leg.to}
                      onChange={(v) => updateLeg(idx, { to: v })}
                      onBlur={() => handleCityBlur(idx)}
                      cities={citiesList}
                      placeholder="Куда"
                      className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Доезд (км)</span>
                    <input
                      type="number"
                      value={leg.emptyRun || ""}
                      onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                      onBlur={() => {
                        const prevTo = idx === 0 ? "Минск" : legs[idx - 1]?.to;
                        if (prevTo && leg.from && leg.emptyRun && leg.emptyRun > 0) {
                          checkManualDistanceUpdate(prevTo, leg.from, leg.emptyRun);
                        }
                      }}
                      className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Пробег (км)</span>
                    <div className="relative flex items-center">
                      <input
                        type="number"
                        value={leg.dist || leg.distance || ""}
                        onChange={(e) =>
                          updateLeg(idx, {
                            dist: Number(e.target.value),
                            distance: Number(e.target.value),
                          })
                        }
                        onBlur={(e) =>
                          checkManualDistanceUpdate(leg.from, leg.to, Number(e.target.value))
                        }
                        title={leg.manualOverride ? "Введён вручную" : "Расчёт по карте"}
                        className={`w-full pl-3 pr-12 py-2 bg-white/45 border rounded-xl text-xs font-bold text-slate-800 outline-none focus:bg-white focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs ${
                          leg.manualOverride 
                            ? "border-amber-300 text-amber-950 bg-amber-50/10 focus:border-amber-500" 
                            : "border-slate-200/50 text-slate-900"
                        }`}
                      />
                      <div className="absolute right-1 flex items-center gap-1">
                        {leg.manualOverride && (
                          <span 
                            className="w-1.5 h-1.5 rounded-full bg-amber-500" 
                            title="Ручной ввод километража (кликните на «Маршрут» для восстановления привязки)"
                          />
                        )}
                        <button
                          type="button"
                          onClick={() => openMapRouteModal(idx, leg.from, leg.to)}
                          title="Маршрут"
                          className="text-slate-400 hover:text-blue-500 hover:bg-slate-100 p-1.5 rounded-md transition cursor-pointer"
                        >
                          <Map className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Ставка €</span>
                    <input
                      type="number"
                      value={leg.freight || ""}
                      onChange={(e) => updateLeg(idx, { freight: Number(e.target.value) })}
                      className="w-full px-3 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Инфо ставка</span>
                    <div className="flex gap-1 relative">
                      <input
                        type="number"
                        value={leg.infoRate || ""}
                        onChange={(e) => updateLeg(idx, { infoRate: Number(e.target.value) })}
                        onBlur={() => handleInfoRateBlur(idx)}
                        className="w-1/2 min-w-0 pr-6 px-2 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                      {leg.infoRate > 0 && leg.infoCurrency !== "EUR" && (
                        <button
                          type="button"
                          onClick={() => triggerConversionCheck(idx, leg.infoRate, leg.infoCurrency)}
                          className="absolute left-[calc(50%-18px)] top-1/2 -translate-y-1/2 text-slate-400 hover:text-[#3765F6] transition p-1 cursor-pointer"
                        >
                          <RefreshCw className="h-3 w-3" />
                        </button>
                      )}
                      <select
                        value={leg.infoCurrency}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateLeg(idx, { infoCurrency: val });
                          handleCurrencyChange(idx, val);
                        }}
                        className="w-1/2 min-w-0 px-1 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs leading-tight"
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="RUB">RUB</option>
                        <option value="BYN">BYN</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Паром</span>
                    <div className="flex flex-col gap-1">
                      <select
                        value={leg.ferrySelectValue || "none"}
                        onChange={(e) => updateLeg(idx, { ferrySelectValue: e.target.value })}
                        className="w-full px-2 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      >
                        <option value="none">Без парома</option>
                        {ferries.map((f, i) => (
                          <option key={f.id} value={i}>{f.from} ➔ {f.to}</option>
                        ))}
                        <option value="custom">Вручную ✎</option>
                      </select>
                      {leg.ferrySelectValue === "custom" && (
                        <input
                          type="number"
                          value={leg.ferryCost || ""}
                          placeholder="Цена €"
                          onChange={(e) => updateLeg(idx, { ferryCost: Number(e.target.value) })}
                          className="w-full px-2 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Доп. расх / Коэфф</span>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        value={leg.additionalExpenses || ""}
                        placeholder="Доп €"
                        onChange={(e) => updateLeg(idx, { additionalExpenses: e.target.value === "" ? undefined : Number(e.target.value) })}
                        className="w-1/2 min-w-0 px-2 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={leg.coeff === undefined ? getDirCoeff() : leg.coeff}
                        onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                        className="w-1/2 min-w-0 px-2 py-2 bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs text-center"
                      />
                    </div>
                  </div>
                </div>

              </div>
            ))}
          </div>


          {/* Multi-Leg save template helper */}
          <div className="mt-4 flex flex-col sm:flex-row justify-end gap-2 sm:gap-2">
            <button
              onClick={() =>
                setLegs([
                  {
                    from: "",
                    to: "",
                    dist: 0,
                    emptyRun: 0,
                    freight: 0,
                    coeff: getDirCoeff(),
                    infoRate: 0,
                    infoCurrency: "USD",
                    ferrySelectValue: "none",
                    ferryCost: 0,
                    additionalExpenses: 0,
                  },
                ])
              }
              className="w-full sm:w-auto px-4 py-2 bg-white border border-slate-200/60 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition min-h-[44px]"
            >
              Сбросить
            </button>
            <button
              onClick={saveCurrentAsTemplate}
              className="w-full sm:w-auto px-4 py-2 bg-white border border-slate-200/60 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition flex items-center justify-center gap-1.5 min-h-[44px]"
            >
              <Save className="h-3.5 w-3.5" /> Шаблонизировать
            </button>
            {user.permissions.dohod === "write" && (
              <button
                onClick={saveCalculation}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-5 py-2.5 rounded-xl transition cursor-pointer shadow-sm min-h-[44px]"
              >
                <Save className="h-4 w-4" /> Сохранить расчет
              </button>
            )}
          </div>
        </div>

        {/* Total Stats Banner - Full Width Layout Panel */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col">
          <h2 className="text-sm font-bold text-slate-900 tracking-tight pb-4 border-b border-slate-200/40 mb-4 md:mb-6 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-900">
              <TrendingUp className="h-4 w-4 md:h-5 md:w-5 text-[#3765F6]" />{" "}
              Экономика рейса
            </span>
          </h2>
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            
            {/* Left Column: Экономика Рейса */}
            <div className="lg:col-span-5 flex flex-col gap-4">
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Показатели экономики
              </h3>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-white border border-slate-200/40 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold mb-1">
                    Общий пробег
                  </span>
                  <span className="text-xl font-bold tracking-tight text-slate-800">
                    {totalKm.toLocaleString("ru-RU")} км
                  </span>
                </div>

                <div className="bg-white border border-slate-200/40 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold mb-1">
                    Общий Фрахт
                  </span>
                  <span className="text-xl font-bold tracking-tight text-[#3765F6]">
                    {totalFreight.toLocaleString("ru-RU")} €
                  </span>
                </div>

                <div className="bg-white border border-slate-200/40 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold mb-1">
                    Расходы ({globalDirection})
                  </span>
                  <span className="text-xl font-bold tracking-tight text-amber-600">
                    {totalExpenses.toLocaleString("ru-RU")} €
                  </span>
                </div>

                <div className="bg-white border border-slate-200/40 p-4 rounded-2xl">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider block font-bold mb-1">
                    Дней в пути
                  </span>
                  <span className="text-xl font-bold tracking-tight text-slate-800">
                    {tripDays}
                  </span>
                </div>
              </div>

              <div
                className={`mt-2 border p-5 rounded-2xl flex flex-col justify-between gap-2 ${
                  totalProfit > 2000 
                    ? "border-emerald-200 bg-emerald-50/35" 
                    : "border-rose-200 bg-rose-50/35"
                }`}
              >
                <div>
                  <span
                    className={`text-[10px] uppercase tracking-wider block font-bold ${
                      totalProfit > 2000 ? "text-emerald-700" : "text-rose-700"
                    }`}
                  >
                    Чистая прибыль
                  </span>
                  <span
                    className={`text-3xl font-extrabold tracking-tight mt-1 block ${
                      totalProfit > 2000 ? "text-emerald-600" : "text-rose-600"
                    }`}
                  >
                    {totalProfit.toLocaleString("ru-RU")} €
                  </span>
                </div>
                <div className="pt-2 border-t border-slate-100/50 mt-2 flex justify-between items-center text-xs">
                  <span className="text-slate-500 font-medium">Суточная доходность:</span>
                  <span className={`font-bold ${currentDailyProfit > 200 ? "text-emerald-600" : "text-rose-600"}`}>
                    {Math.round(currentDailyProfit).toLocaleString("ru-RU")} €/сут
                  </span>
                </div>
              </div>
            </div>

            {/* Right Column: Параметры Доходности */}
            <div className="lg:col-span-7 flex flex-col gap-6">
              
              {/* Блок Дат и Дней */}
              <div className="flex flex-col gap-3">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-[#3765F6]" />
                  Время в пути
                </h3>
                
                <div className="bg-white p-5 rounded-2xl border border-slate-200/40 flex flex-col gap-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Старт рейса</span>
                      <input
                        type="date"
                        value={tripStartDate}
                        onChange={(e) => setTripStartDate(e.target.value)}
                        className="w-full bg-white/45 text-slate-800 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs cursor-pointer min-h-[44px]"
                      />
                    </div>
                    
                    <div className="flex flex-col gap-1.5">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Завершение</span>
                      <input
                        type="date"
                        value={tripEndDate}
                        onChange={(e) => setTripEndDate(e.target.value)}
                        className="w-full bg-white/45 text-slate-800 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs cursor-pointer min-h-[44px]"
                      />
                    </div>
                  </div>
                  
                  <div className="bg-slate-500/5 border border-slate-500/10 rounded-xl p-3 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Итого дней в рейсе:</span>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="1"
                        value={tripDays}
                        onChange={(e) => setTripDays(Number(e.target.value))}
                        className="w-16 bg-white/45 border border-slate-200/50 rounded-xl px-2 py-1.5 text-xs font-semibold text-[#3765F6] outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs text-center"
                      />
                      <span className="text-xs font-bold text-slate-500">дней</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Блок Допрасходов */}
              <div className="flex flex-col gap-3">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5 text-rose-500" />
                  Дополнительные расходы
                </h3>
                
                <div className="bg-white p-4 rounded-2xl border border-slate-200/40 flex flex-col gap-3">
                  <div className="flex items-center justify-between bg-white border border-slate-200/40 rounded-xl p-3 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-lg bg-rose-50/50 flex items-center justify-center text-rose-500">
                        <Receipt className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Прочие затраты по рейсу</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min="0"
                        value={additionalExpenses}
                        onChange={(e) => setAdditionalExpenses(Number(e.target.value))}
                        className="w-24 bg-white/45 border border-slate-200/50 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-rose-600 outline-none focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100/30 transition shadow-2xs text-right min-h-[44px]"
                      />
                      <span className="text-xs font-bold text-slate-400">€</span>
                    </div>
                  </div>
                  
                  {/* Список статей расходов */}
                  {expenseItems.length > 0 && (
                    <div className="flex flex-col gap-2">
                      {expenseItems.map((item, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <input
                            type="text"
                            value={item.label}
                            onChange={(e) => {
                              const next = [...expenseItems];
                              next[idx] = { ...next[idx], label: e.target.value };
                              setExpenseItems(next);
                            }}
                            placeholder="Название статьи"
                            className="flex-1 bg-white/45 border border-slate-200/50 rounded-xl px-2.5 py-1.5 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                          />
                          <input
                            type="number"
                            min="0"
                            value={item.amount}
                            onChange={(e) => {
                              const next = [...expenseItems];
                              next[idx] = { ...next[idx], amount: Number(e.target.value) };
                              setExpenseItems(next);
                              setAdditionalExpenses(next.reduce((a, x) => a + Number(x.amount || 0), 0));
                            }}
                            className="w-24 bg-white/45 border border-slate-200/50 rounded-xl px-2.5 py-1.5 text-sm font-semibold text-rose-600 outline-none focus:bg-white focus:border-rose-400 focus:ring-2 focus:ring-rose-100/30 transition shadow-2xs text-right min-h-[44px]"
                          />
                          <span className="text-xs font-bold text-slate-400">€</span>
                          <button
                            type="button"
                            onClick={() => {
                              const next = expenseItems.filter((_, i) => i !== idx);
                              setExpenseItems(next);
                              setAdditionalExpenses(next.reduce((a, x) => a + Number(x.amount || 0), 0));
                            }}
                            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl bg-rose-50/50 hover:bg-rose-100 text-rose-600 border border-rose-100/30 transition shadow-sm cursor-pointer"
                            title="Удалить статью"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const next = [...expenseItems, { label: "", amount: 0 }];
                      setExpenseItems(next);
                    }}
                    className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs font-medium hover:bg-white/40 hover:text-slate-700 hover:border-slate-300/40 transition min-h-[44px]"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Добавить статью расхода
                  </button>
                </div>
              </div>
            </div>

          </div>
        </div>
      </div>

      {/* Widgets under Constructor - Responsive Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Custom Currency Converter Widget */}
        <div
          id="nbrb-converter-widget"
          className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm relative overflow-hidden"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 select-none">
            <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <Landmark className="w-4 h-4 text-[#3765F6]" /> Конвертер валют НБ РБ
            </h2>
            <span className="text-[10px] md:text-xs font-semibold tracking-wider text-slate-500 bg-slate-100 px-2 py-0.5 rounded-xl border border-slate-200/60">
              API NBRB.BY
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4 bg-white/45 border border-slate-200/50 p-3 rounded-2xl text-xs select-none shadow-sm">
            <span className="text-slate-500 font-bold shrink-0 mr-2">
              Курсы НБ РБ:
            </span>
            <span className="text-slate-800 font-bold shrink-0">
              1 USD = {(nbrbRates["USD"]?.rate || 3.25).toFixed(4)}
            </span>
            <span className="text-slate-800 font-bold shrink-0">
              1 EUR = {(nbrbRates["EUR"]?.rate || 3.55).toFixed(4)}
            </span>
            <span className="text-slate-800 font-bold shrink-0">
              100 RUB = {(nbrbRates["RUB"]?.rate || 3.42).toFixed(4)}
            </span>
            <span className="text-slate-800 font-bold shrink-0">
              10 TRY = {(nbrbRates["TRY"]?.rate || 1.0).toFixed(4)}
            </span>
            <span className="text-slate-800 font-bold shrink-0">
              10 CNY = {(nbrbRates["CNY"]?.rate || 4.5).toFixed(4)}
            </span>
          </div>

          <div className="w-full bg-white/45 rounded-2xl p-4 md:p-5 border border-slate-200/50 flex flex-col gap-3 max-h-[60vh] md:max-h-[400px] overflow-y-auto custom-scrollbar">
            {[
              "BYN",
              "USD",
              "EUR",
              "RUB",
              "TRY",
              "KZT",
              "KGS",
              "CNY",
              "GEL",
              "AMD",
            ].map((cur) => (
              <div
                key={cur}
                className="flex items-center w-full bg-white border border-slate-200/50 rounded-xl overflow-hidden focus-within:border-[#3765F6] focus-within:ring-2 focus-within:ring-blue-100/30 shadow-2xs transition"
              >
                <div className="bg-white/45 flex-shrink-0 px-4 py-3 border-r border-slate-200/50 font-semibold text-slate-700 min-w-[85px] text-center select-none flex items-center justify-center gap-2 text-sm">
                  <span className="text-[16px] leading-none">
                    {cur === "BYN"
                      ? "🇧🇾"
                      : cur === "USD"
                        ? "🇺🇸"
                        : cur === "EUR"
                          ? "🇪🇺"
                          : cur === "RUB"
                            ? "🇷🇺"
                            : cur === "TRY"
                              ? "🇹🇷"
                              : cur === "KZT"
                                ? "🇰🇿"
                                : cur === "KGS"
                                  ? "🇰🇬"
                                  : cur === "CNY"
                                    ? "🇨🇳"
                                    : cur === "GEL"
                                      ? "🇬🇪"
                                      : "🇦🇲"}
                  </span>
                  {cur}
                </div>
                <input
                  type="number"
                  id={`conv-multi-${cur}`}
                  placeholder="0.00"
                  defaultValue={
                    cur === "USD"
                      ? 100
                      : (
                          (100 *
                            ((nbrbRates["USD"]?.rate || 3.25) /
                              (nbrbRates["USD"]?.scale || 1))) /
                          ((nbrbRates[cur]?.rate || 1) /
                            (nbrbRates[cur]?.scale || 1))
                        ).toFixed(2)
                  }
                  onInput={(e) => {
                    const inputVal = parseFloat(
                      (e.target as HTMLInputElement).value,
                    );
                    if (isNaN(inputVal)) {
                      [
                        "BYN",
                        "USD",
                        "EUR",
                        "RUB",
                        "TRY",
                        "KZT",
                        "KGS",
                        "CNY",
                        "GEL",
                        "AMD",
                      ].forEach((toCur) => {
                        if (toCur !== cur) {
                          const el = document.getElementById(
                            `conv-multi-${toCur}`,
                          ) as HTMLInputElement;
                          if (el) el.value = "";
                        }
                      });
                      return;
                    }

                    const fromCur = cur;
                    const rateFrom = nbrbRates[fromCur]
                      ? nbrbRates[fromCur].rate / nbrbRates[fromCur].scale
                      : 1;

                    [
                      "BYN",
                      "USD",
                      "EUR",
                      "RUB",
                      "TRY",
                      "KZT",
                      "KGS",
                      "CNY",
                      "GEL",
                      "AMD",
                    ].forEach((toCur) => {
                      if (toCur !== fromCur) {
                        const rateTo = nbrbRates[toCur]
                          ? nbrbRates[toCur].rate / nbrbRates[toCur].scale
                          : 1;
                        const el = document.getElementById(
                          `conv-multi-${toCur}`,
                        ) as HTMLInputElement;
                        if (el)
                          el.value = ((inputVal * rateFrom) / rateTo).toFixed(
                            4,
                          );
                      }
                    });
                  }}
                  className="w-full bg-transparent px-4 py-3 text-right text-base font-semibold text-slate-800 outline-none placeholder:text-slate-300"
                />
              </div>
            ))}
          </div>

          <p className="text-[9px] text-slate-400 mt-4 font-mono leading-tight uppercase font-medium">
            *Курсы обновляются автоматически с открытого API НБ РБ
          </p>
        </div>

        {/* Templates Board */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col transition-all">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-slate-200/40 mb-6">
            <div>
              <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-[#3765F6]" />
                База готовых шаблонов мульти-рейсов
              </h2>
              <p className="text-xs text-slate-400 mt-1 font-medium">
                Быстрая загрузка преднастроенных маршрутов и калькуляций
              </p>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="Поиск по названию..."
                value={routeSearch}
                onChange={(e) => setRouteSearch(e.target.value)}
                className="text-xs px-4 pl-9 py-2 bg-white/45 border border-slate-200/50 rounded-xl outline-none font-semibold text-slate-800 focus:bg-white focus:border-[#3765F6] transition shadow-2xs w-full sm:w-64 min-h-[44px]"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            </div>
          </div>

          <div className="flex flex-col gap-3">
            {routeTemplates
              .filter((t) =>
                t.name.toLowerCase().includes(routeSearch.toLowerCase()),
              )
              .map((t, idx) => {
                const totalDist = (t.legs || []).reduce((acc, l) => acc + (l.dist || l.distance || 0), 0);
                return (
                  <div
                    key={idx}
                    className="group bg-white hover:bg-white/70 border border-slate-200/50 hover:border-[#3765F6]/50 rounded-2xl p-5 flex flex-col gap-4 transition-all duration-200 shadow-sm"
                  >
                    {/* Top Row: Info and Actions */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-200/20">
                      {/* Left: Icon, Name and Badges */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 rounded-xl bg-blue-50/55 text-[#3765F6] shrink-0 border border-blue-100/20">
                          <FolderOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-bold text-sm text-slate-900 truncate" title={t.name}>
                            {t.name}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            {t.globalDir && (
                              <span className="text-[9px] bg-emerald-50 text-emerald-700 font-bold uppercase tracking-wider px-2 py-0.5 rounded-xl border border-emerald-100/30">
                                {t.globalDir}
                              </span>
                            )}
                            <span className="text-[9px] bg-slate-100/55 text-slate-600 font-bold uppercase tracking-wider px-2 py-0.5 rounded-xl border border-slate-200/20">
                              {t.legs?.length || 0} {t.legs?.length === 1 ? 'плечо' : t.legs?.length < 5 ? 'плеча' : 'плеч'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Total Distance and Buttons */}
                      <div className="flex items-center justify-between md:justify-end gap-5 shrink-0">
                        <div className="text-left md:text-right md:mr-2">
                          <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">
                            Общий пробег
                          </span>
                          <span className="text-slate-950 font-bold text-xs md:text-sm">
                            {totalDist.toLocaleString("ru-RU")} км
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => loadTemplate(t)}
                            className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-2 px-3.5 rounded-xl transition shadow-sm cursor-pointer active:scale-95 min-h-[44px]"
                          >
                            Развернуть ↵
                          </button>
                          {user.permissions.dohod === "write" && (
                            <button
                              onClick={() =>
                                dbService.deleteRouteTemplate(
                                  t.id!,
                                  user.name,
                                  user.role,
                                )
                              }
                              className="text-rose-500 hover:bg-rose-50 hover:text-rose-600 p-2 rounded-xl transition cursor-pointer active:scale-95"
                              title="Удалить шаблон"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row: Legs Timeline Flow (Full Width, beautifully styled) */}
                    <div className="bg-white/30 p-3 rounded-xl border border-slate-200/20">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-bold text-slate-700 w-full">
                        {(t.legs || []).map((l, i) => (
                          <div key={i} className="flex items-center gap-2">
                            {i > 0 && (
                              <span className="text-slate-300 font-bold text-[11px] select-none px-0.5">&rarr;</span>
                            )}
                            <span className="bg-white/75 px-3 py-1.5 rounded-xl border border-slate-200/40 text-[10px] sm:text-[11px] font-bold text-slate-800 flex items-center gap-2 shadow-2xs hover:border-[#3765F6] hover:shadow-xs transition duration-150">
                              <span className="truncate max-w-[140px] text-slate-900" title={l.from}>{l.from || "?"}</span>
                              <span className="text-slate-300 font-normal select-none">&bull;</span>
                              <span className="truncate max-w-[140px] text-slate-700" title={l.to}>{l.to || "?"}</span>
                              <span className="text-[10px] text-[#3765F6] font-bold bg-blue-50/50 px-1.5 py-0.5 rounded-xl border border-blue-100/30 ml-1 shrink-0">
                                {Number(l.dist || l.distance || 0).toLocaleString("ru-RU")} км
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            {routeTemplates.length === 0 && (
              <div className="py-12 text-center text-xs text-slate-400 font-semibold bg-white/30 border border-dashed border-slate-200 rounded-2xl">
                Шаблоны не найдены. Создайте первый шаблон, нажав кнопку выше.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History of Saved Calculations - FULL WIDTH BOTTOM */}
      <div className="w-full">
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col">
          <div className="flex flex-col gap-4 border-b border-slate-200/40 pb-5 mb-6">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-[#3765F6]" /> Журнал расчетов
              </h2>
            </div>
            <div className="relative">
              <input
                type="text"
                placeholder="Поиск по направлениям, дате, логисту..."
                value={historySearch}
                onChange={(e) => setHistorySearch(e.target.value)}
                className="text-xs px-4 pl-9 py-2.5 w-full bg-white/45 border border-slate-200/50 rounded-xl outline-none font-semibold text-slate-800 focus:bg-white focus:border-[#3765F6] transition shadow-2xs min-h-[44px]"
              />
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            </div>
          </div>

          {/* Directions Tabs */}
          <div className="flex flex-wrap gap-1.5 mb-6 bg-white/45 p-1.5 rounded-xl border border-slate-200/50">
            <button
              onClick={() => setActiveHistoryDirectionTab("Все")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                activeHistoryDirectionTab === "Все"
                  ? "bg-slate-900 text-white shadow-xs"
                  : "text-slate-500 hover:text-slate-900 hover:bg-white/30"
              }`}
            >
              Все направления ({calculationHistory.length})
            </button>
            {uniqueDirections.map((dir) => {
              const count = directionsCounts[dir] || 0;
              return (
                <button
                  key={dir}
                  onClick={() => setActiveHistoryDirectionTab(dir)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                    activeHistoryDirectionTab === dir
                      ? "bg-slate-900 text-white shadow-xs"
                      : "text-slate-500 hover:text-slate-900 hover:bg-white/30"
                  }`}
                >
                  {dir} ({count})
                </button>
              );
            })}
          </div>

          {/* Selection toolbar */}
          <div className="flex items-center justify-between gap-3 mb-4 px-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllVisible}
                className="px-3 py-1.5 bg-white border border-slate-200/60 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition min-h-[36px] cursor-pointer"
              >
                Выбрать все
              </button>
              <button
                type="button"
                onClick={deselectAll}
                className="px-3 py-1.5 bg-white border border-slate-200/60 hover:bg-slate-50 text-slate-700 rounded-xl text-xs font-semibold transition min-h-[36px] cursor-pointer"
              >
                Снять все
              </button>
              <span className="text-[10px] text-slate-400 font-medium">
                Выбрано: {selectedCalcIds.size}
              </span>
            </div>
            {selectedCalcIds.size > 0 && (
              <button
                type="button"
                onClick={printSelectedCalculations}
                className="flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-5 py-2 rounded-xl transition cursor-pointer shadow-sm min-h-[44px]"
              >
                <Printer className="h-4 w-4" />
                Печать выбранных ({selectedCalcIds.size})
              </button>
            )}
          </div>

          <div className="pr-1 space-y-2 pb-4">
            {visibleHistory.map((calc) => (
              <CalculationCard
                key={calc.id}
                calc={calc}
                user={user}
                copyHistoryToForm={copyHistoryToForm}
                openEditCalcModal={openEditCalcModal}
                isSelected={selectedCalcIds.has(calc.id)}
                onToggleSelect={toggleSelectCalc}
              />
            ))}
            {filteredHistory.length === 0 && (
              <div className="text-center text-[10px] text-slate-400 font-bold uppercase tracking-wider py-8">
                Журнал пуст
              </div>
            )}
            {historyPage < filteredHistory.length && (
              <button
                type="button"
                onClick={() => setHistoryPage((p) => p + 10)}
                className="w-full py-2.5 rounded-xl border border-dashed border-slate-200 text-slate-500 text-xs font-semibold hover:bg-white/40 hover:text-slate-700 hover:border-slate-300/40 transition min-h-[44px]"
              >
                Показать ещё 10
                <span className="text-slate-400 font-normal">
                  {" "}(осталось {filteredHistory.length - historyPage})
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      <MapRouteModal
        isOpen={mapModalOpen}
        onClose={cancelMapRoute}
        legIndex={mapLegIndex}
        leg={mapLegIndex !== null ? legs[mapLegIndex] : null}
        presets={distances}
        onUpdateLegRoute={(idx, updated) => {
          setLegs((prev) => {
            const copy = [...prev];
            copy[idx] = { ...copy[idx], ...updated };
            return copy;
          });
        }}
        saveToDirectoryChecked={saveToDirectoryChecked}
        setSaveToDirectoryChecked={setSaveToDirectoryChecked}
        onApply={applyMapRoute}
      />

      {editingCalcId && (
        <div className="fixed inset-0 z-50 flex flex-col md:items-center md:justify-center bg-slate-900/40 animate-fade-in">
          <div className="bg-white w-full h-full md:h-auto md:rounded-2xl md:w-full md:max-w-lg mx-0 md:mx-4 shadow-2xl border border-slate-200 md:my-4 flex flex-col">
            <div className="p-4 md:p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
              <h3 className="text-xs md:text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <Edit className="w-4 h-4 md:w-5 md:h-5 text-[#3765F6]" /> Редактирование калькуляции
              </h3>
              <button onClick={closeEditCalcModal} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition cursor-pointer">
                <X className="w-5 h-5" strokeWidth={2.5} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Направление
                </label>
                <input
                  type="text"
                  value={editingCalcData.globalDirection || ""}
                  onChange={(e) =>
                    setEditingCalcData({
                      ...editingCalcData,
                      globalDirection: e.target.value,
                    })
                  }
                  className="w-full bg-white/45 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Чистая прибыль (€)
                </label>
                <input
                  type="number"
                  step="1"
                  value={editingCalcData.netProfit || 0}
                  onChange={(e) =>
                    setEditingCalcData({
                      ...editingCalcData,
                      netProfit: Number(e.target.value),
                    })
                  }
                  className="w-full bg-white/45 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Доп. расходы (€)
                </label>
                <input
                  type="number"
                  step="1"
                  value={editingCalcData.additionalExpenses || 0}
                  onChange={(e) =>
                    setEditingCalcData({
                      ...editingCalcData,
                      additionalExpenses: Number(e.target.value),
                    })
                  }
                  className="w-full bg-white/45 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Дней в пути
                </label>
                <input
                  type="number"
                  step="1"
                  value={editingCalcData.days || 1}
                  onChange={(e) =>
                    setEditingCalcData({
                      ...editingCalcData,
                      days: Number(e.target.value),
                    })
                  }
                  className="w-full bg-white/45 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Дата
                </label>
                <input
                  type="text"
                  value={editingCalcData.datetime || ""}
                  onChange={(e) =>
                    setEditingCalcData({
                      ...editingCalcData,
                      datetime: e.target.value,
                    })
                  }
                  className="w-full bg-white/45 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Логист / Кто внёс
                </label>
                <input
                  type="text"
                  value={
                    editingCalcData.username || editingCalcData.logist || ""
                  }
                  onChange={(e) =>
                    setEditingCalcData({
                      ...editingCalcData,
                      username: e.target.value,
                      logist: e.target.value,
                    })
                  }
                  className="w-full bg-white/45 border border-slate-200/50 rounded-xl px-3 py-2 text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition shadow-2xs"
                />
              </div>
            </div>

            <div className="p-4 md:p-6 border-t border-slate-100 flex flex-col sm:flex-row justify-end gap-2 shrink-0">
              <button onClick={closeEditCalcModal} className="w-full sm:w-auto px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-xs md:text-sm shadow-sm min-h-[44px]">
                Отмена
              </button>
              <button onClick={saveEditCalcModal} className="w-full sm:w-auto px-4 md:px-6 py-2.5 md:py-3 rounded-xl font-semibold text-white bg-slate-900 hover:bg-slate-800 transition flex items-center justify-center gap-2 shadow-sm text-xs md:text-sm cursor-pointer min-h-[44px]">
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
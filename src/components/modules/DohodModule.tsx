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
  Loader2,
  AlertTriangle,
  ExternalLink,
  Compass,
} from "lucide-react";
import { buildYandexMapUrl } from "../MapRouteModal";
import {applyDistanceToField, recalculateLegRoute} from '../../utils/distanceCalculator'
import { UI, plural } from '../../ui/kit';
import { currentAccentColor, hexToRgb } from '../../theme/accent';
import { SectionHeader, FilterPills, ModalShell, EmptyState, ErrorRow } from '../../ui/components';
import { currencyName, currencySymbol } from '../../utils/currencyMeta';
import { useModalKeyboard } from '../../hooks/useModalKeyboard';

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (window as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";
const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

const useMap = () => null;
const useMapsLibrary = (...args: any[]) => null;

/** Валюты конвертера НБ РБ — тот же набор, что и раньше (порядок и состав не менялись). */
const CONVERTER_CURRENCIES: string[] = [
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
];

/**
 * Даты портала — через слэш: 03/10/2026.
 * Принимает «03.10.2026, 14:35», ISO-строку или уже готовый слэш-формат.
 * Только оформление: данные записи не изменяются.
 */
function formatDateSlash(input?: string | null): string {
  if (!input) return "";
  const rawDate = String(input).split(",")[0].trim();
  const dotted = rawDate.match(/^(\d{2})\.(\d{2})\.(\d{4})/);
  if (dotted) return `${dotted[1]}/${dotted[2]}/${dotted[3]}`;
  const slashed = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (slashed) return `${slashed[1]}/${slashed[2]}/${slashed[3]}`;
  const parsed = new Date(rawDate);
  if (!isNaN(parsed.getTime())) {
    const dd = String(parsed.getDate()).padStart(2, "0");
    const mm = String(parsed.getMonth() + 1).padStart(2, "0");
    return `${dd}/${mm}/${parsed.getFullYear()}`;
  }
  return rawDate;
}

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
        strokeColor: currentAccentColor('ui'),
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
        strokeColor: currentAccentColor('ui'),
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

/**
 * Окно маршрута плеча — локальная версия прежнего MapRouteModal в оформлении
 * портала (ModalShell + UI-кит). Поведение сохранено один в один: те же поля,
 * та же синхронизация с родителем при каждом вводе, ручной пробег, заезды,
 * галочка «в справочник расстояний», «Применить» неактивна при нулевом пробеге.
 */
function MapRouteDialog({
  isOpen,
  onClose,
  legIndex,
  leg,
  onUpdateLegRoute,
  saveToDirectoryChecked = false,
  setSaveToDirectoryChecked,
  onApply,
}: {
  isOpen: boolean;
  onClose: () => void;
  legIndex: number | null;
  leg: any;
  onUpdateLegRoute: (index: number, updatedFields: any) => void;
  saveToDirectoryChecked?: boolean;
  setSaveToDirectoryChecked?: (val: boolean) => void;
  onApply: () => void;
}) {
  const [localOrigin, setLocalOrigin] = useState("");
  const [localDestination, setLocalDestination] = useState("");
  const [localWaypoints, setLocalWaypoints] = useState<string[]>([]);
  const [manualDistanceKm, setManualDistanceKm] = useState<string>("");

  // Синхронизация полей только при открытии окна — как в прежнем окне карты
  // (чтобы курсор не прыгал и не было гонок при вводе).
  useEffect(() => {
    if (isOpen && leg && legIndex !== null) {
      setLocalOrigin(leg.origin || leg.from || "");
      setLocalDestination(leg.destination || leg.to || "");
      setLocalWaypoints(leg.waypoints || []);
      const currentDistance = leg.totalDistanceKm || leg.dist || leg.distance || 0;
      setManualDistanceKm(currentDistance > 0 ? currentDistance.toString() : "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const totalMileageNum = parseFloat(manualDistanceKm) || 0;

  // Escape закрывает окно, Enter подтверждает «Применить» (когда оно доступно),
  // фокус ставится на первое поле и возвращается на источник при закрытии.
  useModalKeyboard({
    isOpen: isOpen && legIndex !== null && !!leg,
    onClose,
    onConfirm: totalMileageNum > 0 ? onApply : undefined,
  });

  if (!isOpen || legIndex === null || !leg) return null;

  // Обновления точек уходят в родителя сразу, ручной пробег не затрагивается.
  const syncPointsToParent = (
    originVal: string,
    destVal: string,
    wpsVal: string[],
  ) => {
    const distanceValue = parseFloat(manualDistanceKm) || 0;
    onUpdateLegRoute(legIndex, {
      from: originVal,
      to: destVal,
      origin: originVal,
      destination: destVal,
      waypoints: wpsVal,
      mapProvider: "yandex",
      totalDistanceKm: distanceValue,
      dist: distanceValue,
      distance: distanceValue,
    });
  };

  const handleOriginChange = (val: string) => {
    setLocalOrigin(val);
    syncPointsToParent(val, localDestination, localWaypoints);
  };

  const handleDestinationChange = (val: string) => {
    setLocalDestination(val);
    syncPointsToParent(localOrigin, val, localWaypoints);
  };

  const handleWaypointChange = (index: number, val: string) => {
    const updated = [...localWaypoints];
    updated[index] = val;
    setLocalWaypoints(updated);
    syncPointsToParent(localOrigin, localDestination, updated);
  };

  const handleAddWaypoint = () => {
    const updated = [...localWaypoints, ""];
    setLocalWaypoints(updated);
    syncPointsToParent(localOrigin, localDestination, updated);
  };

  const handleRemoveWaypoint = (index: number) => {
    const updated = localWaypoints.filter((_, idx) => idx !== index);
    setLocalWaypoints(updated);
    syncPointsToParent(localOrigin, localDestination, updated);
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

  // URL встроенной и внешней карты — тот же помощник buildYandexMapUrl, что и раньше.
  const embedUrl = buildYandexMapUrl(localOrigin, localDestination, localWaypoints);
  const yandexPoints = [localOrigin, ...localWaypoints, localDestination]
    .map((p) => p.trim())
    .filter((p) => p !== "");
  const yandexExternalUrl = `https://yandex.ru/maps/?rtext=${yandexPoints
    .map(encodeURIComponent)
    .join("~")}&rtt=auto`;

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title={`Маршрут плеча №${legIndex + 1}`}
      subtitle="Точки маршрута, заезды и итоговый пробег"
      icon={<Compass className="w-4 h-4" />}
      iconTone="graphite"
      maxWidth="max-w-xl"
      footer={
        <>
          <button type="button" onClick={onClose} className={`${UI.buttonGhost} w-full sm:w-auto`}>
            Отмена
          </button>
          <button
            type="button"
            onClick={onApply}
            disabled={totalMileageNum === 0}
            className={`${UI.buttonDark} w-full sm:w-auto`}
          >
            <Check className="w-4 h-4" />
            Применить
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {/* Поля маршрута */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <span className={UI.fieldLabel}>Откуда</span>
            <input
              type="text"
              value={localOrigin}
              onChange={(e) => handleOriginChange(e.target.value)}
              placeholder="Город отправления…"
              className={UI.input}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className={UI.fieldLabel}>Промежуточные пункты ({localWaypoints.length})</span>
              <button
                type="button"
                onClick={handleAddWaypoint}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--accent-ink)] hover:underline cursor-pointer"
              >
                <Plus className="w-3 h-3" /> Добавить
              </button>
            </div>
            {localWaypoints.length === 0 ? (
              <div className="text-[11px] text-[#9CA3AF] py-2 text-center bg-[#F8F9FA] border border-dashed border-[#E5E7EB] rounded-xl">
                Без заездов
              </div>
            ) : (
              <div className="flex flex-col gap-1.5 max-h-[200px] overflow-y-auto custom-scrollbar pr-1">
                {localWaypoints.map((wp, idx) => (
                  <div
                    key={wp + idx}
                    className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-[#E5E7EB] focus-within:border-[var(--accent-ui)] transition-colors"
                  >
                    <span className="text-[10px] font-mono text-[#9CA3AF] w-4 text-center select-none">
                      {idx + 1}
                    </span>
                    <input
                      type="text"
                      value={wp}
                      onChange={(e) => handleWaypointChange(idx, e.target.value)}
                      placeholder="Город заезда…"
                      className="flex-1 min-w-0 bg-transparent border-none px-1 py-1 text-xs font-medium text-[#121316] outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRemoveWaypoint(idx)}
                      aria-label={`Удалить заезд ${idx + 1}`}
                      className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 transition-colors cursor-pointer shrink-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={UI.fieldLabel}>Куда</span>
            <input
              type="text"
              value={localDestination}
              onChange={(e) => handleDestinationChange(e.target.value)}
              placeholder="Город назначения…"
              className={UI.input}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className={UI.fieldLabel}>Итоговый пробег, км</span>
            <input
              type="number"
              value={manualDistanceKm}
              onChange={(e) => handleMileageChange(e.target.value)}
              placeholder="0"
              className={`${UI.input} font-semibold`}
            />
          </div>

          {setSaveToDirectoryChecked && (
            <label className="flex items-center gap-2.5 cursor-pointer select-none border border-[#E5E7EB] rounded-xl px-3 py-2.5 bg-white hover:bg-[#F9FAFB] transition-colors">
              <input
                type="checkbox"
                checked={saveToDirectoryChecked}
                onChange={(e) => setSaveToDirectoryChecked(e.target.checked)}
                className={UI.checkbox}
              />
              <span className="text-xs font-medium text-[#4B5563] leading-tight">
                Сохранить в справочник расстояний
              </span>
            </label>
          )}
        </div>

        {/* Карта маршрута */}
        <div className="flex flex-col gap-2 min-w-0">
          {!hasRoute ? (
            <div className="min-h-[240px] flex flex-col items-center justify-center p-6 text-center bg-[#F8F9FA] border border-[#E5E7EB] rounded-2xl">
              <MapPin className="w-6 h-6 text-[#9CA3AF] mb-2" />
              <p className="text-xs font-semibold text-[#4B5563]">Карта готова к построению</p>
              <p className="text-[11px] text-[#6B7280] mt-1 max-w-xs leading-relaxed">
                Укажите пункт отправления и пункт назначения — появится интерактивная карта маршрута.
              </p>
            </div>
          ) : (
            <>
              <div className="h-[280px] sm:h-[340px] rounded-2xl overflow-hidden border border-[#E5E7EB] bg-[#F3F4F6]">
                <iframe
                  title="Интерактивная карта маршрута"
                  src={embedUrl}
                  className="w-full h-full border-none"
                  allowFullScreen
                />
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] text-[#6B7280]">
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-ui)]" aria-hidden="true" />
                  Яндекс Карты
                </span>
                <a
                  href={yandexExternalUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-medium text-[var(--accent-ink)] hover:underline"
                >
                  Открыть в Яндекс Картах <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalShell>
  );
}

/** Тонкий бейдж карточки журнала — форма UI.chip, но кегль 11px (по правилам портала). */
const CALC_BADGE =
  "inline-flex items-center gap-1.5 text-[11px] font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md whitespace-nowrap";

/** Иконочная кнопка действий карточки журнала: тап-таргет не меньше 44px. */
const CALC_ACTION =
  "min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]";

/** Та же кнопка, но для удаления — розовое наведение. */
const CALC_ACTION_DANGER =
  "min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-200";

const CalculationCard = React.memo(({
  calc,
  user,
  copyHistoryToForm,
  openEditCalcModal,
  onPrint,
  isSelected,
  onToggleSelect,
}: {
  calc: RouteCalculation;
  user: UserProfile;
  copyHistoryToForm: (calc: RouteCalculation) => void;
  openEditCalcModal: (calc: RouteCalculation) => void;
  onPrint: (calc: RouteCalculation) => void;
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
  const routeTitle = routePoints.join(" → ");

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
  const freightValue = calc.freight || calc.totalFreight || 0;
  const expensesValue = calc.expenses || calc.totalExpenses || 0;

  return (
    <div
      data-calc-id={calc.id}
      className={`p-4 sm:p-5 bg-white border rounded-2xl shadow-xs transition-colors flex flex-col ${
        isSelected
          ? "ring-2 ring-[var(--accent-ui)]/25 border-[var(--accent-ui)]"
          : "border-[#E5E7EB] hover:bg-[#F9FAFB] hover:border-[#D1D5DB]"
      }`}
    >
      {/* Строка 1–2: выбор, маршрут с датой, направление и логист */}
      <div className="flex items-start gap-2">
        {onToggleSelect && (
          <button
            type="button"
            onClick={() => onToggleSelect(calc.id)}
            aria-pressed={isSelected}
            aria-label={isSelected ? "Снять выделение" : "Выбрать для печати"}
            title={isSelected ? "Снять выделение" : "Выбрать для печати"}
            className="-ml-1 -mt-3 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-xl shrink-0 cursor-pointer transition-colors"
          >
            <span
              className={`w-5 h-5 rounded-md border-2 flex items-center justify-center transition-colors duration-150 ${
                isSelected
                  ? "bg-[#121316] border-[#121316] text-white"
                  : "border-[#D1D5DB] hover:border-[#9CA3AF] bg-white"
              }`}
            >
              {isSelected && <Check className="w-3.5 h-3.5" strokeWidth={1.5} />}
            </span>
          </button>
        )}
        <div className="flex-1 min-w-0 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 min-w-0">
            <span className="text-sm font-semibold text-[#121316] leading-snug break-words min-w-0">
              {routeTitle || "Без названия"}
            </span>
            <span
              className="text-[11px] sm:text-xs font-mono tabular-nums text-[#6B7280] shrink-0"
              title={calc.datetime || undefined}
            >
              {formatDateSlash(calc.datetime) || "Без даты"}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={CALC_BADGE} title="Направление">
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-ui)] shrink-0" aria-hidden="true" />
              <span
                className="truncate max-w-[180px]"
                title={calc.globalDirection || calc.direction || "Не указано"}
              >
                {calc.globalDirection || calc.direction || "Не указано"}
              </span>
            </span>
            <span className={CALC_BADGE} title="Логист / кто внёс">
              <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] shrink-0" aria-hidden="true" />
              <span
                className="truncate max-w-[180px]"
                title={calc.username || calc.logist || "Система"}
              >
                {calc.username || calc.logist || "Система"}
              </span>
            </span>
            {calc.additionalExpenses ? (
              <>
                <span className={CALC_BADGE} title="Дополнительные расходы">
                  <span className="text-[#6B7280]">Доп. расходы:</span>
                  <span className="font-mono tabular-nums font-semibold text-[#121316]">
                    {calc.additionalExpenses} €
                  </span>
                </span>
                {Array.isArray(calc.expenseItems) && calc.expenseItems.length > 0 && (
                  <span
                    className="text-[11px] text-[#9CA3AF] truncate max-w-[220px]"
                    title={calc.expenseItems.map((e) => e.label || "—").join(", ")}
                  >
                    ({calc.expenseItems.map((e) => e.label || "—").join(", ")})
                  </span>
                )}
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Строка 3: финансовые показатели; чистый доход — главный, убыток — rose с пометкой */}
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
        {[
          {
            label: "Чистый доход",
            value: `${Math.round(profitValue).toLocaleString("ru-RU")} €`,
            main: true,
            accent: profitValue >= 0,
            loss: profitValue < 0,
          },
          {
            label: "Фрахт",
            value: `${Math.round(freightValue).toLocaleString("ru-RU")} €`,
            main: false,
            accent: false,
            loss: false,
          },
          {
            label: "Расходы",
            value: `${Math.round(expensesValue).toLocaleString("ru-RU")} €`,
            main: false,
            accent: false,
            loss: false,
          },
          {
            label: "Доход в сутки",
            value: `${Math.round(dailyProfitValue).toLocaleString("ru-RU")} €/сут`,
            main: false,
            accent: dailyProfitValue >= 0,
            loss: dailyProfitValue < 0,
          },
          {
            label: "Дней в пути",
            value: `${daysValue} дн`,
            main: false,
            accent: false,
            loss: false,
          },
          {
            label: "Пробег",
            value: `${Math.round(totalKmValue).toLocaleString("ru-RU")} км`,
            main: false,
            accent: false,
            loss: false,
          },
        ].map((m) => (
          <div
            key={m.label}
            className={`min-w-0 rounded-xl border px-3 py-2 flex flex-col gap-0.5 ${
              m.loss ? "border-rose-200 bg-rose-50/60" : "border-[#E5E7EB]"
            }`}
          >
            <span className="flex items-center justify-between gap-1.5">
              <span className="text-[11px] text-[#6B7280] truncate">{m.label}</span>
              {m.loss && m.main && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 shrink-0">
                  <AlertTriangle className="w-3 h-3" strokeWidth={1.5} />
                  Убыток
                </span>
              )}
            </span>
            <span
              className={`font-mono tabular-nums font-semibold tracking-tight whitespace-nowrap ${
                m.main ? "text-lg" : "text-sm"
              } ${m.loss ? "text-rose-600" : m.accent ? "text-[var(--accent-ink)]" : "text-[#121316]"}`}
            >
              {m.value}
            </span>
          </div>
        ))}
      </div>

      {/* Строка 4: плечи — компактные строки, данные видны без клика */}
      <div className="mt-3">
        <span className="text-[11px] font-medium text-[#9CA3AF] block mb-1.5">Детализация по плечам</span>
        <div className="flex flex-col gap-1">
          {calc.legs.map((l, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-x-2.5 gap-y-1 rounded-lg border border-[#E5E7EB] px-2.5 py-1.5"
            >
              <span className="flex items-center gap-2 min-w-0">
                <span className="w-5 h-5 shrink-0 rounded-md border border-[#E5E7EB] bg-white text-[11px] font-medium text-[#6B7280] font-mono flex items-center justify-center select-none">
                  {i + 1}
                </span>
                <span
                  className="text-xs font-medium text-[#121316] truncate max-w-[200px] sm:max-w-[320px]"
                  title={`${l.from || "?"} → ${l.to || "?"}`}
                >
                  {l.from || "?"} &rarr; {l.to || "?"}
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 ml-auto text-[11px] font-mono tabular-nums text-[#6B7280]">
                <span>{Math.round(l.dist || l.distance || 0).toLocaleString("ru-RU")} км</span>
                {Number(l.coeff || 0) > 0 && <span>Коэф: {l.coeff}</span>}
                {Number(l.freight || 0) > 0 && (
                  <span className="text-[#121316] font-semibold">
                    {Math.round(l.freight).toLocaleString("ru-RU")} €
                  </span>
                )}
                {Number(l.infoRate || 0) > 0 && (
                  <span className="text-[var(--accent-ink)]">
                    {Math.round(l.infoRate || 0).toLocaleString("ru-RU")} {l.infoCurrency || "USD"}
                  </span>
                )}
                {Number(l.ferryCost || 0) > 0 && (
                  <span>
                    Паром:{" "}
                    <span className="text-[#121316] font-semibold">
                      {Math.round(l.ferryCost).toLocaleString("ru-RU")} €
                    </span>
                  </span>
                )}
                {Number(l.additionalExpenses || l.otherExpenses || 0) > 0 && (
                  <span>
                    Доп:{" "}
                    <span className="text-[#121316] font-semibold">
                      {Math.round(l.additionalExpenses || l.otherExpenses || 0).toLocaleString("ru-RU")} €
                    </span>
                  </span>
                )}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Строка 5: действия */}
      <div className="mt-3 pt-3 border-t border-[#E5E7EB] flex flex-wrap items-center justify-end gap-1.5">
        <button
          type="button"
          title="Печать"
          aria-label="Печать расчёта"
          onClick={() => onPrint(calc)}
          className={CALC_ACTION}
        >
          <Printer className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title="Дублировать в форму"
          aria-label="Копировать расчёт в форму"
          onClick={() => copyHistoryToForm(calc)}
          className={CALC_ACTION}
        >
          <Copy className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          title="Изменить"
          aria-label="Изменить расчёт"
          onClick={() => openEditCalcModal(calc)}
          className={CALC_ACTION}
        >
          <Edit className="h-4 w-4" strokeWidth={1.5} />
        </button>
        {user.role === "root_admin" && (
          <button
            type="button"
            title="Удалить расчёт"
            aria-label="Удалить расчёт"
            onClick={() =>
              dbService.deleteRouteCalculation(
                calc.id,
                user.name,
                user.role,
              )
            }
            className={CALC_ACTION_DANGER}
          >
            <Trash2 className="h-4 w-4" strokeWidth={1.5} />
          </button>
        )}
      </div>
    </div>
  );
});

export default function DohodModule({ user }: DohodModuleProps) {
  const { showConfirm, showPrompt } = useDialog();
  const { toast } = useToast();
  
  const [calculationHistory, setCalculationHistory] = useState<
    RouteCalculation[]
  >([]);
  // Журнал: пока не пришёл первый снимок из базы — показываем загрузку.
  const [historyReady, setHistoryReady] = useState(false);
  const [routeTemplates, setRouteTemplates] = useState<RouteTemplate[]>([]);
  const [ferries, setFerries] = useState<FerryTemplate[]>([]);
  const [distances, setDistances] = useState<DistancePreset[]>([]);
  // Готовность справочника расстояний: пока первый снимок не пришёл — в блоке «Маршрут» крутится спиннер загрузки.
  const [routesReady, setRoutesReady] = useState(false);
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

  // Состояния конвертера НБ РБ: загрузка, ошибка и дата обновления курса.
  const [nbrbLoading, setNbrbLoading] = useState(true);
  const [nbrbError, setNbrbError] = useState<string | null>(null);
  const [nbrbDate, setNbrbDate] = useState<string | null>(null);
  // Какие поля конвертера заполнены — для кнопки очистки, как в топ-баре.
  const [convHasValue, setConvHasValue] = useState<Record<string, boolean>>(() =>
    CONVERTER_CURRENCIES.reduce<Record<string, boolean>>((acc, code) => {
      acc[code] = true;
      return acc;
    }, {}),
  );

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

  // Шаблоны: тот же фильтр по подстроке, что и раньше (теперь используется и для пустого состояния).
  const filteredTemplates = useMemo(() => {
    return routeTemplates.filter((t) =>
      t.name.toLowerCase().includes(routeSearch.toLowerCase()),
    );
  }, [routeTemplates, routeSearch]);

  const visibleHistory = useMemo(() => {
    return filteredHistory.slice(0, historyPage);
  }, [filteredHistory, historyPage]);

  // Курсы НБ РБ: адрес, разбор и запасные значения — прежние; добавлены только
  // статусы интерфейса (загрузка/ошибка) и дата курса.
  const fetchNbrbRates = () => {
    setNbrbLoading(true);
    setNbrbError(null);
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
          const apiDate = data
            .map((item) => item && (item.Cur_Date || item.Date))
            .find((d) => typeof d === "string" && d.length > 0);
          if (apiDate) setNbrbDate(apiDate);
        }
        setNbrbRates(updated);
        setNbrbLoading(false);
      })
      .catch((err) => {
        console.warn("Failed to fetch NBRB rates:", err);
        setNbrbError(
          "Не удалось загрузить курсы НБ РБ. Показаны последние известные значения.",
        );
        setNbrbLoading(false);
      });
  };

  // Очистка всех сумм конвертера — то же, что оставить поле пустым.
  const clearConverterField = () => {
    CONVERTER_CURRENCIES.forEach((code) => {
      const el = document.getElementById(`conv-multi-${code}`) as HTMLInputElement | null;
      if (el) el.value = "";
    });
    setConvHasValue(() =>
      CONVERTER_CURRENCIES.reduce<Record<string, boolean>>((acc, code) => {
        acc[code] = false;
        return acc;
      }, {}),
    );
  };

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

    const subHistory = dbService.getRouteCalculations((list) => {
      setCalculationHistory(list);
      setHistoryReady(true);
    }, 100);
    const subRouteTpl = dbService.getRouteTemplates(setRouteTemplates);
    const subFerries = dbService.getFerryTemplates(setFerries);
    const subDistances = dbService.getDistances((list) => {
      setDistances(list);
      setRoutesReady(true);
    });
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

    // Курсы НБ РБ: тот же запрос, что и раньше; добавлены состояния загрузки/ошибки
    // и дата обновления для интерфейса.
    fetchNbrbRates();

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
        : `Сохранить новое плечо ${from} - ${to} (${newDist} км) в общую базу шаблонов расстояний?\n\nВносите расстояния, которые вы считаете/знаете сами (карты, опыт), а не только из путевых листов водителей. Это общая база для всех.`;

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

  // --- Презентация результата (те же формулы, что и в итогах; новых вычислений нет) ---
  // Плечо считается заполненным, если есть хотя бы один пользовательский ввод.
  const isLegFilled = (l: Omit<Leg, "id">) =>
    Boolean(
      l.from ||
        l.to ||
        Number(l.totalDistanceKm || l.dist || l.distance || 0) ||
        Number(l.freight || 0) ||
        Number(l.emptyRun || 0) ||
        Number(l.ferryCost || 0) ||
        Number(l.additionalExpenses || 0),
    );
  const isCalcEmpty =
    !legs.some(isLegFilled) && !Number(additionalExpenses || 0) && expenseItems.length === 0;

  // Разбивка по плечам: расход плеча = (пробег + доезд) × коэф. + паром + доп. расходы плеча.
  const legBreakdown = legs.map((l, i) => {
    const legKm = Number(l.totalDistanceKm || l.dist || l.distance || 0);
    const legTotalKm = legKm + Number(l.emptyRun || 0);
    const legExpense =
      legTotalKm * Number(l.coeff || 0) +
      Number(l.ferryCost || 0) +
      Number(l.additionalExpenses || 0);
    const legFreight = Number(l.freight || 0);
    return {
      index: i,
      from: l.from,
      to: l.to,
      km: legKm,
      emptyRun: Number(l.emptyRun || 0),
      totalKm: legTotalKm,
      freight: legFreight,
      expense: legExpense,
      margin: legFreight - legExpense,
      filled: isLegFilled(l),
      routeError: (l as { routeError?: string | null }).routeError || null,
      manualOverride: Boolean(l.manualOverride),
    };
  });

  // Статьи расходов (суммы по тем же слагаемым, что складываются в totalExpenses).
  const expenseByDistance = legs.reduce(
    (acc, l) =>
      acc +
      (Number(l.totalDistanceKm || l.dist || l.distance || 0) + Number(l.emptyRun || 0)) *
        Number(l.coeff || 0),
    0,
  );
  const expenseByLegAdditional = legs.reduce(
    (acc, l) => acc + Number(l.additionalExpenses || 0),
    0,
  );

  const saveCalculation = () => {
    if (legs.some((l) => !l.from && !l.to && !l.dist && !l.freight)) {
      toast("Расчёт пуст — сначала заполните маршрут и ставку хотя бы одного плеча", 'info');
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
    toast("Расчёт сохранён в журнал", 'success');
  };

  const saveCurrentAsTemplate = async () => {
    // Название шаблона спрашиваем диалогом портала, а не системным prompt.
    const name = await showPrompt(
      "Введите название для нового шаблона мульти-рейса:",
      "",
      "Новый шаблон мульти-рейса",
      { confirmLabel: "Шаблонизировать" },
    );
    if (!name || !name.trim()) return;
    const validLegs = legs.filter((l) => l.from || l.to || l.dist || l.freight);
    if (validLegs.length === 0) {
      toast("Калькулятор пуст — сначала заполните хотя бы одно плечо", 'info');
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

  // Удаление шаблона — через подтверждение портала (действие необратимое).
  const confirmDeleteTemplate = async (tpl: RouteTemplate) => {
    const ok = await showConfirm(
      `Удалить шаблон «${tpl.name}»? Действие нельзя отменить.`,
      "Удаление шаблона",
      { variant: "danger", confirmLabel: "Удалить" },
    );
    if (ok && tpl.id) {
      dbService.deleteRouteTemplate(tpl.id, user.name, user.role);
    }
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

  const printCalculations = (selected: RouteCalculation[]) => {
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

  // Печать группы выбранных расчётов (пакетная печать из журнала).
  const printSelectedCalculations = () => {
    if (selectedCalcIds.size === 0) return;
    const selected = calculationHistory.filter((c) => selectedCalcIds.has(c.id));
    printCalculations(selected);
  };

  // Печать одного расчёта — кнопкой «Печать» в карточке журнала.
  const printSingleCalculation = (calc: RouteCalculation) => {
    printCalculations([calc]);
  };

  const buildPrintHtml = (selected: RouteCalculation[]): string => {
    // Подложка блока «Дополнительные расходы» в печатной сводке — тинт текущего акцента темы.
    const [accentR, accentG, accentB] = hexToRgb(currentAccentColor('base'));
    const accentTintBg = `rgba(${accentR}, ${accentG}, ${accentB}, 0.12)`;
    const accentTintBorder = `rgba(${accentR}, ${accentG}, ${accentB}, 0.35)`;
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
      background: ${accentTintBg};
      border: 1px solid ${accentTintBorder};
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

  // Клавиатура окна правки: Escape закрывает, Enter сохраняет,
  // фокус ставится на первое поле и возвращается при закрытии.
  useModalKeyboard({
    isOpen: !!editingCalcId,
    onClose: closeEditCalcModal,
    onConfirm: saveEditCalcModal,
  });

  return (
    <div className="w-full flex flex-col font-sans">
      
      

      {/* Рабочая область: шаги расчёта — секции прямо на холсте */}
      <div className="w-full flex flex-col">
        {/* Шапка модуля: заголовок и краткая подпись, как в «Учёте дозволов» */}
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#121316]">
            Калькуляция дохода
          </h1>
          <p className="text-xs text-[#6B7280] max-w-3xl">
            Порядок работы: маршрут и ставки → сроки и расходы → результат. Блоки заполняются сверху вниз.
          </p>
        </div>


        {/* Шаг 1. Маршрут и ставки — секция на холсте, отделена тонкой линией */}
        <section className="mt-4 pt-4 border-t border-[#E5E7EB] flex flex-col gap-4">
          <SectionHeader
            icon={<MapPin className="w-4 h-4" />}
            tone="graphite"
            title="Маршрут и ставки"
            subtitle="Шаг 1: направление, плечи, пробег, фрахт и расходы по плечам"
          >
            <select
              value={globalDirection}
              onChange={handleGlobalDirectionChange}
              className={`${UI.select} w-full sm:w-48`}
              aria-label="Направление"
            >
              {directions.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </SectionHeader>

          {/* Загрузка маршрутных данных: справочник расстояний ещё не пришёл */}
          {!routesReady && (
            <div className="flex items-center justify-center gap-2 py-3 text-xs text-[#6B7280]">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Загружаем справочник расстояний…
            </div>
          )}

          <div className="hidden lg:block w-full pb-4 custom-scrollbar overflow-x-auto">
            <table className="w-full border-collapse relative">
              <thead className="sticky top-0 z-20">
                <tr className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                  <th className="px-3 pt-3 pb-1 w-10" aria-hidden="true"></th>
                  <th colSpan={4} className="px-3 pt-3 pb-1 text-left font-semibold border-l border-[#E5E7EB]">
                    Маршрут
                  </th>
                  <th colSpan={3} className="px-3 pt-3 pb-1 text-left font-semibold border-l border-[#E5E7EB]">
                    Груз и ставка
                  </th>
                  <th colSpan={3} className="px-3 pt-3 pb-1 text-left font-semibold border-l border-[#E5E7EB]">
                    Расходы плеча
                  </th>
                  <th className="px-3 pt-3 pb-1 w-24" aria-hidden="true"></th>
                </tr>
                <tr className="border-b border-[#E5E7EB] text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                  <th className="px-3 pb-2.5 text-left font-semibold w-10">#</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-44 border-l border-[#E5E7EB]">Откуда</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-40">Куда</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-24">Доезд, км</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-32">Пробег, км</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-24 border-l border-[#E5E7EB]">Ставка, €</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-24">Инфо ставка</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-24">Валюта</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-52 border-l border-[#E5E7EB]">Паром</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-24">Доп. расх., €</th>
                  <th className="px-3 pb-2.5 text-left font-semibold w-20">Коэф.</th>
                  <th className="px-3 pb-2.5 text-right font-semibold w-24">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F3F4F6]">
                {legs.map((leg, idx) => (
                  <tr
                    key={idx}
                    className="hover:bg-[#F9FAFB] transition-colors align-top"
                  >
                    <td className="px-3 py-2 text-xs font-semibold text-[#9CA3AF]">
                      {idx + 1}
                    </td>
                    <td className="px-3 py-2 border-l border-[#F3F4F6]">
                      <CityAutocomplete
                        value={leg.from}
                        onChange={(v) => updateLeg(idx, { from: v })}
                        onBlur={() => handleCityBlur(idx)}
                        cities={citiesList}
                        placeholder="Откуда"
                        className={UI.inputSm}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <CityAutocomplete
                        value={leg.to}
                        onChange={(v) => updateLeg(idx, { to: v })}
                        onBlur={() => handleCityBlur(idx)}
                        cities={citiesList}
                        placeholder="Куда"
                        className={UI.inputSm}
                      />
                    </td>
                    <td className="px-3 py-2">
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
                        title="Доезд до пункта погрузки, км"
                        className={UI.inputSm}
                      />
                    </td>
                    <td className="px-3 py-2">
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
                            title={leg.manualOverride ? "Введён вручную" : "Расчёт по справочнику расстояний"}
                            className={`${UI.inputSm} pl-2 pr-8 font-bold ${
                              leg.manualOverride
                                ? "border-amber-300 text-amber-950 bg-amber-50/40 focus:border-amber-500"
                                : ""
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
                              className="text-[#9CA3AF] hover:text-[var(--accent-ui)] hover:bg-[#F3F4F6] p-1 rounded-md transition cursor-pointer"
                            >
                              <Map className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      </div>
                      {legBreakdown[idx]?.routeError ? (
                        <div className="mt-1 flex items-start gap-1 text-[10px] leading-tight text-rose-600">
                          <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                          <span>Не удалось построить маршрут — проверьте пункты</span>
                        </div>
                      ) : !leg.manualOverride &&
                        !Number(leg.totalDistanceKm || leg.dist || leg.distance || 0) &&
                        (leg.from || leg.to) ? (
                        <div className="mt-1 text-[10px] leading-tight text-amber-600">
                          Пробег не построен — введите вручную или через «Маршрут»
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={leg.freight || ""}
                        onChange={(e) =>
                          updateLeg(idx, { freight: Number(e.target.value) })
                        }
                        title="Ставка за плечо, €"
                        className={UI.inputSm}
                      />
                    </td>
                    <td className="px-3 py-2 relative group">
                      <input
                        type="number"
                        value={leg.infoRate || ""}
                        onChange={(e) =>
                          updateLeg(idx, { infoRate: Number(e.target.value) })
                        }
                        onBlur={() => handleInfoRateBlur(idx)}
                        placeholder="0"
                        className={`${UI.inputSm} pr-8`}
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[var(--accent-ui)] transition p-1 cursor-pointer"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={leg.infoCurrency}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateLeg(idx, { infoCurrency: val });
                          handleCurrencyChange(idx, val);
                        }}
                        aria-label="Валюта инфо-ставки"
                        className={`${UI.inputSm} pl-2 pr-1 leading-tight`}
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="RUB">RUB</option>
                        <option value="BYN">BYN</option>
                      </select>
                    </td>
                    <td className="px-3 py-2 border-l border-[#F3F4F6]">
                      <div className="flex flex-col gap-1 w-full min-w-[140px]">
                        <select
                          value={leg.ferrySelectValue || "none"}
                          onChange={(e) =>
                            updateLeg(idx, { ferrySelectValue: e.target.value })
                          }
                          aria-label="Паром"
                          className={`${UI.inputSm} px-2`}
                        >
                          <option value="none">Без парома</option>
                          {ferries.map((f, i) => (
                            <option key={f.id} value={i}>
                              {f.from} → {f.to} ({f.eur || f.price}€)
                            </option>
                          ))}
                          <option value="custom">Ввести вручную</option>
                        </select>
                        {leg.ferrySelectValue === "custom" && (
                          <input
                            type="number"
                            value={leg.ferryCost || ""}
                            placeholder="Цена €"
                            title="Стоимость парома, €"
                            onChange={(e) =>
                              updateLeg(idx, {
                                ferryCost: Number(e.target.value),
                              })
                            }
                            className="w-full px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-xl text-[10px] font-semibold text-[#121316] outline-none focus:border-[var(--accent)] transition"
                          />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        value={leg.additionalExpenses || ""}
                        placeholder="0"
                        title="Дополнительные расходы плеча, €"
                        onChange={(e) =>
                          updateLeg(idx, {
                            additionalExpenses: e.target.value === "" ? undefined : Number(e.target.value),
                          })
                        }
                        className={UI.inputSm}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        step="0.01"
                        value={
                          leg.coeff === undefined ? getDirCoeff() : leg.coeff
                        }
                        title="Коэффициент расхода на км"
                        onChange={(e) =>
                          updateLeg(idx, { coeff: Number(e.target.value) })
                        }
                        className={`${UI.inputSm} px-1 text-center`}
                      />
                    </td>
                    <td className="px-3 py-2 text-right space-x-1.5 whitespace-nowrap">
                      <button
                        onClick={() => addLegRowAfter(idx)}
                        title="Добавить плечо ниже"
                        className="w-9 h-9 inline-flex items-center justify-center rounded-xl bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] transition-colors cursor-pointer min-h-[44px] min-w-[44px]"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeLeg(idx)}
                        disabled={legs.length <= 1}
                        title="Удалить плечо"
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 transition-colors disabled:opacity-30 cursor-pointer"
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
              <div key={idx} className="bg-white rounded-2xl p-4 border border-[#E5E7EB] flex flex-col gap-4 relative">
                <div className="flex justify-between items-center pb-2 border-b border-[#E5E7EB]">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#4B5563] bg-[#F3F4F6] px-2 py-1 rounded-lg border border-[#E5E7EB]">#{idx + 1}</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => addLegRowAfter(idx)}
                      className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] transition-colors cursor-pointer"
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
                
                <span className={UI.caption}>Маршрут</span>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Откуда</span>
                    <CityAutocomplete
                      value={leg.from}
                      onChange={(v) => updateLeg(idx, { from: v })}
                      onBlur={() => handleCityBlur(idx)}
                      cities={citiesList}
                      placeholder="Откуда"
                      className={UI.input}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Куда</span>
                    <CityAutocomplete
                      value={leg.to}
                      onChange={(v) => updateLeg(idx, { to: v })}
                      onBlur={() => handleCityBlur(idx)}
                      cities={citiesList}
                      placeholder="Куда"
                      className={UI.input}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Доезд (км)</span>
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
                      className={UI.input}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Пробег (км)</span>
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
                        title={leg.manualOverride ? "Введён вручную" : "Расчёт по справочнику расстояний"}
                        className={`${UI.input} pl-3 pr-12 font-bold ${
                          leg.manualOverride
                            ? "border-amber-300 text-amber-950 bg-amber-50/40 focus:border-amber-500"
                            : ""
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
                          className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center text-[#9CA3AF] hover:text-[var(--accent-ui)] hover:bg-[#F3F4F6] rounded-lg transition-colors cursor-pointer"
                        >
                          <Map className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {legBreakdown[idx]?.routeError ? (
                      <div className="flex items-start gap-1 text-[10px] leading-tight text-rose-600">
                        <AlertTriangle className="w-3 h-3 mt-px shrink-0" />
                        <span>Не удалось построить маршрут — проверьте пункты</span>
                      </div>
                    ) : !leg.manualOverride &&
                      !Number(leg.totalDistanceKm || leg.dist || leg.distance || 0) &&
                      (leg.from || leg.to) ? (
                      <div className="text-[10px] leading-tight text-amber-600">
                        Пробег не построен — введите вручную или через «Маршрут»
                      </div>
                    ) : null}
                  </div>
                </div>

                <span className={UI.caption}>Груз и ставка</span>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Ставка, €</span>
                    <input
                      type="number"
                      value={leg.freight || ""}
                      onChange={(e) => updateLeg(idx, { freight: Number(e.target.value) })}
                      className={UI.input}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Инфо ставка</span>
                    <div className="flex flex-col gap-2">
                      <div className="relative">
                        <input
                          type="number"
                          value={leg.infoRate || ""}
                          onChange={(e) => updateLeg(idx, { infoRate: Number(e.target.value) })}
                          onBlur={() => handleInfoRateBlur(idx)}
                          placeholder="0"
                          className={`${UI.input} pr-9`}
                        />
                        {leg.infoRate > 0 && leg.infoCurrency !== "EUR" && (
                          <button
                            type="button"
                            onClick={() => triggerConversionCheck(idx, leg.infoRate, leg.infoCurrency)}
                            title="Конвертировать по курсу НБРБ"
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-[#9CA3AF] hover:text-[var(--accent-ui)] transition p-1 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                      <select
                        value={leg.infoCurrency}
                        onChange={(e) => {
                          const val = e.target.value;
                          updateLeg(idx, { infoCurrency: val });
                          handleCurrencyChange(idx, val);
                        }}
                        aria-label="Валюта инфо-ставки"
                        className={UI.input}
                      >
                        <option value="USD">USD</option>
                        <option value="EUR">EUR</option>
                        <option value="RUB">RUB</option>
                        <option value="BYN">BYN</option>
                      </select>
                    </div>
                  </div>
                </div>

                <span className={UI.caption}>Расходы плеча</span>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Паром</span>
                    <div className="flex flex-col gap-1">
                      <select
                        value={leg.ferrySelectValue || "none"}
                        onChange={(e) => updateLeg(idx, { ferrySelectValue: e.target.value })}
                        aria-label="Паром"
                        className={UI.input}
                      >
                        <option value="none">Без парома</option>
                        {ferries.map((f, i) => (
                          <option key={f.id} value={i}>{f.from} → {f.to}</option>
                        ))}
                        <option value="custom">Вручную</option>
                      </select>
                      {leg.ferrySelectValue === "custom" && (
                        <input
                          type="number"
                          value={leg.ferryCost || ""}
                          placeholder="Цена €"
                          onChange={(e) => updateLeg(idx, { ferryCost: Number(e.target.value) })}
                          className={UI.input}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <span className={UI.fieldLabel}>Доп. расх., € / Коэф.</span>
                    <div className="flex flex-col gap-2">
                      <input
                        type="number"
                        value={leg.additionalExpenses || ""}
                        placeholder="Доп €"
                        onChange={(e) => updateLeg(idx, { additionalExpenses: e.target.value === "" ? undefined : Number(e.target.value) })}
                        className={UI.input}
                      />
                      <input
                        type="number"
                        step="0.01"
                        value={leg.coeff === undefined ? getDirCoeff() : leg.coeff}
                        title="Коэффициент расхода на км"
                        onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                        className={`${UI.input} text-center`}
                      />
                    </div>
                  </div>
                </div>

              </div>
            ))}
          </div>


          {/* Действия с расчётом: сброс, шаблон, сохранение в журнал */}
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2 pt-4 border-t border-[#E5E7EB]">
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
              className={`${UI.buttonGhost} w-full sm:w-auto`}
            >
              Сбросить
            </button>
            <button
              onClick={saveCurrentAsTemplate}
              className={`${UI.buttonGhost} w-full sm:w-auto`}
            >
              <Save className="h-3.5 w-3.5" /> Шаблонизировать
            </button>
            {true && (
              <button
                onClick={saveCalculation}
                className={`${UI.buttonPrimary} w-full sm:w-auto`}
              >
                <Save className="h-4 w-4" /> Сохранить расчёт
              </button>
            )}
          </div>
        </section>

        {/* Шаг 2. Сроки и расходы — секция на холсте */}
        <section className="mt-5 pt-5 border-t border-[#E5E7EB] flex flex-col gap-5">
          <SectionHeader
            icon={<Clock className="w-4 h-4" />}
            tone="graphite"
            title="Сроки рейса"
            subtitle="Шаг 2: даты и количество дней в пути"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="flex flex-col gap-1.5">
              <span className={UI.fieldLabel}>Старт рейса</span>
              <input
                type="date"
                value={tripStartDate}
                onChange={(e) => setTripStartDate(e.target.value)}
                className={`${UI.input} cursor-pointer`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={UI.fieldLabel}>Завершение</span>
              <input
                type="date"
                value={tripEndDate}
                onChange={(e) => setTripEndDate(e.target.value)}
                className={`${UI.input} cursor-pointer`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className={UI.fieldLabel}>Итого дней в рейсе</span>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  value={tripDays}
                  onChange={(e) => setTripDays(Number(e.target.value))}
                  className={`${UI.input} w-24 text-center font-semibold`}
                />
                <span className="text-xs font-medium text-[#6B7280]">дней</span>
              </div>
              <span className={UI.hint}>Влияет на суточную доходность рейса</span>
            </div>
          </div>

          <div className={UI.divider} />

          <SectionHeader
            icon={<Receipt className="w-4 h-4" />}
            tone="accent"
            title="Дополнительные расходы"
            subtitle="Разовые затраты по рейсу и статьи расходов"
          />
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border border-[#E5E7EB] rounded-xl px-3.5 py-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-[var(--accent-10)] flex items-center justify-center text-[var(--accent-ink)] shrink-0">
                  <Receipt className="w-4 h-4" />
                </div>
                <div className="flex flex-col gap-0.5 min-w-0">
                  <span className={UI.fieldLabel}>Прочие затраты по рейсу</span>
                  <span className="text-xs leading-relaxed text-[#6B7280]">
                    Общая сумма, если статьи ещё не расписаны. Для подробной расшифровки добавьте статьи ниже — название и сумму.
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 self-start sm:self-auto">
                <input
                  type="number"
                  min="0"
                  value={additionalExpenses}
                  onChange={(e) => setAdditionalExpenses(Number(e.target.value))}
                  style={{ width: 96, minWidth: 96 }}
                  className={`${UI.input} text-right font-semibold text-[var(--accent-ink)]`}
                />
                <span className="text-xs font-semibold text-[#6B7280]">€</span>
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
                      className={`${UI.input} flex-1`}
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
                      style={{ width: 96, minWidth: 96 }}
                      className={`${UI.input} text-right font-semibold text-[var(--accent-ink)]`}
                    />
                    <span className="text-xs font-semibold text-[#6B7280]">€</span>
                    <button
                      type="button"
                      onClick={() => {
                        const next = expenseItems.filter((_, i) => i !== idx);
                        setExpenseItems(next);
                        setAdditionalExpenses(next.reduce((a, x) => a + Number(x.amount || 0), 0));
                      }}
                      className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-lg bg-white border border-[#E5E7EB] hover:bg-rose-50 hover:border-rose-200 text-rose-600 transition-colors cursor-pointer"
                      title="Удалить статью"
                    >
                      <Trash2 className="w-4 h-4" />
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
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-[#E5E7EB] text-[#6B7280] text-xs font-medium hover:bg-[#F3F4F6] hover:text-[#121316] hover:border-[#D1D5DB] transition min-h-[44px]"
            >
              <Plus className="w-3.5 h-3.5" />
              Добавить статью расхода
            </button>
          </div>
        </section>

        {/* Шаг 3. Результат расчёта — секция на холсте */}
        <section className="mt-5 pt-5 border-t border-[#E5E7EB] flex flex-col gap-5">
          <SectionHeader
            icon={<TrendingUp className="w-4 h-4" />}
            tone="graphite"
            title="Результат расчёта"
            subtitle="Шаг 3: итоги рейса, разбивка по плечам и статьям расходов"
          />

          {isCalcEmpty ? (
            <div className={UI.empty}>
              <Calculator className="w-6 h-6 mx-auto mb-2 text-[#D1D5DB]" />
              <p className={UI.emptyTitle}>Расчёт пуст</p>
              <p className={UI.emptyText}>
                Заполните маршрут и ставку в блоке «Маршрут и ставки» — итоги появятся здесь автоматически.
              </p>
            </div>
          ) : (
            <>
              {/* Итог: главное число — как сводная сумма у дозволов, без плашки */}
              <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
                <div>
                  <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none block mb-1">
                    Чистая прибыль
                  </span>
                  <span
                    className={`flex items-baseline gap-1.5 font-mono tabular-nums text-2xl sm:text-3xl font-semibold tracking-tight ${
                      totalProfit < 0 ? "text-rose-600" : "text-[#121316]"
                    }`}
                  >
                    {totalProfit.toLocaleString("ru-RU")}
                    <span className="text-sm font-medium text-[#6B7280]">€</span>
                  </span>
                </div>
                <div className="flex flex-col items-start sm:items-end gap-1">
                  <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                    Суточная доходность
                  </span>
                  <span
                    className={`font-mono tabular-nums text-lg sm:text-xl font-semibold ${
                      currentDailyProfit < 0 ? "text-rose-600" : "text-emerald-600"
                    }`}
                  >
                    {Math.round(currentDailyProfit).toLocaleString("ru-RU")}
                    <span className="text-sm font-medium text-[#6B7280]"> €/сут</span>
                  </span>
                  {totalProfit < 0 ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600">
                      <AlertTriangle className="w-3.5 h-3.5" />
                      Рейс убыточный — доходы не покрывают расходы
                    </span>
                  ) : null}
                </div>
              </div>

              {/* Показатели экономики: подпись + моно-значение, без плашек */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-x-8 gap-y-4 pt-4 border-t border-[#E5E7EB]">
                <div>
                  <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none block mb-1">
                    Общий пробег
                  </span>
                  <span className="text-xl font-semibold font-mono tabular-nums tracking-tight text-[#121316]">
                    {totalKm.toLocaleString("ru-RU")} км
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none block mb-1">
                    Общий фрахт
                  </span>
                  <span className="text-xl font-semibold font-mono tabular-nums tracking-tight text-[var(--accent-ink)]">
                    {totalFreight.toLocaleString("ru-RU")} €
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none block mb-1">
                    Расходы ({globalDirection})
                  </span>
                  <span className="text-xl font-semibold font-mono tabular-nums tracking-tight text-[var(--accent-ink)]">
                    {totalExpenses.toLocaleString("ru-RU")} €
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none block mb-1">
                    Дней в пути
                  </span>
                  <span className="text-xl font-semibold font-mono tabular-nums tracking-tight text-[#121316]">
                    {tripDays}
                  </span>
                </div>
              </div>

              {/* Разбивка по плечам: карточки на узких экранах, таблица от 900px */}
              <div className="pt-4 border-t border-[#E5E7EB]">
                <div className={`${UI.caption} mb-3`}>Разбивка по плечам</div>

                {/* Карточки плеч — без горизонтальной прокрутки */}
                <div className="min-[900px]:hidden flex flex-col gap-2.5">
                  {legBreakdown.map((row) => (
                    <div
                      key={row.index}
                      className={`rounded-2xl border p-4 ${
                        row.filled && row.margin < 0
                          ? "border-rose-200 bg-rose-50/40"
                          : "border-[#E5E7EB] bg-white"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="w-5 h-5 rounded-full bg-[#F3F4F6] text-[#6B7280] text-[10px] font-mono font-bold flex items-center justify-center shrink-0">
                            {row.index + 1}
                          </span>
                          <span
                            className="text-sm font-semibold text-[#121316] truncate"
                            title={`${row.from || "?"} → ${row.to || "?"}`}
                          >
                            {row.from || row.to ? `${row.from || "?"} → ${row.to || "?"}` : "—"}
                          </span>
                        </div>
                        {row.filled && row.margin < 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-rose-600 shrink-0">
                            <AlertTriangle className="w-3 h-3" /> Убыток
                          </span>
                        ) : null}
                      </div>

                      <div className="mt-3 flex flex-col divide-y divide-[#E5E7EB]">
                        <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
                          <span className="text-[#6B7280]">Пробег, км</span>
                          <span className="font-mono font-semibold text-[#121316] text-right">
                            {row.filled
                              ? `${Math.round(row.totalKm).toLocaleString("ru-RU")}${
                                  row.emptyRun > 0
                                    ? ` (+${Math.round(row.emptyRun).toLocaleString("ru-RU")} доезд)`
                                    : ""
                                }`
                              : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
                          <span className="text-[#6B7280]">Ставка, €</span>
                          <span className="font-mono font-semibold text-[#121316] text-right">
                            {row.filled ? Math.round(row.freight).toLocaleString("ru-RU") : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
                          <span className="text-[#6B7280]">Расходы, €</span>
                          <span className="font-mono font-semibold text-[var(--accent-ink)] text-right">
                            {row.filled ? Math.round(row.expense).toLocaleString("ru-RU") : "—"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
                          <span className="text-[#6B7280]">Маржа, €</span>
                          <span
                            className={`font-mono font-semibold text-right ${
                              row.filled && row.margin < 0 ? "text-rose-600" : "text-[#121316]"
                            }`}
                          >
                            {row.filled ? Math.round(row.margin).toLocaleString("ru-RU") : "—"}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Таблица — от 900px и выше */}
                <div className="hidden min-[900px]:block overflow-x-auto">
                  <table className="w-full text-left min-w-[560px]">
                    <thead>
                      <tr className="border-b border-[#E5E7EB] text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                        <th className="px-3 py-2.5 font-semibold w-10 whitespace-nowrap">#</th>
                        <th className="px-3 py-2.5 font-semibold whitespace-nowrap">Плечо</th>
                        <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Пробег, км</th>
                        <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Ставка, €</th>
                        <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Расходы, €</th>
                        <th className="px-3 py-2.5 font-semibold text-right whitespace-nowrap">Маржа, €</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#F3F4F6]">
                      {legBreakdown.map((row) => (
                        <tr key={row.index} className="hover:bg-[#F9FAFB] transition-colors">
                          <td className="px-3 py-2 text-xs font-semibold text-[#9CA3AF]">{row.index + 1}</td>
                          <td className="px-3 py-2 text-xs font-medium text-[#4B5563]">
                            {row.from || row.to
                              ? `${row.from || "?"} → ${row.to || "?"}`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono font-semibold text-[#121316] text-right whitespace-nowrap">
                            {row.filled
                              ? `${Math.round(row.totalKm).toLocaleString("ru-RU")}${
                                  row.emptyRun > 0 ? ` (+${Math.round(row.emptyRun).toLocaleString("ru-RU")} доезд)` : ""
                                }`
                              : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono font-semibold text-[#121316] text-right">
                            {row.filled ? Math.round(row.freight).toLocaleString("ru-RU") : "—"}
                          </td>
                          <td className="px-3 py-2 text-xs font-mono font-semibold text-[var(--accent-ink)] text-right">
                            {row.filled ? Math.round(row.expense).toLocaleString("ru-RU") : "—"}
                          </td>
                          <td
                            className={`px-3 py-2 text-xs font-mono font-semibold text-right ${
                              row.filled && row.margin < 0 ? "text-rose-600" : "text-[#121316]"
                            }`}
                          >
                            {row.filled ? Math.round(row.margin).toLocaleString("ru-RU") : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Статьи расходов */}
              <div className="pt-4 border-t border-[#E5E7EB]">
                <div className={`${UI.caption} mb-3`}>Статьи расходов</div>
                <div className="flex flex-col divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-xl overflow-hidden">
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-xs text-[#4B5563]">Пробег × коэффициент</span>
                    <span className="text-xs font-mono font-semibold text-[#121316]">
                      {Math.round(expenseByDistance).toLocaleString("ru-RU")} €
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-xs text-[#4B5563]">Паромы по плечам</span>
                    <span className="text-xs font-mono font-semibold text-[#121316]">
                      {Math.round(totalFerryCosts).toLocaleString("ru-RU")} €
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-xs text-[#4B5563]">Доп. расходы по плечам</span>
                    <span className="text-xs font-mono font-semibold text-[#121316]">
                      {Math.round(expenseByLegAdditional).toLocaleString("ru-RU")} €
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-xs text-[#4B5563]">
                      Прочие затраты по рейсу
                      {expenseItems.length > 0 ? (
                        <span className="text-[#9CA3AF]">
                          {" "}
                          ({expenseItems.filter((x) => x.label.trim()).map((x) => x.label).join(", ")})
                        </span>
                      ) : null}
                    </span>
                    <span className="text-xs font-mono font-semibold text-[#121316]">
                      {Math.round(additionalExpenses || 0).toLocaleString("ru-RU")} €
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="text-xs font-semibold text-[#121316]">Итого расходов</span>
                    <span className="text-sm font-mono font-bold text-[#121316]">
                      {totalExpenses.toLocaleString("ru-RU")} €
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </section>
      </div>

      {/* Виджеты под конструктором: конвертер и шаблоны — на холсте, как блоки у дозволов */}
      <div className="mt-5 pt-5 border-t border-[#E5E7EB] grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-10 items-start">
        {/* Конвертер валют НБ РБ — колонка на холсте */}
        <div
          id="nbrb-converter-widget"
          className="flex flex-col gap-4 min-w-0"
        >
          <SectionHeader
            icon={<Landmark className="w-4 h-4" />}
            tone="graphite"
            title="Конвертер валют НБ РБ"
            subtitle="Курсы приходят с открытого API НБ РБ; дата курса указана рядом"
          >
            <button
              type="button"
              onClick={fetchNbrbRates}
              disabled={nbrbLoading}
              className={UI.buttonIcon}
              title="Обновить курсы из НБ РБ"
              aria-label="Обновить курсы из НБ РБ"
            >
              <RefreshCw className={`w-4 h-4 ${nbrbLoading ? "animate-spin" : ""}`} />
            </button>
            <span className={UI.chip}>API NBRB.BY</span>
          </SectionHeader>

          {/* Состояние загрузки/ошибки и дата обновления курса */}
          {nbrbError ? (
            <ErrorRow text={nbrbError} onRetry={fetchNbrbRates} />
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border border-[#E5E7EB] px-3 py-2.5 rounded-xl text-xs select-none">
              <span className="inline-flex items-center gap-1.5 text-[#6B7280] font-medium shrink-0 mr-1">
                {nbrbLoading ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Загружаем курсы НБ РБ…
                  </>
                ) : (
                  <>
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      Курсы НБ РБ
                      {nbrbDate ? (
                        <>
                          {" на "}
                          <span className="font-semibold text-[#121316]">{formatDateSlash(nbrbDate)}</span>
                        </>
                      ) : null}
                      :
                    </span>
                  </>
                )}
              </span>
              <span className="text-[#121316] font-semibold shrink-0">
                1 USD = {(nbrbRates["USD"]?.rate || 3.25).toFixed(4)}
              </span>
              <span className="text-[#121316] font-semibold shrink-0">
                1 EUR = {(nbrbRates["EUR"]?.rate || 3.55).toFixed(4)}
              </span>
              <span className="text-[#121316] font-semibold shrink-0">
                100 RUB = {(nbrbRates["RUB"]?.rate || 3.42).toFixed(4)}
              </span>
              <span className="text-[#121316] font-semibold shrink-0">
                10 TRY = {(nbrbRates["TRY"]?.rate || 1.0).toFixed(4)}
              </span>
              <span className="text-[#121316] font-semibold shrink-0">
                10 CNY = {(nbrbRates["CNY"]?.rate || 4.5).toFixed(4)}
              </span>
            </div>
          )}

          {/* Карточки валют — тот же вид поля и результата, что в конвертере топ-бара */}
          <div className="w-full flex flex-col divide-y divide-[#F3F4F6] max-h-[60vh] md:max-h-[420px] overflow-y-auto custom-scrollbar border border-[#E5E7EB] rounded-xl px-3">
            {CONVERTER_CURRENCIES.map((cur) => (
              <div
                key={cur}
                className="py-2.5 transition-colors"
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-6 h-6 rounded-lg bg-[#F3F4F6] text-[#4B5563] flex items-center justify-center text-[12px] font-bold shrink-0">
                      {currencySymbol(cur)}
                    </span>
                    <span className="text-[11px] font-medium text-[#4B5563] truncate">{currencyName(cur)}</span>
                    <span className="text-[10px] font-semibold text-[#9CA3AF] tabular-nums shrink-0">{cur}</span>
                  </div>
                  <span className="text-[11px] text-[#9CA3AF] font-mono tabular-nums shrink-0">
                    {cur === "BYN"
                      ? "базовая"
                      : nbrbRates[cur]
                        ? `1 ${cur} = ${(nbrbRates[cur].rate / (nbrbRates[cur].scale || 1)).toFixed(4)} BYN`
                        : "—"}
                  </span>
                </div>
                <div className="relative flex items-center">
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
                      const rawValue = (e.target as HTMLInputElement).value;
                      const inputVal = parseFloat(rawValue);
                      if (isNaN(inputVal)) {
                        CONVERTER_CURRENCIES.forEach((toCur) => {
                          if (toCur !== cur) {
                            const el = document.getElementById(
                              `conv-multi-${toCur}`,
                            ) as HTMLInputElement;
                            if (el) el.value = "";
                          }
                        });
                        setConvHasValue((prev) => {
                          const next = { ...prev };
                          next[cur] = rawValue.trim() !== "";
                          CONVERTER_CURRENCIES.forEach((toCur) => {
                            if (toCur !== cur) next[toCur] = false;
                          });
                          return next;
                        });
                        return;
                      }

                      const fromCur = cur;
                      const rateFrom = nbrbRates[fromCur]
                        ? nbrbRates[fromCur].rate / nbrbRates[fromCur].scale
                        : 1;

                      CONVERTER_CURRENCIES.forEach((toCur) => {
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
                      setConvHasValue((prev) => {
                        const next = { ...prev };
                        next[cur] = rawValue.trim() !== "";
                        CONVERTER_CURRENCIES.forEach((toCur) => {
                          if (toCur !== cur) next[toCur] = true;
                        });
                        return next;
                      });
                    }}
                    className="w-full h-10 pl-3 pr-10 rounded-xl border border-[#E5E7EB] bg-white text-base font-semibold tabular-nums text-[#121316] placeholder:text-[#D1D5DB] outline-none transition-colors hover:border-[#D1D5DB] focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-20)]"
                  />
                  {convHasValue[cur] ? (
                    <button
                      type="button"
                      onClick={() => clearConverterField()}
                      title={`Очистить сумму в ${cur}`}
                      aria-label={`Очистить сумму в ${cur}`}
                      className="absolute right-1.5 h-8 w-8 rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] flex items-center justify-center transition-colors cursor-pointer"
                    >
                      <X size={13} strokeWidth={1.5} />
                    </button>
                  ) : null}
                </div>
              </div>
            ))}
          </div>

        </div>

        {/* Шаблоны мульти-рейсов — колонка на холсте */}
        <div className="flex flex-col gap-4 min-w-0">
          <SectionHeader
            icon={<FileSpreadsheet className="w-4 h-4" />}
            tone="graphite"
            title="Шаблоны мульти-рейсов"
            subtitle="Готовая база маршрутов — разверните шаблон в конструктор"
          >
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                placeholder="Поиск по названию..."
                value={routeSearch}
                onChange={(e) => setRouteSearch(e.target.value)}
                className={`${UI.searchInput} pl-9`}
              />
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF] pointer-events-none" />
            </div>
          </SectionHeader>

          <div className="flex flex-col divide-y divide-[#F3F4F6]">
            {filteredTemplates.map((t, idx) => {
              const legs = t.legs || [];
              const totalDist = legs.reduce((acc, l) => acc + (l.dist || l.distance || 0), 0);
              const totalRate = legs.reduce((acc, l) => acc + Number(l.freight || 0), 0);
              return (
                <div
                  key={t.id || idx}
                  className="group flex flex-col gap-3 py-4 transition-colors duration-200"
                >
                  {/* Верхняя строка: название, маршрут и действия */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-[#F3F4F6]">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-2.5 rounded-xl bg-[#F3F4F6] text-[#121316] shrink-0">
                        <FolderOpen className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <h4 className="font-semibold text-sm text-[#121316] truncate" title={t.name}>
                          {t.name}
                        </h4>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {t.globalDir && (
                            <span className={UI.chip}>
                              {t.globalDir}
                            </span>
                          )}
                          <span className={UI.chip}>
                            {legs.length} {plural(legs.length, 'плечо', 'плеча', 'плеч')}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between md:justify-end gap-4 shrink-0">
                      <div className="text-left md:text-right">
                        <span className="text-[11px] text-[#6B7280] font-medium uppercase tracking-wider block">
                          Общий пробег
                        </span>
                        <span className="text-[#121316] font-semibold font-mono text-xs md:text-sm">
                          {totalDist.toLocaleString("ru-RU")} км
                        </span>
                      </div>
                      <div className="text-left md:text-right">
                        <span className="text-[11px] text-[#6B7280] font-medium uppercase tracking-wider block">
                          Ставка
                        </span>
                        <span className="text-[#121316] font-semibold font-mono text-xs md:text-sm">
                          {totalRate.toLocaleString("ru-RU")} €
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => loadTemplate(t)}
                          className={`${UI.buttonDark} px-3.5 w-auto`}
                          title="Развернуть шаблон в конструктор"
                        >
                          Развернуть
                        </button>
                        <button
                          type="button"
                          onClick={() => confirmDeleteTemplate(t)}
                          className="inline-flex items-center justify-center min-h-[44px] min-w-[44px] rounded-xl bg-white border border-[#E5E7EB] text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer"
                          title="Удалить шаблон"
                          aria-label={`Удалить шаблон ${t.name}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Маршрут шаблона */}
                  <div className="rounded-xl border border-[#E5E7EB] px-3 py-2.5">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-2 w-full">
                      {legs.map((l, i) => (
                        <div key={i} className="flex items-center gap-2 min-w-0">
                          {i > 0 && (
                            <span className="text-[#D1D5DB] font-bold text-[11px] select-none px-0.5">&rarr;</span>
                          )}
                          <span className="bg-white px-3 py-1.5 rounded-xl border border-[#E5E7EB] text-[10px] sm:text-[11px] font-semibold text-[#121316] flex items-center gap-2 shadow-xs hover:border-[var(--accent-ui)] transition-colors duration-150 min-w-0">
                            <span className="truncate max-w-[140px] text-[#121316]" title={l.from}>{l.from || "?"}</span>
                            <span className="text-[#D1D5DB] font-normal select-none">&bull;</span>
                            <span className="truncate max-w-[140px] text-[#4B5563]" title={l.to}>{l.to || "?"}</span>
                            <span className="text-[10px] text-[var(--accent-ink)] font-semibold bg-[var(--accent-10)] px-1.5 py-0.5 rounded-md border border-[var(--accent-25)] ml-1 shrink-0">
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
            {filteredTemplates.length === 0 && (
              <div className="border border-dashed border-[#E5E7EB] rounded-xl">
                <EmptyState
                  kind={routeSearch.trim() ? "no-results" : "empty"}
                  query={routeSearch.trim() || undefined}
                  title={routeSearch.trim() ? "Шаблоны не найдены" : "Шаблонов пока нет"}
                  hint={
                    routeSearch.trim()
                      ? "Измените запрос поиска — названия шаблонов фильтруются по подстроке."
                      : "Заполните расчёт и нажмите «Шаблонизировать» — шаблон появится здесь и будет доступен всем."
                  }
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Журнал расчётов — секция на холсте */}
      <div className="w-full mt-5 pt-5 border-t border-[#E5E7EB] flex flex-col">
          <SectionHeader
            icon={<FileSpreadsheet className="w-4 h-4" />}
            tone="graphite"
            title="Журнал расчётов"
            subtitle="Сохранённые калькуляции: печать, копирование в форму или правка"
          >
            <span className={UI.countBadge}>{calculationHistory.length}</span>
          </SectionHeader>

          <div className="relative mt-4 mb-4">
            <input
              type="text"
              placeholder="Поиск по направлениям, дате, логисту..."
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              className={`${UI.searchInput} pl-9`}
            />
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#9CA3AF] pointer-events-none" />
          </div>

          {/* Направления журнала: подпись и пилюли — как фильтры дозволов */}
          <div className="mb-4 flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none">Направление</span>
            <FilterPills
              items={[
                { key: "Все", label: `Все направления (${calculationHistory.length})` },
                ...uniqueDirections.map((dir) => ({
                  key: dir,
                  label: `${dir} (${directionsCounts[dir] || 0})`,
                })),
              ]}
              active={activeHistoryDirectionTab}
              onChange={(key) => setActiveHistoryDirectionTab(key)}
              ariaLabel="Фильтр журнала по направлению"
            />
          </div>

          {/* Панель выделения: над списком, отделена линией как тулбар у дозволов */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4 pb-3 border-b border-[#E5E7EB]">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={selectAllVisible}
                className={UI.buttonGhost}
              >
                Выбрать все
              </button>
              <button
                type="button"
                onClick={deselectAll}
                className={UI.buttonGhost}
              >
                Снять все
              </button>
              <span className={UI.hint}>
                Выбрано: {selectedCalcIds.size}
              </span>
            </div>
            {selectedCalcIds.size > 0 && (
              <button
                type="button"
                onClick={printSelectedCalculations}
                className={UI.buttonDark}
              >
                <Printer className="h-4 w-4" />
                Печать выбранных ({selectedCalcIds.size})
              </button>
            )}
          </div>

          <div className="pr-1 space-y-2 pb-4">
            {!historyReady ? (
              <div className={UI.loading}>
                <Loader2 className="w-4 h-4 animate-spin" />
                Загружаем журнал расчётов…
              </div>
            ) : (
              <>
                {visibleHistory.map((calc) => (
                  <CalculationCard
                    key={calc.id}
                    calc={calc}
                    user={user}
                    copyHistoryToForm={copyHistoryToForm}
                    openEditCalcModal={openEditCalcModal}
                    onPrint={printSingleCalculation}
                    isSelected={selectedCalcIds.has(calc.id)}
                    onToggleSelect={toggleSelectCalc}
                  />
                ))}
                {filteredHistory.length === 0 && (
                  <EmptyState
                    kind={calculationHistory.length === 0 ? "empty" : "no-results"}
                    query={historySearch.trim() || undefined}
                    title={calculationHistory.length === 0 ? "Журнал пуст" : "Ничего не найдено"}
                    hint={
                      calculationHistory.length === 0
                        ? "Сохранённые расчёты появятся здесь — заполните форму и нажмите «Сохранить расчёт»."
                        : "Измените запрос или снимите фильтр направления."
                    }
                  />
                )}
                {historyPage < filteredHistory.length && (
                  <div className="flex justify-center pt-2">
                    <button
                      type="button"
                      onClick={() => setHistoryPage((p) => p + 10)}
                      className="inline-flex items-center gap-2 px-5 rounded-xl text-xs font-medium text-[#121316] bg-white border border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB] transition-colors cursor-pointer min-h-[44px]"
                    >
                      Показать ещё 10
                      <span className="text-[#9CA3AF] font-normal">
                        (осталось {filteredHistory.length - historyPage})
                      </span>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
      </div>

      <MapRouteDialog
        isOpen={mapModalOpen}
        onClose={cancelMapRoute}
        legIndex={mapLegIndex}
        leg={mapLegIndex !== null ? legs[mapLegIndex] : null}
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

      <ModalShell
        isOpen={!!editingCalcId}
        onClose={closeEditCalcModal}
        title="Редактирование калькуляции"
        subtitle="Правка сохранённого расчёта из журнала"
        icon={<Edit className="w-4 h-4" />}
        iconTone="graphite"
        maxWidth="max-w-lg"
        footer={
          <>
            <button
              type="button"
              onClick={closeEditCalcModal}
              className={`${UI.buttonGhost} w-full sm:w-auto`}
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={saveEditCalcModal}
              className={`${UI.buttonDark} w-full sm:w-auto`}
            >
              <Check className="w-4 h-4" /> Сохранить
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel}>
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
                  className={UI.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel}>
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
                  className={UI.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel}>
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
                  className={UI.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel}>
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
                  className={UI.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel}>
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
                  className={UI.input}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel}>
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
                  className={UI.input}
                />
              </div>
        </div>
      </ModalShell>
    </div>
  );
}
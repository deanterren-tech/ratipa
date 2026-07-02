import React, { useState, useEffect, useMemo } from "react";
import {
  UserProfile,
  RouteCalculation,
  Leg,
  FerryTemplate,
  DistancePreset,
  ChatMessage,
  RouteTemplate,
  DirectionPreset,
} from "../../types";
import { dbService } from "../../firebase";
import { pdService } from "../../firebase/planDohodService";
import {
  Plus,
  Trash2,
  Save,
  MapPin,
  Calculator,
  MessageSquare,
  Sparkles,
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
  ChevronUp,
  ChevronDown,
  GripVertical,
  Search,
  FolderOpen,
} from "lucide-react";
import {
  APIProvider,
  Map,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import BelarusMap from "../BelarusMap";

const API_KEY =
  process.env.GOOGLE_MAPS_PLATFORM_KEY ||
  (window as any).GOOGLE_MAPS_PLATFORM_KEY ||
  "";
const hasValidKey = Boolean(API_KEY) && API_KEY !== "YOUR_API_KEY";

function normalizeRoadString(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/m/g, "м")
    .replace(/e/g, "е")
    .replace(/a/g, "а")
    .replace(/o/g, "о")
    .replace(/p/g, "р")
    .replace(/c/g, "с")
    .replace(/x/g, "х")
    .replace(/t/g, "т");
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
          if (res.ok) {
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
          console.error("Geocode api failed:", err);
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
          if (res.ok) {
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
          console.error("Geocode api failed:", err);
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

      const coordinates = validCoords
        .map((vc) => `${vc.lng()},${vc.lat()}`)
        .join(";");
      try {
        const response = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson&steps=true&alternatives=true`,
        );

        if (!active) return;

        if (response.ok) {
          const data = await response.json();
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

export default function DohodModule({ user }: DohodModuleProps) {
  const [calculationHistory, setCalculationHistory] = useState<
    RouteCalculation[]
  >([]);
  const [routeTemplates, setRouteTemplates] = useState<RouteTemplate[]>([]);
  const [ferries, setFerries] = useState<FerryTemplate[]>([]);
  const [distances, setDistances] = useState<DistancePreset[]>([]);
  const [directions, setDirections] = useState<DirectionPreset[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);

  // Form State
  const [globalDirection, setGlobalDirection] = useState("Турция");

  // Date and Days
  const [tripStartDate, setTripStartDate] = useState<string>("");
  const [tripEndDate, setTripEndDate] = useState<string>("");
  const [tripDays, setTripDays] = useState<number>(1);

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
  const [mapOrigin, setMapOrigin] = useState("");
  const [mapDestination, setMapDestination] = useState("");
  const [mapKmResult, setMapKmResult] = useState<number>(0);
  const [saveToDirectoryChecked, setSaveToDirectoryChecked] = useState(false);
  const [mapAvoidTolls, setMapAvoidTolls] = useState(false);
  const [mapAvoidHighways, setMapAvoidHighways] = useState(false);
  const [mapAvoidFerries, setMapAvoidFerries] = useState(false);
  const [mapVehicleType, setMapVehicleType] = useState("TRUCK");
  const [mapAvoidKeywords, setMapAvoidKeywords] = useState("");
  const [mapWaypoints, setMapWaypoints] = useState<string[]>([]);

  const handleMoveWaypoint = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= mapWaypoints.length) return;
    const updated = [...mapWaypoints];
    const [removed] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, removed);
    setMapWaypoints(updated);
  };

  const [mapAvoidedStatus, setMapAvoidedStatus] = useState<{
    attempted: boolean;
    avoidedSuccessfully: boolean;
    matches: string[];
  }>({ attempted: false, avoidedSuccessfully: false, matches: [] });

  const [conversionDialog, setConversionDialog] = useState<{
    index: number;
    infoRate: number;
    infoCurrency: string;
    proposedFreight: number;
  } | null>(null);

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
    },
  ]);

  const [aiSuggestions, setAiSuggestions] = useState<string>(
    "Вставьте рабочий текст вроде «Минск — Стамбул 4300 евро». Система добавит плечи и найдет километраж.",
  );
  const [routeSearch, setRouteSearch] = useState("");
  const [historySearch, setHistorySearch] = useState("");
  const [activeHistoryDirectionTab, setActiveHistoryDirectionTab] =
    useState("Все");

  const uniqueDirections = useMemo(() => {
    return Array.from(
      new Set(calculationHistory.map((c) => c.globalDirection).filter(Boolean)),
    );
  }, [calculationHistory]);

  const directionsCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    calculationHistory.forEach((c) => {
      const dir = c.globalDirection;
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
        (c.globalDirection || "").toLowerCase().includes(searchLower);
      const matchesTab =
        activeHistoryDirectionTab === "Все" ||
        c.globalDirection === activeHistoryDirectionTab;
      return matchesSearch && matchesTab;
    });
  }, [calculationHistory, historySearch, activeHistoryDirectionTab]);

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

    const subHistory = dbService.getRouteCalculations(setCalculationHistory);
    const subRouteTpl = dbService.getRouteTemplates(setRouteTemplates);
    const subFerries = dbService.getFerryTemplates(setFerries);
    const subDistances = dbService.getDistances(setDistances);
    const subDirs = pdService.subscribeDirections((data: Record<string, number>) => {
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
    const subChat = dbService.getChatMessages("ai_dispatcher", setChatMessages);
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
      subFerries();
      subDistances();
      subDirs();
      subChat();
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
    origin: string,
    destination: string,
  ) => {
    setMapLegIndex(idx);
    setMapOrigin(origin || "");
    setMapDestination(destination || "");
    setMapKmResult(0);
    setMapWaypoints([]);
    setMapModalOpen(true);
  };

  const applyMapRoute = () => {
    if (mapLegIndex !== null) {
      const cleanOrigin = mapOrigin.trim();
      const cleanDestination = mapDestination.trim();

      updateLeg(mapLegIndex, {
        dist: mapKmResult,
        distance: mapKmResult,
        from: cleanOrigin,
        to: cleanDestination,
      });

      if (saveToDirectoryChecked) {
        dbService.saveDistance(
          {
            id: "dist_" + Date.now(),
            from: cleanOrigin,
            to: cleanDestination,
            distance: mapKmResult,
          },
          user.name,
          user.role,
        );
      }
    }
    setMapModalOpen(false);
    setSaveToDirectoryChecked(false);
  };

  const handleCityBlur = (idx: number) => {
    const leg = legs[idx];
    if (leg && leg.from && leg.to) {
      const matchedDist = findDistanceInPool(leg.from, leg.to);
      if (matchedDist === null && (leg.dist || leg.distance || 0) === 0) {
        if (pdSettings?.useDistanceLookup) {
          openMapRouteModal(idx, leg.from, leg.to);
        }
      }
    }
  };

  const updateLeg = (
    index: number,
    updatedFields: Partial<Omit<Leg, "id">>,
  ) => {
    setLegs(
      legs.map((l, i) => {
        if (i === index) {
          const merged = { ...l, ...updatedFields };

          if (
            updatedFields.from !== undefined ||
            updatedFields.to !== undefined
          ) {
            const matchedDist = findDistanceInPool(merged.from, merged.to);
            if (
              matchedDist !== null &&
              matchedDist > 0 &&
              typeof updatedFields.dist === "undefined"
            ) {
              merged.dist = matchedDist;
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
      }),
    );
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
      setConversionDialog({
        index,
        infoRate,
        infoCurrency,
        proposedFreight,
      });
    }
  };

  const applyConversion = () => {
    if (conversionDialog) {
      updateLeg(conversionDialog.index, {
        freight: conversionDialog.proposedFreight,
      });
      setConversionDialog(null);
    }
  };

  const dismissConversion = () => {
    setConversionDialog(null);
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

      setTimeout(() => {
        if (window.confirm(q)) {
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
    (acc, l) => acc + Number(l.dist || l.distance || 0) + Number(l.emptyRun || 0),
    0,
  );
  const totalFreight = legs.reduce((acc, l) => acc + Number(l.freight || 0), 0);
  const totalFerryCosts = legs.reduce(
    (acc, l) => acc + Number(l.ferryCost || 0),
    0,
  );

  // Legacy logic: expenses = sum(dist * coeff + ferryCost)
  const totalExpenses = legs.reduce((acc, l) => {
    return (
      acc +
      ((Number(l.dist || l.distance || 0) + Number(l.emptyRun || 0)) * Number(l.coeff || 0) +
        Number(l.ferryCost || 0))
    );
  }, 0);

  const totalProfit = totalFreight - totalExpenses;
  const currentDailyProfit = tripDays > 0 ? totalProfit / tripDays : 0;

  const saveCalculation = () => {
    if (legs.some((l) => !l.from && !l.to && !l.dist && !l.freight)) {
      alert("Калькулятор пуст пустой. Нечего сохранять.");
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
      alert("Калькулятор пуст!");
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
      freight: l.freight || 0,
      infoRate: l.infoRate || 0,
      infoCurrency: l.infoCurrency || "USD",
      ferrySelectValue: l.ferrySelectValue || "none",
      ferryCost: l.ferryCost || l.ferry || 0,
      coeff: l.coeff || 0,
    }));
    setLegs(newArray);
  };

  const copyHistoryToForm = (calc: RouteCalculation) => {
    if (calc.direction || calc.globalDirection)
      setGlobalDirection(calc.direction || calc.globalDirection || "Турция");
    if (calc.days) setTripDays(calc.days);

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
          freight: l.freight || 0,
          infoRate: l.infoRate || 0,
          infoCurrency: l.infoCurrency || "USD",
          ferrySelectValue: l.ferrySelectValue || "none",
          ferryCost: l.ferryCost || 0,
          coeff: l.coeff || 0,
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
  };

  const closeEditCalcModal = () => {
    setEditingCalcId(null);
    setEditingCalcData({});
  };

  const saveEditCalcModal = () => {
    if (!editingCalcId) return;

    const totalKm = (editingCalcData.legs || []).reduce(
      (acc, leg) => acc + (leg.dist || leg.distance || 0) + (leg.emptyRun || 0),
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

  // AI PARSER logic ported from dohod-7.html and heavily upgraded
  const parseRouteMessage = (text: string) => {
    const parsedLegs: any[] = [];
    const originalText = (text || "")
      .replace(/[→➔➡]/g, " ")
      .replace(/[—–]/g, "-");

    const normalizeCityName = (name: string) =>
      (name || "")
        .trim()
        .replace(/\s+/g, " ")
        .split(" ")
        .map((p) =>
          p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : "",
        )
        .join(" ");

    // Продвинутый маппинг валют
    const mapCurrency = (raw: string) => {
      const v = (raw || "")
        .toLowerCase()
        .trim()
        .replace(/[^a-zа-яё0-9$€₽.]/g, "");
      if (!v) return "EUR";
      if (
        ["€", "eur", "евро", "euro", "эур", "евр"].some((x) => v.includes(x)) ||
        v.includes("€")
      )
        return "EUR";
      if (
        [
          "₽",
          "rub",
          "руб",
          "рубль",
          "рублей",
          "рос",
          "росруб",
          "рр",
          "росс",
          "рубли",
        ].some((x) => v.includes(x)) ||
        v.includes("₽") ||
        v === "рр"
      )
        return "RUB";
      if (
        ["byn", "бел", "белруб", "рб", "by", "белорус"].some((x) =>
          v.includes(x),
        )
      )
        return "BYN";
      if (
        [
          "usd",
          "$",
          "долл",
          "доллар",
          "доллара",
          "долларов",
          "уе",
          "бакс",
          "баксов",
          "dollars",
          "y.e",
          "ye",
        ].some((x) => v.includes(x)) ||
        v.includes("$")
      )
        return "USD";
      return "USD";
    };

    // Продвинутый парсинг стоимости (учитывает тыс., к, пробелы, запятые)
    const extractRate = (chunk: string) => {
      const matches = [];
      // В регулярном выражении для валют ищем словосочетания с пробелами, такие как рос руб
      const rateRegex =
        /(\d[\d\s]*(?:[.,]\d+)?)\s*(тыс|тысяч|тыс\.|тысячи|к|k)?\s*(евро|eur|euro|эур|€|долл|доллар|доллара|долларов|usd|\$|у\.е|уе|руб(?:лей|ль|ля|и|ов)?|rub|₽|byn|бел(?:рус|руб(?:лей)?)?|рос\.?\s*руб(?:лей|ля|ь)?|росруб|рр)/gi;
      let match;
      while ((match = rateRegex.exec(chunk)) !== null) {
        const after = chunk
          .slice(
            match.index + match[0].length,
            match.index + match[0].length + 8,
          )
          .toLowerCase();
        if (/^\s*(км|km)/.test(after)) continue;
        let amount =
          parseFloat(match[1].replace(/\s+/g, "").replace(",", ".")) || 0;
        const multiplier = match[2] ? match[2].toLowerCase() : "";
        if (
          ["тыс", "тысяч", "тыс.", "тысячи", "к", "k"].some((m) =>
            multiplier.includes(m),
          )
        ) {
          amount *= 1000;
        }
        if (amount > 0) {
          matches.push({
            amount,
            currency: mapCurrency(match[3]),
            hasCurrency: Boolean(match[3]),
          });
        }
      }
      return (
        matches.find((i) => i.hasCurrency) ||
        matches[matches.length - 1] || { amount: 0, currency: "EUR" }
      );
    };

    // Нормализация падежей для fallback-режима
    const cleanCityName = (city: string) => {
      let name = city.trim();
      if (name.length <= 2) return name;
      const low = name.toLowerCase();
      if (low.endsWith("ска")) return name.slice(0, -1); // Минска -> Минск
      if (low.endsWith("ске")) return name.slice(0, -1); // Минске -> ...
      if (low.endsWith("ску")) return name.slice(0, -1) + "к"; // Минску -> Минск
      if (low.endsWith("кву")) return name.slice(0, -1) + "а"; // Москву -> Москва
      if (low.endsWith("квы")) return name.slice(0, -1) + "а"; // Москвы -> Москва
      if (low.endsWith("кве")) return name.slice(0, -1) + "а"; // Москве -> Москва
      if (low.endsWith("бурга")) return name.slice(0, -1); // ...
      if (low.endsWith("бурге")) return name.slice(0, -1); // ...
      if (low.endsWith("града")) return name.slice(0, -1);
      if (low.endsWith("граде")) return name.slice(0, -1);
      if (low.endsWith("тера")) return name.slice(0, -1) + "р"; // Питера -> Питер
      if (low.endsWith("тере")) return name.slice(0, -1) + "р"; // Питере -> Питер
      if (low.endsWith("ова")) return name.slice(0, -1); // Ростова -> Ростов
      if (low.endsWith("ове")) return name.slice(0, -1); // Ростове ->  Ростов
      return name;
    };

    // Автогенерация базовых словоформ для городов из пресетов distances
    const getCityForms = (cityName: string): string[] => {
      const lower = cityName.toLowerCase().trim();
      const forms = [lower];

      if (
        lower.includes("санкт-петербург") ||
        lower === "питер" ||
        lower === "спб"
      ) {
        forms.push(
          "санкт-петербург",
          "санкт-петербурга",
          "санкт-петербурге",
          "питер",
          "питера",
          "питере",
          "спб",
        );
      }
      if (lower === "нижний новгород") {
        forms.push(
          "нижний новгород",
          "нижнего новгорода",
          "нижнем новгороде",
          "нн",
          "нижнем",
        );
      }
      if (lower.includes("ростов-на-дону")) {
        forms.push(
          "ростов-на-дону",
          "ростове-на-дону",
          "ростова-на-дону",
          "ростов",
        );
      }

      if (lower.length > 3) {
        if (lower.endsWith("а") || lower.endsWith("ы")) {
          forms.push(lower.slice(0, -1)); // Москва -> москв
        } else if (lower.endsWith("о") || lower.endsWith("е")) {
          forms.push(lower.slice(0, -1)); // ...
        } else if (lower.endsWith("ий") || lower.endsWith("ый")) {
          forms.push(lower.slice(0, -2));
        } else if (lower.endsWith("ь")) {
          forms.push(lower.slice(0, -1)); // Гомель -> гомел
        }
      }

      return Array.from(new Set(forms))
        .filter((f) => f.length > 2)
        .sort((a, b) => b.length - a.length);
    };

    const citiesDataset = Array.from(
      new Set(
        distances.flatMap((item) => [item.from, item.to]).filter(Boolean),
      ),
    )
      .map((city) => String(city).trim())
      .filter((city) => city.length > 1);

    const lowerSource = originalText.toLowerCase();
    const mentions: any[] = [];

    citiesDataset.forEach((city) => {
      const forms = getCityForms(city);
      forms.forEach((form) => {
        let index = lowerSource.indexOf(form);
        while (index !== -1) {
          const bBefore = lowerSource[index - 1] || " ";
          const bAfter = lowerSource[index + form.length] || " ";
          const hasCleanBoundary =
            !/[а-яёa-z0-9]/i.test(bBefore) && !/[а-яёa-z0-9]/i.test(bAfter);
          const overlaps = mentions.some(
            (m) => index < m.end && index + form.length > m.index,
          );
          if (hasCleanBoundary && !overlaps) {
            mentions.push({
              city: city, // Используем правильное (официальное) имя города из пресетов
              matchedText: originalText.slice(index, index + form.length),
              index,
              end: index + form.length,
            });
          }
          index = lowerSource.indexOf(form, index + 1);
        }
      });
    });

    mentions.sort((a, b) => a.index - b.index);

    if (mentions.length >= 2) {
      for (let i = 0; i < mentions.length - 1; i++) {
        const from = mentions[i].city;
        const to = mentions[i + 1].city;
        if (from.toLowerCase() === to.toLowerCase()) continue;
        const nextBoundary = mentions[i + 2]
          ? mentions[i + 2].index
          : originalText.length;
        const rateChunk = originalText.slice(mentions[i + 1].end, nextBoundary);
        const rate = extractRate(rateChunk);
        parsedLegs.push({
          from,
          to,
          eurRate: rate.currency === "EUR" ? rate.amount : 0,
          infoRate: rate.currency !== "EUR" ? rate.amount : 0,
          infoCurrency: rate.currency,
        });
      }
      return parsedLegs;
    }

    // fallback
    const tokens = originalText
      .replace(/[,.;:()]/g, " ")
      .replace(/-/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const noiseWords = [
      "в",
      "во",
      "из",
      "с",
      "со",
      "от",
      "на",
      "до",
      "по",
      "потом",
      "далее",
      "через",
      "едем",
      "рейс",
      "маршрут",
      "ставка",
      "фрахт",
      "цена",
      "за",
      "евро",
      "eur",
      "euro",
      "€",
      "долл",
      "usd",
      "$",
      "руб",
      "rub",
      "₽",
      "byn",
      "бел",
      "дней",
      "дн",
      "дней",
      "суток",
      "сут",
      "дня",
      "день",
      "сутки",
    ];
    const cityItems: string[] = [];

    tokens.forEach((token) => {
      if (noiseWords.includes(token.toLowerCase()) || /^\d/.test(token)) return;
      cityItems.push(normalizeCityName(cleanCityName(token)));
    });

    for (let i = 0; i < cityItems.length - 1; i++) {
      const rateChunk = originalText
        .split(cityItems[i + 1])
        .slice(1)
        .join(cityItems[i + 1]);
      const rate = extractRate(rateChunk);
      parsedLegs.push({
        from: cityItems[i],
        to: cityItems[i + 1],
        eurRate: rate.currency === "EUR" ? rate.amount : 0,
        infoRate: rate.currency !== "EUR" ? rate.amount : 0,
        infoCurrency: rate.currency,
      });
    }
    return parsedLegs;
  };

  const handleAISend = async () => {
    const text = chatInput.trim();
    if (!text) return;

    setChatInput("");

    if (editingMsgId) {
      dbService.updateChatMessage(editingMsgId, text);
      setEditingMsgId(null);
    } else {
      dbService.sendChatMessage("ai_dispatcher", text, user.name, user.uid);
    }

    try {
      const res = await fetch("/api/parse-dohod-text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      if (!res.ok) throw new Error("API parsing failed");
      const data = await res.json();

      if (data && data.legs && data.legs.length > 0) {
        const parsed = data.legs;
        const newArray = [...legs];
        if (newArray.length === 1 && !newArray[0].from && !newArray[0].to)
          newArray.shift();

        parsed.forEach((r: any) => {
          const matchedDist = findDistanceInPool(r.from, r.to) || 0;

          let eurRate = r.currency === "EUR" ? r.amount : 0;
          let infoRate = r.currency !== "EUR" ? r.amount : 0;
          let infoCurrency = r.currency || "EUR";

          let freightValue = eurRate || 0;
          if (!freightValue && infoRate && infoCurrency !== "EUR") {
            const rateX = nbrbRates[infoCurrency]
              ? nbrbRates[infoCurrency].rate / nbrbRates[infoCurrency].scale
              : 0;
            const rateEur = nbrbRates["EUR"] ? nbrbRates["EUR"].rate : 1;
            freightValue =
              rateEur > 0 ? Math.round((infoRate * rateX) / rateEur) : 0;
          }

          newArray.push({
            from: r.from,
            to: r.to,
            dist: matchedDist,
            freight: freightValue,
            infoRate: infoRate || 0,
            infoCurrency: infoCurrency,
            coeff: getDirCoeff(),
            ferrySelectValue: "none",
            ferryCost: 0,
          });
        });
        setLegs(newArray);

        if (data.total_days) {
          setTripDays(data.total_days);
        }

        let responseMsg = `Запрос обработан Gemini! Добавлено плеч: ${parsed.length}.`;
        if (data.total_days) {
          responseMsg += ` Установлено время поездки: ${data.total_days} дн.`;
        }

        // Детальная расшифровка того, что было найдено
        const details = parsed
          .map((p: any) => {
            let rateStr = "";
            if (p.amount) rateStr = `${p.amount} ${p.currency}`;
            return `${p.from} ➔ ${p.to} (${rateStr || "без ставки"})`;
          })
          .join(", ");

        dbService.sendChatMessage(
          "ai_dispatcher",
          `${responseMsg} (${details})`,
          "🤖 Робот парсер",
          "system",
        );
      } else {
        dbService.sendChatMessage(
          "ai_dispatcher",
          `Не удалось распознать маршрут через AI. Пожалуйста, проверьте формат.`,
          "🤖 Робот парсер",
          "system",
        );
      }
    } catch (err) {
      console.error("AI parse failed:", err);
      dbService.sendChatMessage(
        "ai_dispatcher",
        `Ошибка связи с ИИ помощником.`,
        "🤖 Робот парсер",
        "system",
      );
    }
  };

  const loadCitiesDatalist = () => {
    const set = new Set<string>();
    distances.forEach((d) => {
      set.add(d.from);
      set.add(d.to);
    });
    return Array.from(set).map((c) => <option key={c} value={c} />);
  };

  return (
    <div className="w-full grid grid-cols-1 xl:grid-cols-12 gap-6 font-sans">
      <datalist id="cities-datalist">{loadCitiesDatalist()}</datalist>

      {/* Main Left Workspace */}
      <div className="xl:col-span-8 space-y-6">
        {/* Header Block */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col sm:flex-row justify-between gap-4 select-none items-center">
          <div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
              <Calculator
                className="h-6 w-6 text-slate-800"
                style={{ fill: "#70FC8E" }}
              />
              Калькуляция
            </h1>
          </div>
        </div>

        {/* AI Parser Chat Panel */}
        <div className="bg-slate-900 rounded-[2rem] p-6 text-white border border-slate-800 shadow-md relative overflow-hidden flex flex-col h-[300px]">
          <div className="absolute top-0 right-0 p-2 opacity-10">
            <Sparkles className="h-16 w-16" />
          </div>
          <div className="flex items-center gap-2 mb-3">
            <div className="p-1 px-2 rounded-full bg-[#70FC8E]/20 text-[#70FC8E] text-[9px] font-black uppercase font-mono tracking-widest border border-[#70FC8E]/30">
              AI Помощник
            </div>
          </div>

          <div className="flex-1 overflow-y-auto space-y-3 bg-slate-950/50 rounded-xl p-4 mb-3 border border-slate-800 custom-scrollbar pr-2 flex flex-col-reverse">
            <div className="flex flex-col gap-3">
              {chatMessages.map((msg) => (
                <div
                  key={msg.id}
                  className={`flex flex-col ${msg.userId === user.uid ? "items-end" : "items-start"} animate-fade-in`}
                >
                  <span className="text-[10px] font-bold text-slate-500 mb-0.5">
                    {msg.username}
                  </span>
                  <div
                    className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${msg.userId === "system" ? "bg-[#70FC8E]/10 text-[#70FC8E] border border-[#70FC8E]/20 text-xs font-mono" : msg.userId === user.uid ? "bg-indigo-600 text-white rounded-br-none" : "bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700"}`}
                  >
                    {msg.text}
                  </div>
                </div>
              ))}
              {chatMessages.length === 0 && (
                <span className="text-xs text-slate-500 flex items-center justify-center font-bold">
                  История парсера пуста
                </span>
              )}
            </div>
          </div>

          <div className="flex gap-2 relative mt-auto">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Пример: Минск — Стамбул 4300..."
              className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-3 py-3 rounded-xl outline-none focus:border-[#70FC8E]"
              onKeyDown={(e) => e.key === "Enter" && handleAISend()}
            />
            <button
              onClick={handleAISend}
              className="bg-[#70FC8E] hover:bg-[#5be277] text-slate-950 font-black px-4 rounded-xl text-lg flex items-center justify-center transition"
            >
              →
            </button>
          </div>
        </div>

        {/* Table Container */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden flex flex-col">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 font-mono pb-3 border-b border-slate-100 mb-4 flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-900">
              <MapPin className="h-5 w-5" style={{ fill: "#70FC8E" }} />{" "}
              Конструктор плеч маршрута
            </span>
            <select
              value={globalDirection}
              onChange={handleGlobalDirectionChange}
              className="ml-4 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black outline-none w-36"
            >
              {directions.map((d) => (
                <option key={d.id} value={d.name}>
                  {d.name}
                </option>
              ))}
            </select>
          </h2>

          {/* Swipe Help Badge for Mobile */}
          <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-center uppercase tracking-wider select-none">
            <span className="inline-block text-[#0f7632] mr-1.5 font-sans">
              ↔
            </span>{" "}
            Смайните таблицу вправо для ввода км, ставок фрахта, коэффициентов и
            управления плечами
          </div>

          <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
            <table className="w-full min-w-[950px] border-collapse relative">
              <thead className="bg-slate-50/50">
                <tr>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left rounded-tl-xl w-8">
                    #
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-32">
                    Откуда
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-32">
                    Куда
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">
                    Доезд км
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">
                    Пробег км
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">
                    Ставка €
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">
                    Инфо ставка
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-20">
                    Валюта
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-48">
                    Паром
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-16">
                    Коэф.
                  </th>
                  <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-right rounded-tr-xl w-24">
                    Действия
                  </th>
                </tr>
              </thead>
              <tbody className="space-y-2">
                {legs.map((leg, idx) => (
                  <tr
                    key={idx}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition"
                  >
                    <td className="p-2 text-xs font-black text-slate-400">
                      {idx + 1}
                    </td>
                    <td className="p-2">
                      <input
                        list="cities-datalist"
                        value={leg.from}
                        onChange={(e) =>
                          updateLeg(idx, { from: e.target.value })
                        }
                        onBlur={() => handleCityBlur(idx)}
                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        list="cities-datalist"
                        value={leg.to}
                        onChange={(e) => updateLeg(idx, { to: e.target.value })}
                        onBlur={() => handleCityBlur(idx)}
                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        value={leg.emptyRun || ""}
                        onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
                      />
                    </td>
                    <td className="p-2">
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
                            checkManualDistanceUpdate(
                              leg.from,
                              leg.to,
                              Number(e.target.value),
                            )
                          }
                          className="w-full pl-2 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
                        />
                        <button
                          type="button"
                          onClick={() =>
                            openMapRouteModal(idx, leg.from, leg.to)
                          }
                          title="Показать карту и рассчитать расстояние"
                          className="absolute right-1 text-slate-400 hover:text-blue-500 hover:bg-slate-100 p-1 rounded-md transition"
                        >
                          <MapPin className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        value={leg.freight || ""}
                        onChange={(e) =>
                          updateLeg(idx, { freight: Number(e.target.value) })
                        }
                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
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
                        className="w-full pr-8 px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
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
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition p-1"
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
                        className="w-full px-1 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none leading-tight overflow-hidden text-ellipsis"
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
                          className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none"
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
                            className="w-full px-2 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg text-[10px] font-black outline-none"
                          />
                        )}
                      </div>
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
                        className="w-full px-1 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none text-center"
                      />
                    </td>
                    <td className="p-2 text-right space-x-1 whitespace-nowrap">
                      <button
                        onClick={() => addLegRowAfter(idx)}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => removeLeg(idx)}
                        disabled={legs.length <= 1}
                        className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 transition disabled:opacity-30"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Multi-Leg save template helper */}
          <div className="mt-4 flex justify-end gap-2">
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
                  },
                ])
              }
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition"
            >
              Сбросить
            </button>
            <button
              onClick={saveCurrentAsTemplate}
              className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1 transition"
            >
              <Save className="h-3 w-3" /> Шаблонизировать текущий вид
            </button>
            {user.permissions.dohod === "write" && (
              <button
                onClick={saveCalculation}
                className="flex items-center justify-center gap-2 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] text-xs font-black px-5 py-2.5 rounded-xl transition cursor-pointer border border-black"
              >
                <Save className="h-4 w-4" /> Сохранить расчет
              </button>
            )}
          </div>
        </div>

        {/* Total Stats Banner - Vertical Panel */}
        <div className="bg-slate-950 rounded-[2rem] p-6 lg:p-8 text-white shadow-xs space-y-6 border border-slate-800 flex flex-col sticky top-6">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-[#70FC8E] font-mono flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-[#70FC8E]" /> Экономика рейса
          </h2>
          <div className="flex flex-col gap-4">
            <div className="border-b border-slate-800 pb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-mono font-black mb-0.5">
                Общий пробег
              </span>
              <span className="text-2xl font-black tracking-tighter inline-block font-mono">
                {totalKm.toLocaleString("ru-RU")} км
              </span>
            </div>
            <div className="border-b border-slate-800 pb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-mono font-black mb-0.5">
                Общий Фрахт
              </span>
              <span className="text-2xl font-black tracking-tighter text-white inline-block font-mono">
                {totalFreight.toLocaleString("ru-RU")} €
              </span>
            </div>
            <div className="border-b border-slate-800 pb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-mono font-black mb-0.5">
                Расходы ({globalDirection})
              </span>
              <span className="text-2xl font-black tracking-tighter text-amber-500 inline-block font-mono">
                {totalExpenses.toLocaleString("ru-RU")} €
              </span>
            </div>
            <div
              className={`mt-2 border p-5 rounded-2xl ${totalProfit > 2000 ? "border-[#70FC8E]/50 bg-[#70FC8E]/10" : "border-rose-500/50 bg-rose-500/10"}`}
            >
              <span
                className={`text-[10px] uppercase tracking-widest block font-mono font-black ${totalProfit > 2000 ? "text-[#70FC8E]/80" : "text-rose-400"}`}
              >
                Чистая прибыль
              </span>
              <span
                className={`text-4xl font-black tracking-tighter mt-1 block font-mono ${totalProfit > 2000 ? "text-[#70FC8E]" : "text-rose-500"}`}
              >
                {totalProfit.toLocaleString("ru-RU")} €
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Right Sidebar Workspace */}
      <div className="xl:col-span-4 space-y-6">
        {/* Custom Currency Converter Widget */}
        <div
          id="nbrb-converter-widget"
          className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] relative overflow-hidden"
        >
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 select-none">
            <h2 className="text-xs font-black uppercase text-slate-800 tracking-tight flex items-center gap-1.5 font-mono">
              🏦 Конвертер валют НБ РБ
            </h2>
            <span className="text-[9px] font-black uppercase tracking-wider text-[#70FC8E] bg-slate-950 px-2 py-0.5 rounded-md">
              API NBRB.BY
            </span>
          </div>

          <div className="flex overflow-x-auto custom-scrollbar items-center gap-2 mb-4 bg-slate-50 border border-slate-200/60 p-3 rounded-2xl text-[10px] font-mono select-none whitespace-nowrap">
            <span className="text-slate-400 font-bold uppercase tracking-wider shrink-0 mr-2">
              Курсы НБ РБ:
            </span>
            <span className="text-slate-800 font-black shrink-0">
              1 USD = {(nbrbRates["USD"]?.rate || 3.25).toFixed(4)}
            </span>
            <span className="text-slate-800 font-black shrink-0">
              1 EUR = {(nbrbRates["EUR"]?.rate || 3.55).toFixed(4)}
            </span>
            <span className="text-slate-800 font-black shrink-0">
              100 RUB = {(nbrbRates["RUB"]?.rate || 3.42).toFixed(4)}
            </span>
            <span className="text-slate-800 font-black shrink-0">
              10 TRY = {(nbrbRates["TRY"]?.rate || 1.0).toFixed(4)}
            </span>
            <span className="text-slate-800 font-black shrink-0">
              10 CNY = {(nbrbRates["CNY"]?.rate || 4.5).toFixed(4)}
            </span>
          </div>

          <div className="w-full bg-slate-50 rounded-2xl p-5 border border-slate-200/60 flex flex-col gap-3 h-[450px] overflow-y-auto custom-scrollbar">
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
                className="flex items-center w-full bg-white border border-slate-200 rounded-xl overflow-hidden focus-within:border-blue-500 shadow-sm transition"
              >
                <div className="bg-slate-100/80 flex-shrink-0 px-4 py-3 border-r border-slate-200 font-black text-slate-700 min-w-[85px] text-center select-none flex items-center justify-center gap-2 text-sm">
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
                  className="w-full bg-transparent px-4 py-3 text-right text-base font-black text-slate-800 outline-none placeholder:text-slate-300"
                />
              </div>
            ))}
          </div>

          <p className="text-[9px] text-slate-400 mt-4 font-mono leading-tight uppercase font-medium">
            *Курсы обновляются автоматически с открытого API НБ РБ
          </p>
        </div>

        {/* Profit per Day Widget / Calendar */}
        <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] relative overflow-hidden">
          <h2 className="text-sm font-black uppercase text-slate-800 tracking-tight mb-2">
            Доходность проекта
          </h2>
          <p className="text-[10px] text-slate-500 mb-4 leading-relaxed tracking-wide">
            Рассчитайте среднюю прибыль за каждый день в рейсе. Заполните даты
            старта и завершения поездки.
          </p>

          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 mb-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-500 uppercase font-mono">
                Старт:
              </span>
              <input
                type="date"
                value={tripStartDate}
                onChange={(e) => setTripStartDate(e.target.value)}
                className="bg-white px-2 py-2 text-sm font-bold rounded border border-slate-200 outline-none focus:border-[#0f7632]"
              />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-xs font-black text-slate-500 uppercase font-mono">
                Завершение:
              </span>
              <input
                type="date"
                value={tripEndDate}
                onChange={(e) => setTripEndDate(e.target.value)}
                className="bg-white px-2 py-2 text-sm font-bold rounded border border-slate-200 outline-none focus:border-[#0f7632]"
              />
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 mt-1">
              <span className="text-sm font-black text-slate-800">
                Дней в рейсе:
              </span>
              <input
                type="number"
                min="1"
                value={tripDays}
                onChange={(e) => setTripDays(Number(e.target.value))}
                className="bg-transparent text-right w-16 text-lg font-black outline-none border-b border-transparent focus:border-slate-300"
              />
            </div>
          </div>

          <div
            className={`text-center py-5 rounded-2xl text-4xl font-black tracking-tighter ${currentDailyProfit > 200 ? "bg-[#70FC8E]/20 text-[#143e1d]" : "bg-rose-50 text-rose-600"}`}
          >
            {Math.round(currentDailyProfit).toLocaleString("ru-RU")} €
            <span className="block text-[10px] uppercase font-mono font-black mt-1 opacity-50">
              за сутки
            </span>
          </div>
        </div>

        {/* Templates Board */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] transition-all hover:shadow-[0_12px_40px_rgba(0,0,0,0.02)]">
          <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4 pb-4 border-b border-slate-100 mb-6">
            <div>
              <h2 className="text-base font-black uppercase text-slate-950 font-sans tracking-tight flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                  <FileSpreadsheet className="h-5 w-5" />
                </div>
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
                className="text-xs px-3.5 pl-9 py-2 bg-slate-50 border border-slate-200/80 rounded-xl outline-none font-bold text-slate-700 focus:border-emerald-500 focus:bg-white transition w-full sm:w-56"
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
                    className="group bg-white hover:bg-slate-50/50 border border-slate-200/80 hover:border-emerald-300 rounded-[1.5rem] p-5 flex flex-col gap-4 transition-all duration-200 hover:shadow-md"
                  >
                    {/* Top Row: Info and Actions */}
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-3 border-b border-slate-100/80">
                      {/* Left: Icon, Name and Badges */}
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="p-2.5 rounded-xl bg-emerald-50 text-emerald-600 shrink-0">
                          <FolderOpen className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <h4 className="font-extrabold text-sm text-slate-900 truncate" title={t.name}>
                            {t.name}
                          </h4>
                          <div className="flex items-center gap-2 mt-1">
                            {t.globalDir && (
                              <span className="text-[9px] bg-emerald-50 text-emerald-700 font-black uppercase px-2 py-0.5 rounded-md border border-emerald-100/60 font-mono">
                                {t.globalDir}
                              </span>
                            )}
                            <span className="text-[9px] bg-slate-100 text-slate-600 font-black uppercase px-2 py-0.5 rounded-md font-mono">
                              {t.legs?.length || 0} {t.legs?.length === 1 ? 'плечо' : t.legs?.length < 5 ? 'плеча' : 'плеч'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Right: Total Distance and Buttons */}
                      <div className="flex items-center justify-between md:justify-end gap-5 shrink-0">
                        <div className="text-left md:text-right md:mr-2">
                          <span className="text-[9px] text-slate-400 font-black uppercase tracking-wider block font-mono">
                            Общий пробег
                          </span>
                          <span className="text-slate-900 font-mono font-black text-xs md:text-sm">
                            {totalDist.toLocaleString("ru-RU")} км
                          </span>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => loadTemplate(t)}
                            className="bg-slate-950 hover:bg-[#0f7632] text-white text-[10px] font-black tracking-widest py-2.5 px-4 rounded-xl transition-all duration-150 uppercase flex items-center gap-1.5 shadow-sm cursor-pointer active:scale-95"
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
                              className="text-rose-500 hover:bg-rose-50 hover:text-rose-600 p-2.5 rounded-xl transition cursor-pointer active:scale-95"
                              title="Удалить шаблон"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Bottom Row: Legs Timeline Flow (Full Width, beautifully styled) */}
                    <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-100/85">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-xs font-bold text-slate-700 w-full">
                        {(t.legs || []).map((l, i) => (
                          <div key={i} className="flex items-center gap-2">
                            {i > 0 && (
                              <span className="text-slate-300 font-bold text-[11px] select-none px-0.5">&rarr;</span>
                            )}
                            <span className="bg-white px-3 py-1.5 rounded-xl border border-slate-200/50 text-[10px] sm:text-[11px] font-extrabold text-slate-800 flex items-center gap-2 shadow-2xs hover:border-emerald-300 hover:shadow-xs transition duration-150">
                              <span className="truncate max-w-[100px] sm:max-w-[140px] text-slate-900" title={l.from}>{l.from || "?"}</span>
                              <span className="text-slate-300 font-normal select-none">&bull;</span>
                              <span className="truncate max-w-[100px] sm:max-w-[140px] text-slate-700" title={l.to}>{l.to || "?"}</span>
                              <span className="text-[9px] text-[#0f7632] font-mono font-black bg-emerald-50 px-1.5 py-0.5 rounded-md border border-emerald-100/40 ml-1 shrink-0">
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
              <div className="py-12 text-center text-sm text-slate-400 font-bold bg-slate-50 border border-dashed border-slate-200 rounded-2xl">
                Шаблоны не найдены. Создайте первый шаблон, нажав кнопку выше.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* History of Saved Calculations - FULL WIDTH BOTTOM */}
      <div className="xl:col-span-12">
        <div className="bg-white rounded-[2rem] p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col">
          <div className="flex flex-col gap-4 border-b border-slate-100 pb-5 mb-6">
            <div className="flex justify-between items-center">
              <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" /> Журнал расчетов
              </h2>
            </div>
            <input
              type="text"
              placeholder="Поиск по направлениям, дате, логисту..."
              value={historySearch}
              onChange={(e) => setHistorySearch(e.target.value)}
              className="text-xs font-bold px-4 py-3.5 w-full bg-slate-50 border border-slate-200/60 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
            />
          </div>

          {/* Directions Tabs */}
          <div className="flex flex-wrap gap-2 mb-6 bg-slate-50 p-2 rounded-2xl border border-slate-100">
            <button
              onClick={() => setActiveHistoryDirectionTab("Все")}
              className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                activeHistoryDirectionTab === "Все"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
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
                  className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all ${
                    activeHistoryDirectionTab === dir
                      ? "bg-blue-600 text-white shadow-sm"
                      : "text-slate-500 hover:text-slate-900 hover:bg-slate-100"
                  }`}
                >
                  {dir} ({count})
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto pr-1 space-y-2 pb-4 custom-scrollbar max-h-[600px]">
            {filteredHistory.map((calc) => {
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
                  key={calc.id}
                  className="p-6 bg-white rounded-2xl border border-slate-200/80 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col group hover:border-slate-300 transition"
                >
                  <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-100">
                    <div className="flex flex-col gap-1 overflow-hidden">
                      <div className="text-sm font-black text-slate-900 truncate uppercase mt-0.5 tracking-tight">
                        {routeTitle || "Без названия"}
                      </div>
                      <div className="text-[10px] font-mono text-slate-400 uppercase tracking-widest">
                        {calc.datetime} · Направление:{" "}
                        {calc.globalDirection || "Не указано"} · Логист:{" "}
                        {calc.username || calc.logist || "Система"}
                      </div>
                    </div>
                    <div className="flex gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                      <button
                        title="Дублировать в форму"
                        onClick={() => copyHistoryToForm(calc)}
                        className="text-slate-400 hover:text-green-600 hover:bg-slate-50 p-2 rounded-xl transition"
                      >
                        <Copy className="h-4.5 w-4.5" />
                      </button>
                      <button
                        title="Изменить"
                        onClick={() => openEditCalcModal(calc)}
                        className="text-slate-400 hover:text-emerald-500 hover:bg-slate-50 p-2 rounded-xl transition"
                      >
                        <Edit className="h-4.5 w-4.5" />
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
                          className="text-slate-400 hover:text-rose-600 hover:bg-rose-50 p-2 rounded-xl transition"
                        >
                          <Trash2 className="h-4.5 w-4.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Accented metrics block (bento style) */}
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                    <div className="bg-[#70FC8E]/10 border border-[#70FC8E]/30 p-3.5 rounded-2xl flex flex-col justify-between">
                      <span className="text-[8px] font-black uppercase tracking-widest text-[#154620] font-mono mb-1">
                        Доход (Чистый)
                      </span>
                      <span className="text-base font-black text-[#154620] font-mono tracking-tight">
                        {Math.round(profitValue).toLocaleString("ru-RU")}{" "}
                        <span className="text-[10px] font-normal">€</span>
                      </span>
                    </div>

                    <div className="bg-blue-50/50 border border-blue-105 p-3.5 rounded-2xl flex flex-col justify-between">
                      <span className="text-[8px] font-black uppercase tracking-widest text-blue-700 font-mono mb-1">
                        Доход в день
                      </span>
                      <span className="text-base font-black text-blue-800 font-mono tracking-tight">
                        {Math.round(dailyProfitValue).toLocaleString("ru-RU")}{" "}
                        <span className="text-[10px] font-normal">€/дн</span>
                      </span>
                    </div>

                    <div className="bg-amber-50/50 border border-amber-105 p-3.5 rounded-2xl flex flex-col justify-between">
                      <span className="text-[8px] font-black uppercase tracking-widest text-amber-700 font-mono mb-1">
                        Количество дней
                      </span>
                      <span className="text-base font-black text-amber-800 font-mono tracking-tight">
                        {daysValue}{" "}
                        <span className="text-[10px] text-amber-600 font-normal">
                          дн.
                        </span>
                      </span>
                    </div>

                    <div className="bg-slate-50 border border-slate-200/60 p-3.5 rounded-2xl flex flex-col justify-between">
                      <span className="text-[8px] font-black uppercase tracking-widest text-slate-500 font-mono mb-1">
                        Километраж
                      </span>
                      <span className="text-base font-black text-slate-800 font-mono tracking-tight">
                        {Math.round(totalKmValue).toLocaleString("ru-RU")}{" "}
                        <span className="text-[10px] text-slate-500 font-normal">
                          км
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Visual rendering of calculation legs steps inside drop list */}
                  <div className="mt-2 border-t border-slate-100 pt-3">
                    <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono block mb-2">
                      Детализация по плечам
                    </span>
                    <div className="space-y-1.5">
                      {calc.legs.map((l, i) => (
                        <div
                          key={i}
                          className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-3 bg-slate-55 border border-slate-100 rounded-xl hover:border-slate-200 transition text-[11px] font-bold text-slate-600 font-sans"
                        >
                          <div className="flex items-center gap-2">
                            <span className="bg-slate-900 text-[#70FC8E] px-2 py-0.5 rounded text-[8px] font-black uppercase tracking-widest font-mono">
                              Плечо {i + 1}
                            </span>
                            <span
                              className="text-slate-900 uppercase font-extrabold tracking-tight"
                              title={`${l.from || "?"} ➔ ${l.to || "?"}`}
                            >
                              {l.from || "?"} &rarr; {l.to || "?"}
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 text-slate-400 text-[10px] font-mono justify-end">
                            <span>
                              Расстояние:{" "}
                              <strong className="text-slate-700">
                                {Math.round(
                                  l.dist || l.distance || 0,
                                ).toLocaleString("ru-RU")}{" "}
                                км
                              </strong>
                            </span>
                            {Number(l.coeff || 0) > 0 && (
                              <span>
                                Коэфф:{" "}
                                <strong className="text-slate-700">
                                  {l.coeff}
                                </strong>
                              </span>
                            )}
                            {Number(l.freight || 0) > 0 && (
                              <span>
                                Ставка:{" "}
                                <strong className="text-emerald-600">
                                  {Math.round(l.freight).toLocaleString(
                                    "ru-RU",
                                  )}{" "}
                                  €
                                </strong>
                              </span>
                            )}
                            {Number(l.infoRate || 0) > 0 && (
                              <span>
                                Инфо ставка:{" "}
                                <strong className="text-blue-600 font-extrabold">
                                  {Math.round(l.infoRate || 0).toLocaleString(
                                    "ru-RU",
                                  )}{" "}
                                  {l.infoCurrency || "USD"}
                                </strong>
                              </span>
                            )}
                            {Number(l.ferryCost || 0) > 0 && (
                              <span>
                                Паром:{" "}
                                <strong className="text-rose-600">
                                  {Math.round(l.ferryCost).toLocaleString(
                                    "ru-RU",
                                  )}{" "}
                                  €
                                </strong>
                              </span>
                            )}
                            {Number(l.otherExpenses || 0) > 0 && (
                              <span>
                                Доп:{" "}
                                <strong className="text-rose-600">
                                  {Math.round(l.otherExpenses).toLocaleString(
                                    "ru-RU",
                                  )}{" "}
                                  €
                                </strong>
                              </span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
            {calculationHistory.length === 0 && (
              <div className="text-center text-slate-400 text-sm font-mono font-black py-8 uppercase tracking-widest">
                Журнал пуст
              </div>
            )}
          </div>
        </div>
      </div>

      {conversionDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl border border-slate-200 p-6 lg:p-8 space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                <Sparkles className="h-6 w-6 animate-pulse" />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 font-mono">
                  Автоконвертация НБ РБ
                </h3>
                <p className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-0.5">
                  Курсы валют в реальном времени
                </p>
              </div>
            </div>

            <p className="text-xs text-slate-600 font-extrabold leading-relaxed">
              Вы указали инфо-ставку{" "}
              <span className="text-slate-900 underline font-black">
                {conversionDialog.infoRate} {conversionDialog.infoCurrency}
              </span>
              . Хотите автоматически сконвертировать её в евро для «Ставки €»
              плеча #{conversionDialog.index + 1}?
            </p>

            <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/60 font-mono text-center">
              <div className="border-r border-slate-200">
                <span className="block text-[8px] font-black text-slate-400 uppercase tracking-widest">
                  Инфо Ставка
                </span>
                <span className="text-sm font-black text-slate-700 mt-1 block">
                  {conversionDialog.infoRate} {conversionDialog.infoCurrency}
                </span>
              </div>
              <div>
                <span className="block text-[8px] font-black text-emerald-500 uppercase tracking-widest">
                  Результат (€)
                </span>
                <span className="text-sm font-black text-emerald-600 mt-1 block">
                  {conversionDialog.proposedFreight} €
                </span>
              </div>
            </div>

            <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between px-1">
              <span>Курс {conversionDialog.infoCurrency}/EUR (НБ РБ):</span>
              <span className="font-extrabold text-slate-600">
                {(
                  nbrbRates[conversionDialog.infoCurrency]?.rate /
                  nbrbRates[conversionDialog.infoCurrency]?.scale /
                  (nbrbRates["EUR"]?.rate || 1)
                ).toFixed(5)}
              </span>
            </div>

            <div className="flex gap-2.5 pt-2">
              <button
                onClick={dismissConversion}
                className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-wider rounded-xl transition cursor-pointer"
              >
                Пропустить
              </button>
              <button
                onClick={applyConversion}
                className="flex-1 py-3 px-4 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] font-black text-xs uppercase tracking-wider rounded-xl transition border border-black cursor-pointer flex items-center justify-center gap-1.5 shadow-xs"
              >
                Применить
              </button>
            </div>
          </div>
        </div>
      )}

      {mapModalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col pt-1">
            <div className="px-6 py-5 border-b border-slate-100 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-50 text-blue-600 p-2 rounded-xl">
                    <MapPin className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">
                      Интерактивный Расчет Маршрута
                    </h3>
                    <div className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-widest">
                      Проверка расстояния с авто-калькуляцией
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setMapModalOpen(false)}
                  className="w-10 h-10 rounded-full bg-slate-50 text-slate-500 hover:bg-slate-100 flex items-center justify-center transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4"></div>

              {/* Intermediate Waypoints */}
              <div className="mt-3 bg-slate-50/50 p-4 rounded-2xl border border-dashed border-slate-200/80 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">
                    Промежуточные точки{" "}
                    {mapWaypoints.length > 0 ? `(${mapWaypoints.length})` : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => setMapWaypoints([...mapWaypoints, ""])}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-700 flex items-center gap-1.5 transition cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Добавить точку</span>
                  </button>
                </div>

                {mapWaypoints.length > 0 && (
                  <div className="space-y-2 mt-1">
                    {mapWaypoints.map((wp, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 animate-fade-in group bg-white p-1.5 rounded-xl border border-slate-100"
                        draggable={true}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(
                            "text/plain",
                            index.toString(),
                          );
                        }}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          const fromIndex = parseInt(
                            e.dataTransfer.getData("text/plain"),
                            10,
                          );
                          if (!isNaN(fromIndex) && fromIndex !== index) {
                            handleMoveWaypoint(fromIndex, index);
                          }
                        }}
                      >
                        <div
                          className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-1 transition"
                          title="Перетащить"
                        >
                          <GripVertical className="w-3.5 h-3.5" />
                        </div>
                        <span className="text-[10px] font-bold text-slate-400 font-mono min-w-[15px]">
                          {index + 1}.
                        </span>
                        <input
                          type="text"
                          value={wp}
                          onChange={(e) => {
                            const newWps = [...mapWaypoints];
                            newWps[index] = e.target.value;
                            setMapWaypoints(newWps);
                          }}
                          placeholder="Введите населённый пункт..."
                          className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                        />
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => {
                              const newWps = [...mapWaypoints];
                              newWps.splice(index + 1, 0, "");
                              setMapWaypoints(newWps);
                            }}
                            className="p-1 text-blue-500 hover:text-blue-700 transition cursor-pointer"
                            title="Добавить точку после этой"
                          >
                            <Plus className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === 0}
                            onClick={() => handleMoveWaypoint(index, index - 1)}
                            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition cursor-pointer"
                            title="Переместить вверх"
                          >
                            <ChevronUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={index === mapWaypoints.length - 1}
                            onClick={() => handleMoveWaypoint(index, index + 1)}
                            className="p-1 text-slate-400 hover:text-slate-600 disabled:opacity-30 transition cursor-pointer"
                            title="Переместить вниз"
                          >
                            <ChevronDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const newWps = mapWaypoints.filter(
                                (_, idx) => idx !== index,
                              );
                              setMapWaypoints(newWps);
                            }}
                            className="p-1 text-[#70FC8E] bg-slate-900 border border-slate-700/50 hover:bg-slate-800 transition rounded-lg hover:text-rose-50 cursor-pointer ml-1"
                            title="Удалить"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Пункт Отправления (Откуда)
                  </label>
                  <input
                    type="text"
                    value={mapOrigin}
                    onChange={(e) => setMapOrigin(e.target.value)}
                    className="w-full bg-slate-50 text-slate-800 font-bold border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-blue-500 focus:bg-white transition"
                    placeholder="Начните вводить город..."
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Пункт Назначения (Куда)
                  </label>
                  <input
                    type="text"
                    value={mapDestination}
                    onChange={(e) => setMapDestination(e.target.value)}
                    className="w-full bg-slate-50 text-slate-800 font-bold border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-blue-500 focus:bg-white transition"
                    placeholder="Начните вводить город..."
                  />
                </div>
              </div>
            </div>

            <div className="relative h-[380px] md:h-[450px] w-full bg-slate-100 border-b border-slate-100">
              {mapOrigin && mapDestination ? (
                <BelarusMap
                  origin={mapOrigin}
                  destination={mapDestination}
                  waypoints={mapWaypoints}
                  onDistance={setMapKmResult}
                  onOriginChange={setMapOrigin}
                  onDestinationChange={setMapDestination}
                  onWaypointsChange={setMapWaypoints}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-400 font-bold text-xs uppercase tracking-wider">
                  Введите пункты отправления и назначения для прокладки маршрута
                </div>
              )}
            </div>

            <div className="p-6 bg-slate-50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider font-mono">
                    Расстояние маршрута:
                  </span>
                  <span
                    className={`text-xl font-black ${mapKmResult > 0 ? "text-blue-600" : "text-slate-400"}`}
                  >
                    {mapKmResult > 0
                      ? `${mapKmResult} км`
                      : "Рассчитывается..."}
                  </span>
                </div>

                <label className="flex items-center gap-2 cursor-pointer select-none border border-slate-200 rounded-xl px-3.5 py-2.5 bg-white shadow-xs hover:bg-slate-100 transition">
                  <input
                    type="checkbox"
                    checked={saveToDirectoryChecked}
                    onChange={(e) =>
                      setSaveToDirectoryChecked(e.target.checked)
                    }
                    className="w-4 h-4 rounded text-blue-600 border-slate-300 focus:ring-blue-500"
                  />
                  <span className="text-xs font-black text-slate-700">
                    Сохранить также в справочник
                  </span>
                </label>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setMapModalOpen(false)}
                  className="px-6 py-3 rounded-xl font-black text-xs uppercase text-slate-500 hover:bg-slate-200 transition"
                >
                  Отмена
                </button>
                <button
                  onClick={applyMapRoute}
                  disabled={mapKmResult === 0}
                  className={`px-8 py-3 rounded-xl font-black text-xs uppercase transition shadow-sm ${mapKmResult > 0 ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-400 cursor-not-allowed"}`}
                >
                  Применить пробег
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editingCalcId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl border border-slate-200">
            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-[2rem]">
              <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <Edit className="w-5 h-5 text-emerald-500" /> Редактирование
                Калькуляции
              </h3>
              <button
                onClick={closeEditCalcModal}
                className="text-slate-400 hover:text-slate-600 bg-white shadow-sm border border-slate-200 w-8 h-8 rounded-full flex items-center justify-center font-bold"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
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
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
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
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
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
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
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
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">
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
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50 rounded-b-[2rem]">
              <button
                onClick={closeEditCalcModal}
                className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-sm font-mono uppercase tracking-widest shadow-sm"
              >
                Отмена
              </button>
              <button
                onClick={saveEditCalcModal}
                className="px-6 py-3 rounded-xl font-bold text-slate-950 bg-[#70FC8E] hover:bg-[#5ceb7d] transition flex items-center justify-center gap-2 border border-black/10 shadow-sm text-sm font-mono uppercase tracking-widest cursor-pointer"
              >
                Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

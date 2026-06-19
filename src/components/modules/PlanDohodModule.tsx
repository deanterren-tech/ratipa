import React, { useState, useEffect, useRef } from "react";
import {
  UserProfile,
  TripPlan,
  LegPlan,
  DirectionPreset,
  DistancePreset,
  DISPATCHER_COLORS_PRESETS,
  PotentialLoad,
  CurrencyPreset,
} from "../../types";
import { dbService } from "../../firebase";
import { pdService } from "../../firebase/planDohodService";
import {
  Plus,
  Trash2,
  Save,
  MapPin,
  Calculator,
  TrendingUp,
  Archive,
  History,
  Check,
  X,
  BookOpen,
  Minus,
  Bot,
  Search,
} from "lucide-react";
import {
  APIProvider,
  Map,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";

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
  onOriginChange,
  onDestinationChange,
  onWaypointsChange,
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
  onOriginChange?: (addr: string) => void;
  onDestinationChange?: (addr: string) => void;
  onWaypointsChange?: (wps: string[]) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary("routes");
  const [debouncedOrigin, setDebouncedOrigin] = useState(origin);
  const [debouncedDestination, setDebouncedDestination] = useState(destination);
  const rendererRef = useRef<google.maps.DirectionsRenderer | null>(null);
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
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
      if ((p as any)._listeners) {
        (p as any)._listeners.forEach((l: any) =>
          google.maps.event.removeListener(l),
        );
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

    // Helper setup function to build draggable & interactive polylines/markers
    const setupInteractiveRoute = (
      polylinePath: google.maps.LatLngLiteral[],
      validCoords: google.maps.LatLng[],
      initialDistanceKm: number,
    ) => {
      if (!active) return;

      const line = new google.maps.Polyline({
        path: polylinePath,
        geodesic: true,
        strokeColor: "#3b82f6",
        strokeWeight: 6,
        map: map,
        editable: false,
        draggable: false,
      });
      polylinesRef.current.push(line);

      // Listen for path modifications
      const path = line.getPath();
      const onPathChanged = () => {
        let totalMeters = 0;
        for (let idx = 0; idx < path.getLength() - 1; idx++) {
          const p1 = path.getAt(idx);
          const p2 = path.getAt(idx + 1);
          const R = 6371e3; // Earth radius in meters
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
        const updatedKm = Math.round(totalMeters / 1000);
        onDistance(updatedKm);
      };

      const setAtListener = google.maps.event.addListener(
        path,
        "set_at",
        onPathChanged,
      );
      const insertAtListener = google.maps.event.addListener(
        path,
        "insert_at",
        onPathChanged,
      );
      const removeAtListener = google.maps.event.addListener(
        path,
        "remove_at",
        onPathChanged,
      );
      (line as any)._listeners = [
        setAtListener,
        insertAtListener,
        removeAtListener,
      ];

      // Draw markers with drag support
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
          draggable: true,
        });

        m.addListener("dragend", async () => {
          const newPos = m.getPosition();
          if (!newPos) return;

          try {
            const res = await fetch(
              `/api/reverse-geocode?lat=${newPos.lat()}&lng=${newPos.lng()}`,
            );
            if (res.ok) {
              const data = await res.json();
              if (data && data.address) {
                if (i === 0) {
                  if (onOriginChange) onOriginChange(data.address);
                } else if (i === validCoords.length - 1) {
                  if (onDestinationChange) onDestinationChange(data.address);
                } else {
                  const waypointIndex = i - 1;
                  const newWps = [...waypoints];
                  newWps[waypointIndex] = data.address;
                  if (onWaypointsChange) onWaypointsChange(newWps);
                }
              }
            }
          } catch (err) {
            console.error("Reverse geocoding marker failed:", err);
          }
        });

        fallbackMarkers.push(m);
      });
      (line as any)._fallback_markers = fallbackMarkers;

      onDistance(initialDistanceKm);
    };

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

              // Basic scan for keywords in OpenRouteService response segment names
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

      if (!active) return;

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

      setupInteractiveRoute(polylinePath, validCoords, distanceKm);

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
        console.error("OSRM PlanDohodModule failed:", e);
      }

      if (!active) return;

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

      setupInteractiveRoute(polylinePath, validCoords, distanceKm);

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
      polylinesRef.current.forEach((p) => {
        p.setMap(null);
        if ((p as any)._fallback_markers) {
          (p as any)._fallback_markers.forEach((m: any) => m.setMap(null));
        }
        if ((p as any)._listeners) {
          (p as any)._listeners.forEach((l: any) =>
            google.maps.event.removeListener(l),
          );
        }
      });
      polylinesRef.current = [];
      if (rendererRef.current) {
        rendererRef.current.setMap(null);
      }
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
    onOriginChange,
    onDestinationChange,
    onWaypointsChange,
  ]);

  return null;
}

interface PlanDohodModuleProps {
  user: UserProfile;
}

export default function PlanDohodModule({ user }: PlanDohodModuleProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [tableScale, setTableScale] = useState<number>(() => {
    const saved = localStorage.getItem("pd_table_scale");
    return saved ? Number(saved) : 100;
  });
  const [activeTab, setActiveTab] = useState<"active" | "archive" | "history">(
    "active",
  );
  const [archiveMonth, setArchiveMonth] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalTab, setModalTab] = useState<"main" | "potential">("main");
  const [sortConfig, setSortConfig] = useState<{
    key: string;
    dir: "asc" | "desc";
  } | null>(null);

  // Realtime Data
  const [trips, setTrips] = useState<TripPlan[]>([]);
  const [savedCars, setSavedCars] = useState<string[]>([]);
  const [carDispatcherMapping, setCarDispatcherMapping] = useState<
    Record<string, string>
  >({});

  useEffect(() => {
    const unsub = pdService.subscribeDispatchersCarMapping(
      setCarDispatcherMapping,
    );
    return unsub;
  }, []);

  const handleCarNumberChange = (val: string) => {
    const up = val.toUpperCase();
    setCarNumber(up);
    if (up && carDispatcherMapping[up]) {
      setDispatcher(carDispatcherMapping[up]);
    }
  };
  const [directions, setDirections] = useState<Record<string, number>>({});
  const [distances, setDistances] = useState<any[]>([]);
  const [settings, setSettings] = useState<any>({
    useDistanceLookup: false,
    distanceLookupMode: "cities",
  });
  const [dispatchers, setDispatchers] = useState<string[]>([]);
  const [dispatchersOrder, setDispatchersOrder] = useState<string[]>([]);
  const [dispatchersColors, setDispatchersColors] = useState<
    Record<string, string>
  >({});
  const [currencies, setCurrencies] = useState<any[]>([]); // CurrencyPreset
  const [logs, setLogs] = useState<any[]>([]);
  const [manualTripsOrder, setManualTripsOrder] = useState<string[]>([]);

  // Current filter specific to dispatchers
  const [activeDispatcherTab, setActiveDispatcherTab] = useState<string>("All");
  const [activeDirectionTab, setActiveDirectionTab] = useState<string>("All");

  useEffect(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem("ratipa_plan_trips_order") || "[]",
      );
      if (Array.isArray(saved)) setManualTripsOrder(saved);
    } catch (e) {}

    const unsubTrips = pdService.subscribeTrips(setTrips);
    const unsubCars = pdService.subscribeCars(setSavedCars);
    const unsubDirs = pdService.subscribeDirections(setDirections);
    const unsubDist = pdService.subscribeKnownDistances(setDistances);
    const unsubCurrencies = dbService.getCurrencies(setCurrencies);
    const unsubSet = pdService.subscribePlanDohodSettings(setSettings);
    const unsubColors =
      pdService.subscribeDispatchersColors(setDispatchersColors);
    const unsubDisp = pdService.subscribeDispatchers((disp, order) => {
      setDispatchers(disp);
      setDispatchersOrder(order);
    });
    const unsubLogs = dbService.getAuditLogs((data) => {
      setLogs(data.filter((l) => l.module === "PlanDohod"));
    });
    pdService.setPresence(user.name);

    return () => {
      unsubTrips();
      unsubCars();
      unsubDirs();
      unsubDist();
      unsubCurrencies();
      unsubSet();
      unsubDisp();
      unsubLogs();
      unsubColors();
    };
  }, [user.name]);

  // --- NOTEBOOK STATE & EFFECTS ---
  const [isNotebookOpen, setIsNotebookOpen] = useState<boolean>(() => {
    return localStorage.getItem("ratipa_notebook_visible") !== "false";
  });
  const toggleNotebook = () => {
    setIsNotebookOpen((prev) => {
      const newVal = !prev;
      localStorage.setItem("ratipa_notebook_visible", String(newVal));
      if (newVal) {
        setIsNbMinimized(false);
        localStorage.setItem("ratipa_notebook_minimized", "false");
        setNbCoords((prevCoords) => {
          const w = window.innerWidth;
          const h = window.innerHeight;
          let newX = prevCoords.x;
          let newY = prevCoords.y;
          if (newX > w - 100 || newX < 0) newX = w - 425 > 0 ? w - 425 : 10;
          if (newY > h - 100 || newY < 0) newY = 140;
          const updated = { ...prevCoords, x: newX, y: newY };
          localStorage.setItem(
            "ratipa_notebook_coords",
            JSON.stringify(updated),
          );
          return updated;
        });
      }
      return newVal;
    });
  };

  const [nbCoords, setNbCoords] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  }>(() => {
    const defaultCoords = {
      x: typeof window !== "undefined" ? window.innerWidth - 425 : 800,
      y: 140,
      w: 380,
      h: 540,
    };
    try {
      const saved = localStorage.getItem("ratipa_notebook_coords");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.w > 0 && parsed.h > 0) {
          if (typeof window !== "undefined") {
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (parsed.x > w - 50 || parsed.x < -100)
              parsed.x = defaultCoords.x > 0 ? defaultCoords.x : 10;
            if (parsed.y > h - 50 || parsed.y < -100)
              parsed.y = defaultCoords.y;
          }
          return parsed;
        }
      }
    } catch (e) {}
    return defaultCoords;
  });

  const [isNbMinimized, setIsNbMinimized] = useState<boolean>(() => {
    return localStorage.getItem("ratipa_notebook_minimized") === "true";
  });

  const [nbDragging, setNbDragging] = useState(false);
  const [nbDragOffset, setNbDragOffset] = useState({ x: 0, y: 0 });

  const [nbResizing, setNbResizing] = useState<string | false>(false);
  const [nbResizeStartSize, setNbResizeStartSize] = useState({
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    mouseX: 0,
    mouseY: 0,
  });

  const handleNbDragStart = (e: React.MouseEvent<HTMLDivElement>) => {
    if (
      (e.target as HTMLElement).closest("button") ||
      (e.target as HTMLElement).closest("select") ||
      (e.target as HTMLElement).closest("input") ||
      (e.target as HTMLElement).closest("textarea")
    ) {
      return;
    }
    setNbDragging(true);
    setNbDragOffset({
      x: e.clientX - nbCoords.x,
      y: e.clientY - nbCoords.y,
    });
  };

  const nbCoordsRef = useRef(nbCoords);
  useEffect(() => {
    nbCoordsRef.current = nbCoords;
  }, [nbCoords]);

  useEffect(() => {
    if (!nbDragging) return;
    const handleMouseMove = (e: MouseEvent) => {
      const newX = Math.max(
        10,
        Math.min(window.innerWidth - 100, e.clientX - nbDragOffset.x),
      );
      const newY = Math.max(
        10,
        Math.min(window.innerHeight - 100, e.clientY - nbDragOffset.y),
      );
      setNbCoords((prev) => {
        return { ...prev, x: newX, y: newY };
      });
    };
    const handleMouseUp = () => {
      setNbDragging(false);
      try {
        localStorage.setItem(
          "ratipa_notebook_coords",
          JSON.stringify(nbCoordsRef.current),
        );
      } catch (err) {}
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [nbDragging, nbDragOffset]);

  useEffect(() => {
    if (!nbResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - nbResizeStartSize.mouseX;
      const deltaY = e.clientY - nbResizeStartSize.mouseY;

      let newW = nbResizeStartSize.w;
      let newH = nbResizeStartSize.h;
      let newX = nbResizeStartSize.x;
      let newY = nbResizeStartSize.y;

      if (nbResizing.includes("e")) {
        newW = Math.max(280, nbResizeStartSize.w + deltaX);
      }
      if (nbResizing.includes("s")) {
        newH = Math.max(300, nbResizeStartSize.h + deltaY);
      }
      if (nbResizing.includes("w")) {
        newW = Math.max(280, nbResizeStartSize.w - deltaX);
        if (newW > 280) newX = nbResizeStartSize.x + deltaX;
      }
      if (nbResizing.includes("n")) {
        newH = Math.max(300, nbResizeStartSize.h - deltaY);
        if (newH > 300) newY = nbResizeStartSize.y + deltaY;
      }

      setNbCoords((prev) => {
        return { ...prev, x: newX, y: newY, w: newW, h: newH };
      });
    };
    const handleMouseUp = () => {
      setNbResizing(false);
      try {
        localStorage.setItem(
          "ratipa_notebook_coords",
          JSON.stringify(nbCoordsRef.current),
        );
      } catch (err) {}
    };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [nbResizing, nbResizeStartSize]);

  // Derived state for dispatchers
  const filterDispatchers = dispatchersOrder.filter(
    (d) =>
      d &&
      d.trim() !== "Общая" &&
      d.trim() !== "All" &&
      d.trim() !== "Все" &&
      d.trim() !== "Все диспетчеры",
  );
  const activeDispatchers =
    filterDispatchers.length > 0
      ? ["Все диспетчеры", ...filterDispatchers]
      : [];

  useEffect(() => {
    if (activeDispatchers.length > 0) {
      if (
        !activeDispatchers.includes(activeDispatcherTab) ||
        activeDispatcherTab === "All"
      ) {
        setActiveDispatcherTab(activeDispatchers[0]);
      }
    }
  }, [dispatchersOrder, activeDispatcherTab]);

  const [selectedNotebookUser, setSelectedNotebookUser] = useState<string>(
    user.name,
  );
  const [notebookNotes, setNotebookNotes] = useState<Record<string, string>>(
    {},
  );
  const [notebookOrder, setNotebookOrder] = useState<string[]>([]);
  const [notebookCarInput, setNotebookCarInput] = useState<string>("");

  const [isAdminUser, setIsAdminUser] = useState(false);
  const [isNotebookViewer, setIsNotebookViewer] = useState(false);
  const [highlightedCar, setHighlightedCar] = useState<string | null>(null);

  const [nbrbRates, setNbrbRates] = useState<
    Record<string, { scale: number; rate: number }>
  >({
    BYN: { scale: 1, rate: 1.0 },
    USD: { scale: 1, rate: 3.25 },
    EUR: { scale: 1, rate: 3.5 },
    RUB: { scale: 100, rate: 3.5 },
    KZT: { scale: 1000, rate: 7.2 },
  });

  useEffect(() => {
    fetch("https://api.nbrb.by/exrates/rates?periodicity=0")
      .then((res) => res.json())
      .then((data: any[]) => {
        const updated: Record<string, { scale: number; rate: number }> = {
          BYN: { scale: 1, rate: 1.0 },
          USD: { scale: 1, rate: 3.25 },
          EUR: { scale: 1, rate: 3.5 },
          RUB: { scale: 100, rate: 3.5 },
          KZT: { scale: 1000, rate: 7.2 },
        };
        const mapping: Record<string, string> = {
          USD: "USD",
          EUR: "EUR",
          RUB: "RUB",
          KZT: "KZT",
          PLN: "PLN",
          GBP: "GBP",
          TRY: "TRY",
          CNY: "CNY",
        };
        data.forEach((item) => {
          if (mapping[item.Cur_Abbreviation]) {
            updated[mapping[item.Cur_Abbreviation]] = {
              scale: item.Cur_Scale,
              rate: item.Cur_OfficialRate,
            };
          }
        });
        setNbrbRates(updated);
      })
      .catch(console.warn);
  }, []);

  const calculateEuroFreight = (infoRateRaw: string, currency: string) => {
    // Info rate might contain specific exchange rate like "80000 110"
    const parts = (infoRateRaw || "").trim().split(/\s+/);
    const infoRate = parseFloat(parts[0]) || 0;

    // Explicit exchange rate overrules typical NBRB rates
    if (parts.length > 1) {
      const explicitRate = parseFloat(parts[1]) || 0;
      if (explicitRate > 0) {
        if (currency === "RUB" || currency === "KZT") {
          return Math.round(infoRate / explicitRate);
        } else {
          return Math.round(infoRate * explicitRate);
        }
      }
    }

    if (!infoRate || currency === "EUR") return infoRate || 0;
    const rateX = nbrbRates[currency]
      ? nbrbRates[currency].rate / nbrbRates[currency].scale
      : 0;
    const rateEur = nbrbRates["EUR"] ? nbrbRates["EUR"].rate : 1;
    return rateEur > 0 ? Math.round((infoRate * rateX) / rateEur) : 0;
  };

  useEffect(() => {
    const unsubPermissions = pdService.subscribePermissions(
      user.name,
      (isAdmin, isNotebookViewer) => {
        setIsAdminUser(isAdmin);
        setIsNotebookViewer(isNotebookViewer);
      },
    );
    return () => unsubPermissions();
  }, [user.name]);

  useEffect(() => {
    const unsubNotebook = pdService.subscribeNotebook(
      selectedNotebookUser,
      (notes, order) => {
        setNotebookNotes(notes || {});
        setNotebookOrder(order || []);
      },
    );
    return () => unsubNotebook();
  }, [selectedNotebookUser]);

  const handleNoteChange = (car: string, val: string) => {
    setNotebookNotes((prev) => ({ ...prev, [car]: val }));
    pdService.saveNotebookNote(selectedNotebookUser, car, val);
  };

  const handleAddPresetToNote = (car: string, preset: string) => {
    const currentVal = notebookNotes[car] || "";
    if (currentVal.startsWith(preset) || currentVal.includes(preset)) return;
    const newVal = preset + currentVal;
    handleNoteChange(car, newVal);
  };

  const handleAddCarToNotebook = () => {
    const car = notebookCarInput.trim().toUpperCase();
    if (!car) return;
    pdService.saveNotebookNote(selectedNotebookUser, car, "");
    if (!notebookOrder.includes(car)) {
      const newOrder = [...notebookOrder, car];
      pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
    }
    setNotebookCarInput("");
  };

  const handleRemoveCarFromNotebook = (car: string) => {
    pdService.removeNotebookCar(selectedNotebookUser, car);
    const newOrder = notebookOrder.filter((c) => c !== car);
    pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
  };

  const handleAddMyCarsToNotebook = () => {
    const myCars: string[] = [];
    trips.forEach((trip) => {
      if (
        (trip.logist === user.name || trip.dispatcher === user.name) &&
        trip.carNumber
      ) {
        myCars.push(trip.carNumber.trim().toUpperCase());
      }
    });
    const uniqueCars = Array.from(new Set(myCars));
    if (uniqueCars.length === 0) {
      alert("У вас пока нет оформленных машин в текущем журнале.");
      return;
    }

    const newOrder = [...notebookOrder];
    let addedCount = 0;
    uniqueCars.forEach((car) => {
      if (notebookNotes[car] === undefined) {
        pdService.saveNotebookNote(selectedNotebookUser, car, "");
        if (!newOrder.includes(car)) {
          newOrder.push(car);
        }
        addedCount++;
      }
    });

    if (addedCount === 0) {
      alert("Все ваши машины уже внесены в ваш блокнот.");
    } else {
      pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
      alert(`В блокнот добавлено машин: ${addedCount}`);
    }
  };

  const handleNotebookCarDrop = (e: React.DragEvent, targetCar: string) => {
    const sourceCar = e.dataTransfer.getData("notebookCarId");
    if (!sourceCar || sourceCar === targetCar) return;

    let newOrder = [...notebookOrder];
    if (!newOrder.includes(sourceCar)) newOrder.push(sourceCar);
    if (!newOrder.includes(targetCar)) newOrder.push(targetCar);

    newOrder = newOrder.filter((c) => c !== sourceCar);
    const targetIdx = newOrder.indexOf(targetCar);
    newOrder.splice(targetIdx >= 0 ? targetIdx : newOrder.length, 0, sourceCar);

    setNotebookOrder(newOrder);
    pdService.saveNotebookOrder(selectedNotebookUser, newOrder);
  };

  const renderNotebookWidget = () => {
    console.log("renderNotebookWidget", { isNotebookOpen, nbCoords });
    if (!isNotebookOpen) {
      console.log("Notebook closed");
      return null;
    }

    // All cars that are in order or have notes
    const cars = Array.from(
      new Set([...notebookOrder, ...Object.keys(notebookNotes)]),
    ).filter((car) => notebookNotes[car] !== undefined);

    if (isNbMinimized) {
      return (
        <div className="fixed bottom-4 right-4 z-50">
          <button
            type="button"
            onClick={() => {
              setIsNbMinimized(false);
              localStorage.setItem("ratipa_notebook_minimized", "false");
            }}
            className="bg-amber-500 hover:bg-amber-600 font-sans text-white text-xs font-black uppercase tracking-widest py-3 px-6 rounded-full flex items-center gap-2 shadow-[0_10px_25px_rgba(245,158,11,0.4)] border border-amber-600 transition-all duration-150 transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            <BookOpen size={14} className="animate-bounce" />
            <span>📋 Блокнот ({cars.length})</span>
          </button>
        </div>
      );
    }

    const permittedToSwitch =
      isAdminUser || isNotebookViewer || user.role === "root_admin";
    const notebookUsersList = Array.from(
      new Set([user.name, ...dispatchersOrder.filter((d) => d !== "All")]),
    );

    return (
      <div
        style={{
          position: "fixed",
          left: `${nbCoords.x}px`,
          top: `${nbCoords.y}px`,
          width: `${nbCoords.w}px`,
          height: `${nbCoords.h}px`,
          zIndex: 20000,
        }}
        className="bg-white rounded-[2rem] border border-slate-300 shadow-[0_15px_50px_rgba(0,0,0,0.15)] flex flex-col pointer-events-auto overflow-hidden animate-in fade-in zoom-in-95 duration-150"
      >
        {/* Header Drag Handle */}
        <div
          onMouseDown={handleNbDragStart}
          className="flex items-center justify-between border-b border-slate-100 p-4 bg-slate-50 cursor-grab active:cursor-grabbing select-none"
        >
          <div className="flex items-center gap-2">
            <span className="p-1 px-2.5 bg-yellow-500/10 text-yellow-600 font-black text-[9px] rounded-full uppercase tracking-wider font-mono">
              Блокнот
            </span>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">
              Блокнот по авто
            </h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setIsNbMinimized(true);
                localStorage.setItem("ratipa_notebook_minimized", "true");
              }}
              className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-200 cursor-pointer"
              title="Свернуть"
            >
              <Minus size={15} />
            </button>
            <button
              type="button"
              onClick={() => {
                setIsNotebookOpen(false);
                localStorage.setItem("ratipa_notebook_visible", "false");
              }}
              className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-200 cursor-pointer"
              title="Закрыть"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Inner Content */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3.5 custom-scrollbar pb-6">
          {/* Switcher selector */}
          {permittedToSwitch ? (
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase text-slate-400 font-mono tracking-widest">
                Выбор Блокнота
              </label>
              <select
                value={selectedNotebookUser}
                onChange={(e) => setSelectedNotebookUser(e.target.value)}
                className="p-2 bg-slate-50 text-xs font-bold text-slate-800 rounded-xl border border-slate-200 focus:outline-none"
              >
                {notebookUsersList.map((u) => (
                  <option key={u} value={u}>
                    {u === user.name ? `Мой блокнот (${u})` : u}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-black uppercase text-slate-400 font-mono tracking-widest">
                Ваш Блокнот
              </label>
              <div className="p-2 bg-slate-50 text-xs font-black text-slate-800 rounded-xl border border-slate-200 uppercase font-mono tracking-wider font-bold">
                📝{" "}
                {selectedNotebookUser === user.name
                  ? `Личный блокнот`
                  : `Блокнот: ${selectedNotebookUser}`}
              </div>
              <div className="grid grid-cols-1 gap-1 mt-1">
                <button
                  type="button"
                  onClick={() => setSelectedNotebookUser(user.name)}
                  className={`py-1 px-2 rounded-lg text-[9px] font-black uppercase tracking-wider transition ${selectedNotebookUser === user.name ? "bg-slate-900 text-white shadow-sm" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
                >
                  Мой
                </button>
              </div>
            </div>
          )}

          <div className="text-[9px] font-bold text-slate-500 text-center bg-blue-500/5 py-1 px-2 rounded-xl border border-blue-500/10">
            {selectedNotebookUser === user.name
              ? "Редактируется ваш личный блокнот"
              : `Просмотр блокнота: ${selectedNotebookUser}`}
          </div>

          <div className="flex gap-1.5 border-t border-slate-100 pt-2.5">
            <button
              type="button"
              onClick={handleAddMyCarsToNotebook}
              className="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-800 rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer text-center"
            >
              Внести свои авто
            </button>
          </div>

          {/* Input adding direct car */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Номер авто"
              list="notebook-vehicles-list"
              value={notebookCarInput}
              onChange={(e) => setNotebookCarInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCarToNotebook();
              }}
              className="flex-1 p-2 bg-slate-50 text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] uppercase font-bold text-slate-800"
            />
            <datalist id="notebook-vehicles-list">
              {savedCars.map((car) => (
                <option key={car} value={car} />
              ))}
            </datalist>
            <button
              type="button"
              onClick={handleAddCarToNotebook}
              className="w-8 h-8 bg-slate-950 hover:bg-slate-800 text-white font-black flex items-center justify-center rounded-xl transition cursor-pointer text-base leading-none"
            >
              +
            </button>
          </div>

          {/* Cars list */}
          <div className="space-y-2.5 overflow-y-auto pr-1 custom-scrollbar max-h-[calc(100%-180px)]">
            {cars.map((car) => {
              const valText = notebookNotes[car] || "";
              const isHighlighted = highlightedCar === car;

              return (
                <div
                  key={car}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData("notebookCarId", car);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleNotebookCarDrop(e, car)}
                  className={`bg-slate-50/50 hover:bg-slate-50 border rounded-2xl p-2.5 flex flex-col space-y-1.5 transition group relative cursor-move ${isHighlighted ? "border-blue-500 ring-2 ring-blue-500/20 shadow-md" : "border-slate-200/40 hover:border-slate-300"}`}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={() => {
                        setHighlightedCar(car === highlightedCar ? null : car);
                        setTimeout(() => {
                          const items = Array.from(
                            document.querySelectorAll(".car-strip-item"),
                          );
                          const matchingItem = items.find((el) =>
                            el.textContent?.includes(car),
                          );
                          if (matchingItem) {
                            matchingItem.scrollIntoView({
                              behavior: "smooth",
                              block: "center",
                            });
                          }
                        }, 100);
                      }}
                      className="flex-shrink-0 transition transform hover:scale-102 focus:outline-none focus:ring-0 active:scale-98 cursor-pointer text-left"
                      title="Нажмите, чтобы подсветить рейс"
                    >
                      <div className="flex items-stretch bg-white border border-slate-300 rounded overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.1)] h-6 text-xs font-black select-none">
                        <div className="bg-blue-600 text-white w-3.5 flex flex-col items-center justify-center text-[4px] leading-[5px] font-sans px-0.5">
                          <span className="text-yellow-400 font-extrabold -mb-[1px]">
                            ★
                          </span>
                          <span className="text-yellow-400 font-extrabold -mt-[1px]">
                            ★
                          </span>
                          <span className="font-extrabold text-[5px] tracking-tighter mt-0.5">
                            BY
                          </span>
                        </div>
                        <div className="px-2 flex items-center justify-center text-slate-900 uppercase tracking-tight font-sans text-[10px] font-black leading-none">
                          {car}
                        </div>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => handleRemoveCarFromNotebook(car)}
                      className="text-slate-400 hover:text-rose-500 transition p-1 rounded-lg hover:bg-slate-100 cursor-pointer"
                      title="Удалить машину"
                    >
                      <X size={12} />
                    </button>
                  </div>

                  <textarea
                    value={valText}
                    onChange={(e) => handleNoteChange(car, e.target.value)}
                    onMouseUp={(e) => {
                      const el = e.target as HTMLTextAreaElement;
                      if (el.style.height) {
                        localStorage.setItem(
                          `ratipa_nb_height_${user.name}`,
                          el.style.height,
                        );
                      }
                    }}
                    placeholder="Заметка к авто..."
                    style={{
                      height:
                        localStorage.getItem(`ratipa_nb_height_${user.name}`) ||
                        "auto",
                    }}
                    className="w-full p-2 bg-white text-xs border border-slate-200/60 rounded-xl focus:outline-none placeholder:text-[10px] text-slate-800 font-bold leading-relaxed resize-y focus:border-slate-400 font-sans min-h-[48px]"
                  />
                </div>
              );
            })}

            {cars.length === 0 && (
              <div className="text-center py-8 text-slate-400 text-[10px] font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-200/30">
                Блокнот пуст. Внесите номера авто выше.
              </div>
            )}
          </div>
        </div>

        {/* Resize Handles */}
        {[
          {
            dir: "n",
            cursor: "ns-resize",
            className: "absolute top-0 left-3 right-3 h-2 z-50",
          },
          {
            dir: "s",
            cursor: "ns-resize",
            className: "absolute bottom-0 left-3 right-3 h-2 z-50",
          },
          {
            dir: "w",
            cursor: "ew-resize",
            className: "absolute top-3 bottom-3 left-0 w-2 z-50",
          },
          {
            dir: "e",
            cursor: "ew-resize",
            className: "absolute top-3 bottom-3 right-0 w-2 z-50",
          },
          {
            dir: "nw",
            cursor: "nwse-resize",
            className: "absolute top-0 left-0 w-4 h-4 z-50",
          },
          {
            dir: "ne",
            cursor: "nesw-resize",
            className: "absolute top-0 right-0 w-4 h-4 z-50",
          },
          {
            dir: "sw",
            cursor: "nesw-resize",
            className: "absolute bottom-0 left-0 w-4 h-4 z-50",
          },
          {
            dir: "se",
            cursor: "nwse-resize",
            className:
              "absolute bottom-0 right-0 w-5 h-5 flex items-end justify-end p-1.5 group z-50",
          },
        ].map((handle) => (
          <div
            key={handle.dir}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setNbResizing(handle.dir);
              setNbResizeStartSize({
                x: nbCoords.x,
                y: nbCoords.y,
                w: nbCoords.w,
                h: nbCoords.h,
                mouseX: e.clientX,
                mouseY: e.clientY,
              });
            }}
            className={handle.className}
            style={{ cursor: handle.cursor }}
            title={handle.dir === "se" ? "Растянуть блокнот" : ""}
          >
            {handle.dir === "se" && (
              <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-slate-400 group-hover:border-slate-700 transition-colors pointer-events-none" />
            )}
          </div>
        ))}
      </div>
    );
  };

  // Form State
  const [editingTripId, setEditingTripId] = useState<string | null>(null);
  const [searchCarQuery, setSearchCarQuery] = useState("");
  const [carNumber, setCarNumber] = useState("");
  const [direction, setDirection] = useState("");
  const [dateStart, setDateStart] = useState("");
  const [dateEnd, setDateEnd] = useState("");
  const [extraExpense, setExtraExpense] = useState<number>(0);
  const [extraExpenseNote, setExtraExpenseNote] = useState("");
  const [ferryCost, setFerryCost] = useState(0);
  const [referenceRate, setReferenceRate] = useState<number | undefined>(
    undefined,
  );
  const [referenceCurrency, setReferenceCurrency] = useState<
    "EUR" | "USD" | "RUB" | "BYN"
  >("EUR");
  const [tripNote, setTripNote] = useState("");
  const [stripColor, setStripColor] = useState("bg-blue-500");
  const [factKm, setFactKm] = useState<number | undefined>(undefined);
  const [dispatcher, setDispatcher] = useState("");
  const [currentMonth, setCurrentMonth] = useState("");

  const [activeLegIndex, setActiveLegIndex] = useState<number | undefined>(
    undefined,
  );
  const [legs, setLegs] = useState<LegPlan[]>([
    {
      from: "",
      to: "",
      km: 0,
      rate: 0,
      referenceRate: "",
      ferry: 0,
      coeff: 0,
    },
  ]);
  const [potentialLoads, setPotentialLoads] = useState<PotentialLoad[]>([]);

  // Map Route Modal States
  const [mapModalOpen, setMapModalOpen] = useState(false);
  const [mapLegIndex, setMapLegIndex] = useState<number | null>(null);
  const [mapOrigin, setMapOrigin] = useState("");
  const [mapDestination, setMapDestination] = useState("");
  const [mapKmResult, setMapKmResult] = useState<number>(0);
  const [mapIsCheckingPl, setMapIsCheckingPl] = useState(false);
  const [saveToDirectoryChecked, setSaveToDirectoryChecked] = useState(false);
  const [mapAvoidTolls, setMapAvoidTolls] = useState(false);
  const [mapAvoidHighways, setMapAvoidHighways] = useState(false);
  const [mapAvoidFerries, setMapAvoidFerries] = useState(false);
  const [mapVehicleType, setMapVehicleType] = useState("TRUCK");
  const [mapAvoidKeywords, setMapAvoidKeywords] = useState(
    () => localStorage.getItem("ratipa_map_avoid_keywords") || "",
  );
  const [mapWaypoints, setMapWaypoints] = useState<string[]>([]);
  const [mapAvoidedStatus, setMapAvoidedStatus] = useState<{
    matches: string[];
    isAlternative: boolean;
    avoidedSuccessfully: boolean;
    attempted: boolean;
  }>({
    matches: [],
    isAlternative: false,
    avoidedSuccessfully: false,
    attempted: false,
  });

  useEffect(() => {
    localStorage.setItem("ratipa_map_avoid_keywords", mapAvoidKeywords);
  }, [mapAvoidKeywords]);

  // Potential Load Form States
  const [plEditingId, setPlEditingId] = useState<string | null>(null);
  const [plName, setPlName] = useState("");
  const [plLegs, setPlLegs] = useState<LegPlan[]>([
    { from: "", to: "", km: 0, rate: 0, referenceRate: "", ferry: 0, coeff: 0 },
  ]);
  const [plFerryCost, setPlFerryCost] = useState(0);
  const [plExtraExpense, setPlExtraExpense] = useState(0);
  const [plExtraExpenseNote, setPlExtraExpenseNote] = useState("");
  const [plReferenceRate, setPlReferenceRate] = useState<number | undefined>(
    undefined,
  );
  const [plReferenceCurrency, setPlReferenceCurrency] = useState("EUR");
  const [plAiInput, setPlAiInput] = useState("");
  const [plAiFeedback, setPlAiFeedback] = useState("");

  const getDispatcherColor = (disp: string) => {
    const colorKey = dispatchersColors[disp];
    if (!colorKey) {
      const idx = dispatchersOrder.indexOf(disp);
      if (idx === -1) return "bg-white border-slate-200/80";
      const legacyBgs = [
        "bg-[#F8FAFC] border-slate-200",
        "bg-[#EFF6FF] border-blue-200",
        "bg-[#ECFDF5] border-emerald-200",
        "bg-[#FFFBEB] border-amber-200",
        "bg-[#FAF5FF] border-[#e9d5ff]",
        "bg-[#FFF1F2] border-rose-200",
        "bg-[#F0FDFA] border-[#a5f3fc]",
        "bg-[#F5F3FF] border-[#c084fc]",
      ];
      return legacyBgs[idx % legacyBgs.length] || "bg-white border-slate-200";
    }
    const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === colorKey);
    return preset ? `${preset.bg}` : "bg-white border-slate-200/80";
  };

  const getDispatcherActiveTabStyle = (d: string) => {
    if (activeDispatcherTab !== d)
      return "bg-slate-50 text-slate-500 hover:bg-slate-100";
    if (d === "All" || d === "Все диспетчеры")
      return "bg-slate-900 text-[#70FC8E] shadow-sm border border-slate-900";

    const colorKey = dispatchersColors[d];
    const preset = DISPATCHER_COLORS_PRESETS.find((p) => p.key === colorKey);
    if (preset) {
      return `${preset.bg} ${preset.darkText} border-b-2 border-slate-500`;
    }
    return "bg-blue-100 text-[#1e40af] border-b-2 border-blue-500";
  };

  const getActiveLegRowBg = (idx: number) => {
    if (activeLegIndex !== idx) return "";
    if (!dispatcher) return "bg-blue-500/10";

    const colorKey = dispatchersColors[dispatcher];
    if (!colorKey) return "bg-blue-500/10";

    const highlightBgs: Record<string, string> = {
      blue: "bg-blue-500/10",
      emerald: "bg-emerald-500/10",
      purple: "bg-purple-500/10",
      amber: "bg-amber-500/10",
      rose: "bg-rose-500/10",
      indigo: "bg-indigo-500/10",
      teal: "bg-teal-500/10",
      orange: "bg-orange-500/10",
      slate: "bg-slate-500/10",
      yellow: "bg-yellow-500/10",
    };
    return highlightBgs[colorKey] || "bg-blue-500/10";
  };

  const handleDirChange = (val: string) => {
    setDirection(val);
    const c = directions[val] || 0;
    setLegs(legs.map((l) => ({ ...l, coeff: c })));
  };

  const checkLegDistance = (idx: number, isPotentialList: boolean = false) => {
    const list = isPotentialList ? plLegs : legs;
    const leg = list[idx];
    if (leg.from && leg.to) {
      if (settings.useDistanceLookup) {
        const d = findDistance(leg.from, leg.to);
        if (d !== null && leg.km === 0) {
          if (isPotentialList) {
            const nl = [...plLegs];
            nl[idx].km = d;
            setPlLegs(nl);
          } else {
            updateLeg(idx, { km: d });
          }
        }
      }
    }
  };

  const openMapRouteModal = (
    idx: number,
    origin: string,
    destination: string,
    isPl: boolean,
  ) => {
    setMapLegIndex(idx);
    setMapOrigin(origin);
    setMapDestination(destination);
    setMapKmResult(0);
    setMapWaypoints([]);
    setMapIsCheckingPl(isPl);
    setMapModalOpen(true);
  };

  const applyMapRoute = () => {
    if (mapLegIndex !== null) {
      const cleanOrigin = mapOrigin.trim();
      const cleanDestination = mapDestination.trim();
      if (mapIsCheckingPl) {
        const nl = [...plLegs];
        nl[mapLegIndex].km = mapKmResult;
        nl[mapLegIndex].from = cleanOrigin;
        nl[mapLegIndex].to = cleanDestination;
        setPlLegs(nl);
      } else {
        updateLeg(mapLegIndex, {
          km: mapKmResult,
          from: cleanOrigin,
          to: cleanDestination,
        });
      }

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
  const addLeg = (idx: number) => {
    const newLegs = [...legs];
    newLegs.splice(idx + 1, 0, {
      from: "",
      to: "",
      km: 0,
      rate: 0,
      referenceRate: "",
      ferry: 0,
      coeff: directions[direction] || 0,
    });
    setLegs(newLegs);
  };

  const removeLeg = (idx: number) => {
    if (legs.length <= 1) return;
    setLegs(legs.filter((_, i) => i !== idx));
    if (activeLegIndex === idx) setActiveLegIndex(undefined);
  };

  const updateLeg = (index: number, updatedFields: Partial<LegPlan>) => {
    setLegs(
      legs.map((l, i) => {
        if (i === index) {
          const merged = { ...l, ...updatedFields };
          if (
            settings.useDistanceLookup &&
            (updatedFields.from !== undefined || updatedFields.to !== undefined)
          ) {
            const matchedDist = findDistance(merged.from, merged.to);
            if (
              matchedDist !== null &&
              matchedDist > 0 &&
              typeof updatedFields.km === "undefined"
            ) {
              merged.km = matchedDist;
            }
          }

          // Auto convert infoRate -> rate
          if (
            updatedFields.referenceRate !== undefined ||
            updatedFields.referenceCurrency !== undefined
          ) {
            const newCurrency = merged.referenceCurrency || "EUR";
            const newFreight = calculateEuroFreight(
              merged.referenceRate || "",
              newCurrency,
            );
            if (newFreight > 0) {
              merged.rate = newFreight;
            }
          }

          return merged;
        }
        return l;
      }),
    );
  };

  const findDistance = (c1: string, c2: string) => {
    if (!c1 || !c2) return null;
    const from = c1.trim().toLowerCase();
    const to = c2.trim().toLowerCase();
    const found = distances.find((d) => {
      const a = (d.from || "").trim().toLowerCase();
      const b = (d.to || "").trim().toLowerCase();
      return (a === from && b === to) || (a === to && b === from);
    });
    return found ? found.distance : null;
  };

  const getTripDays = () => {
    if (!dateStart || !dateEnd) return 1;
    const s = new Date(dateStart).getTime();
    const e = new Date(dateEnd).getTime();
    if (e >= s) {
      return Math.ceil((e - s) / (1000 * 3600 * 24)) + 1;
    }
    return 1;
  };

  const calculateTotals = () => {
    const days = getTripDays();
    const totalKm = legs.reduce((acc, l) => acc + Number(l.km || 0), 0);
    const totalFreight = legs.reduce((acc, l) => acc + Number(l.rate || 0), 0);

    let baseExpenses = legs.reduce(
      (acc, l) =>
        acc + (Number(l.km || 0) * Number(l.coeff || 0) + Number(l.ferry || 0)),
      0,
    );
    const totalExpensesPlan =
      baseExpenses + Number(extraExpense || 0) + Number(ferryCost || 0);
    const profit = totalFreight - totalExpensesPlan;

    let totalExpenses = totalExpensesPlan;
    let profitFact = profit;

    const fKm = Number(factKm || 0);
    if (fKm > 0 && totalKm > 0) {
      const expensePerKm = totalExpensesPlan / totalKm;
      const factExpenses = expensePerKm * fKm;
      totalExpenses = factExpenses;
      profitFact = totalFreight - factExpenses;
    }

    return { days, totalKm, totalFreight, totalExpenses, profit, profitFact };
  };

  const resetForm = () => {
    setEditingTripId(null);
    setCarNumber("");
    const defaultDir = Object.keys(directions)[0] || "";
    setDirection(defaultDir);
    setDateStart("");
    setDateEnd("");
    setExtraExpense(0);
    setExtraExpenseNote("");
    setFerryCost(0);
    setReferenceRate(undefined);
    setReferenceCurrency("EUR");
    setTripNote("");
    setStripColor("bg-blue-500");
    setFactKm(undefined);
    setDispatcher(
      activeDispatcherTab !== "All" ? activeDispatcherTab : user.name,
    );
    setCurrentMonth("");
    setActiveLegIndex(undefined);
    const defaultLegs = [
      {
        from: "",
        to: "",
        km: 0,
        rate: 0,
        referenceRate: "",
        ferry: 0,
        coeff: directions[defaultDir] || 0,
      },
    ];
    setLegs(defaultLegs);
    setPlLegs(defaultLegs.map((l) => ({ ...l })));
    setPotentialLoads([]);
    setPlEditingId(null);
    setPlName("");
    setModalTab("main");
  };

  const [aiRouteInput, setAiRouteInput] = useState<string>("");
  const [aiRouteFeedback, setAiRouteFeedback] = useState<string>("");

  const parseSmartNumber = (val: string | undefined): number => {
    if (!val) return 0;
    return parseFloat(val.replace(/\s/g, "").replace(",", ".")) || 0;
  };

  const processAiRoute = () => {
    const raw = aiRouteInput.trim();
    if (!raw) {
      setAiRouteFeedback("Вставьте текст маршрута...");
      return;
    }

    const chunks = raw
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedRows = chunks
      .map((line) => {
        let from = "";
        let to = "";
        const routePatterns = [
          /(?:из|от)\s+([а-яёa-z\s.-]+?)\s+(?:в|на|до|—|->|→|-)\s+([а-яёa-z\s.-]+)/i,
          /^([а-яёa-z\s.-]+?)\s*(?:—|->|→|-)\s*([а-яёa-z\s.-]+)/i,
          /^([а-яёa-z\s.-]+?)\s+(?:в|на|до)\s+([а-яёa-z\s.-]+)/i,
        ];
        for (const pattern of routePatterns) {
          const match = line.match(pattern);
          if (match) {
            from = match[1]
              .replace(
                /\b(ставка|фрахт|цена|паром|переправа|коэф|коэффициент|км|евро|eur|usd|долл|руб).*/i,
                "",
              )
              .replace(/[,:;]+$/g, "")
              .trim()
              .replace(/\s+/g, " ")
              .replace(/^./, (ch) => ch.toUpperCase());
            to = match[2]
              .replace(
                /\b(ставка|фрахт|цена|паром|переправа|коэф|коэффициент|км|евро|eur|usd|долл|руб).*/i,
                "",
              )
              .replace(/[,:;]+$/g, "")
              .trim()
              .replace(/\s+/g, " ")
              .replace(/^./, (ch) => ch.toUpperCase());
            break;
          }
        }
        const rateMatch = line.match(
          /(?:ставка|фрахт|цена)?\D*?(\d[\d\s.,]*)\s*(?:€|евро|eur)\b/i,
        );
        const kmMatch = line.match(/(\d[\d\s.,]*)\s*(?:км|km)\b/i);
        const ferryMatch = line.match(/(?:паром|переправа)\D*?(\d[\d\s.,]*)/i);
        const coeffMatch = line.match(
          /(?:коэф|коэффициент)\D*?(\d+(?:[.,]\d+)?)/i,
        );

        return {
          from,
          to,
          km: kmMatch ? parseSmartNumber(kmMatch[1]) : 0,
          rate: rateMatch ? parseSmartNumber(rateMatch[1]) : 0,
          ferry: ferryMatch ? parseSmartNumber(ferryMatch[1]) : 0,
          coeff: coeffMatch
            ? parseSmartNumber(coeffMatch[1])
            : directions[direction] || 0,
          referenceRate: "",
        };
      })
      .filter((r) => r.from !== "" || r.to !== "" || r.km > 0 || r.rate > 0);

    if (parsedRows.length === 0) {
      setAiRouteFeedback(
        "Не удалось распознать маршрут. Попробуйте формат: Минск — Стамбул, ставка 4300 евро, 2450 км.",
      );
      return;
    }

    setLegs((prev) => {
      // If only one blank leg exists, replace it
      if (
        prev.length === 1 &&
        !prev[0].from &&
        !prev[0].to &&
        !prev[0].rate &&
        !prev[0].km
      ) {
        return parsedRows;
      }
      return [...prev, ...parsedRows];
    });
    setAiRouteInput("");
    setAiRouteFeedback(`Добавлено плеч: ${parsedRows.length}`);
    setTimeout(() => setAiRouteFeedback(""), 5000);
  };

  const loadTripToForm = (trip: TripPlan) => {
    setEditingTripId(trip.id);
    setCarNumber(trip.carNumber || "");
    setDirection(trip.direction || "");
    setDateStart(trip.dateStart || "");
    setDateEnd(trip.dateEnd || "");
    setExtraExpense(trip.extraExpense || 0);
    setExtraExpenseNote(trip.extraExpenseNote || "");
    setFerryCost(trip.ferryCost || 0);
    setReferenceRate(trip.referenceRate);
    setReferenceCurrency(trip.referenceCurrency || "EUR");
    setTripNote(trip.tripNote || "");
    setStripColor(trip.stripColor || "bg-blue-500");
    setFactKm(trip.factKm || undefined);
    setDispatcher(trip.dispatcher || "");
    setCurrentMonth(trip.currentMonth || "");
    setActiveLegIndex(
      trip.activeLegIndex !== undefined ? trip.activeLegIndex : undefined,
    );
    setPotentialLoads(trip.potentialLoads || []);
    if (trip.legs && trip.legs.length > 0) {
      setLegs(trip.legs);
      setPlLegs(trip.legs.map((l) => ({ ...l })));
    } else {
      const initialLegs = [
        {
          from: "",
          to: "",
          km: 0,
          rate: 0,
          referenceRate: "",
          ferry: 0,
          coeff: directions[trip.direction] || 0,
        },
      ];
      setLegs(initialLegs);
      setPlLegs(initialLegs.map((l) => ({ ...l })));
    }
    setPlEditingId(null);
    setPlName("");
    setIsModalOpen(true);
  };

  const parseAiRouteClient = (
    raw: string,
    defaultDir: string,
    directionsMap: Record<string, number>,
  ): LegPlan[] => {
    const chunks = raw
      .split(/\n|;/)
      .map((s) => s.trim())
      .filter(Boolean);
    const parsedRows = chunks
      .map((line) => {
        let from = "";
        let to = "";
        const routePatterns = [
          /(?:из|от)\s+([а-яёa-z\s.-]+?)\s+(?:в|на|до|—|->|→|-)\s+([а-яёa-z\s.-]+)/i,
          /^([а-яёa-z\s.-]+?)\s*(?:—|->|→|-)\s*([а-яёa-z\s.-]+)/i,
          /^([а-яёa-z\s.-]+?)\s+(?:в|на|до)\s+([а-яёa-z\s.-]+)/i,
        ];
        for (const pattern of routePatterns) {
          const match = line.match(pattern);
          if (match) {
            from = match[1]
              .replace(
                /\b(ставка|фрахт|цена|паром|переправа|коэф|коэффициент|км|евро|eur|usd|долл|руб).*/i,
                "",
              )
              .replace(/[,:;]+$/g, "")
              .trim()
              .replace(/\s+/g, " ")
              .replace(/^./, (ch) => ch.toUpperCase());
            to = match[2]
              .replace(
                /\b(ставка|фрахт|цена|паром|переправа|коэф|коэффициент|км|евро|eur|usd|долл|руб).*/i,
                "",
              )
              .replace(/[,:;]+$/g, "")
              .trim()
              .replace(/\s+/g, " ")
              .replace(/^./, (ch) => ch.toUpperCase());
            break;
          }
        }
        const rateMatch = line.match(
          /(?:ставка|фрахт|цена)?\D*?(\d[\d\s.,]*)\s*(?:€|евро|eur)\b/i,
        );
        const kmMatch = line.match(/(\d[\d\s.,]*)\s*(?:км|km)\b/i);
        const ferryMatch = line.match(/(?:паром|переправа)\D*?(\d[\d\s.,]*)/i);
        const coeffMatch = line.match(
          /(?:коэф|коэффициент)\D*?(\d+(?:[.,]\d+)?)/i,
        );

        return {
          from,
          to,
          km: kmMatch ? parseSmartNumber(kmMatch[1]) : 0,
          rate: rateMatch ? parseSmartNumber(rateMatch[1]) : 0,
          ferry: ferryMatch ? parseSmartNumber(ferryMatch[1]) : 0,
          coeff: coeffMatch
            ? parseSmartNumber(coeffMatch[1])
            : directionsMap[defaultDir] || 0,
          referenceRate: "",
        };
      })
      .filter((r) => r.from !== "" || r.to !== "" || r.km > 0 || r.rate > 0);
    return parsedRows;
  };

  const processPlAiRoute = async () => {
    if (!plAiInput.trim()) return;
    setPlAiFeedback("");
    try {
      const parsedRows = parseAiRouteClient(
        plAiInput,
        Object.keys(directions)[0] || "",
        directions,
      );
      if (parsedRows.length === 0) {
        setPlAiFeedback("Не удалось распознать маршрут.");
        return;
      }
      setPlLegs(parsedRows);
      setPlAiInput("");
      setPlAiFeedback(`Успешно распознано ${parsedRows.length} плечей`);
      setTimeout(() => setPlAiFeedback(""), 3000);
    } catch (err) {
      setPlAiFeedback("Ошибка распознавания");
    }
  };

  const calculatePlTotals = () => {
    const totalKm = plLegs.reduce((acc, l) => acc + Number(l.km || 0), 0);
    const totalFreight = plLegs.reduce(
      (acc, l) => acc + Number(l.rate || 0),
      0,
    );
    const baseExpenses = plLegs.reduce(
      (acc, l) => acc + Number(l.km || 0) * Number(l.coeff || 0),
      0,
    );
    const totalExpensesPlan =
      baseExpenses + Number(plExtraExpense || 0) + Number(plFerryCost || 0);
    const profit = totalFreight - totalExpensesPlan;
    return { totalKm, totalFreight, totalExpenses: totalExpensesPlan, profit };
  };

  const savePotentialLoad = () => {
    if (!plName.trim()) {
      alert("Укажите название просчета");
      return;
    }
    if (potentialLoads.length >= 3 && !plEditingId) {
      alert("Можно сохранить максимум 3 просчета");
      return;
    }

    const totals = calculatePlTotals();
    const newPl: PotentialLoad = {
      id: plEditingId || "pl_" + Date.now(),
      name: plName.trim(),
      legs: plLegs,
      totalKm: totals.totalKm,
      totalFreight: totals.totalFreight,
      totalExpenses: totals.totalExpenses,
      ferryCost: plFerryCost,
      extraExpense: plExtraExpense,
      extraExpenseNote: plExtraExpenseNote,
      referenceRate: plReferenceRate,
      referenceCurrency: plReferenceCurrency,
      profit: totals.profit,
      profitFact: totals.profit,
    };

    if (plEditingId) {
      setPotentialLoads(
        potentialLoads.map((p) => (p.id === plEditingId ? newPl : p)),
      );
    } else {
      setPotentialLoads([...potentialLoads, newPl]);
    }

    // Reset PL form, but copy current legs and reference rates
    setPlEditingId(null);
    setPlName("");
    setPlLegs(legs.map((l) => ({ ...l }))); // Deep copy to prevent reference mutation
    setPlFerryCost(0);
    setPlExtraExpense(0);
    setPlExtraExpenseNote("");
    setPlReferenceRate(undefined);
    setPlReferenceCurrency("EUR");
  };

  const editPotentialLoad = (pl: PotentialLoad) => {
    setPlEditingId(pl.id);
    setPlName(pl.name);
    setPlLegs(pl.legs);
    setPlFerryCost(pl.ferryCost);
    setPlExtraExpense(pl.extraExpense);
    setPlExtraExpenseNote(pl.extraExpenseNote);
    setPlReferenceRate(pl.referenceRate);
    setPlReferenceCurrency(pl.referenceCurrency || "EUR");
  };

  const deletePotentialLoad = (id: string) => {
    if (confirm("Удалить просчет?")) {
      setPotentialLoads(potentialLoads.filter((p) => p.id !== id));
      if (plEditingId === id) {
        // Stop editing if deleted
        setPlEditingId(null);
        setPlName("");
        setPlLegs([
          {
            from: "",
            to: "",
            km: 0,
            rate: 0,
            referenceRate: "",
            ferry: 0,
            coeff: 0,
          },
        ]);
      }
    }
  };

  const applyPlToMain = (pl: PotentialLoad) => {
    if (
      confirm(
        "Осторожно: Это заменит текущие плечи в основной форме. Продолжить?",
      )
    ) {
      setLegs(pl.legs);
      setFerryCost(pl.ferryCost);
      setExtraExpense(pl.extraExpense);
      setExtraExpenseNote(pl.extraExpenseNote);
      if (pl.referenceRate !== undefined) setReferenceRate(pl.referenceRate);
      if (pl.referenceCurrency)
        setReferenceCurrency(pl.referenceCurrency as any);
      setModalTab("main");
    }
  };

  const saveTrip = () => {
    const trimmedCar = carNumber.trim().toUpperCase();
    if (!trimmedCar) {
      alert("Укажите номер автомобиля");
      return;
    }

    if (!savedCars.includes(trimmedCar)) {
      pdService.addCar([...savedCars, trimmedCar]);
    }

    const ObjectWithoutUndefinedInfo = (val: any) =>
      val === undefined ? null : val;

    const totals = calculateTotals();
    const tripObj: TripPlan = {
      id: editingTripId || "",
      carNumber: trimmedCar,
      logist: user.name,
      direction,
      dateStart,
      dateEnd,
      days: totals.days,
      totalKm: totals.totalKm,
      totalFreight: totals.totalFreight,
      totalExpenses: totals.totalExpenses,
      extraExpense: Number(extraExpense || 0),
      extraExpenseNote,
      ferryCost: Number(ferryCost || 0),
      referenceRate,
      referenceCurrency,
      profit: totals.profit,
      factKm: Number(factKm || 0),
      profitFact: totals.profitFact,
      tripNote,
      stripColor: stripColor || "bg-blue-500",
      legs,
      potentialLoads,
      activeLegIndex: activeLegIndex !== undefined ? activeLegIndex : -1,
      dispatcher: dispatcher || user.name,
      currentMonth,
      isArchived: editingTripId
        ? trips.find((t) => t.id === editingTripId)?.isArchived || false
        : false,
    };

    if (editingTripId) {
      pdService.updateTrip(editingTripId, tripObj, user.name, user.role);
    } else {
      pdService.createTrip(tripObj, user.name, user.role);
    }

    // Automatically bind the car Number to the dispatcher in Administration
    const finalDispatcher = dispatcher || user.name;
    if (
      trimmedCar &&
      finalDispatcher &&
      finalDispatcher !== "Все диспетчеры" &&
      finalDispatcher !== "Общая" &&
      finalDispatcher !== "All" &&
      finalDispatcher !== "Все"
    ) {
      const updatedMapping = {
        ...carDispatcherMapping,
        [trimmedCar]: finalDispatcher,
      };
      pdService.updateDispatchersCarMapping(updatedMapping);
    }

    resetForm();
    setIsModalOpen(false);
  };

  const finishTripToArchive = (trip: TripPlan, isModal: boolean = false) => {
    const month =
      trip.currentMonth ||
      new Date().toLocaleString("ru-RU", { month: "long", year: "numeric" });
    pdService.archiveTrip(trip.id, month, user.name, user.role);
    if (isModal) setIsModalOpen(false);
  };

  const deleteTrip = (id: string, isModal: boolean = false) => {
    pdService.deleteTrip(id, user.name, user.role);
    if (isModal) setIsModalOpen(false);
  };

  const { totalKm, totalFreight, totalExpenses, profit, profitFact } =
    calculateTotals();

  const renderCurrentFormModal = () => {
    if (!isModalOpen) return null;
    const isEditing = !!editingTripId;
    const currentEditingTrip = isEditing
      ? trips.find((t) => t.id === editingTripId)
      : null;

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div className="bg-slate-100 rounded-[2rem] w-full shadow-2xl overflow-hidden flex flex-col relative my-auto">
          <div className="bg-white px-6 py-5 border-b border-slate-200/60 shadow-sm flex items-center justify-between sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <div className="bg-blue-500/20 p-2 rounded-xl border border-blue-500/30">
                <Calculator className="w-5 h-5 text-blue-900" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">
                  {editingTripId ? "Редактирование плана" : "Новый план"}
                </h2>
                <span className="text-[10px] font-black font-mono text-slate-400 uppercase tracking-widest">
                  Конструктор рейса - Firebase DB Sync
                </span>
              </div>
            </div>

            <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
              <button
                type="button"
                onClick={() => setModalTab("main")}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${modalTab === "main" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-800 hover:bg-slate-200"}`}
              >
                Форма
              </button>
              <button
                type="button"
                onClick={() => setModalTab("potential")}
                className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition ${modalTab === "potential" ? "bg-purple-100 shadow-sm text-purple-700" : "text-slate-500 hover:text-slate-800 hover:bg-slate-200"}`}
              >
                Потенциал. грузы{" "}
                {potentialLoads.length > 0 && (
                  <span className="ml-1 bg-purple-500 text-white rounded-full px-1.5 py-0.5 text-[8px]">
                    {potentialLoads.length}
                  </span>
                )}
              </button>
            </div>

            <button
              onClick={() => setIsModalOpen(false)}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 hover:text-slate-800 transition"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto custom-scrollbar max-h-[80vh]">
            {modalTab === "main" ? (
              <>
                <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-6">
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                      Автомобиль
                    </label>
                    <input
                      type="text"
                      list="saved-cars-list"
                      placeholder="АХ 1234-7"
                      value={carNumber}
                      onChange={(e) => handleCarNumberChange(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold uppercase outline-none focus:border-blue-500 transition"
                    />
                    <datalist id="saved-cars-list">
                      {savedCars.map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                      Направление
                    </label>
                    <select
                      value={direction}
                      onChange={(e) => handleDirChange(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 transition"
                    >
                      {Object.keys(directions).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                      Диспетчер
                    </label>
                    <select
                      value={dispatcher}
                      onChange={(e) => setDispatcher(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 transition"
                    >
                      <option value="">Не выбран</option>
                      {dispatchers.map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-blue-500 font-mono mb-2 block">
                      Дата старта
                    </label>
                    <input
                      type="date"
                      value={dateStart}
                      onChange={(e) => setDateStart(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 transition"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                      Дата финиша
                    </label>
                    <input
                      type="date"
                      value={dateEnd}
                      onChange={(e) => setDateEnd(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>

                <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden">
                  <div className="mb-6 p-4 bg-blue-50/50 border border-blue-100 rounded-2xl flex flex-col gap-3">
                    <div className="flex flex-col">
                      <h4 className="text-xs font-black uppercase text-blue-900 tracking-widest font-mono">
                        AI-Ассистент Маршрута
                      </h4>
                      <span className="text-[10px] text-blue-600 font-bold leading-tight mt-1">
                        Вставьте текст маршрута из чата (напр: "Минск — Стамбул,
                        ставка 4300 евро, 2450 км, паром 300, коэф 1.1")
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <textarea
                        value={aiRouteInput}
                        onChange={(e) => setAiRouteInput(e.target.value)}
                        placeholder="Вставить текст..."
                        className="flex-1 bg-white border border-blue-200 rounded-xl px-4 py-2 text-sm font-bold outline-none focus:border-blue-400 min-h-[44px] resize-y"
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            processAiRoute();
                          }
                        }}
                      />
                      <button
                        onClick={processAiRoute}
                        className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-xl font-black text-xs uppercase tracking-widest transition"
                      >
                        Распознать
                      </button>
                    </div>
                    {aiRouteFeedback && (
                      <span className="text-[11px] font-black text-blue-800">
                        {aiRouteFeedback}
                      </span>
                    )}
                  </div>

                  <h3 className="text-xs font-black uppercase tracking-widest text-slate-800 font-mono flex items-center gap-2 mb-4">
                    <MapPin className="w-4 h-4 text-blue-500" /> Плечи маршрута
                  </h3>

                  {/* Swipe Help Badge for Mobile */}
                  <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-center uppercase tracking-wider select-none">
                    <span className="inline-block animate-pulse text-blue-500 mr-1.5 font-sans">
                      ↔
                    </span>{" "}
                    Таблица прокручивается вправо для изменения км, ставок,
                    парома и коэффициентов
                  </div>

                  <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
                    <table className="w-full min-w-[950px] border-collapse relative">
                      <thead className="bg-slate-50/50">
                        <tr>
                          <th className="p-3 text-[10px] font-black uppercase text-slate-500 tracking-wider text-center rounded-tl-xl w-10">
                            Акт.
                          </th>
                          <th className="p-3 text-[10px] font-black uppercase text-slate-500 tracking-wider text-left w-8">
                            #
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-32">
                            Откуда
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-32">
                            Куда
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">
                            Км
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">
                            Фрахт €
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-32">
                            Инфо Ставка
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">
                            Паром €
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-16">
                            Коэфф.
                          </th>
                          <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-right rounded-tr-xl w-24"></th>
                        </tr>
                      </thead>
                      <tbody className="space-y-2">
                        {legs.map((leg, idx) => (
                          <tr
                            key={idx}
                            className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition ${getActiveLegRowBg(idx)}`}
                          >
                            <td className="p-2 text-center">
                              <button
                                onClick={() =>
                                  setActiveLegIndex(
                                    idx === activeLegIndex ? undefined : idx,
                                  )
                                }
                                className={`w-5 h-5 rounded flex items-center justify-center border transition mx-auto cursor-pointer ${activeLegIndex === idx ? "bg-blue-500 border-blue-500 text-white" : "bg-white border-slate-300 text-transparent hover:border-blue-500"}`}
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                            </td>
                            <td className="p-2 text-[10px] font-black text-slate-400">
                              {idx + 1}
                            </td>
                            <td className="p-2">
                              <input
                                list="cities-db-pl"
                                value={leg.from}
                                onChange={(e) =>
                                  updateLeg(idx, { from: e.target.value })
                                }
                                onBlur={() => checkLegDistance(idx)}
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                                placeholder="Город..."
                              />
                            </td>
                            <td className="p-2">
                              <input
                                list="cities-db-pl"
                                value={leg.to}
                                onChange={(e) =>
                                  updateLeg(idx, { to: e.target.value })
                                }
                                onBlur={() => checkLegDistance(idx)}
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                                placeholder="Город..."
                              />
                            </td>
                            <td className="p-2 relative">
                              <input
                                type="number"
                                value={leg.km || ""}
                                onChange={(e) =>
                                  updateLeg(idx, { km: Number(e.target.value) })
                                }
                                className="w-full pl-3 pr-8 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                              />
                              <button
                                onClick={() =>
                                  openMapRouteModal(
                                    idx,
                                    leg.from,
                                    leg.to,
                                    false,
                                  )
                                }
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition"
                              >
                                <MapPin className="w-4 h-4" />
                              </button>
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                value={leg.rate || ""}
                                onChange={(e) =>
                                  updateLeg(idx, {
                                    rate: Number(e.target.value),
                                  })
                                }
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                              />
                            </td>
                            <td className="p-2">
                              <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:border-blue-500 transition">
                                <input
                                  type="text"
                                  value={leg.referenceRate || ""}
                                  onChange={(e) =>
                                    updateLeg(idx, {
                                      referenceRate: e.target.value,
                                    })
                                  }
                                  className="w-full px-3 py-2.5 bg-transparent text-xs font-bold outline-none placeholder-slate-300"
                                  placeholder="напр. 3800"
                                />
                                <select
                                  value={leg.referenceCurrency || ""}
                                  onChange={(e) =>
                                    updateLeg(idx, {
                                      referenceCurrency: e.target.value,
                                    })
                                  }
                                  className="bg-slate-50/50 border-l border-slate-200 text-slate-600 text-xs font-bold outline-none px-2 cursor-pointer max-w-[60px]"
                                >
                                  <option value=""></option>
                                  {currencies.map((c) => (
                                    <option key={c.id} value={c.code}>
                                      {c.code}
                                    </option>
                                  ))}
                                </select>
                              </div>
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                value={leg.ferry || ""}
                                onChange={(e) =>
                                  updateLeg(idx, {
                                    ferry: Number(e.target.value),
                                  })
                                }
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="number"
                                step="0.1"
                                value={leg.coeff}
                                onChange={(e) =>
                                  updateLeg(idx, {
                                    coeff: Number(e.target.value),
                                  })
                                }
                                className="w-full px-1 py-2.5 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none text-center"
                              />
                            </td>
                            <td className="p-2 text-right space-x-1 whitespace-nowrap">
                              <button
                                onClick={() => addLeg(idx)}
                                className="w-8 h-8 inline-flex items-center justify-center rounded-xl bg-slate-50 hover:bg-blue-500/20 text-slate-500 hover:text-blue-900 transition"
                              >
                                <Plus className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => removeLeg(idx)}
                                disabled={legs.length <= 1}
                                className="w-8 h-8 inline-flex items-center justify-center rounded-xl bg-slate-50 hover:bg-rose-100 text-slate-400 hover:text-rose-600 transition disabled:opacity-30"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <datalist id="cities-db-pl">
                    {Array.from(
                      new Set(distances.flatMap((d) => [d.from, d.to])),
                    ).map((c) => c && <option key={c} value={c} />)}
                  </datalist>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-8 bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col justify-between">
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-4">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                          Доп Расходы €
                        </label>
                        <input
                          type="number"
                          value={extraExpense || ""}
                          onChange={(e) =>
                            setExtraExpense(Number(e.target.value))
                          }
                          className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                          Коммент расходов
                        </label>
                        <input
                          type="text"
                          value={extraExpenseNote}
                          onChange={(e) => setExtraExpenseNote(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                          Паром (общ) €
                        </label>
                        <input
                          type="number"
                          value={ferryCost || ""}
                          onChange={(e) => setFerryCost(Number(e.target.value))}
                          className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                          Справ. ставка
                        </label>
                        <div className="flex bg-slate-50 border border-slate-200 rounded-xl overflow-hidden focus-within:border-blue-500 transition">
                          <input
                            type="number"
                            step="0.01"
                            value={referenceRate || ""}
                            onChange={(e) =>
                              setReferenceRate(
                                e.target.value
                                  ? Number(e.target.value)
                                  : undefined,
                              )
                            }
                            className="w-full bg-transparent text-slate-800 px-4 py-3 text-sm font-bold outline-none"
                          />
                          <select
                            value={referenceCurrency}
                            onChange={(e) =>
                              setReferenceCurrency(e.target.value as any)
                            }
                            className="bg-slate-100/50 border-l border-slate-200 text-slate-600 text-xs font-bold outline-none px-2 cursor-pointer font-mono min-w-[70px]"
                          >
                            {currencies.length === 0 && (
                              <>
                                <option value="EUR">€</option>
                                <option value="USD">$</option>
                                <option value="RUB">₽</option>
                                <option value="BYN">Br</option>
                              </>
                            )}
                            {currencies.map((c) => (
                              <option key={c.id} value={c.code}>
                                {c.code}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                        Факт КМ
                      </label>
                      <input
                        type="number"
                        placeholder="Оставьте пустым для расчета по плану"
                        value={factKm || ""}
                        onChange={(e) =>
                          setFactKm(
                            e.target.value ? Number(e.target.value) : undefined,
                          )
                        }
                        className="w-full md:w-1/2 bg-yellow-50 border border-yellow-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-yellow-500 transition mb-4"
                      />

                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 block">
                        Комментарий к рейсу
                      </label>
                      <textarea
                        value={tripNote}
                        onChange={(e) => setTripNote(e.target.value)}
                        rows={2}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-blue-500 resize-none transition"
                      />

                      <div className="mt-4 flex gap-2">
                        {[
                          "bg-slate-200",
                          "bg-blue-300",
                          "bg-blue-500",
                          "bg-[#70FC8E]",
                          "bg-amber-300",
                          "bg-rose-300",
                          "bg-purple-500",
                          "bg-slate-800",
                        ].map((cc) => (
                          <button
                            key={cc}
                            onClick={() => setStripColor(cc)}
                            className={`w-6 h-6 rounded-full border-2 ${stripColor === cc ? "border-slate-800 scale-110" : "border-transparent"} ${cc} transition`}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="mt-6 flex justify-between items-center bg-slate-950 p-4 rounded-2xl shadow-xs border border-slate-800 text-white flex-wrap gap-4">
                      <div className="flex gap-6 flex-wrap">
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase tracking-widest font-mono text-slate-500">
                            План км
                          </span>
                          <span className="text-xl font-black font-mono">
                            {Math.round(totalKm)} км
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase tracking-widest font-mono text-slate-500">
                            Фрахт
                          </span>
                          <span className="text-xl font-black font-mono text-blue-400">
                            {Math.round(totalFreight)} €
                          </span>
                        </div>
                        <div className="flex flex-col">
                          <span className="text-[9px] uppercase tracking-widest font-mono text-slate-500">
                            Расходы (План)
                          </span>
                          <span className="text-xl font-black font-mono text-amber-500">
                            {Math.round(totalExpenses)} €
                          </span>
                        </div>
                      </div>
                      <div className="flex gap-2 ml-auto">
                        {isEditing && currentEditingTrip && (
                          <>
                            <button
                              onClick={() => deleteTrip(editingTripId, true)}
                              className="bg-rose-100 hover:bg-rose-200 text-rose-700 flex items-center gap-2 px-4 py-3 rounded-xl font-black text-sm uppercase tracking-tight transition shadow-sm border border-rose-200"
                            >
                              <Trash2 className="w-4 h-4" /> Удалить
                            </button>
                            {currentEditingTrip.isArchived ? (
                              <button
                                onClick={() => {
                                  pdService.restoreTrip(
                                    editingTripId,
                                    user.name,
                                    user.role,
                                  );
                                  setIsModalOpen(false);
                                }}
                                className="bg-blue-100 hover:bg-blue-200 text-blue-800 flex items-center gap-2 px-4 py-3 rounded-xl font-black text-sm uppercase tracking-tight transition shadow-sm border border-blue-200"
                              >
                                <Archive className="w-4 h-4" /> Из архива
                              </button>
                            ) : (
                              <button
                                onClick={() =>
                                  finishTripToArchive(currentEditingTrip, true)
                                }
                                className="bg-amber-100 hover:bg-amber-200 text-amber-800 flex items-center gap-2 px-4 py-3 rounded-xl font-black text-sm uppercase tracking-tight transition shadow-sm border border-amber-200"
                              >
                                <Archive className="w-4 h-4" /> В архив
                              </button>
                            )}
                          </>
                        )}
                        <button
                          onClick={saveTrip}
                          className="bg-blue-500 hover:bg-blue-400 text-white flex items-center gap-2 px-6 py-3 rounded-xl font-black text-sm uppercase tracking-tight transition shadow-sm"
                        >
                          <Save className="w-4 h-4" /> Сохранить
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-4 flex flex-col gap-4">
                    <div className="bg-slate-50 rounded-[1.5rem] p-6 border border-slate-200 text-center flex flex-col justify-center relative overflow-hidden flex-1 shadow-sm">
                      <div
                        className={`absolute top-0 left-0 w-full h-1.5 ${stripColor}`}
                      />
                      <span className="text-[10px] uppercase font-black tracking-widest text-slate-500 font-mono mb-2">
                        Прибыль Общая
                      </span>
                      <span
                        className={`text-4xl font-black tracking-tighter ${profitFact < 0 ? "text-rose-500" : "text-slate-800"}`}
                      >
                        {Math.round(profitFact)}{" "}
                        <span className="text-xl text-slate-400">€</span>
                      </span>
                      <div className="flex justify-center gap-4 mt-3">
                        <span className="text-[10px] font-bold text-slate-400 font-mono">
                          План: {Math.round(profit)} €
                        </span>
                        {factKm && factKm > 0 && (
                          <span className="text-[10px] font-bold text-emerald-600 font-mono">
                            Факт: {Math.round(profitFact)} €
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-white rounded-2xl p-4 border border-slate-200 text-center flex flex-col justify-center flex-1 shadow-sm">
                        <span className="text-[9px] uppercase font-black tracking-widest text-slate-500 font-mono mb-1">
                          Прибыль в день (План)
                        </span>
                        <span
                          className={`text-xl font-black tracking-tighter ${Math.round(profit / (getTripDays() || 1)) < 0 ? "text-rose-500" : "text-slate-700"}`}
                        >
                          {Math.round(profit / (getTripDays() || 1))} €
                        </span>
                      </div>
                      <div className="bg-white rounded-2xl p-4 border border-emerald-100 text-center flex flex-col justify-center flex-1 shadow-sm relative overflow-hidden">
                        {factKm && factKm > 0 && (
                          <div className="absolute top-0 right-0 w-8 h-8 bg-emerald-500 rounded-bl-[100%] z-0 opacity-10"></div>
                        )}
                        <span className="text-[9px] uppercase font-black tracking-widest text-emerald-600/70 font-mono mb-1 relative z-10">
                          Прибыль в день (Факт)
                        </span>
                        <span
                          className={`text-xl font-black tracking-tighter relative z-10 ${Math.round(profitFact / (getTripDays() || 1)) < 0 ? "text-rose-500" : "text-emerald-700"}`}
                        >
                          {Math.round(profitFact / (getTripDays() || 1))} €
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : modalTab === "potential" ? (
              <div className="bg-slate-100/50 rounded-[2rem] p-6 lg:p-8 flex flex-col xl:flex-row gap-6 min-h-[500px]">
                {/* Left side: List of saved Potential Loads */}
                <div className="flex-1 w-full xl:w-1/3 xl:max-w-[400px] bg-white rounded-2xl p-6 border border-slate-200/60 shadow-sm flex flex-col gap-4">
                  <h3 className="text-sm font-black uppercase text-purple-700 font-mono tracking-widest border-b border-purple-100 pb-3">
                    Сохраненные просчеты ({potentialLoads.length}/3)
                  </h3>

                  <div className="space-y-4">
                    {potentialLoads.map((pl) => {
                      const days = pl.totalKm
                        ? Math.max(1, Math.round(pl.totalKm / 500))
                        : 1;
                      const profitPerDay = Math.round(pl.profit / days);
                      return (
                        <div
                          key={pl.id}
                          className={`p-4 rounded-[1.5rem] border ${plEditingId === pl.id ? "border-purple-400 bg-purple-50 shadow-md shadow-purple-500/10" : "border-slate-200 bg-slate-50 hover:border-slate-300"} transition cursor-pointer flex flex-col gap-3 relative`}
                          onClick={() => editPotentialLoad(pl)}
                        >
                          <div className="flex justify-between items-start">
                            <span className="font-black text-sm text-slate-800 uppercase tracking-tight">
                              {pl.name}
                            </span>
                            <div
                              className="flex gap-1.5"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className="p-2 text-blue-600 bg-blue-100 hover:bg-blue-200 shadow-sm border border-blue-200 rounded-xl transition"
                                title="Перенести в основную форму"
                                onClick={() => applyPlToMain(pl)}
                              >
                                <Calculator className="w-4 h-4" />
                              </button>
                              <button
                                className="p-2 text-rose-500 hover:bg-rose-100 rounded-xl transition"
                                title="Удалить"
                                onClick={() => deletePotentialLoad(pl.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center items-center">
                              <span className="text-[9px] uppercase font-bold text-slate-400 font-mono">
                                Доход Общий
                              </span>
                              <span
                                className={`text-base font-black ${pl.profit < 0 ? "text-rose-500" : "text-emerald-600"}`}
                              >
                                {Math.round(pl.profit)}€
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center items-center">
                              <span className="text-[9px] uppercase font-bold text-slate-400 font-mono">
                                Доход в День
                              </span>
                              <span
                                className={`text-base font-black ${profitPerDay < 0 ? "text-rose-500" : "text-blue-600"}`}
                              >
                                {profitPerDay}€
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center items-center">
                              <span className="text-[9px] uppercase font-bold text-slate-400 font-mono">
                                Дней в пути
                              </span>
                              <span className="text-base font-black text-slate-800">
                                {days}
                              </span>
                            </div>
                            <div className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm flex flex-col justify-center items-center">
                              <span className="text-[9px] uppercase font-bold text-slate-400 font-mono">
                                Километраж
                              </span>
                              <span className="text-base font-black text-slate-800">
                                {Math.round(pl.totalKm)}
                              </span>
                            </div>
                          </div>

                          <div className="mt-1 bg-slate-100 rounded-xl p-3 border border-slate-200/50">
                            <div className="text-[9px] font-black uppercase text-slate-400 mb-2 font-mono">
                              Маршрут (Плечи)
                            </div>
                            <div className="space-y-1.5 border-l-2 border-dashed border-slate-300 ml-1 pl-3 relative">
                              {pl.legs.map((leg, idx) => (
                                <div key={idx} className="relative">
                                  <div className="absolute -left-[17px] top-1.5 w-2 h-2 bg-slate-400 rounded-full border-2 border-slate-100"></div>
                                  <div className="flex justify-between items-center text-[10px]">
                                    <span className="font-bold text-slate-700 truncate mr-2">
                                      {leg.from || "?"}{" "}
                                      <span className="text-slate-400 mx-1">
                                        →
                                      </span>{" "}
                                      {leg.to || "?"}
                                    </span>
                                    <div className="flex gap-2 font-mono whitespace-nowrap">
                                      <span className="text-slate-500">
                                        {leg.km} км
                                      </span>
                                      <span className="text-blue-600 font-bold">
                                        {leg.rate}€
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                    {potentialLoads.length === 0 && (
                      <span className="text-xs text-slate-400 font-bold block text-center py-6">
                        Нет сохраненных просчетов
                      </span>
                    )}
                  </div>

                  {potentialLoads.length < 3 && plEditingId === null && (
                    <button className="w-full mt-auto py-3 bg-purple-100 text-purple-700 font-black text-[10px] uppercase tracking-widest rounded-xl hover:bg-purple-200 transition">
                      Можно создать еще {3 - potentialLoads.length}
                    </button>
                  )}
                  {plEditingId !== null && (
                    <button
                      className="w-full mt-auto py-2.5 bg-slate-200 text-slate-600 font-bold text-xs rounded-xl hover:bg-slate-300 transition"
                      onClick={() => {
                        setPlEditingId(null);
                        setPlName("");
                        setPlLegs(legs.map((l) => ({ ...l })));
                      }}
                    >
                      Создать новый
                    </button>
                  )}
                </div>

                {/* Right side: Editor */}
                <div className="flex-[2] bg-white rounded-2xl p-6 border border-slate-200/60 shadow-sm flex flex-col gap-6">
                  <div className="flex items-center gap-4 border-b border-slate-100 pb-4">
                    <input
                      type="text"
                      placeholder="Название (напр: Груз на Москву)..."
                      value={plName}
                      onChange={(e) => setPlName(e.target.value)}
                      className="flex-1 bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-purple-400 transition"
                    />
                    <button
                      onClick={savePotentialLoad}
                      className="px-6 py-3 bg-purple-600 text-white rounded-xl text-xs font-black shadow-sm shadow-purple-600/20 hover:bg-purple-700 transition uppercase tracking-widest min-w-[140px]"
                    >
                      {plEditingId ? "Обновить" : "Сохранить"}
                    </button>
                  </div>

                  <div className="p-4 bg-purple-50/50 border border-purple-100 rounded-2xl flex flex-col gap-3">
                    <div className="flex flex-col">
                      <h4 className="text-[10px] font-black uppercase text-purple-900 tracking-widest font-mono">
                        AI-Ассистент Маршрута
                      </h4>
                    </div>
                    <div className="flex gap-2">
                      <textarea
                        value={plAiInput}
                        onChange={(e) => setPlAiInput(e.target.value)}
                        placeholder="Вставить текст груза из чата..."
                        className="flex-1 bg-white border border-purple-200 rounded-xl px-4 py-3 text-sm font-bold outline-none focus:border-purple-400 min-h-[44px] resize-y"
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            processPlAiRoute();
                          }
                        }}
                      />
                      <button
                        onClick={processPlAiRoute}
                        className="px-5 bg-purple-600/10 text-purple-700 hover:bg-purple-600/20 rounded-xl text-xs font-black uppercase tracking-widest transition flex flex-col items-center justify-center gap-1 min-w-[100px] border border-purple-600/20"
                      >
                        <Bot className="w-5 h-5" /> AI Parse
                      </button>
                    </div>
                    {plAiFeedback && (
                      <div className="text-xs font-bold text-emerald-600 mt-1">
                        {plAiFeedback}
                      </div>
                    )}
                  </div>

                  <div className="overflow-x-auto pb-4">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead>
                        <tr>
                          <th className="p-2 text-[10px] uppercase font-black text-slate-400">
                            Откуда
                          </th>
                          <th className="p-2 text-[10px] uppercase font-black text-slate-400">
                            Куда
                          </th>
                          <th className="p-2 text-[10px] uppercase font-black text-slate-400 w-24">
                            КМ
                          </th>
                          <th className="p-2 text-[10px] uppercase font-black text-slate-400 w-28">
                            Ставка €
                          </th>
                          <th></th>
                        </tr>
                      </thead>
                      <tbody>
                        {plLegs.map((leg, i) => (
                          <tr key={i} className="border-b border-slate-100/50">
                            <td className="p-1">
                              <input
                                type="text"
                                value={leg.from}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].from = e.target.value;
                                  setPlLegs(nl);
                                }}
                                onBlur={() => checkLegDistance(i, true)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none"
                              />
                            </td>
                            <td className="p-1">
                              <input
                                type="text"
                                value={leg.to}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].to = e.target.value;
                                  setPlLegs(nl);
                                }}
                                onBlur={() => checkLegDistance(i, true)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none"
                              />
                            </td>
                            <td className="p-1 relative">
                              <input
                                type="number"
                                value={leg.km || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].km = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-3 pr-8 py-2 text-xs font-bold outline-none"
                              />
                              <button
                                onClick={() =>
                                  openMapRouteModal(i, leg.from, leg.to, true)
                                }
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-blue-500 transition"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                              </button>
                            </td>
                            <td className="p-1">
                              <input
                                type="number"
                                value={leg.rate || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].rate = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold text-blue-600 outline-none"
                              />
                            </td>
                            <td className="p-1 w-20 text-right">
                              <div className="flex gap-1 justify-end">
                                <button
                                  onClick={() => {
                                    const nl = [...plLegs];
                                    nl.splice(i + 1, 0, {
                                      from: "",
                                      to: "",
                                      km: 0,
                                      rate: 0,
                                      ferry: 0,
                                      coeff: directions[direction] || 0,
                                    });
                                    setPlLegs(nl);
                                  }}
                                  className="w-7 h-7 rounded bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-100"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => {
                                    if (plLegs.length > 1) {
                                      const nl = [...plLegs];
                                      nl.splice(i, 1);
                                      setPlLegs(nl);
                                    }
                                  }}
                                  className="w-7 h-7 rounded bg-rose-50 text-rose-500 flex items-center justify-center hover:bg-rose-100"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  const handleTripDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("tripId");
    if (!sourceId || sourceId === targetId) return;

    const visibleIds = document.querySelectorAll(".car-strip-item");
    const idsInView = Array.from(visibleIds).map(
      (el) => (el as HTMLElement).dataset.tripId!,
    );

    let order = manualTripsOrder.filter((id) => idsInView.includes(id));
    idsInView.forEach((id) => {
      if (!order.includes(id)) order.push(id);
    });

    order = order.filter((id) => id !== sourceId);
    const targetIndex = order.indexOf(targetId);
    order.splice(targetIndex >= 0 ? targetIndex : order.length, 0, sourceId);

    const hiddenIds = manualTripsOrder.filter(
      (id) => !idsInView.includes(id) && id !== sourceId,
    );
    const newOrder = [...order, ...hiddenIds];

    setManualTripsOrder(newOrder);
    localStorage.setItem("ratipa_plan_trips_order", JSON.stringify(newOrder));
  };

  const renderTripsGrid = (archived: boolean) => {
    let list = trips.filter((t) => !!t.isArchived === archived);
    if (!archived && activeDispatcherTab) {
      if (activeDispatcherTab === "Все диспетчеры") {
        list = list.filter((t) => filterDispatchers.includes(t.dispatcher));
      } else if (activeDispatcherTab !== "All") {
        list = list.filter((t) => t.dispatcher === activeDispatcherTab);
      }
    }
    if (!archived && activeDirectionTab !== "All") {
      list = list.filter((t) => t.direction === activeDirectionTab);
    }
    if (searchCarQuery.trim()) {
      const q = searchCarQuery.trim().toLowerCase();
      list = list.filter((t) => String(t.carNumber || '').toLowerCase().includes(q));
    }
    if (archived) {
      const months = Array.from(
        new Set(
          list
            .filter((t) => t.currentMonth)
            .map((t) => t.currentMonth as string),
        ),
      );
      let targetMonth = archiveMonth;
      if (!targetMonth && months.length > 0) {
        targetMonth = months[0];
        // Delaying state update slightly or just use it locally
      }
      if (targetMonth) {
        list = list.filter((t) => t.currentMonth === targetMonth);
      }
    }

    // Sort logic
    if (sortConfig) {
      list.sort((a, b) => {
        let valA: string | number = 0;
        let valB: string | number = 0;
        if (sortConfig.key === "carNumber") {
          valA = a.carNumber;
          valB = b.carNumber;
        } else if (sortConfig.key === "dateStart") {
          valA = a.dateStart;
          valB = b.dateStart;
        } else if (sortConfig.key === "km") {
          valA = a.factKm || a.totalKm || 0;
          valB = b.factKm || b.totalKm || 0;
        } else if (sortConfig.key === "freight") {
          valA = a.totalFreight || 0;
          valB = b.totalFreight || 0;
        } else if (sortConfig.key === "expenses") {
          valA = a.totalExpenses || 0;
          valB = b.totalExpenses || 0;
        } else if (sortConfig.key === "profit") {
          valA = a.profitFact || 0;
          valB = b.profitFact || 0;
        } else if (sortConfig.key === "profitDay") {
          valA = (a.profitFact || 0) / (a.days || 1);
          valB = (b.profitFact || 0) / (b.days || 1);
        }

        if (valA < valB) return sortConfig.dir === "asc" ? -1 : 1;
        if (valA > valB) return sortConfig.dir === "asc" ? 1 : -1;
        return 0;
      });
    } else {
      list.sort((a, b) => {
        const idxA = manualTripsOrder.indexOf(a.id);
        const idxB = manualTripsOrder.indexOf(b.id);
        if (idxA === -1 && idxB === -1) return b.id.localeCompare(a.id);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
      });
    }

    if (list.length === 0)
      return (
        <div className="text-center font-bold text-slate-400 py-10 uppercase tracking-widest font-mono text-sm">
          Пусто
        </div>
      );

    // Сводка
    let sumProfit = 0;
    let sumFreight = 0;
    let sumExpenses = 0;
    let sumKm = 0;
    let sumDays = 0;
    let profitableCount = 0;
    let factKmCount = 0;

    list.forEach((t) => {
      const profit =
        t.factKm && t.factKm > 0 ? t.profitFact || 0 : t.profit || 0;
      const freight = t.totalFreight || 0;
      const expenses = freight - profit;

      sumProfit += profit;
      sumFreight += freight;
      sumExpenses += expenses;
      sumKm += t.factKm && t.factKm > 0 ? t.factKm : t.totalKm || 0;
      sumDays += t.days || 1;
      if (profit > 0) profitableCount++;
      if (t.factKm && t.factKm > 0) factKmCount++;
    });

    const handleSort = (key: string) => {
      setSortConfig((prev) => {
        if (!prev || prev.key !== key) return { key, dir: "desc" };
        if (prev.dir === "desc") return { key, dir: "asc" };
        return null; // toggle off
      });
    };

    const SortIndicator = ({ sortKey }: { sortKey: string }) => {
      if (sortConfig?.key !== sortKey) return null;
      return (
        <span className="text-blue-500 ml-1">
          {sortConfig.dir === "asc" ? "↑" : "↓"}
        </span>
      );
    };

    return (
      <div className="flex flex-col gap-3 relative w-full overflow-x-auto transition-all duration-150" style={{ zoom: tableScale / 100 } as any}>
        {/* Table Headers */}
        <div className="hidden lg:flex px-6 pb-2 border-b border-slate-200/50 text-[10px] uppercase font-black tracking-widest text-slate-400 font-mono self-start w-full cursor-pointer select-none">
          <div
            className="min-w-[200px] hover:text-blue-500 transition"
            onClick={() => handleSort("carNumber")}
          >
            Автомобиль <SortIndicator sortKey="carNumber" />
          </div>
          <div
            className="min-w-[140px] hover:text-blue-500 transition"
            onClick={() => handleSort("dateStart")}
          >
            Даты <SortIndicator sortKey="dateStart" />
          </div>
          <div className="flex-1 min-w-[220px]">Маршрут</div>
          <div className="min-w-[280px] flex gap-4 pl-6">
            <span
              className="w-16 hover:text-blue-500 transition"
              onClick={() => handleSort("km")}
            >
              КМ <SortIndicator sortKey="km" />
            </span>
            <span
              className="w-16 hover:text-blue-500 transition"
              onClick={() => handleSort("freight")}
            >
              Фрахт <SortIndicator sortKey="freight" />
            </span>
            <span
              className="w-16 hover:text-blue-500 transition"
              onClick={() => handleSort("expenses")}
            >
              Расх <SortIndicator sortKey="expenses" />
            </span>
            <span
              className="w-[120px] ml-auto text-right hover:text-blue-500 transition"
              onClick={() => handleSort("profit")}
            >
              Прибыль <SortIndicator sortKey="profit" /> / Дни
            </span>
          </div>
        </div>

        {list.map((trip, idx) => {
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
                      title="В архив"
                    >
                      <Archive className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {user.role === "root_admin" && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteTrip(trip.id);
                      }}
                      className="p-1.5 text-slate-400 hover:text-rose-600 bg-slate-50 hover:bg-rose-50 rounded-lg transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-1.5 min-w-[140px] text-[11px] font-bold text-slate-500 font-mono">
                <div className="flex justify-between gap-4">
                  <span>ст.</span>{" "}
                  <span className="text-slate-800">
                    {trip.dateStart
                      ? new Date(trip.dateStart).toLocaleDateString("ru-RU")
                      : "-"}
                  </span>
                </div>
                <div className="flex justify-between gap-4">
                  <span>фн.</span>{" "}
                  <span className="text-slate-800">
                    {trip.dateEnd
                      ? new Date(trip.dateEnd).toLocaleDateString("ru-RU")
                      : "-"}
                  </span>
                </div>
                {trip.currentMonth && archived && (
                  <div className="flex justify-between gap-4 text-blue-500">
                    <span>архив</span> <span>{trip.currentMonth}</span>
                  </div>
                )}
              </div>

              <div className="flex-1 w-full bg-slate-50/50 rounded-2xl p-4 border border-slate-100 min-w-[220px]">
                <div className="text-sm font-black text-slate-900 mb-3">
                  {routeTitle}
                </div>
                {trip.legs && trip.legs.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {trip.legs.map((leg, i) => {
                      const isActive = trip.activeLegIndex === i;
                      return (
                        <div
                          key={i}
                          className={`flex items-center gap-2 text-[11px] font-bold font-mono p-1.5 -ml-1.5 rounded-lg ${isActive ? "bg-blue-500/10 text-blue-800" : "text-slate-500"}`}
                        >
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${isActive ? "bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.5)]" : "bg-slate-300"}`}
                          />
                          <span className="truncate">
                            {leg.from || "?"} ➔ {leg.to || "?"}
                          </span>
                          {leg.ferry > 0 ? (
                            <span
                              className="text-blue-400"
                              title={`Ферри: €${leg.ferry}`}
                            >
                              ⛴
                            </span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="text-[10px] font-bold text-slate-400 font-mono">
                    Не задан
                  </div>
                )}
              </div>

              <div className="flex flex-wrap lg:flex-nowrap items-center gap-4 sm:gap-6 xl:gap-8 w-full lg:w-auto justify-between lg:justify-end border-t lg:border-t-0 border-slate-100 pt-3 lg:pt-0">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] uppercase tracking-widest font-black text-slate-400 font-mono">
                    Пробег
                  </span>
                  <span className="text-[13px] font-black text-slate-800 font-mono whitespace-nowrap">
                    {Math.round(
                      trip.factKm || trip.totalKm || 0,
                    ).toLocaleString("ru-RU")}{" "}
                    км
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] uppercase tracking-widest font-black text-slate-400 font-mono">
                    Фрахт
                  </span>
                  <span className="text-[13px] font-black text-slate-800 font-mono whitespace-nowrap">
                    {Math.round(trip.totalFreight || 0).toLocaleString("ru-RU")}{" "}
                    €
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[9px] uppercase tracking-widest font-black text-rose-500/70 font-mono">
                    Расходы
                  </span>
                  <span className="text-[13px] font-black text-rose-600 font-mono whitespace-nowrap">
                    {Math.round(trip.totalExpenses || 0).toLocaleString(
                      "ru-RU",
                    )}{" "}
                    €
                  </span>
                </div>

                <div className="flex items-center gap-4 border-l-0 lg:border-l border-slate-200 pl-0 lg:pl-4 xl:pl-6 w-full sm:w-auto justify-between sm:justify-end">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest font-mono text-left lg:text-right mb-0.5">
                      Прибыль
                    </span>
                    <span
                      className={`text-xl font-black tracking-tighter leading-none whitespace-nowrap ${trip.profitFact < 0 ? "text-rose-500" : "text-slate-900"}`}
                    >
                      {Math.round(trip.profitFact || 0).toLocaleString("ru-RU")}{" "}
                      <span className="text-sm font-mono text-slate-400">
                        €
                      </span>
                    </span>
                  </div>
                  <div className="flex flex-col border-l border-slate-100 pl-4">
                    <span className="text-[9px] uppercase tracking-widest font-black text-slate-400 font-mono text-right mb-0.5">
                      Дни
                    </span>
                    <span className="text-sm font-black font-mono text-slate-600 text-right">
                      {trip.days || "-"}
                    </span>
                  </div>
                  <div className="flex flex-col border-l border-slate-100 pl-4">
                    <span className="text-[9px] uppercase tracking-widest font-black text-slate-400 font-mono text-right mb-0.5">
                      В день
                    </span>
                    <span
                      className={`text-sm font-black font-mono text-right whitespace-nowrap ${Math.round((trip.profitFact || 0) / (trip.days || 1)) < 0 ? "text-rose-500" : "text-green-600"}`}
                    >
                      {Math.round(
                        (trip.profitFact || 0) / (trip.days || 1),
                      ).toLocaleString("ru-RU")}{" "}
                      €
                    </span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {/* Сводка (Summary Box) */}
        <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col items-center">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest font-mono mb-1">
              Общая прибыль
            </span>
            <span
              className={`text-xl font-black ${sumProfit >= 0 ? "text-emerald-600" : "text-rose-500"}`}
            >
              {Math.round(sumProfit).toLocaleString("ru-RU")} €
            </span>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col items-center">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest font-mono mb-1">
              Маржинальность
            </span>
            <span className="text-xl font-black text-slate-800">
              {sumFreight > 0 ? Math.round((sumProfit / sumFreight) * 100) : 0}{" "}
              %
            </span>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col items-center">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest font-mono mb-1">
              Прибыль/день
            </span>
            <span className="text-xl font-black text-slate-800">
              {sumDays > 0
                ? Math.round(sumProfit / sumDays).toLocaleString("ru-RU")
                : 0}{" "}
              €
            </span>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col items-center">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest font-mono mb-1">
              Пробег
            </span>
            <span className="text-xl font-black text-slate-800">
              {Math.round(sumKm).toLocaleString("ru-RU")} км
            </span>
          </div>
          <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200/80 shadow-sm flex flex-col items-center">
            <span className="text-[9px] font-black uppercase text-slate-400 tracking-widest font-mono mb-1">
              Качество списка
            </span>
            <span className="text-xl font-black text-slate-800">
              {list.length > 0
                ? Math.round((profitableCount / list.length) * 100)
                : 0}{" "}
              %
            </span>
            <span className="text-[8px] uppercase font-bold text-slate-400 font-mono mt-0.5">
              В ПЛЮС: {profitableCount}/{list.length}
            </span>
          </div>
        </div>
      </div>
    );
  };

  const renderHistory = () => {
    return (
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
        <h2 className="text-sm font-black uppercase text-slate-800 tracking-wider mb-6 flex items-center gap-2">
          <History className="w-5 h-5 text-blue-500" /> История изменений
        </h2>
        <div className="space-y-3 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
          {logs
            .sort(
              (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
            )
            .map((log, idx) => (
              <div
                key={`${log.id || 'log'}_${idx}`}
                className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex flex-col">
                  <span className="text-xs font-black text-slate-900 mb-0.5">
                    {log.actionType}
                  </span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {log.details}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">
                  <div className="flex flex-col text-right">
                    <span>{log.user}</span>
                    <span>{log.role}</span>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    {new Date(log.date).toLocaleString("ru-RU", {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                </div>
              </div>
            ))}
          {logs.length === 0 && (
            <div className="text-sm text-slate-400 font-bold py-8 text-center bg-slate-50 rounded-2xl">
              История пуста
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="w-full space-y-6">
      <div className="bg-white rounded-[2rem] p-6 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col space-y-4">
        <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
          {/* ... Header ... */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="bg-blue-500 text-white font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono tracking-widest">
                Модуль План Firebase
              </span>
            </div>
            <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
              <TrendingUp className="w-6 h-6 text-blue-500" /> План Дохода
            </h1>
          </div>

          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex bg-slate-50 p-1.5 rounded-2xl border border-slate-200 overflow-x-auto max-w-full custom-scrollbar">
              <button
                onClick={() => {
                  resetForm();
                  setIsModalOpen(true);
                }}
                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center gap-2 bg-slate-900 text-white hover:bg-slate-800 shadow-sm border border-slate-800`}
              >
                <Plus className="w-4 h-4" /> Новый План
              </button>
              <button
                onClick={() => setActiveTab("active")}
                className={`ml-1 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center gap-2 ${activeTab === "active" ? "bg-white text-slate-950 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"}`}
              >
                <Calculator className="w-4 h-4" /> Активные
              </button>
              <button
                onClick={() => setActiveTab("archive")}
                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center gap-2 ${activeTab === "archive" ? "bg-white text-slate-950 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"}`}
              >
                <Archive className="w-4 h-4" /> Архив
              </button>
              <button
                type="button"
                onClick={toggleNotebook}
                className={`ml-1 px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center gap-2 ${isNotebookOpen ? "bg-amber-100 text-amber-900 shadow-sm border border-amber-200/50" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"}`}
              >
                <BookOpen className="w-4 h-4 text-amber-600" /> Блокнот
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest transition flex items-center gap-2 hidden md:flex ${activeTab === "history" ? "bg-white text-slate-950 shadow-sm border border-slate-200/50" : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"}`}
              >
                <History className="w-4 h-4" /> История
              </button>
            </div>
          </div>
        </div>

        <div className={activeTab === "active" ? "space-y-4" : "hidden"}>
          {activeDispatchers.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 border-t border-slate-100 pt-4 overflow-x-auto custom-scrollbar pb-2">
                {activeDispatchers.map((d) => (
                  <button
                    key={d}
                    draggable={d !== "Все диспетчеры"}
                    onDragStart={(e) => {
                      if (d === "Все диспетчеры") return;
                      e.dataTransfer.setData("dispatcher", d);
                    }}
                    onClick={() => setActiveDispatcherTab(d)}
                    className={`px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition flex items-center gap-1.5 whitespace-nowrap min-w-max ${getDispatcherActiveTabStyle(d)}`}
                  >
                    {d}
                  </button>
                ))}
              </div>

              {Object.keys(directions).length > 0 && (
                <div className="flex items-center gap-2 border-t border-slate-100 pt-3 overflow-x-auto custom-scrollbar pb-2">
                  <div className="flex gap-2">
                    {["All", ...Object.keys(directions)].map((dir) => (
                      <button
                        key={dir}
                        onClick={() => setActiveDirectionTab(dir)}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition ${activeDirectionTab === dir ? "bg-amber-100 text-amber-900 border-b-2 border-amber-500" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
                      >
                        {dir === "All" ? "Все направления" : dir}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={activeTab === "archive" ? "" : "hidden"}>
          <div className="flex items-center gap-2 border-t border-slate-100 pt-4 overflow-x-auto custom-scrollbar pb-2">
            <div className="flex gap-2">
              {Array.from(
                new Set(
                  trips
                    .filter((t) => t.isArchived && t.currentMonth)
                    .map((t) => t.currentMonth as string),
                ),
              ).map((month) => (
                <button
                  key={month}
                  onClick={() => setArchiveMonth(month)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const tripId = e.dataTransfer.getData("tripId");
                    if (tripId) {
                      pdService.updateTrip(
                        tripId,
                        { currentMonth: month },
                        user.name,
                        user.role,
                      );
                    }
                  }}
                  className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition whitespace-nowrap min-w-max ${archiveMonth === month ? "bg-blue-100 text-blue-900 border-b-2 border-blue-500" : "bg-slate-50 text-slate-500 hover:bg-slate-100"}`}
                >
                  📅 {month}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {(activeTab === "active" || activeTab === "archive") && (
          <div className="bg-white border border-slate-200 shadow-xs rounded-2xl p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 gap-y-4">
            <div className="flex items-center gap-3 flex-1 min-w-0">
              <Search className="w-4 h-4 text-slate-400 ml-1 shrink-0" />
              <input
                type="text"
                placeholder="Быстрый поиск автомобиля по номеру в таблице планирования..."
                value={searchCarQuery}
                onChange={(e) => setSearchCarQuery(e.target.value)}
                className="w-full bg-transparent text-xs font-bold uppercase tracking-wide text-slate-800 outline-none placeholder:text-slate-400 placeholder:normal-case"
              />
              {searchCarQuery && (
                <button
                  onClick={() => setSearchCarQuery("")}
                  className="text-xs hover:bg-slate-100 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 transition"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 pl-0 md:pl-4 border-t md:border-t-0 md:border-l border-slate-200 pt-3 md:pt-0 shrink-0">
              <span className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">Масштаб таблицы:</span>
              <button 
                onClick={() => {
                  const newScale = Math.max(50, tableScale - 10);
                  setTableScale(newScale);
                  localStorage.setItem("pd_table_scale", String(newScale));
                }}
                className="p-1 px-2.5 bg-slate-100 hover:bg-slate-200 text-xs font-black rounded-lg text-slate-600 transition cursor-pointer select-none"
                title="Уменьшить масштаб таблицы"
              >
                -
              </button>
              <span className="text-[11px] font-black font-mono text-slate-750 min-w-[36px] text-center select-none">{tableScale}%</span>
              <button 
                onClick={() => {
                  const newScale = Math.min(150, tableScale + 10);
                  setTableScale(newScale);
                  localStorage.setItem("pd_table_scale", String(newScale));
                }}
                className="p-1 px-2 bg-slate-100 hover:bg-slate-200 text-xs font-black rounded-lg text-slate-600 transition cursor-pointer select-none"
                title="Увеличить масштаб таблицы"
              >
                +
              </button>
              {tableScale !== 100 && (
                <button 
                  onClick={() => {
                    setTableScale(100);
                    localStorage.setItem("pd_table_scale", "100");
                  }}
                  className="text-[9px] uppercase font-black text-blue-500 hover:underline pl-1.5 transition cursor-pointer"
                  title="Сбросить к 100%"
                >
                  Сбросить
                </button>
              )}
            </div>
          </div>
        )}
        <div className={activeTab === "active" ? "" : "hidden"}>
          {renderTripsGrid(false)}
        </div>
        <div className={activeTab === "archive" ? "" : "hidden"}>
          {renderTripsGrid(true)}
        </div>
        <div className={activeTab === "history" ? "" : "hidden"}>
          {renderHistory()}
        </div>
      </div>

      {renderNotebookWidget()}
      {renderCurrentFormModal()}

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
                    <h3 className="text-lg font-black text-slate-800 tracking-tight">
                      Построение маршрута по карте
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

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100"></div>

              {/* Intermediate Waypoints */}
              <div className="bg-slate-50/50 p-4 rounded-2xl border border-dashed border-slate-200 flex flex-col gap-3">
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
                        className="flex items-center gap-2 animate-fade-in"
                      >
                        <span className="text-[9px] font-bold text-slate-400 font-mono min-w-[15px]">
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
                          className="flex-1 bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-700 outline-none focus:border-blue-500 transition"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const newWps = mapWaypoints.filter(
                              (_, idx) => idx !== index,
                            );
                            setMapWaypoints(newWps);
                          }}
                          className="p-1 text-[#70FC8E] bg-slate-900 border border-slate-700/50 hover:bg-slate-800 transition rounded-lg hover:text-rose-50 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 bg-slate-50 p-3 rounded-2xl border border-slate-100">
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono">
                    Пункт отправления (Откуда)
                  </label>
                  <input
                    type="text"
                    value={mapOrigin}
                    onChange={(e) => setMapOrigin(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 transition"
                    placeholder="Введите город отправления..."
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono">
                    Пункт назначения (Куда)
                  </label>
                  <input
                    type="text"
                    value={mapDestination}
                    onChange={(e) => setMapDestination(e.target.value)}
                    className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none focus:border-blue-500 transition"
                    placeholder="Введите город назначения..."
                  />
                </div>
              </div>

              <div className="mt-2 bg-slate-50/50 p-3 rounded-2xl border border-dashed border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 items-center">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mapAvoidTolls}
                    onChange={(e) => setMapAvoidTolls(e.target.checked)}
                    className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-tight font-mono">
                    Без платных
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mapAvoidHighways}
                    onChange={(e) => setMapAvoidHighways(e.target.checked)}
                    className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-[10px] font-black text-slate-600 uppercase tracking-tight font-mono">
                    Без шоссе
                  </span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={mapAvoidFerries}
                    onChange={(e) => setMapAvoidFerries(e.target.checked)}
                    className="w-3.5 h-3.5 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                  <span className="text-[10px] font Black text-slate-600 uppercase tracking-tight font-mono">
                    Без паромов
                  </span>
                </label>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[8px] font-black uppercase text-slate-400 font-mono">
                    Тип авто
                  </span>
                  <span className="bg-slate-100 border border-slate-200 rounded-lg px-2.5 py-1 text-[10px] font-bold text-slate-700">
                    Грузовой
                  </span>
                </div>
              </div>

              <div className="mt-2 bg-slate-50/50 p-3 rounded-2xl border border-dashed border-slate-200 flex flex-col sm:flex-row gap-3 items-stretch justify-between">
                <div className="flex-1 flex flex-col gap-1">
                  <span className="text-[8px] font-black uppercase text-slate-400 font-mono">
                    Избегать ключевых слов (трассы, города, напр: M1, Польша)
                  </span>
                  <input
                    type="text"
                    placeholder="Введите слова через запятую..."
                    value={mapAvoidKeywords}
                    onChange={(e) => setMapAvoidKeywords(e.target.value)}
                    className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-[11px] font-bold text-slate-700 outline-none focus:border-blue-500 w-full"
                  />
                </div>

                {mapAvoidedStatus.attempted && (
                  <div className="flex items-center min-w-[200px] justify-end">
                    {mapAvoidedStatus.avoidedSuccessfully ? (
                      <div className="bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl px-2.5 py-1 text-[10px] font-bold flex items-center gap-1.5 shadow-sm">
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Взят маршрут в обход</span>
                      </div>
                    ) : mapAvoidedStatus.matches.length > 0 ? (
                      <div className="bg-amber-50 text-amber-700 border border-amber-200 rounded-xl px-2.5 py-1 text-[10px] font-bold flex items-center gap-1.5 shadow-sm">
                        <X className="w-3.5 h-3.5 text-amber-600" />
                        <span>
                          Используется: {mapAvoidedStatus.matches.join(", ")}
                        </span>
                      </div>
                    ) : (
                      <div className="bg-blue-50 text-blue-700 border border-blue-200 rounded-xl px-2.5 py-1 text-[10px] font-bold flex items-center gap-1.5 shadow-sm">
                        <Check className="w-3.5 h-3.5 text-blue-600" />
                        <span>Маршрут чист</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="h-[400px] w-full bg-slate-100 relative">
              {!(
                settings?.googleMapsApiKey ||
                API_KEY ||
                (window as any).GOOGLE_MAPS_PLATFORM_KEY
              ) ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-6 bg-slate-50 text-center border-t border-b border-slate-100">
                  <div className="bg-amber-50 text-amber-600 p-3 rounded-2xl mb-3 border border-amber-100 animate-pulse">
                    <MapPin className="w-6 h-6" />
                  </div>
                  <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider mb-2">
                    Необходим API Ключ Google Maps
                  </h4>
                  <p className="text-xs text-slate-500 max-w-md leading-relaxed mb-4 font-medium">
                    Чтобы строить маршруты напрямую и рассчитывать километраж,
                    пожалуйста, добавьте ваш API ключ Google Maps Platform.
                  </p>
                  <div className="bg-white rounded-2xl border border-slate-200/80 p-4 text-left text-[11px] text-slate-600 max-w-lg space-y-2.5 shadow-sm leading-relaxed">
                    <div>
                      <strong>Шаг 1:</strong>{" "}
                      <a
                        href="https://console.cloud.google.com/google/maps-apis/start?utm_campaign=gmp-code-assist-ais"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-600 font-bold hover:underline"
                      >
                        Получить API Ключ Google Cloud
                      </a>{" "}
                      и активировать <strong>Maps JavaScript API</strong> и{" "}
                      <strong>Routes API</strong>.
                    </div>
                    <div>
                      <strong>Шаг 2:</strong> Перейдите в{" "}
                      <strong>Settings</strong> (значок шестерёнки ⚙️ в верхнем
                      правом углу панели AI Studio) ➔ <strong>Secrets</strong> ➔
                      добавьте секрет с именем{" "}
                      <code>GOOGLE_MAPS_PLATFORM_KEY</code> и вставьте туда ваш
                      API ключ.
                    </div>
                    <div className="text-slate-400 font-bold uppercase text-[9px] font-mono border-t border-slate-100 pt-2 flex items-center gap-1.5">
                      <span>● автоматическая сборка</span>
                      <span>● перезагрузка не требуется</span>
                    </div>
                  </div>
                </div>
              ) : mapOrigin && mapDestination ? (
                <APIProvider
                  apiKey={settings?.googleMapsApiKey || API_KEY}
                  version="weekly"
                >
                  <Map
                    defaultCenter={{ lat: 53.9006, lng: 27.559 }}
                    defaultZoom={5}
                    mapId="ROUTE_MAP"
                    internalUsageAttributionIds={[
                      "gmp_mcp_codeassist_v1_aistudio",
                    ]}
                    style={{ width: "100%", height: "100%" }}
                    gestureHandling={"greedy"}
                    disableDefaultUI={true}
                  >
                    <RouteDisplay
                      origin={mapOrigin}
                      destination={mapDestination}
                      onDistance={setMapKmResult}
                      avoidTolls={mapAvoidTolls}
                      avoidKeywords={mapAvoidKeywords}
                      onRouteStatus={setMapAvoidedStatus}
                      avoidHighways={mapAvoidHighways}
                      avoidFerries={mapAvoidFerries}
                      vehicleType={mapVehicleType}
                      waypoints={mapWaypoints}
                    />
                  </Map>
                </APIProvider>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-400 font-bold text-xs uppercase tracking-wider">
                  Введите пункты отправления и назначения для прокладки маршрута
                </div>
              )}
            </div>

            <div className="p-6 bg-slate-50 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
              <div className="flex flex-col md:flex-row items-start md:items-center gap-4">
                <div className="flex flex-col">
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">
                    Расстояние КМ
                  </span>
                  <input
                    type="number"
                    value={mapKmResult || ""}
                    onChange={(e) => setMapKmResult(Number(e.target.value))}
                    className="w-32 bg-white border border-slate-200 rounded-xl px-4 py-2 font-black text-blue-600 text-lg outline-none focus:border-blue-500"
                  />
                </div>

                <label className="flex items-center gap-2.5 cursor-pointer select-none bg-blue-50/45 hover:bg-blue-50/80 px-4 py-2.5 rounded-xl border border-blue-100/55 transition mt-4 md:mt-0">
                  <input
                    type="checkbox"
                    checked={saveToDirectoryChecked}
                    onChange={(e) =>
                      setSaveToDirectoryChecked(e.target.checked)
                    }
                    className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                  />
                  <div className="flex flex-col">
                    <span className="text-xs font-black text-slate-700">
                      Сохранить также в справочник
                    </span>
                    <span className="text-[9px] text-slate-400 font-bold uppercase font-mono tracking-wider">
                      Добавить в базу расстояний
                    </span>
                  </div>
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
                  className="px-6 py-3 rounded-xl font-black text-xs uppercase bg-blue-600 text-white shadow-sm shadow-blue-500/30 hover:bg-blue-700 transition flex gap-2 items-center justify-center"
                >
                  <Check className="w-4 h-4" /> Внести в плечо
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

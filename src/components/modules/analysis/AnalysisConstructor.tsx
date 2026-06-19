import React, { useState, useEffect, useRef, useMemo } from 'react';
import { APIProvider, Map, useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import { useFirebase, database, dbService } from '../../../firebase';
import { pdService } from '../../../firebase/planDohodService';
import { ref, get } from 'firebase/database';
import { 
  MapPin, Plus, Trash2, X, Check, Copy, ArrowDownUp, 
  ArrowUpDown, MoveUp, MoveDown, Search, HelpCircle, 
  Sparkles, AlertCircle, RefreshCw, Layers, Compass, ExternalLink,
  ChevronDown, DollarSign, Navigation, Route, AlertTriangle
} from 'lucide-react';

const STATIC_FALLBACK_API_KEY = (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY || '';

// Helper for haversine calculation
function haversineDistance(p1: google.maps.LatLng, p2: google.maps.LatLng): number {
  const R = 6371e3; // Earth radius in meters
  const lat1 = (p1.lat() * Math.PI) / 180;
  const lat2 = (p2.lat() * Math.PI) / 180;
  const deltaLat = ((p2.lat() - p1.lat()) * Math.PI) / 180;
  const deltaLng = ((p2.lng() - p1.lng()) * Math.PI) / 180;

  const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

function geocodeFallback(
  fromAddress: string,
  toAddress: string,
  map: google.maps.Map,
  color: string,
  weight: number,
  opacity: number,
  polylinesRef: React.MutableRefObject<google.maps.Polyline[]>
) {
  const resolve = async (address: string): Promise<google.maps.LatLng | null> => {
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
          return new google.maps.LatLng(data.lat, data.lng);
        }
      }
    } catch (err) {
      console.error("Geocode api failed:", err);
    }
    return null;
  };

  Promise.all([resolve(fromAddress), resolve(toAddress)]).then(([p1, p2]) => {
    if (p1 && p2) {
      const line = new google.maps.Polyline({
        path: [p1, p2],
        geodesic: true,
        strokeColor: color,
        strokeWeight: weight,
        strokeOpacity: opacity,
        map: map
      });
      polylinesRef.current.push(line);

      // Add simple marker at the source and target if they aren't already there
      const marker1 = new google.maps.Marker({
        position: p1,
        map: map,
        title: fromAddress,
        label: { text: "•", color: "#fafafa", fontWeight: "bold" }
      });
      const marker2 = new google.maps.Marker({
        position: p2,
        map: map,
        title: toAddress,
        label: { text: "•", color: "#fafafa", fontWeight: "bold" }
      });
      (line as any)._fallback_markers = [marker1, marker2];
    }
  });
}

// Sub-component to trace route on the Map
function RouteMapLayer({ legs, activeLegIndex }: { legs: any[]; activeLegIndex: number | null }) {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [pdSettings, setPdSettings] = useState<any>({ routingProvider: 'osrm', openRouteServiceApiKey: '' });

  useEffect(() => {
    const unsub = pdService.subscribePlanDohodSettings((settings) => {
      setPdSettings(settings || { routingProvider: 'osrm', openRouteServiceApiKey: '' });
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!map) return;

    let active = true;

    // Clear previous polylines
    polylinesRef.current.forEach(p => {
      p.setMap(null);
      if ((p as any)._fallback_markers) {
        (p as any)._fallback_markers.forEach((m: any) => m.setMap(null));
      }
    });
    polylinesRef.current = [];

    const apiKey = pdSettings?.openRouteServiceApiKey || '';
    const isOrs = pdSettings?.routingProvider === 'openrouteservice';
    const resolve = async (address: string): Promise<google.maps.LatLng | null> => {
      try {
        const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
            return new google.maps.LatLng(data.lat, data.lng);
          }
        }
      } catch (err) {
        console.error("Geocode api failed:", err);
      }
      return null;
    };

    legs.forEach(async (leg, idx) => {
      if (!leg.from || !leg.to) return;

      const isActive = activeLegIndex === null || activeLegIndex === idx;
      const color = isActive ? '#f43f5e' : '#94a3b8';
      const weight = isActive ? 6 : 4;
      const opacity = isActive ? 1.0 : 0.5;

      // Resolve coordinates
      const [c1, c2] = await Promise.all([resolve(leg.from), resolve(leg.to)]);
      if (!active) return;
      if (!c1 || !c2) return;

      let polylinePath: google.maps.LatLngLiteral[] = [];

      if (isOrs && apiKey && apiKey.trim() !== '') {
        try {
          const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': apiKey
            },
            body: JSON.stringify({
              coordinates: [[c1.lng(), c1.lat()], [c2.lng(), c2.lat()]],
              preference: 'fastest'
            })
          });

          if (response.ok) {
            const data = await response.json();
            if (data.features && data.features[0]) {
              const feature = data.features[0];
              const rawCoordinates = feature.geometry?.coordinates || [];
              polylinePath = rawCoordinates.map((coord: any) => ({
                lat: coord[1],
                lng: coord[0]
              }));
            }
          }
        } catch (e) {
          console.error("RouteMapLayer OpenRouteService driving-car failed:", e);
        }
      } else {
        // Default: OSRM
        try {
          const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${c1.lng()},${c1.lat()};${c2.lng()},${c2.lat()}?overview=full&geometries=geojson`);

          if (response.ok) {
            const data = await response.json();
            if (data.code === 'Ok' && data.routes && data.routes[0]) {
              const route = data.routes[0];
              const rawCoordinates = route.geometry?.coordinates || [];
              polylinePath = rawCoordinates.map((coord: any) => ({
                lat: coord[1],
                lng: coord[0]
              }));
            }
          }
        } catch (e) {
          console.error("RouteMapLayer OSRM failed:", e);
        }
      }

      if (polylinePath.length === 0) {
        polylinePath = [{ lat: c1.lat(), lng: c1.lng() }, { lat: c2.lat(), lng: c2.lng() }];
      }

      if (!active) return;

      const line = new google.maps.Polyline({
        path: polylinePath,
        geodesic: true,
        strokeColor: color,
        strokeWeight: weight,
        strokeOpacity: opacity,
        map: map
      });
      polylinesRef.current.push(line);

      const marker1 = new google.maps.Marker({
        position: c1,
        map: map,
        label: { text: "•", color: "#ffffff", fontWeight: "bold" }
      });
      const marker2 = new google.maps.Marker({
        position: c2,
        map: map,
        label: { text: "•", color: "#ffffff", fontWeight: "bold" }
      });
      (line as any)._fallback_markers = [marker1, marker2];
    });

    return () => {
      active = false;
      polylinesRef.current.forEach(p => {
        p.setMap(null);
        if ((p as any)._fallback_markers) {
          (p as any)._fallback_markers.forEach((m: any) => m.setMap(null));
        }
      });
      polylinesRef.current = [];
    };
  }, [map, legs, activeLegIndex, pdSettings]);

  return null;
}

// Inline Map component inside the interactive distance calculation modal
function ModalMapRenderer({ 
  origin, 
  destination, 
  waypoints, 
  avoidTolls, 
  avoidHighways, 
  avoidFerries, 
  onCalculated 
}: { 
  origin: string; 
  destination: string; 
  waypoints: string[]; 
  avoidTolls: boolean; 
  avoidHighways: boolean; 
  avoidFerries: boolean; 
  onCalculated: (km: number) => void; 
}) {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [pdSettings, setPdSettings] = useState<any>({ routingProvider: 'osrm', openRouteServiceApiKey: '' });

  useEffect(() => {
    const unsub = pdService.subscribePlanDohodSettings((settings) => {
      setPdSettings(settings || { routingProvider: 'osrm', openRouteServiceApiKey: '' });
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!map || !origin.trim() || !destination.trim()) return;

    let active = true;

    polylinesRef.current.forEach(p => {
      p.setMap(null);
      if ((p as any)._fallback_markers) {
        (p as any)._fallback_markers.forEach((m: any) => m.setMap(null));
      }
    });
    polylinesRef.current = [];

    const isOrs = pdSettings?.routingProvider === 'openrouteservice';

    if (isOrs) {
      runORS();
    } else {
      runOSRM();
    }

    async function runORS() {
      const apiKey = pdSettings?.openRouteServiceApiKey || '';
      const resolve = async (address: string): Promise<google.maps.LatLng | null> => {
        try {
          const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
              return new google.maps.LatLng(data.lat, data.lng);
            }
          }
        } catch (err) {
          console.error("Geocode api failed:", err);
        }
        return null;
      };

      const activeWaypoints = waypoints.filter(w => w.trim().length > 0);
      const coords = await Promise.all([
        resolve(origin),
        ...activeWaypoints.map(w => resolve(w)),
        resolve(destination)
      ]);

      const validCoords = coords.filter((c): c is google.maps.LatLng => c !== null);
      if (validCoords.length < 2) return;

      let distanceKm = 0;
      let polylinePath: google.maps.LatLngLiteral[] = [];

      if (apiKey && apiKey.trim() !== '') {
        const coordinates = validCoords.map(vc => [vc.lng(), vc.lat()]);
        try {
          const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': apiKey
            },
            body: JSON.stringify({
              coordinates: coordinates,
              preference: 'fastest'
            })
          });

          if (response.ok) {
            const data = await response.json();
            if (data.features && data.features[0]) {
              const feature = data.features[0];
              const distanceMeters = feature.properties?.summary?.distance || 0;
              const rawCoordinates = feature.geometry?.coordinates || [];
              polylinePath = rawCoordinates.map((coord: any) => ({
                lat: coord[1],
                lng: coord[0]
              }));
              distanceKm = Math.round(distanceMeters / 1000);
            }
          }
        } catch (e) {
          console.error("OpenRouteService ModalMapRenderer failed:", e);
        }
      }

      if (polylinePath.length === 0) {
        polylinePath = validCoords.map(vc => ({ lat: vc.lat(), lng: vc.lng() }));
        let totalMeters = 0;
        for (let i = 0; i < validCoords.length - 1; i++) {
          totalMeters += haversineDistance(validCoords[i], validCoords[i + 1]);
        }
        distanceKm = Math.round((totalMeters / 1000) * 1.28);
      }

      const line = new google.maps.Polyline({
        path: polylinePath,
        geodesic: true,
        strokeColor: '#3b82f6',
        strokeWeight: 6,
        map: map
      });
      polylinesRef.current.push(line);

      const fallbackMarkers: google.maps.Marker[] = [];
      validCoords.forEach((coord, i) => {
        let label = "•";
        if (i === 0) label = "A";
        else if (i === validCoords.length - 1) label = "B";
        else label = String(i);

        const m = new google.maps.Marker({
          position: coord,
          map: map,
          label: { text: label, color: '#ffffff', fontWeight: 'bold' }
        });
        fallbackMarkers.push(m);
      });
      (line as any)._fallback_markers = fallbackMarkers;

      onCalculated(distanceKm);

      const bounds = new google.maps.LatLngBounds();
      validCoords.forEach(c => bounds.extend(c));
      map.fitBounds(bounds);
    }

    async function runOSRM() {
      const resolve = async (address: string): Promise<google.maps.LatLng | null> => {
        try {
          const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
          if (res.ok) {
            const data = await res.json();
            if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
              return new google.maps.LatLng(data.lat, data.lng);
            }
          }
        } catch (err) {
          console.error("Geocode api failed:", err);
        }
        return null;
      };

      const activeWaypoints = waypoints.filter(w => w.trim().length > 0);
      const coords = await Promise.all([
        resolve(origin),
        ...activeWaypoints.map(w => resolve(w)),
        resolve(destination)
      ]);

      const validCoords = coords.filter((c): c is google.maps.LatLng => c !== null);
      if (validCoords.length < 2) return;

      let distanceKm = 0;
      let polylinePath: google.maps.LatLngLiteral[] = [];

      const coordinates = validCoords.map(vc => `${vc.lng()},${vc.lat()}`).join(';');
      try {
        const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson`);

        if (response.ok) {
          const data = await response.json();
          if (data.code === 'Ok' && data.routes && data.routes[0]) {
            const route = data.routes[0];
            const distanceMeters = route.distance || 0;
            const rawCoordinates = route.geometry?.coordinates || [];
            polylinePath = rawCoordinates.map((coord: any) => ({
              lat: coord[1],
              lng: coord[0]
            }));
            distanceKm = Math.round(distanceMeters / 1000);
          }
        }
      } catch (e) {
        console.error("OSRM ModalMapRenderer failed:", e);
      }

      if (polylinePath.length === 0) {
        polylinePath = validCoords.map(vc => ({ lat: vc.lat(), lng: vc.lng() }));
        let totalMeters = 0;
        for (let i = 0; i < validCoords.length - 1; i++) {
          totalMeters += haversineDistance(validCoords[i], validCoords[i + 1]);
        }
        distanceKm = Math.round((totalMeters / 1000) * 1.28);
      }

      const line = new google.maps.Polyline({
        path: polylinePath,
        geodesic: true,
        strokeColor: '#3b82f6',
        strokeWeight: 6,
        map: map
      });
      polylinesRef.current.push(line);

      const fallbackMarkers: google.maps.Marker[] = [];
      validCoords.forEach((coord, i) => {
        let label = "•";
        if (i === 0) label = "A";
        else if (i === validCoords.length - 1) label = "B";
        else label = String(i);

        const m = new google.maps.Marker({
          position: coord,
          map: map,
          label: { text: label, color: '#ffffff', fontWeight: 'bold' }
        });
        fallbackMarkers.push(m);
      });
      (line as any)._fallback_markers = fallbackMarkers;

      onCalculated(distanceKm);

      const bounds = new google.maps.LatLngBounds();
      validCoords.forEach(c => bounds.extend(c));
      map.fitBounds(bounds);
    }

    return () => {
      active = false;
      polylinesRef.current.forEach(p => {
        p.setMap(null);
        if ((p as any)._fallback_markers) {
          (p as any)._fallback_markers.forEach((m: any) => m.setMap(null));
        }
      });
      polylinesRef.current = [];
    };
  }, [map, origin, destination, waypoints, avoidTolls, avoidHighways, avoidFerries, onCalculated, pdSettings]);

  return null;
}

export default function AnalysisConstructor() {
  const [pdSettings, setPdSettings] = useState<any>({ googleMapsApiKey: '' });
  
  // Visual blocks/legs of the constructed route sequence
  const [legs, setLegs] = useState<any[]>([
    { from: 'Москва', to: 'Казань', dist: 820, freight: 1250, coeff: 0.8, ferryCost: 0, notes: 'Вводное плечо' }
  ]);
  
  const [activeLegIndex, setActiveLegIndex] = useState<number | null>(null);

  // Live currency rates from NBRB
  const [nbrbRates, setNbrbRates] = useState<Record<string, { scale: number; rate: number }>>({
    BYN: { scale: 1, rate: 1.0 },
    USD: { scale: 1, rate: 3.25 },
    EUR: { scale: 1, rate: 3.55 },
    RUB: { scale: 100, rate: 3.42 },
  });

  // Setup template subscription states
  const [directions, setDirections] = useState<any[]>([]);
  const [distances, setDistances] = useState<any[]>([]);

  // Database directions for quick choosing
  const [dataLoaded, setDataLoaded] = useState(false);
  const [allRegions, setAllRegions] = useState<any[]>([]);
  const [allRecords, setAllRecords] = useState<any[]>([]);
  const [allGroups, setAllGroups] = useState<any[]>([]);
  
  // Selection popup trigger
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTargetIndex, setPickerTargetIndex] = useState<number | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerTab, setPickerTab] = useState<'directions' | 'records'>('directions');

  // NBRB live exchange rate conversion state
  const [conversionModalOpen, setConversionModalOpen] = useState(false);
  const [pendingConversion, setPendingConversion] = useState<any | null>(null);

  // Interactive Distance Map Modal
  const [distanceModalOpen, setDistanceModalOpen] = useState(false);
  const [distanceTargetLegIdx, setDistanceTargetLegIdx] = useState<number | null>(null);
  const [modalOrigin, setModalOrigin] = useState('');
  const [modalDestination, setModalDestination] = useState('');
  const [modalWaypoints, setModalWaypoints] = useState<string[]>([]);
  const [modalAvoidTolls, setModalAvoidTolls] = useState(false);
  const [modalAvoidHighways, setModalAvoidHighways] = useState(false);
  const [modalAvoidFerries, setModalAvoidFerries] = useState(false);
  const [modalCalculatedKm, setModalCalculatedKm] = useState(0);
  const [saveDistanceToTemplates, setSaveDistanceToTemplates] = useState(true);

  // Load interactive database presets & NBRB exchange rates
  useEffect(() => {
    // 1. Subscribe to PlanDohod Settings for API key
    const unsubPdSettings = pdService.subscribePlanDohodSettings((settings) => {
      if (settings) setPdSettings(settings);
    });

    // 2. Fetch live NBRB rates directly with fallbacks
    fetch('https://api.nbrb.by/exrates/rates?periodicity=0')
      .then(res => res.json())
      .then((data: any[]) => {
        const updated: Record<string, { scale: number; rate: number }> = {
          BYN: { scale: 1, rate: 1.0 },
          USD: { scale: 1, rate: 3.25 },
          EUR: { scale: 1, rate: 3.55 },
          RUB: { scale: 100, rate: 3.42 },
          TRY: { scale: 10, rate: 1.0 },
          KZT: { scale: 1000, rate: 7.2 },
          CNY: { scale: 10, rate: 4.5 },
        };
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item && ['USD', 'EUR', 'RUB', 'TRY', 'CNY', 'KZT'].includes(item.Cur_Abbreviation)) {
              updated[item.Cur_Abbreviation] = {
                scale: item.Cur_Scale || 1,
                rate: item.Cur_OfficialRate || 1.0
              };
            }
          });
        }
        setNbrbRates(updated);
      })
      .catch(err => console.warn("Constructor NBRB fetch failed, using fallback rates:", err));

    // 3. Load analytical database records for picker
    if (useFirebase) {
      const loadDatabaseData = async () => {
        try {
          const regionsSnap = await get(ref(database, 'analysisRegions'));
          const rData = regionsSnap.val();
          if (!rData) return;
          
          const regionsList = Object.keys(rData).map(k => ({ id: k, name: rData[k].name }));
          setAllRegions(regionsList);

          const fetchedRecords: any[] = [];
          const fetchedGroups: any[] = [];

          for (const reg of regionsList) {
            // Records (carriers lines)
            const snap = await get(ref(database, `analysisRecords/${reg.id}`));
            const snapData = snap.val();
            if (snapData) {
              Object.keys(snapData).forEach(k => {
                fetchedRecords.push({
                  id: k,
                  regionId: reg.id,
                  regionName: reg.name,
                  ...snapData[k]
                });
              });
            }

            // Groups (Directions/Main routes)
            const snapG = await get(ref(database, `analysisGroups/${reg.id}`));
            const gData = snapG.val();
            if (gData) {
              Object.keys(gData).forEach(k => {
                fetchedGroups.push({
                  id: k,
                  regionId: reg.id,
                  regionName: reg.name,
                  ...gData[k]
                });
              });
            }
          }
          setAllRecords(fetchedRecords);
          setAllGroups(fetchedGroups);
          setDataLoaded(true);
        } catch (e) {
          console.error("Error loading database inside constructor:", e);
        }
      };
      loadDatabaseData();

      // Subscribe to standard logistics presets for distance & directions
      const unsubDirs = dbService.getDirections((dirs) => {
        if (Array.isArray(dirs)) setDirections(dirs);
      });
      const unsubDists = dbService.getDistances((dists) => {
        if (Array.isArray(dists)) setDistances(dists);
      });

      return () => {
        unsubPdSettings();
        unsubDirs();
        unsubDists();
      };
    } else {
      return () => unsubPdSettings();
    }
  }, []);

  // Safe parsing helper functions
  const parseCities = (routeStr: string) => {
    if (!routeStr) return { from: '', to: '' };
    const clean = routeStr.replace(/\s+/g, ' ');
    const parts = clean.split(/[-—–➔→]|\s+на\s+|\s+в\s+/).map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        from: parts[0],
        to: parts[parts.length - 1]
      };
    }
    return { from: routeStr, to: '' };
  };

  const parseRecordRate = (rateStr: string) => {
    if (!rateStr) return null;
    const clean = rateStr.replace(/\s/g, '').replace(',', '.').toLowerCase();
    const numericMatch = clean.match(/\d+(?:\.\d+)?/);
    if (!numericMatch) return null;
    const value = parseFloat(numericMatch[0]);
    
    let currency = 'RUB'; // Default fallback
    if (clean.includes('eur') || clean.includes('евро') || clean.includes('€')) {
      currency = 'EUR';
    } else if (clean.includes('byn') || clean.includes('бел') || clean.includes('б.р.')) {
      currency = 'BYN';
    } else if (clean.includes('usd') || clean.includes('$')) {
      currency = 'USD';
    } else if (value < 10000) {
      // Small rate entered is probably already EUR or USD
      if (clean.includes('$')) currency = 'USD';
      else if (clean.includes('€') || clean.includes('eur')) currency = 'EUR';
    }
    
    let finalVal = value;
    if (clean.includes('к') || clean.includes('k')) {
      if (finalVal < 1000) {
        finalVal = finalVal * 1000;
      }
    }
    return { value: finalVal, currency };
  };

  // Convert rate to EUR via Live NBRB rates
  const convertToEur = (amount: number, fromCurrency: string) => {
    const fromCur = fromCurrency.toUpperCase();
    if (fromCur === 'EUR') return amount;
    
    const rateFromObj = nbrbRates[fromCur] || { scale: 1, rate: 1.0 };
    const rateFrom = rateFromObj.rate / rateFromObj.scale;
    
    const rateEurObj = nbrbRates['EUR'] || { scale: 1, rate: 3.55 };
    const rateEur = rateEurObj.rate / rateEurObj.scale;
    
    const bynAmount = amount * rateFrom;
    return rateEur > 0 ? Math.round(bynAmount / rateEur) : amount;
  };

  // Lookup distance in common distances template pool
  const findDistanceInPool = (c1: string, c2: string): number => {
    if (!c1 || !c2) return 0;
    const from = c1.trim().toLowerCase();
    const to = c2.trim().toLowerCase();
    const found = distances.find(d => {
        const a = d.from.trim().toLowerCase();
        const b = d.to.trim().toLowerCase();
        return (a === from && b === to) || (a === to && b === from);
    });
    return found ? Number(found.distance) : 0;
  };

  // Safe direction expense coefficient loading
  const getDirCoeff = (dest: string): number => {
    if (!dest) return 0.8;
    const found = directions.find(d => 
      d.name?.trim().toLowerCase().includes(dest.trim().toLowerCase()) || 
      dest.trim().toLowerCase().includes(d.name?.trim().toLowerCase())
    );
    return found ? found.coeff : 0.8;
  };

  // Constructor actions
  const addLeg = (idx?: number) => {
    // Instead of adding an empty leg, we directly open choices picker to select.
    const targetIdx = idx !== undefined ? idx + 1 : legs.length;
    openPicker(targetIdx);
  };

  const removeLeg = (idx: number) => {
    if (legs.length <= 1) return;
    const n = legs.filter((_, i) => i !== idx);
    setLegs(n);
    if (activeLegIndex === idx) {
      setActiveLegIndex(null);
    }
  };

  const updateLeg = (idx: number, patch: any) => {
    setLegs(legs.map((l, i) => i === idx ? { ...l, ...patch } : l));
  };

  const duplicateLeg = (idx: number) => {
    const original = legs[idx];
    const n = [...legs];
    n.splice(idx + 1, 0, { ...original });
    setLegs(n);
    setActiveLegIndex(idx + 1);
  };

  const reverseLeg = (idx: number) => {
    const original = legs[idx];
    const newFrom = original.to;
    const newTo = original.from;
    const autoDistance = findDistanceInPool(newFrom, newTo);
    
    updateLeg(idx, {
      from: newFrom,
      to: newTo,
      dist: autoDistance || original.dist
    });
  };

  const moveUp = (idx: number) => {
    if (idx === 0) return;
    const n = [...legs];
    const temp = n[idx];
    n[idx] = n[idx - 1];
    n[idx - 1] = temp;
    setLegs(n);
    if (activeLegIndex === idx) setActiveLegIndex(idx - 1);
    else if (activeLegIndex === idx - 1) setActiveLegIndex(idx);
  };

  const moveDown = (idx: number) => {
    if (idx === legs.length - 1) return;
    const n = [...legs];
    const temp = n[idx];
    n[idx] = n[idx + 1];
    n[idx + 1] = temp;
    setLegs(n);
    if (activeLegIndex === idx) setActiveLegIndex(idx + 1);
    else if (activeLegIndex === idx + 1) setActiveLegIndex(idx);
  };

  // Select item from analytical directions picker
  const openPicker = (idx: number) => {
    setPickerTargetIndex(idx);
    setPickerSearch('');
    setPickerOpen(true);
  };

  const selectGroupDirection = (group: any) => {
    if (pickerTargetIndex === null) return;
    const { from, to } = parseCities(group.name);
    
    // Find all records under this group ID to calculate the average rate!
    const groupRecords = allRecords.filter(r => r.groupId === group.id || r.groupName === group.name);
    
    let totalRateVal = 0;
    let validRatesCount = 0;
    let detectedCur = 'RUB';

    groupRecords.forEach(rec => {
      const parsed = parseRecordRate(rec.rate);
      if (parsed) {
        totalRateVal += parsed.value;
        validRatesCount++;
        detectedCur = parsed.currency;
      }
    });

    const averageRate = validRatesCount > 0 
      ? Math.round(totalRateVal / validRatesCount) 
      : 0;

    const autoDistance = findDistanceInPool(from, to);
    const resolvedCoeff = getDirCoeff(to);

    // If rate currency is not EUR, suggest NBRB auto exchange!
    if (detectedCur !== 'EUR' && averageRate > 0) {
      const calculatedEur = convertToEur(averageRate, detectedCur);
      setPendingConversion({
        index: pickerTargetIndex,
        from: from || group.name,
        to: to || '',
        dist: autoDistance,
        originalValue: averageRate,
        originalCurrency: detectedCur,
        calculatedEur: calculatedEur,
        coeff: resolvedCoeff,
        notes: `Средняя ставка (${validRatesCount} прор.) из направления '${group.regionName} / ${group.name}'`
      });
      setConversionModalOpen(true);
    } else {
      // Apply immediately
      applyLegData(pickerTargetIndex, {
        from: from || group.name,
        to: to || '',
        dist: autoDistance,
        freight: averageRate,
        coeff: resolvedCoeff,
        ferryCost: 0,
        notes: `Средняя ставка из направления: ${group.regionName}`
      });
    }

    setPickerOpen(false);
  };

  const selectCarriersLine = (record: any) => {
    if (pickerTargetIndex === null) return;
    const { from, to } = parseCities(record.route);
    const parsed = parseRecordRate(record.rate);
    const rateVal = parsed ? parsed.value : 0;
    const detectedCur = parsed ? parsed.currency : 'EUR';
    
    const autoDistance = findDistanceInPool(from, to);
    const resolvedCoeff = getDirCoeff(to);

    if (detectedCur !== 'EUR' && rateVal > 0) {
      const calculatedEur = convertToEur(rateVal, detectedCur);
      setPendingConversion({
        index: pickerTargetIndex,
        from: from || record.route,
        to: to || '',
        dist: autoDistance,
        originalValue: rateVal,
        originalCurrency: detectedCur,
        calculatedEur: calculatedEur,
        coeff: resolvedCoeff,
        notes: record.notes || `Провайдерская линия из направления: ${record.regionName}`
      });
      setConversionModalOpen(true);
    } else {
      applyLegData(pickerTargetIndex, {
        from: from || record.route,
        to: to || '',
        dist: autoDistance,
        freight: rateVal,
        coeff: resolvedCoeff,
        ferryCost: 0,
        notes: record.notes || `Регион: ${record.regionName}`
      });
    }

    setPickerOpen(false);
  };

  // Helper to append or edit leg
  const applyLegData = (index: number, legInfo: any) => {
    if (index === legs.length) {
      setLegs([...legs, legInfo]);
      setActiveLegIndex(legs.length);
    } else {
      updateLeg(index, legInfo);
    }

    // Auto trigger map calculation if distance is missing
    if (legInfo.dist === 0 && legInfo.from && legInfo.to) {
      triggerFocussedMapCalculate(index, legInfo.from, legInfo.to);
    }
  };

  // Interactive Map Distance Modal Launcher
  const triggerFocussedMapCalculate = (idx: number, origin: string, destin: string) => {
    setDistanceTargetLegIdx(idx);
    setModalOrigin(origin || '');
    setModalDestination(destin || '');
    setModalWaypoints([]);
    setModalCalculatedKm(0);
    setDistanceModalOpen(true);
  };

  const applyCalculatedMapDistance = () => {
    if (distanceTargetLegIdx === null) return;
    
    const originCity = modalOrigin.trim();
    const destinationCity = modalDestination.trim();

    updateLeg(distanceTargetLegIdx, {
      from: originCity,
      to: destinationCity,
      dist: modalCalculatedKm
    });

    if (saveDistanceToTemplates && originCity && destinationCity && modalCalculatedKm > 0) {
      const newPreset = {
        id: "dist_" + Date.now(),
        from: originCity,
        to: destinationCity,
        distance: modalCalculatedKm
      };
      if (useFirebase) {
        dbService.saveDistance(newPreset, "Конструктор", "Пользователь");
      }
    }

    setDistanceModalOpen(false);
  };

  // Confirmation handling of NBRB auto conversion
  const confirmNbrbConversion = (converted: boolean) => {
    if (!pendingConversion) return;
    
    const selectedFreight = converted 
      ? pendingConversion.calculatedEur 
      : pendingConversion.originalValue;

    applyLegData(pendingConversion.index, {
      from: pendingConversion.from,
      to: pendingConversion.to,
      dist: pendingConversion.dist,
      freight: selectedFreight,
      coeff: pendingConversion.coeff,
      ferryCost: 0,
      notes: pendingConversion.notes + (converted ? " (сконвертировано по НБРБ)" : "")
    });

    setPendingConversion(null);
    setConversionModalOpen(false);
  };

  // Google Maps API Key resolution
  const resolvedApiKey = pdSettings?.googleMapsApiKey || STATIC_FALLBACK_API_KEY || (window as any).GOOGLE_MAPS_PLATFORM_KEY || '';

  // Calculations exactly matching legacy + Dohod formulas
  const totalKm = legs.reduce((a, b) => a + Number(b.dist || 0), 0);
  const totalFreight = legs.reduce((a, b) => a + Number(b.freight || 0), 0);
  
  // Expenses = Sum of (dist * coeff + ferryCost)
  const totalExpenses = legs.reduce((a, b) => {
    const km = Number(b.dist || 0);
    const co = Number(b.coeff !== undefined ? b.coeff : 0.8);
    const ferry = Number(b.ferryCost || 0);
    return a + (km * co + ferry);
  }, 0);

  const totalNetProfit = totalFreight - totalExpenses;
  const avgRatePerKm = totalKm > 0 ? (totalFreight / totalKm) : 0;

  // Search filter for picker (directions / groups)
  const filteredPickerGroups = useMemo(() => {
    const query = pickerSearch.toLowerCase().trim();
    if (!query) return allGroups;
    return allGroups.filter(g => 
      (g.name || '').toLowerCase().includes(query) ||
      (g.regionName || '').toLowerCase().includes(query)
    );
  }, [allGroups, pickerSearch]);

  // Search filter for picker (pro-working records)
  const filteredPickerRecords = useMemo(() => {
    const query = pickerSearch.toLowerCase().trim();
    if (!query) return allRecords;
    return allRecords.filter(r => 
      (r.route || '').toLowerCase().includes(query) ||
      (r.regionName || '').toLowerCase().includes(query) ||
      (r.rate || '').toLowerCase().includes(query) ||
      (r.notes || '').toLowerCase().includes(query)
    );
  }, [allRecords, pickerSearch]);

  return (
    <div className="bg-white rounded-[1.5rem] lg:rounded-[2rem] p-4 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] w-full">
      
      {/* Header */}
      <div className="mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
         <div>
            <h2 className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2">
              <Compass className="text-rose-500 animate-spin-slow" size={22} />
              Визуальный Конструктор Цепочек Рейсов
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-1">
              Набирайте цепочки плеч из направлений проработки, считайте затраты по коэффициентам и конвертируйте в евро по НБРБ
            </p>
         </div>

         <div className="flex flex-wrap items-center gap-3">
             <button 
                onClick={() => addLeg()}
                className="bg-rose-500 hover:bg-rose-600 text-white font-black uppercase text-[10px] tracking-wider px-4 py-2.5 rounded-xl shadow-sm hover:shadow transition flex items-center gap-1.5 cursor-pointer"
             >
                <Plus size={14} /> Добавить плечо
             </button>
             <button 
                onClick={() => setLegs([{ from: '', to: '', dist: 0, freight: 0, coeff: 0.8, ferryCost: 0, notes: '' }])}
                className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-black uppercase text-[10px] tracking-wider px-3 py-2.5 rounded-xl transition cursor-pointer"
             >
                Сбросить цепочку
             </button>
         </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-8 items-start">
         
         {/* LEFT SIDE: Visual Sequence Card Editor (7 Columns) */}
         <div className="xl:col-span-7 space-y-6">
            
            {legs.length === 0 ? (
               <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-3xl bg-slate-50/50">
                  <Compass size={40} className="mx-auto text-slate-300 mb-4 animate-pulse" />
                  <p className="text-sm text-slate-500 font-bold">Конструктор пуст</p>
                  <p className="text-xs text-slate-400 mt-1 mb-4">Нажмите «Добавить плечо», чтобы начать построение цепочки перевозок</p>
                  <button 
                     onClick={() => addLeg()}
                     className="bg-rose-500 hover:bg-rose-600 text-white font-black text-xs px-4 py-2 rounded-xl transition uppercase tracking-wider cursor-pointer"
                  >
                     Выбрать первое плечо
                  </button>
               </div>
            ) : (
               <div className="space-y-4">
                  {legs.map((leg, idx) => {
                     const isFirst = idx === 0;
                     const isLast = idx === legs.length - 1;
                     const isActive = activeLegIndex === idx;

                     // Calculations per individual shoulder
                     const singleExpenses = (Number(leg.dist || 0) * Number(leg.coeff !== undefined ? leg.coeff : 0.8)) + Number(leg.ferryCost || 0);
                     const singleProfit = Number(leg.freight || 0) - singleExpenses;

                     // Detect if route has end-to-start disconnect with next item
                     const nextLeg = legs[idx + 1];
                     const hasDisconnect = nextLeg && leg.to && nextLeg.from && 
                        leg.to.trim().toLowerCase() !== nextLeg.from.trim().toLowerCase();

                     return (
                        <div key={idx} className="relative">
                           
                           {/* Leg block card */}
                           <div className={`p-5 rounded-3xl border transition-all ${
                              isActive 
                                ? 'border-rose-400 bg-rose-50/10 shadow-md ring-1 ring-rose-200' 
                                : 'border-slate-200 bg-white hover:border-slate-300 shadow-sm'
                           }`}>
                              
                              {/* Card Top: step badge, custom reorder actions & tools */}
                              <div className="flex items-center justify-between gap-2 mb-4">
                                 <div className="flex items-center gap-2">
                                    <span className="w-6 h-6 rounded-full bg-rose-500 text-white flex items-center justify-center font-black text-xs shadow-sm">
                                       {idx + 1}
                                    </span>
                                    <span className="text-xs font-black uppercase text-slate-600 tracking-wider">Плечо</span>
                                 </div>

                                 <div className="flex flex-wrap items-center gap-1">
                                    {/* Action Buttons */}
                                    <button 
                                       onClick={() => openPicker(idx)}
                                       className="bg-indigo-50 hover:bg-indigo-100 text-indigo-600 border border-indigo-100/50 rounded-xl px-2.5 py-1.5 text-[10px] font-black uppercase tracking-wider transition-colors flex items-center gap-1 mr-2 cursor-pointer"
                                       title="Импортировать из базы направлений проработки"
                                    >
                                       <Layers size={11} /> Заполнить из базы
                                    </button>

                                    <button 
                                       onClick={() => reverseLeg(idx)}
                                       className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                                       title="Реверс (поменять местами города)"
                                    >
                                       <ArrowDownUp size={13} />
                                    </button>

                                    <button 
                                       onClick={() => duplicateLeg(idx)}
                                       className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition"
                                       title="Дублировать звено"
                                    >
                                       <Copy size={13} />
                                    </button>

                                    <button 
                                       onClick={() => moveUp(idx)}
                                       disabled={isFirst}
                                       className={`p-1.5 rounded-lg transition ${isFirst ? 'text-slate-200' : 'text-slate-400 hover:text-slate-800 hover:bg-slate-100'}`}
                                       title="Переместить выше"
                                    >
                                       <MoveUp size={13} />
                                    </button>

                                    <button 
                                       onClick={() => moveDown(idx)}
                                       disabled={isLast}
                                       className={`p-1.5 rounded-lg transition ${isLast ? 'text-slate-200' : 'text-slate-400 hover:text-slate-800 hover:bg-slate-100'}`}
                                       title="Переместить ниже"
                                    >
                                       <MoveDown size={13} />
                                    </button>

                                    <button 
                                       onClick={() => removeLeg(idx)}
                                       disabled={legs.length <= 1}
                                       className={`p-1.5 rounded-lg transition ${legs.length <= 1 ? 'text-slate-200' : 'text-slate-400 hover:text-rose-600 hover:bg-rose-50'}`}
                                       title="Удалить это плечо"
                                    >
                                       <Trash2 size={13} />
                                    </button>
                                 </div>
                              </div>

                              {/* Card Body inputs */}
                              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-12 gap-3.5">
                                 {/* Town origin */}
                                 <div className="md:col-span-3">
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Откуда</label>
                                    <input 
                                       type="text" 
                                       value={leg.from} 
                                       onChange={e => {
                                         const val = e.target.value;
                                         updateLeg(idx, { from: val });
                                       }}
                                       onBlur={() => {
                                         const autoDist = findDistanceInPool(leg.from, leg.to);
                                         if (autoDist > 0) updateLeg(idx, { dist: autoDist });
                                       }}
                                       onClick={() => setActiveLegIndex(idx)}
                                       placeholder="Город отправления" 
                                       className="w-full text-xs font-semibold p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
                                    />
                                 </div>

                                 {/* Town destination */}
                                 <div className="md:col-span-3">
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Куда</label>
                                    <input 
                                       type="text" 
                                       value={leg.to} 
                                       onChange={e => {
                                         const val = e.target.value;
                                         updateLeg(idx, { to: val, coeff: getDirCoeff(val) });
                                       }}
                                       onBlur={() => {
                                         const autoDist = findDistanceInPool(leg.from, leg.to);
                                         if (autoDist > 0) updateLeg(idx, { dist: autoDist });
                                       }}
                                       onClick={() => setActiveLegIndex(idx)}
                                       placeholder="Город назначения" 
                                       className="w-full text-xs font-semibold p-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
                                    />
                                 </div>

                                 {/* Distance KM (with direct interactive map triggers) */}
                                 <div className="md:col-span-2 relative">
                                    <div className="flex justify-between items-center mb-1">
                                       <label className="text-[9px] font-black text-slate-400 uppercase">Км</label>
                                       {leg.from && leg.to && (
                                         <button 
                                            onClick={() => triggerFocussedMapCalculate(idx, leg.from, leg.to)}
                                            className="text-[8px] font-black uppercase text-blue-600 hover:text-blue-800 transition flex items-center gap-0.5"
                                            title="Рассчитать точное расстояние по автодорогам на интерактивной карте"
                                         >
                                            <Navigation size={9} /> Карта
                                         </button>
                                       )}
                                    </div>
                                    <div className="relative">
                                       <input 
                                          type="number" 
                                          value={leg.dist || ''} 
                                          onChange={e => updateLeg(idx, { dist: Number(e.target.value) })}
                                          onClick={() => setActiveLegIndex(idx)}
                                          placeholder={leg.from && leg.to ? '0' : 'Км'} 
                                          className={`w-full text-xs font-extrabold p-2.5 bg-slate-50 border rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition ${
                                            (leg.dist || 0) === 0 && leg.from && leg.to ? 'border-amber-300 bg-amber-50/20' : 'border-slate-200 text-slate-800'
                                          }`}
                                       />
                                       {(leg.dist || 0) === 0 && leg.from && leg.to && (
                                         <span className="absolute right-2 top-2.5 flex h-2 w-2">
                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                         </span>
                                       )}
                                    </div>
                                 </div>

                                 {/* Freight (EUR) */}
                                 <div className="md:col-span-2">
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1">Фрахт (€)</label>
                                    <input 
                                       type="number" 
                                       value={leg.freight || ''} 
                                       onChange={e => updateLeg(idx, { freight: Number(e.target.value) })}
                                       onClick={() => setActiveLegIndex(idx)}
                                       placeholder="Фрахт €" 
                                       className="w-full text-xs font-extrabold text-emerald-600 p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
                                    />
                                 </div>

                                 {/* Coeff (Editable expense weight per km) */}
                                 <div className="md:col-span-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1" title="Коэффициент затрат на 1 км (евро)">Коэф</label>
                                    <input 
                                       type="number" 
                                       step="0.05"
                                       value={leg.coeff !== undefined ? leg.coeff : 0.8} 
                                       onChange={e => updateLeg(idx, { coeff: parseFloat(e.target.value) || 0 })}
                                       onClick={() => setActiveLegIndex(idx)}
                                       className="w-full text-xs font-bold text-center text-indigo-600 p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
                                    />
                                 </div>

                                 {/* Ferry Cost */}
                                 <div className="md:col-span-1">
                                    <label className="text-[9px] font-black text-slate-400 uppercase block mb-1" title="Дополнительные расходы на паром (€)">Паром</label>
                                    <input 
                                       type="number" 
                                       value={leg.ferryCost || ''} 
                                       onChange={e => updateLeg(idx, { ferryCost: Number(e.target.value) || 0 })}
                                       onClick={() => setActiveLegIndex(idx)}
                                       placeholder="0"
                                       className="w-full text-xs font-bold text-center text-slate-700 p-2.5 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-400 outline-none transition"
                                    />
                                 </div>
                              </div>

                              {/* Interactive financial indicators info-bar for this Leg */}
                              <div className="mt-4 pt-3 border-t border-dashed border-slate-100 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold text-slate-400 font-mono">
                                 <div className="flex items-center gap-3">
                                    <span>Затраты: <strong className="text-indigo-600">{singleExpenses.toLocaleString('ru-RU')} €</strong> <span className="opacity-60">({leg.dist} км × {leg.coeff !== undefined ? leg.coeff : 0.8} + {leg.ferryCost || 0} паром)</span></span>
                                    <span className="hidden sm:inline text-slate-200">|</span>
                                    <span>Прибыль: <strong className={singleProfit >= 0 ? "text-emerald-600" : "text-rose-500"}>{Math.round(singleProfit).toLocaleString('ru-RU')} €</strong></span>
                                 </div>
                                 {leg.dist === 0 && leg.from && leg.to && (
                                   <button 
                                      onClick={() => triggerFocussedMapCalculate(idx, leg.from, leg.to)}
                                      className="bg-blue-50 hover:bg-blue-100 border border-blue-100 text-blue-700 px-2.5 py-0.5 rounded uppercase text-[8px] font-black tracking-wider transition duration-150 cursor-pointer"
                                   >
                                      Рассчитать км по карте
                                   </button>
                                 )}
                              </div>

                              {/* Working Notes / Comment field */}
                              <div className="mt-3 flex items-center gap-1.5 bg-slate-50/50 px-2 py-1.5 rounded-xl border border-slate-100">
                                 <Sparkles size={11} className="text-slate-400 shrink-0" />
                                 <input 
                                    type="text"
                                    value={leg.notes || ''}
                                    onChange={e => updateLeg(idx, { notes: e.target.value })}
                                    placeholder="Ваши рабочие примечания по плечу (контакты, Carrier, резерв ставки)..."
                                    className="w-full bg-transparent border-none text-[10px] italic font-semibold text-slate-500 placeholder-slate-350 focus:outline-none focus:text-slate-700 transition"
                                 />
                              </div>
                           </div>

                           {/* Visual connection details / Alert on gap */}
                           {hasDisconnect && (
                              <div className="my-2.5 mx-auto max-w-[90%] bg-amber-50 border border-amber-200 text-amber-800 text-[10px] font-black rounded-lg px-3 py-1.5 flex items-center justify-between gap-1.5 tracking-tight animate-in fade-in">
                                 <span className="flex items-center gap-1">
                                    <AlertTriangle size={12} className="text-amber-500 fill-amber-50/50 shrink-0" />
                                    Разрыв пути! {leg.to} отличается от следующей загрузки в {nextLeg.from}
                                 </span>
                                 <button 
                                    onClick={() => updateLeg(idx + 1, { from: leg.to })}
                                    className="text-[9px] uppercase font-black tracking-widest text-indigo-600 hover:text-indigo-800 bg-white/60 hover:bg-white px-2 py-0.5 rounded transition border border-indigo-100 cursor-pointer"
                                 >
                                    Состыковать
                                 </button>
                              </div>
                           )}

                           {/* Normal sequence bridge */}
                           {!isLast && !hasDisconnect && (
                              <div className="w-1 bg-[#cbd5e1] h-3.5 mx-12"></div>
                           )}

                        </div>
                     );
                  })}
               </div>
            )}

            {/* Comprehensive Total Panel based on full-leg mathematical formulas */}
            <div className="p-6 bg-slate-900 border border-slate-950 rounded-3xl text-white shadow-xl flex flex-col md:flex-row justify-between items-stretch gap-6">
               <div className="flex flex-col justify-between">
                  <div>
                     <h4 className="text-xs font-black uppercase text-slate-400 tracking-wider">ИТОГО ПО ЦЕПОЧКЕ МАРШРУТА</h4>
                     <p className="text-[10px] text-slate-500 font-bold mt-0.5">Включает в себя все сквозные сегменты</p>
                  </div>
                  <div className="mt-4 flex flex-col gap-0.5">
                     <span className="text-[9px] font-bold uppercase text-slate-400 font-mono">Выработка цепочки:</span>
                     <span className="text-xs font-black text-[#70FC8E] font-mono">
                        {(totalNetProfit / (totalFreight || 1) * 100).toFixed(1)}% маржинальность
                     </span>
                  </div>
               </div>
               
               <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 md:gap-6 items-center font-mono">
                  <div className="bg-slate-800/40 border border-slate-800/40 p-3 rounded-2xl">
                     <span className="text-[9px] block text-slate-400 font-bold uppercase tracking-wider mb-1">Дистанция</span>
                     <span className="text-base md:text-xl font-black text-rose-400">{totalKm} км</span>
                  </div>
                  
                  <div className="bg-slate-800/40 border border-slate-800/40 p-3 rounded-2xl">
                     <span className="text-[9px] block text-slate-400 font-bold uppercase tracking-wider mb-1">Фрахт (€)</span>
                     <span className="text-base md:text-xl font-black text-emerald-400">{totalFreight.toLocaleString('ru-RU')} €</span>
                  </div>

                  <div className="bg-slate-800/40 border border-slate-800/40 p-3 rounded-2xl">
                     <span className="text-[9px] block text-slate-400 font-bold uppercase tracking-wider mb-1">Затраты (€)</span>
                     <span className="text-base md:text-xl font-black text-indigo-400">{Math.round(totalExpenses).toLocaleString('ru-RU')} €</span>
                  </div>

                  <div className="bg-slate-800/40 border border-slate-800/40 p-3 rounded-2xl">
                     <span className="text-[9px] block text-slate-400 font-bold uppercase tracking-wider mb-1">Чистая прибыль</span>
                     <span className={`text-base md:text-xl font-black ${totalNetProfit >= 0 ? 'text-[#70FC8E]' : 'text-rose-400'}`}>
                        {Math.round(totalNetProfit).toLocaleString('ru-RU')} €
                     </span>
                  </div>
               </div>
            </div>

         </div>

         {/* RIGHT SIDE: Interactive Live Google Map View (5 Columns) */}
         <div className="xl:col-span-5 sticky top-4">
            
            <div className="bg-slate-50 border border-slate-200 rounded-3xl overflow-hidden shadow-sm flex flex-col">
               
               <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse"></span>
                     <span className="text-xs font-black capitalize text-slate-700 tracking-tight">Маршрут на интерактивной карте</span>
                  </div>
                  {activeLegIndex !== null && (
                     <button 
                        onClick={() => setActiveLegIndex(null)}
                        className="text-[10px] font-black uppercase tracking-wider text-rose-500 hover:text-rose-600 border border-rose-100 bg-rose-50 rounded px-2 py-1 transition-colors cursor-pointer"
                     >
                        Сбросить фокус
                     </button>
                  )}
               </div>

               {/* MAP DISPLAYER */}
               <div className="h-[480px] bg-slate-100 relative">
                  {!resolvedApiKey ? (
                     <div className="absolute inset-x-4 inset-y-12 flex flex-col items-center justify-center text-center p-6 bg-white border border-slate-100 rounded-2xl shadow-sm">
                        <AlertCircle className="text-rose-500 mb-3" size={32} />
                        <h4 className="font-black text-sm text-slate-800 uppercase tracking-widest">Активируйте карту в справочнике</h4>
                        <p className="text-xs text-slate-400 mt-2 max-w-xs leading-relaxed">
                           Отсутствует API-ключ Google Maps. Пожалуйста, вставьте и сохраните рабочий API-ключ во вкладке <strong>"Справочники" ➔ "Настройки Google Maps API"</strong>.
                        </p>
                     </div>
                  ) : (
                     <APIProvider apiKey={resolvedApiKey} version="weekly">
                        <Map 
                          defaultCenter={{ lat: 55.751244, lng: 37.618423 }} 
                          defaultZoom={5} 
                          gestureHandling={'greedy'} 
                          mapTypeControl={false}
                          disableDefaultUI={true}
                          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                          style={{ width: '100%', height: '100%' }}
                        >
                           <RouteMapLayer 
                              legs={legs} 
                              activeLegIndex={activeLegIndex} 
                           />
                        </Map>
                     </APIProvider>
                  )}
                  
                  {/* Floating helpful notice overlay */}
                  <div className="absolute bottom-4 left-4 right-4 bg-white/95 backdrop-blur border border-slate-200/60 p-3 rounded-2xl shadow-lg text-[10px] text-slate-500 font-semibold space-y-1">
                     <div className="flex items-center gap-1.5 text-slate-700 font-bold mb-0.5">
                        <Sparkles size={11} className="text-rose-500 animate-pulse" />
                        <span>Логика расчетного модуля</span>
                     </div>
                     <p className="leading-normal">
                        Кликните на карточку плеча, чтобы подсветить цепочку. Если километраж равен 0, нажмите кнопку «Карта» на плече — откроется расчетный модуль автодорог для поиска точной траектории!
                     </p>
                  </div>
               </div>

               {/* Quick actions for whole route calculation */}
               <div className="p-4 bg-white border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-slate-550">
                  <span className="flex items-center gap-1 text-[11px]"><Sparkles className="text-amber-500 animate-pulse" size={13} /> Автодорожное прокладывание активно</span>
                  <div className="text-[10px] text-indigo-600 font-black tracking-widest uppercase">НБРБ EUR курсы синхронизированы</div>
               </div>

            </div>

         </div>

      </div>

      {/* SEARCHABLE DIRECTORY PICKER DRAWER / SLIDE-OUT OVERLAY */}
      {pickerOpen && (
         <div className="fixed inset-0 z-[600] flex items-center justify-center bg-slate-950/40 backdrop-blur-sm p-4 animate-in fade-in duration-150">
            <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-2xl max-h-[85vh] flex flex-col relative animate-in zoom-in-95 duration-200">
               
               {/* Close button */}
               <button 
                  onClick={() => setPickerOpen(false)} 
                  className="absolute top-5 right-5 text-slate-400 hover:text-slate-800 transition bg-slate-150 p-2 rounded-full cursor-pointer"
               >
                  <X size={16} />
               </button>

               <div className="mb-4">
                  <h3 className="font-black text-lg text-slate-800 tracking-tight flex items-center gap-2">
                     <Layers size={18} className="text-rose-500" />
                     Выбор из Сохраненной Базы Направлений
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                     Мгновенный выбор заполненного плеча №{(pickerTargetIndex || 0) + 1} по базам региональной аналитики
                  </p>
               </div>

               {/* Picker Navigation Tabs */}
               <div className="flex border-b border-slate-100 mb-4">
                  <button 
                     onClick={() => setPickerTab('directions')}
                     className={`flex-1 py-2.5 font-black uppercase text-[10px] tracking-wider border-b-2 transition duration-200 cursor-pointer ${
                        pickerTab === 'directions' 
                           ? 'border-rose-500 text-rose-600' 
                           : 'border-transparent text-slate-400 hover:text-slate-600'
                     }`}
                  >
                     Направления (Средние ставки по проработкам)
                  </button>
                  <button 
                     onClick={() => setPickerTab('records')}
                     className={`flex-1 py-2.5 font-black uppercase text-[10px] tracking-wider border-b-2 transition duration-200 cursor-pointer ${
                        pickerTab === 'records' 
                           ? 'border-rose-500 text-rose-600' 
                           : 'border-transparent text-slate-400 hover:text-slate-600'
                     }`}
                  >
                     Детализированные проработки (Конкретные Линии)
                  </button>
               </div>

               {/* Search Box */}
               <div className="relative mb-4">
                  <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                     <Search size={14} />
                  </span>
                  <input 
                     type="text" 
                     placeholder="Поиск по маршрутам, регионам, ставкам..." 
                     value={pickerSearch}
                     onChange={e => setPickerSearch(e.target.value)}
                     className="w-full text-xs font-semibold pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:ring-2 focus:ring-rose-500 outline-none transition"
                  />
               </div>

               {/* List display */}
               <div className="flex-1 overflow-y-auto mb-4 space-y-2.5 max-h-[45vh] pr-1">
                  {!dataLoaded && allRecords.length === 0 ? (
                     <div className="text-center py-12 text-slate-400 text-xs">
                        <RefreshCw className="animate-spin mx-auto text-slate-300 mb-2" size={20} />
                        Загрузка аналитической базы данных...
                     </div>
                  ) : pickerTab === 'directions' ? (
                     // Group list view calculating live stats!
                     filteredPickerGroups.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 text-xs">Ничего не найдено.</div>
                     ) : (
                        filteredPickerGroups.map(group => {
                           const records = allRecords.filter(r => r.groupId === group.id || r.groupName === group.name);
                           // Compute average and currencies
                           let sumVal = 0;
                           let cnt = 0;
                           let code = 'RUB';
                           records.forEach(r => {
                             const p = parseRecordRate(r.rate);
                             if (p) {
                               sumVal += p.value;
                               cnt++;
                               code = p.currency;
                             }
                           });
                           const avgRate = cnt > 0 ? Math.round(sumVal / cnt) : 0;

                           return (
                             <div 
                               key={group.id}
                               onClick={() => selectGroupDirection(group)}
                               className="p-3 bg-gradient-to-r from-slate-50 to-white border border-slate-100 rounded-xl hover:from-rose-50/10 hover:to-indigo-50/10 hover:border-rose-300 cursor-pointer transition flex flex-col gap-1 group"
                             >
                               <div className="flex justify-between items-center text-[9px]">
                                 <span className="px-2 py-0.5 bg-rose-50 text-rose-600 font-extrabold rounded uppercase tracking-wider">{group.regionName}</span>
                                 <span className="text-slate-400 font-bold uppercase tracking-wider">{cnt} проработок в группе</span>
                               </div>
                               <div className="flex justify-between items-center gap-4">
                                 <div className="text-sm font-black text-slate-800">{group.name}</div>
                                 <div className="text-xs font-black text-rose-500 bg-white border border-slate-200 px-2 py-1 rounded-lg">
                                    {avgRate > 0 ? `~ ${avgRate.toLocaleString('ru-RU')} ${code}` : 'Ставка н/д'}
                                 </div>
                               </div>
                               <div className="text-[9px] text-slate-400 font-semibold italic">
                                  Берет среднюю ставку по данному направлению и авто-заполняет плечо
                                </div>
                             </div>
                           );
                        })
                     )
                  ) : (
                     // Individual records list view
                     filteredPickerRecords.length === 0 ? (
                        <div className="text-center py-10 text-slate-400 text-xs">Ничего не найдено.</div>
                     ) : (
                        filteredPickerRecords.map((rec) => {
                           return (
                              <div 
                                 key={rec.id} 
                                 onClick={() => selectCarriersLine(rec)}
                                 className="p-3 bg-slate-50 border border-slate-100 rounded-xl hover:bg-rose-50/10 hover:border-rose-300 cursor-pointer transition flex flex-col gap-1.5 group"
                              >
                                 <div className="flex justify-between items-center text-[9px]">
                                    <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 font-extrabold rounded uppercase tracking-wider">{rec.regionName}</span>
                                    <span className="text-slate-400 font-bold">{rec.groupName}</span>
                                 </div>
                                 <div className="flex justify-between items-start gap-4">
                                    <div className="text-xs font-black text-slate-800">{rec.route}</div>
                                    <div className="text-xs font-bold text-slate-700 bg-white border border-slate-200 px-2 py-0.5 rounded-lg whitespace-nowrap text-right">{rec.rate || '—'}</div>
                                 </div>
                                 {rec.notes && (
                                    <div className="text-[9px] text-slate-400 italic font-semibold truncate max-w-full">
                                       Заметка: {rec.notes}
                                    </div>
                                 )}
                              </div>
                           );
                        })
                     )
                  )}
               </div>

               {/* Footer prompt */}
               <div className="pt-2 text-center text-[9px] text-slate-400 font-bold uppercase tracking-widest border-t border-slate-100">
                  Мгновенное добавление и компоновка цепочки рейса в 1 клик
               </div>

            </div>
         </div>
      )}

      {/* AUTO NBRB RATE CONVERSION SCREEN MODAL */}
      {conversionModalOpen && pendingConversion && (
         <div className="fixed inset-0 z-[700] flex items-center justify-center bg-slate-950/60 backdrop-blur-sm p-4 animate-in fade-in">
            <div className="bg-slate-900 text-white rounded-3xl border border-slate-800 shadow-2xl p-6 w-full max-w-md flex flex-col animate-in zoom-in-95">
               <div className="flex items-center gap-3 mb-4">
                  <div className="bg-emerald-500/10 border border-emerald-500/20 text-[#70FC8E] p-2.5 rounded-xl">
                     <DollarSign className="w-5 h-5" />
                  </div>
                  <div>
                     <h4 className="text-xs font-black tracking-wider uppercase text-slate-400 font-mono">Согласование по курсу НБРБ</h4>
                     <h3 className="text-sm font-black text-white mt-0.5">Сконвертировать фрахт в евро?</h3>
                  </div>
               </div>

               <p className="text-xs text-slate-350 leading-relaxed font-semibold">
                  По выбранному направлению <strong>{pendingConversion.from} — {pendingConversion.to}</strong> определена исходная ставка:
               </p>

               <div className="my-4 bg-slate-800/50 rounded-2xl border border-slate-800 p-4 space-y-3 font-mono text-center">
                  <div>
                     <span className="text-[10px] text-slate-400 uppercase font-black tracking-widest block">Оригинальная ставка</span>
                     <span className="text-lg font-black text-slate-300">
                        {pendingConversion.originalValue.toLocaleString('ru-RU')} {pendingConversion.originalCurrency}
                     </span>
                  </div>
                  <div className="flex items-center justify-center">
                     <div className="w-8 h-px bg-slate-700"></div>
                     <span className="mx-2 text-[9px] text-slate-500 font-bold uppercase">курсы НБРБ</span>
                     <div className="w-8 h-px bg-slate-700"></div>
                  </div>
                  <div>
                     <span className="text-[10px] text-[#70FC8E] uppercase font-black tracking-widest block">Авторасчёт в евро</span>
                     <span className="text-2xl font-black text-[#70FC8E]">
                        {pendingConversion.calculatedEur.toLocaleString('ru-RU')} EUR
                     </span>
                  </div>
               </div>

               <div className="flex gap-3 mt-2">
                  <button 
                     onClick={() => confirmNbrbConversion(true)}
                     className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs py-3 rounded-xl transition uppercase tracking-wider cursor-pointer"
                  >
                     Применить EUR
                  </button>
                  <button 
                     onClick={() => confirmNbrbConversion(false)}
                     className="flex-1 bg-slate-800 hover:bg-slate-750 text-slate-100 font-black text-xs py-3 rounded-xl transition uppercase tracking-wider cursor-pointer"
                  >
                     Оставить {pendingConversion.originalCurrency}
                  </button>
               </div>
            </div>
         </div>
      )}

      {/* FULL FEATURE INTERACTIVE GPS DIRECTIONS CALCULATION MODAL */}
      {distanceModalOpen && distanceTargetLegIdx !== null && (
         <div className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white rounded-3xl w-full max-w-4xl shadow-2xl overflow-hidden flex flex-col pt-1">
               
               <div className="px-6 py-5 border-b border-slate-100 flex flex-col gap-4">
                  <div className="flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <div className="bg-rose-50 text-rose-600 p-2 rounded-xl"><MapPin className="w-5 h-5"/></div>
                        <div>
                           <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Расчет Плеча на Интерактивной Карте</h3>
                           <div className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-widest">Прокладка оптимальных трасс через Google Maps</div>
                        </div>
                     </div>
                     <button onClick={() => setDistanceModalOpen(false)} className="w-10 h-10 rounded-full bg-slate-50 text-slate-500 hover:bg-slate-100 flex items-center justify-center transition cursor-pointer"><X className="w-5 h-5"/></button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">Пункт Отправления (Откуда)</label>
                        <input 
                          type="text" 
                          value={modalOrigin} 
                          onChange={e => setModalOrigin(e.target.value)}
                          className="w-full bg-slate-55 text-slate-800 font-bold border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-rose-400 focus:bg-white transition"
                          placeholder="Город отправления..."
                        />
                     </div>
                     <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">Пункт Назначения (Куда)</label>
                        <input 
                          type="text" 
                          value={modalDestination} 
                          onChange={e => setModalDestination(e.target.value)}
                          className="w-full bg-slate-55 text-slate-800 font-bold border border-slate-200 rounded-xl px-4 py-2.5 text-xs outline-none focus:border-rose-400 focus:bg-white transition"
                          placeholder="Город назначения..."
                        />
                     </div>
                  </div>

                  {/* Waypoints block */}
                  <div className="bg-slate-50/50 p-4 rounded-2xl border border-dashed border-slate-200 flex flex-col gap-3">
                     <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">Промежуточные точки / Загрузки</span>
                        <button 
                           type="button"
                           onClick={() => setModalWaypoints([...modalWaypoints, ''])}
                           className="text-[10px] font-bold text-rose-500 hover:text-rose-600 flex items-center gap-1 transition cursor-pointer"
                        >
                           <Plus className="w-3.5 h-3.5" />
                           <span>Добавить точку</span>
                        </button>
                     </div>
                     
                     {modalWaypoints.length > 0 && (
                        <div className="space-y-2">
                           {modalWaypoints.map((wp, i) => (
                              <div key={i} className="flex items-center gap-2">
                                 <span className="text-[9px] font-bold text-slate-400 font-mono min-w-[15px]">{i + 1}.</span>
                                 <input 
                                    type="text"
                                    value={wp}
                                    onChange={(e) => {
                                       const updated = [...modalWaypoints];
                                       updated[i] = e.target.value;
                                       setModalWaypoints(updated);
                                    }}
                                    placeholder="Введите промежуточный транзитный город..."
                                    className="flex-1 bg-white border border-slate-205 rounded-xl px-3 py-2 text-xs font-bold text-slate-700 outline-none focus:border-rose-400 transition"
                                 />
                                 <button 
                                    type="button"
                                    onClick={() => {
                                       setModalWaypoints(modalWaypoints.filter((_, index) => index !== i));
                                    }}
                                    className="p-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0 cursor-pointer"
                                 >
                                    <Trash2 className="w-4 h-4" />
                                 </button>
                              </div>
                           ))}
                        </div>
                     )}
                  </div>

                  {/* Avoid Checkboxes */}
                  <div className="grid grid-cols-3 gap-3 p-3 bg-slate-50 rounded-2xl border border-slate-100">
                     <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input 
                           type="checkbox" 
                           checked={modalAvoidTolls} 
                           onChange={e => setModalAvoidTolls(e.target.checked)}
                           className="w-4 h-4 text-rose-500 border-slate-300 rounded focus:ring-rose-400"
                        />
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-wide font-mono">Избегать платных дорог</span>
                     </label>
                     <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input 
                           type="checkbox" 
                           checked={modalAvoidHighways} 
                           onChange={e => setModalAvoidHighways(e.target.checked)}
                           className="w-4 h-4 text-rose-500 border-slate-300 rounded focus:ring-rose-400"
                        />
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-wide font-mono">Избегать шоссе</span>
                     </label>
                     <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input 
                           type="checkbox" 
                           checked={modalAvoidFerries} 
                           onChange={e => setModalAvoidFerries(e.target.checked)}
                           className="w-4 h-4 text-rose-500 border-slate-300 rounded focus:ring-rose-400"
                        />
                        <span className="text-[10px] font-black text-slate-600 uppercase tracking-wide font-mono">Избегать паромов</span>
                     </label>
                  </div>
               </div>

               {/* MAP DISPLAYER */}
               <div className="h-[380px] bg-slate-100 relative border-b border-slate-100">
                  {!resolvedApiKey ? (
                     <div className="absolute inset-0 flex flex-col items-center justify-center p-8 bg-slate-50 text-center">
                        <AlertCircle className="text-rose-500 mb-2" size={36} />
                        <h4 className="font-extrabold text-slate-800 text-sm">Необходим API-ключ Google Maps</h4>
                     </div>
                  ) : (
                     <APIProvider apiKey={resolvedApiKey} version="weekly">
                        <Map 
                          defaultCenter={{ lat: 55.751244, lng: 37.618423 }} 
                          defaultZoom={5} 
                          gestureHandling={'greedy'} 
                          mapTypeControl={false}
                          disableDefaultUI={true}
                          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
                          style={{ width: '100%', height: '100%' }}
                        >
                           <ModalMapRenderer 
                              origin={modalOrigin}
                              destination={modalDestination}
                              waypoints={modalWaypoints}
                              avoidTolls={modalAvoidTolls}
                              avoidHighways={modalAvoidHighways}
                              avoidFerries={modalAvoidFerries}
                              onCalculated={setModalCalculatedKm}
                           />
                        </Map>
                     </APIProvider>
                  )}
               </div>

               {/* Bottom application panel */}
               <div className="px-6 py-4 bg-slate-50 border-t border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-6">
                     <div>
                        <span className="text-[9px] block text-slate-400 uppercase font-black font-mono">Расстояние по карте</span>
                        <span className="text-xl font-black text-slate-800 font-mono">
                           {modalCalculatedKm > 0 ? `${modalCalculatedKm.toLocaleString('ru-RU')} км` : '—'}
                        </span>
                     </div>

                     <label className="flex items-center gap-2 select-none cursor-pointer">
                        <input 
                           type="checkbox" 
                           checked={saveDistanceToTemplates} 
                           onChange={e => setSaveDistanceToTemplates(e.target.checked)}
                           className="w-4 h-4 text-emerald-500 border-slate-300 rounded focus:ring-emerald-400"
                        />
                        <div>
                           <span className="text-[10px] block font-black uppercase text-slate-600 tracking-tight font-mono">Добавить в шаблоны</span>
                           <span className="text-[8px] block font-semibold text-slate-400 -mt-0.5">Кэшировать километраж для будущих расчетов</span>
                        </div>
                     </label>
                  </div>

                  <div className="flex items-center gap-3">
                     <button 
                        onClick={() => setDistanceModalOpen(false)}
                        className="bg-white border border-slate-200 text-slate-600 font-bold px-4 py-2.5 rounded-xl text-xs transition hover:bg-slate-100 cursor-pointer"
                     >
                        Отмена
                     </button>
                     <button 
                        onClick={() => applyCalculatedMapDistance()}
                        disabled={modalCalculatedKm === 0}
                        className={`font-black uppercase text-[10px] tracking-wider px-5 py-3 rounded-xl transition shadow-sm cursor-pointer ${
                           modalCalculatedKm > 0 
                              ? 'bg-rose-500 hover:bg-rose-600 text-white' 
                              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                        }`}
                     >
                        Применить километраж
                     </button>
                  </div>
               </div>

            </div>
         </div>
      )}

    </div>
  );
}

import React, { useEffect, useState, useRef } from 'react';
import { MapPin, Sparkles, Navigation } from 'lucide-react';
import { AppSettings } from '../types';
import { dbService } from '../firebase';

interface BelarusMapProps {
  // For multi-leg maps (Analysis)
  legs?: { from: string; to: string; distance?: number }[];
  activeLegIndex?: number | null;

  // For single-route maps (Dohod / PlanDohod)
  origin?: string;
  destination?: string;
  waypoints?: string[];
  onDistance?: (km: number) => void;
  
  // Callbacks for updating when map markers are dragged
  onOriginChange?: (value: string) => void;
  onDestinationChange?: (value: string) => void;
  onWaypointsChange?: (values: string[]) => void;
}

export default function BelarusMap({
  legs,
  activeLegIndex,
  origin,
  destination,
  waypoints = [],
  onDistance,
  onOriginChange,
  onDestinationChange,
  onWaypointsChange
}: BelarusMapProps) {
  const [loading, setLoading] = useState(false);
  const [globalSettings, setGlobalSettings] = useState<AppSettings | null>(null);
  const [routeData, setRouteData] = useState<{
    paths: { lat: number; lng: number }[][];
    markers: { lat: number; lng: number; label: string; active?: boolean; id?: string }[];
  }>({ paths: [], markers: [] });

  useEffect(() => {
    const unsub = dbService.getSettings(setGlobalSettings);
    return unsub;
  }, []);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Helper for geocoding via server API
  const geocodeAddress = async (address: string): Promise<{ lat: number; lng: number; label: string } | null> => {
    if (!address || address.trim().length === 0) return null;
    try {
      const res = await fetch(`/api/geocode?address=${encodeURIComponent(address)}`);
      if (res.ok) {
        const data = await res.json();
        if (data && typeof data.lat === 'number' && typeof data.lng === 'number') {
          return { lat: data.lat, lng: data.lng, label: address };
        }
      }
    } catch (err) {
      console.error("Geocoding failed for: " + address, err);
    }
    return null;
  };

  // Helper for route fetching with robust fallbacks
  const fetchRouteWithFallback = async (coordinates: string, steps: boolean = false, alternatives: boolean = false): Promise<any> => {
    const stepsParam = steps ? "&steps=true" : "";
    const altParam = alternatives ? "&alternatives=true" : "";

    const mapboxUsage = globalSettings?.mapboxUsage;
    const bypassMapbox = mapboxUsage
      ? (mapboxUsage.count >= (mapboxUsage.limit || 100000) && !mapboxUsage.allowExceed)
      : false;

    const bypassParam = bypassMapbox ? "&bypassMapbox=true" : "";
    
    // 1. Try our proxy first
    try {
      const response = await fetch(`/api/osrm-route?coordinates=${coordinates}${stepsParam}${altParam}${bypassParam}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.code === "Ok" && data.routes && data.routes.length > 0) {
          if (data.source === "mapbox") {
            dbService.incrementMapboxUsage();
          }
          return data;
        }
      }
    } catch (e) {
      console.warn("Proxy routing failed, trying direct OSRM fallback:", e);
    }

    // 2. Try direct OSRM router on client
    try {
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coordinates}?overview=full&geometries=geojson${stepsParam}${altParam}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.code === "Ok" && data.routes && data.routes.length > 0) {
          return data;
        }
      }
    } catch (e) {
      console.warn("Direct OSRM fallback failed, trying OpenStreetMap FOSSGIS fallback:", e);
    }

    // 3. Try OpenStreetMap FOSSGIS fallback
    try {
      const response = await fetch(`https://routing.openstreetmap.de/routed-car/route/v1/driving/${coordinates}?overview=full&geometries=geojson${stepsParam}${altParam}`);
      if (response.ok) {
        const data = await response.json();
        if (data && data.code === "Ok" && data.routes && data.routes.length > 0) {
          return data;
        }
      }
    } catch (e) {
      console.error("All OSRM routing attempts failed:", e);
    }

    return null;
  };

  // Listen to drag messages from inside Leaflet iframe
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (!event.data) return;

      if (event.data.type === 'MAP_LOADED') {
        dbService.incrementMapboxLoads();
        return;
      }

      if (event.data.type === 'MARKER_DRAG_END') {
        const { id, lat, lng } = event.data;
        
        // Reverse geocode the new lat/lng to get a place name
        try {
          const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json();
            if (data && data.success && data.address) {
              const newAddress = data.address;
              
              // Now notify the parent component of the change!
              if (id === 'origin' && onOriginChange) {
                onOriginChange(newAddress);
              } else if (id === 'destination' && onDestinationChange) {
                onDestinationChange(newAddress);
              } else if (id.startsWith('waypoint_') && onWaypointsChange && waypoints) {
                const index = parseInt(id.split('_')[1], 10);
                const newWps = [...waypoints];
                newWps[index] = newAddress;
                onWaypointsChange(newWps);
              }
            }
          }
        } catch (e) {
          console.error("Failed to reverse geocode dragged marker:", e);
        }
      } else if (event.data.type === 'ROUTE_LINE_DRAG_END') {
        const { legIndex, lat, lng } = event.data;
        
        // Reverse geocode the dragged route line position to get a place name
        try {
          const res = await fetch(`/api/reverse-geocode?lat=${lat}&lng=${lng}`);
          if (res.ok) {
            const data = await res.json();
            if (data && data.success && data.address) {
              const newAddress = data.address;
              
              if (onWaypointsChange && waypoints) {
                const newWps = [...waypoints];
                // Insert the new waypoint at the drag-defined leg segment index
                newWps.splice(legIndex, 0, newAddress);
                onWaypointsChange(newWps);
              }
            }
          }
        } catch (e) {
          console.error("Failed to reverse geocode route line dragged point:", e);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [waypoints, onOriginChange, onDestinationChange, onWaypointsChange]);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);

    async function loadRoutes() {
      const paths: { lat: number; lng: number }[][] = [];
      const markers: { lat: number; lng: number; label: string; active?: boolean; id?: string }[] = [];

      try {
        if (legs && legs.length > 0) {
          // Multi-leg logic
          for (let i = 0; i < legs.length; i++) {
            const leg = legs[i];
            if (!leg.from || !leg.to) continue;

            const c1 = await geocodeAddress(leg.from);
            const c2 = await geocodeAddress(leg.to);

            if (!isCurrent) return;

            if (c1 && c2) {
              const isActive = activeLegIndex === undefined || activeLegIndex === null || activeLegIndex === i;
              
              // Add markers (avoid duplicates in label & coordinates)
              if (!markers.some(m => m.label === leg.from)) {
                markers.push({ ...c1, active: isActive });
              }
              if (!markers.some(m => m.label === leg.to)) {
                markers.push({ ...c2, active: isActive });
              }

              // Fetch route polyline via helper (incorporates proxy & direct fallbacks)
              let polylinePath: { lat: number; lng: number }[] = [];
              try {
                const rdata = await fetchRouteWithFallback(`${c1.lng},${c1.lat};${c2.lng},${c2.lat}`);
                if (rdata?.routes?.[0]?.geometry?.coordinates) {
                  polylinePath = rdata.routes[0].geometry.coordinates.map((coord: [number, number]) => ({
                    lat: coord[1],
                    lng: coord[0]
                  }));
                }
              } catch (e) {
                console.warn("OSRM fetch failed for leg " + i, e);
              }

              if (polylinePath.length === 0) {
                polylinePath = [c1, c2];
              }

              paths.push(polylinePath);
            }
          }
        } else if (origin && destination) {
          // Single-route logic
          const cStart = await geocodeAddress(origin);
          const activeWaypoints = waypoints.filter(w => w && w.trim().length > 0);
          const wpsCoords = await Promise.all(activeWaypoints.map(wp => geocodeAddress(wp)));
          const cEnd = await geocodeAddress(destination);

          if (!isCurrent) return;

          if (cStart && cEnd) {
            markers.push({ ...cStart, label: `Отправление: ${origin}`, active: true, id: 'origin' });
            wpsCoords.forEach((wp, index) => {
              if (wp) {
                markers.push({ ...wp, label: `Промежуточная точка #${index + 1}: ${activeWaypoints[index]}`, active: true, id: `waypoint_${index}` });
              }
            });
            markers.push({ ...cEnd, label: `Назначение: ${destination}`, active: true, id: 'destination' });

            const allPoints = [cStart, ...wpsCoords.filter((wp): wp is any => wp !== null), cEnd];
            const coordQuery = allPoints.map(p => `${p.lng},${p.lat}`).join(';');

            let polylinePath: { lat: number; lng: number }[] = [];
            let distanceMeters = 0;
            try {
              const rdata = await fetchRouteWithFallback(coordQuery);
              if (rdata?.routes?.[0]?.geometry?.coordinates) {
                polylinePath = rdata.routes[0].geometry.coordinates.map((coord: [number, number]) => ({
                  lat: coord[1],
                  lng: coord[0]
                }));
                distanceMeters = rdata.routes[0].distance || 0;
              }
            } catch (e) {
              console.warn("OSRM fetch failed for single route", e);
            }

            if (polylinePath.length === 0) {
              polylinePath = allPoints;
            }

            paths.push(polylinePath);

            if (onDistance) {
              if (distanceMeters > 0) {
                onDistance(Math.round(distanceMeters / 1000));
              } else {
                // simple fallback distance if OSRM didn't return distance
                let totalD = 0;
                for (let i = 0; i < allPoints.length - 1; i++) {
                  const p1 = allPoints[i];
                  const p2 = allPoints[i+1];
                  const R = 6371; // km
                  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
                  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
                  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                            Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
                            Math.sin(dLng/2) * Math.sin(dLng/2);
                  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
                  totalD += R * c;
                }
                // add 20% for road winding
                onDistance(Math.round(totalD * 1.2));
              }
            }
          }
        }
      } catch (err) {
        console.error("Error setting up Belarus fallbacks: ", err);
      } finally {
        if (isCurrent) {
          setRouteData({ paths, markers });
          setLoading(false);
        }
      }
    }

    loadRoutes();
    return () => {
      isCurrent = false;
    };
  }, [legs, activeLegIndex, origin, destination, JSON.stringify(waypoints)]);

  // Inject content into the Mapbox GL JS iframe
  const mapboxToken = "pk.eyJ1Ijoic2VyZ2VpdGVyZXoiLCJhIjoiY21yN3FqeTNzMTV2ZTJ3czlobGM0ZTF2NiJ9.GeagZG4Ev2U2a7NfnLicyg";

  const srcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link href="https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.css" rel="stylesheet" />
      <script src="https://api.mapbox.com/mapbox-gl-js/v3.4.0/mapbox-gl.js"></script>
      <style>
        body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f8fafc; }
        .mapboxgl-popup-content {
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          padding: 8px 12px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
          font-weight: 700;
          color: #1e293b;
          font-size: 11px;
          line-height: 1.4;
        }
        .custom-marker {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          border: 2px solid white;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          cursor: grab;
        }
        .custom-marker:active {
          cursor: grabbing;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        try {
          mapboxgl.accessToken = "${mapboxToken}";
          const map = new mapboxgl.Map({
            container: 'map',
            style: 'mapbox://styles/mapbox/streets-v12',
            center: [27.5590, 53.9006],
            zoom: 5
          });

          map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');

          const paths = ${JSON.stringify(routeData.paths)};
          const markers = ${JSON.stringify(routeData.markers)};

          map.on('load', () => {
            window.parent.postMessage({ type: 'MAP_LOADED' }, '*');
            const bounds = new mapboxgl.LngLatBounds();

            // Draw markers
            markers.forEach(m => {
              const color = m.active ? '#f43f5e' : '#94a3b8';
              const isDraggable = !!m.id;

              const el = document.createElement('div');
              el.className = 'custom-marker';
              el.style.backgroundColor = color;

              const popup = new mapboxgl.Popup({ offset: 10, closeButton: false })
                .setHTML('<div>' + m.label + '</div>');

              const markerObj = new mapboxgl.Marker({
                element: el,
                draggable: isDraggable
              })
                .setLngLat([m.lng, m.lat])
                .setPopup(popup)
                .addTo(map);

              bounds.extend([m.lng, m.lat]);

              if (isDraggable) {
                markerObj.on('dragend', () => {
                  const lngLat = markerObj.getLngLat();
                  window.parent.postMessage({
                    type: 'MARKER_DRAG_END',
                    id: m.id,
                    lat: lngLat.lat,
                    lng: lngLat.lng
                  }, '*');
                });
              }
            });

            // Draw route lines
            paths.forEach((pathPoints, idx) => {
              if (pathPoints.length < 2) return;

              const isActive = ${activeLegIndex === undefined || activeLegIndex === null} || idx === ${activeLegIndex};
              const color = isActive ? '#4f46e5' : '#cbd5e1';
              const width = isActive ? 6 : 3;

              const coordinates = pathPoints.map(p => [p.lng, p.lat]);
              coordinates.forEach(pt => bounds.extend(pt));

              const sourceId = 'route-source-' + idx;
              const layerId = 'route-layer-' + idx;

              map.addSource(sourceId, {
                type: 'geojson',
                data: {
                  type: 'Feature',
                  properties: {},
                  geometry: {
                    type: 'LineString',
                    coordinates: coordinates
                  }
                }
              });

              map.addLayer({
                id: layerId,
                type: 'line',
                source: sourceId,
                layout: {
                  'line-join': 'round',
                  'line-cap': 'round'
                },
                paint: {
                  'line-color': color,
                  'line-width': width,
                  'line-opacity': isActive ? 0.8 : 0.4
                }
              });

              // Click handling for adding waypoint
              const canAddWaypoints = ${!!onWaypointsChange};
              if (canAddWaypoints && isActive) {
                // Change cursor on hover
                map.on('mouseenter', layerId, () => {
                  map.getCanvas().style.cursor = 'pointer';
                });
                map.on('mouseleave', layerId, () => {
                  map.getCanvas().style.cursor = '';
                });

                map.on('click', layerId, (e) => {
                  window.parent.postMessage({
                    type: 'ROUTE_LINE_DRAG_END',
                    legIndex: idx,
                    lat: e.lngLat.lat,
                    lng: e.lngLat.lng
                  }, '*');
                });
              }
            });

            if (!bounds.isEmpty()) {
              map.fitBounds(bounds, { padding: 40, animate: true });
            }
          });
        } catch(e) {
          console.error("Mapbox iframe render failed:", e);
        }
      </script>
    </body>
    </html>
  `;

  const mapboxUsage = globalSettings?.mapboxUsage;
  const isLoadsLimitExceeded = mapboxUsage
    ? ((mapboxUsage.loadsCount || 0) >= (mapboxUsage.loadsLimit || 50000) && !mapboxUsage.allowExceedLoads)
    : false;

  if (isLoadsLimitExceeded) {
    return (
      <div className="w-full h-full min-h-[400px] bg-slate-900 flex flex-col items-center justify-center p-6 text-center text-white space-y-4 rounded-b-2xl">
        <div className="bg-rose-500/10 p-4 rounded-full border border-rose-500/20">
          <Navigation className="h-8 w-8 text-rose-500 animate-pulse" />
        </div>
        <div className="space-y-2 max-w-sm">
          <h3 className="text-sm font-black uppercase tracking-tight text-white">
            Лимит показов карты исчерпан
          </h3>
          <p className="text-slate-400 text-xs font-medium leading-relaxed">
            Достигнут установленный месячный лимит в <strong className="text-white font-mono">{(mapboxUsage?.loadsLimit || 50000).toLocaleString('ru-RU')}</strong> показов Mapbox-карты.
          </p>
          <p className="text-[10px] text-slate-500 leading-normal">
            Администратор может разрешить превышение или сбросить счетчик в разделе «Администрирование».
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative font-sans">
      {loading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-xs flex flex-col items-center justify-center z-10">
          <Navigation className="w-8 h-8 text-indigo-500 animate-spin mb-2" />
          <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider font-mono">
            Обновление карты (Mapbox)...
          </span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title="Belarus Route Map Mapbox"
        className="w-full h-full border-0 rounded-b-2xl"
      />
    </div>
  );
}

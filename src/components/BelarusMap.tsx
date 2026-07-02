import React, { useEffect, useState, useRef } from 'react';
import { MapPin, Sparkles, Navigation } from 'lucide-react';

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
  const [routeData, setRouteData] = useState<{
    paths: { lat: number; lng: number }[][];
    markers: { lat: number; lng: number; label: string; active?: boolean; id?: string }[];
  }>({ paths: [], markers: [] });

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

  // Listen to drag messages from inside Leaflet iframe
  useEffect(() => {
    const handleMessage = async (event: MessageEvent) => {
      if (!event.data) return;

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

              // Fetch route polyline via our backend proxy to avoid VPN/CORS issues
              let polylinePath: { lat: number; lng: number }[] = [];
              try {
                const response = await fetch(`/api/osrm-route?coordinates=${c1.lng},${c1.lat};${c2.lng},${c2.lat}`);
                if (response.ok) {
                  const rdata = await response.json();
                  if (rdata?.routes?.[0]?.geometry?.coordinates) {
                    polylinePath = rdata.routes[0].geometry.coordinates.map((coord: [number, number]) => ({
                      lat: coord[1],
                      lng: coord[0]
                    }));
                  }
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
              const response = await fetch(`/api/osrm-route?coordinates=${coordQuery}`);
              if (response.ok) {
                const rdata = await response.json();
                if (rdata?.routes?.[0]?.geometry?.coordinates) {
                  polylinePath = rdata.routes[0].geometry.coordinates.map((coord: [number, number]) => ({
                    lat: coord[1],
                    lng: coord[0]
                  }));
                  distanceMeters = rdata.routes[0].distance || 0;
                }
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

  // Inject content into the Leaflet iframe
  const srcDoc = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css" crossorigin="anonymous" referrerpolicy="no-referrer" />
      <script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
      <style>
        body, html, #map { margin: 0; padding: 0; width: 100%; height: 100%; background: #f8fafc; }
        .leaflet-container { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
        .custom-popup .leaflet-popup-content-wrapper {
          border-radius: 12px;
          border: 1px solid #e2e8f0;
          box-shadow: 0 4px 12px rgba(0,0,0,0.05);
          padding: 4px;
        }
        .custom-popup .leaflet-popup-content {
          margin: 8px 12px;
          font-weight: 700;
          color: #1e293b;
          font-size: 11px;
          line-height: 1.4;
        }
      </style>
    </head>
    <body>
      <div id="map"></div>
      <script>
        try {
          const map = L.map('map', { zoomControl: false }).setView([53.9006, 27.5590], 5);
          
          L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
            maxZoom: 19,
            attribution: '&copy; Google Maps'
          }).addTo(map);

          L.control.zoom({ position: 'topright' }).addTo(map);

          const paths = ${JSON.stringify(routeData.paths)};
          const markers = ${JSON.stringify(routeData.markers)};

          const bounds = [];

          // Draw markers
          markers.forEach(m => {
            const color = m.active ? '#f43f5e' : '#94a3b8';
            const isDraggable = !!m.id; // draggable if it has an ID (single-route map)

            // Custom draggable HTML DivIcon
            const divIcon = L.divIcon({
              className: 'custom-div-icon',
              html: '<div style="background-color: ' + color + '; width: 14px; height: 14px; border-radius: 50%; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3); cursor: grab;"></div>',
              iconSize: [14, 14],
              iconAnchor: [7, 7]
            });

            const marker = L.marker([m.lat, m.lng], {
              icon: divIcon,
              draggable: isDraggable
            }).addTo(map);

            marker.bindPopup(m.label, { className: 'custom-popup' });
            bounds.push([m.lat, m.lng]);

            if (isDraggable) {
              marker.on('dragend', function(event) {
                const newLatLng = event.target.getLatLng();
                window.parent.postMessage({
                  type: 'MARKER_DRAG_END',
                  id: m.id,
                  lat: newLatLng.lat,
                  lng: newLatLng.lng
                }, '*');
              });
            }
          });

          // Draw route lines
          let tempMarker = null;
          let isDraggingTemp = false;

          paths.forEach((pathPoints, idx) => {
            const isActive = ${activeLegIndex === undefined || activeLegIndex === null} || idx === ${activeLegIndex};
            const color = isActive ? '#4f46e5' : '#cbd5e1';
            const weight = isActive ? 8 : 4;
            
            const latlngs = pathPoints.map(p => [p.lat, p.lng]);
            const polyline = L.polyline(latlngs, {
              color: color,
              weight: weight,
              opacity: isActive ? 0.75 : 0.35
            }).addTo(map);

            latlngs.forEach(pt => bounds.push(pt));

            const canAddWaypoints = ${!!onWaypointsChange};
            if (canAddWaypoints && isActive) {
              // Hover handling: create a responsive temporary marker when hovering the polyline
              polyline.on('mouseover', function(e) {
                if (isDraggingTemp) return;
                
                if (!tempMarker) {
                  const tempIcon = L.divIcon({
                    className: 'temp-div-icon',
                    html: '<div style="background-color: #4f46e5; width: 14px; height: 14px; border-radius: 50%; border: 2.5px solid white; box-shadow: 0 1px 5px rgba(0,0,0,0.4); cursor: pointer;"></div>',
                    iconSize: [14, 14],
                    iconAnchor: [7, 7]
                  });
                  tempMarker = L.marker(e.latlng, {
                    icon: tempIcon,
                    draggable: true
                  }).addTo(map);

                  tempMarker.on('dragstart', function() {
                    isDraggingTemp = true;
                  });

                  tempMarker.on('dragend', function(event) {
                    const newLatLng = event.target.getLatLng();
                    window.parent.postMessage({
                      type: 'ROUTE_LINE_DRAG_END',
                      legIndex: idx,
                      lat: newLatLng.lat,
                      lng: newLatLng.lng
                    }, '*');
                    
                    if (tempMarker) {
                      map.removeLayer(tempMarker);
                      tempMarker = null;
                    }
                    isDraggingTemp = false;
                  });
                } else {
                  tempMarker.setLatLng(e.latlng);
                }
              });

              polyline.on('mousemove', function(e) {
                if (tempMarker && !isDraggingTemp) {
                  tempMarker.setLatLng(e.latlng);
                }
              });

              // Click support: clicks on the route also add a waypoint immediately
              polyline.on('click', function(e) {
                if (!isDraggingTemp) {
                  window.parent.postMessage({
                    type: 'ROUTE_LINE_DRAG_END',
                    legIndex: idx,
                    lat: e.latlng.lat,
                    lng: e.latlng.lng
                  }, '*');
                }
              });
            }
          });

          // Clean up temp marker when mouse moves away from it
          map.on('mousemove', function(e) {
            if (tempMarker && !isDraggingTemp) {
              const markerLatLng = tempMarker.getLatLng();
              const dist = map.latLngToLayerPoint(e.latlng).distanceTo(map.latLngToLayerPoint(markerLatLng));
              if (dist > 40) { // pixels
                map.removeLayer(tempMarker);
                tempMarker = null;
              }
            }
          });

          if (bounds.length > 0) {
            map.fitBounds(bounds, { padding: [40, 40] });
          }
        } catch(e) {
          console.error("Leaflet iframe render failed:", e);
        }
      </script>
    </body>
    </html>
  `;

  return (
    <div className="w-full h-full relative font-sans">
      {loading && (
        <div className="absolute inset-0 bg-white/80 backdrop-blur-xs flex flex-col items-center justify-center z-10">
          <Navigation className="w-8 h-8 text-indigo-500 animate-spin mb-2" />
          <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider font-mono">
            Обновление карты (Без VPN)...
          </span>
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcDoc}
        title="Belarus Route Map Fallback"
        className="w-full h-full border-0 rounded-b-2xl"
      />
    </div>
  );
}

// Distance Calculator module - local logic without external APIs

export interface LocalCity {
  name: string;
  nameRu: string;
  country: string;
  region?: string;
  lat: number;
  lng: number;
}

// Reference dataset of major cities for transport routes (Belarus, Russia, EU, Kazakhstan)
export const citiesDataset: LocalCity[] = [
  // Belarus
  { name: "Minsk", nameRu: "Минск", country: "BY", lat: 53.9006, lng: 27.5590 },
  { name: "Brest", nameRu: "Брест", country: "BY", lat: 52.0976, lng: 23.7341 },
  { name: "Grodno", nameRu: "Гродно", country: "BY", lat: 53.6694, lng: 23.8134 },
  { name: "Gomel", nameRu: "Гомель", country: "BY", lat: 52.4345, lng: 30.9754 },
  { name: "Vitebsk", nameRu: "Витебск", country: "BY", lat: 55.1872, lng: 30.2051 },
  { name: "Mogilev", nameRu: "Могилев", country: "BY", lat: 53.8981, lng: 30.3325 },
  { name: "Bobruisk", nameRu: "Бобруйск", country: "BY", lat: 53.1384, lng: 29.2214 },
  { name: "Baranovichi", nameRu: "Барановичи", country: "BY", lat: 53.1325, lng: 26.0139 },
  { name: "Pinsk", nameRu: "Пинск", country: "BY", lat: 52.1157, lng: 26.1029 },
  { name: "Orsha", nameRu: "Орша", country: "BY", lat: 54.5073, lng: 30.4101 },
  { name: "Borisov", nameRu: "Борисов", country: "BY", lat: 54.2289, lng: 28.5122 },
  { name: "Mozyr", nameRu: "Мозырь", country: "BY", lat: 52.0495, lng: 29.2456 },
  { name: "Soligorsk", nameRu: "Солигорск", country: "BY", lat: 52.7874, lng: 27.5415 },
  { name: "Lida", nameRu: "Лида", country: "BY", lat: 53.8899, lng: 25.2974 },
  { name: "Novopolotsk", nameRu: "Новополоцк", country: "BY", lat: 55.5292, lng: 28.6579 },
  { name: "Molodechno", nameRu: "Молодечно", country: "BY", lat: 54.3120, lng: 26.8455 },
  { name: "Polotsk", nameRu: "Полоцк", country: "BY", lat: 55.4856, lng: 28.7681 },
  { name: "Zhlobin", nameRu: "Жлобин", country: "BY", lat: 52.8878, lng: 30.0436 },
  { name: "Svetlogorsk", nameRu: "Светлогорск", country: "BY", lat: 52.6333, lng: 29.4333 },
  { name: "Rechitsa", nameRu: "Речица", country: "BY", lat: 52.3639, lng: 30.3951 },
  { name: "Kobrin", nameRu: "Кобрин", country: "BY", lat: 52.2138, lng: 24.3564 },
  { name: "Slutsk", nameRu: "Слуцк", country: "BY", lat: 53.0274, lng: 27.5599 },

  // Russia
  { name: "Moscow", nameRu: "Москва", country: "RU", lat: 55.7558, lng: 37.6173 },
  { name: "Saint Petersburg", nameRu: "Санкт-Петербург", country: "RU", lat: 59.9343, lng: 30.3351 },
  { name: "Smolensk", nameRu: "Смоленск", country: "RU", lat: 54.7903, lng: 32.0503 },
  { name: "Bryansk", nameRu: "Брянск", country: "RU", lat: 53.2521, lng: 34.3717 },
  { name: "Pskov", nameRu: "Псков", country: "RU", lat: 57.8136, lng: 28.3496 },
  { name: "Kaliningrad", nameRu: "Калининград", country: "RU", lat: 54.7104, lng: 20.4522 },
  { name: "Tula", nameRu: "Тула", country: "RU", lat: 54.1961, lng: 37.6182 },
  { name: "Kaluga", nameRu: "Калуга", country: "RU", lat: 54.5293, lng: 36.2754 },
  { name: "Orel", nameRu: "Орел", country: "RU", lat: 52.9685, lng: 36.0627 },
  { name: "Kursk", nameRu: "Курск", country: "RU", lat: 51.7373, lng: 36.1874 },
  { name: "Belgorod", nameRu: "Белгород", country: "RU", lat: 50.5997, lng: 36.5982 },
  { name: "Voronezh", nameRu: "Воронеж", country: "RU", lat: 51.6720, lng: 39.1843 },
  { name: "Lipetsk", nameRu: "Липецк", country: "RU", lat: 52.6103, lng: 39.5706 },
  { name: "Ryazan", nameRu: "Рязань", country: "RU", lat: 54.6095, lng: 39.7126 },
  { name: "Vladimir", nameRu: "Владимир", country: "RU", lat: 56.1290, lng: 40.4070 },
  { name: "Yaroslavl", nameRu: "Ярославль", country: "RU", lat: 57.6261, lng: 39.8845 },
  { name: "Tver", nameRu: "Тверь", country: "RU", lat: 56.8584, lng: 35.9006 },
  { name: "Nizhny Novgorod", nameRu: "Нижний Новгород", country: "RU", lat: 56.3269, lng: 44.0059 },
  { name: "Kazan", nameRu: "Казань", country: "RU", lat: 55.7887, lng: 49.1221 },
  { name: "Samara", nameRu: "Самара", country: "RU", lat: 53.2001, lng: 50.1500 },
  { name: "Saratov", nameRu: "Саратов", country: "RU", lat: 51.5430, lng: 46.0084 },
  { name: "Rostov-on-Don", nameRu: "Ростов-на-Дону", country: "RU", lat: 47.2357, lng: 39.7015 },
  { name: "Krasnodar", nameRu: "Краснодар", country: "RU", lat: 45.0355, lng: 38.9753 },
  { name: "Volgograd", nameRu: "Волгоград", country: "RU", lat: 48.7080, lng: 44.5133 },
  { name: "Ufa", nameRu: "Уфа", country: "RU", lat: 54.7388, lng: 55.9721 },
  { name: "Chelyabinsk", nameRu: "Челябинск", country: "RU", lat: 55.1644, lng: 61.4368 },
  { name: "Ekaterinburg", nameRu: "Екатеринбург", country: "RU", lat: 56.8389, lng: 60.6057 },
  { name: "Perm", nameRu: "Пермь", country: "RU", lat: 58.0296, lng: 56.2668 },
  { name: "Novosibirsk", nameRu: "Новосибирск", country: "RU", lat: 55.0084, lng: 82.9357 },
  { name: "Omsk", nameRu: "Омск", country: "RU", lat: 54.9885, lng: 73.3242 },

  // Poland
  { name: "Warsaw", nameRu: "Варшава", country: "PL", lat: 52.2297, lng: 21.0122 },
  { name: "Bialystok", nameRu: "Белосток", country: "PL", lat: 53.1325, lng: 23.1688 },
  { name: "Poznan", nameRu: "Познань", country: "PL", lat: 52.4064, lng: 16.9252 },
  { name: "Wroclaw", nameRu: "Вроцлав", country: "PL", lat: 51.1079, lng: 17.0385 },
  { name: "Gdansk", nameRu: "Гданьск", country: "PL", lat: 54.3520, lng: 18.6466 },
  { name: "Krakow", nameRu: "Краков", country: "PL", lat: 50.0647, lng: 19.9450 },
  { name: "Lodz", nameRu: "Лодзь", country: "PL", lat: 51.7592, lng: 19.4560 },
  { name: "Lublin", nameRu: "Люблин", country: "PL", lat: 51.2465, lng: 22.5684 },
  { name: "Rzeszow", nameRu: "Жешув", country: "PL", lat: 50.0413, lng: 21.9990 },
  { name: "Katowice", nameRu: "Катовице", country: "PL", lat: 50.2649, lng: 19.0238 },
  { name: "Szczecin", nameRu: "Щецин", country: "PL", lat: 53.4285, lng: 14.5528 },

  // Lithuania
  { name: "Vilnius", nameRu: "Вильнюс", country: "LT", lat: 54.6872, lng: 25.2797 },
  { name: "Kaunas", nameRu: "Каунас", country: "LT", lat: 54.8985, lng: 23.9036 },
  { name: "Klaipeda", nameRu: "Клайпеда", country: "LT", lat: 55.7033, lng: 21.1443 },
  { name: "Siauliai", nameRu: "Шяуляй", country: "LT", lat: 55.9333, lng: 23.3167 },
  { name: "Panevezys", nameRu: "Паневежис", country: "LT", lat: 55.7333, lng: 24.3500 },

  // Latvia
  { name: "Riga", nameRu: "Рига", country: "LV", lat: 56.9496, lng: 24.1052 },
  { name: "Daugavpils", nameRu: "Даугавпилс", country: "LV", lat: 55.8747, lng: 26.5361 },
  { name: "Liepaja", nameRu: "Лиепая", country: "LV", lat: 56.5047, lng: 21.0108 },
  { name: "Ventspils", nameRu: "Вентспилс", country: "LV", lat: 57.3894, lng: 21.5606 },

  // Germany
  { name: "Berlin", nameRu: "Берлин", country: "DE", lat: 52.5200, lng: 13.4050 },
  { name: "Hamburg", nameRu: "Гамбург", country: "DE", lat: 53.5511, lng: 9.9937 },
  { name: "Munich", nameRu: "Мюнхен", country: "DE", lat: 48.1351, lng: 11.5820 },
  { name: "Cologne", nameRu: "Кёльн", country: "DE", lat: 50.9375, lng: 6.9603 },
  { name: "Frankfurt", nameRu: "Франкфурт-на-Майне", country: "DE", lat: 50.1109, lng: 8.6821 },
  { name: "Stuttgart", nameRu: "Штутгарт", country: "DE", lat: 48.7758, lng: 9.1829 },
  { name: "Dusseldorf", nameRu: "Дюссельдорф", country: "DE", lat: 51.2277, lng: 6.7735 },
  { name: "Dortmund", nameRu: "Дортмунд", country: "DE", lat: 51.5136, lng: 7.4653 },
  { name: "Leipzig", nameRu: "Лейпциг", country: "DE", lat: 51.3397, lng: 12.3731 },
  { name: "Dresden", nameRu: "Дрезден", country: "DE", lat: 51.0504, lng: 13.7373 },
  { name: "Hanover", nameRu: "Ганновер", country: "DE", lat: 52.3759, lng: 9.7320 },
  { name: "Nuremberg", nameRu: "Нюрнберг", country: "DE", lat: 49.4521, lng: 11.0767 },

  // Kazakhstan
  { name: "Almaty", nameRu: "Алматы", country: "KZ", lat: 43.2389, lng: 76.8897 },
  { name: "Astana", nameRu: "Астана", country: "KZ", lat: 51.1605, lng: 71.4704 },
  { name: "Karaganda", nameRu: "Караганда", country: "KZ", lat: 49.8047, lng: 73.0860 },
  { name: "Shymkent", nameRu: "Шымкент", country: "KZ", lat: 42.3249, lng: 69.5901 },
  { name: "Aktobe", nameRu: "Актобе", country: "KZ", lat: 50.2839, lng: 57.1670 },
  { name: "Pavlodar", nameRu: "Павлодар", country: "KZ", lat: 52.3000, lng: 76.9500 },

  // Other transits
  { name: "Paris", nameRu: "Париж", country: "FR", lat: 48.8566, lng: 2.3522 },
  { name: "Vienna", nameRu: "Вена", country: "AT", lat: 48.2082, lng: 16.3738 },
  { name: "Prague", nameRu: "Прага", country: "CZ", lat: 50.0755, lng: 14.4378 },
  { name: "Rome", nameRu: "Рим", country: "IT", lat: 41.9028, lng: 12.4964 }
];

// Normalize name (trim, remove "г.", "город", etc, lowercase)
export function normalizeLocation(name: string): string {
  if (!name) return "";
  let norm = name.trim().toLowerCase();
  
  // Remove common prefix or suffix wordforms
  norm = norm
    .replace(/^(г\.|город|д\.|деревня|пос\.|поселок|п\.|с\.|село)\s+/g, "")
    .replace(/\s+(г|город|д|деревня)$/g, "");
    
  return norm.trim();
}

// Find location in dataset matching criteria, supporting ambiguity
export function findLocalLocation(
  name: string,
  countryFilter?: string,
  regionFilter?: string
): LocalCity | LocalCity[] | null {
  const normalized = normalizeLocation(name);
  if (!normalized) return null;

  // Search by English name or Russian name (case-insensitive match)
  const matches = citiesDataset.filter((city) => {
    const normNameEn = normalizeLocation(city.name);
    const normNameRu = normalizeLocation(city.nameRu);
    return normNameEn === normalized || normNameRu === normalized || 
           normNameEn.includes(normalized) || normNameRu.includes(normalized);
  });

  if (matches.length === 0) return null;

  // If there's an exact match on name, prioritize it
  const exactMatches = matches.filter((city) => {
    return normalizeLocation(city.name) === normalized || normalizeLocation(city.nameRu) === normalized;
  });
  const candidates = exactMatches.length > 0 ? exactMatches : matches;

  // If we have country/region filters, use them to resolve ambiguity
  if (countryFilter || regionFilter) {
    const filtered = candidates.filter((city) => {
      let match = true;
      if (countryFilter && city.country.toLowerCase() !== countryFilter.toLowerCase()) {
        match = false;
      }
      if (regionFilter && city.region && city.region.toLowerCase() !== regionFilter.toLowerCase()) {
        match = false;
      }
      return match;
    });

    if (filtered.length > 0) {
      return filtered.length === 1 ? filtered[0] : filtered;
    }
  }

  // If only one candidate remains, return it
  if (candidates.length === 1) {
    return candidates[0];
  }

  // Otherwise return candidates to let caller decide or identify as ambiguous
  return candidates;
}

// Haversine straight line distance formula in km
export function calculateHaversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c;
  return Math.round(distance);
}

// Road coefficient configuration (e.g. 1.22 is a highly realistic factor for EU routes)
export const DEFAULT_ROUTE_FACTOR = 1.22;

export function estimateRoadDistance(
  straightLineKm: number,
  routeFactor: number = DEFAULT_ROUTE_FACTOR
): number {
  if (straightLineKm <= 0) return 0;
  return Math.round(straightLineKm * routeFactor);
}

export interface DistanceCalculationResult {
  straightLineKm: number;
  estimatedRouteKm: number;
  source: 'local-dataset' | 'cached-value' | 'manual' | 'unknown';
  isApproximate: boolean;
}

// Full pipeline calculation
export function calculateLocalDistance(
  from: string,
  to: string,
  presets: { from: string; to: string; distance: number }[] = [],
  routeFactor: number = DEFAULT_ROUTE_FACTOR
): DistanceCalculationResult {
  if (!from || !to) {
    return { straightLineKm: 0, estimatedRouteKm: 0, source: 'unknown', isApproximate: false };
  }

  const normFrom = normalizeLocation(from);
  const normTo = normalizeLocation(to);

  if (!normFrom || !normTo) {
    return { straightLineKm: 0, estimatedRouteKm: 0, source: 'unknown', isApproximate: false };
  }

  // 1. Try finding in cached-value presets
  const cached = presets.find((p) => {
    const pFrom = normalizeLocation(p.from);
    const pTo = normalizeLocation(p.to);
    return (pFrom === normFrom && pTo === normTo) || (pFrom === normTo && pTo === normFrom);
  });

  if (cached && cached.distance > 0) {
    return {
      straightLineKm: 0,
      estimatedRouteKm: cached.distance,
      source: 'cached-value',
      isApproximate: false
    };
  }

  // 2. Lookup in local cities dataset
  const cityFromRes = findLocalLocation(from);
  const cityToRes = findLocalLocation(to);

  // Pick exact single match if returned as array
  const cityFrom = Array.isArray(cityFromRes) ? cityFromRes[0] : cityFromRes;
  const cityTo = Array.isArray(cityToRes) ? cityToRes[0] : cityToRes;

  if (cityFrom && cityTo) {
    const straightLine = calculateHaversineDistance(
      cityFrom.lat,
      cityFrom.lng,
      cityTo.lat,
      cityTo.lng
    );
    const estimated = estimateRoadDistance(straightLine, routeFactor);
    return {
      straightLineKm: straightLine,
      estimatedRouteKm: estimated,
      source: 'local-dataset',
      isApproximate: true
    };
  }

  return {
    straightLineKm: 0,
    estimatedRouteKm: 0,
    source: 'unknown',
    isApproximate: false
  };
}

// Build google maps embed route url (without API keys, with support for waypoints)
export function buildGoogleRouteUrl(
  origin: string,
  destination: string,
  waypoints: string[] = [],
  selectedRouteIndex?: number,
  routeId?: string,
  mapType: "roadmap" | "satellite" = "roadmap",
  zoom?: number
): string {
  const cleanOrigin = origin.trim();
  const cleanDestination = destination.trim();
  const validWaypoints = waypoints.map(wp => wp.trim()).filter(wp => wp !== "");
  let baseUrl = "";
  
  // Google maps embed parameters: t=m (roadmap), t=k (satellite), t=h (hybrid), t=p (terrain)
  const tParam = mapType === "satellite" ? "k" : "m";
  
  if (validWaypoints.length > 0) {
    const daddr = [...validWaypoints, cleanDestination].join(" to: ");
    baseUrl = `https://maps.google.com/maps?saddr=${encodeURIComponent(cleanOrigin)}&daddr=${encodeURIComponent(daddr)}&dirflg=d&t=${tParam}&output=embed`;
  } else {
    baseUrl = `https://maps.google.com/maps?q=${encodeURIComponent(cleanOrigin)}+to+${encodeURIComponent(cleanDestination)}&dirflg=d&t=${tParam}&output=embed`;
  }
  
  if (selectedRouteIndex !== undefined) {
    baseUrl += `&route_index=${selectedRouteIndex}`;
  }
  if (routeId !== undefined) {
    baseUrl += `&route_id=${encodeURIComponent(routeId)}`;
  }
  if (zoom !== undefined) {
    baseUrl += `&z=${zoom}`;
  }
  return baseUrl;
}

// Build yandex maps widget route url (without API keys, with support for waypoints)
export function buildYandexRouteUrl(
  origin: string,
  destination: string,
  waypoints: string[] = [],
  selectedRouteIndex?: number,
  routeId?: string,
  mapType: "roadmap" | "satellite" = "roadmap",
  showTraffic: boolean = false,
  zoom?: number
): string {
  const points = [origin, ...waypoints, destination].map(p => p.trim()).filter(p => p !== "");
  const rtext = points.map(encodeURIComponent).join('~');
  
  // Yandex layers (l): map (schema), sat (satellite), skl (roads/labels). Traffic (trf) can be appended.
  let layer = mapType === "satellite" ? "sat,skl" : "map";
  if (showTraffic) {
    layer += ",trf";
  }
  
  let baseUrl = `https://yandex.ru/map-widget/v1/?rtext=${rtext}&rtt=auto&l=${layer}&iframe=true`;
  
  if (selectedRouteIndex !== undefined) {
    baseUrl += `&route_index=${selectedRouteIndex}`;
  }
  if (routeId !== undefined) {
    baseUrl += `&route_id=${encodeURIComponent(routeId)}`;
  }
  if (zoom !== undefined) {
    baseUrl += `&z=${zoom}`;
  }
  return baseUrl;
}

// Segment calculation
export function calculateSegmentDistance(
  from: string,
  to: string,
  presets: { from: string; to: string; distance: number }[] = [],
  routeFactor: number = DEFAULT_ROUTE_FACTOR
): DistanceCalculationResult {
  return calculateLocalDistance(from, to, presets, routeFactor);
}

// Calculate the total route distance by segment summing
export function calculateRouteDistanceBySegments(
  origin: string,
  destination: string,
  waypoints: string[],
  presets: { from: string; to: string; distance: number }[] = [],
  routeFactor: number = DEFAULT_ROUTE_FACTOR
): { totalKm: number; source: string; isApproximate: boolean } {
  const cleanOrigin = origin.trim();
  const cleanDestination = destination.trim();
  const validWaypoints = waypoints.map(w => w.trim()).filter(w => w !== "");
  
  const allPoints = [cleanOrigin, ...validWaypoints, cleanDestination].filter(p => p !== "");
  if (allPoints.length < 2) {
    return { totalKm: 0, source: 'unknown', isApproximate: false };
  }
  
  let totalKm = 0;
  let anyApproximate = false;
  let finalSource: 'cached-value' | 'local-dataset' | 'unknown' = 'cached-value';
  
  for (let i = 0; i < allPoints.length - 1; i++) {
    const res = calculateLocalDistance(allPoints[i], allPoints[i+1], presets, routeFactor);
    totalKm += res.estimatedRouteKm;
    if (res.isApproximate) {
      anyApproximate = true;
    }
    // Downgrade the source quality as soon as we encounter lower quality
    if (res.source === 'local-dataset' && finalSource === 'cached-value') {
      finalSource = 'local-dataset';
    } else if (res.source === 'unknown') {
      finalSource = 'unknown';
    }
  }
  
  return {
    totalKm,
    source: finalSource,
    isApproximate: anyApproximate
  };
}

// Reorder waypoints helper
export function reorderWaypoints(waypoints: string[], fromIndex: number, toIndex: number): string[] {
  if (toIndex < 0 || toIndex >= waypoints.length) return waypoints;
  const updated = [...waypoints];
  const [moved] = updated.splice(fromIndex, 1);
  updated.splice(toIndex, 0, moved);
  return updated;
}

// Apply route to mileage field
export function applyRouteToMileageField(
  origin: string,
  destination: string,
  waypoints: string[],
  presets: { from: string; to: string; distance: number }[] = [],
  routeFactor: number = DEFAULT_ROUTE_FACTOR
): { totalKm: number; source: string; isApproximate: boolean } {
  return calculateRouteDistanceBySegments(origin, destination, waypoints, presets, routeFactor);
}

// Wrapper for manual and auto calculation integration
export function applyDistanceToField(
  from: string,
  to: string,
  presets: { from: string; to: string; distance: number }[] = [],
  routeFactor: number = DEFAULT_ROUTE_FACTOR
): DistanceCalculationResult {
  return calculateLocalDistance(from, to, presets, routeFactor);
}

export interface RouteSegment {
  from: string;
  to: string;
  distanceKm: number;
  source: string;
  isApproximate: boolean;
}

export interface RouteOption {
  name: string;
  factor: number;
  segments: RouteSegment[];
  totalDistanceKm: number;
}

// Normalizes waypoints to avoid duplicates and empty fields
export function normalizeRoutePoints(
  origin: string,
  destination: string,
  waypoints: string[]
): { origin: string; destination: string; waypoints: string[] } {
  const normOrigin = origin.trim();
  const normDestination = destination.trim();
  
  // Filter waypoints
  const seen = new Set<string>();
  if (normOrigin) seen.add(normOrigin.toLowerCase());
  
  const cleanWaypoints: string[] = [];
  waypoints.forEach(wp => {
    const trimmed = wp.trim();
    if (!trimmed) return; // filter empty
    const lower = trimmed.toLowerCase();
    
    // check if it duplicates origin, destination or previous waypoint
    const lastPoint = cleanWaypoints.length > 0 
      ? cleanWaypoints[cleanWaypoints.length - 1].toLowerCase() 
      : normOrigin.toLowerCase();
      
    if (lower === normDestination.toLowerCase()) return; // duplicates destination
    if (lower === lastPoint) return; // duplicates previous point or origin
    
    cleanWaypoints.push(trimmed);
  });
  
  return {
    origin: normOrigin,
    destination: normDestination,
    waypoints: cleanWaypoints
  };
}

// Normalized Route Interface (Adapter Pattern)
export interface NormalizedRoute {
  provider: "google" | "yandex";
  routeId: string;
  summary: string;
  distanceKm: number;
  duration: string;
  segments: RouteSegment[];
  polyline?: string;
  geometry?: string; // Unified with polyline
  transportMode: string;
  isRoadRoute: boolean;
  sortKey?: string;
  rank?: number;
}

// Get routing factors for vehicle type (Truck has priority and higher mileage factors)
export function getFactorsForVehicle(vehicleType: "truck" | "car" | string) {
  if (vehicleType === "car") {
    return [
      { name: "Рекомендуемый", factor: 1.20 },
      { name: "Быстрый", factor: 1.12 },
      { name: "Объездной", factor: 1.28 }
    ];
  } else {
    // Default/priority is truck (cargo)
    return [
      { name: "Рекомендуемый", factor: 1.25 },
      { name: "Альтернативный", factor: 1.35 },
      { name: "Экономичный", factor: 1.18 }
    ];
  }
}

// Detailed segment-by-segment calculation
export function calculateDetailedSegments(
  origin: string,
  destination: string,
  waypoints: string[],
  presets: { from: string; to: string; distance: number }[] = [],
  routeFactor: number = DEFAULT_ROUTE_FACTOR
): RouteSegment[] {
  const cleanOrigin = origin.trim();
  const cleanDestination = destination.trim();
  const validWaypoints = waypoints.map(w => w.trim()).filter(w => w !== "");
  
  const allPoints = [cleanOrigin, ...validWaypoints, cleanDestination].filter(p => p !== "");
  if (allPoints.length < 2) {
    return [];
  }
  
  const segments: RouteSegment[] = [];
  for (let i = 0; i < allPoints.length - 1; i++) {
    const res = calculateLocalDistance(allPoints[i], allPoints[i+1], presets, routeFactor);
    segments.push({
      from: allPoints[i],
      to: allPoints[i+1],
      distanceKm: res.estimatedRouteKm,
      source: res.source,
      isApproximate: res.isApproximate
    });
  }
  return segments;
}

// Raw routes simulator (representing raw API responses before normalization and filtering)
export function getRawRoutesFromAPI(
  origin: string,
  destination: string,
  waypoints: string[],
  presets: { from: string; to: string; distance: number }[] = [],
  mapProvider: "google" | "yandex" | string = "google",
  vehicleType: "truck" | "car" | string = "truck"
): NormalizedRoute[] {
  if (!origin || !destination) return [];
  const provider = mapProvider === "yandex" ? "yandex" : "google";
  const factors = getFactorsForVehicle(vehicleType);
  const baseSegments = calculateDetailedSegments(origin, destination, waypoints, presets, 1.0);
  const baseDistance = baseSegments.reduce((sum, s) => sum + s.distanceKm, 0);

  if (baseDistance === 0) return [];

  const rawList: NormalizedRoute[] = [];

  // 1. Generate automobile/truck road routes based on coefficients
  factors.forEach((f, idx) => {
    const routeFactor = f.factor;
    const segments = calculateDetailedSegments(origin, destination, waypoints, presets, routeFactor);
    const totalDist = segments.reduce((sum, s) => sum + s.distanceKm, 0);
    
    // Yandex doesn't support a dedicated truck mode natively, so we clearly label and map it to road driving mode
    const mode = provider === "yandex"
      ? "driving" 
      : (vehicleType === "car" ? "driving" : "truck");

    rawList.push({
      provider,
      routeId: `${provider}-road-${idx}`,
      summary: provider === "yandex"
        ? `Яндекс Авто (${f.name})`
        : `Google ${vehicleType === "car" ? "Легковой" : "Грузовой"} (${f.name})`,
      distanceKm: totalDist,
      duration: `${Math.round(totalDist / (vehicleType === "car" ? 80 : 65))} ч`,
      segments,
      polyline: `geometry-${provider}-${idx}`,
      geometry: `geometry-${provider}-${idx}`,
      transportMode: mode,
      isRoadRoute: true,
      sortKey: `road-${idx}`,
      rank: idx + 1
    });
  });

  // 2. Add non-automobile routes to represent what raw APIs sometimes return
  // (We'll use these to test the filtering code)
  rawList.push({
    provider,
    routeId: `${provider}-rail-transit`,
    summary: `${provider === "yandex" ? "Яндекс" : "Google"} Поезд / ЖД Экспресс`,
    distanceKm: Math.round(baseDistance * 0.95),
    duration: `${Math.round(baseDistance / 90)} ч`,
    segments: calculateDetailedSegments(origin, destination, waypoints, presets, 0.95),
    polyline: "rail-geometry",
    geometry: "rail-geometry",
    transportMode: "train", // Transit / Rail mode
    isRoadRoute: false,
    sortKey: "rail-99",
    rank: 99
  });

  rawList.push({
    provider,
    routeId: `${provider}-walking-path`,
    summary: `${provider === "yandex" ? "Яндекс" : "Google"} Пешеходная тропа`,
    distanceKm: Math.round(baseDistance * 0.92),
    duration: `${Math.round(baseDistance / 5)} ч`,
    segments: calculateDetailedSegments(origin, destination, waypoints, presets, 0.92),
    polyline: "walk-geometry",
    geometry: "walk-geometry",
    transportMode: "walking", // Walking mode
    isRoadRoute: false,
    sortKey: "walk-100",
    rank: 100
  });

  return rawList;
}

// Filter and Validate function: strictly keep automobile routes and exclude rail/walking/mixed
export function filterAndValidateRoutes(routes: NormalizedRoute[]): NormalizedRoute[] {
  return routes.filter(r => {
    // Allowed: driving, truck, commercial
    const isAllowedMode = r.transportMode === "driving" || r.transportMode === "truck" || r.transportMode === "commercial";
    // Disallowed: transit, rail, train, walking, mixed
    const isDisallowedMode = r.transportMode === "transit" || r.transportMode === "rail" || r.transportMode === "train" || r.transportMode === "walking" || r.transportMode === "mixed";
    
    return isAllowedMode && !isDisallowedMode && r.isRoadRoute;
  });
}

// Compute the list of routes with segments and totalDistanceKm (filtered & validated)
export function computeRoutesList(
  origin: string,
  destination: string,
  waypoints: string[],
  presets: { from: string; to: string; distance: number }[] = [],
  vehicleType: "truck" | "car" | string = "truck",
  mapProvider: "google" | "yandex" | string = "google"
): NormalizedRoute[] {
  const rawRoutes = getRawRoutesFromAPI(origin, destination, waypoints, presets, mapProvider, vehicleType);
  return filterAndValidateRoutes(rawRoutes);
}

// Recalculates route data with protections and falls back appropriately
export function recalculateLegRoute(
  origin: string,
  destination: string,
  waypoints: string[],
  mapProvider: "google" | "yandex" | string,
  vehicleType: "truck" | "car" | string,
  selectedRouteIndex: number,
  presets: { from: string; to: string; distance: number }[] = []
) {
  // 1. Normalize points
  const norm = normalizeRoutePoints(origin, destination, waypoints);
  
  // 2. Compute raw routes count for debug, then get normalized/filtered routes
  const rawRoutes = getRawRoutesFromAPI(norm.origin, norm.destination, norm.waypoints, presets, mapProvider, vehicleType);
  const rawRoutesCount = rawRoutes.length;

  const routes = filterAndValidateRoutes(rawRoutes);
  
  // 3. Check selected index range protection
  let routeIndex = selectedRouteIndex;
  if (routeIndex < 0 || routeIndex >= routes.length) {
    routeIndex = 0;
  }
  
  const selectedRoute = routes[routeIndex];
  const segments = selectedRoute ? selectedRoute.segments : [];
  const totalDistanceKm = selectedRoute ? selectedRoute.distanceKm : 0;
  const provider = mapProvider === "yandex" ? "yandex" : "google";
  
  return {
    origin: norm.origin,
    destination: norm.destination,
    waypoints: norm.waypoints,
    mapProvider: provider,
    vehicleType: vehicleType === "car" ? "car" : "truck",
    selectedRouteIndex: routeIndex,
    routes,
    segments,
    totalDistanceKm,
    // sync back to legacy attributes
    from: norm.origin,
    to: norm.destination,
    dist: totalDistanceKm,
    distance: totalDistanceKm,
    isManual: false,
    manualOverride: false,
    distanceSource: selectedRoute ? 'map-route' : 'unknown',
    routeError: routes.length === 0 && (norm.origin || norm.destination)
      ? "Для этого провайдера не найден корректный автомобильный маршрут"
      : null,
    // Debug info
    debug: {
      provider,
      transportMode: selectedRoute ? selectedRoute.transportMode : "none",
      rawCount: rawRoutesCount,
      filteredCount: routes.length,
      selectedIndex: routeIndex,
      totalDistanceKm
    }
  };
}


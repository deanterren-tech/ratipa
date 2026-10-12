/**
 * audit-db-quality — АУДИТ КАЧЕСТВА БАЗЫ RATIPA (ТОЛЬКО ЧТЕНИЕ).
 *
 * Что делает: обходит реальную RTDB, ищет дубликаты, неверно введённые данные
 * (кир/лат в номерах, пустые обязательные поля, некорректные даты/суммы),
 * несогласованности (архив/открытые периоды/одновременные состояния) и мусор
 * прошлых прогонов (probe-…, qa_…, test-…, tmp-…), и пишет JSON + MD отчёт.
 *
 * НИЧЕГО НЕ ПИШЕТ В БАЗУ. Разрешены только чтения: ref(...).get(),
 * limitToLast(...).get() и REST-чтения shallow (тоже только GET).
 * Проверка: grep по этому файлу на set(/update(/remove(/push(/delete( — пусто.
 *
 * Запуск:
 *   npx tsx scripts/audit-db-quality.ts                  # всё: текст + JSON + MD
 *   npx tsx scripts/audit-db-quality.ts --json           # только машинный JSON в stdout
 *   npx tsx scripts/audit-db-quality.ts --section=duplicates
 *   npx tsx scripts/audit-db-quality.ts --section=duplicates,malformed --limit=20
 *   npx tsx scripts/audit-db-quality.ts --out=DIR --now=2026-10-13T00:00:00Z --stale-days=60
 *
 * Моды: --json, --section=<структура|duplicates|malformed|consistency|legacy>,
 *       --limit=N (примеров на пункт, по умолчанию 10), --out=DIR (каталог отчёта),
 *       --now=ISO (фиксировать «сейчас» — повторный прогон детерминирован),
 *       --stale-days=N (порог «машина без выезда», по умолчанию 60).
 *
 * Персональные данные: ФИО водителей в отчёт НЕ выгружаются (только id и
 * короткие номера машин, даты, id записей). Имена сотрудников/диспетчеров —
 * служебные учётные записи портала, допускаются точечно.
 */
import { mkdirSync, readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
// firebaseAdmin грузится динамически (см. loadAdmin): в --json-режиме его лог
// инициализации уводится в stderr, чтобы stdout оставался чистым JSON.
let adminApp: any = null;
let adminDb: any = null;
let DATABASE_URL = '';

async function loadAdmin(): Promise<void> {
  const mod: any = await import('../firebaseAdmin.ts');
  adminApp = mod.adminApp;
  adminDb = mod.adminDb;
  DATABASE_URL = mod.DATABASE_URL;
}
import {
  dateIssues,
  dayToIso,
  dupGroups,
  endBeforeStart,
  foldPlate,
  hasSpaceNoise,
  isTestPlate,
  letterMix,
  looksJunk,
  normCityName,
  normText,
  numIssues,
  parseLooseDate,
  personKeyRu,
  plateInfo,
  twinGroups,
} from './db-quality-core.ts';

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

const ARGS = process.argv.slice(2);
const JSON_ONLY = ARGS.includes('--json');
const argOf = (name: string): string | null => {
  const hit = ARGS.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};
const OUT_DIR = argOf('out') || '/Users/sergei/.hermes/cache/scratch/dbclean';
const LIMIT = Math.max(1, Number(argOf('limit')) || 10);
const STALE_DAYS = Math.max(7, Number(argOf('stale-days')) || 60);
const NOW = (() => {
  const p = parseLooseDate(argOf('now')?.slice(0, 10) || argOf('now'));
  return p ? p : parseLooseDate(new Date().toISOString().slice(0, 10))!;
})();
const SECTIONS_ALL = ['structure', 'duplicates', 'malformed', 'consistency', 'legacy'] as const;
type SectionName = (typeof SECTIONS_ALL)[number];
const requested = (argOf('section') || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const SECTIONS: SectionName[] = requested.length
  ? (SECTIONS_ALL.filter((s) => requested.includes(s)) as SectionName[])
  : [...SECTIONS_ALL];
const TESTS_FILE = argOf('tests') || join(OUT_DIR, 'unit-tests.latest.json');

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url)); // scripts/.. = корень репозитория

// ─────────────────────────────────────────────────────────────────────────────
// Общие утилиты
// ─────────────────────────────────────────────────────────────────────────────

const s = (v: unknown): string => String(v ?? '');
const objOf = (raw: unknown): Record<string, unknown> => (raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {});
const entriesOf = (raw: unknown): Array<{ key: string; rec: Record<string, unknown> }> => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  return Object.entries(raw as Record<string, unknown>)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v]) => ({ key, rec: v as Record<string, unknown> }));
};
const arrOf = (raw: unknown): Array<Record<string, unknown>> =>
  Array.isArray(raw)
    ? (raw.filter((v) => v && typeof v === 'object') as Array<Record<string, unknown>>)
    : entriesOf(raw).map((e) => e.rec);

interface FullRead { path: string; val: unknown; bytes: number }
const fullReads = new Map<string, FullRead>();
const fullReadList = [
  'trips_dashboard', 'trips', 'tripsdashboard', 'current_trips', 'planDohod',
  'baza', 'baza_cars', 'archive',
  'tripTimeline',
  'vehicleFleet', 'couplings', 'tractors', 'trailers', 'drivers', 'ferryCouples',
  'directories', 'vehicle_statuses', 'knownDistancesList', 'knownFleetCars', 'known_fleet', 'carsPool',
  'users', 'users_list',
  'salaryHistory', 'global_history', 'ratipa_zagruzok_log', 'calculationsHistory',
  'templates', 'stageTemplates', 'appErrors', 'agent_audit', 'ratipa_loading_plan',
];

// Ветки, сознательно НЕ читаемые целиком (другие модули/гигантский объём):
// auditLogs (432k записей), telemetry_*, dozvols*, quota*, bamap*, ratipa_home_*, routedesk и пр.
// По ним — только структурный подсчёт (shallow) в секции `structure`.

let restToken: string | null = null;
async function getRestToken(): Promise<string | null> {
  if (restToken) return restToken;
  try {
    const cred: any = (adminApp as any)?.options?.credential;
    const tok = await cred?.getAccessToken();
    restToken = tok?.access_token || null;
  } catch {
    restToken = null;
  }
  return restToken;
}

/** Shallow-чтение узла (только GET): список ключей детей или скаляр. null — ошибка/недоступно. */
async function shallowNode(path: string): Promise<{ kind: 'object' | 'array' | 'scalar' | 'empty'; children: number } | null> {
  const tok = await getRestToken();
  if (!tok) return null;
  const url = `${DATABASE_URL}/${path}.json?shallow=true&access_token=${encodeURIComponent(tok)}`;
  try {
    const r = await fetch(url, { method: 'GET' });
    if (!r.ok) return null;
    const j: any = await r.json();
    if (j === null || j === undefined) return { kind: 'empty', children: 0 };
    if (typeof j === 'object') {
      const n = Object.keys(j).length;
      return { kind: Array.isArray(j) ? 'array' : 'object', children: n };
    }
    return { kind: 'scalar', children: 0 };
  } catch {
    return null;
  }
}

async function readAll(): Promise<void> {
  for (const path of fullReadList) {
    const snap = await adminDb!.ref(path).get();
    const val = snap.val();
    const bytes = val === null ? 0 : Buffer.byteLength(JSON.stringify(val), 'utf8');
    fullReads.set(path, { path, val, bytes });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Секция STRUCTURE — инвентарь веток
// ─────────────────────────────────────────────────────────────────────────────

interface StructureRow {
  name: string;
  kind: 'object' | 'array' | 'scalar' | 'empty' | 'unknown';
  children: number | null;
  bytes: number | null;
  refsApp: number;
  note?: string;
  verdict: 'используется' | 'зеркало/вторичная' | 'легаси с данными' | 'тест/мусор' | 'вне области' | 'пусто';
}

const BRANCH_NOTES: Record<string, { note: string; verdict: StructureRow['verdict'] }> = {
  trips_dashboard: { note: 'основной журнал рейсов (модуль «План дохода»)', verdict: 'используется' },
  trips: { note: 'одноимённая ветка старого поколения (refs=1, записи с цифровым мусором)', verdict: 'легаси с данными' },
  tripsdashboard: { note: 'читается dbService.getTrips (бейдж MobileMoreHub); при ПУСТОЙ ветке код сам засеивает демо-записи (firebase.ts)', verdict: 'легаси с данными' },
  current_trips: { note: 'не читается кодом; 1 запись из цифр', verdict: 'тест/мусор' },
  planDohod: { note: 'ветка старого «Плана дохода»; 1 запись test-plan-1', verdict: 'тест/мусор' },
  baza: { note: 'журнал «Учёт выезда» — основная ветка периодов базы', verdict: 'используется' },
  baza_cars: { note: 'вторая корзина BazaModule (читается и пишется вместе с baza/archive)', verdict: 'зеркало/вторичная' },
  archive: { note: 'ветка-зеркало архива «Учёта выезда» (BazaModule пишет при архивации)', verdict: 'зеркало/вторичная' },
  tripTimeline: { note: 'таймлайн рейсов: tripStages/planGuard/planPerms/planRequests/vehicleEvents/config', verdict: 'используется' },
  vehicleFleet: { note: 'бывший «центр»; текущие записи — заглушки {status}, читается старыми модулями (driverSync/bazaSync/Documents/VehicleDriverData)', verdict: 'легаси с данными' },
  couplings: { note: 'действующий «центр» сцепок (portal-схема fleetService)', verdict: 'используется' },
  tractors: { note: 'справочник тягачей (используется)', verdict: 'используется' },
  trailers: { note: 'справочник прицепов (используется)', verdict: 'используется' },
  drivers: { note: 'справочник водителей (portal-схема)', verdict: 'используется' },
  ferryCouples: { note: 'зеркало для документов (DocumentsModule зеркалит vehicleFleet→ferryCouples)', verdict: 'зеркало/вторичная' },
  directories: { note: 'реестры: directions/rateGroups/standardDistances/statusTypes/trailerBrands/vehicleBrands', verdict: 'используется' },
  vehicle_statuses: { note: 'статусы машин по номерам; 1 сопоставление с couplings', verdict: 'используется' },
  knownDistancesList: { note: 'справочник расстояний города↔города', verdict: 'используется' },
  knownFleetCars: { note: 'DOZVOLA: «известные машины» (точки) — используется dozvola-модулем', verdict: 'используется' },
  known_fleet: { note: 'ещё один запас «известных машин» (частично упоминается в коде — сверить с knownFleetCars)', verdict: 'легаси с данными' },
  carsPool: { note: 'микро-ветка (2 записи); почти не используется', verdict: 'легаси с данными' },
  users: { note: 'профили/нотификации (users/<uid>)', verdict: 'используется' },
  users_list: { note: 'список сотрудников и права (users_list/<id>) — второй параллельный стор users', verdict: 'используется' },
  salaryHistory: { note: 'история расчёта зарплат', verdict: 'используется' },
  global_history: { note: 'журнал изменений карточек машин', verdict: 'используется' },
  ratipa_zagruzok_log: { note: 'журнал правок «Плана загрузок» старого поколения', verdict: 'легаси с данными' },
  calculationsHistory: { note: 'история калькулятора (80 записей, часть — нумерованные)', verdict: 'используется' },
  templates: { note: 'массив маршрут-шаблонов (6) старого поколения', verdict: 'легаси с данными' },
  stageTemplates: { note: 'шаблоны этапов таймлайна (3 шт; используется)', verdict: 'используется' },
  appErrors: { note: 'журнал ошибок клиента (develop-шум)', verdict: 'вне области' },
  agent_audit: { note: 'агент-аудит: конфиг + предложения (есть тестовое)', verdict: 'используется' },
  ratipa_loading_plan: { note: 'план загрузок СТАРОГО поколения (items/taken_loads); в текущем коде НЕ читается (новый модуль — Google Sheets)', verdict: 'легаси с данными' },
  routedesk: { note: 'данные приложения RouteDesk (задания/рейсы) — ОТДЕЛЬНОЕ приложение', verdict: 'вне области' },
  auditLogs: { note: 'журнал действий портала (432k записей, ~112 МБ)', verdict: 'вне области' },
  appSettings: { note: 'настройки ссылок/вкладок', verdict: 'используется' },
  settings: { note: 'структура меню портала', verdict: 'используется' },
  telemetry_alerts: { note: 'телеметрия Nav.by (модуль «Пробег и связь»)', verdict: 'вне области' },
};

function scanRefs(): { get: (name: string) => number } {
  const text = (() => {
    const dirs = ['src', 'api', 'telegram_bot'];
    const files = ['server.ts', 'firebaseAdmin.ts'];
    const walk = (d: string): string[] => {
      const out: string[] = [];
      try {
        for (const e of readdirSync(join(REPO_ROOT, d), { withFileTypes: true })) {
          if (e.isDirectory()) out.push(...walk(join(d, e.name)));
          else if (/\.(ts|tsx|js|mjs|cjs)$/.test(e.name)) out.push(join(d, e.name));
        }
      } catch { /* нет каталога */ }
      return out;
    };
    let all: string[] = [];
    for (const d of dirs) all = all.concat(walk(d));
    all = all.concat(files.filter((f) => existsSync(join(REPO_ROOT, f))));
    return all.map((f) => { try { return readFileSync(join(REPO_ROOT, f), 'utf8'); } catch { return ''; } }).join('\n');
  })();
  const cache = new Map<string, number>();
  return {
    get: (name: string): number => {
      if (cache.has(name)) return cache.get(name)!;
      const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`['"\`]${esc}(/|['"\`])`, 'g');
      const n = (text.match(re) || []).length;
      cache.set(name, n);
      return n;
    },
  };
}

async function buildStructure(topNames: string[]): Promise<{ rows: StructureRow[]; totals: Record<string, number> }> {
  const refs = scanRefs();
  const rows: StructureRow[] = [];
  for (const name of topNames) {
    const full = fullReads.get(name);
    let kind: StructureRow['kind'] = 'unknown';
    let children: number | null = null;
    let bytes: number | null = null;
    if (full) {
      const v = full.val;
      kind = v === null ? 'empty' : Array.isArray(v) ? 'array' : typeof v === 'object' ? 'object' : 'scalar';
      children = v === null ? 0 : Array.isArray(v) ? v.length : typeof v === 'object' ? Object.keys(v as object).length : 0;
      bytes = full.bytes;
    } else {
      const sh = await shallowNode(name);
      if (sh) {
        kind = sh.kind === 'empty' ? 'empty' : sh.kind;
        children = sh.children;
      }
    }
    const refCount = refs.get(name);
    const curated = BRANCH_NOTES[name];
    const verdict: StructureRow['verdict'] = curated
      ? curated.verdict
      : (children ?? 0) === 0
        ? 'пусто'
        : refCount === 0
          ? 'легаси с данными'
          : 'используется';
    rows.push({ name, kind, children, bytes, refsApp: refCount, note: curated?.note, verdict });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name));
  const totals = {
    branches: rows.length,
    withData: rows.filter((r) => (r.children ?? 0) > 0).length,
    unusedWithData: rows.filter((r) => r.verdict === 'легаси с данными' && (r.children ?? 0) > 0).length,
    testJunk: rows.filter((r) => r.verdict === 'тест/мусор').length,
  };
  return { rows, totals };
}

// ─────────────────────────────────────────────────────────────────────────────
// Секция DUPLICATES
// ─────────────────────────────────────────────────────────────────────────────

interface DupSection {
  tripsExact: Array<{ key: string; items: Array<Record<string, unknown>> }>;
  tripsNear: Array<Record<string, unknown>>;
  tripsHidden: Array<Record<string, unknown>>;
  bazaExact: Array<{ key: string; items: Array<Record<string, unknown>> }>;
  bazaNear: Array<Record<string, unknown>>;
  bazaAcrossBranches: Array<Record<string, unknown>>;
  stagesExact: Array<{ key: string; items: Array<Record<string, unknown>> }>;
  stagesSameDateDiffLabel: Array<Record<string, unknown>>;
  stagesSeqDup: Array<Record<string, unknown>>;
  eventsExact: Array<{ key: string; items: Array<Record<string, unknown>> }>;
  dirsGroups: Array<Record<string, unknown>>;
  crossBranchTwinGroups: Array<Record<string, unknown>>;
  usersDelta: Record<string, unknown>;
  distancesDup: Array<Record<string, unknown>>;
  historyDup: Array<Record<string, unknown>>;
  counts: Record<string, number>;
}

function buildDuplicates(): DupSection {
  const out: DupSection = {
    tripsExact: [], tripsNear: [], tripsHidden: [], bazaExact: [], bazaNear: [], bazaAcrossBranches: [],
    stagesExact: [], stagesSameDateDiffLabel: [], stagesSeqDup: [], eventsExact: [],
    dirsGroups: [], crossBranchTwinGroups: [], usersDelta: {}, distancesDup: [], historyDup: [], counts: {},
  };

  // ── рейсы ──────────────────────────────────────────────────────────────
  const trips = entriesOf(fullReads.get('trips_dashboard')?.val);
  const tRow = (id: string, rec: Record<string, unknown>) => ({
    id: s(rec.id) || id,
    carNumber: s(rec.carNumber),
    start: s(rec.dateStart),
    end: s(rec.dateEnd),
    direction: s(rec.direction),
    archived: rec.isArchived === true,
  });
  const tItems = trips.map(({ key, rec }) => ({ key, rec, carKey: foldPlate(String(rec.carNumber ?? '').split('/')[0]) }));
  out.tripsExact = dupGroups(tItems.filter((x) => x.carKey && parseLooseDate(x.rec.dateStart)), (x) => `${x.carKey}|${parseLooseDate(x.rec.dateStart)!.iso}`)
    .map((g) => ({ key: g.key, items: g.items.map((x) => tRow(x.key, x.rec)) }));
  const byCar = new Map<string, typeof tItems>();
  tItems.forEach((x) => { if (x.carKey) byCar.set(x.carKey, [...(byCar.get(x.carKey) || []), x]); });
  byCar.forEach((list, carKey) => {
    const withStart = list.filter((x) => parseLooseDate(x.rec.dateStart)).sort((a, b) => (parseLooseDate(a.rec.dateStart)!.day - parseLooseDate(b.rec.dateStart)!.day));
    for (let i = 0; i < withStart.length; i += 1) {
      for (let j = i + 1; j < withStart.length; j += 1) {
        const a = withStart[i], b = withStart[j];
        const diff = Math.abs(parseLooseDate(a.rec.dateStart)!.day - parseLooseDate(b.rec.dateStart)!.day);
        if (diff > 1) break;
        if (diff === 0) continue; // точные уже в tripsExact
        const legsSig = (rec: Record<string, unknown>) => arrOf(rec.legs).map((l) => `${normCityName(l.from)}>${normCityName(l.to)}`).join('|');
        out.tripsNear.push({
          a: tRow(a.key, a.rec).id, b: tRow(b.key, b.rec).id, carNumber: s(a.rec.carNumber), startDiff: diff,
          sameEnd: s(a.rec.dateEnd) && s(a.rec.dateEnd) === s(b.rec.dateEnd),
          sameDirection: !!normText(a.rec.direction) && normText(a.rec.direction) === normText(b.rec.direction),
          sameLegs: legsSig(a.rec) !== '' && legsSig(a.rec) === legsSig(b.rec),
          sameFreight: a.rec.totalFreight !== undefined && s(a.rec.totalFreight) === s(b.rec.totalFreight),
        });
      }
    }
  });
  out.tripsHidden = trips.filter(({ rec }) => rec.duplicateOf || rec.hiddenFromTimeline === true).map(({ key, rec }) => ({ id: s(rec.id) || key, duplicateOf: s(rec.duplicateOf), hiddenReason: s(rec.hiddenReason), carNumber: s(rec.carNumber) }));

  // ── периоды базы ───────────────────────────────────────────────────────
  const baza = entriesOf(fullReads.get('baza')?.val).map(({ key, rec }) => ({
    key, rec,
    id: s(rec.id) || key,
    carKey: foldPlate(String(rec.carNumber ?? '').split('/')[0]),
    plateFull: foldPlate(String(rec.carNumber ?? '')),
    status: s(rec.status) || 'base',
    arrival: parseLooseDate(rec.dateArrival)?.iso ?? '',
    arrivalDay: parseLooseDate(rec.dateArrival)?.day ?? null,
    departure: s(rec.dateDeparture),
    driverId: s(rec.driverId),
    comment: s(rec.comment),
  }));
  out.bazaExact = dupGroups(baza.filter((b) => b.arrival), (b) => `${b.carKey}|${b.status}|${b.arrival}`)
    .map((g) => ({ key: g.key, items: g.items.map((b) => ({ id: b.id, carNumber: s(b.rec.carNumber), status: b.status, arrival: b.arrival, departure: b.departure, archived: b.rec.isArchived === true || b.status === 'archive' })) }));
  const byCarBaza = new Map<string, typeof baza>();
  baza.forEach((b) => { if (b.carKey) byCarBaza.set(b.carKey, [...(byCarBaza.get(b.carKey) || []), b]); });
  byCarBaza.forEach((list) => {
    const withStart = list.filter((b) => b.arrivalDay != null).sort((x, y) => (x.arrivalDay! - y.arrivalDay!));
    for (let i = 0; i < withStart.length; i += 1) {
      for (let j = i + 1; j < withStart.length; j += 1) {
        const a = withStart[i], b = withStart[j];
        const diff = Math.abs(a.arrivalDay! - b.arrivalDay!);
        if (diff > 1) break;
        if (diff === 0) continue;
        out.bazaNear.push({
          a: a.id, b: b.id, carNumber: s(a.rec.carNumber), startDiff: diff,
          sameDriver: !!a.driverId && a.driverId === b.driverId,
          sameComment: !!normText(a.comment) && normText(a.comment) === normText(b.comment),
        });
      }
    }
  });
  // пересечения веток baza / baza_cars / archive по id
  const bazaK = new Set(baza.map((b) => b.key));
  const bcEntries = entriesOf(fullReads.get('baza_cars')?.val);
  const arEntries = entriesOf(fullReads.get('archive')?.val);
  const bcK = new Set(bcEntries.map((e) => e.key));
  const arK = new Set(arEntries.map((e) => e.key));
  const overlap = (a: Set<string>, b: Set<string>) => [...a].filter((k) => b.has(k)).sort();
  const mk = (id: string) => {
    const rec = baza.find((b) => b.key === id)?.rec || bcEntries.find((e) => e.key === id)?.rec || arEntries.find((e) => e.key === id)?.rec || {};
    return { id, carNumber: s(rec.carNumber), inBaza: bazaK.has(id), inBazaCars: bcK.has(id), inArchive: arK.has(id) };
  };
  out.bazaAcrossBranches = [
    ...overlap(bcK, arK).map((id) => ({ ...mk(id), where: 'baza_cars+archive' })),
    ...overlap(bazaK, arK).map((id) => ({ ...mk(id), where: 'baza+archive' })),
    ...overlap(bazaK, bcK).map((id) => ({ ...mk(id), where: 'baza+baza_cars' })),
  ];
  out.counts.bazaCrossIds = out.bazaAcrossBranches.length;

  // ── этапы ──────────────────────────────────────────────────────────────
  const tt = objOf(fullReads.get('tripTimeline')?.val);
  const stagesStores = objOf(tt.tripStages);
  const stages: Array<{ tripId: string; id: string; type: string; label: string; date: string; seq: number | null; order: number | null }> = [];
  Object.entries(stagesStores).forEach(([tripId, raw]) => {
    arrOf(raw).forEach((st, i) => {
      stages.push({
        tripId, id: s(st.id) || `${tripId}~${i + 1}`, type: s(st.type), label: s(st.label),
        date: parseLooseDate(st.plannedDate)?.iso ?? parseLooseDate(st.actualDate)?.iso ?? '',
        seq: Number.isFinite(Number(st.seq)) ? Math.floor(Number(st.seq)) : null,
        order: Number.isFinite(Number(st.order)) ? Math.floor(Number(st.order)) : null,
      });
    });
  });
  out.stagesExact = dupGroups(stages.filter((st) => st.date), (st) => `${st.tripId}|${st.type}|${st.date}|${normText(st.label)}`)
    .map((g) => ({ key: g.key, items: g.items.map((st) => ({ tripId: st.tripId, id: st.id, label: st.label })) }));
  const sameDate = dupGroups(stages.filter((st) => st.date), (st) => `${st.tripId}|${st.type}|${st.date}`);
  out.stagesSameDateDiffLabel = sameDate
    .filter((g) => new Set(g.items.map((st) => normText(st.label))).size > 1)
    .map((g) => ({ key: g.key, labels: [...new Set(g.items.map((st) => st.label))].sort(), ids: g.items.map((st) => st.id).sort() }));
  out.stagesSeqDup = dupGroups(stages.filter((st) => st.seq != null), (st) => `${st.tripId}|${st.seq}`)
    .map((g) => ({ key: g.key, ids: g.items.map((st) => st.id).sort() }));

  // ── события ────────────────────────────────────────────────────────────
  const events: Array<{ periodId: string; id: string; date: string; type: string; text: string }> = [];
  baza.forEach((b) => {
    arrOf(b.rec.events).forEach((ev, i) => {
      events.push({ periodId: b.key, id: s(ev.id) || `${b.key}~${i + 1}`, date: parseLooseDate(ev.date)?.iso ?? s(ev.date).slice(0, 10), type: s(ev.type), text: s(ev.text) });
    });
  });
  out.eventsExact = dupGroups(events.filter((e) => e.date), (e) => `${e.periodId}|${e.date}|${e.type}|${normText(e.text)}`)
    .map((g) => ({ key: g.key, items: g.items.map((e) => ({ id: e.id, text: e.text })) }));
  out.counts.eventsTotal = events.length;

  // ── справочники ────────────────────────────────────────────────────────
  const dirGroup = (branch: string, list: Array<{ id: string; value: string; extra?: Record<string, unknown> }>): Array<Record<string, unknown>> =>
    twinGroups(list.map((x) => ({ key: x.id, value: x.value }))).map((g) => ({
      branch, skeleton: g.skeleton, kind: g.kind, variants: g.variants,
      ids: list.filter((x) => g.variants.includes(x.value)).map((x) => x.id).sort(),
    }));

  const tractors = entriesOf(fullReads.get('tractors')?.val);
  out.dirsGroups.push(...dirGroup('tractors', tractors.map(({ key, rec }) => ({ id: key, value: s(rec.carNumber) || (letterMix(key).kind !== 'none' ? key : '') })).filter((x) => x.value)));
  const trailers = entriesOf(fullReads.get('trailers')?.val);
  out.dirsGroups.push(...dirGroup('trailers', trailers.map(({ key, rec }) => ({ id: key, value: s(rec.trailerNumber) || key })).filter((x) => x.value)));
  const couplings = entriesOf(fullReads.get('couplings')?.val);
  out.dirsGroups.push(...dirGroup('couplings', couplings.map(({ key, rec }) => ({ id: key, value: s(rec.carNumber) })).filter((x) => x.value)));
  const vf = entriesOf(fullReads.get('vehicleFleet')?.val);
  out.dirsGroups.push(...dirGroup('vehicleFleet', vf.map(({ key, rec }) => ({ id: key, value: s((rec as any).carNumber) || key })).filter((x) => x.value && letterMix(x.value).kind !== 'none')));
  const fc = entriesOf(fullReads.get('ferryCouples')?.val);
  out.dirsGroups.push(...dirGroup('ferryCouples', fc.map(({ key, rec }) => ({ id: key, value: s(rec.stateNumber) })).filter((x) => x.value)));
  const vsKeys = Object.keys(objOf(fullReads.get('vehicle_statuses')?.val));
  out.dirsGroups.push(...dirGroup('vehicle_statuses', vsKeys.map((k) => ({ id: k, value: k }))));

  // водители: дубли по нормализованному имени и по правам
  const drivers = entriesOf(fullReads.get('drivers')?.val);
  const drNames = dupGroups(drivers.filter(({ rec }) => s(rec.name) || s(rec.lastNameRu)), ({ key, rec }) => personKeyRu(s(rec.name) || `${s(rec.lastNameRu)} ${s(rec.firstNameRu)}`));
  drNames.forEach((g) => out.dirsGroups.push({ branch: 'drivers', skeleton: `имя:${g.key}`, kind: 'format', variants: g.items.map((x) => s(x.rec.name) || `${s(x.rec.lastNameRu)} ${s(x.rec.firstNameRu)}`), ids: g.items.map((x) => x.key) }));
  const drLic = dupGroups(drivers.filter(({ rec }) => normText(rec.license) || normText(rec.licenseNumber)), ({ rec }) => normText(rec.license) || normText(rec.licenseNumber));
  drLic.forEach((g) => out.dirsGroups.push({ branch: 'drivers', skeleton: `права:${g.key}`, kind: 'format', variants: [], ids: g.items.map((x) => x.key) }));

  // ── «близнецы» между ветками (одна машина в разных ветках) ──────────────
  const collect = (branch: string, list: Array<{ id: string; plate: string }>) => list.map((x) => ({ ...x, branch }));
  const allPlates = [
    ...collect('trips_dashboard', trips.map(({ key, rec }) => ({ id: s(rec.id) || key, plate: s(rec.carNumber) }))),
    ...collect('baza', baza.map((b) => ({ id: b.id, plate: s(b.rec.carNumber) }))),
    ...collect('couplings', couplings.map(({ key, rec }) => ({ id: key, plate: s(rec.carNumber) }))),
    ...collect('tractors', tractors.map(({ key, rec }) => ({ id: key, plate: s(rec.carNumber) || key }))),
    ...collect('ferryCouples', fc.map(({ key, rec }) => ({ id: key, plate: s(rec.stateNumber) }))),
  ].filter((x) => foldPlate(x.plate));
  const bySkel = new Map<string, Map<string, Array<{ id: string; branch: string }>>>();
  allPlates.forEach(({ id, plate, branch }) => {
    const sk = foldPlate(plate);
    const m = bySkel.get(sk) ?? new Map();
    const arr = m.get(plate) ?? [];
    arr.push({ id, branch });
    m.set(plate, arr);
    bySkel.set(sk, m);
  });
  [...bySkel.entries()].forEach(([sk, m]) => {
    if (m.size < 2) return;
    const variants = [...m.entries()].map(([value, refs]) => ({ value, refs })).sort((a, b) => a.value.localeCompare(b.value));
    const scriptTwin = variants.some((v, i) => variants.slice(i + 1).some((w) => letterMix(v.value).kind !== letterMix(w.value).kind));
    const branchesInvolved = [...new Set(variants.flatMap((v) => v.refs.map((r) => r.branch)))].sort();
    if (branchesInvolved.length < 2 && !scriptTwin) return; // внутри одной ветки уже показано в dirsGroups
    out.crossBranchTwinGroups.push({ skeleton: sk, kind: scriptTwin ? 'script' : 'format', variants: variants.map((v) => v.value), branches: branchesInvolved, refs: variants.flatMap((v) => v.refs).sort((a, b) => (a.branch + a.id).localeCompare(b.branch + b.id)).slice(0, 12) });
  });
  out.crossBranchTwinGroups.sort((a, b) => s(a.skeleton).localeCompare(s(b.skeleton)));

  // ── users / users_list ─────────────────────────────────────────────────
  const us = objOf(fullReads.get('users')?.val);
  const ul = objOf(fullReads.get('users_list')?.val);
  const usK = Object.keys(us).sort();
  const ulK = Object.keys(ul).sort();
  out.usersDelta = {
    usersOnly: usK.filter((k) => !(k in ul)),
    usersListOnly: ulK.filter((k) => !(k in us)),
    both: usK.filter((k) => k in ul),
  };

  // ── knownDistancesList ─────────────────────────────────────────────────
  const kd = entriesOf(fullReads.get('knownDistancesList')?.val);
  const kdList = kd.map(({ key, rec }) => ({ key, from: normCityName(rec.from), to: normCityName(rec.to), fromRaw: s(rec.from), toRaw: s(rec.to), km: rec.distance }));
  out.distancesDup = dupGroups(kdList.filter((x) => x.from && x.to), (x) => `${x.from}>${x.to}`)
    .map((g) => ({ key: g.key, ids: g.items.map((x) => x.key).sort(), km: [...new Set(g.items.map((x) => x.km))] }));

  // ── global_history exact-дубли ─────────────────────────────────────────
  const gh = entriesOf(fullReads.get('global_history')?.val);
  out.historyDup = dupGroups(gh, ({ rec }) => `${s(rec.date)}|${foldPlate(rec.carNumber)}|${s(rec.field)}|${s(rec.new)}|${s(rec.user)}`)
    .map((g) => ({ key: g.key, ids: g.items.map((x) => x.key).sort() }));

  out.counts = {
    ...out.counts,
    tripsExactGroups: out.tripsExact.length,
    tripsExactRecords: out.tripsExact.reduce((n, g) => n + g.items.length, 0),
    tripsNearPairs: out.tripsNear.length,
    tripsHidden: out.tripsHidden.length,
    bazaExactGroups: out.bazaExact.length,
    bazaNearPairs: out.bazaNear.length,
    stagesExactGroups: out.stagesExact.length,
    stagesSameDateDiffLabelGroups: out.stagesSameDateDiffLabel.length,
    stagesSeqDupGroups: out.stagesSeqDup.length,
    eventsExactGroups: out.eventsExact.length,
    dirGroups: out.dirsGroups.length,
    crossBranchTwinGroups: out.crossBranchTwinGroups.length,
    distancesDupGroups: out.distancesDup.length,
    historyDupGroups: out.historyDup.length,
  };
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Секция MALFORMED
// ─────────────────────────────────────────────────────────────────────────────

interface Finding { label: string; count: number; examples: Array<Record<string, unknown>>; note?: string }

const F = (label: string, count: number, examples: Array<Record<string, unknown>>, note?: string): Finding => ({ label, count, examples, note });

function buildMalformed(): Record<string, unknown> {
  const todayDay = NOW.day;
  const mal: Record<string, unknown> = {};

  // ── 1. Номера машин: проблемы ввода и близнецы ──────────────────────────
  interface PlateRow { branch: string; id: string; field: string; value: string }
  const plateRows: PlateRow[] = [];
  const addPlate = (branch: string, id: string, field: string, v: unknown) => { if (s(v).trim()) plateRows.push({ branch, id, field, value: s(v) }); };

  entriesOf(fullReads.get('trips_dashboard')?.val).forEach(({ key, rec }) => addPlate('trips_dashboard', s(rec.id) || key, 'carNumber', rec.carNumber));
  entriesOf(fullReads.get('baza')?.val).forEach(({ key, rec }) => addPlate('baza', s(rec.id) || key, 'carNumber', rec.carNumber));
  entriesOf(fullReads.get('baza_cars')?.val).forEach(({ key, rec }) => addPlate('baza_cars', key, 'carNumber', rec.carNumber));
  entriesOf(fullReads.get('archive')?.val).forEach(({ key, rec }) => addPlate('archive', key, 'carNumber', rec.carNumber));
  entriesOf(fullReads.get('couplings')?.val).forEach(({ key, rec }) => addPlate('couplings', key, 'carNumber', rec.carNumber));
  entriesOf(fullReads.get('tractors')?.val).forEach(({ key, rec }) => addPlate('tractors', key, 'carNumber', rec.carNumber));
  entriesOf(fullReads.get('ferryCouples')?.val).forEach(({ key, rec }) => addPlate('ferryCouples', key, 'stateNumber', rec.stateNumber));
  entriesOf(fullReads.get('trailers')?.val).forEach(({ key, rec }) => addPlate('trailers', key, 'trailerNumber', rec.trailerNumber));
  entriesOf(fullReads.get('salaryHistory')?.val).forEach(({ key, rec }) => addPlate('salaryHistory', key, 'car', rec.car));
  entriesOf(fullReads.get('vehicle_statuses')?.val).forEach(({ key }) => addPlate('vehicle_statuses', key, 'key', key));

  const byIssue: Record<string, PlateRow[]> = {};
  plateRows.forEach((r) => {
    plateInfo(r.value).issues.forEach((iss) => { (byIssue[iss] ||= []).push(r); });
  });
  const PLATE_ISSUE_NOTES: Record<string, string> = {
    'latin-only-suspect': 'ПОМЕТКА, не дефект: латинское написание — норма; важно в паре с кириллическим двойником',
    'mixed-script': 'в одном номере буквы обоих алфавитов',
    'numbered-prefix': 'ведущий «N) » — нумерация из ввода, в номер не входит',
    'digits-only': 'в номере нет букв вообще',
    'edge-space': 'краевые пробелы',
    'double-space': 'двойные пробелы',
    'weird-chars': 'необычные символы',
    'too-short': 'короче 4 значимых символов',
    'too-long': 'длиннее 24 значимых символов',
  };
  const plateFindings: Finding[] = Object.entries(byIssue)
    .map(([iss, rows]) => F(`plate:${iss}`, rows.length, rows.slice(0, LIMIT).map((r) => ({ branch: r.branch, id: r.id, value: r.value })), PLATE_ISSUE_NOTES[iss]))
    .sort((a, b) => a.label.localeCompare(b.label));
  const twins = twinGroups(plateRows.map((r) => ({ key: `${r.branch}/${r.id}`, value: r.value })));
  mal.plates = {
    totalValues: plateRows.length,
    issues: plateFindings,
    twinGroups: twins.slice(0, LIMIT * 2).map((g) => ({ skeleton: g.skeleton, kind: g.kind, variants: g.variants })),
    twinGroupsTotal: twins.length,
    scriptTwinGroups: twins.filter((g) => g.kind === 'script').length,
  };

  // ── 2. Пустые обязательные поля ────────────────────────────────────────
  const empties: Finding[] = [];
  const trips = entriesOf(fullReads.get('trips_dashboard')?.val);
  empties.push(F('trip.без carNumber', trips.filter(({ rec }) => !s(rec.carNumber).trim()).length, trips.filter(({ rec }) => !s(rec.carNumber).trim()).slice(0, LIMIT).map(({ key }) => ({ id: key }))));
  empties.push(F('trip.без dateStart', trips.filter(({ rec }) => !s(rec.dateStart).trim()).length, trips.filter(({ rec }) => !s(rec.dateStart).trim()).slice(0, LIMIT).map(({ key, rec }) => ({ id: key, carNumber: s(rec.carNumber) }))));
  empties.push(F('trip.без направления (route не пуст)', trips.filter(({ rec }) => !s(rec.direction).trim() && arrOf(rec.legs).length > 0).length, trips.filter(({ rec }) => !s(rec.direction).trim() && arrOf(rec.legs).length > 0).slice(0, LIMIT).map(({ key, rec }) => ({ id: s(rec.id) || key, carNumber: s(rec.carNumber), start: s(rec.dateStart), legs: arrOf(rec.legs).length }))));
  const baza = entriesOf(fullReads.get('baza')?.val);
  empties.push(F('baza.без dateArrival', baza.filter(({ rec }) => !s(rec.dateArrival).trim()).length, baza.filter(({ rec }) => !s(rec.dateArrival).trim()).slice(0, LIMIT).map(({ key, rec }) => ({ id: s(rec.id) || key, carNumber: s(rec.carNumber), status: s(rec.status) }))));
  empties.push(F('baza.без carNumber', baza.filter(({ rec }) => !s(rec.carNumber).trim()).length, baza.filter(({ rec }) => !s(rec.carNumber).trim()).slice(0, LIMIT).map(({ key }) => ({ id: key }))));
  // этапы
  const tt = objOf(fullReads.get('tripTimeline')?.val);
  const stageRows: Array<{ tripId: string; id: string; rec: Record<string, unknown> }> = [];
  Object.entries(objOf(tt.tripStages)).forEach(([tripId, raw]) => arrOf(raw).forEach((st, i) => stageRows.push({ tripId, id: s(st.id) || `${tripId}~${i + 1}`, rec: st })));
  empties.push(F('stage.без type', stageRows.filter(({ rec }) => !s(rec.type).trim()).length, stageRows.filter(({ rec }) => !s(rec.type).trim()).slice(0, LIMIT).map(({ tripId, id }) => ({ tripId, id }))));
  empties.push(F('stage.без label', stageRows.filter(({ rec }) => !s(rec.label).trim()).length, stageRows.filter(({ rec }) => !s(rec.label).trim()).slice(0, LIMIT).map(({ tripId, id }) => ({ tripId, id }))));
  empties.push(F('stage.без даты (planned и actual)', stageRows.filter(({ rec }) => !s(rec.plannedDate).trim() && !s(rec.actualDate).trim()).length, stageRows.filter(({ rec }) => !s(rec.plannedDate).trim() && !s(rec.actualDate).trim()).slice(0, LIMIT).map(({ tripId, id }) => ({ tripId, id }))));
  // события
  const eventRows: Array<{ periodId: string; id: string; rec: Record<string, unknown> }> = [];
  baza.forEach(({ key, rec }) => arrOf(rec.events).forEach((ev, i) => eventRows.push({ periodId: key, id: s(ev.id) || `${key}~${i + 1}`, rec: ev })));
  empties.push(F('event.без date', eventRows.filter(({ rec }) => !s(rec.date).trim()).length, eventRows.filter(({ rec }) => !s(rec.date).trim()).slice(0, LIMIT).map(({ periodId, id }) => ({ periodId, id }))));
  empties.push(F('event.без type', eventRows.filter(({ rec }) => !s(rec.type).trim()).length, eventRows.filter(({ rec }) => !s(rec.type).trim()).slice(0, LIMIT).map(({ periodId, id }) => ({ periodId, id }))));
  empties.push(F('event.без text', eventRows.filter(({ rec }) => !s(rec.text).trim()).length, eventRows.filter(({ rec }) => !s(rec.text).trim()).slice(0, LIMIT).map(({ periodId, id }) => ({ periodId, id }))));
  // справочники
  const trailers = entriesOf(fullReads.get('trailers')?.val);
  empties.push(F('trailer.без trailerNumber', trailers.filter(({ rec }) => !s(rec.trailerNumber).trim()).length, trailers.filter(({ rec }) => !s(rec.trailerNumber).trim()).slice(0, LIMIT).map(({ key, rec }) => ({ id: key, brand: s(rec.trailerBrand) }))));
  const tractors = entriesOf(fullReads.get('tractors')?.val);
  empties.push(F('tractor.без carNumber', tractors.filter(({ rec }) => !s(rec.carNumber).trim()).length, tractors.filter(({ rec }) => !s(rec.carNumber).trim()).slice(0, LIMIT).map(({ key, rec }) => ({ id: key, fields: Object.keys(rec).length }))));
  const drivers = entriesOf(fullReads.get('drivers')?.val);
  empties.push(F('driver.без имени', drivers.filter(({ rec }) => !s(rec.name).trim() && !s(rec.lastNameRu).trim() && !s(rec.lastNameLat).trim()).length, drivers.filter(({ rec }) => !s(rec.name).trim() && !s(rec.lastNameRu).trim() && !s(rec.lastNameLat).trim()).slice(0, LIMIT).map(({ key }) => ({ id: key }))));
  empties.push(F('driver.без прав (license)', drivers.filter(({ rec }) => !s(rec.license).trim() && !s(rec.licenseNumber).trim()).length, drivers.filter(({ rec }) => !s(rec.license).trim() && !s(rec.licenseNumber).trim()).slice(0, LIMIT).map(({ key }) => ({ id: key }))));
  const couplings = entriesOf(fullReads.get('couplings')?.val);
  empties.push(F('coupling.без carNumber', couplings.filter(({ rec }) => !s(rec.carNumber).trim()).length, couplings.filter(({ rec }) => !s(rec.carNumber).trim()).slice(0, LIMIT).map(({ key }) => ({ id: key }))));
  const ul = entriesOf(fullReads.get('users_list')?.val);
  empties.push(F('users_list.без имени', ul.filter(({ rec }) => !s(rec.name).trim() && !s(rec.displayName).trim()).length, ul.filter(({ rec }) => !s(rec.name).trim() && !s(rec.displayName).trim()).slice(0, LIMIT).map(({ key }) => ({ id: key }))));
  mal.empties = empties.sort((a, b) => a.label.localeCompare(b.label));

  // ── 3. Даты ────────────────────────────────────────────────────────────
  const dateFind: Finding[] = [];
  const pushDates = (label: string, rows: Array<{ id: string; issues: Array<{ field: string; value: unknown; kind: string; note?: string }>; extra?: Record<string, unknown> }>) => {
    const all = rows.flatMap((r) => r.issues.map((i) => ({ id: r.id, ...i, ...(r.extra || {}) })));
    if (all.length) dateFind.push(F(label, all.length, all.slice(0, LIMIT)));
  };
  pushDates('trip.dateStart', trips.map(({ key, rec }) => ({ id: s(rec.id) || key, issues: [...dateIssues('dateStart', rec.dateStart, { todayDay, required: true }) as Array<any>], extra: { carNumber: s(rec.carNumber) } })));
  pushDates('trip.dateEnd', trips.map(({ key, rec }) => ({ id: s(rec.id) || key, issues: [...dateIssues('dateEnd', rec.dateEnd, { todayDay })] as Array<any>, extra: { carNumber: s(rec.carNumber) } })));
  pushDates('baza.dateArrival', baza.map(({ key, rec }) => ({ id: s(rec.id) || key, issues: [...dateIssues('dateArrival', rec.dateArrival, { todayDay })] as Array<any>, extra: { carNumber: s(rec.carNumber) } })));
  pushDates('baza.dateDeparture', baza.map(({ key, rec }) => ({ id: s(rec.id) || key, issues: [...dateIssues('dateDeparture', rec.dateDeparture, { todayDay })] as Array<any>, extra: { carNumber: s(rec.carNumber) } })));
  pushDates('baza.dateRepairStart/End', baza.flatMap(({ key, rec }) => [{ id: s(rec.id) || key, issues: [...dateIssues('dateRepairStart', rec.dateRepairStart, { todayDay }), ...dateIssues('dateRepairEnd', rec.dateRepairEnd, { todayDay })] as Array<any>, extra: { carNumber: s(rec.carNumber) } }]));
  pushDates('stage.plannedDate', stageRows.map(({ tripId, id, rec }) => ({ id: `${tripId}/${id}`, issues: [...dateIssues('plannedDate', rec.plannedDate, { todayDay })] as Array<any> })));
  pushDates('stage.actualDate', stageRows.map(({ tripId, id, rec }) => ({ id: `${tripId}/${id}`, issues: [...dateIssues('actualDate', rec.actualDate, { todayDay })] as Array<any> })));
  pushDates('salaryHistory.datetime', entriesOf(fullReads.get('salaryHistory')?.val).map(({ key, rec }) => ({ id: key, issues: [...dateIssues('datetime', rec.datetime, { todayDay })] as Array<any>, extra: { car: s(rec.car) } })));
  // пары начало>конец
  const pairFind: Array<Record<string, unknown>> = [];
  trips.forEach(({ key, rec }) => { if (endBeforeStart(rec.dateStart, rec.dateEnd)) pairFind.push({ branch: 'trips_dashboard', id: s(rec.id) || key, start: s(rec.dateStart), end: s(rec.dateEnd), carNumber: s(rec.carNumber) }); });
  baza.forEach(({ key, rec }) => {
    if (endBeforeStart(rec.dateArrival, rec.dateDeparture)) pairFind.push({ branch: 'baza', id: s(rec.id) || key, start: s(rec.dateArrival), end: s(rec.dateDeparture), carNumber: s(rec.carNumber), field: 'period' });
    if (endBeforeStart(rec.dateRepairStart, rec.dateRepairEnd)) pairFind.push({ branch: 'baza', id: s(rec.id) || key, start: s(rec.dateRepairStart), end: s(rec.dateRepairEnd), carNumber: s(rec.carNumber), field: 'repair' });
  });
  stageRows.forEach(({ tripId, id, rec }) => { if (endBeforeStart(rec.plannedDate, rec.actualDate)) pairFind.push({ branch: 'tripTimeline/tripStages', id: `${tripId}/${id}`, start: s(rec.plannedDate), end: s(rec.actualDate), field: 'planned>actual' }); });
  const todayIsoForDup = dayToIso(todayDay);
  mal.dates = {
    issues: dateFind.sort((a, b) => a.label.localeCompare(b.label)),
    endBeforeStart: pairFind.sort((a, b) => (s(a.branch) + s(a.id)).localeCompare(s(b.branch) + s(b.id))),
    today: todayIsoForDup,
  };

  // ── 4. Суммы и числа ───────────────────────────────────────────────────
  const numFind: Array<Record<string, unknown>> = [];
  trips.forEach(({ key, rec }) => {
    const id = s(rec.id) || key;
    const car = s(rec.carNumber);
    const issues = [
      ...numIssues('days', rec.days, { max: 365 }),
      ...numIssues('totalKm', rec.totalKm, { max: 60000 }),
      ...numIssues('factKm', rec.factKm, { max: 60000 }),
      ...numIssues('totalFreight', rec.totalFreight, { max: 1000000 }),
      ...numIssues('totalExpenses', rec.totalExpenses, { max: 1000000 }),
      ...numIssues('extraExpense', rec.extraExpense, { max: 1000000 }),
      ...numIssues('ferryCost', rec.ferryCost, { max: 1000000 }),
      ...numIssues('profit', rec.profit, { allowNegative: true, max: 2000000 }),
    ];
    arrOf(rec.legs).forEach((leg, i) => {
      issues.push(...numIssues(`legs[${i}].km`, leg.km, { max: 30000 }));
      issues.push(...numIssues(`legs[${i}].rate`, leg.rate, { max: 1000000 }));
      issues.push(...numIssues(`legs[${i}].ferry`, leg.ferry, { max: 1000000 }));
    });
    if (issues.length) numFind.push({ branch: 'trips_dashboard', id, carNumber: car, issues });
  });
  entriesOf(fullReads.get('salaryHistory')?.val).forEach(({ key, rec }) => {
    const issues = [
      ...numIssues('km', rec.km, { max: 60000 }),
      ...numIssues('kmMoney', rec.kmMoney, { max: 1000000 }),
      ...numIssues('idleMoney', rec.idleMoney, { max: 1000000 }),
      ...numIssues('bonus', rec.bonus, { max: 1000000 }),
      ...numIssues('daysMoney', rec.daysMoney, { max: 50000 }),
      ...numIssues('totalSalary', rec.totalSalary, { max: 1000000 }),
      ...numIssues('rate', rec.rate, { max: 5 }),
    ];
    if (issues.length) numFind.push({ branch: 'salaryHistory', id: key, car: s(rec.car), issues });
  });
  entriesOf(fullReads.get('calculationsHistory')?.val).forEach(({ key, rec }) => {
    const issues = [
      ...numIssues('km', rec.km, { max: 60000 }),
      ...numIssues('freight', rec.freight, { max: 1000000 }),
      ...numIssues('expenses', rec.expenses, { max: 1000000 }),
      ...numIssues('days', rec.days, { max: 365 }),
    ];
    if (issues.length) numFind.push({ branch: 'calculationsHistory', id: key, issues });
  });
  mal.amounts = { findings: numFind.sort((a, b) => (s(a.branch) + s(a.id)).localeCompare(s(b.branch) + s(b.id))).slice(0, LIMIT * 3), totalRecords: numFind.length };

  // ── 5. Пробелы/регистр в текстах ───────────────────────────────────────
  const noise: Array<Record<string, unknown>> = [];
  const pushNoise = (branch: string, id: string, field: string, v: unknown) => { if (s(v).trim() && hasSpaceNoise(v)) noise.push({ branch, id, field, value: s(v).slice(0, 60) }); };
  trips.forEach(({ key, rec }) => { pushNoise('trips_dashboard', s(rec.id) || key, 'carNumber', rec.carNumber); pushNoise('trips_dashboard', s(rec.id) || key, 'direction', rec.direction); pushNoise('trips_dashboard', s(rec.id) || key, 'tripNote', rec.tripNote); });
  baza.forEach(({ key, rec }) => { pushNoise('baza', s(rec.id) || key, 'carNumber', rec.carNumber); pushNoise('baza', s(rec.id) || key, 'comment', rec.comment); });
  tractors.forEach(({ key, rec }) => { pushNoise('tractors', key, 'carNumber', rec.carNumber); pushNoise('tractors', key, 'brand', rec.brand); });
  trailers.forEach(({ key, rec }) => { pushNoise('trailers', key, 'trailerNumber', rec.trailerNumber); pushNoise('trailers', key, 'trailerBrand', rec.trailerBrand); });
  drivers.forEach(({ key, rec }) => pushNoise('drivers', key, 'name', rec.name));
  const brandVariants = (list: Array<{ key: string; rec: Record<string, unknown> }>, field: string) => {
    const m = new Map<string, Set<string>>();
    list.forEach(({ rec }) => { const v = s(rec[field]); if (v.trim()) { const k = normText(v).replace(/[^a-zа-я0-9]/g, ''); const set = m.get(k) ?? new Set(); set.add(v.trim()); m.set(k, set); } });
    return [...m.entries()].filter(([, set]) => set.size > 1).map(([k, set]) => ({ field, norm: k, variants: [...set].sort() })).sort((a, b) => a.norm.localeCompare(b.norm));
  };
  const trailerBrandVariants = brandVariants(trailers, 'trailerBrand');
  const tractorBrandVariants = brandVariants(tractors, 'brand');
  mal.textNoise = { spaceNoise: noise.sort((a, b) => (s(a.branch) + s(a.id) + s(a.field)).localeCompare(s(b.branch) + s(b.id) + s(b.field))).slice(0, LIMIT * 3), spaceNoiseTotal: noise.length, brandVariants: [...trailerBrandVariants, ...tractorBrandVariants].slice(0, LIMIT * 2), brandVariantsTotal: trailerBrandVariants.length + tractorBrandVariants.length };
  return mal;
}

// ─────────────────────────────────────────────────────────────────────────────
// Секция CONSISTENCY
// ─────────────────────────────────────────────────────────────────────────────

function buildConsistency(): Record<string, unknown> {
  const todayDay = NOW.day;
  const cons: Record<string, unknown> = {};
  const trips = entriesOf(fullReads.get('trips_dashboard')?.val).map(({ key, rec }) => ({
    id: s(rec.id) || key, rec, carNumber: s(rec.carNumber), carKey: foldPlate(String(rec.carNumber ?? '').split('/')[0]),
    start: parseLooseDate(rec.dateStart)?.day ?? null, end: parseLooseDate(rec.dateEnd)?.day ?? null,
    archived: rec.isArchived === true, direction: s(rec.direction),
  }));
  const baza = entriesOf(fullReads.get('baza')?.val).map(({ key, rec }) => ({
    id: s(rec.id) || key, rec, carNumber: s(rec.carNumber), carKey: foldPlate(String(rec.carNumber ?? '').split('/')[0]),
    plateFull: foldPlate(String(rec.carNumber ?? '')),
    start: parseLooseDate(rec.dateArrival)?.day ?? null, end: parseLooseDate(rec.dateDeparture)?.day ?? null,
    status: s(rec.status) || 'base', archived: rec.isArchived === true || s(rec.status) === 'archive',
  }));
  const archive = entriesOf(fullReads.get('archive')?.val);

  // 1) архивная запись с признаками живого периода: номер архива = номеру открытого периода baza
  const openBaza = baza.filter((b) => b.end == null && !b.archived);
  const openByPlate = new Map<string, typeof openBaza>();
  openBaza.forEach((b) => { if (b.plateFull) openByPlate.set(b.plateFull, [...(openByPlate.get(b.plateFull) || []), b]); });
  const archiveRows = archive
    .map(({ key, rec }) => ({
      id: key, plate: s(rec.carNumber), plateFull: foldPlate(String(rec.carNumber ?? '')),
      departure: s(rec.dateDeparture), arrival: s(rec.dateArrival),
      arrDay: parseLooseDate(rec.dateArrival)?.day ?? null, depDay: parseLooseDate(rec.dateDeparture)?.day ?? null,
    }));
  const archiveLoose = archiveRows.filter((a) => a.plateFull && openByPlate.has(a.plateFull));
  // Строгий конфликт: открытый период начался ДО окончания архивного рейса —
  // машина одновременно «в архиве-рейсе» и «на базе». Если открытый период
  // начался ПОСЛЕ — это нормальная смена цикла (архив — история).
  const archiveStrict = archiveLoose
    .map((a) => ({ ...a, openPeriods: (openByPlate.get(a.plateFull) || []).filter((b) => b.id !== a.id) }))
    .map((a) => ({ ...a, overlapping: a.openPeriods.filter((b) => b.start != null && a.depDay != null && b.start <= a.depDay) }))
    .filter((a) => a.overlapping.length > 0);
  cons.archiveWithLivePeriod = {
    strictCount: archiveStrict.length,
    looseCount: archiveLoose.length,
    note: 'строго: открытый простой пересекается с архивным рейсом той же машины; мягко: у архивной машины есть текущий открытый простой (часто нормальная смена цикла)',
    examples: archiveStrict.slice(0, LIMIT).map((a) => ({ id: a.id, plate: a.plate, arrival: a.arrival, departure: a.departure, openPeriods: a.overlapping.map((b) => ({ id: b.id, start: b.start != null ? dayToIso(b.start) : '' })) })),
    looseExamples: archiveLoose.slice(0, LIMIT).map((a) => ({ id: a.id, plate: a.plate, departure: a.departure })),
  };
  const archiveOpen = archive.filter(({ rec }) => !s(rec.dateDeparture).trim());
  cons.archiveWithoutDeparture = { count: archiveOpen.length, examples: archiveOpen.slice(0, LIMIT).map(({ key, rec }) => ({ id: key, carNumber: s(rec.carNumber), arrival: s(rec.dateArrival) })) };
  const bazaArchOpen = baza.filter((b) => b.archived && b.end == null);
  cons.bazaArchiveOpen = { count: bazaArchOpen.length, examples: bazaArchOpen.slice(0, LIMIT).map((b) => ({ id: b.id, carNumber: b.carNumber, arrival: b.start != null ? dayToIso(b.start) : '' })) };

  // 2) машина в рейсе и в простое одновременно (пересечение интервалов одной машины)
  const byCar = new Map<string, Array<{ kind: 'trip' | 'base'; id: string; carNumber: string; startDay: number | null; endDay: number | null; archived: boolean }>>();
  const addIv = (carKey: string, iv: { kind: 'trip' | 'base'; id: string; carNumber: string; startDay: number | null; endDay: number | null; archived: boolean }) => {
    if (!carKey) return;
    byCar.set(carKey, [...(byCar.get(carKey) || []), iv]);
  };
  trips.forEach((t) => addIv(t.carKey, { kind: 'trip', id: t.id, carNumber: t.carNumber, startDay: t.start, endDay: t.end, archived: t.archived }));
  baza.forEach((b) => addIv(b.carKey, { kind: 'base', id: b.id, carNumber: b.carNumber, startDay: b.start, endDay: b.end, archived: b.archived }));
  let pairsChecked = 0;
  const conflicts: Array<Record<string, unknown>> = [];
  const styks: Array<Record<string, unknown>> = [];
  byCar.forEach((list) => {
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i], b = list[j];
        if (a.id === b.id && a.kind === b.kind) continue;
        pairsChecked += 1;
        if (a.startDay == null || b.startDay == null) continue;
        const e = a.endDay == null ? Number.POSITIVE_INFINITY : a.endDay;
        const e0 = b.endDay == null ? Number.POSITIVE_INFINITY : b.endDay;
        if (!(a.startDay <= e0 && e >= b.startDay)) continue;
        const lo = Math.max(a.startDay, b.startDay);
        const hi = Math.min(e, e0);
        const days = Number.isFinite(hi) ? hi - lo + 1 : null;
        const row = {
          carNumber: a.carNumber || b.carNumber, kind: `${a.kind}-${b.kind}`,
          a: { id: a.id, span: `${a.startDay != null ? dayToIso(a.startDay) : '??'}..${a.endDay != null ? dayToIso(a.endDay) : '∞'}`, archived: a.archived },
          b: { id: b.id, span: `${b.startDay != null ? dayToIso(b.startDay) : '??'}..${b.endDay != null ? dayToIso(b.endDay) : '∞'}`, archived: b.archived },
          overlapDays: days,
          live: !a.archived && !b.archived,
        };
        if (days === 1) styks.push(row); else conflicts.push(row);
      }
    }
  });
  const confLive = conflicts.filter((c) => c.live);
  cons.simultaneous = {
    pairsChecked,
    conflictsTotal: conflicts.length,
    conflictsLive: confLive.length,
    styksTotal: styks.length,
    conflictsExamples: conflicts.sort((x, y) => (Number(y.overlapDays ?? 1e9) - Number(x.overlapDays ?? 1e9)) || s(x.carNumber).localeCompare(s(y.carNumber))).slice(0, LIMIT * 2),
    kindSplit: conflicts.reduce((acc: Record<string, number>, c) => { acc[s(c.kind)] = (acc[s(c.kind)] || 0) + 1; return acc; }, {}),
  };
  // специально: машина и в рейсе, и в открытом простое базы (один carKey)
  const openKeys = new Map<string, typeof openBaza>();
  openBaza.forEach((b) => { if (b.carKey) openKeys.set(b.carKey, [...(openKeys.get(b.carKey) || []), b]); });
  const tripSpan = (t: typeof trips[number]) => `${t.start != null ? dayToIso(t.start) : '??'}..${t.end != null ? dayToIso(t.end) : '∞'}`;
  const carCandidates = trips.filter((t) => !t.archived && t.carKey && openKeys.has(t.carKey) && t.start != null && (t.end == null || t.end >= todayDay));
  const startedNow = carCandidates.filter((t) => t.start! <= todayDay);
  const startsSoon = carCandidates.filter((t) => t.start! > todayDay);
  cons.tripAndBaseOpen = {
    count: startedNow.length,
    startsSoonCount: startsSoon.length,
    note: 'рейс (не архив, ещё не закончился) у машины с открытым периодом базы; startedNow — рейс уже начался, startsSoon — только предстоит (диспетчер не закрыл период базы)',
    examples: startedNow.slice(0, LIMIT).map((t) => ({ tripId: t.id, carNumber: t.carNumber, tripSpan: tripSpan(t), basePeriods: (openKeys.get(t.carKey) || []).map((b) => ({ id: b.id, start: b.start != null ? dayToIso(b.start) : '' })) })),
    startsSoonExamples: startsSoon.slice(0, LIMIT).map((t) => ({ tripId: t.id, carNumber: t.carNumber, tripSpan: tripSpan(t), basePeriods: (openKeys.get(t.carKey) || []).map((b) => ({ id: b.id, start: b.start != null ? dayToIso(b.start) : '' })) })),
  };

  // 3) машина без выезда больше N дней
  const staleOpen = openBaza
    .map((b) => ({ id: b.id, carNumber: b.carNumber, arrival: b.start != null ? dayToIso(b.start) : '', ageDays: b.start != null ? todayDay - b.start : null, status: b.status }))
    .filter((r) => r.ageDays != null && r.ageDays > STALE_DAYS)
    .sort((a, b) => (b.ageDays ?? 0) - (a.ageDays ?? 0));
  cons.staleOpenBase = { thresholdDays: STALE_DAYS, count: staleOpen.length, examples: staleOpen.slice(0, LIMIT) };
  const staleTrips = trips
    .filter((t) => !t.archived && t.end == null && t.start != null && todayDay - t.start > STALE_DAYS * 2)
    .map((t) => ({ tripId: t.id, carNumber: t.carNumber, start: dayToIso(t.start!), ageDays: todayDay - t.start! }))
    .sort((a, b) => b.ageDays - a.ageDays);
  cons.staleOpenTrips = { thresholdDays: STALE_DAYS * 2, count: staleTrips.length, examples: staleTrips.slice(0, LIMIT) };

  // 4) записи без владельца/источника
  const noDriverBaza = baza.filter((b) => !s(b.rec.driverId).trim() && !s(b.rec.driverName).trim() && !s(b.rec.driverNameRu).trim() && !s(b.rec.driverRaw).trim());
  const noSource = {
    bazaWithoutDriver: { count: noDriverBaza.length, examples: noDriverBaza.slice(0, LIMIT).map((b) => ({ id: b.id, carNumber: b.carNumber, comment: s(b.rec.comment).slice(0, 40) })) },
    tripsWithoutCreatedBy: { count: trips.filter((t) => !t.rec.createdBy && !t.rec.createdAt).length },
    bazaWithoutHistory: { count: baza.filter((b) => Object.keys(objOf(b.rec.history)).length === 0).length, examples: baza.filter((b) => Object.keys(objOf(b.rec.history)).length === 0).slice(0, LIMIT).map((b) => ({ id: b.id, carNumber: b.carNumber })) },
  };
  cons.noSource = noSource;

  // 5) направление vs маршрут
  const dirEmptyWithLegs = trips.filter((t) => !t.direction.trim() && arrOf(t.rec.legs).length > 0);
  const dirNumeric = trips.filter((t) => /^\d+$/.test(t.direction.trim()));
  const dirCodeLike = trips.filter((t) => /[A-Z]{2,}/.test(t.direction) && /[-–_/]/.test(t.direction));
  cons.direction = {
    emptyWithLegs: { count: dirEmptyWithLegs.length, examples: dirEmptyWithLegs.slice(0, LIMIT).map((t) => ({ id: t.id, carNumber: t.carNumber, start: t.start != null ? dayToIso(t.start) : '', legs: arrOf(t.rec.legs).length })) },
    numericJunk: { count: dirNumeric.length, examples: dirNumeric.slice(0, LIMIT).map((t) => ({ id: t.id, direction: t.direction })) },
    codeLike: { count: dirCodeLike.length, examples: dirCodeLike.slice(0, LIMIT).map((t) => ({ id: t.id, direction: t.direction })) },
  };

  // 6) машина не в справочнике
  const dirCars = new Set<string>();
  const addDir = (branch: string) => {
    const recs = entriesOf(fullReads.get(branch)?.val);
    recs.forEach(({ key, rec }) => {
      const k = foldPlate(String(rec.carNumber ?? '').split('/')[0]) || foldPlate(key);
      if (k) dirCars.add(k);
    });
  };
  ['couplings', 'tractors', 'vehicleFleet', 'vehicle_statuses'].forEach(addDir);
  entriesOf(fullReads.get('ferryCouples')?.val).forEach(({ key, rec }) => { const k = foldPlate(String(rec.stateNumber ?? '').replace(/^\s*\d+\s*\)\s*/, '').split('/')[0]) || foldPlate(key); if (k) dirCars.add(k); });
  Object.keys(objOf(fullReads.get('knownFleetCars')?.val)).forEach((k) => { const f = foldPlate(k); if (f) dirCars.add(f); });
  const activeTrips = trips.filter((t) => !t.archived);
  const tripsCarUnknown = activeTrips.filter((t) => t.carKey && !dirCars.has(t.carKey));
  cons.carsNotInDirectories = {
    directoriesSize: dirCars.size,
    activeTrips: { count: tripsCarUnknown.length, examples: tripsCarUnknown.slice(0, LIMIT).map((t) => ({ id: t.id, carNumber: t.carNumber, start: t.start != null ? dayToIso(t.start) : '' })) },
    openBase: { count: openBaza.filter((b) => b.carKey && !dirCars.has(b.carKey)).length, examples: openBaza.filter((b) => b.carKey && !dirCars.has(b.carKey)).slice(0, LIMIT).map((b) => ({ id: b.id, carNumber: b.carNumber })) },
  };

  // 7) ссылки на пользователей
  const userIds = new Set<string>([...Object.keys(objOf(fullReads.get('users')?.val)), ...Object.keys(objOf(fullReads.get('users_list')?.val))]);
  const unknownRefs: Array<{ where: string; id: string; userId: string }> = [];
  trips.forEach((t) => {
    ['dispatcherId', 'logistId'].forEach((f) => {
      const v = s(t.rec[f]);
      if (v && !userIds.has(v) && !/^[a-z_]+-uid-/.test(v)) unknownRefs.push({ where: `trips_dashboard.${f}`, id: t.id, userId: v });
    });
  });
  entriesOf(fullReads.get('salaryHistory')?.val).forEach(({ key, rec }) => {
    const v = s(rec.logistId);
    if (v && !userIds.has(v) && !/^[a-z_]+-uid-/.test(v)) unknownRefs.push({ where: 'salaryHistory.logistId', id: key, userId: v });
  });
  const planGuard = objOf(objOf(fullReads.get('tripTimeline')?.val).planGuard);
  Object.entries(planGuard).forEach(([pk, gv]) => {
    const hist = arrOf(objOf(gv).history);
    hist.forEach((h) => {
      const v = s(h.byId);
      if (v && !userIds.has(v) && !/^[a-z_]+-uid-/.test(v)) unknownRefs.push({ where: 'tripTimeline.planGuard.byId', id: pk, userId: v });
    });
  });
  const unknownAgg = [...new Set(unknownRefs.map((r) => r.userId))].sort().map((uid) => ({ userId: uid, refs: unknownRefs.filter((r) => r.userId === uid).length, where: [...new Set(unknownRefs.filter((r) => r.userId === uid).map((r) => r.where))].sort() }));
  cons.unknownUserRefs = { total: unknownRefs.length, distinctUsers: unknownAgg.length, users: unknownAgg.slice(0, LIMIT * 2) };

  // 8) записи без audit-следов
  // planGuard хранит ключи вида 'pd:<planId>' — сверяем с префиксом.
  const plansNoGuard = Object.keys(objOf(objOf(fullReads.get('tripTimeline')?.val).tripStages))
    .filter((pid) => !(`pd:${pid}` in planGuard) && !(pid in planGuard))
    .sort();
  cons.noAuditTrail = {
    tripStagesPlansWithoutGuard: { count: plansNoGuard.length, examples: plansNoGuard.slice(0, LIMIT) },
    bazaWithoutHistory: noSource.bazaWithoutHistory,
    tripsWithoutCreatedBy: noSource.tripsWithoutCreatedBy.count,
  };
  return cons;
}

// ─────────────────────────────────────────────────────────────────────────────
// Секция LEGACY
// ─────────────────────────────────────────────────────────────────────────────

function buildLegacy(topNames: string[], structure: { rows: StructureRow[] }): Record<string, unknown> {
  const leg: Record<string, unknown> = {};

  // 1) явный тестовый/демо-мусор
  const junk: Array<Record<string, unknown>> = [];
  const scan = (branch: string, id: string, parts: Array<unknown>, extra?: Record<string, unknown>) => {
    const hits = looksJunk(parts);
    if (hits.length) junk.push({ branch, id, markers: [...new Set(hits.map((h) => h.pattern))].sort(), extra });
  };
  entriesOf(fullReads.get('trips')?.val).forEach(({ key, rec }) => scan('trips', key, [key, rec.note, rec.direction, rec.marker]));
  entriesOf(fullReads.get('tripsdashboard')?.val).forEach(({ key, rec }) => { if (isTestPlate(rec.carNumber)) junk.push({ branch: 'tripsdashboard', id: key, markers: ['test-plate'], extra: { carNumber: s(rec.carNumber) } }); else scan('tripsdashboard', key, [key, rec.tripNote]); });
  entriesOf(fullReads.get('current_trips')?.val).forEach(({ key, rec }) => scan('current_trips', key, [key, rec.driverName]));
  entriesOf(fullReads.get('planDohod')?.val).forEach(({ key }) => scan('planDohod', key, [key]));
  entriesOf(fullReads.get('trips_dashboard')?.val).forEach(({ key, rec }) => scan('trips_dashboard', s(rec.id) || key, [s(rec.tripNote), s(rec.direction) === '412412' ? s(rec.direction) : '']));
  entriesOf(fullReads.get('baza')?.val).forEach(({ key, rec }) => scan('baza', s(rec.id) || key, [s(rec.comment)]));
  // пользователи: id и имена могут содержать probe/qa/test-маркеры
  entriesOf(fullReads.get('users_list')?.val).forEach(({ key, rec }) => scan('users_list', key, [key, s(rec.name), s(rec.displayName)]));
  entriesOf(fullReads.get('users')?.val).forEach(({ key }) => scan('users', key, [key]));
  // этапы таймлайна: id/место/причина/действие
  const ttLegacy = objOf(fullReads.get('tripTimeline')?.val);
  Object.entries(objOf(ttLegacy.tripStages)).forEach(([tripId, raw]) => arrOf(raw).forEach((st, i) => scan('tripTimeline/tripStages', s(st.id) || `${tripId}~${i + 1}`, [s(st.id), s(st.label), s(st.reason), s(st.action)])));
  // реестры directories/*: id/имя/метка
  Object.entries(objOf(fullReads.get('directories')?.val)).forEach(([sub, raw]) => {
    arrOf(raw).forEach((r, i) => scan(`directories/${sub}`, s(r.id) || s(r.dbKey) || `${sub}~${i}`, [s(r.id), s(r.name), s(r.label)]));
  });
  const agentSuggestions = entriesOf(objOf(objOf(fullReads.get('agent_audit')?.val).suggestions));
  agentSuggestions.forEach(({ key, rec }) => scan('agent_audit/suggestions', key, [s(rec.hash), s(rec.description)]));
  entriesOf(fullReads.get('knownDistancesList')?.val).forEach(({ key, rec }) => scan('knownDistancesList', key, [s(rec.from), s(rec.to)]));
  leg.junk = { count: junk.length, examples: junk.sort((a, b) => (s(a.branch) + s(a.id)).localeCompare(s(b.branch) + s(b.id))).slice(0, LIMIT * 2) };

  // 2) заглушки и пустые узлы
  const stubs: Array<Record<string, unknown>> = [];
  const vf = entriesOf(fullReads.get('vehicleFleet')?.val);
  const vfStubs = vf.filter(({ rec }) => Object.keys(rec).length <= 2 && !s((rec as any).carNumber));
  stubs.push({ branch: 'vehicleFleet', count: vfStubs.length, total: vf.length, note: 'записи-заглушки {status} (центр переехал в couplings)', examples: vfStubs.slice(0, LIMIT).map(({ key }) => ({ id: key })) });
  const tractors = entriesOf(fullReads.get('tractors')?.val);
  const trStubs = tractors.filter(({ rec }) => !s(rec.carNumber).trim() && !s(rec.brand).trim() && Object.keys(rec).length <= 6);
  stubs.push({ branch: 'tractors', count: trStubs.length, total: tractors.length, note: 'заглушки, ключ = номер с пробелами', examples: trStubs.slice(0, LIMIT).map(({ key }) => ({ id: key })) });
  const trailers = entriesOf(fullReads.get('trailers')?.val);
  const tlStubs = trailers.filter(({ rec }) => !s(rec.trailerNumber).trim());
  stubs.push({ branch: 'trailers', count: tlStubs.length, total: trailers.length, note: 'нет trailerNumber (ключ-номер + бренд)', examples: tlStubs.slice(0, LIMIT).map(({ key, rec }) => ({ id: key, brand: s(rec.trailerBrand) })) });
  const us = objOf(fullReads.get('users')?.val);
  const usProfiles = Object.entries(us).filter(([, v]) => s(objOf(v).name).trim() || s(objOf(v).role).trim());
  const usNotifyOnly = Object.entries(us).filter(([, v]) => { const r = objOf(v); return !s(r.name).trim() && !s(r.role).trim() && !!r.notificationStates; });
  if (usNotifyOnly.length) stubs.push({
    branch: 'users', count: usNotifyOnly.length, total: Object.keys(us).length,
    note: 'только notificationStates (профили/имена — в users_list; это дизайн двух сторов, а не заглушки)',
    examples: usNotifyOnly.slice(0, LIMIT).map(([id]) => ({ id })),
  });
  if (usProfiles.length === 0 && Object.keys(us).length > 0) stubs.push({ branch: 'users-профили', count: 0, total: Object.keys(us).length, note: 'ни одного профиля с именем/ролью', examples: [] });
  leg.stubs = stubs;

  const emptyNodes = structure.rows.filter((r) => (r.children ?? 0) === 0).map((r) => r.name);
  leg.emptyNodes = { count: emptyNodes.length, names: emptyNodes };

  // 3) легаси-ветки с данными (без ссылок в коде)
  const legacyRows = structure.rows
    .filter((r) => (r.verdict === 'легаси с данными' || r.verdict === 'тест/мусор') && (r.children ?? 0) > 0)
    .map((r) => ({ name: r.name, children: r.children, bytes: r.bytes, refsApp: r.refsApp, verdict: r.verdict, note: r.note }));
  leg.legacyBranches = { count: legacyRows.length, rows: legacyRows };

  // 4) старые версии веток (dozvola-семейство) — по структуре
  const fam = structure.rows.filter((r) => /^dozvols/.test(r.name)).map((r) => ({ name: r.name, children: r.children, refsApp: r.refsApp }));
  leg.dozvolFamilies = { versions: fam, note: 'несколько версий одной предметной области (V1/V2/V3/V4) с данными; версия V4 — актуальная' };

  // 5) users vs users_list (сводка для решения)
  const ul = objOf(fullReads.get('users_list')?.val);
  leg.usersDualStore = {
    users: Object.keys(us).length,
    usersList: Object.keys(ul).length,
    usersOnly: Object.keys(us).filter((k) => !(k in ul)).sort(),
    usersListOnly: Object.keys(ul).filter((k) => !(k in us)).sort(),
    note: 'два параллельных стора сотрудников: users/<id> (профили/нотификации) и users_list/<id> (права/список). Расхождение — к решению владельца.',
  };

  // 6) старые appErrors от локальной разработки
  const errs = entriesOf(fullReads.get('appErrors')?.val);
  const devErrs = errs.filter(({ rec }) => /127\.0\.0\.1|localhost/.test(s(rec.detail)) + s(rec.message));
  leg.appErrors = { total: errs.length, fromLocalDev: devErrs.length, note: 'журнал ошибок клиента; большая часть — локальная разработка (127.0.0.1)' };

  return leg;
}

// ─────────────────────────────────────────────────────────────────────────────
// Сборка отчёта
// ─────────────────────────────────────────────────────────────────────────────

interface UnitTests { checks: number; failed: number; file: string | null }

function readUnitTests(): UnitTests {
  try {
    if (existsSync(TESTS_FILE)) {
      const j = JSON.parse(readFileSync(TESTS_FILE, 'utf8'));
      if (typeof j.checks === 'number') return { checks: j.checks, failed: Number(j.failed) || 0, file: TESTS_FILE };
    }
  } catch { /* нет файла — не беда */ }
  return { checks: 0, failed: 0, file: null };
}

async function main(): Promise<number> {
  // Лог инициализации firebaseAdmin не должен пачкать stdout в --json-режиме.
  const logOriginal = console.log;
  if (JSON_ONLY) console.log = (...a: unknown[]) => console.error(...a);
  await loadAdmin();
  console.log = logOriginal;

  if (!adminDb) {
    console.error('[audit-db-quality] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT(_PATH) в .env/.env.local');
    return 2;
  }
  const takenAt = argOf('now') || new Date().toISOString();
  await readAll();

  const shallowRoot = await shallowNode('');
  let topNames: string[] = [];
  if (shallowRoot) {
    const tok = await getRestToken();
    const r = await fetch(`${DATABASE_URL}/.json?shallow=true&access_token=${encodeURIComponent(tok!)}`, { method: 'GET' });
    const j: any = await r.json();
    topNames = j && typeof j === 'object' ? Object.keys(j).sort() : [];
  }
  // дублируем имена из полного чтения (на случай недоступности shallow)
  fullReadList.forEach((n) => { if (!topNames.includes(n)) topNames.push(n); });
  topNames.sort();

  const structure = SECTIONS.includes('structure') || SECTIONS.includes('legacy')
    ? await buildStructure(topNames)
    : { rows: [] as StructureRow[], totals: { branches: topNames.length, withData: 0, unusedWithData: 0, testJunk: 0 } };

  const sections: Record<string, unknown> = {};
  if (SECTIONS.includes('structure')) sections.structure = structure;
  if (SECTIONS.includes('duplicates')) sections.duplicates = buildDuplicates();
  if (SECTIONS.includes('malformed')) sections.malformed = buildMalformed();
  if (SECTIONS.includes('consistency')) sections.consistency = buildConsistency();
  if (SECTIONS.includes('legacy')) sections.legacy = buildLegacy(topNames, structure);

  const unitTests = readUnitTests();
  const report = {
    meta: {
      script: 'scripts/audit-db-quality.ts',
      mode: 'read-only (dry-run): ни одной записи в RTDB',
      takenAt,
      sections: SECTIONS,
      limit: LIMIT,
      staleDays: STALE_DAYS,
      unitTests,
      privacy: 'ФИО водителей не выгружаются (только id и номера машин); имена сотрудников — точечно.',
      deterministic: 'повторный прогон с тем же --now детерминирован (стабильные сортировки)',
    },
    summary: summarize(sections, structure, topNames),
    sections,
    buckets: buildBuckets(sections),
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = takenAt.replace(/[:.]/g, '-');
  const json = JSON.stringify(report, null, 1);
  writeFileSync(join(OUT_DIR, `audit-db-quality-${stamp}.json`), json + '\n');
  writeFileSync(join(OUT_DIR, 'audit-db-quality.latest.json'), json + '\n');
  const md = renderMarkdown(report);
  writeFileSync(join(OUT_DIR, `audit-db-quality-${stamp}.md`), md);
  writeFileSync(join(OUT_DIR, 'audit-db-quality.latest.md'), md);

  if (JSON_ONLY) {
    console.log(json);
    return 0;
  }
  console.log(md);
  console.log(`[audit-db-quality] JSON: ${join(OUT_DIR, `audit-db-quality-${stamp}.json`)} (+ .latest). Записей в базу — 0 (dry-run).`);
  return 0;
}

function summarize(sections: Record<string, unknown>, structure: { totals: Record<string, number> }, topNames: string[]): Record<string, unknown> {
  const d: any = sections.duplicates;
  const m: any = sections.malformed;
  const c: any = sections.consistency;
  const l: any = sections.legacy;
  const sum = (arr: any[] | undefined, field: string) => (arr || []).reduce((n, x) => n + (Number(x?.[field]) || 0), 0);
  return {
    branchesTotal: topNames.length,
    branchesWithData: structure.totals.withData,
    structureTotals: structure.totals,
    duplicates: d ? {
      tripsExactGroups: d.counts.tripsExactGroups, tripsNearPairs: d.counts.tripsNearPairs, tripsHidden: d.counts.tripsHidden,
      bazaExactGroups: d.counts.bazaExactGroups, bazaNearPairs: d.counts.bazaNearPairs, bazaCrossIds: d.counts.bazaCrossIds,
      stagesExactGroups: d.counts.stagesExactGroups, stagesSameDateDiffLabelGroups: d.counts.stagesSameDateDiffLabelGroups,
      eventsExactGroups: d.counts.eventsExactGroups,
      dirGroups: d.counts.dirGroups, crossBranchTwinGroups: d.counts.crossBranchTwinGroups,
      distancesDupGroups: d.counts.distancesDupGroups, historyDupGroups: d.counts.historyDupGroups,
    } : undefined,
    malformed: m ? {
      plateIssueKinds: m.plates?.issues?.length ?? 0, plateIssueTotal: (m.plates?.issues || []).reduce((n: number, x: any) => n + x.count, 0),
      plateTwinGroups: m.plates?.twinGroupsTotal, plateScriptTwins: m.plates?.scriptTwinGroups,
      emptyRequired: sum(m.empties, 'count'), dateIssues: sum(m.dates?.issues, 'count') + (m.dates?.endBeforeStart?.length ?? 0),
      amountRecords: m.amounts?.totalRecords, textNoise: m.textNoise?.spaceNoiseTotal,
    } : undefined,
    consistency: c ? {
      archiveWithLivePeriod: c.archiveWithLivePeriod?.strictCount,
      archiveLoose: c.archiveWithLivePeriod?.looseCount,
      conflictsTotal: c.simultaneous?.conflictsTotal, conflictsLive: c.simultaneous?.conflictsLive, styksTotal: c.simultaneous?.styksTotal,
      tripAndBaseOpen: c.tripAndBaseOpen?.count,
      staleOpenBase: c.staleOpenBase?.count, staleOpenTrips: c.staleOpenTrips?.count,
      carsNotInDirsTrips: c.carsNotInDirectories?.activeTrips?.count,
      unknownUserRefs: c.unknownUserRefs?.total, unknownUsers: c.unknownUserRefs?.distinctUsers,
      plansWithoutGuard: c.noAuditTrail?.tripStagesPlansWithoutGuard?.count,
    } : undefined,
    legacy: l ? {
      junk: l.junk?.count, legacyBranches: l.legacyBranches?.count, emptyNodes: l.emptyNodes?.count,
      appErrorsTotal: l.appErrors?.total, appErrorsFromDev: l.appErrors?.fromLocalDev,
    } : undefined,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Бакеты: авто / вручную / не трогать
// ─────────────────────────────────────────────────────────────────────────────

interface BucketItem { item: string; count: number | string; risk: 'низкий' | 'средний' | 'высокий'; action: string; note?: string }

function buildBuckets(sections: Record<string, unknown>): Record<string, BucketItem[]> {
  const d: any = sections.duplicates || {};
  const m: any = sections.malformed || {};
  const c: any = sections.consistency || {};
  const l: any = sections.legacy || {};
  const auto: BucketItem[] = [];
  const manual: BucketItem[] = [];
  const keep: BucketItem[] = [];

  if (l.junk) auto.push({
    item: 'Тестовые/демо-записи в нерабочих ветках (см. legacy.junk)', count: l.junk.count, risk: 'низкий',
    action: 'удалить с бэкапом ветки', note: 'действием следующего этапа; ветки tripsdashboard/planDohod/current_trips/trips — сначала подтвердить у владельца',
  });
  if (l.legacyBranches) manual.push({
    item: 'Легаси-ветки с данными без ссылок в коде', count: l.legacyBranches.count, risk: 'средний',
    action: 'решение владельца: архивировать/оставить', note: 'например ratipa_loading_plan, known_fleet, carsPool, ratipa_zagruzok_log',
  });
  if (d.bazaCrossIds) manual.push({
    item: 'Записи, продублированные между baza / baza_cars / archive', count: d.bazaCrossIds ?? 0, risk: 'средний',
    action: 'слияние зеркал — вручную, по решению владельца (два стора читает один модуль)', note: 'первичные бизнес-записи не удалять',
  });
  if (l.usersDualStore) manual.push({
    item: 'Два стора сотрудников users / users_list', count: `${(l.usersDualStore.usersOnly || []).length}+${(l.usersDualStore.usersListOnly || []).length}`, risk: 'средний',
    action: 'ручная сверка и решение о едином сторе', note: 'ломает права при неаккуратном слиянии',
  });
  manual.push({ item: 'Смешанные кир/лат «цифровые близнецы» номеров', count: m.plates?.scriptTwinGroups ?? 0, risk: 'средний', action: 'вручную: выбрать каноническое написание (латиница), остальное — унифицировать на этапе чистки', note: 'автозамена опасна: номера — ключи сопоставления' });
  manual.push({ item: 'Дубли/вариации справочников (tractors/trailers/couplings/vehicleFleet/ferryCouples)', count: (d.counts?.dirGroups ?? 0) + (d.counts?.crossBranchTwinGroups ?? 0), risk: 'средний', action: 'слияние заглушек в реальные записи — вручную', note: 'deps у BazaModule/DocumentsModule' });
  manual.push({ item: 'Пустые обязательные поля в записях справочников (trailers 31, tractors 15 и т.п.)', count: m.empties ? m.empties.reduce((n: number, x: any) => n + x.count, 0) : 0, risk: 'низкий', action: 'дополнить вручную или слить с полноценными записями' });
  manual.push({ item: 'Открытые периоды дольше порога и активные рейсы без конца', count: `${c.staleOpenBase?.count ?? 0}/${c.staleOpenTrips?.count ?? 0}`, risk: 'средний', action: 'ручная сверка с диспетчерами (возможно, просто не закрыли период)' });
  manual.push({ item: 'Конфликты интервалов (машина в рейсе и в простое одновременно)', count: c.simultaneous?.conflictsTotal ?? 0, risk: 'высокий', action: 'ручная сверка; первичные записи только помечать (duplicateOf), не удалять' });
  manual.push({ item: 'Ссылки на несуществующих пользователей', count: c.unknownUserRefs?.total ?? 0, risk: 'низкий', action: 'переатрибутировать вручную' });
  keep.push({ item: 'trips_dashboard / baza / tripTimeline — первичные бизнес-записи', count: 'полностью', risk: 'высокий', action: 'не удалять; только слияние дублей и пометка в следующем этапе' });
  keep.push({ item: 'auditLogs (~432k записей, 112 МБ)', count: '112 МБ', risk: 'высокий', action: 'ретенция — отдельным решением владельца (юридический след)' });
  keep.push({ item: 'routedesk, dozvols*, telemetry_*', count: 'вне области', risk: 'высокий', action: 'не трогать: другие приложения/модули' });
  return { auto, manual, keep };
}

// ─────────────────────────────────────────────────────────────────────────────
// Markdown
// ─────────────────────────────────────────────────────────────────────────────

function renderMarkdown(report: Record<string, any>): string {
  const L: string[] = [];
  const say = (x = '') => L.push(x);
  const code = (v: unknown) => '`' + JSON.stringify(v) + '`';
  const ex = (rows: Array<Record<string, unknown>> | undefined, key: (r: any) => unknown = (r) => r) =>
    (rows || []).map((r) => `\`${JSON.stringify(key(r))}\``).join(', ');

  say('# Аудит качества базы RATIPA (только чтение)');
  say('');
  say(`- Снято: **${report.meta.takenAt}**; режим: ${report.meta.mode}`);
  say(`- Секции: ${report.meta.sections.join(', ')}; лимит примеров: ${report.meta.limit}; порог простоя: ${report.meta.staleDays} дн.`);
  say(`- Юнит-проверки детекторов: **${report.meta.unitTests.checks}** (провалов ${report.meta.unitTests.failed})${report.meta.unitTests.file ? '' : ' — файл не найден'}`);
  say(`- Приватность: ${report.meta.privacy}`);
  say('');

  const st = report.sections.structure;
  if (st) {
    say('## 1. Структура');
    say('');
    say(`Веток верхнего уровня: **${st.totals.branches}**, с данными: **${st.totals.withData}**, легаси с данными: **${st.totals.unusedWithData}**, тест/мусор: **${st.totals.testJunk}**.`);
    say('');
    say('| ветка | тип | детей | байт | refs | вердикт |');
    say('|---|---|---:|---:|---:|---|');
    st.rows.forEach((r: any) => say(`| ${r.name} | ${r.kind} | ${r.children ?? '—'} | ${r.bytes ?? '—'} | ${r.refsApp} | ${r.verdict}${r.note ? ' — ' + r.note : ''} |`));
    say('');
  }

  const dup = report.sections.duplicates;
  if (dup) {
    say('## 2. Дубликаты');
    say('');
    say(`- Рейсы (trips_dashboard): точных групп (машина+дата) **${dup.counts.tripsExactGroups}**, рядом ±1 день — **${dup.counts.tripsNearPairs}** пар, скрытых дублей **${dup.counts.tripsHidden}**.`);
    dup.tripsExact.slice(0, report.meta.limit).forEach((g: any) => say(`  - ${g.key}: ${ex(g.items as any, (r: any) => `${r.id} (${r.start}→${r.end || '∞'}${r.archived ? ', архив' : ''})`)}`));
    dup.tripsNear.slice(0, report.meta.limit).forEach((p: any) => say(`  - рядом: ${p.a} ↔ ${p.b} [${p.carNumber}] Δ${p.startDiff}д${p.sameEnd ? ', конец совпал' : ''}${p.sameLegs ? ', маршрут совпал' : ''}${p.sameFreight ? ', фрахт совпал' : ''}`));
    dup.tripsHidden.slice(0, report.meta.limit).forEach((h: any) => say(`  - скрытый: ${h.id} → duplicateOf ${h.duplicateOf}${h.hiddenReason ? ' (' + h.hiddenReason + ')' : ''}`));
    say(`- Периоды базы: точных групп **${dup.counts.bazaExactGroups}**, рядом ±1 день — **${dup.counts.bazaNearPairs}** пар; пересечение id между baza/baza_cars/archive — **${dup.counts.bazaCrossIds}**.`);
    dup.bazaAcrossBranches.slice(0, report.meta.limit).forEach((x: any) => say(`  - ${x.carNumber} [${x.id}] — в ${x.where}`));
    say(`- Этапы: точных групп (рейс+тип+дата+место) **${dup.counts.stagesExactGroups}**; та же дата+тип с разным местом **${dup.counts.stagesSameDateDiffLabelGroups}** (проверить глазами); дублей seq **${dup.counts.stagesSeqDupGroups}**.`);
    say(`- События: точных групп **${dup.counts.eventsExactGroups}** (всего событий ${dup.counts.eventsTotal ?? 0}).`);
    say(`- Справочники: групп-близнецов **${dup.counts.dirGroups}**, кросс-веточных **${dup.counts.crossBranchTwinGroups}**.`);
    dup.dirsGroups.slice(0, report.meta.limit).forEach((g: any) => say(`  - ${g.branch}: ${g.kind} «${g.skeleton}» → ${ex([{ v: g.variants }], (r: any) => r.v)}; ids: ${(g.ids || []).join(', ')}`));
    dup.crossBranchTwinGroups.slice(0, report.meta.limit).forEach((g: any) => say(`  - ${g.kind} «${g.skeleton}»: ${g.variants.join(' / ')} — ветки: ${g.branches.join(', ')}`));
    say(`- knownDistancesList: дублей пар «откуда→куда» **${dup.counts.distancesDupGroups}**; global_history: точных дублей **${dup.counts.historyDupGroups}**.`);
    say('');
  }

  const ml = report.sections.malformed;
  if (ml) {
    say('## 3. Неверно введённые данные');
    say('');
    say(`Номеров проверено: ${ml.plates.totalValues}; групп «близнецов» — **${ml.plates.twinGroupsTotal}**, из них кир/лат-скриптовых **${ml.plates.scriptTwinGroups}**.`);
    ml.plates.issues.forEach((f: any) => say(`- ${f.label}: **${f.count}** — ${ex(f.examples)}${f.note ? ` (${f.note})` : ''}`));
    say('');
    say('Пустые обязательные поля:');
    ml.empties.forEach((f: any) => say(`- ${f.label}: **${f.count}**${f.count ? ' — ' + ex(f.examples) : ''}`));
    say('');
    say(`Даты: проблем по полям ${ml.dates.issues.reduce((n: number, x: any) => n + x.count, 0)}; «конец раньше начала» — **${ml.dates.endBeforeStart.length}**.`);
    ml.dates.issues.forEach((f: any) => f.examples.slice(0, 5).forEach((e: any) => say(`- ${f.label}: ${JSON.stringify(e)}`)));
    ml.dates.endBeforeStart.slice(0, report.meta.limit).forEach((e: any) => say(`- ${e.branch} [${e.id}] ${e.start} > ${e.end}${e.carNumber ? ' (' + e.carNumber + ')' : ''}`));
    say('');
    say(`Суммы/числа: записей с проблемами **${ml.amounts.totalRecords}** (показаны первые ${Math.min(report.meta.limit * 3, ml.amounts.totalRecords)}).`);
    ml.amounts.findings.slice(0, report.meta.limit).forEach((f: any) => say(`- ${f.branch} [${f.id}]${f.carNumber ? ' ' + f.carNumber : ''}${f.car ? ' ' + f.car : ''}: ${JSON.stringify(f.issues)}`));
    say('');
    say(`Пробелы/регистр: замечаний **${ml.textNoise.spaceNoiseTotal}**; вариаций брендов **${ml.textNoise.brandVariantsTotal}**.`);
    ml.textNoise.brandVariants.slice(0, report.meta.limit).forEach((b: any) => say(`- ${b.field}: ${b.variants.join(' / ')}`));
    say('');
  }

  const cs = report.sections.consistency;
  if (cs) {
    say('## 4. Несогласованности');
    say('');
    say(`- Архив × открытый простой: строгих пересечений **${cs.archiveWithLivePeriod.strictCount}**, мягких совпадений по номеру ${cs.archiveWithLivePeriod.looseCount}. ${cs.archiveWithLivePeriod.note}`);
    cs.archiveWithLivePeriod.examples.slice(0, report.meta.limit).forEach((r: any) => say(`  - ${r.plate} [${r.id}] ${r.arrival}→${r.departure} ↔ открытые периоды: ${(r.openPeriods || []).map((p: any) => `${p.id} с ${p.start}`).join(', ')}`));
    say(`- Архив без даты выезда: **${cs.archiveWithoutDeparture.count}**; архивные периоды baza без конца: **${cs.bazaArchiveOpen.count}**.`);
    say(`- Пересечения интервалов одной машины: проверено пар ${cs.simultaneous.pairsChecked}; конфликтов **${cs.simultaneous.conflictsTotal}** (живых **${cs.simultaneous.conflictsLive}**), стыков ${cs.simultaneous.styksTotal}. Разбивка: ${JSON.stringify(cs.simultaneous.kindSplit)}.`);
    cs.simultaneous.conflictsExamples.slice(0, report.meta.limit).forEach((p: any) => say(`  - КОНФЛИКТ ${p.kind} [${p.carNumber}] ${p.a.span} (${p.a.id}${p.a.archived ? ', архив' : ''}) ↔ ${p.b.span} (${p.b.id}${p.b.archived ? ', архив' : ''}) — ${p.overlapDays == null ? 'оба открыты' : p.overlapDays + ' дн'}`));
    say(`- Машина и в рейсе, и в открытом простое: **${cs.tripAndBaseOpen.count}**${cs.tripAndBaseOpen.startsSoonCount ? ` (+ ${cs.tripAndBaseOpen.startsSoonCount} предстоящих рейсов)` : ''}${cs.tripAndBaseOpen.count ? ' — ' + ex(cs.tripAndBaseOpen.examples, (r: any) => `${r.carNumber} (рейс ${r.tripId}, ${r.tripSpan})`) : ''}`);
    cs.tripAndBaseOpen.startsSoonExamples.slice(0, 5).forEach((r: any) => say(`  - предстоит: ${r.carNumber} (рейс ${r.tripId}, ${r.tripSpan})`));
    say(`- Простой дольше ${cs.staleOpenBase.thresholdDays} дн.: **${cs.staleOpenBase.count}**; рейсы без конца дольше ${cs.staleOpenTrips.thresholdDays} дн.: **${cs.staleOpenTrips.count}**.`);
    cs.staleOpenBase.examples.slice(0, 5).forEach((e: any) => say(`  - ${e.carNumber} [${e.id}] с ${e.arrival} (${e.ageDays} дн.)`));
    say(`- Активные рейсы с машиной не из справочников: **${cs.carsNotInDirectories.activeTrips.count}**${cs.carsNotInDirectories.openBase.count ? `; открытые периоды — ${cs.carsNotInDirectories.openBase.count}` : ''}.`);
    cs.carsNotInDirectories.activeTrips.examples.slice(0, 5).forEach((e: any) => say(`  - ${e.carNumber} [${e.id}] с ${e.start}`));
    say(`- Ссылки на неизвестных пользователей: **${cs.unknownUserRefs.total}** (уникальных ${cs.unknownUserRefs.distinctUsers}).`);
    cs.unknownUserRefs.users.slice(0, 5).forEach((u: any) => say(`  - ${u.userId}: ${u.refs} ссылок (${u.where.join('; ')})`));
    say(`- Без audit-следов: планы этапов без planGuard — **${cs.noAuditTrail.tripStagesPlansWithoutGuard.count}**; baza без history — **${cs.noAuditTrail.bazaWithoutHistory.count}**; рейсы без createdBy — **${cs.noAuditTrail.tripsWithoutCreatedBy}**.`);
    say('');
  }

  const lg = report.sections.legacy;
  if (lg) {
    say('## 5. Старое и хвостовое');
    say('');
    say(`- Мусор прошлых прогонов (probe/qa/test/tmp/demo-маркеры): **${lg.junk.count}** записей.`);
    lg.junk.examples.slice(0, report.meta.limit).forEach((j: any) => say(`  - ${j.branch} [${j.id}]: ${j.markers.join(', ')}${j.extra && Object.keys(j.extra).length ? ' ' + JSON.stringify(j.extra) : ''}`));
    lg.stubs.forEach((st: any) => say(`- Заглушки ${st.branch}: **${st.count}** из ${st.total} — ${st.note}`));
    say(`- Пустые узлы: **${lg.emptyNodes.count}** (${lg.emptyNodes.names.join(', ') || '—'}).`);
    say(`- Легаси-ветки с данными: **${lg.legacyBranches.count}**.`);
    lg.legacyBranches.rows.slice(0, report.meta.limit * 2).forEach((r: any) => say(`  - ${r.name} (детей ${r.children}, refs ${r.refsApp}, ${r.verdict})${r.note ? ' — ' + r.note : ''}`));
    say(`- dozvola-семейство версий: ${lg.dozvolFamilies.versions.map((v: any) => `${v.name}(${v.children})`).join(', ')} — ${lg.dozvolFamilies.note}`);
    say(`- users / users_list: ${lg.usersDualStore.users} / ${lg.usersDualStore.usersList} — расхождения: users+${lg.usersDualStore.usersOnly.length}, users_list+${lg.usersDualStore.usersListOnly.length}. ${lg.usersDualStore.note}`);
    say(`- appErrors: всего ${lg.appErrors.total}, из локальной разработки ${lg.appErrors.fromLocalDev}. ${lg.appErrors.note}`);
    say('');
  }

  say('## План чистки (бакеты)');
  say('');
  say('### Безопасно чистить автоматически (с бэкапом)');
  report.buckets.auto.forEach((b: BucketItem) => say(`- ${b.item} — **${b.count}**; действие: ${b.action} (риск ${b.risk})${b.note ? '. ' + b.note : ''}`));
  say('');
  say('### Только вручную (решение/сверка)');
  report.buckets.manual.forEach((b: BucketItem) => say(`- ${b.item} — **${b.count}**; действие: ${b.action} (риск ${b.risk})${b.note ? '. ' + b.note : ''}`));
  say('');
  say('### Не трогать');
  report.buckets.keep.forEach((b: BucketItem) => say(`- ${b.item} — ${b.count}; ${b.action}${b.note ? '. ' + b.note : ''}`));
  say('');
  say('---');
  say('Отчёт сгенерирован скриптом `scripts/audit-db-quality.ts` в режиме только-чтение.');
  return L.join('\n') + '\n';
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[audit-db-quality] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });

/**
 * migrate-directions — DRY-RUN подготовка справочника `directions` (ТОЛЬКО ЧТЕНИЕ,
 * ни одной записи в RTDB — запись не реализована вовсе, это разведка).
 *
 * Что делает
 *  · собирает направления из ФАКТИЧЕСКИХ данных: поле `direction` записей
 *    trips_dashboard (включая архив), а для рейсов без него — из плеч `legs`
 *    (города → страна; карта городов — фрагмент по городам из данных, лежит в
 *    scripts/tl-audit-core.ts, неизвестные города честно остаются null);
 *  · показывает, что уже есть в справочниках `directories/directions` и
 *    `directories/tripDirections`, и НЕ предлагает дубликатов: совпадение по
 *    названию помечается как «существующая запись — расширить полями»;
 *  · нормализует КОДЫ по ТЗ (tl-audit-core.normalizeDirectionCode):
 *    CNH-RUS / HN-RUS → CHN-RUS; RUS-By → RUS-BY; BY-AM → BY-ARM.
 *    Общее правило: верхний регистр, страна — канонический код портала
 *    (CHN, RUS, TUR, KAZ, UZB, TJK, KGZ, MNG, IRN, GEO, ARM, AZE; BY — как в
 *    примерах ТЗ остаётся BY; LT/PL добавлены по данным). Неизвестные токены
 *    НЕ подменяются — попадают в список на решение владельца;
 *  · считает ЧЕРНОВИКИ plannedDays / plannedRate / plannedCosts по фактам
 *    рейсов группы (среднее/медиана, n, min/max) и честно помечает группы с
 *    малым числом наблюдений; чего нет в данных (bufferDays) — не выдумывает.
 *
 * Методика черновиков (показана в отчёте)
 *   plannedDays  = среднее поле `days` рейса (при отсутствии — dateEnd − dateStart + 1);
 *   plannedRate  = среднее `totalFreight` (фрахт рейса, расчётная валюта портала);
 *   plannedCosts = среднее `totalExpenses` (расходы рейса);
 *   bufferDays   = данных нет → null (решение владельца).
 *   Статистика — по НЕпробным рейсам; архив включается (это факты).
 *   Мало данных < 8 наблюдений → черновик помечается «условный».
 *
 * Запуск
 *   npx tsx scripts/migrate-directions.ts            # текст + JSON в tl-dups/
 *   npx tsx scripts/migrate-directions.ts --json     # только машинный JSON
 *   npx tsx scripts/migrate-directions.ts --out=DIR  # свой каталог отчётов
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminDb } from '../server/firebaseAdmin.ts';
import {
  cityCountryOf,
  normalizeDirectionCode,
  numStats,
  looksProbe,
  parseLooseDate,
  type CodeNormResult,
  type CountryCode,
  type NumStats,
} from './tl-audit-core.ts';

const ARGS = process.argv.slice(2);
const JSON_ONLY = ARGS.includes('--json');
const OUT_DIR = (ARGS.find((a) => a.startsWith('--out=')) || '').split('=')[1] || '/Users/sergei/.hermes/cache/scratch/tl-dups';
/** Порог «мало данных»: меньше — черновик ставки/дней помечается условным. */
const MIN_SAMPLE = 8;

const s = (v: unknown): string => String(v ?? '');
const entriesOf = (raw: unknown): Array<[string, Record<string, unknown>]> =>
  raw && typeof raw === 'object'
    ? Object.entries(raw as Record<string, unknown>).filter(([, v]) => v && typeof v === 'object') as Array<[string, Record<string, unknown>]>
    : [];

interface TripRow {
  id: string;
  direction: string;
  carNumber: string;
  archived: boolean;
  probe: boolean;
  note: string;
  startIso: string;
  endIso: string;
  days: number | null;
  totalFreight: number | null;
  totalExpenses: number | null;
  legs: Array<{ from: string; to: string }>;
}

/** Код-подобные строки в данных: РОВНО пары ЛАТИНСКИХ букв/цифр (XXX-YYY). */
const CODE_LIKE_RE = /(?<![A-Za-zА-Яа-яЁё0-9])[A-Z]{2,4}\s*[-–—]\s*[A-Z]{2,4}(?![A-Za-zА-Яа-яЁё0-9])/g;

/** Название направления → страна-цель (словарь; неизвестное имя — не выдумываем). */
const DIRECTION_NAME_COUNTRY: Record<string, CountryCode> = {
  'китай': 'CHN', 'турция': 'TUR', 'литва': 'LT', 'польша': 'PL', 'россия': 'RUS', 'беларусь': 'BY',
  'казахстан': 'KAZ', 'узбекистан': 'UZB', 'таджикистан': 'TJK', 'киргизия': 'KGZ', 'кыргызстан': 'KGZ',
  'монголия': 'MNG', 'иран': 'IRN', 'грузия': 'GEO', 'армения': 'ARM', 'азербайджан': 'AZE',
};

const collectCodeLike = (trips: TripRow[]): string[] => {
  const found = new Set<string>();
  trips.forEach((t) => {
    const hay = [t.direction, t.note, ...t.legs.flatMap((l) => [l.from, l.to])].join(' | ');
    (hay.match(CODE_LIKE_RE) || []).forEach((m) => found.add(m.trim()));
  });
  return [...found].sort();
};

async function main(): Promise<number> {
  if (!adminDb) {
    console.error('[migrate-directions] Firebase Admin недоступен: задайте FIREBASE_SERVICE_ACCOUNT (или FIREBASE_SERVICE_ACCOUNT_PATH) в .env/.env.local');
    return 2;
  }
  const takenAt = new Date().toISOString();
  const [tripsSnap, dirsSnap, tripDirsSnap] = await Promise.all([
    adminDb.ref('trips_dashboard').get(),
    adminDb.ref('directories/directions').get(),
    adminDb.ref('directories/tripDirections').get(),
  ]);

  const trips: TripRow[] = entriesOf(tripsSnap.val()).map(([key, rec]) => {
    const legsRaw = rec.legs;
    const legs = (Array.isArray(legsRaw) ? legsRaw : legsRaw && typeof legsRaw === 'object' ? Object.values(legsRaw as Record<string, unknown>) : [])
      .filter((l): l is Record<string, unknown> => !!l && typeof l === 'object')
      .map((l) => ({ from: s(l.from).trim(), to: s(l.to).trim() }));
    const start = parseLooseDate(rec.dateStart);
    const end = parseLooseDate(rec.dateEnd);
    const daysField = Number(rec.days);
    const days = Number.isFinite(daysField) && daysField > 0
      ? daysField
      : start && end ? end.day - start.day + 1 : null;
    const id = s(rec.id) || key;
    const note = s(rec.tripNote);
    return {
      id,
      direction: s(rec.direction).trim(),
      carNumber: s(rec.carNumber),
      archived: rec.isArchived === true,
      probe: looksProbe([id, note, rec.createdBy]),
      note,
      startIso: start?.iso ?? '',
      endIso: end?.iso ?? '',
      days,
      totalFreight: Number.isFinite(Number(rec.totalFreight)) ? Number(rec.totalFreight) : null,
      totalExpenses: Number.isFinite(Number(rec.totalExpenses)) ? Number(rec.totalExpenses) : null,
      legs,
    };
  });

  const existingDirs = entriesOf(dirsSnap.val()).map(([key, rec]) => ({
    key,
    id: s(rec.id) || key,
    label: s(rec.label || rec.name),
    coeff: Number.isFinite(Number(rec.coeff)) ? Number(rec.coeff) : null,
    hasCode: !!s(rec.code),
  }));
  const existingTripDirs = entriesOf(tripDirsSnap.val()).map(([key, rec]) => ({ key, name: s(rec.name || rec.label), code: s(rec.code) }));

  // ── группы направлений (поле direction) ─────────────────────────────────
  const groups = new Map<string, TripRow[]>();
  trips.forEach((t) => {
    const k = t.direction || '';
    groups.set(k, [...(groups.get(k) || []), t]);
  });

  const firstLegCity = (t: TripRow): string => t.legs.find((l) => l.from || l.to)?.from || '';
  const lastLegCity = (t: TripRow): string => {
    const nonEmpty = t.legs.filter((l) => l.from || l.to);
    return nonEmpty.length ? nonEmpty[nonEmpty.length - 1].to : '';
  };

  interface GroupReport {
    direction: string;
    name: string;
    tripsTotal: number;
    tripsFacts: number;
    archived: number;
    probe: number;
    firstLegCountries: Record<string, number>;
    lastLegCountries: Record<string, number>;
    /** Все страны, встречающиеся в плечах группы (откуда/куда каждого плеча). */
    visitedCountries: Record<string, number>;
    /** Страна имени (Китай→CHN) подтверждена плечами: сколько вхождений. */
    nameCountryHits: number;
    unmappedCities: Array<[string, number]>;
    compositeRoutes: Array<[string, number]>;
    days: NumStats;
    rate: NumStats;
    costs: NumStats;
    smallSample: boolean;
    existing: Array<{ key: string; id: string; label: string; coeff: number | null }>;
    proposedFromCountry: CountryCode | null;
    proposedToCountry: CountryCode | null;
    proposedCode: string | null;
    alternatives: string[];
    bufferDays: null;
    needsOwner: string[];
  }

  interface CountryDist {
    dist: Record<string, number>;
    unmapped: Map<string, number>;
    composites: Map<string, number>;
  }

  const isComposite = (city: string): boolean => /\s-\s|\+/.test(city) || (city.match(/-/g) || []).length > 2;

  const countryDist = (list: TripRow[], pick: (t: TripRow) => string): CountryDist => {
    const dist: Record<string, number> = {};
    const unmapped = new Map<string, number>();
    const composites = new Map<string, number>();
    list.forEach((t) => {
      const city = pick(t);
      if (!city) return;
      if (isComposite(city)) { composites.set(city, (composites.get(city) || 0) + 1); return; }
      const c = cityCountryOf(city);
      if (c) dist[c] = (dist[c] || 0) + 1;
      else unmapped.set(city, (unmapped.get(city) || 0) + 1);
    });
    return { dist, unmapped, composites };
  };

  const groupReports: GroupReport[] = [...groups.entries()].map(([direction, list]) => {
    const facts = list.filter((t) => !t.probe);
    const f1 = countryDist(facts, firstLegCity);
    const f2 = countryDist(facts, lastLegCity);
    // Все страны плеч группы (откуда+куда каждой ноги) — доказательство посещения.
    const visited: Record<string, number> = {};
    const unmapped = new Map<string, number>();
    const composites = new Map<string, number>();
    facts.forEach((t) => {
      t.legs.forEach((l) => {
        [l.from, l.to].forEach((city) => {
          if (!city) return;
          if (isComposite(city)) { composites.set(city, (composites.get(city) || 0) + 1); return; }
          const c = cityCountryOf(city);
          if (c) visited[c] = (visited[c] || 0) + 1;
          else unmapped.set(city, (unmapped.get(city) || 0) + 1);
        });
      });
    });
    const topFirst = Object.entries(f1.dist).sort((a, b) => b[1] - a[1])[0]?.[0] as CountryCode | undefined;
    // Страна-«цель»: сначала по НАЗВАНИЮ направления (Китай→CHN, Турция→TUR из словаря);
    // если имени нет в словаре — самая посещаемая страна, отличная от страны старта;
    // ничего не выдумываем: нет доказательств — null + пункт владельцу.
    const nameCountry = DIRECTION_NAME_COUNTRY[direction.trim().toLowerCase()] ?? null;
    const visitedTop = Object.entries(visited).filter(([c]) => c !== topFirst).sort((a, b) => b[1] - a[1]);
    const topTarget = nameCountry ?? (visitedTop[0]?.[0] as CountryCode | undefined) ?? null;
    const nameCountryHits = nameCountry ? visited[nameCountry] || 0 : 0;
    const days = numStats(facts.map((t) => t.days));
    const rate = numStats(facts.map((t) => t.totalFreight));
    const costs = numStats(facts.map((t) => t.totalExpenses));
    const existing = existingDirs.filter((e) => e.label && e.label.toLowerCase() === direction.toLowerCase());
    const proposedFrom = topFirst ?? null;
    const proposedTo = topTarget;
    // Код-предложение: «ОТКУДА-КУДА» через нормализацию ТЗ (примеры: CHN-RUS, RUS-BY, BY-ARM).
    const rawCode = proposedFrom && proposedTo ? `${proposedFrom}-${proposedTo}` : null;
    const norm: CodeNormResult | null = rawCode ? normalizeDirectionCode(rawCode) : null;
    const needsOwner: string[] = [];
    if (facts.length < MIN_SAMPLE) needsOwner.push(`мало фактов (${facts.length} < ${MIN_SAMPLE}) — ставка/дни условные`);
    if (unmapped.size) needsOwner.push(`города без страны: ${[...unmapped.keys()].slice(0, 6).join(', ')}${unmapped.size > 6 ? '…' : ''}`);
    if (!proposedFrom || !proposedTo) needsOwner.push('страна(ы) направления не определяются из фактов');
    if (nameCountry && !nameCountryHits) needsOwner.push(`страна имени (${nameCountry}) ни разу не встречена в плечах — проверить`);
    if (existing.length) needsOwner.push('в directories/directions уже есть запись с таким названием — расширять её, не дублировать');
    if (list.some((t) => t.probe) && facts.length === 0) needsOwner.push('все рейсы группы — пробные (параллельные агенты); в справочник без решения владельца не вносить');
    return {
      direction,
      name: direction || '(без направления)',
      tripsTotal: list.length,
      tripsFacts: facts.length,
      archived: list.filter((t) => t.archived).length,
      probe: list.filter((t) => t.probe).length,
      firstLegCountries: f1.dist,
      lastLegCountries: f2.dist,
      visitedCountries: visited,
      nameCountryHits,
      unmappedCities: [...unmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      compositeRoutes: [...composites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10),
      days, rate, costs,
      smallSample: facts.length < MIN_SAMPLE,
      existing,
      proposedFromCountry: proposedFrom,
      proposedToCountry: proposedTo,
      proposedCode: norm?.code ?? null,
      alternatives: [
        nameCountry ? `${nameCountry} (короткий код цели, как autoCode в lib/directions)` : '',
        proposedFrom && proposedTo ? `${proposedTo}-${proposedFrom} (обратный порядок)` : '',
      ].filter(Boolean),
      bufferDays: null,
      needsOwner,
    };
  }).sort((a, b) => b.tripsTotal - a.tripsTotal);

  // ── рейсы без определяемого направления ─────────────────────────────────
  const noDirection = trips.filter((t) => !t.direction);
  const noDirectionReport = noDirection.map((t) => {
    const from = firstLegCity(t);
    const to = lastLegCity(t);
    const fromC = cityCountryOf(from);
    const toC = cityCountryOf(to);
    const inferWith = fromC && toC && toC !== fromC ? normalizeDirectionCode(`${fromC}-${toC}`) : null;
    return {
      id: t.id,
      carNumber: t.carNumber,
      start: t.startIso,
      end: t.endIso,
      archived: t.archived,
      probe: t.probe,
      legs: t.legs.slice(0, 2),
      inferableFrom: from && to ? `${from} → ${to}` : '',
      inferableCountries: fromC && toC ? `${fromC}-${toC}` : '',
      proposedCode: inferWith?.code ?? null,
    };
  });

  // ── нормализация кодов ───────────────────────────────────────────────────
  // 1) Примеры ТЗ (закреплены юнит-тестами). 2) Код-подобные строки из данных.
  // 3) Предложенные коды групп (проверка, что канонизация идемпотентна).
  const tzExamples = ['CNH-RUS', 'HN-RUS', 'RUS-By', 'BY-AM', 'by-arm', 'CNH_RUS', 'CHN–RUS'];
  const codeLikeInData = collectCodeLike(trips);
  const proposedCodes = groupReports.map((g) => g.proposedCode).filter((c): c is string => !!c);
  const normalization = {
    rule: 'верхний регистр; страна — канонический код портала (CHN, RUS, TUR, KAZ, UZB, TJK, KGZ, MNG, IRN, GEO, ARM, AZE; BY — как в примерах ТЗ; LT/PL — по данным); неизвестные токены не подменяются',
    tzExamples: tzExamples.map((e) => normalizeDirectionCode(e)),
    codeLikeInData: codeLikeInData.map((e) => normalizeDirectionCode(e)),
    proposedCodes: proposedCodes.map((e) => normalizeDirectionCode(e)),
    unknownTokens: [...new Set(
      [...tzExamples, ...codeLikeInData, ...proposedCodes]
        .flatMap((e) => normalizeDirectionCode(e).unknown),
    )],
  };

  // ── предложенные записи структуры `directions` ──────────────────────────
  const proposedRecords = groupReports
    .filter((g) => g.direction)
    .map((g) => ({
      id: g.proposedCode ? g.proposedCode.toLowerCase() : `dir_${g.direction.toLowerCase().replace(/\s+/g, '_')}`,
      code: g.proposedCode,
      name: g.direction,
      fromCountry: g.proposedFromCountry,
      toCountry: g.proposedToCountry,
      plannedRate: g.rate.mean,
      plannedCosts: g.costs.mean,
      plannedDays: g.days.mean,
      bufferDays: null,
      active: true,
      // Полей ТЗ-структуры выше достаточно; ниже — только доказательства (в запись не пойдут):
      _evidence: {
        tripsTotal: g.tripsTotal,
        tripsFacts: g.tripsFacts,
        smallSample: g.smallSample,
        rateBasis: `mean(totalFreight) по ${g.rate.n} фактам`,
        daysBasis: `mean(days) по ${g.days.n} фактам`,
        costsBasis: `mean(totalExpenses) по ${g.costs.n} фактам`,
      },
      _needsOwner: g.needsOwner,
    }));

  const existingConflicts = {
    directoriesDirections: existingDirs.map((e) => ({
      ...e,
      issues: [
        !e.hasCode ? 'нет поля code (структура ТЗ требует)' : '',
        s(e.id) !== s(e.key) ? `id («${e.id}») не совпадает с ключом записи («${e.key}») — при миграции IDs это конфликт` : '',
        e.coeff == null ? 'нет coeff' : '',
      ].filter(Boolean),
    })),
    tripDirectionsEmpty: existingTripDirs.length === 0,
    note: 'directories/tripDirections (цвета направлений) пуст — модуль использует встроенные Китай/Турция; это ДРУГОЙ справочник (цвета), не смешивать с rates-справочником directions',
    wouldCreateDuplicates: groupReports
      .filter((g) => g.existing.length > 0)
      .map((g) => ({ direction: g.direction, existingIds: g.existing.map((e) => e.key) })),
  };

  const report = {
    takenAt,
    mode: 'dry-run (read-only) — запись не реализована, ни одной мутации',
    counts: {
      trips: trips.length,
      tripsWithDirection: trips.filter((t) => t.direction).length,
      tripsWithoutDirection: noDirection.length,
      factsNonProbe: trips.filter((t) => !t.probe).length,
      probe: trips.filter((t) => t.probe).length,
    },
    methodology: {
      plannedDays: 'среднее (и медиана в evidence) поля days рейса; fallback dateEnd−dateStart+1',
      plannedRate: 'среднее totalFreight (фрахт, расчётная валюта портала)',
      plannedCosts: 'среднее totalExpenses',
      plannedDaysNote: 'мало данных < ' + MIN_SAMPLE + ' фактов → черновик «условный»',
      bufferDays: 'источника в данных нет — null, решение владельца',
      архивация: 'архив INCLUDED (это факты); пробные записи параллельных агентов EXCLUDED из статистики',
    },
    directionGroups: groupReports,
    noDirectionTrips: noDirectionReport,
    normalization,
    proposedStructure: { fields: ['id', 'code', 'name', 'fromCountry', 'toCountry', 'plannedRate', 'plannedCosts', 'plannedDays', 'bufferDays', 'active'] },
    proposedRecords,
    existingConflicts,
    notDeduplicated: 'записи с названием как у существующих directions (Турция/Китай) НЕ предлагаются заново — помечены «расширить существующую»',
  };

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = takenAt.replace(/[:.]/g, '-');
  const file = join(OUT_DIR, `directions-dry-run-${stamp}.json`);
  const latest = join(OUT_DIR, 'directions-dry-run.latest.json');
  const json = JSON.stringify(report, null, 1);
  writeFileSync(file, json + '\n');
  writeFileSync(latest, json + '\n');

  if (JSON_ONLY) {
    console.log(json);
    return 0;
  }

  const L: string[] = [];
  const say = (line = ''): void => { L.push(line); };
  const num = (n: number | null, digits = 1): string => (n == null ? '—' : n.toFixed(digits));
  const statsLine = (st: NumStats): string => st.n ? `n=${st.n} ср=${num(st.mean)} мед=${num(st.median)} мин…макс ${num(st.min, 0)}…${num(st.max, 0)}` : 'нет данных';
  say('=== МИГРАЦИЯ НАПРАВЛЕНИЙ (dry-run, только чтение) ===');
  say(`снято: ${takenAt}; JSON: ${file}`);
  say(`Рейсов ${report.counts.trips}: с направлением ${report.counts.tripsWithDirection}, без ${report.counts.tripsWithoutDirection}; фактов без пробных ${report.counts.factsNonProbe} (пробных ${report.counts.probe}).`);
  const inferable = noDirectionReport.filter((t) => t.proposedCode).length;
  say(`ПРИВЯЗКА: к справочнику directions привяжется ${report.counts.tripsWithDirection} рейсов (${groupReports.filter((g) => g.direction).map((g) => `${g.name} ${g.tripsTotal}`).join(' + ')}); без направления ${report.counts.tripsWithoutDirection} (из них выводимо по плечам: ${inferable}).`);
  say('');
  say('── ГРУППЫ НАПРАВЛЕНИЙ (поле direction) ────────────────────');
  groupReports.forEach((g) => {
    say(`• «${g.name}»: рейсов ${g.tripsTotal} (фактов ${g.tripsFacts}, архив ${g.archived}, пробных ${g.probe})${g.smallSample ? ' — МАЛО ДАННЫХ, черновик условный' : ''}`);
    if (g.tripsFacts) {
      say(`   первые ноги из: ${JSON.stringify(g.firstLegCountries)}; последние в: ${JSON.stringify(g.lastLegCountries)};`);
      say(`   все страны плеч: ${JSON.stringify(g.visitedCountries)}${g.nameCountryHits ? `; страна имени подтверждена плечами ${g.nameCountryHits} раз(а)` : ''}`);
      say(`   города без страны (топ): ${g.unmappedCities.length ? g.unmappedCities.map(([c, n]) => `${c}:${n}`).join(', ') : 'нет'}`);
      if (g.compositeRoutes.length) say(`   составные маршруты в плечах (не разбираются): ${g.compositeRoutes.length} шт`);
      say(`   ЧЕРНОВИК: plannedDays ${statsLine(g.days)}; plannedRate(фрахт) ${statsLine(g.rate)}; plannedCosts ${statsLine(g.costs)}; bufferDays — нет источника`);
      if (g.direction) {
        say(`   предложение: fromCountry=${g.proposedFromCountry ?? '—'}, toCountry=${g.proposedToCountry ?? '—'}, code=${g.proposedCode ?? '—'}${g.alternatives.length ? ' (альтернативы: ' + g.alternatives.join('; ') + ')' : ''}`);
      } else {
        say('   запись в справочник НЕ предлагается (у рейсов группы поле direction пустое — см. список ниже)');
      }
    }
    if (g.existing.length) say(`   СУЩЕСТВУЕТ в directories/directions: ${g.existing.map((e) => `${e.key} («${e.label}», coeff ${e.coeff ?? '—'})`).join(', ')} → расширять, не дублировать`);
    if (g.needsOwner.length) say(`   требует решения владельца: ${g.needsOwner.join('; ')}`);
  });
  say('');
  say('── РЕЙСЫ БЕЗ ОПРЕДЕЛЯЕМОГО НАПРАВЛЕНИЯ ────────────────────');
  say(`Всего ${noDirectionReport.length}. Из них определяемых по плечам: ${noDirectionReport.filter((t) => t.proposedCode).length}.`);
  noDirectionReport.forEach((t) => {
    say(`   · ${t.id} [${t.carNumber}]${t.archived ? ' архив' : ''}${t.probe ? ' пробный' : ''} — ${t.inferableFrom || 'плеч нет'}; страны: ${t.inferableCountries || '—'}; код: ${t.proposedCode ?? 'не определяется'}`);
  });
  say('');
  say('── НОРМАЛИЗАЦИЯ КОДОВ (ТЗ) ────────────────────────────────');
  say(`Правило: ${normalization.rule}`);
  say('Примеры ТЗ:');
  normalization.tzExamples.forEach((r) => say(`   ${r.input} → ${r.code ?? 'НЕ СОБИРАЕТСЯ'}${r.unknown.length ? ' (неизвестно: ' + r.unknown.join(', ') + ')' : ''}${r.changed ? '' : ' (без изменений)'}`));
  say(`Код-подобные строки в данных: ${normalization.codeLikeInData.length ? normalization.codeLikeInData.map((r) => `${r.input}→${r.code ?? '?'}`).join(', ') : 'не найдены (в данных направления текстовые: Китай/Турция/…)'}`);
  say(`Предложенные коды групп: ${normalization.proposedCodes.map((r) => `${r.input}→${r.code ?? '?'}`).join(', ') || '—'}`);
  say(`Неизвестные токены (на решение владельца): ${normalization.unknownTokens.length ? normalization.unknownTokens.join(', ') : 'нет'}`);
  say('');
  say('── КОНФЛИКТЫ С СУЩЕСТВУЮЩИМИ СПРАВОЧНИКАМИ ────────────────');
  existingConflicts.directoriesDirections.forEach((e) => say(`   directories/directions/${e.key}: «${e.label}» coeff=${e.coeff ?? '—'}${e.issues.length ? ' — ' + e.issues.join('; ') : ''}`));
  say(`   directories/tripDirections: ${existingConflicts.tripDirectionsEmpty ? 'пуст' : 'есть записи'}; ${existingConflicts.note}`);
  say(`   Дубликатов создать нельзя: ${existingConflicts.wouldCreateDuplicates.map((d) => `«${d.direction}» уже в [${d.existingIds.join(', ')}]`).join('; ') || 'нет'}`);
  say('');
  say('── ПРЕДЛОЖЕННЫЕ ЗАПИСИ `directions` (черновик) ────────────');
  proposedRecords.forEach((r) => say(`   {id: ${r.id}, code: ${r.code ?? 'null'}, name: ${r.name}, from: ${r.fromCountry ?? 'null'}, to: ${r.toCountry ?? 'null'}, plannedRate: ${r.plannedRate ?? 'null'}, plannedCosts: ${r.plannedCosts ?? 'null'}, plannedDays: ${r.plannedDays ?? 'null'}, bufferDays: null, active: true}`));
  say('');
  say(`[migrate-directions] JSON записан: ${file} (и ${latest}). Записей в базу — 0 (dry-run).`);
  console.log(L.join('\n'));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error('[migrate-directions] ошибка:', (e as Error)?.message || e);
    process.exit(1);
  });

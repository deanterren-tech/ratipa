/**
 * Вычистка СВЯЗОК из справочника `cities` — владелец: «в справочнике городов
 * связки убери, нужны чисто города».
 *
 * Связка — одна запись, в названии которой НЕСКОЛЬКО мест: два пункта пропуска
 * через дефис («Брузги — Кузница»), список городов («Батайск - Можайск - …»),
 * маршрут («3 Круга Ч/з КЗ», «Минск — Москва М1»), скобочное уточнение
 * («Стамбул (Сарпи)», «Красная Горка (Смоленская Таможня)») либо город с
 * пометкой региона («Дзержинск, РБ»). Такие записи лезут в автодополнение
 * наравне с городами.
 *
 * Что делает:
 *  1. СКОБКИ («Стамбул (Сарпи)», «ПТО Брузги (Гродненская Таможня)»): основное
 *     место — до скобок; уточнение уходит в алиасы (полный текст остаётся
 *     находимым поиском). Если запись с таким названием уже есть — записи
 *     СЛИВАЮТСЯ (алиасы и usageCount суммируются, ссылки cityId переводятся).
 *     Описания маршрута в скобках («сборка Ч/з …») в алиасы не попадают.
 *  2. ПАРА («X — Y» / «X / Y» / «X - Y»): обе половины становятся отдельными
 *     записями (существующие переиспользуются, в том числе по вхождению слова:
 *     «Франкфурт» → «Франкфурт-На-Одере», «Ларс» → «Верхний Ларс»; отсутствующие
 *     создаются с типом и страной связки), связка удаляется.
 *  3. ПОМЕТКА РЕГИОНА («Дзержинск, РБ», «Ногинск, МО»): запись переименовывается
 *     в чистое название, старая форма уходит в aliases; при однозначном соседе —
 *     слияние.
 *  4. МУСОР (маршруты, «сборка», «ТО …», три и более мест, «ТК …»): удаляется без
 *     создания половин — это не места.
 *  5. СЛОЖНЫЕ АЛИАСЫ («Sochi - Soci», «Beysehir / Mistheia»): разделяются на
 *     отдельные алиасы; форма-дубликат («Azov - Azov») убирается.
 *
 * Текст в записях рейсов не переписывается (правило владельца): правятся только
 * справочник и ссылки cityId, ведущие на удаляемые записи.
 *
 * Режимы:
 *   npx tsx scripts/strip-city-chains.ts                # сухой прогон (по умолчанию)
 *   npx tsx scripts/strip-city-chains.ts --apply --yes  # запись с бэкапом
 *   npx tsx scripts/strip-city-chains.ts --verify       # проверка после применения
 */
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { adminDb } from '../firebaseAdmin.ts';
import { normalizeCityName, citySlug } from '../src/utils/cityDirectory.ts';

const ARGS = process.argv.slice(2);
const APPLY = ARGS.includes('--apply');
const SAY_YES = ARGS.includes('--yes');
const VERIFY = ARGS.includes('--verify');

const OUT_DIR = '/Users/sergei/.hermes/cache/scratch/city-chains';
mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const log = (s: string): void => console.log(s);

interface CityRec {
  id?: string;
  name?: string;
  country?: string;
  type?: string;
  aliases?: string[];
  geonameId?: number;
  lat?: number;
  lng?: number;
  population?: number;
  usageCount?: number;
  source?: string;
  createdAt?: string;
  [k: string]: unknown;
}

/** Разделители связи: тире/слэш/стрелка/точка-разделитель/запятая/«и»/точка с запятой. */
const CHAIN_RE = /[→]|(?:^|\S)\s[—–/\\|·•]\s|\s-\s|,\s|(\s|^)[иИ](\s|$)|;\s|Ч\/з|сборка|круга/i;
/** Маркеры, при которых запись не место, а описание маршрута/пометка.
 *  Без \b: границы слов не работают для кириллицы. */
const JUNK_RE = /Ч\/з|сборка|(^|\s)\d+(\s|$)|(^|\s)ТО(\s|$)|(^|\s)ТК(\s|$)|(^|\s)М1(\s|$)/i;
/** Пометка региона/страны в хвосте: «, РБ», «, МО», «, TR». */
const REGION_RE = /^(мо|м\.о\.|рб|уз|нов|рф|кз|tr|ge|by|kz|ar|az|ru|ру|китай|турция|казахстан|россия|беларусь)$/i;

/**
 * Деление названия на отдельные места. Тонкость: дефис — разделитель только когда
 * рядом пробел («Можайск- Гомель»), иначе он часть названия города
 * («Усть-Каменогорск», «Каменный Лог» не считается дефисом вовсе).
 */
const splitParts = (name: string): string[] => {
  const normalized = name
    .replace(/\s-\s/g, ' — ')
    .replace(/-\s/g, ' — ')
    .replace(/\s-/g, ' — ')
    .replace(/(\s|^)[иИ](\s|$)/g, '$1—$2');
  return normalized
    .split(/[—–]|→|,|\s\/\s|;/)
    .map((p) => p.replace(/\s+/g, ' ').replace(/^[-—–/·\s]+|[-—–/·\s]+$/g, '').trim())
    .filter(Boolean);
};

type Action = 'pair' | 'region' | 'paren' | 'junk';

interface Op {
  id: string;
  name: string;
  action: Action;
  /** Итоговое название записи (для region/paren) или '' при удалении. */
  renameTo?: string;
  /** Алиасы, которые добавляются. */
  addAliases?: string[];
  /** Половины пары: имя → id (существующий или новый). */
  parts?: Array<{ name: string; id: string; existing: boolean }>;
  /** id, в который сливаем (существующая запись) — если найден. */
  mergeInto?: string;
  /** Создаваемые записи. */
  creates?: Array<{ id: string; data: CityRec }>;
  /** Перевод ссылок: старый id → новый id. */
  refMap?: Record<string, string>;
  delete: boolean;
  note: string;
}

const db = adminDb;
const raw = (await db.ref('cities').get()).val() as Record<string, CityRec> | null;
const cities: Record<string, CityRec> = raw || {};
const all = Object.entries(cities);
log(`[chains] Записей в справочнике: ${all.length}`);

const byNorm = new Map<string, string[]>();
all.forEach(([id, c]) => {
  const n = normalizeCityName(String(c?.name || ''));
  if (!n) return;
  if (!byNorm.has(n)) byNorm.set(n, []);
  byNorm.get(n)!.push(id);
});
const idsTaken = new Set(Object.keys(cities));

/** Цепочка городов через дефис БЕЗ пробелов: «Батайск-Ростов-Минск-Дзержинск-Минск».
 *  Настоящие дефисные названия не задеваем: у них части короче («Ак-Джар»,
 *  «Ростов-на-Дону») или частей меньше трёх («Усть-Каменогорск»). */
const isBareChain = (name: string): boolean => {
  if (!name || name.includes(' ')) return false;
  const parts = name.split('-').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 3 && parts.every((p) => p.length >= 4 && !/^\d+$/.test(p));
};

/** Связка = название с разделителем, скобочным уточнением либо цепочка через дефис. */
const isCombo = (name: string): boolean => !!name && (CHAIN_RE.test(name) || name.includes('(') || isBareChain(name));
const allChainIds = new Set(all.filter(([, c]) => isCombo(String(c?.name || '').trim())).map(([id]) => id));

/** «Свободный» ключ сравнения: регистр, «ё» и пунктуация не важны. */
const looseKey = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();

/**
 * Существующая запись для отдельного места: точное совпадение по нормализованному
 * имени, иначе — вхождение целым словом («Франкфурт» → «Франкфурт-На-Одере»,
 * «Ларс» → «Верхний Ларс»). Неоднозначность — не угадываем (null → создадим/оставим).
 */
const findExistingPart = (part: string, excludeId: string): string | null => {
  const norm = normalizeCityName(part);
  const exact = (byNorm.get(norm) || []).filter((x) => x !== excludeId && !allChainIds.has(x));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  if (norm.length < 4) return null;
  const loose = looseKey(part);
  const cands = all.filter(([tid, c]) => {
    if (tid === excludeId || allChainIds.has(tid)) return false;
    const n = looseKey(String(c?.name || ''));
    return n === loose || n.endsWith(` ${loose}`) || n.startsWith(`${loose} `) || n.startsWith(`${loose}-`);
  });
  if (!cands.length) return null;
  if (cands.length === 1) return cands[0][0];
  // Неоднозначность («Ларс» → «Верхний Ларс» / «В. Ларс»): берём запись с явно
  // большим использованием, а при равенстве — не-таможенную. Иначе не угадываем.
  const sorted = [...cands].sort((a, b) => Number(b[1]?.usageCount || 0) - Number(a[1]?.usageCount || 0));
  const best = sorted[0];
  const second = sorted[1];
  if (Number(best[1]?.usageCount || 0) > Number(second[1]?.usageCount || 0)) return best[0];
  const notCustoms = sorted.find(([, c]) => String(c?.type || '') !== 'таможня');
  const onlyCustoms = sorted.filter(([, c]) => String(c?.type || '') === 'таможня');
  return notCustoms && onlyCustoms.length === sorted.length - 1 ? notCustoms[0] : null;
};

/** Скобочная связка: «Стамбул (Сарпи)» → base «Стамбул», tail «Сарпи». */
const parenSplit = (name: string): { base: string; tail: string } | null => {
  const m = name.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { base: m[1].trim(), tail: m[2].trim() } : null;
};

// ── План ───────────────────────────────────────────────────────────────────
const ops: Op[] = [];
const chainIds = allChainIds;
/** Половины, уже созданные в этом прогоне (loose-ключ → id): повторные связки
 *  («Котловка — Лаворишкес» и «Котловка / Лаворишкес») не создают дублей. */
const createdParts = new Map<string, string>();

all.forEach(([id, c]) => {
  const name = String(c?.name || '').trim();
  if (!isCombo(name)) return;
  const country = String(c?.country || '');
  const type = String(c?.type || 'город');
  const usage = Number(c?.usageCount || 0);
  const source = String(c?.source || 'migration');

  const op: Op = { id, name, action: 'junk', delete: true, note: '' };
  const parts = splitParts(name);
  const pr = parenSplit(name);

  // 1. СКОБКИ: «X (уточнение)» — основное место идёт до скобок, уточнение уходит
  //    в алиасы (полный текст сохраняется для поиска), связка не остаётся.
  //    Если в скобках описание маршрута («сборка Ч/з …») — такие хвосты в алиасы
  //    не попадают, а запись сливается с основным местом.
  if (pr && pr.base.length >= 3 && !CHAIN_RE.test(pr.base) && !JUNK_RE.test(pr.base)) {
    const target = findExistingPart(pr.base, id);
    // В алиасы — полный текст («Стамбул (Сарпи)» остаётся находимым поиском) и,
    // ТОЛЬКО если в скобках перечислены варианты одного места, — сами варианты.
    // Внутренние названия ДРУГИХ мест в алиасы не попадают: «Москва (Подольск)»
    // не должна делать «Подольск» алиасом Москвы. Маршрутные пометки («сборка
    // Ч/з …») не переносим вовсе.
    const junkName = JUNK_RE.test(name);
    const variants = /[/—–]/.test(pr.tail) && !junkName ? splitParts(pr.tail).filter((t) => !JUNK_RE.test(t)) : [];
    const aliases = [...(junkName ? [] : [name]), ...variants];
    op.action = 'paren';
    op.addAliases = aliases;
    op.delete = false;
    if (target) {
      op.mergeInto = target;
      op.refMap = { [id]: target };
      op.note = `скобочная связка → слияние с «${cities[target]?.name}»${aliases.length ? ` (в алиасы: ${aliases.join(', ')})` : ''}`;
    } else {
      op.renameTo = pr.base;
      op.note = `скобочная связка → «${pr.base}»${aliases.length ? ` (в алиасы: ${aliases.join(', ')})` : ''}`;
    }
    ops.push(op);
    return;
  }

  // 2. МУСОР: маршруты и пометки — не места (пар и скобок тут уже нет).
  if (JUNK_RE.test(name) || isBareChain(name) || parts.length >= 3) {
    op.action = 'junk';
    op.delete = true;
    op.note = isBareChain(name)
      ? `цепочка городов через дефис (частей ${name.split('-').length}) — удаляется`
      : `не место (частей ${parts.length}${JUNK_RE.test(name) ? ', маркер маршрута/пометки' : ''}) — удаляется`;
    ops.push(op);
    return;
  }

  // 3. Пометка региона в хвосте: «Дзержинск, РБ».
  const comma = name.match(/^(.*?),\s*([^,]+)$/);
  if (comma && REGION_RE.test(comma[2].trim())) {
    const base = comma[1].trim();
    const candidates = (byNorm.get(normalizeCityName(base)) || []).filter((x) => x !== id && !allChainIds.has(x));
    const sameCountry = candidates.filter((x) => String(cities[x]?.country || '') === country || !country);
    op.action = 'region';
    op.renameTo = base;
    op.addAliases = [`${base}, ${comma[2].trim()}`];
    op.delete = false;
    if (candidates.length === 1 || sameCountry.length === 1) {
      const target = sameCountry[0] || candidates[0];
      op.mergeInto = target;
      op.refMap = { [id]: target };
      op.note = `пометка региона снята, слияние с «${cities[target]?.name}» (страна ${cities[target]?.country || '—'})`;
    } else {
      op.note = `пометка региона снята (кандидатов на слияние: ${candidates.length})`;
    }
    ops.push(op);
    return;
  }

  // 4. Пара из двух мест: обе половины — отдельные записи.
  if (parts.length === 2 && parts.every((p) => p.length >= 3 && !JUNK_RE.test(p))) {
    op.action = 'pair';
    op.delete = true;
    const creates: Array<{ id: string; data: CityRec }> = [];
    const list: Array<{ name: string; id: string; existing: boolean }> = [];
    let primaryId = '';
    parts.forEach((part, idx) => {
      const key = looseKey(part);
      const found = createdParts.get(key) || findExistingPart(part, id);
      if (found) {
        list.push({ name: part, id: found, existing: true });
        if (idx === 0) primaryId = found;
        return;
      }
      let newId = citySlug(part) || `part-${idx}-${id}`;
      if (idsTaken.has(newId)) newId = `${newId}-${citySlug(id) || idx}`;
      idsTaken.add(newId);
      const data: CityRec = {
        id: newId,
        name: part,
        country,
        type,
        aliases: [],
        usageCount: idx === 0 ? usage : 0,
        source,
        createdAt: new Date().toISOString(),
      };
      creates.push({ id: newId, data });
      createdParts.set(key, newId);
      list.push({ name: part, id: newId, existing: false });
      if (idx === 0) primaryId = newId;
    });
    op.parts = list;
    op.creates = creates;
    if (primaryId && primaryId !== id) op.refMap = { [id]: primaryId };
    op.note = `пара распадается: ${list.map((l) => `${l.name}${l.existing ? ' (есть)' : ' (создать)'}`).join(' + ')}`;
    ops.push(op);
    return;
  }

  op.note = 'связка удаляется (половины не распознаны как места)';
  ops.push(op);
});

// ── Сложные алиасы (не в названии, а в aliases) ────────────────────────────
interface AliasFix {
  id: string;
  name: string;
  before: string[];
  after: string[];
}
const aliasFixes: AliasFix[] = [];
/** Маркер-пометка в алиасе («Стамбул (сборка)»): из справочника убираем —
 *  владелец просил чисто города, а такие формы пришли из слияний связок. */
const JUNK_ALIAS_RE = /сборка|Ч\/з/i;
/** Обломок скобочной формы («Варшавский Мост (Малашевиче», «Корощин)») — мусор. */
const brokenParenAlias = (a: string): boolean => {
  const open = (a.match(/\(/g) || []).length;
  const close = (a.match(/\)/g) || []).length;
  return open !== close || /\(\s*$/.test(a) || /^\s*\)/.test(a);
};
all.forEach(([id, c]) => {
  const list = Array.isArray(c?.aliases) ? c!.aliases!.map((a) => String(a)) : [];
  if (!list.length) return;
  const junkForms = list.filter((a) => JUNK_ALIAS_RE.test(a) || brokenParenAlias(a));
  const bad = list.filter((a) => /\s[-–/]\s/.test(a));
  if (!bad.length && !junkForms.length) return;
  const keep = list.filter((a) => !/\s[-–/]\s/.test(a) && !JUNK_ALIAS_RE.test(a) && !brokenParenAlias(a));
  const split: string[] = [];
  bad.forEach((a) => {
    a.split(/\s[-–/]\s/).forEach((p) => {
      const t = p.trim();
      if (!t) return;
      if (normalizeCityName(t) === normalizeCityName(String(c?.name || ''))) return; // форма-дубликат имени
      if (keep.some((k) => normalizeCityName(k) === normalizeCityName(t))) return;
      if (split.some((k) => normalizeCityName(k) === normalizeCityName(t))) return;
      split.push(t);
    });
  });
  const after = [...keep, ...split];
  if (JSON.stringify(after) !== JSON.stringify(list)) aliasFixes.push({ id, name: String(c?.name || ''), before: list, after });
});

// ── Отчёт ──────────────────────────────────────────────────────────────────
const byAction = ops.reduce<Record<string, number>>((acc, o) => {
  acc[o.action] = (acc[o.action] || 0) + 1;
  return acc;
}, {});
log(`\n[chains] Связок найдено: ${ops.length} (пара ${byAction.pair || 0}, регион ${byAction.region || 0}, скобки ${byAction.paren || 0}, мусор ${byAction.junk || 0})`);
log(`[chains] Сложных алиасов к очистке: ${aliasFixes.length}`);
ops.forEach((o) => log(`  · [${o.action}] ${o.name} — ${o.note}`));

// Ссылки cityId на удаляемые записи (в данных портала) + перевод.
const REF_BRANCHES = [
  'routedesk',
  'trips_dashboard',
  'tripTimeline/tripStages',
  'tripTimeline/trips',
  'ratipa_loading_plan',
  'knownDistancesList',
  'driverTasks',
  'archive',
  'current_trips',
  'baza',
];
const refHits: Array<{ path: string; oldId: string; newId: string | null }> = [];
const walk = (node: unknown, path: string): void => {
  if (Array.isArray(node)) {
    // В RTDB массивы — узлы с числовыми ключами: путь `.../customs/4`, а не `.../customs[4]`
    // (квадратные скобки недопустимы в ключе и роняют запись целиком).
    node.forEach((v, i) => walk(v, `${path}/${i}`));
    return;
  }
  if (!node || typeof node !== 'object') return;
  Object.entries(node as Record<string, unknown>).forEach(([k, v]) => {
    if (k === 'cityId' && typeof v === 'string' && chainIds.has(v)) {
      const op = ops.find((o) => o.id === v);
      // Переименование id НЕ меняет — ссылку не трогаем (например, ПТО-посты из
      // справочника routedesk). Переводим только ссылки на сливаемые и удаляемые
      // записи; если переводить некуда — снимаем ссылку (текст остаётся).
      if (!op || (!op.delete && !op.mergeInto)) return;
      refHits.push({ path: `${path}/cityId`, oldId: v, newId: op.mergeInto || op.refMap?.[v] || null });
      return;
    }
    walk(v, `${path}/${k}`);
  });
};
for (const b of REF_BRANCHES) {
  const snap = await db.ref(b).get();
  if (snap.exists()) walk(snap.val(), b);
}
log(`[chains] Ссылок cityId на связки: ${refHits.length}${refHits.length ? ' → ' + refHits.map((r) => `${r.path} → ${r.newId || 'снять'}`).join('; ') : ''}`);

const report = {
  mode: APPLY ? 'apply' : VERIFY ? 'verify' : 'dry-run',
  takenAt: new Date().toISOString(),
  cities: all.length,
  chains: ops.length,
  byAction,
  ops,
  aliasFixes,
  refHits,
};
writeFileSync(join(OUT_DIR, `chains-${APPLY ? 'apply' : VERIFY ? 'verify' : 'dry'}-${stamp}.json`), JSON.stringify(report, null, 1), 'utf8');

// ── Проверка после применения ──────────────────────────────────────────────
if (VERIFY) {
  const left = all.filter(([, c]) => CHAIN_RE.test(String(c?.name || '').trim()));
  const combosLeft = all.filter(([, c]) => isCombo(String(c?.name || '').trim()));
  const aliasLeft = all.filter(([, c]) => (c?.aliases || []).some((a) => /\s[-–/]\s/.test(String(a))));
  log(`\n[chains --verify] Связок в справочнике осталось: ${left.length}`);
  left.slice(0, 20).forEach(([id, c]) => log(`  · ${id} — «${c?.name}»`));
  log(`[chains --verify] Комбинированных записей (в т.ч. со скобками) осталось: ${combosLeft.length}`);
  combosLeft.slice(0, 20).forEach(([id, c]) => log(`  · ${id} — «${c?.name}»`));
  log(`[chains --verify] Сложных алиасов осталось: ${aliasLeft.length}`);
  process.exit(combosLeft.length ? 1 : 0);
}

if (!APPLY) {
  log('\n[chains] Ничего не записано (сухой прогон). Запись — только `--apply --yes`.');
  process.exit(0);
}
if (!SAY_YES) {
  console.error('[chains] --apply без --yes в неинтерактивном запуске: запись отменена.');
  process.exit(1);
}

// ── Запись ──────────────────────────────────────────────────────────────────
const backup: Record<string, unknown> = {};
ops.forEach((o) => {
  backup[`cities/${o.id}`] = cities[o.id];
  if (o.mergeInto && cities[o.mergeInto]) backup[`cities/${o.mergeInto}`] = cities[o.mergeInto];
});
aliasFixes.forEach((a) => {
  if (!backup[`cities/${a.id}`]) backup[`cities/${a.id}`] = cities[a.id];
});
const backupFile = join(OUT_DIR, `chains-backup-${stamp}.json`);
writeFileSync(backupFile, JSON.stringify({ takenAt: new Date().toISOString(), note: 'Записи справочника ДО вычистки связок', cities: backup }, null, 1), 'utf8');
log(`[chains] Бэкап до записи: ${backupFile}`);

const payload: Record<string, unknown> = {};
const nowIso = new Date().toISOString();
ops.forEach((o) => {
  o.creates?.forEach((cr) => {
    payload[`cities/${cr.id}`] = cr.data;
  });
  if (o.mergeInto) {
    const target = { ...(cities[o.mergeInto] || {}) };
    const add = new Set<string>([...(Array.isArray(target.aliases) ? target.aliases : []), ...(o.addAliases || []), o.name]);
    target.aliases = [...add].filter((a) => normalizeCityName(a) !== normalizeCityName(String(target.name || '')));
    target.usageCount = Number(target.usageCount || 0) + Number(cities[o.id]?.usageCount || 0);
    target.updatedAt = nowIso;
    payload[`cities/${o.mergeInto}`] = target;
    payload[`cities/${o.id}`] = null;
    return;
  }
  if (o.renameTo) {
    const rec = { ...(cities[o.id] || {}) };
    const add = new Set<string>([...(Array.isArray(rec.aliases) ? rec.aliases : []), ...(o.addAliases || [])]);
    rec.name = o.renameTo;
    rec.aliases = [...add].filter((a) => normalizeCityName(a) !== normalizeCityName(o.renameTo || ''));
    rec.updatedAt = nowIso;
    payload[`cities/${o.id}`] = rec;
    return;
  }
  payload[`cities/${o.id}`] = null;
});
aliasFixes.forEach((a) => {
  if (payload[`cities/${a.id}`] === undefined) {
    payload[`cities/${a.id}`] = { ...(cities[a.id] || {}), aliases: a.after, updatedAt: nowIso };
  }
});
refHits.forEach((r) => {
  payload[r.path] = r.newId;
});

const entries = Object.entries(payload);
let written = 0;
for (let i = 0; i < entries.length; i += 300) {
  const chunk = Object.fromEntries(entries.slice(i, i + 300));
  await db.ref().update(chunk);
  written += Object.keys(chunk).length;
}
log(`[chains] Записано путей: ${written} (городов изменено/создано/удалено: ${ops.length}, алиасов: ${aliasFixes.length}, ссылок: ${refHits.length})`);

const applied = { mode: 'apply', takenAt: nowIso, backupFile, written, chains: ops.length, byAction, refHits, aliasFixes: aliasFixes.length };
writeFileSync(join(OUT_DIR, `chains-applied-${stamp}.json`), JSON.stringify(applied, null, 1), 'utf8');
log(`[chains] Отчёт: ${join(OUT_DIR, `chains-applied-${stamp}.json`)}`);
if (existsSync(backupFile)) log('[chains] Готово. Проверка: npx tsx scripts/strip-city-chains.ts --verify');
process.exit(0);

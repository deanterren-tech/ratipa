/**
 * Привязка измерений к рейсу: выбор границ анализа и сопоставление рейсов.
 *
 * Рейс — существующая запись «Плана дохода» (trips_dashboard). Параллельный
 * реестр не создаётся. Правило границ (уточнённое ТЗ, п.1):
 *  - фактические даты этапов (если есть начало и окончание) → «Фактические даты этапов»;
 *  - иначе плановые даты → «По плановым границам»;
 *  - незавершённый рейс → от начала до текущего момента, «предварительно»;
 *  - нет/противоречивы → требуем уточнения (произвольный период не подставляем).
 * Даты источника — только дни: точность границ честно помечается как «день»,
 * уточнение (время) доступно уполномоченному сотруднику (override).
 */

import type { BoundsOverride, BoundarySource, TripWindow } from './types';
import { fmtDMY, TZ_OFFSET_MIN } from './format';

export const DAY_MS = 86_400_000;

/** YYYY-MM-DD → номер дня (UTC), как в таймлайне рейсов. */
export const dayNumFromIso = (s?: string | null): number | null => {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
  if (!m) return null;
  const n = Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS);
  return Number.isFinite(n) ? n : null;
};

/** Сегодняшний день (номер, локальная дата пользователя). */
export const todayDayNum = (nowMs: number): number => {
  const d = new Date(nowMs + TZ_OFFSET_MIN * 60_000);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY_MS);
};

/** Начало дня (00:00 в поясе портала) → мс. */
export const dayStartMs = (day: number): number => day * DAY_MS - TZ_OFFSET_MIN * 60_000;
/** Конец дня (23:59:59.999 в поясе портала) → мс. */
export const dayEndMs = (day: number): number => dayStartMs(day + 1) - 1;

/* ─────────────────────────── Сопоставление рейсов машины ─────────────────────────── */

const CYR_TO_LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I',
};
const LAT_TO_CYR: Record<string, string> = Object.fromEntries(Object.entries(CYR_TO_LAT).map(([c, l]) => [l, c]));

const normKey = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
const translit = (s: string, map: Record<string, string>): string => s.split('').map((ch) => map[ch] || ch).join('');

/** Варианты нормализованного номера (как есть + латиница + кириллица). */
export function plateVariants(s: unknown): string[] {
  const raw = String(s ?? '');
  const set = new Set<string>();
  for (const v of [raw, translit(raw, CYR_TO_LAT), translit(raw, LAT_TO_CYR)]) {
    const k = normKey(v);
    if (k) set.add(k);
  }
  return Array.from(set);
}

export interface TripCandidate {
  key: string;
  id: string;
  carNumber: string;
  dateStart: string;
  dateEnd: string;
  archived: boolean;
  needsFill: boolean;
  direction: string;
  dispatcherName: string;
  /** План по километражу (totalKm записи «Плана дохода»). */
  planKm: number | null;
  /** Заявленный/фактический километраж (factKm записи). */
  factKm: number | null;
  raw: Record<string, unknown>;
}

const num = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** Рейсы «Плана дохода» для машины (по вариантам номера; скрытые дубли — вне проверки). */
export function tripsForCar(
  planTrips: Array<Record<string, unknown>>,
  carKey: string,
  carNumber: string,
): TripCandidate[] {
  const wanted = new Set([...plateVariants(carNumber), ...plateVariants(carKey), ...plateVariants(carKey.replace(/^car:/, ''))]);
  const out: TripCandidate[] = [];
  for (const rec of planTrips || []) {
    if (!rec || typeof rec !== 'object' || !rec.id) continue;
    if (rec.hiddenFromTimeline === true) continue;
    const recPlateVariants = plateVariants(rec.carNumber);
    const match = recPlateVariants.some((v) => wanted.has(v));
    if (!match) continue;
    out.push({
      key: `pd:${String(rec.id)}`,
      id: String(rec.id),
      carNumber: String(rec.carNumber || ''),
      dateStart: String(rec.dateStart || ''),
      dateEnd: String(rec.dateEnd || ''),
      archived: rec.isArchived === true,
      needsFill: rec.needsFill === true,
      direction: String(rec.direction || rec.tripNote || ''),
      dispatcherName: String(rec.dispatcherName || rec.dispatcher || ''),
      planKm: num(rec.totalKm),
      factKm: num(rec.factKm),
      raw: rec,
    });
  }
  out.sort((a, b) => {
    const an = dayNumFromIso(a.dateStart) ?? 0;
    const bn = dayNumFromIso(b.dateStart) ?? 0;
    return bn - an || a.key.localeCompare(b.key);
  });
  return out;
}

/** Фактические даты этапов рейса (дни) из store tripStages/<planId>. */
export function factDaysOfStages(stagesStore: Record<string, Record<string, unknown>>, planId: string): number[] {
  const store = stagesStore?.[planId];
  if (!store) return [];
  const days: number[] = [];
  for (const st of Object.values(store)) {
    if (!st || typeof st !== 'object') continue;
    const rec = st as Record<string, unknown>;
    let d = dayNumFromIso(typeof rec.actualDate === 'string' ? rec.actualDate : null);
    if (d == null && typeof rec.actualDate === 'string' && /^\d{4}-\d{2}-\d{2}/.test(rec.actualDate)) {
      d = dayNumFromIso(rec.actualDate.slice(0, 10));
    }
    if (d != null) days.push(d);
  }
  return days;
}

/* ─────────────────────────── Границы анализа (окно рейса) ─────────────────────────── */

export interface TripWindowResolution {
  window: TripWindow | null;
  /** Если не null — анализ не строится: требуем уточнения (текст причины). */
  needClarification: string | null;
}

const SOURCE_LABELS: Record<BoundarySource, string> = {
  fact: 'Фактические даты этапов рейса (день, без времени)',
  plan: 'По плановым границам (дни плана, без времени)',
  plan_current: 'По плановым границам, до текущего момента — предварительно',
  manual: 'Границы уточнены вручную',
};

export function resolveTripWindow(input: {
  candidate: TripCandidate;
  carKey: string;
  factDays: number[];
  override: BoundsOverride | null;
  nowMs: number;
}): TripWindowResolution {
  const { candidate, carKey, factDays, override, nowMs } = input;

  if (override && Number.isFinite(override.fromMs) && Number.isFinite(override.toMs) && override.fromMs < override.toMs) {
    return {
      window: {
        carKey,
        tripKey: candidate.key,
        fromMs: override.fromMs,
        toMs: override.toMs,
        fromPrecision: 'minute',
        toPrecision: 'minute',
        source: 'manual',
        ongoing: override.toMs > nowMs - 60_000,
        fromLabel: fmtDMY(override.fromMs),
        toLabel: fmtDMY(override.toMs),
        sourceLabel: SOURCE_LABELS.manual,
        warnings: [
          `Границы уточнены вручную: ${fmtDMY(override.fromMs)} → ${fmtDMY(override.toMs)}${override.by ? ` (${override.by})` : ''}`,
        ],
      },
      needClarification: null,
    };
  }

  const startDay = dayNumFromIso(candidate.dateStart);
  const endDay = dayNumFromIso(candidate.dateEnd);
  const fMin = factDays.length ? Math.min(...factDays) : null;
  const fMax = factDays.length ? Math.max(...factDays) : null;
  const warnings: string[] = [];

  if (startDay == null && fMin == null) {
    return { window: null, needClarification: 'В рейсе не указана дата старта — период анализа не определён. Уточните даты рейса.' };
  }
  if (startDay != null && endDay != null && endDay < startDay && !(fMin != null && fMax != null && fMax >= fMin)) {
    return { window: null, needClarification: 'Дата окончания раньше даты старта — проверьте даты рейса и уточните период.' };
  }

  const today = todayDayNum(nowMs);
  const factComplete = fMin != null && fMax != null;

  let fromDay: number;
  let toDay: number | null;
  let ongoing: boolean;
  let source: BoundarySource;
  let toPrecision: 'day' | 'minute' = 'day';

  if (factComplete) {
    fromDay = fMin as number;
    toDay = fMax as number;
    ongoing = false;
    source = 'fact';
    if (startDay != null && (fMin as number) < startDay) warnings.push('Фактический старт раньше планового — используются фактические даты.');
    if (endDay != null && (fMax as number) > endDay) warnings.push('Фактическое окончание позже планового — используются фактические даты.');
  } else {
    fromDay = (fMin ?? startDay) as number;
    toDay = endDay;
    ongoing = fMax == null && (endDay == null || endDay >= today);
    source = fMin != null ? 'fact' : ongoing ? 'plan_current' : 'plan';
    if (ongoing) {
      toPrecision = 'minute';
      warnings.push('Рейс не завершён: анализируется период до текущего момента, результаты предварительные.');
    }
    if (!ongoing && endDay == null) {
      return { window: null, needClarification: 'В рейсе нет даты окончания и фактических дат этапов — уточните период анализа.' };
    }
    if (!ongoing && fMin != null && fMax == null) {
      warnings.push('Есть фактический старт, но нет фактического окончания — конец взят по плану.');
    }
  }

  let fromMs = dayStartMs(fromDay);
  let toMs = toDay != null ? dayEndMs(toDay) : nowMs;
  if (ongoing) toMs = nowMs;
  if (toMs <= fromMs) {
    return { window: null, needClarification: 'Границы периода пусты (окончание не позже старта) — уточните даты рейса.' };
  }
  if (!factComplete && !ongoing) {
    warnings.push('Время начала и окончания в источнике не указано (только даты) — возможна погрешность до суток на краях. Время можно уточнить вручную.');
  }
  if (factComplete) {
    warnings.push('Фактические даты этапов указаны без времени — возможна погрешность до суток на краях. Время можно уточнить вручную.');
  }

  return {
    window: {
      carKey,
      tripKey: candidate.key,
      fromMs,
      toMs,
      fromPrecision: 'day',
      toPrecision,
      source,
      ongoing,
      fromLabel: fmtDMY(fromMs),
      toLabel: ongoing ? `${fmtDMY(toMs)} (по текущий момент)` : fmtDMY(toMs),
      sourceLabel: SOURCE_LABELS[source],
      warnings,
    },
    needClarification: null,
  };
}

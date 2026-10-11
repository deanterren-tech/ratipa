/**
 * «История CAN-пробега»: разбор измерений одометра из исторических методов
 * Nav.by и правила их дедупликации.
 *
 * ВСЕ поля и особенности ниже подтверждены ЖИВЫМИ вызовами 11.10.2026
 * (см. отчёт и server/navby/config.ts):
 *
 *  - object-stat-data (окно from..to): отдаёт odom_start/s_odo_dt и
 *    odom_finish/e_odo_dt — начало и конец окна. s_odo_dt/e_odo_dt — epoch
 *    СЕКУНДЫ (UTC), это РЕАЛЬНОЕ время измерения одометра (не граница окна:
 *    для окна 06:00–07:00 получено 06:00:30 и 06:58:34). odom_start/odom_finish —
 *    ЦЕЛЫЕ километры (округление источника; точность помечается km_int).
 *    Если в окне машина не двигалась — API отдаёт 0/null (не «ноль км!») —
 *    такие значения НЕ превращаются в измерения.
 *  - city-or-track (can_needed=true): сегменты; у сегментов движения есть
 *    start_odometer/end_odometer (float км) и start_date/end_date в формате
 *    «DD.MM.YYYY HH:MM:SS» (пояс +03). У стоянок (in_motion=0) одометра нет.
 *    Границы сегментов — реальные времена измерений; смежные сегменты дают
 *    общую границу (t, v) — дедупликация по идентичности измерения.
 *  - parking-movement-report: интервалы стоянка/движение, s_odo_can/e_odo_can
 *    (float км) на границах; date_start/date_end «YYYY-MM-DD HH:MM:SS» (+03).
 *    В живом ответе s_odo_dt/e_odo_dt ОТСУТСТВУЮТ (проверено — не добавлять
 *    по документации).
 *  - get-plan-fact: у аккаунта 403 — источник не предоставляет данные.
 *
 * Чистые функции без сети и БД (покрыты scripts/test-can-series.ts).
 */

import {
  NAVBY_CAN_SOURCES,
  NAVBY_CAN_SRC_TAG,
  NAVBY_ODO_UNIT,
  navbyDayKey,
  navbyTimeKey,
  parseNavbyDateTimeToMs,
  type NavbyCanPrecision,
  type NavbyCanSource,
} from './config.ts';
import { toNum, toStr } from './parse.ts';

/** Нормализованное измерение одометра для хранения. */
export interface CanMeasurement {
  /** Время измерения в источнике (UTC мс); null — время измерения неизвестно. */
  measuredAtMs: number | null;
  /** Значение одометра, км. Всегда > 0 (ноль/пусто = «нет данных», не пробег 0). */
  valueKm: number;
  /** Подтверждённый источник (метод API). */
  source: NavbyCanSource;
  /** Точность значения: km_int — целые км, km_3dec — исходный float. */
  precision: NavbyCanPrecision;
  /** Время получения порталом (ISO) — НЕ выдаётся за время измерения. */
  receivedAt: string;
  /** object_id / IMEI объекта, к которому относится измерение. */
  objectId: string | null;
  imei: string | null;
}

/** Узел RTDB измерения (компактные имена полей — история длинная). */
export interface CanMeasurementNode {
  /** value km */
  v: number;
  u: string;
  /** measuredAtMs */
  tMs: number;
  src: string;
  q: NavbyCanPrecision;
  /** receivedAt ISO (первое) */
  rAt: string;
  /** receivedAt ISO последнего повторного получения (если было) */
  rAt2?: string;
  obj: string | null;
  imei: string | null;
}

/** Ключ измерения в дне: HHMMSSmmm_<tag> (сортируется по времени). */
export function canMeasurementNodeKey(m: CanMeasurement): string {
  const tag = NAVBY_CAN_SRC_TAG[m.source] || 'x';
  const ms = m.measuredAtMs ?? 0;
  return `${navbyTimeKey(ms)}_${tag}`;
}

/**
 * Идентичность измерения для дедупликации: источник + ВРЕМЯ измерения.
 * Повтор того же измерения из API (та же пара) — не новая точка;
 * одинаковое значение с новым достоверным временем — валидная новая точка.
 */
export function canMeasurementIdentity(source: string, measuredAtMs: number | null): string {
  return `${source}|${measuredAtMs ?? 'na'}`;
}

/** Разбор строки «DD.MM.YYYY HH:MM:SS» (формат city-or-track) в мс UTC (+03). */
export function parseNavbyDottedDateTimeToMs(s: unknown): number | null {
  const str = toStr(s);
  if (!str) return null;
  const m = str.match(/^(\d{2})\.(\d{2})\.(\d{4})[ T](\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, d, mo, y, h, mi, se] = m;
  return parseNavbyDateTimeToMs(`${y}-${mo}-${d} ${h}:${mi}:${se}`);
}

export interface ParseCtx {
  objectId: string | null;
  imei: string | null;
  receivedAt: string;
}

/**
 * Измерения из одного элемента ответа object-stat-data (за окно from..to).
 * Отсутствующие/нулевые значения и отсутствующие времена — не измерения.
 */
export function measurementsFromStatItem(raw: Record<string, unknown>, ctx: ParseCtx): CanMeasurement[] {
  const out: CanMeasurement[] = [];
  const push = (valueRaw: unknown, tRaw: unknown): void => {
    const value = toNum(valueRaw);
    if (value == null || value <= 0) return; // 0/null = «данных в окне нет»
    const sec = toNum(tRaw);
    if (sec == null || sec <= 0) return; // без времени измерения точку не храним
    const measuredAtMs = Math.round(sec * 1000);
    if (!Number.isFinite(measuredAtMs) || measuredAtMs <= 0) return;
    out.push({
      measuredAtMs,
      valueKm: value,
      source: NAVBY_CAN_SOURCES.statWindow,
      precision: 'km_int',
      receivedAt: ctx.receivedAt,
      objectId: ctx.objectId,
      imei: ctx.imei,
    });
  };
  push(raw.odom_start, raw.s_odo_dt);
  push(raw.odom_finish, raw.e_odo_dt);
  return out;
}

/**
 * Измерения из одного элемента ответа city-or-track: границы сегментов
 * движения. Стояночные сегменты одометра не содержат; смежная граница
 * (конец одного = начало другого) дедуплицируется по идентичности.
 */
export function measurementsFromCityTrackItem(raw: Record<string, unknown>, ctx: ParseCtx): CanMeasurement[] {
  const out: CanMeasurement[] = [];
  const segs = Array.isArray(raw.data) ? raw.data : [];
  for (const entry of segs) {
    const seg = (entry || {}) as Record<string, unknown>;
    if (toNum(seg.in_motion) !== 1) continue; // стоянки одометра не отдают
    const pairs: Array<[unknown, unknown]> = [
      [seg.start_odometer, seg.start_date],
      [seg.end_odometer, seg.end_date],
    ];
    for (const [vRaw, tRaw] of pairs) {
      const value = toNum(vRaw);
      if (value == null || value <= 0) continue;
      const measuredAtMs = parseNavbyDottedDateTimeToMs(tRaw);
      if (measuredAtMs == null) continue;
      out.push({
        measuredAtMs,
        valueKm: value,
        source: NAVBY_CAN_SOURCES.citySegment,
        precision: 'km_3dec',
        receivedAt: ctx.receivedAt,
        objectId: ctx.objectId,
        imei: ctx.imei,
      });
    }
  }
  return out;
}

/** Измерения из нормализованного отчёта «Стоянка-движение» (интервалы). */
export function measurementsFromParkingIntervals(
  intervals: Array<{ startMs: number; endMs: number; startOdoKm: number | null; endOdoKm: number | null }>,
  ctx: ParseCtx,
): CanMeasurement[] {
  const out: CanMeasurement[] = [];
  for (const iv of intervals) {
    const pairs: Array<[number | null, number]> = [
      [iv.startOdoKm, iv.startMs],
      [iv.endOdoKm, iv.endMs],
    ];
    for (const [value, measuredAtMs] of pairs) {
      if (value == null || value <= 0) continue;
      if (!Number.isFinite(measuredAtMs) || measuredAtMs <= 0) continue;
      out.push({
        measuredAtMs,
        valueKm: value,
        source: NAVBY_CAN_SOURCES.parkingSegment,
        precision: 'km_3dec',
        receivedAt: ctx.receivedAt,
        objectId: ctx.objectId,
        imei: ctx.imei,
      });
    }
  }
  return out;
}

/**
 * Дедупликация списка измерений по идентичности (источник+время).
 * Повтор с тем же значением отбрасывается (признак повтора — rAt2);
 * повтор с ДРУГИМ значением считается уточнением источника и берётся
 * последним (с пометкой rAt2 — «пересмотрено источником»).
 */
export function dedupeCanMeasurements(list: CanMeasurement[]): CanMeasurement[] {
  const byId = new Map<string, CanMeasurement>();
  const order: string[] = [];
  for (const m of list) {
    const id = canMeasurementIdentity(m.source, m.measuredAtMs);
    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, m);
      order.push(id);
    } else if (prev.valueKm !== m.valueKm) {
      byId.set(id, { ...m, receivedAt: prev.receivedAt }); // сохраняем первое получение, значение — свежее
    }
  }
  return order.map((id) => byId.get(id) as CanMeasurement);
}

/** Отсортированные измерения (поздние/догоняющие данные встают на место). */
export function sortCanMeasurements(list: CanMeasurement[]): CanMeasurement[] {
  return [...list].sort((a, b) => (a.measuredAtMs ?? 0) - (b.measuredAtMs ?? 0) || (a.source > b.source ? 1 : a.source < b.source ? -1 : 0));
}

/** Узел RTDB из измерения. */
export function toCanNode(m: CanMeasurement): CanMeasurementNode {
  return {
    v: Math.round(m.valueKm * 1000) / 1000,
    u: NAVBY_ODO_UNIT,
    tMs: m.measuredAtMs as number,
    src: m.source,
    q: m.precision,
    rAt: m.receivedAt,
    obj: m.objectId,
    imei: m.imei,
  };
}

/** Обратный разбор узла RTDB (null — узел непригоден). */
export function fromCanNode(key: string, raw: Record<string, unknown> | null | undefined): CanMeasurement | null {
  if (!raw) return null;
  const value = toNum(raw.v);
  if (value == null || value <= 0) return null;
  const measuredAtMs = toNum(raw.tMs);
  if (measuredAtMs == null || measuredAtMs <= 0) return null;
  const src = toStr(raw.src) || srcTagToSource(key.split('_').pop() || '');
  if (!src) return null;
  const q = toStr(raw.q) === 'km_int' ? 'km_int' : 'km_3dec';
  return {
    measuredAtMs,
    valueKm: value,
    source: src as NavbyCanSource,
    precision: q,
    receivedAt: toStr(raw.rAt) || '',
    objectId: toStr(raw.obj),
    imei: toStr(raw.imei),
  };
}

function srcTagToSource(tag: string): string | null {
  for (const [src, t] of Object.entries(NAVBY_CAN_SRC_TAG)) if (t === tag) return src;
  return null;
}

/** Сводка покрытия дня измерениями — для различения состояний в UI. */
export interface CanDayCoverage {
  points: number;
  firstMs: number | null;
  lastMs: number | null;
  sources: string[];
}

export function coverageOfDay(points: Array<{ measuredAtMs: number | null; source: string }>): CanDayCoverage {
  const withTime = points.filter((p) => p.measuredAtMs != null);
  const sources = Array.from(new Set(points.map((p) => p.source))).sort();
  return {
    points: points.length,
    firstMs: withTime.length ? Math.min(...withTime.map((p) => p.measuredAtMs as number)) : null,
    lastMs: withTime.length ? Math.max(...withTime.map((p) => p.measuredAtMs as number)) : null,
    sources,
  };
}

/** День (ключ YYYYMMDD в поясе +03) измерения. */
export function dayKeyOfMeasurement(m: CanMeasurement): string | null {
  return m.measuredAtMs == null ? null : navbyDayKey(m.measuredAtMs);
}

/**
 * Полные часы, которые надо догрузить с последнего съёма до now:
 * [lastSweep, now) разбитый по границам часов, последний закрытый час.
 * Максимум maxWindows (свежие в приоритете).
 */
export function missingStatWindows(lastSweepMs: number | null, nowMs: number, windowMin: number, maxWindows: number): Array<{ fromMs: number; toMs: number }> {
  const hour = 3_600_000;
  const alignedNow = Math.floor(nowMs / hour) * hour; // начало текущего часа — последний закрытый интервал кончается здесь
  if (alignedNow <= 0) return [];
  const from = Math.max(lastSweepMs ?? alignedNow - windowMin * 60_000, 0);
  // Пропускаем только полностью завершённые окна: куски длиной windowMin.
  const windows: Array<{ fromMs: number; toMs: number }> = [];
  let t = from;
  // Если последний съём был в середине часа, первое окно — до конца того часа.
  while (t < alignedNow) {
    const next = Math.min(Math.ceil((t + 1) / hour) * hour, alignedNow);
    windows.push({ fromMs: t, toMs: next });
    t = next;
  }
  return windows.slice(-Math.max(1, maxWindows));
}

/** Дни (ключи YYYYMMDD, пояс +03), которые нужно догрузить: последние days полных суток. */
export function recentFullDays(nowMs: number, days: number): Array<{ dayKey: string; fromMs: number; toMs: number }> {
  const day = 86_400_000;
  const out: Array<{ dayKey: string; fromMs: number; toMs: number }> = [];
  const todayStart = Math.floor((nowMs + 180 * 60_000) / day) * day - 180 * 60_000; // начало суток +03
  for (let i = 1; i <= Math.max(1, days); i += 1) {
    const fromMs = todayStart - i * day;
    const toMs = fromMs + day - 1;
    out.push({ dayKey: navbyDayKey(fromMs), fromMs, toMs });
  }
  return out;
}

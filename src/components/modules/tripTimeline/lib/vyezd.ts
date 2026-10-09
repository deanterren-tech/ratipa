/**
 * «Учёт выезда» ↔ таймлайн: единая точка перехода и статусы периода.
 *
 * Здесь живёт ОДИН общий хелпер «открыть учёт выезда (машина, период)» —
 * им пользуются все места: полосы таймлайна, встроенный таймлайн карточек,
 * обзор машины, окно периода. Логика перехода не копируется.
 *
 * Переход — это hash-маршрут приложения (второй роутер не создаётся):
 *   #baza/vyezd/<id записи baza>[?car=<ключ машины>]  — окно конкретного периода
 *   #baza/vyezd/car/<ключ машины>[?no=<номер>]        — без id: ближайший период
 *   #baza                                             — полный «Учёт выезда»
 * Прямая загрузка URL восстанавливает то же окно; «Назад» браузера возвращает
 * на предыдущий экран (таймлайн — в прежней позиции прокрутки и масштабе:
 * вид и прокрутка таймлайна сохраняются существующими механизмами модуля).
 *
 * Статусы периода считаются по СУЩЕСТВУЮЩИМ функциям источников
 * (baseBarRange / baseDeviation): данные и бизнес-логика не меняются.
 *   - «учёт ведётся»          — период открыт, срок готовности ещё не прошёл;
 *   - «период закрыт»         — фактический выезд указан;
 *   - «выезд не зафиксирован» — срок готовности прошёл, выезда нет;
 *   - «расхождение с рейсом»  — период пересекается с рейсом машины (кроме
 *     честного стыка: рейс завершился в день приезда / начался в день выезда).
 */
import { CircleCheck, CircleDashed, Hourglass, TriangleAlert, type LucideIcon } from 'lucide-react';
import { baseBarRange, baseDeviation, repairBarRange, type BasePeriod, type WholeTrip } from './sources';
import { fmtDM, tripSpan } from './timeline';

// ---------------------------------------------------------------------------
// Единый хелпер «открыть учёт выезда (машина, период)»
// ---------------------------------------------------------------------------

export interface VyezdTarget {
  /** id записи ветки baza (BasePeriod.id). */
  periodId?: string | null;
  /** Ключ строки машины (carKeyOf) — для запасного перехода без id записи. */
  carKey?: string | null;
  /** Госномер — только для человекочитаемых подписей/URL. */
  carNumber?: string | null;
}

/** Hash окна периода; null — переходить некуда (нет ни id, ни машины). */
export const vyezdHashOf = (t: VyezdTarget): string | null => {
  const periodId = String(t.periodId || '').trim();
  if (periodId) {
    const car = String(t.carKey || '').trim();
    return `#baza/vyezd/${encodeURIComponent(periodId)}${car ? `?car=${encodeURIComponent(car)}` : ''}`;
  }
  const carKey = String(t.carKey || '').trim() || String(t.carNumber || '').trim();
  if (!carKey) return null;
  const num = String(t.carNumber || '').trim();
  return `#baza/vyezd/car/${encodeURIComponent(carKey)}${num ? `?no=${encodeURIComponent(num)}` : ''}`;
};

/**
 * ОТКРЫТЬ УЧЁТ ВЫЕЗДА (машина, период) — единая точка для всех ссылок.
 * Добавляет запись истории: «Назад» закрывает окно и возвращает на прежний
 * экран. Если данных не хватает (нет id периода) — открывается ближайший
 * период этой машины с понятным сообщением (см. карточку машины в модуле).
 */
export const openVyezdPeriod = (t: VyezdTarget): boolean => {
  const hash = vyezdHashOf(t);
  if (!hash) return false;
  try {
    if (window.location.hash !== hash) window.location.hash = hash;
    return true;
  } catch {
    return false;
  }
};

/** Замена адреса окна без новой записи истории (переключение периода внутри окна). */
export const replaceVyezdHash = (t: VyezdTarget): void => {
  const hash = vyezdHashOf(t);
  if (!hash) return;
  try {
    const { pathname, search } = window.location;
    window.history.replaceState(null, '', `${pathname}${search}${hash}`);
  } catch {
    /* не критично */
  }
};

export interface ParsedVyezdRoute {
  /** 'period' — id записи есть; 'car' — открыть ближайший период машины. */
  kind: 'period' | 'car';
  periodId: string | null;
  carKey: string | null;
  carNumber: string | null;
}

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

/** Разбор hash окна периода. null — маршрут не про окно учёта выезда. */
export const parseVyezdHash = (hash: string): ParsedVyezdRoute | null => {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw.startsWith('baza/vyezd')) return null;
  const [pathPart, queryPart] = raw.split('?');
  const segs = pathPart.split('/').filter(Boolean); // ['baza','vyezd', ...]
  const params = new URLSearchParams(queryPart || '');
  if (segs[2] === 'car') {
    return {
      kind: 'car',
      periodId: null,
      carKey: segs[3] ? safeDecode(segs[3]) : null,
      carNumber: params.get('no') || null,
    };
  }
  if (!segs[2]) return null;
  return {
    kind: 'period',
    periodId: safeDecode(segs[2]),
    carKey: params.get('car') || null,
    carNumber: null,
  };
};

// ---------------------------------------------------------------------------
// Статусы периода «Учёта выезда»
// ---------------------------------------------------------------------------

export type VyezdStatusKind = 'active' | 'closed' | 'no-departure' | 'conflict' | 'early-departure';

export interface VyezdStatusColor {
  bg: string;
  border: string;
  text: string;
}

/**
 * Цвета статусов — из текущей палитры портала: «ведётся» — нейтральный
 * серо-синий факта базы (как было), «закрыт» — мягкий зелёный (успешное
 * завершение), «выезд не зафиксирован» — янтарный (как просроченные сроки),
 * «расхождение» — розово-красный (как предупреждения/просрочка).
 * `early-departure` — НЕ статус модуля «Учёт выезда», а смягчённый показ
 * конфликта НА ТАЙМЛАЙНЕ: расхождение полностью объясняется правилом «выехала
 * раньше» (полоса укорочена до дня выезда, на стыке маркер) — мягкий серо-синий
 * без тревоги. Сам vyezdStatusOf такую запись по-прежнему считает конфликтом
 * (в «Учёте выезда» красный не меняется).
 */
export const VYEZD_STATUS: Record<VyezdStatusKind, VyezdStatusColor & { label: string; short: string }> = {
  active: { label: 'Учёт ведётся', short: 'учёт ведётся', bg: '#EAECF0', border: '#A6ADBA', text: '#444B57' },
  closed: { label: 'Период закрыт', short: 'период закрыт', bg: '#E9F6F0', border: '#8FC9AE', text: '#1D6B50' },
  'no-departure': { label: 'Выезд не зафиксирован', short: 'выезд не зафиксирован', bg: '#FBEFD4', border: '#E3B04B', text: '#8A5A0A' },
  conflict: { label: 'Расхождение с рейсом', short: 'расхождение с рейсом', bg: '#FDEBEE', border: '#EFA3B1', text: '#9F1239' },
  'early-departure': { label: 'Ранний выезд (расхождение объяснено)', short: 'ранний выезд', bg: '#EAECF0', border: '#A6ADBA', text: '#444B57' },
};

export const vyezdStatusIcon = (kind: VyezdStatusKind): LucideIcon => {
  if (kind === 'closed') return CircleCheck;
  if (kind === 'no-departure') return Hourglass;
  if (kind === 'conflict') return TriangleAlert;
  // «Ранний выезд» (смягчённый конфликт на таймлайне) — нейтральная иконка без тревоги.
  return CircleDashed;
};

/** Диапазон рейса машины для проверки пересечений (план, как в существующей логике). */
export interface VyezdTripRange {
  a: number;
  b: number;
  label: string;
  archived?: boolean;
}

export interface VyezdConflict {
  label: string;
  a: number;
  b: number;
  /** Дни пересечения периода и рейса (включительно, дробление не выдумывается). */
  days: number;
  /** Границы пересечения (для подписи «общий день» / «общие дни»). */
  overlapA: number;
  overlapB: number;
  /** Один общий день стыка (рейс завершился в день приезда / начался в день выезда). */
  boundary: boolean;
}

export interface VyezdStatusResult extends VyezdStatusColor {
  kind: VyezdStatusKind;
  label: string;
  short: string;
  /** Простое объяснение статуса — для подсказки и блока «Пояснения». */
  reason: string;
  /** Пересечения с рейсами (включая честные стыки — они показываются отдельно). */
  conflicts: VyezdConflict[];
  /**
   * true — ВСЕ настоящие пересечения объясняются правилом «выехала раньше»
   * (lib/overlap, правило 1): рейс начался внутри учётного периода и машина
   * выехала раньше учётного конца X (фактический выезд / срок готовности) —
   * ровно тот случай, где полоса укорочена до дня выезда и стоит маркер
   * «выехал на N дн. раньше». Такой случай НА ТАЙМЛАЙНЕ показывается
   * нейтрально (смягчённый статус — и для конфликта, и для закрытой/архивной
   * записи); в модуле «Учёт выезда» статусы не меняются. Для остальных
   * случаев — false (не смягчаем).
   */
  earlyDepartureOnly: boolean;
}

/**
 * Честный стык: рейс завершился в день приезда на базу ИЛИ (для закрытого
 * периода) рейс начался в день фактического выезда. Это не расхождение —
 * день перехода, он показывается отдельной пометкой.
 */
const isVyezdBoundary = (
  p: BasePeriod,
  baseA: number,
  s: number,
  e: number,
  lo: number,
  hi: number,
): boolean => (e === baseA && s < baseA) || (p.departureDay != null && lo === hi && s === p.departureDay);

/**
 * Все настоящие пересечения объясняются правилом «выехала раньше»
 * (lib/overlap, правило 1) — условие, при котором ТАЙМЛАЙН смягчает показ
 * статуса до нейтрального. Само значение vyezdStatusOf остаётся прежним
 * (в модуле «Учёт выезда» ничего не меняется). Условие зеркалит правило 1:
 * рейс начинается внутри учётного периода (после приезда, не позже учётного
 * конца), тянется до конца периода/дальше, и его старт раньше учётного конца X
 * (фактический выезд либо срок готовности) — то есть маркер «выехал на N дн.
 * раньше». Рейс целиком внутри простоя, рейс, начавшийся до/в день приезда,
 * или выезд ПОЗЖЕ учётного срока сюда не попадают — такие случаи остаются
 * «расхождением» и на таймлайне.
 */
const earlyDepartureExplainsAll = (
  p: BasePeriod,
  rb: { a: number; b: number },
  real: VyezdConflict[],
): boolean => {
  const xEnd = p.departureDay ?? p.plannedReadyDay;
  if (xEnd == null || !real.length) return false;
  return real.every((c) => c.a > rb.a && c.a <= rb.b && c.b >= rb.b && c.a < xEnd);
};

/** Минимальное описание случая «ранний выезд» для подсказок таймлайна. */
export const EARLY_DEPARTURE_TIMELINE_NOTE =
  'На таймлайне статус показан нейтрально (расхождение объяснено правилом «выехала раньше»); в «Учёте выезда» статус не изменяется.';

/**
 * Статус периода по существующим данным. Правило пересечения с рейсом:
 * расхождение — пересечение период↔рейс, не являющееся честным стыком
 * (рейс завершился в день приезда / начался в день выезда); для архивных
 * записей статус не перекрывается расхождением — историческое пересечение
 * остаётся в подсказке и блоке «Пояснения» (архив по умолчанию скрыт).
 */
export const vyezdStatusOf = (p: BasePeriod, today: number, trips: VyezdTripRange[] = []): VyezdStatusResult => {
  const rb = baseBarRange(p, today);
  const dev = baseDeviation(p, today);
  const conflicts: VyezdConflict[] = [];
  if (rb) {
    trips.forEach((t) => {
      const s = t.a;
      const e = Math.max(t.b, t.a);
      const lo = Math.max(s, rb.a);
      const hi = Math.min(e, rb.b);
      if (hi < lo) return;
      const days = hi - lo + 1;
      const boundary = isVyezdBoundary(p, rb.a, s, e, lo, hi);
      conflicts.push({ label: t.label, a: s, b: e, days, overlapA: lo, overlapB: hi, boundary });
    });
  }
  const real = conflicts.filter((c) => !c.boundary && c.days >= 1);
  // Случай «ранний выезд» (см. earlyDepartureExplainsAll). Флаг описывает
  // данные; смягчение показа применяет только таймлайн (lib/bzFills), статусы
  // модуля «Учёт выезда» не меняются.
  const earlyOnly = rb != null && earlyDepartureExplainsAll(p, rb, real);
  const base = VYEZD_STATUS;
  if (real.length && !p.archived) {
    const c = real[0];
    return {
      kind: 'conflict',
      ...base.conflict,
      reason: `Период пересекается с рейсом ${c.label} (${fmtDM(c.a)} – ${fmtDM(c.b)}): общих дней — ${c.days}. Проверьте даты в «Учёте выезда» и в «Плане дохода».`,
      conflicts,
      earlyDepartureOnly: earlyOnly,
    };
  }
  if (p.departureDay == null) {
    if (dev.kind === 'overdue') {
      return {
        kind: 'no-departure',
        ...base['no-departure'],
        reason: `Срок готовности прошёл (${p.plannedReadyDay != null ? fmtDM(p.plannedReadyDay) : 'дата не указана'}), фактический выезд не указан — возможно, факт просто не внесён.`,
        conflicts,
        earlyDepartureOnly: false,
      };
    }
    return {
      kind: 'active',
      ...base.active,
      reason: 'Период открыт: приезд зафиксирован, фактический выезд ещё не внесён — учёт ведётся.',
      conflicts,
      earlyDepartureOnly: false,
    };
  }
  return {
    kind: 'closed',
    ...base.closed,
    reason: `Фактический выезд указан: ${fmtDM(p.departureDay)}${dev.kind === 'late' ? ` — позже срока готовности на ${dev.days} дн` : dev.kind === 'early' ? ` — раньше срока готовности на ${Math.abs(dev.days ?? 0)} дн` : dev.kind === 'on' ? ' — по плану' : ''}${
      real.length ? `; в архиве есть пересечение с рейсом ${real[0].label} — см. пояснения` : ''
    }.`,
    conflicts,
    earlyDepartureOnly: earlyOnly,
  };
};

// ---------------------------------------------------------------------------
// Сводка по периоду: дни в рейсе / на базе / в ремонте / без пересечений
// ---------------------------------------------------------------------------

export interface VyezdSummary {
  /** Длина периода (приезд → выезд/сегодня), дней. */
  total: number;
  /** Дни периода, пересекающиеся с рейсами машины. */
  tripDays: number;
  /** Дни периода, пересекающиеся с ремонтом записи. */
  repairDays: number;
  /** Дни периода без пересечений с рейсами и ремонтом. */
  freeDays: number;
  /** Пересекающиеся рейсы (кто именно, сколько дней; стык — день перехода). */
  trips: Array<{ label: string; a: number; b: number; days: number; archived?: boolean; boundary?: boolean }>;
}

export const vyezdSummaryOf = (p: BasePeriod, today: number, trips: VyezdTripRange[] = []): VyezdSummary => {
  const rb = baseBarRange(p, today);
  const rr = repairBarRange(p, today);
  if (!rb) return { total: 0, tripDays: 0, repairDays: 0, freeDays: 0, trips: [] };
  const covered = new Set<number>();
  const tripHit: VyezdSummary['trips'] = [];
  trips.forEach((t) => {
    const s = t.a;
    const e = Math.max(t.b, t.a);
    const lo = Math.max(s, rb.a);
    const hi = Math.min(e, rb.b);
    if (hi < lo) return;
    for (let d = lo; d <= hi; d += 1) covered.add(d);
    tripHit.push({
      label: t.label,
      a: s,
      b: e,
      days: hi - lo + 1,
      archived: t.archived,
      boundary: isVyezdBoundary(p, rb.a, s, e, lo, hi),
    });
  });
  const repairDays = rr ? Math.max(0, Math.min(rr.b, rb.b) - Math.max(rr.a, rb.a) + 1) : 0;
  const coveredWithRepair = new Set(covered);
  if (rr) {
    for (let d = Math.max(rr.a, rb.a); d <= Math.min(rr.b, rb.b); d += 1) coveredWithRepair.add(d);
  }
  const total = rb.b - rb.a + 1;
  return {
    total,
    tripDays: covered.size,
    repairDays,
    freeDays: Math.max(0, total - coveredWithRepair.size),
    trips: tripHit.sort((x, y) => x.a - y.a),
  };
};

/** Ближайший период машины (когда в ссылке нет id записи): текущий → открытые → по дате. */
export const nearestPeriodOf = (periods: BasePeriod[], today: number): BasePeriod | null => {
  if (!periods.length) return null;
  const span = (p: BasePeriod): { a: number; b: number } | null => {
    const rb = baseBarRange(p, today);
    if (!rb) return null;
    return { a: rb.a, b: rb.b };
  };
  const score = (p: BasePeriod): number => {
    const s = span(p);
    let v = p.archived ? 1e6 : 0;
    if (s) {
      if (s.a <= today && today <= s.b) v -= 1e5;
      else if (p.departureDay == null) v -= 1e4;
      v += Math.min(Math.abs(s.a - today), Math.abs(s.b - today));
    } else {
      v += 900;
    }
    return v;
  };
  return [...periods].sort((x, y) => score(x) - score(y))[0] || null;
};

/** Диапазон рейса из существующих полей (тот же приём, что у плановой полосы:
 *  spanOverride → план → факт; границы не выдумываются). */
export const tripRangeOf = (t: WholeTrip): VyezdTripRange | null => {
  const ov = t.spanOverride || {};
  const span = tripSpan(t);
  const a = ov.pMin ?? span.pMin ?? null;
  if (a == null) return null;
  const b = ov.pMax ?? span.pMax ?? a;
  return { a, b: Math.max(a, b), label: `«${t.route || t.key}»`, archived: !!t.archived };
};

/**
 * Разрешение наложений полос на таймлайне (рейсы ↔ простой на базе ↔ ремонт).
 *
 * ЕДИНАЯ функция: вход — интервалы одной машины и одной подстроки (план или
 * факт отдельно, не смешиваются), выход — сегменты (с границами и срезами
 * дней перехода), маркеры стыков и предупреждения. Рендер использует ТОЛЬКО
 * результат этой функции — собственной арифметики пересечений в отрисовке нет.
 *
 * Правила (все дни включительно, окончания — включительные; открытые периоды
 * обрезаются по «сегодня» той же функцией границ, что и раньше):
 *
 *  1. Выехала РАНЬШЕ простоя: рейс начинается в день S, а простой по учёту
 *     длится до X (S < X). Полоса простоя укорачивается до дня S, день S
 *     делится по горизонтали: слева — простой, справа — рейс («база → рейс»);
 *     на стыке маркер «выезд» с подсказкой «Машина выехала на N дн. раньше».
 *     Дату X в данных не меняем — только не рисуем простой после выезда.
 *  2. Выехала ПОЗЖЕ: между концом простоя (X) и стартом рейса S (S > X + 1)
 *     остаётся промежуток — нейтральный штрихованный сегмент «Ожидание выезда
 *     (N дн.)», N = S − X − 1. Только когда X подтверждён данными
 *     (фактический выезд или срок готовности), иначе промежуток не подписываем.
 *  3. ШТАТНАЯ СМЕНА В ОДИН ДЕНЬ (рейс завершён в день приезда на базу, или
 *     простой закончился в день старта рейса) — не ошибка: день делится по
 *     горизонтали (слева завершающееся состояние, справа начинающееся), обе
 *     части кликабельны, на стыке маркер «прибытие на базу» / «выезд».
 *     Непрерывные полосы остаются непрерывными — срез только на границе дня.
 *  4. ПРОЧИЕ ПЕРЕСЕЧЕНИЯ (рейс целиком внутри простоя, два пересекающихся
 *     рейса и т. п.) — не маскируются: штриховка зоны пересечения и значок
 *     «конфликт данных» с подсказкой. Приоритет видимости: рейс факт →
 *     простой факт → ремонт → план (ремонт показан вложенным в простой).
 *
 * ВАЖНО: срез дня (fraction) применяется только к дню смены; сами полосы не
 * разрываются. Часовые пояса: все даты — календарные дни (Y-M-D без времени),
 * дроби дня — только геометрия отображения.
 */

export interface OverlapInterval {
  /** Стабильный ключ (клик/подсветка): `pd:…`, `tl:…`, `bz:…`. */
  key: string;
  a: number;
  b: number;
  /** Открытый конец (продолжается): не является стыком/расхождением сам по себе. */
  open?: boolean;
}

export interface OverlapBase extends OverlapInterval {
  /** Конец простоя по учёту выезда (фактический выезд → иначе срок готовности). */
  xEnd: number | null;
  /** Тип учётного конца: факт (выезд указан) или план (срок готовности). */
  xKind: 'fact' | 'plan' | null;
}

export interface ResolvedSegment {
  key: string;
  kind: 'trip' | 'base';
  a: number;
  b: number;
  /** Доля начального дня [0..1): 0 — обычная граница дня; 0.5 — срез дня смены. */
  fracA: number;
  /** Доля конечного дня (0..1]: 1 — до конца дня; 0.5 — левая половина дня смены. */
  fracB: number;
  /** Дни периода срезаны (первый/последний день поделен) — для подписи. */
  cutA: boolean;
  cutB: boolean;
  open?: boolean;
  /** Требуется тонкая штриховка поверх (пересечение не разрешено правилами 1–3). */
  overlap?: boolean;
  /** Для базы: на сколько дней укорочена полоса из-за раннего выезда (0 — нет). */
  truncatedDays?: number;
}

export type OverlapMarkerKind = 'arrival' | 'departure' | 'early-departure';

export interface ResolvedMarker {
  kind: OverlapMarkerKind;
  day: number;
  /** Координата маркера внутри дня [0..1]: 0.5 — центр, 0/1 — граница среза. */
  frac: number;
  title: string;
  /** Ключ учётной записи (клик — окно «Учёта выезда» через единый хелпер). */
  periodKey?: string;
  /** Ключ рейса (маркеры стыка с рейсом). */
  tripKey?: string;
}

export interface ResolvedWarning {
  a: number;
  b: number;
  title: string;
  /** Ключи источников (рейс/запись) — для ссылки на источник в подсказке. */
  refs: string[];
}

export interface OverlapResolution {
  segments: ResolvedSegment[];
  markers: ResolvedMarker[];
  warnings: ResolvedWarning[];
}

export interface ResolveOverlapsArgs {
  base: OverlapBase | null;
  trips: OverlapInterval[];
  /** Подпись машины для подсказок. */
  carLabel?: string;
}

const max = Math.max;
const min = Math.min;

/** «{label} · выезд по рейсу {S}. По учёту выезда простой до: {X}. Машина выехала на N дн. раньше». */
const earlyTitle = (tripLabel: string, s: number, x: number | null, n: number | null, fmt: (d: number) => string): string =>
  `${tripLabel}: выезд по рейсу ${fmt(s)}. По учёту выезда простой до: ${x != null ? fmt(x) : 'не указан'}.${
    n != null && n > 0 ? ` Машина выехала на ${n} дн. раньше.` : ''
  }`;

/**
 * Разрешение наложений для одной подстроки (план или факт).
 * Возвращает сегменты рейса и простоя без наложений + маркеры стыков +
 * предупреждения о неразрешённых пересечениях.
 */
export const resolveOverlaps = (
  args: ResolveOverlapsArgs,
  fmt: (d: number) => string,
): OverlapResolution => {
  const { base, trips, carLabel = '' } = args;
  const segments: ResolvedSegment[] = [];
  const markers: ResolvedMarker[] = [];
  const warnings: ResolvedWarning[] = [];

  // Рейсы — как есть (их порядок и границы не меняются).
  trips.forEach((t) => {
    segments.push({ key: t.key, kind: 'trip', a: t.a, b: t.b, fracA: 0, fracB: 1, cutA: false, cutB: false, open: t.open });
  });

  if (!base) return { segments, markers, warnings };

  const b = { ...base };
  // ── Правило 1: ранний выезд — простой укорачивается до дня старта рейса ──
  // Берётся ближайший рейс, начинающийся внутри простоя (самый ранний из них).
  const startingInside = trips
    .filter((t) => t.a > b.a && t.a <= b.b)
    .sort((x, y) => x.a - y.a)[0];
  let actualB = b.b;
  let truncatedDays = 0;
  let cutB = false;
  if (startingInside) {
    const s = startingInside.a;
    actualB = s; // полоса простоя заканчивается в день выезда по рейсу…
    if (s > b.a) cutB = true; // …и день делится пополам со стартующим рейсом
    const xEnd = b.xEnd;
    const n = xEnd != null ? xEnd - s : null;
    if (n != null && n > 0) truncatedDays = n;
    markers.push({
      kind: 'early-departure',
      day: s,
      frac: 0.5,
      title: earlyTitle(
        startingInside.key.startsWith('bz:') ? 'Рейс' : `Рейс ${startingInside.key}`,
        s,
        xEnd,
        n,
        fmt,
      ),
      tripKey: startingInside.key,
      periodKey: b.key,
    });
  }

  segments.push({
    key: b.key,
    kind: 'base',
    a: b.a,
    b: actualB,
    fracA: 0,
    fracB: cutB ? 0.5 : 1,
    cutA: false,
    cutB,
    open: b.open && !startingInside,
    truncatedDays,
  });

  // ── Правило 2: поздний выезд — промежуток между простым и рейсом ────────
  // Зона ожидания добавляется рендером отдельным сегментом (kind 'waiting'),
  // вычисляется там же по фактическому концу базы и началу следующего рейса:
  // см. waitGapOf() ниже.

  // ── Правило 3: штатная смена в один день (прибытие) ─────────────────────
  trips.forEach((t) => {
    if (t.b === b.a && t.a < b.a) {
      // Рейс завершился в день приезда: слева рейс, справа база.
      const seg = segments.find((x) => x.key === t.key && x.kind === 'trip');
      if (seg) seg.fracB = 0.5;
      const baseSeg = segments.find((x) => x.kind === 'base');
      if (baseSeg) baseSeg.fracA = 0.5;
      markers.push({
        kind: 'arrival',
        day: b.a,
        frac: 0.5,
        title: `Прибытие на базу: рейс ${t.key} завершён ${fmt(t.b)}. Начало простоя на базе: ${fmt(b.a)}.${
          carLabel ? ` Машина: ${carLabel}.` : ''
        }`,
        tripKey: t.key,
        periodKey: b.key,
      });
    }
  });

  // ── Правило 4: прочие пересечения — штриховка + «конфликт данных» ──────
  trips.forEach((t) => {
    const lo = max(t.a, b.a);
    const hi = min(t.b, actualB);
    if (hi < lo) return;
    const single = lo === hi;
    const sameDayArrival = t.b === b.a && t.a < b.a;
    const isDepartureSwap = startingInside && t.key === startingInside.key && t.a === actualB;
    if (sameDayArrival || isDepartureSwap) return; // это штатные стыки дня смены
    if (single) {
      // Один общий день не на границе — предупреждение без штриховки зоны.
      warnings.push({
        a: lo,
        b: hi,
        title: `Конфликт данных: рейс ${t.key} пересекает простой на базе в один день (${fmt(lo)}). Источник: «План дохода» (рейс) и «Учёт выезда» (запись ${b.key}). Проверьте даты.`,
        refs: [t.key, b.key],
      });
      return;
    }
    warnings.push({
      a: lo,
      b: hi,
      title: `Конфликт данных: рейс ${t.key} (${fmt(t.a)} – ${fmt(t.b)}) пересекается с простоем на базе (${fmt(b.a)} – ${fmt(actualB)}, ${hi - lo + 1} дн). Источники: «План дохода» и «Учёт выезда» (запись ${b.key}). Проверьте даты.`,
      refs: [t.key, b.key],
    });
    const seg = segments.find((x) => x.key === t.key && x.kind === 'trip');
    if (seg) seg.overlap = true;
  });

  // Два пересекающихся рейса: зона пересечения — тоже «конфликт данных».
  for (let i = 0; i < trips.length; i += 1) {
    for (let j = i + 1; j < trips.length; j += 1) {
      const lo = max(trips[i].a, trips[j].a);
      const hi = min(trips[i].b, trips[j].b);
      if (hi >= lo) {
        warnings.push({
          a: lo,
          b: hi,
          title: `Конфликт данных: рейсы ${trips[i].key} (${fmt(trips[i].a)} – ${fmt(trips[i].b)}) и ${trips[j].key} (${fmt(trips[j].a)} – ${fmt(trips[j].b)}) пересекаются (${hi - lo + 1} дн). Источник: «План дохода». Проверьте даты.`,
          refs: [trips[i].key, trips[j].key],
        });
      }
    }
  }

  return { segments, markers, warnings };
};

export interface WaitGap {
  /** Промежуток дней ожидания (включительно). */
  a: number;
  b: number;
  days: number;
  title: string;
}

/**
 * Промежуток «Ожидание выезда» (правило 2): между подтверждённым концом
 * простоя X (выезд или срок готовности) и стартом следующего рейса S > X + 1.
 * Возвращает null, если данных для подписи нет — промежуток не выдумывается.
 */
export const waitGapOf = (
  base: OverlapBase | null,
  trips: OverlapInterval[],
  fmt: (d: number) => string,
): WaitGap | null => {
  if (!base || base.xEnd == null) return null;
  const next = trips
    .filter((t) => t.a > base.xEnd)
    .sort((x, y) => x.a - y.a)[0];
  if (!next) return null;
  const a = base.xEnd + 1;
  const b = next.a - 1;
  if (b < a) return null;
  const days = b - a + 1;
  return {
    a,
    b,
    days,
    title: `Ожидание выезда: ${days} дн (${fmt(a)} – ${fmt(b)}). Простой по учёту выезда — до ${fmt(base.xEnd)}${
      base.xKind === 'plan' ? ' (срок готовности)' : ' (фактический выезд)'
    }, следующий рейс начинается ${fmt(next.a)}. Записи учёта на эти дни нет — данные не додумываются.`,
  };
};

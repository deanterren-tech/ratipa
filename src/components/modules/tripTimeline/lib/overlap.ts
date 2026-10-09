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
 *     Рейс, начинающийся внутри простоя ПОСЛЕ X (X < S ≤ b): выехала позже —
 *     день тоже делится (рейс начинается в день S), маркер «выезд» сообщает
 *     «на M дн. позже срока готовности». Рейс, который начинается И
 *     заканчивается внутри простоя (полностью внутри), НЕ маскируется —
 *     уходит в правило 4 («конфликт данных»).
 *  2. Выехала ПОЗЖЕ: между концом простоя (X) и стартом рейса S (S > X + 1)
 *     остаётся промежуток — нейтральный штрихованный сегмент «Ожидание выезда
 *     (N дн.)», N = S − X − 1. Только когда X подтверждён данными
 *     (фактический выезд или срок готовности) И полоса простоя уже не занимает
 *     этот промежуток (закрытый период), иначе промежуток не подписываем.
 *     Части промежутка, занятые другими рейсами, вычитаются — не маскируем.
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
  /** Человекочитаемая подпись для подсказок («Рейс «маршрут»»). */
  label?: string;
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
  /** Для базы: на сколько дней выехала раньше учётного конца X (0 — нет/неизвестно). */
  truncatedDays?: number;
}

export type OverlapMarkerKind = 'arrival' | 'departure' | 'early-departure';

export interface ResolvedMarker {
  kind: OverlapMarkerKind;
  day: number;
  /** Координата маркера внутри дня [0..1]: 0.5 — центр, 0/1 — граница среза. */
  frac: number;
  title: string;
  /** Расхождение (выехала раньше/позже учёта) — для индикатора в колонке. */
  alert?: boolean;
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

const labelOf = (t: OverlapInterval): string => (t.label ? `${t.label}` : 'Рейс');
const xText = (x: number | null, kind: 'fact' | 'plan' | null, fmt: (d: number) => string): string => {
  if (x == null) return 'не указан';
  const suffix = kind === 'plan' ? ' (срок готовности)' : kind === 'fact' ? ' (фактический выезд)' : '';
  return `${fmt(x)}${suffix}`;
};

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

  // Два пересекающихся рейса: зона пересечения — «конфликт данных». Считается
  // и без учётной записи — рейсы могут пересекаться сами по себе (правило 4).
  for (let i = 0; i < trips.length; i += 1) {
    for (let j = i + 1; j < trips.length; j += 1) {
      const lo = max(trips[i].a, trips[j].a);
      const hi = min(trips[i].b, trips[j].b);
      if (hi >= lo) {
        warnings.push({
          a: lo,
          b: hi,
          title: `Конфликт данных: рейсы ${labelOf(trips[i])} (${fmt(trips[i].a)} – ${fmt(trips[i].b)}) и ${labelOf(trips[j])} (${fmt(trips[j].a)} – ${fmt(trips[j].b)}) пересекаются (${hi - lo + 1} дн). Источник: «План дохода». Проверьте даты.`,
          refs: [trips[i].key, trips[j].key],
        });
      }
    }
  }

  if (!base) return { segments, markers, warnings };

  const b = { ...base };
  // ── Правило 1: ранний/поздний выезд — простой укорачивается до дня старта
  // рейса. Берётся ближайший рейс, начинающийся внутри простоя (самый ранний),
  // КРОМЕ рейса, полностью лежащего внутри простоя (это правило 4 — конфликт).
  const startingCandidates = trips
    .filter((t) => t.a > b.a && t.a <= b.b && !(t.b < b.b))
    .sort((x, y) => x.a - y.a);
  const startingInside = startingCandidates[0];
  let actualB = b.b;
  let truncatedDays = 0;
  let cutB = false;
  if (startingInside) {
    const s = startingInside.a;
    actualB = s; // полоса простоя заканчивается в день выезда по рейсу…
    cutB = s > b.a; // …и день делится: слева простой, справа рейс
    const xEnd = b.xEnd;
    const n = xEnd != null ? xEnd - s : null;
    if (n != null && n > 0) truncatedDays = n;
    // Маркер стыка: «выехала раньше» (n>0), «выезд в один день» (n=0) или
    // «выезд после срока готовности» (n<0; выезд в учёте не зафиксирован).
    const label = labelOf(startingInside);
    let title: string;
    if (n != null && n > 0) {
      title = `${label}: выезд по рейсу ${fmt(s)}. По учёту выезда простой до: ${xText(xEnd, b.xKind, fmt)}. Машина выехала на ${n} дн. раньше. Дата в учёте не изменяется — простой укорочен до дня фактического выезда.`;
    } else if (n === 0) {
      title = `${label}: выезд по рейсу ${fmt(s)}. По учёту выезда простой до: ${xText(xEnd, b.xKind, fmt)} — смена в один день: слева простой, справа рейс.`;
    } else if (n != null && n < 0) {
      title = `${label}: выезд по рейсу ${fmt(s)}. По учёту выезда простой до: ${xText(xEnd, b.xKind, fmt)} — фактический выезд не зафиксирован; машина выехала на ${-n} дн. позже. Простой показан до дня выезда.`;
    } else {
      title = `${label}: выезд по рейсу ${fmt(s)}. В учёте выезда фактический выезд не указан — простой показан до дня выезда (смена в один день).`;
    }
    if (carLabel) title += ` Машина: ${carLabel}.`;
    markers.push({
      kind: n != null && n > 0 ? 'early-departure' : 'departure',
      day: s,
      frac: 0.5,
      title,
      alert: n != null && n !== 0,
      tripKey: startingInside.key,
      periodKey: b.key,
    });
    // Рейс в день смены начинается справа от полосы простоя: срез начала.
    const seg = segments.find((x) => x.key === startingInside.key && x.kind === 'trip');
    if (seg) {
      seg.fracA = 0.5;
      seg.cutA = true;
    }
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
  // Зона ожидания добавляется рендером отдельными сегментами — см. waitGapsOf().

  // ── Правило 3: штатная смена в один день (прибытие) ─────────────────────
  trips.forEach((t) => {
    if (t.b === b.a && t.a < b.a) {
      // Рейс завершился в день приезда: слева рейс, справа база.
      const seg = segments.find((x) => x.key === t.key && x.kind === 'trip');
      if (seg) {
        seg.fracB = 0.5;
        seg.cutB = true;
      }
      const baseSeg = segments.find((x) => x.kind === 'base');
      if (baseSeg) {
        baseSeg.fracA = 0.5;
        baseSeg.cutA = true;
      }
      markers.push({
        kind: 'arrival',
        day: b.a,
        frac: 0.5,
        title: `${labelOf(t)} завершён ${fmt(t.b)}. Начало простоя на базе: ${fmt(b.a)} — штатная смена в один день, не расхождение.${
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
    const isDepartureSwap = !!startingInside && t.key === startingInside.key && t.a === actualB;
    if (sameDayArrival || isDepartureSwap) return; // это штатные стыки дня смены
    const tripLabel = `${labelOf(t)} (${fmt(t.a)} – ${fmt(t.b)})`;
    if (single) {
      // Один общий день не на границе — предупреждение без штриховки зоны.
      warnings.push({
        a: lo,
        b: hi,
        title: `Конфликт данных: ${tripLabel} пересекает простой на базе в один день (${fmt(lo)}). Источник: «План дохода» (рейс) и «Учёт выезда» (запись ${b.key}). Проверьте даты.`,
        refs: [t.key, b.key],
      });
      return;
    }
    warnings.push({
      a: lo,
      b: hi,
      title: `Конфликт данных: ${tripLabel} пересекается с простоем на базе (${fmt(b.a)} – ${fmt(actualB)}, ${hi - lo + 1} дн). Источники: «План дохода» и «Учёт выезда» (запись ${b.key}). Проверьте даты.`,
      refs: [t.key, b.key],
    });
    const seg = segments.find((x) => x.key === t.key && x.kind === 'trip');
    if (seg) seg.overlap = true;
  });

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
 * Промежутки «Ожидание выезда» (правило 2): между подтверждённым концом
 * простоя X (выезд или срок готовности) и стартом следующего рейса S > X + 1.
 * Показываются только когда полоса простоя уже закончилась (X — реальный конец
 * отрисованной полосы), иначе промежуток занят полосой открытого простоя.
 * Части промежутка, занятые другими рейсами ИЛИ другими записями учёта выезда
 * машины (occupied), вычитаются — занятые дни не штрихуются.
 * Пустой массив, если данных для подписи нет — промежуток не выдумывается.
 */
export const waitGapsOf = (
  base: OverlapBase | null,
  trips: OverlapInterval[],
  fmt: (d: number) => string,
  occupied: Array<{ a: number; b: number }> = [],
): WaitGap[] => {
  if (!base || base.xEnd == null) return [];
  const x = base.xEnd;
  // Открытый простой дорисовывается до b > X — промежуток под полосой не выдумываем.
  if (base.b > x) return [];
  const next = trips
    .filter((t) => t.a > x)
    .sort((a, b) => a.a - b.a)[0];
  if (!next) return [];
  let segments: Array<{ a: number; b: number }> = [{ a: x + 1, b: next.a - 1 }];
  if (segments[0].b < segments[0].a) return [];
  // Вычитаем всё занятое: рейсы (в т.ч. начавшиеся внутри промежутка) и другие
  // записи учёта выезда этой машины — там уже нарисована своя полоса.
  const busy = [
    ...trips.filter((t) => t.a <= next.a - 1 && t.b >= x + 1).map((t) => ({ a: t.a, b: t.b })),
    ...occupied,
  ].sort((a, b) => a.a - b.a);
  busy.forEach((t) => {
    const out: Array<{ a: number; b: number }> = [];
    segments.forEach((s) => {
      const lo = max(s.a, t.a);
      const hi = min(s.b, t.b);
      if (hi < lo) {
        out.push(s);
        return;
      }
      if (lo > s.a) out.push({ a: s.a, b: lo - 1 });
      if (hi < s.b) out.push({ a: hi + 1, b: s.b });
    });
    segments = out;
  });
  const xk = base.xKind === 'plan' ? 'срок готовности' : base.xKind === 'fact' ? 'фактический выезд' : 'конец простоя';
  return segments
    .filter((s) => s.b >= s.a)
    .map((s) => ({
      a: s.a,
      b: s.b,
      days: s.b - s.a + 1,
      title: `Ожидание выезда: ${s.b - s.a + 1} дн (${fmt(s.a)} – ${fmt(s.b)}). Простой по учёту выезда — до ${fmt(x)} (${xk}), следующий рейс начинается ${fmt(next.a)}. Записи учёта на эти дни нет — данные не додумываются.`,
    }));
};

/**
 * СЕГМЕНТЫ «РИСКИ» (запас дней `bufferDays`) на подстроке «План» — ЕДИНАЯ
 * чистая арифметика для полотна таймлайна (TimelineGrid) и тестов.
 *
 * Правила (спецификация владельца):
 *   • для КАЖДОГО этапа с `bufferDays > 0` — отдельный сегмент СРАЗУ ПОСЛЕ
 *     сегмента этого этапа (anchor = правый край последней видимой доли дня
 *     этапа), шириной = bufferDays суток в ТЕКУЩЕМ масштабе (дней × colW);
 *   • этап без запаса (0/пусто) сегмента НЕ получает;
 *   • сегменты НЕ накладываются друг на друга: каждый урезается по анкеру
 *     следующего сегмента того же рейса (порядок — по левому краю, тай-брейкер
 *     seq, затем id) и по правому краю окна (не вылезает за видимую область —
 *     при частичной видимости этапа анкер считается по последней видимой доле,
 *     т.е. сегмент урезается вместе с этапом);
 *   • текст: ширина ≥ RISK_FULL_MIN_W — «Риски +N дн»; ширина ≥ RISK_SHORT_MIN_W
 *     — «+N»; совсем узкий сегмент — без текста (полный текст в подсказке);
 *   • сегмент-крошка (< RISK_MIN_W) не рисуется.
 *
 * Геометрия данных НЕ меняется: запас только визуализируется.
 */

export interface RiskSegmentInput {
  /** Рейс-владелец (стабильный ключ полосы). */
  tripKey: string;
  /** Этап-владелец сегмента; отсутствие — запас ЗАПИСИ ручного рейса (trip-level). */
  stageId?: string;
  /** Порядок этапа (seq; у запаса записи — 0) — стабильный тай-брейкер. */
  seq: number;
  /** Левый край в координатах подстроки (px), сразу после своего этапа/полосы. */
  anchor: number;
  /** Запас, дней (> 0). */
  days: number;
}

export interface RiskSegment {
  tripKey: string;
  stageId?: string;
  /** Координаты в подстроке (px). */
  left: number;
  right: number;
  width: number;
  /** Запас, дней. */
  days: number;
  /** Текст внутри сегмента («Риски +N дн» → «+N» → null), null — нет текста. */
  text: string | null;
}

/** Полный текст «Риски +N дн» — начиная с этой ширины сегмента (px). */
export const RISK_FULL_MIN_W = 40;
/** Короткий текст «+N» — начиная с этой ширины сегмента (px). */
export const RISK_SHORT_MIN_W = 20;
/** Сегмент уже этой ширины не рисуется вовсе (px). */
export const RISK_MIN_W = 4;
/** Метрика текста сегмента (8px/600) — та же, что у подписей полос. */
export const RISK_TEXT_CHAR_W = 4.7;

const riskTextWidthOf = (text: string): number => 8 + Math.round(text.length * RISK_TEXT_CHAR_W);

/**
 * Текст сегмента по его ширине. Полный «Риски +N дн» — от RISK_FULL_MIN_W и
 * только если реально помещается (иначе ellipsis съел бы сам счётчик дней);
 * иначе «+N» от RISK_SHORT_MIN_W; совсем узкий — без текста (полный текст в
 * подсказке). Никогда не отдаём обрезанный текст вместо счётчика.
 */
export const riskSegmentTextOf = (days: number, width: number): string | null => {
  const full = `Риски +${days} дн`;
  if (width >= RISK_FULL_MIN_W && width >= riskTextWidthOf(full)) return full;
  if (width >= RISK_SHORT_MIN_W) return `+${days}`;
  return null;
};

/**
 * Бюджет ширины текста сегмента с учётом чужой метки ВНУТРИ него (чип
 * направления полосы у правого края рейса, слой меток выше сегмента): текст не
 * заходит под метку — бюджет обрезается по её левому краю. Если метка левее
 * сегмента или её нет — бюджет не меняется.
 */
export const riskTextBudgetWithChip = (
  width: number,
  left: number,
  right: number,
  chip?: { left: number; right: number } | null,
): number => {
  if (!chip) return width;
  if (chip.left > left && chip.left < right) return Math.max(0, chip.left - left - 4);
  return width;
};

/**
 * Раскладка сегментов «Риски» одной подстроки: сортировка, урезание по
 * следующему анкеру и окну, отбрасывание крошек, текст по ширине.
 * `laneWidth` — ширина подстроки в px (окно), `colW` — ширина дня текущего
 * масштаба.
 */
export const layoutRiskSegments = (
  inputs: RiskSegmentInput[],
  laneWidth: number,
  colW: number,
): RiskSegment[] => {
  const sorted = inputs
    .filter((x) => x.days > 0 && Number.isFinite(x.anchor) && x.days * colW > 0)
    .slice()
    .sort(
      (a, b) =>
        a.anchor - b.anchor ||
        a.seq - b.seq ||
        String(a.stageId || '').localeCompare(String(b.stageId || '')) ||
        a.tripKey.localeCompare(b.tripKey),
    );
  const out: RiskSegment[] = [];
  sorted.forEach((x, i) => {
    const next = sorted[i + 1];
    const left = Math.max(0, Math.round(x.anchor));
    let right = Math.min(laneWidth, Math.round(x.anchor + x.days * colW));
    // Наложение сегментов недопустимо: правый край не заходит за анкер
    // следующего сегмента (по порядку слева направо).
    if (next) right = Math.min(right, Math.max(0, Math.round(next.anchor)));
    const width = right - left;
    if (width < RISK_MIN_W) return;
    out.push({
      tripKey: x.tripKey,
      stageId: x.stageId,
      left,
      right,
      width,
      days: x.days,
      text: riskSegmentTextOf(x.days, width),
    });
  });
  return out;
};

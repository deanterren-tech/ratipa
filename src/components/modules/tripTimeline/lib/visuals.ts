/**
 * Единый визуальный источник таймлайна рейсов: палитры полос, штриховки,
 * статусные иконки и стили бейджей.
 *
 * Вынесено из TimelineGrid БЕЗ изменения значений: те же константы используют
 * полотно таймлайна, встроенный мини-таймлайн карточки рейса, попап «Обозначения»
 * и интерактивный гайд (см. guide/). Единый источник нужен, чтобы цвета и значки
 * в обучении и в справочнике не расходились с реальным дизайном при его правке.
 */
import type React from 'react';
import { CalendarClock, CircleDashed, FileInput, FileOutput, Flag, Hourglass, OctagonX, Package, PackageOpen, TriangleAlert } from 'lucide-react';

// ---------------------------------------------------------------------------
// Палитра полос (визуальная логика прототипа; цвета — единая семья заливок
// под светлый холст, согласованы с токенами .tl-scope в index.css)
// ---------------------------------------------------------------------------

export const CLR = {
  planBg: '#DFEAFD',
  planBg2: '#CFE0FB',
  planBorder: '#8FBBF7',
  planText: '#1C3D8C',
  planArchBg: '#EBEDF1',
  planArchBorder: '#B4BBC6',
  planArchText: '#5D6470',
  planNoneBg: '#F7F8FA',
  planNoneBorder: '#AAB1BD',
  bufferA: '#F7DF9E',
  fact: '#2FB68C',
  factOpenA: '#9FE2C6',
  weekend: 'var(--tl-weekend)',
  today: '#F43F5E',
  warn: '#D97706',
};

/**
 * ПЛАН рейса — ОДИН акцентный цвет приложения (токены темы), без индикации
 * сроков: никаких зелёного/жёлтого/оранжевого/красного на плановой полосе.
 */
export const PLAN_ACCENT = {
  bg: 'var(--accent-10)',
  border: 'var(--accent-40)',
  text: '#7E3A0D',
};

/** Архивная план-полоса — тот же акцент, приглушённый (правило архива). */
export const PLAN_ACCENT_ARCH = {
  bg: CLR.planArchBg,
  border: CLR.planArchBorder,
  text: CLR.planArchText,
};

export const planBarBg = `linear-gradient(180deg, ${CLR.planBg} 0%, ${CLR.planBg2} 100%)`;

export const hatch45 = `repeating-linear-gradient(45deg, ${CLR.bufferA}, ${CLR.bufferA} 4px, transparent 4px, transparent 8px)`;
export const hatchOpen = `repeating-linear-gradient(45deg, ${CLR.factOpenA}, ${CLR.factOpenA} 5px, transparent 5px, transparent 10px)`;
/** Тонкая штриховка зоны конфликта данных (рейс ↔ простой) — предупреждение, не маскировка. */
export const conflictHatch = 'repeating-linear-gradient(45deg, rgba(190,18,60,0.30), rgba(190,18,60,0.30) 2px, transparent 2px, transparent 6px)';
/** Нейтральная штриховка промежутка «Ожидание выезда». */
export const waitHatch = 'repeating-linear-gradient(45deg, rgba(100,116,139,0.22), rgba(100,116,139,0.22) 2px, transparent 2px, transparent 7px)';
/** Тона маркеров стыков: янтарный — расхождение с учётом (выехала раньше/позже). */
export const MARKER_TONE = {
  'early-departure': { fg: '#B45309', bg: '#FFF4DE', border: '#E3B04B' },
  departure: { fg: '#475569', bg: 'rgba(255,255,255,0.97)', border: '#CBD5E1' },
  arrival: { fg: '#0F6246', bg: 'rgba(255,255,255,0.97)', border: '#8FC9AE' },
} as const;

/** Единый набор иконок статусов/предупреждений (вместо эмодзи), один размер. */
export const BAR_ICON_CLS = 'w-3 h-3 shrink-0';
export const STATUS_ICON = {
  violated: { Icon: OctagonX, color: '#BE123C', label: 'срок нарушен (подтверждён фактом)' },
  missed: { Icon: Hourglass, color: '#B45309', label: 'плановая дата прошла, факт не указан' },
  risk: { Icon: TriangleAlert, color: '#B45309', label: 'критический срок под угрозой' },
} as const;

/**
 * Иконки ТИПОВ ЭТАПОВ — одна иконка на тип, один размер (как у статусов).
 * Нужны клеткам этапов: иконка события центрируется в своей доле дня и
 * остаётся узнаваемой, когда текст не помещается (мелкий масштаб).
 * Цвет иконки — цвет текста клетки (палитра типов в lib/stageFills), значения
 * типов не меняются: незнакомые типы получают нейтральную иконку (CircleDashed).
 */
export const STAGE_ICON: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean | 'true' | 'false' }>> = {
  load: Package,
  cust_out: FileOutput,
  border: Flag,
  cust_in: FileInput,
  unl: PackageOpen,
  reserve: CalendarClock,
};

/** Иконка типа этапа (fallback — нейтральная пунктирная окружность). */
export const stageIconOf = (type: string): React.ComponentType<{ className?: string; style?: React.CSSProperties; 'aria-hidden'?: boolean | 'true' | 'false' }> =>
  STAGE_ICON[String(type || '')] || CircleDashed;

/**
 * Z-ШКАЛА СЛОЁВ ПОЛОТНА — ЕДИНЫЙ источник порядка наложения.
 *
 * Действует во всех местах, где рисуются полосы и данные рейса: основное
 * полотно (TimelineGrid), встроенный мини-таймлайн (CarMiniTimeline в окнах
 * рейса, машины и «Учёта выезда») и демо-фрагменты гайда (guide/) — чтобы
 * порядок слоёв не расходился между экранами. Произвольные z-index в этих
 * местах запрещены: только значения этой шкалы.
 *
 * Шкала (снизу вверх, внутри подстроки машины — своего стека у каждой строки):
 *   bg      — фон/сетка/выходные/зебра и подложки-подсветки периодов;
 *   crosshair — перекрёстная подсветка столбца дня (мягкий оверлей под
 *             полосами; обновляется без перерисовки, pointer-events: none);
 *   bz      — полосы базы/ремонта и промежутки «Ожидание выезда»;
 *   tripBar — полосы рейса ПЛАН и ФАКТ (цветные сегменты факта — внутри полосы);
 *   stage   — КЛЕТКИ И ИКОНКИ ЭТАПОВ и однодневные отметки базы/ремонта:
 *             этапы ВСЕГДА поверх полос плана и факта, независимо от порядка
 *             отрисовки и hover;
 *   mark    — метки: бейдж «×N» и засечки кругов рейса, направления,
 *             плановое возвращение, стыки смены, события, конфликты данных,
 *             маркеры «выехала раньше» и др.;
 *   overlay — сегодняшняя линия и служебные подсветки (не перехватывают клик).
 *
 * Хром полотна (вне подстрок): закреплённая колонка машин и липкие шапки —
 * отдельные значения той же шкалы (colFill < colCell < colSubHead < head <
 * headCorner), резайзер и всплывающие панели модуля — resizer/popup.
 */
export const TL_Z = {
  bg: 0,
  /** Перекрёстная подсветка столбца дня — ПОД полосами, поверх фона/сетки. */
  crosshair: 0.5,
  bz: 1,
  tripBar: 2,
  stage: 3,
  mark: 4,
  overlay: 5,
  /** Заливка шапки группы (заполнитель над датами) — ниже левой ячейки шапки. */
  colFill: 11,
  /** Закреплённая колонка «Автомобили» в строках машин. */
  colCell: 12,
  /** Левая ячейка липкой шапки группы диспетчера. */
  colSubHead: 13,
  /** Липкая шапка календаря (месяцы + дни). */
  head: 14,
  /** Угловая ячейка шапки (закреплена и слева, и сверху). */
  headCorner: 15,
  /** Резайзер ширины колонки машин. */
  resizer: 40,
  /** Всплывающие панели модуля (например, попап «Обозначения»). */
  popup: 60,
} as const;

/** Единый стиль бейджа кругов рейса «×N» — ОДИН источник для полотна
 *  (marksOverlay полос ПЛАН/ФАКТ), легенды и демо-фрагментов гайда. */
export const tripCircleBadgeStyle = (): React.CSSProperties => ({
  background: 'rgba(255,255,255,0.78)',
  border: '1px solid rgba(18,19,22,0.28)',
  color: '#2E3440',
});

/** Классы бейджа «×N» (шрифт/размер — общие для всех мест). */
export const TRIP_CIRCLE_BADGE_CLS =
  'inline-flex items-center justify-center shrink-0 h-[13px] px-1 rounded-[4px] text-[8px] leading-none font-bold tabular-nums select-none';

/** Тонкая засечка начала круга на полосе (линия + номер круга). */
export const TRIP_CIRCLE_TICK_CLS = 'absolute top-0 bottom-0 flex items-center gap-[2px] pointer-events-none';
/** Цвета засечки — нейтральные (серый графит), без акцентных оттенков. */
export const TRIP_CIRCLE_TICK_LINE = 'rgba(18,19,22,0.35)';
export const TRIP_CIRCLE_TICK_TEXT = 'rgba(18,19,22,0.60)';

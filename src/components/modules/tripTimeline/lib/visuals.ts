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
import { Hourglass, OctagonX, TriangleAlert } from 'lucide-react';

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
  return: '#2563EB',
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

/** Единый стиль бейджа круга: у одного круга — приглушённый, у двух+ — заметный;
 *  незавершённый («круг идёт») — пунктирная обводка. */
export const circleBadgeStyle = (total: number, ongoing: boolean): React.CSSProperties =>
  total >= 2
    ? { background: 'var(--accent-10)', border: `1px ${ongoing ? 'dashed' : 'solid'} var(--accent-40)`, color: '#8A4A12' }
    : { background: 'rgba(255,255,255,0.9)', border: `1px ${ongoing ? 'dashed' : 'solid'} #C3C8CF`, color: '#5B6472' };

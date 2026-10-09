/**
 * ЕДИНАЯ подпись плановой полосы рейса — общая для всех мест модуля:
 * основной таймлайн (включая архивные полосы), встроенный таймлайн карточки
 * рейса (в т.ч. архивной карточки) и обзор рейсов машины.
 *
 * Состав подписи: полный маршрут по городам из связанной записи «Плана дохода»
 * + плановая продолжительность в днях.
 *
 *  - маршрут собирается ТОЙ ЖЕ логикой, что в карточках маршрутов «Дохода»:
 *    идём по плечам from/to и добавляем город, если он отличается от
 *    предыдущего, — промежуточные и повторные посещения сохраняются в порядке
 *    плана, ограничения «первый → последний город» больше нет;
 *  - продолжительность считается ТОЙ ЖЕ функцией calculateTripFinances, что
 *    использует сам «План дохода» (days = обе даты включительно); если дат
 *    нет — число не показываем вовсе, вымышленные значения запрещены;
 *  - полоса не растягивается ради текста: подпись живёт внутри геометрии
 *    полосы (ширина только от дат), сокращается многоточием, а полный маршрут
 *    и продолжительность всегда доступны в подсказке (title).
 */
import React from 'react';
import type { LegPlan } from '../../../types';
import { calculateTripFinances } from '../../../utils/financeCalculators';
import { plural } from '../../../ui/kit';
import { dayStr } from './lib/timeline';
import type { WholeTrip } from './lib/sources';

export interface PlanBarParts {
  /** Основной текст полосы: полный маршрут по городам или нейтральная подпись. */
  main: string;
  /** Хвост подписи: « / План · 12 дней» (пусто, когда маршрута/дней нет). */
  meta: string;
  /** Полный маршрут по городам ('' — маршрута нет). */
  route: string;
  /** «12 дней» ('' — дат нет, число не выдумываем). */
  daysText: string;
  /** Полный текст маршрута и продолжительности для подсказки (title). */
  titleText: string;
}

/**
 * Цепочка городов по плечам — существующая логика отображения маршрута в
 * «Доходе» (CalculationCard / печатная форма): последовательные дубликаты
 * городов не повторяются, порядок и повторные посещения сохраняются.
 */
export const routeChainFromLegs = (legs: Array<{ from?: string; to?: string }> | undefined): string => {
  const points: string[] = [];
  (legs || []).forEach((l) => {
    const from = String(l?.from || '').trim();
    const to = String(l?.to || '').trim();
    if (from && points[points.length - 1] !== from) points.push(from);
    if (to && points[points.length - 1] !== to) points.push(to);
  });
  return points.join(' → ');
};

/** Массив плеч без падений на RTDB-объектах (массив может прийти как map). */
const asLegList = (raw: unknown): LegPlan[] => {
  if (Array.isArray(raw)) return raw as LegPlan[];
  if (raw && typeof raw === 'object') return Object.values(raw as Record<string, LegPlan>);
  return [];
};

/**
 * Плановая продолжительность в днях — тем же расчётом, что в «Плане дохода».
 * Дат нет (или битые) — null: вымышленное число не показываем.
 */
export const planDurationDays = (t: WholeTrip): number | null => {
  const raw = t.planRaw;
  let startIso = raw ? String(raw.dateStart || '') : '';
  let endIso = raw ? String(raw.dateEnd || '') : '';
  if (!startIso || !endIso) {
    // Ручной рейс (или план без дат): пробуем собственные плановые границы рейса.
    const ov = t.spanOverride || {};
    if (ov.pMin != null && ov.pMax != null) {
      startIso = dayStr(ov.pMin);
      endIso = dayStr(ov.pMax);
    }
  }
  if (!startIso || !endIso) return null;
  const fin = calculateTripFinances(
    raw ? asLegList(raw.legs) : [],
    startIso,
    endIso,
    raw ? Number(raw.extraExpense) || 0 : 0,
    raw ? Number(raw.ferryCost) || 0 : 0,
    raw ? Number(raw.factKm) || 0 : 0,
  );
  const days = fin?.days;
  return typeof days === 'number' && Number.isFinite(days) && days > 0 ? days : null;
};

/** Единая сборка подписи плановой полосы: маршрут + продолжительность. */
export const planBarLabelParts = (t: WholeTrip): PlanBarParts => {
  const route =
    t.kind === 'plan'
      ? routeChainFromLegs(t.plan?.legs)
      : String(t.route || '').trim();
  const days = planDurationDays(t);
  const daysText = days != null ? `${days} ${plural(days, 'день', 'дня', 'дней')}` : '';
  const neutral = t.kind === 'plan' ? 'Рейс по плану' : 'Ручной рейс';
  const main = route || neutral;
  const meta = daysText ? (route ? ` / План · ${daysText}` : ` · ${daysText}`) : '';
  const titleText = route
    ? `маршрут: ${route}${daysText ? ` · плановая продолжительность: ${daysText}` : ''}`
    : `${neutral}${daysText ? ` · плановая продолжительность: ${daysText}` : ' · продолжительность не рассчитана (нет дат)'}`;
  return { main, meta, route, daysText, titleText };
};

/** Оценка, поместится ли хвост « / План · N дней» в полосу данной ширины. */
const metaFits = (meta: string, width: number | undefined, fontPx: number): boolean => {
  if (!meta) return false;
  if (width == null) return true;
  return width >= meta.length * (fontPx * 0.56) + 10;
};

/**
 * Подпись полосы: маршрут сокращается многоточием, дни сохраняются, если
 * помещаются; полный текст — в подсказке полосы (title задаёт вызывающий).
 */
export function PlanBarLabel({
  parts,
  prefix = '',
  lead,
  width,
  fontPx = 10,
  className = '',
}: {
  parts: PlanBarParts;
  /** Текстовый префикс перед маршрутом (совместимость; в редизайне не используется). */
  prefix?: string;
  /** Ведущий SVG-значок статуса (единый набор иконок вместо эмодзи). */
  lead?: React.ReactNode;
  /** Ширина полосы в px — чтобы не показывать хвост, которому нет места. */
  width?: number;
  /** Кегль подписи (10 — основной таймлайн, 9 — встроенный). */
  fontPx?: number;
  className?: string;
}) {
  const showMeta = metaFits(parts.meta, width, fontPx);
  return (
    <span className={`flex items-center w-full min-w-0 ${className}`}>
      {lead ? <span className="inline-flex items-center shrink-0 mr-1">{lead}</span> : null}
      <span className="truncate min-w-0">
        {prefix}
        {parts.main}
      </span>
      {showMeta ? <span className="whitespace-nowrap shrink-0">{parts.meta}</span> : null}
    </span>
  );
}

export default PlanBarLabel;

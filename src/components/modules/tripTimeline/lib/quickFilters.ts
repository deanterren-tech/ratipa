/**
 * Быстрые фильтры таймлайна: «Просрочено», «Срок ≤2 дня», «Без факта».
 *
 * Фильтр — только видимость машин (строк): данные не меняются. Машина попадает
 * в фильтр, если у неё есть рейс, который СЕЙЧАС в этом состоянии:
 *   late   — идущий рейс, чья статус-линия на конце красная, либо рейс без
 *            факта, плановый старт которого уже прошёл;
 *   soon   — идущий рейс, чья статус-линия на конце оранжевая (срок ≤2 дня);
 *   noFact — рейс, у которого фактические даты не указаны.
 * Чистая функция: ничего не читает и не пишет.
 */
import type { StatusLineSegment } from './statusLine';

export type QuickFilterKey = 'late' | 'soon' | 'noFact';

export const QUICK_FILTER_KEYS: QuickFilterKey[] = ['late', 'soon', 'noFact'];

export const QUICK_FILTER_LABELS: Record<QuickFilterKey, string> = {
  late: 'Просрочено',
  soon: 'Срок ≤2 дня',
  noFact: 'Без факта',
};

/** Минимум полей элемента факта, нужных для расчёта (структурно совместим с FactItem). */
export type QuickFactItem =
  | { kind: 'fact'; open: boolean; status: StatusLineSegment[] }
  | { kind: 'factNone'; a: number }
  | { kind: string };

export type QuickFlags = Record<QuickFilterKey, boolean>;

export const quickFlagsOfItems = (items: QuickFactItem[], today: number): QuickFlags => {
  const flags: QuickFlags = { late: false, soon: false, noFact: false };
  for (const it of items) {
    if (it.kind === 'fact') {
      const f = it as Extract<QuickFactItem, { kind: 'fact' }>;
      if (!f.open || !f.status.length) continue;
      const last = f.status[f.status.length - 1].state;
      if (last === 'late') flags.late = true;
      else if (last === 'soon') flags.soon = true;
    } else if (it.kind === 'factNone') {
      const n = it as Extract<QuickFactItem, { kind: 'factNone' }>;
      flags.noFact = true;
      if (n.a < today) flags.late = true;
    }
  }
  return flags;
};

export const countQuickFlags = (all: QuickFlags[]): Record<QuickFilterKey, number> => {
  const out: Record<QuickFilterKey, number> = { late: 0, soon: 0, noFact: 0 };
  for (const f of all) QUICK_FILTER_KEYS.forEach((k) => { if (f[k]) out[k] += 1; });
  return out;
};

/** Машина проходит фильтр, если совпадает с ЛЮБЫМ из выбранных чипов (пусто — все). */
export const passesQuickFilter = (flags: QuickFlags, active: QuickFilterKey[]): boolean =>
  active.length === 0 || active.some((k) => flags[k]);

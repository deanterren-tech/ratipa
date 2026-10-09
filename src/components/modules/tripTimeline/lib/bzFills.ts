/**
 * Заливки отметок «Учёта выезда» (база и ремонт) на таймлайне: каждая отметка —
 * ЦВЕТНАЯ ЗАЛИВКА ЯЧЕЙКИ ДНЯ на всю высоту своей подстроки, а не тонкая полоска.
 *
 * Подстроки не смешиваются:
 *  - «План»: план базы (приезд → срок готовности) и СРОК ГОТОВНОСТИ (его день);
 *  - «Факт»: факт базы (приезд → фактический выезд), период ремонта, ДАТА
 *    ОКОНЧАНИЯ РЕМОНТА и промежутки «на базе» без записи учёта выезда.
 *
 * Границы периодов берутся из СУЩЕСТВУЮЩИХ функций источников
 * (readyBarRange / baseBarRange / repairBarRange) — данные, расчёт периодов и
 * правила готовности не меняются, только способ отображения. Несколько отметок
 * в одном дне делят ячейку на цветные секции (общий механизм layoutDaySections,
 * тот же, что у заливок этапов): друг друга не скрывают, каждая кликабельна и
 * ведёт к своей записи периода.
 */
import {
  baseBarRange,
  baseDeviation,
  readyBarRange,
  repairBarRange,
  type BasePeriod,
} from './sources';
import { fmtDM } from './timeline';
import { layoutDaySections, type DaySectionSpan } from './stageFills';

export type BzFillKind = 'base-plan' | 'ready' | 'base-fact' | 'repair' | 'repair-end' | 'base-gap';

export interface BzFillColor {
  /** Мягкая заливка дня. */
  bg: string;
  /** Рамка секции (та же гамма, темнее). */
  border: string;
  /** Цвет текста внутри секции. */
  text: string;
}

/**
 * Цветовая семантика отметок базы/ремонта (сохранена, но переведена в мягкие
 * заливки): янтарный — план базы и готовность (готовность насыщеннее), серый —
 * факт базы, оранжевый — ремонт (окончание ремонта темнее), светло-серый
 * пунктирный — промежутки «на базе» без записи учёта. Палитра — единая тёплая
 * семья мелких заливок, текст фрагментов держит контраст WCAG AA (≥ 4.5:1).
 */
export const BZ_COLORS: Record<BzFillKind, BzFillColor> = {
  'base-plan': { bg: '#FCF1CC', border: '#EDC358', text: '#7A5410' },
  ready: { bg: '#F9DC84', border: '#C98A18', text: '#6E4408' },
  'base-fact': { bg: '#EAECF0', border: '#A6ADBA', text: '#444B57' },
  repair: { bg: '#FDDCC0', border: '#EF9A57', text: '#8F3D0B' },
  'repair-end': { bg: '#FBC193', border: '#CE6A1E', text: '#732E06' },
  'base-gap': { bg: '#F4F5F8', border: '#C9CFD8', text: '#667080' },
};

export const bzKindColor = (kind: BzFillKind): BzFillColor => BZ_COLORS[kind];

/** Отметка записи «Учёта выезда» (план базы, готовность, факт базы, ремонт, окончание ремонта). */
export interface BzFillInput {
  period: BasePeriod;
  /**
   * Показывать окончание ремонта отдельной секцией (заливка дня даты
   * dateRepairEnd). В основной сетке — да; во встроенном таймлайне — тоже да.
   */
  withRepairEnd?: boolean;
}

/** Промежуток «на базе» между рейсами без записи учёта выезда (из рейсов машины). */
export interface BzFillGap {
  a: number;
  b: number;
  days: number;
}

export interface BzFillSection {
  kind: BzFillKind;
  /** День (номер дня), который закрашивает секция. */
  day: number;
  /** Ключ записи учёта выезда (bz:<id>) — клик открывает период; у промежутка без записи null. */
  periodKey: string | null;
  archived: boolean;
  /** Номер секции в дне (0..sections-1) и их общее число. */
  section: number;
  sections: number;
  /** Подпись внутри секции (показывается, если хватает ширины). */
  label: string;
  /** Полная подсказка секции. */
  title: string;
}

interface BzSpan extends DaySectionSpan {
  kind: BzFillKind;
  periodKey: string | null;
  archived: boolean;
  label: string;
  title: string;
}

/**
 * Раскладка отметок базы/ремонта по дням окна для указанной подстроки.
 * Каждая отметка закрашивает ВСЕ дни своего интервала; несколько отметок в
 * одном дне — стабильные секции (order: база → ремонт → окончание ремонта →
 * промежуток), как у этапов. Пустая подстрока — пустой массив.
 */
export const layoutBzFills = (
  inputs: BzFillInput[],
  gaps: BzFillGap[],
  kind: 'plan' | 'fact',
  vs: number,
  ve: number,
  today: number,
): BzFillSection[] => {
  const spans: BzSpan[] = [];
  inputs.forEach(({ period: p, withRepairEnd = true }) => {
    const arch = p.archived ? ' · архив' : '';
    const dev = baseDeviation(p, today);
    if (kind === 'plan') {
      // План базы: приезд → срок готовности (та же функция границ, что у полосы).
      const rdy = readyBarRange(p);
      if (rdy) {
        spans.push({
          a: rdy.a,
          b: rdy.b,
          order: 0,
          tie: p.key,
          kind: 'base-plan',
          periodKey: p.key,
          archived: p.archived,
          label: 'план базы',
          title: `План базы${arch}: приезд ${fmtDM(rdy.a)} → срок готовности ${fmtDM(rdy.b)} · ${rdy.b - rdy.a + 1} дн${dev.short ? ` · ${dev.label}` : ''} · клик — открыть период`,
        });
      }
      // Срок готовности: заливка всего дня плановой готовности.
      if (p.plannedReadyDay != null) {
        spans.push({
          a: p.plannedReadyDay,
          b: p.plannedReadyDay,
          order: 1,
          tie: p.key,
          kind: 'ready',
          periodKey: p.key,
          archived: p.archived,
          label: 'готовность',
          title: `Срок готовности (плановый)${arch}: ${fmtDM(p.plannedReadyDay)}${
            p.arrivalDay != null ? ` (план базы с ${fmtDM(p.arrivalDay)})` : ''
          } — ${dev.label}${p.comment ? ` · ${p.comment}` : ''} · клик — открыть период`,
        });
      }
      return;
    }
    // Факт базы: приезд → фактический выезд (открытый период — та же граница, что была у полосы).
    const rb = baseBarRange(p, today);
    if (rb) {
      const readyTxt = p.plannedReadyDay != null ? fmtDM(p.plannedReadyDay) : 'не указан';
      spans.push({
        a: rb.a,
        b: rb.b,
        order: 0,
        tie: p.key,
        kind: 'base-fact',
        periodKey: p.key,
        archived: p.archived,
        label: `${p.causeLabel}${dev.short ? ` · ${dev.short}` : ''}`,
        title: `База (факт)${arch}: приезд ${fmtDM(rb.a)} – ${
          rb.open ? 'выезд не указан (период продолжается)' : fmtDM(rb.b)
        } · срок готовности ${readyTxt} · ${dev.label}${p.comment ? ` · ${p.comment}` : ''} · клик — открыть период`,
      });
    }
    // Период ремонта: свои даты записи (открытый/обрезанный выездом — как было).
    const rr = repairBarRange(p, today);
    if (rr) {
      spans.push({
        a: rr.a,
        b: rr.b,
        order: 1,
        tie: p.key,
        kind: 'repair',
        periodKey: p.key,
        archived: p.archived,
        label: 'ремонт',
        title: `Ремонт${arch}: ${fmtDM(rr.a)} – ${
          rr.open ? 'продолжается (окончание не указано)' : fmtDM(rr.b)
        }${rr.capped ? ' · показан до фактического выезда (ремонт не закрыт)' : ''} · клик — открыть период`,
      });
    }
    // Дата окончания ремонта: заливка всего дня (когда окончание указано в записи).
    if (withRepairEnd && p.repairEndDay != null) {
      spans.push({
        a: p.repairEndDay,
        b: p.repairEndDay,
        order: 2,
        tie: p.key,
        kind: 'repair-end',
        periodKey: p.key,
        archived: p.archived,
        label: 'окончание',
        title: `Дата окончания ремонта${arch}: ${fmtDM(p.repairEndDay)}${
          p.repairStartDay != null ? ` (ремонт с ${fmtDM(p.repairStartDay)})` : ''
        }${p.departureDay != null && p.departureDay === p.repairEndDay ? ' · совпадает с фактическим выездом' : ''} · клик — открыть период`,
      });
    }
  });
  if (kind === 'fact') {
    gaps.forEach((g) => {
      spans.push({
        a: g.a,
        b: g.b,
        order: 3,
        tie: `gap|${String(g.a).padStart(7, '0')}|${g.b}`,
        kind: 'base-gap',
        periodKey: null,
        archived: false,
        label: `на базе · ${g.days} дн`,
        title: `Между рейсами: ${g.days} дн (записи учёта выезда нет)`,
      });
    });
  }
  return layoutDaySections(spans, vs, ve).map(({ span, day, section, sections }) => ({
    kind: span.kind,
    day,
    periodKey: span.periodKey,
    archived: span.archived,
    section,
    sections,
    label: span.label,
    title: span.title,
  }));
};

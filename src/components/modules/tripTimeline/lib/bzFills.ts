/**
 * Отметки «Учёта выезда» (база и ремонт) на таймлайне.
 *
 * Новая модель отображения (ремонт регрессий нового дизайна):
 *  - БАЗА И РЕМОНТ — НЕПРЕРЫВНЫЕ ПОЛОСЫ: один элемент на период (не по элементу
 *    на день), полоса занимает всю высоту своей подстроки, скругление — только
 *    на реальном начале/конце периода. Если период продолжается за видимую
 *    область — на краю обрыв без скругления с мягким градиентом (edgeL/edgeR).
 *  - СРОК ГОТОВНОСТИ и ДАТА ОКОНЧАНИЯ РЕМОНТА — однодневные ОТМЕТКИ на всю
 *    ячейку дня (заливка по всей ширине и высоте строки, SVG-иконка по центру
 *    рисуется сеткой). Если день отметки делится с этапами — секции дня
 *    (section/sections) делают обе отметки видимыми и кликабельными.
 *
 * Подстроки не смешиваются:
 *  - «План»: план базы (приезд → срок готовности) и СРОК ГОТОВНОСТИ (его день);
 *  - «Факт»: факт базы (приезд → фактический выезд), период ремонта, ДАТА
 *    ОКОНЧАНИЯ РЕМОНТА и промежутки «на базе» без записи учёта выезда.
 *
 * Границы периодов берутся из СУЩЕСТВУЮЩИХ функций источников
 * (readyBarRange / baseBarRange / repairBarRange) — данные, расчёт периодов и
 * правила готовности не меняются, только способ отображения.
 */
import {
  baseBarRange,
  baseDeviation,
  readyBarRange,
  repairBarRange,
  type BasePeriod,
} from './sources';
import { fmtDM } from './timeline';
import { EARLY_DEPARTURE_TIMELINE_NOTE, vyezdStatusOf, vyezdSummaryOf, VYEZD_STATUS, type VyezdStatusKind, type VyezdTripRange } from './vyezd';

export type BzFillKind = 'base-plan' | 'ready' | 'base-fact' | 'repair' | 'repair-end' | 'base-gap';

export interface BzFillColor {
  /** Мягкая заливка полосы/секции. */
  bg: string;
  /** Рамка (та же гамма, темнее). */
  border: string;
  /** Цвет текста внутри. */
  text: string;
}

/**
 * Цветовая семантика отметок базы/ремонта (не менялась): янтарный — план базы
 * и готовность (готовность насыщеннее), серый — факт базы, оранжевый — ремонт
 * (окончание ремонта темнее), светло-серый пунктирный — промежутки «на базе»
 * без записи учёта. Текст фрагментов держит контраст WCAG AA (≥ 4.5:1).
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

/**
 * Цвет полосы с учётом статуса: у «фактического» периода «Учёта выезда»
 * (base-fact) цвет зависит от состояния — учёт ведётся / период закрыт /
 * выезд не зафиксирован / расхождение с рейсом (см. lib/vyezd).
 */
export const bzStripeColor = (s: { kind: BzStripe['kind']; status?: VyezdStatusKind }): BzFillColor =>
  s.kind === 'base-fact' && s.status ? VYEZD_STATUS[s.status] : bzKindColor(s.kind);

/** Отметка записи «Учёта выезда» (план базы, готовность, факт базы, ремонт, окончание ремонта). */
export interface BzFillInput {
  period: BasePeriod;
  /**
   * Показывать окончание ремонта отдельной отметкой (заливка дня даты
   * dateRepairEnd). В основной сетке — да; во встроенном таймлайне — тоже да.
   */
  withRepairEnd?: boolean;
  /**
   * Рейсы машины (план, как в существующей проверке пересечений) — для статуса
   * периода, подсказки и сводки дней. Границы берутся из источников, не выдумываются.
   */
  tripRanges?: VyezdTripRange[];
}

/** Промежуток «на базе» между рейсами без записи учёта выезда (из рейсов машины). */
export interface BzFillGap {
  a: number;
  b: number;
  days: number;
}

/**
 * Край полосы: 'round' — реальное начало/конец периода (скругление);
 * 'cut' — период продолжается за видимую область (обрыв без скругления);
 * 'fade' — открытый период (продолжается в будущее, мягкий градиент).
 */
export type BzEdge = 'round' | 'cut' | 'fade';

/** Непрерывная полоса периода: ОДИН элемент на период (рендерится сеткой). */
export interface BzStripe {
  kind: 'base-plan' | 'base-fact' | 'repair' | 'base-gap';
  /** Реальные первый/последний день периода (включительно), без клипа по окну. */
  a: number;
  b: number;
  edgeL: BzEdge;
  edgeR: BzEdge;
  /** Под-дорожка внутри подстроки (пересечения РАЗНЫХ записей одного вида). */
  lane: number;
  lanes: number;
  /** Ключ записи учёта выезда (bz:<id>) — клик открывает период; у промежутка без записи null. */
  periodKey: string | null;
  archived: boolean;
  /**
   * Статус периода «Учёта выезда» (только base-fact): цвет и иконка полосы.
   * На таймлайне конфликт, ПОЛНОСТЬЮ объяснённый правилом «выехала раньше»,
   * показывается нейтральным статусом 'early-departure' (смягчение только
   * отображения; в модуле «Учёт выезда» статус остаётся конфликтом).
   */
  status?: VyezdStatusKind;
  /** Короткая подпись внутри полосы (если хватает ширины). */
  label: string;
  /** Ещё более короткая подпись для узких полос («Простой на базе»). */
  shortLabel?: string;
  /** Даты периода для подписи — «13/07 – 18/08» (ремонт/учёт выезда; открытый — без конца). */
  dateLabel: string;
  /** Подпись обязана оставаться видимой при прокрутке (sticky внутри полосы). */
  stickyLabel: boolean;
  /** Полная подсказка полосы. */
  title: string;
}

/** Однодневная отметка на всю ячейку дня: срок готовности / дата окончания ремонта. */
export interface BzMark {
  kind: 'ready' | 'repair-end';
  day: number;
  /**
   * Индекс секции дня (порядок заявок дня) и число ЗАЯВОК дня — полос/отметок
   * записей без этапов. Этапы при отрисовке добавляются к sections той же
   * секционной раскладкой (см. layoutStageFills с claimsByDay).
   */
  section: number;
  sections: number;
  periodKey: string;
  archived: boolean;
  /** Подпись для легенды/подсказки («готовность», «окончание»). */
  label: string;
  /** Полная подсказка: дата и статус. */
  title: string;
}

export interface BzLayout {
  stripes: BzStripe[];
  marks: BzMark[];
  /** День → число заявок (полос/отметок записей) в этой подстроке. Для разрезки этапов. */
  dayClaims: Record<number, number>;
}

/** Порядок заявок внутри дня (секции слева направо): база → ремонт → отметки → промежуток. */
const CLAIM_TIER: Record<string, number> = {
  'base-plan': 0,
  'base-fact': 0,
  repair: 1,
  ready: 2,
  'repair-end': 2,
  'base-gap': 3,
};

/**
 * Под-дорожки для пересекающихся полос ОДНОГО вида (разные записи). Одиночная
 * полоса получает lane=0/lanes=1 и рисуется на всю высоту подстроки. Алгоритм —
 * жадная раскладка по кластерам пересечений; результат детерминирован.
 */
const assignLanes = (stripes: BzStripe[]): void => {
  const byKind = new Map<string, BzStripe[]>();
  stripes.forEach((s) => {
    const arr = byKind.get(s.kind);
    if (arr) arr.push(s);
    else byKind.set(s.kind, [s]);
  });
  byKind.forEach((arr) => {
    const sorted = [...arr].sort(
      (x, y) => x.a - y.a || x.b - y.b || (x.periodKey || '').localeCompare(y.periodKey || ''),
    );
    let cluster: BzStripe[] = [];
    let clusterEnd = Number.NEGATIVE_INFINITY;
    const flush = () => {
      if (!cluster.length) return;
      const laneEnds: number[] = [];
      cluster.forEach((s) => {
        let li = laneEnds.findIndex((end) => s.a > end);
        if (li === -1) {
          laneEnds.push(s.b);
          li = laneEnds.length - 1;
        } else {
          laneEnds[li] = s.b;
        }
        s.lane = li;
      });
      const n = laneEnds.length;
      cluster.forEach((s) => {
        s.lanes = n;
      });
      cluster = [];
    };
    sorted.forEach((s) => {
      if (cluster.length && s.a > clusterEnd) flush();
      const wasEmpty = cluster.length === 0;
      cluster.push(s);
      clusterEnd = wasEmpty ? s.b : Math.max(clusterEnd, s.b);
    });
    flush();
  });
};

/**
 * Раскладка отметок базы/ремонта по окну [vs, ve] для указанной подстроки.
 * Возвращает непрерывные полосы периодов (один элемент на период) и
 * однодневные отметки, а также число заявок по дням (для секционной раскладки
 * этапов). Пустая подстрока — пустой результат.
 */
export const layoutBzFills = (
  inputs: BzFillInput[],
  gaps: BzFillGap[],
  kind: 'plan' | 'fact',
  vs: number,
  ve: number,
  today: number,
): BzLayout => {
  const stripes: BzStripe[] = [];
  const marksRaw: Array<Omit<BzMark, 'section' | 'sections'>> = [];
  const inWindow = (a: number, b: number): boolean => b >= vs && a <= ve;

  inputs.forEach(({ period: p, withRepairEnd = true, tripRanges = [] }) => {
    const arch = p.archived ? ' · архив' : '';
    const dev = baseDeviation(p, today);
    if (kind === 'plan') {
      // План базы: приезд → срок готовности (та же функция границ, что у полосы).
      const rdy = readyBarRange(p);
      if (rdy && inWindow(rdy.a, rdy.b)) {
        stripes.push({
          kind: 'base-plan',
          a: rdy.a,
          b: rdy.b,
          edgeL: rdy.a < vs ? 'cut' : 'round',
          edgeR: rdy.b > ve ? 'cut' : 'round',
          lane: 0,
          lanes: 1,
          periodKey: p.key,
          archived: p.archived,
          label: 'Плановый простой на базе',
          shortLabel: 'Простой на базе',
          dateLabel: `${fmtDM(rdy.a)} – ${fmtDM(rdy.b)}`,
          stickyLabel: false,
          title: `Плановый простой на базе${arch}: приезд ${fmtDM(rdy.a)} → срок готовности ${fmtDM(rdy.b)} · ${rdy.b - rdy.a + 1} дн${dev.short ? ` · ${dev.label}` : ''} · клик — открыть период`,
        });
      }
      // Плановое окончание базы (срок готовности): однодневная отметка на всю ячейку дня.
      if (p.plannedReadyDay != null && inWindow(p.plannedReadyDay, p.plannedReadyDay)) {
        marksRaw.push({
          kind: 'ready',
          day: p.plannedReadyDay,
          periodKey: p.key,
          archived: p.archived,
          label: 'плановое окончание базы',
          title: `Плановое окончание базы (срок готовности)${arch}: ${fmtDM(p.plannedReadyDay)}${
            p.arrivalDay != null ? ` (простой на базе с ${fmtDM(p.arrivalDay)})` : ''
          } — к этой дате машина готова к выезду; ${dev.label}${p.comment ? ` · ${p.comment}` : ''} · клик — открыть период`,
        });
      }
      return;
    }
    // Факт базы: приезд → фактический выезд (открытый период — та же граница, что была у полосы).
    // Полоса «Учёт выезда»: цельная, статус (ведётся/закрыт/не зафиксирован/расхождение)
    // отражён цветом и иконкой; подсказка — машина, период, дни, статус, показатели,
    // расхождения и причина простым языком.
    const rb = baseBarRange(p, today);
    if (rb && inWindow(rb.a, rb.b)) {
      const readyTxt = p.plannedReadyDay != null ? fmtDM(p.plannedReadyDay) : 'не указан';
      const status = vyezdStatusOf(p, today, tripRanges);
      const sum = vyezdSummaryOf(p, today, tripRanges);
      // Смягчение ТОЛЬКО случая «ранний выезд» и только на таймлайне: все
      // настоящие пересечения периода объясняются правилом «выехала раньше»
      // (lib/overlap, правило 1) — полоса укорочена до дня выезда, на стыке
      // маркер «выехал на N дн. раньше». Красный конфликт и зелёный «закрыт»
      // для этого случая показываются нейтрально; статусы модуля «Учёт
      // выезда» (окно периода) не меняются.
      const softenedOnTimeline = status.earlyDepartureOnly && (status.kind === 'conflict' || status.kind === 'closed');
      const stripeStatus: VyezdStatusKind = softenedOnTimeline ? 'early-departure' : status.kind;
      const titleLines = [
        `${rb.open ? 'Готовится к выезду' : 'Фактический простой на базе'} · ${p.carNumber}${p.dispatcherName ? ` · ${p.dispatcherName}` : ''}${arch}`,
        `Период: приезд ${fmtDM(rb.a)} – ${rb.open ? 'выезд не указан (период продолжается)' : fmtDM(rb.b)} · ${sum.total} дн на базе · срок готовности ${readyTxt}`,
        ...(rb.open ? ['Дата выезда не указана — простой продолжается, учёт ведётся.'] : []),
        softenedOnTimeline
          ? `Статус: ранний выезд — расхождение объяснено: машина выехала раньше учётного срока, простой укорочен до дня выезда (маркер на стыке дня; данные учёта не изменены). ${EARLY_DEPARTURE_TIMELINE_NOTE}`
          : `Статус: ${status.label} — ${status.reason}`,
      ];
      const realTrips = sum.trips.filter((t) => !t.boundary);
      const boundaryTrips = sum.trips.filter((t) => t.boundary);
      if (realTrips.length) {
        const tripsTxt = realTrips.map((t) => `${t.label} ${fmtDM(t.a)} – ${fmtDM(t.b)} (${t.days} дн)`).join('; ');
        titleLines.push(`Рейсы внутри периода: ${realTrips.reduce((n, t) => n + t.days, 0)} дн — ${tripsTxt}`);
      } else {
        titleLines.push('Рейсы внутри периода: нет — весь период машина на базе');
      }
      if (boundaryTrips.length) {
        titleLines.push(
          `Стык с рейсом (день перехода, не расхождение): ${boundaryTrips
            .map(
              (t) =>
                `${t.label} ${fmtDM(t.a)} – ${fmtDM(t.b)} (${
                  p.departureDay != null && t.a === p.departureDay ? 'рейс начался в день выезда' : 'рейс завершился в день приезда'
                })`,
            )
            .join('; ')}`,
        );
      }
      if (sum.repairDays > 0) {
        titleLines.push(
          `Ремонт (${sum.repairDays} дн): ${fmtDM(p.repairStartDay as number)} – ${
            p.repairEndDay != null ? fmtDM(p.repairEndDay) : p.departureDay != null ? 'до выезда (окончание не указано)' : 'продолжается'
          }`,
        );
      }
      if (p.warnings.length) titleLines.push(`Предупреждения: ${p.warnings.join('; ')}`);
      if (p.comment) titleLines.push(`Примечание: ${p.comment}`);
      titleLines.push('Клик — открыть окно учёта выезда этой машины и периода');
      stripes.push({
        kind: 'base-fact',
        a: rb.a,
        b: rb.b,
        edgeL: rb.a < vs ? 'cut' : 'round',
        edgeR: rb.b > ve ? 'cut' : rb.open ? 'fade' : 'round',
        lane: 0,
        lanes: 1,
        periodKey: p.key,
        archived: p.archived,
        status: stripeStatus,
        label: rb.open ? 'Готовится к выезду' : 'Фактический простой на базе',
        shortLabel: rb.open ? 'Готовится к выезду' : 'Простой на базе',
        dateLabel: `${fmtDM(rb.a)} – ${rb.open ? '…' : fmtDM(rb.b)}`,
        stickyLabel: false,
        title: titleLines.join('\n'),
      });
    }
    // Период ремонта: одна непрерывная полоса (открытый/обрезанный выездом — как было).
    const rr = repairBarRange(p, today);
    if (rr && inWindow(rr.a, rr.b)) {
      const endTxt = rr.open ? 'продолжается (окончание не указано)' : fmtDM(rr.b);
      stripes.push({
        kind: 'repair',
        a: rr.a,
        b: rr.b,
        edgeL: rr.a < vs ? 'cut' : 'round',
        edgeR: rr.b > ve ? 'cut' : rr.open ? 'fade' : 'round',
        lane: 0,
        lanes: 1,
        periodKey: p.key,
        archived: p.archived,
        label: 'Ремонт',
        dateLabel: rr.open
          ? `с ${fmtDM(rr.a)}`
          : rr.capped
            ? `${fmtDM(rr.a)} – до выезда`
            : `${fmtDM(rr.a)} – ${fmtDM(rr.b)}`,
        // Подпись «Ремонт» обязана оставаться видимой при прокрутке.
        stickyLabel: true,
        title: `Ремонт${arch}: ${fmtDM(rr.a)} – ${endTxt}${
          rr.capped ? ' · показан до фактического выезда (ремонт не закрыт)' : ''
        } · клик — открыть период`,
      });
    }
    // Дата окончания ремонта: однодневная отметка на всю ячейку (когда окончание указано).
    if (withRepairEnd && p.repairEndDay != null && inWindow(p.repairEndDay, p.repairEndDay)) {
      marksRaw.push({
        kind: 'repair-end',
        day: p.repairEndDay,
        periodKey: p.key,
        archived: p.archived,
        label: 'окончание',
        title: `Дата окончания ремонта${arch}: ${fmtDM(p.repairEndDay)}${
          p.repairStartDay != null ? ` (ремонт с ${fmtDM(p.repairStartDay)})` : ''
        }${
          p.departureDay != null && p.departureDay === p.repairEndDay ? ' · совпадает с фактическим выездом' : ''
        } · ремонт закрыт · клик — открыть период`,
      });
    }
  });

  if (kind === 'fact') {
    gaps.forEach((g) => {
      if (!inWindow(g.a, g.b)) return;
      stripes.push({
        kind: 'base-gap',
        a: g.a,
        b: g.b,
        edgeL: g.a < vs ? 'cut' : 'round',
        edgeR: g.b > ve ? 'cut' : 'round',
        lane: 0,
        lanes: 1,
        periodKey: null,
        archived: false,
        label: `Простой на базе · ${g.days} дн`,
        shortLabel: `Простой · ${g.days} дн`,
        dateLabel: `${fmtDM(g.a)} – ${fmtDM(g.b)}`,
        stickyLabel: false,
        title: `Простой на базе между рейсами: ${g.days} дн — записи «Учёта выезда» нет (детальные даты периода не фиксировались).`,
      });
    });
  }

  assignLanes(stripes);

  // Заявки по дням: каждая запись — одна заявка; отметка (готовность/окончание)
  // «перекрывает» полосу своей же записи в своём дне — та же заявка, не вторая.
  const claimKeysByDay = new Map<number, Map<string, number>>();
  const addClaim = (day: number, key: string, tier: number) => {
    let byKey = claimKeysByDay.get(day);
    if (!byKey) {
      byKey = new Map<string, number>();
      claimKeysByDay.set(day, byKey);
    }
    const prev = byKey.get(key);
    if (prev == null || tier > prev) byKey.set(key, tier);
  };
  stripes.forEach((s) => {
    const key = s.periodKey || `gap|${s.a}|${s.b}`;
    const tier = CLAIM_TIER[s.kind] ?? 0;
    for (let d = Math.max(s.a, vs); d <= Math.min(s.b, ve); d += 1) addClaim(d, key, tier);
  });
  marksRaw.forEach((m) => addClaim(m.day, m.periodKey, CLAIM_TIER[m.kind] ?? 2));

  const dayClaims: Record<number, number> = {};
  const claimIndexByKey = new Map<number, Map<string, number>>();
  claimKeysByDay.forEach((byKey, day) => {
    const sorted = Array.from(byKey.entries()).sort((x, y) => x[1] - y[1] || x[0].localeCompare(y[0]));
    dayClaims[day] = sorted.length;
    claimIndexByKey.set(day, new Map(sorted.map(([k], i) => [k, i])));
  });

  const marks: BzMark[] = marksRaw.map((m) => ({
    ...m,
    section: claimIndexByKey.get(m.day)?.get(m.periodKey) ?? 0,
    sections: dayClaims[m.day] ?? 1,
  }));

  return { stripes, marks, dayClaims };
};

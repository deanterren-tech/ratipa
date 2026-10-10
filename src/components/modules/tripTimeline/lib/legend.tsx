/**
 * ЕДИНЫЙ источник обозначений таймлайна рейсов (легенда).
 *
 * `buildLegendItems` используется и попапом «Обозначения» на полотне таймлайна,
 * и вкладкой «Справочник» интерактивного гайда (guide/TripTimelineGuide) —
 * чтобы названия, цвета и значки в обучении не расходились с реальным дизайном.
 * Значения (цвета/штриховки/иконки) берутся из тех же модулей, что и рендер
 * полос: lib/visuals, lib/factSegments, lib/bzFills, lib/vyezd, lib/directions.
 */
import React from 'react';
import { CarFront, CircleCheck, CircleDashed, Hourglass, LogIn, LogOut, OctagonX, TriangleAlert, Wrench } from 'lucide-react';
import { BAR_ICON_CLS, CLR, PLAN_ACCENT, TRIP_CIRCLE_BADGE_CLS, TRIP_CIRCLE_TICK_LINE, TRIP_CIRCLE_TICK_TEXT, conflictHatch, hatch45, tripCircleBadgeStyle, waitHatch } from './visuals';
import { FACT_SEGMENT_COLORS, type FactSegColor } from './factSegments';
import { bzKindColor } from './bzFills';
import { VYEZD_STATUS } from './vyezd';
import { directionChipColors, type DirectionDef } from './directions';

/** Строка легенды/справочника: образец (цвет, иконка, метка) + пояснение. */
export interface LegendItem {
  swatch: React.ReactNode;
  label: string;
}

/** Образец сегмента факта (фон, штриховка проблемных, рамка) — как на полосе. */
export const segSw = (c: FactSegColor, extra?: React.ReactNode): React.ReactNode => {
  const st = FACT_SEGMENT_COLORS[c];
  return (
    <i
      className="inline-flex items-center justify-center w-[18px] h-[14px]"
      style={{
        background: st.bg,
        backgroundImage:
          c === 'orange' || c === 'red'
            ? c === 'red'
              ? 'repeating-linear-gradient(45deg, rgba(159,18,57,0.16), rgba(159,18,57,0.16) 2px, transparent 2px, transparent 7px)'
              : 'repeating-linear-gradient(45deg, rgba(138,58,10,0.16), rgba(138,58,10,0.16) 2px, transparent 2px, transparent 7px)'
            : undefined,
        border: `1px solid ${st.border}`,
        borderRadius: 4,
      }}
    >
      {extra}
    </i>
  );
};

/**
 * Все обозначения таймлайна — один список. Порядок и тексты совпадают с
 * попапом «Обозначения» на полотне (тот же вызов), направления приходят из
 * живого справочника (Турция, Китай и добавленные пользователем).
 */
export const buildLegendItems = (directions: DirectionDef[]): LegendItem[] => [
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: PLAN_ACCENT.bg, border: `1px solid ${PLAN_ACCENT.border}`, borderRadius: 4 }} />, label: 'рейс (ПЛАН): вся полоса — акцентный цвет приложения, без индикации сроков' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: hatch45, border: '1px solid rgba(217,119,6,0.25)', borderRadius: 4 }} />, label: 'запас на риски' },
  // ФАКТ рейса — сегменты по отставанию (пороги в lib/factSegments):
  { swatch: segSw('green'), label: 'факт: участок выполнен в срок или раньше плана' },
  { swatch: segSw('yellow'), label: 'факт: опоздание 1–2 дня' },
  { swatch: segSw('orange', <TriangleAlert className="w-2.5 h-2.5" style={{ color: FACT_SEGMENT_COLORS.orange.text }} aria-hidden="true" />), label: 'факт: опоздание больше 2 дней (штриховка и значок — вторичный признак)' },
  { swatch: segSw('red', <TriangleAlert className="w-2.5 h-2.5" style={{ color: FACT_SEGMENT_COLORS.red.text }} aria-hidden="true" />), label: 'факт: критический дедлайн нарушен или просрочка (срок прошёл, этап не выполнен)' },
  { swatch: segSw('neutral'), label: 'факт: план не указан — нейтральная полоса, зелёный не ставится' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: FACT_SEGMENT_COLORS.green.bg, border: `1px solid ${FACT_SEGMENT_COLORS.green.border}`, borderRight: 'none', borderRadius: '4px 0 0 4px' }} />, label: 'факт идёт: продолжающийся край без скругления — отставание считается до сегодня' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: CLR.planNoneBg, border: `1px dashed ${CLR.planNoneBorder}`, borderRadius: 4 }} />, label: '«Факт не указан» (не выполнен)' },
  // Правило долей дня — единое с отрисовкой (lib/dayCellSections): половинки
  // ячейки слева-направо, каждая доля кликабельна, подсказка описывает своё событие.
  { swatch: <i className="inline-flex w-[18px] h-[14px] overflow-hidden rounded-[4px] border border-[rgba(18,19,22,0.18)]"><i className="inline-block h-full" style={{ width: '50%', background: bzKindColor('base-plan').bg }} /><i className="inline-block h-full" style={{ width: '50%', background: PLAN_ACCENT.bg }} /></i>, label: 'два события в одном дне делят ячейку: слева предыдущее по жизни рейса, справа следующее (правило половин — lib/dayCellSections); каждая доля кликабельна, соседнее событие названо в подсказке' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: bzKindColor('base-fact').bg, border: `1px solid ${bzKindColor('base-fact').border}`, borderRadius: 4 }} />, label: 'фактический простой на базе (период: приезд → выезд) — сплошная полоса, цвет = статус «Учёта выезда»' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: VYEZD_STATUS.active.bg, border: `1px solid ${VYEZD_STATUS.active.border}`, borderRadius: 4 }}><CircleDashed className="w-2.5 h-2.5" style={{ color: VYEZD_STATUS.active.text }} aria-hidden="true" /></i>, label: 'учёт выезда: учёт ведётся (период открыт)' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: VYEZD_STATUS.closed.bg, border: `1px solid ${VYEZD_STATUS.closed.border}`, borderRadius: 4 }}><CircleCheck className="w-2.5 h-2.5" style={{ color: VYEZD_STATUS.closed.text }} aria-hidden="true" /></i>, label: 'учёт выезда: период закрыт (фактический выезд указан)' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: VYEZD_STATUS['no-departure'].bg, border: `1px solid ${VYEZD_STATUS['no-departure'].border}`, borderRadius: 4 }}><Hourglass className="w-2.5 h-2.5" style={{ color: VYEZD_STATUS['no-departure'].text }} aria-hidden="true" /></i>, label: 'учёт выезда: выезд не зафиксирован (срок готовности прошёл) — «Готовится к выезду», дата выезда не указана' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: VYEZD_STATUS.conflict.bg, border: `1px solid ${VYEZD_STATUS.conflict.border}`, borderRadius: 4 }}><TriangleAlert className="w-2.5 h-2.5" style={{ color: VYEZD_STATUS.conflict.text }} aria-hidden="true" /></i>, label: 'учёт выезда: расхождение с рейсом (клик — окно периода)' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: VYEZD_STATUS['early-departure'].bg, border: `1px solid ${VYEZD_STATUS['early-departure'].border}`, borderRadius: 4 }}><CircleDashed className="w-2.5 h-2.5" style={{ color: VYEZD_STATUS['early-departure'].text }} aria-hidden="true" /></i>, label: 'учёт выезда: выезд раньше учётного срока — расхождение объяснено правилом «выехала раньше» (полоса нейтральна, маркер на стыке; в «Учёте выезда» статус не смягчается)' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: bzKindColor('base-plan').bg, border: `1px solid ${bzKindColor('base-plan').border}`, borderRadius: 4 }} />, label: 'плановый простой на базе (приезд → срок готовности) — сплошная полоса' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: bzKindColor('repair').bg, border: `1px solid ${bzKindColor('repair').border}`, borderRadius: 4 }} />, label: 'ремонт (внутри базы) — сплошная полоса, подпись внутри' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: bzKindColor('repair-end').bg, border: `1px solid ${bzKindColor('repair-end').border}`, borderRadius: 4 }}><Wrench className="w-2.5 h-2.5" style={{ color: bzKindColor('repair-end').text }} aria-hidden="true" /></i>, label: 'дата окончания ремонта — вся ячейка дня (иконка)' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: bzKindColor('base-gap').bg, border: `1px dashed ${bzKindColor('base-gap').border}`, borderRadius: 4 }} />, label: 'простой на базе между рейсами (записи учёта нет)' },
  // Круги рейса (единое правило lib/circles): количество кругов — поле записи
  // рейса, задаётся в окне рейса и в «Плане дохода»; бейдж и засечки — на полосе.
  { swatch: <i className={TRIP_CIRCLE_BADGE_CLS} style={tripCircleBadgeStyle()}>×2</i>, label: 'круги рейса: бейдж «×2»/«×3» в начале полосы — количество кругов у рейса (поле «Круги» в окне рейса и в «Плане дохода»); для одного круга бейдж не показывается' },
  { swatch: <i className="inline-flex items-center gap-[2px]"><i className="inline-block w-[2px] h-[12px] rounded-full" style={{ background: TRIP_CIRCLE_TICK_LINE }} /><b className="text-[8px] leading-none font-bold" style={{ color: TRIP_CIRCLE_TICK_TEXT }}>2</b></i>, label: 'засечка с номером между кругами — начало круга 2 (и далее), ставится только если этапы распределены по кругам (колонка «Круг» в таблице этапов); подсказка — число кругов и даты каждого' },
  // Направления — отдельная приглушённая палитра (сине-фиолетовые, бирюзовые):
  // не конфликтует со статусами; различие подкреплено кодом (CN, TR…).
  ...directions.map((d) => {
    const dc = directionChipColors(d.color);
    return {
      swatch: (
        <i
          className="inline-flex items-center justify-center w-[18px] h-[14px]"
          style={{ background: dc.bg, border: `1px solid ${dc.border}`, borderRadius: 4 }}
        >
          <span className="text-[8px] leading-none font-semibold" style={{ color: dc.text }}>
            {d.code}
          </span>
        </i>
      ),
      label: `направление «${d.name}» — код ${d.code}: мини-чип в колонке машины и код в правом углу полосы (при достаточной ширине)`,
    };
  }),
  { swatch: <i className="inline-block w-[9px] h-[9px] rotate-45" style={{ background: '#7C3AED', opacity: 0.95, borderRadius: 2 }} />, label: 'событие машины / журнала рейса (клик — к записи)' },
  { swatch: <i className="inline-block w-[14px] h-[10px]" style={{ background: '#DFEAFD', border: '1px solid #8FBBF7', borderRadius: 4 }} />, label: 'этап: заливка/секция дня — цвет по типу (клик — этап в карточке)' },
  { swatch: <i className="inline-block w-[3px] h-[12px]" style={{ background: 'repeating-linear-gradient(to bottom, #6B7280 0 3px, transparent 3px 6px)' }} />, label: 'передача диспетчера (дата не указана — стык между рейсами)' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: '#DFEAFD', border: '1px solid #8FBBF7', borderRadius: 3, outline: '1px dashed #DC2626', outlineOffset: -1 }} />, label: 'критический срок этапа — пунктирная красная рамка вокруг клетки этапа (флаг «Крит. срок»)' },
  // Маркеры стыков рейса и простоя (единое разрешение наложений, lib/overlap):
  // день смены делится по горизонтали, обе части кликабельны.
  { swatch: <i className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full" style={{ background: 'rgba(255,255,255,0.97)', border: '1px solid #8FC9AE' }}><LogIn className="w-2.5 h-2.5" style={{ color: '#0F6246' }} aria-hidden="true" /></i>, label: 'маркер «прибытие на базу»: рейс завершён в день начала простоя (день делится)' },
  { swatch: <i className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full" style={{ background: 'rgba(255,255,255,0.97)', border: '1px solid #CBD5E1' }}><LogOut className="w-2.5 h-2.5" style={{ color: '#475569' }} aria-hidden="true" /></i>, label: 'маркер «выезд»: простой закончился и рейс начался в один день' },
  { swatch: <i className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full" style={{ background: '#FFF4DE', border: '1px solid #E3B04B' }}><LogOut className="w-2.5 h-2.5" style={{ color: '#B45309' }} aria-hidden="true" /></i>, label: 'выехала раньше/позже учёта выезда — простой укорочен до дня выезда (клик — окно периода)' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: waitHatch, border: '1px dashed #94A3B8', borderRadius: 4 }} />, label: '«Ожидание выезда» — промежуток между простоем и рейсом (учёт не закрыт) с числом дней' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: conflictHatch, border: '1px solid #EFA3B1', borderRadius: 4 }}><TriangleAlert className="w-2.5 h-2.5" style={{ color: '#BE123C' }} aria-hidden="true" /></i>, label: 'конфликт данных — тонкая штриховка зоны и значок со ссылкой на источник (не маскируется)' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: bzKindColor('ready').bg, border: `1px solid ${bzKindColor('ready').border}`, borderRadius: 4 }}><CarFront className="w-2.5 h-2.5" style={{ color: bzKindColor('ready').text }} aria-hidden="true" /></i>, label: 'плановое окончание базы (срок готовности, иконка выезда) — вся ячейка дня' },
  { swatch: <i className="inline-block w-[18px] h-[10px]" style={{ background: CLR.planArchBg, border: `1px solid ${CLR.planArchBorder}`, borderRadius: 4 }} />, label: 'архивные данные (приглушённые)' },
  {
    swatch: (
      <span className="inline-flex items-center gap-1">
        <OctagonX className={BAR_ICON_CLS} style={{ color: '#BE123C' }} aria-hidden="true" />
        <Hourglass className={BAR_ICON_CLS} style={{ color: '#B45309' }} aria-hidden="true" />
        <TriangleAlert className={BAR_ICON_CLS} style={{ color: '#D97706' }} aria-hidden="true" />
      </span>
    ),
    label: 'статусы критических сроков (в подсказках полос и в колонке): срок нарушен / план прошёл без факта / срок под угрозой; оранжевый значок — предупреждения данных',
  },
];

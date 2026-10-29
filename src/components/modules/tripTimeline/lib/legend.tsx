/**
 * ЕДИНЫЙ источник обозначений таймлайна рейсов (легенда).
 *
 * `buildLegendItems` используется и попапом «Обозначения» на полотне таймлайна,
 * и вкладкой «Справочник» интерактивного гайда (guide/TripTimelineGuide) —
 * чтобы названия, цвета и значки в обучении не расходились с реальным дизайном.
 * Значения (цвета/штриховки/иконки) берутся из тех же модулей, что и рендер
 * полос: lib/visuals, lib/factSegments, lib/bzFills, lib/directions.
 */
import React from 'react';
import { LogOut, TriangleAlert } from 'lucide-react';
import { CLR, PLAN_ACCENT, RISK_COLORS, TRIP_CIRCLE_BADGE_CLS, conflictHatch, riskHatch, stageIconOf, tripCircleBadgeStyle } from './visuals';
import { FACT_SEGMENT_COLORS, type FactSegColor } from './factSegments';
import { bzKindColor } from './bzFills';
import { directionChipColors, type DirectionDef } from './directions';
import { STATUS_LINE_COLORS } from './statusLine';

/** Строка легенды/справочника: образец (цвет, иконка, метка) + пояснение. */
export interface LegendItem {
  swatch: React.ReactNode;
  label: string;
}

/** Образец сегмента факта (фон, штриховка просрочки, рамка) — как на полосе. */
export const segSw = (c: FactSegColor, extra?: React.ReactNode): React.ReactNode => {
  const st = FACT_SEGMENT_COLORS[c];
  return (
    <i
      className="inline-flex items-center justify-center w-[18px] h-[14px]"
      style={{
        background: st.bg,
        backgroundImage:
          c === 'red'
            ? 'repeating-linear-gradient(45deg, rgba(159,18,57,0.16), rgba(159,18,57,0.16) 2px, transparent 2px, transparent 7px)'
            : undefined,
        border: `1px solid ${st.border}`,
        borderRadius: 4,
      }}
    >
      {extra}
    </i>
  );
};

/** Образец значка этапа — как на полосе: без клетки, серый или цвета статуса. */
const stageSw = (type: string, color = '#4B5563'): React.ReactNode => {
  const Icon = stageIconOf(type);
  return <Icon className="w-3.5 h-3.5" style={{ color }} aria-hidden="true" />;
};

/**
 * Обозначения таймлайна — короткий список простыми словами. Порядок и тексты
 * совпадают с попапом «Обозначения» на полотне (тот же вызов) и вкладкой
 * «Справочник» гайда; направления приходят из живого справочника.
 */
export const buildLegendItems = (directions: DirectionDef[]): LegendItem[] => [
  ...directions.map((d) => {
    const dc = directionChipColors(d.color);
    return {
      swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: dc.bg, border: `1px solid ${dc.border}`, borderRadius: 4 }} />,
      label: `рейс, направление «${d.name}» (${d.code})`,
    };
  }),
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: PLAN_ACCENT.bg, border: `1px solid ${PLAN_ACCENT.border}`, borderRadius: 4 }} />, label: 'рейс без направления' },
  { swatch: <span className="inline-flex items-center gap-1">{stageSw('load')}{stageSw('border')}{stageSw('cust_out')}{stageSw('unl')}</span>, label: 'этапы: загрузка, граница, таможня, выгрузка' },
  { swatch: <span className="inline-flex items-center gap-1">{stageSw('border', '#B45309')}{stageSw('border', '#BE123C')}</span>, label: 'этап с опозданием: янтарный — в пределах запаса, красный — запас исчерпан или срок прошёл' },
  {
    swatch: (
      <span className="inline-flex items-center gap-0.5">
        {(['ok', 'soon', 'late'] as const).map((k) => (
          <i key={k} className="inline-block w-[16px] h-[4px] rounded-full" style={{ background: STATUS_LINE_COLORS[k].color }} />
        ))}
      </span>
    ),
    label: 'линия под рейсом: зелёная — по плану, оранжевая — срок через 1–2 дня, красная — просрочка',
  },
  { swatch: <span className="inline-flex items-center gap-0.5">{segSw('green')}{segSw('yellow')}{segSw('orange')}{segSw('red')}</span>, label: '«Подробно», факт: в срок, опоздание 1–2 дня, больше 2 дней, просрочка' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: CLR.planNoneBg, border: `1px dashed ${CLR.planNoneBorder}`, borderRadius: 4 }} />, label: 'факт не указан' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ backgroundImage: riskHatch, border: `1px solid ${RISK_COLORS.border}`, borderLeft: `2px solid ${RISK_COLORS.edge}`, borderRadius: '0 4px 4px 0' }} />, label: 'запас на риски (дни после этапа или рейса)' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: bzKindColor('base-plan').bg, border: `1px solid ${bzKindColor('base-plan').border}`, borderRadius: 4 }} />, label: 'простой на базе' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: bzKindColor('repair').bg, border: `1px solid ${bzKindColor('repair').border}`, borderRadius: 4 }} />, label: 'ремонт' },
  { swatch: <i className="inline-flex items-center justify-center w-[16px] h-[16px] rounded-full" style={{ background: 'rgba(255,255,255,0.97)', border: '1px solid #CBD5E1' }}><LogOut className="w-2.5 h-2.5" style={{ color: '#475569' }} aria-hidden="true" /></i>, label: 'выезд с базы / прибытие на базу в один день с рейсом' },
  { swatch: <i className="inline-block w-[18px] h-[14px]" style={{ background: '#FFFFFF', borderRadius: 3, outline: '1px dashed #DC2626', outlineOffset: -1 }} />, label: 'критический срок этапа' },
  { swatch: <i className="inline-flex items-center justify-center w-[18px] h-[14px]" style={{ background: conflictHatch, border: '1px solid #EFA3B1', borderRadius: 4 }}><TriangleAlert className="w-2.5 h-2.5" style={{ color: '#BE123C' }} aria-hidden="true" /></i>, label: 'конфликт данных — клик открывает источник' },
  { swatch: <i className={TRIP_CIRCLE_BADGE_CLS} style={tripCircleBadgeStyle()}>×2</i>, label: 'количество кругов рейса' },
  { swatch: <i className="inline-block w-[9px] h-[9px] rotate-45" style={{ background: '#7C3AED', opacity: 0.95, borderRadius: 2 }} />, label: 'заметка диспетчера: наведите — текст, клик — закрепить карточку' },
  { swatch: <i className="inline-block w-[18px] h-[10px]" style={{ background: CLR.planArchBg, border: `1px solid ${CLR.planArchBorder}`, borderRadius: 4 }} />, label: 'архивный рейс' },
];


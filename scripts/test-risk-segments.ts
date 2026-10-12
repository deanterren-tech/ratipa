/**
 * Тесты чистой логики СЕГМЕНТОВ «РИСКИ» (lib/riskSegments) и их палитры
 * (lib/visuals): геометрия (сразу после этапа, ширина = запас × день),
 * отсутствие наложения сегментов, порядок seq, урезание по окну (частичная
 * видимость), пороги текста «Риски +N дн» / «+N» / без текста, WCAG AA
 * контраст текста и непрозрачность штриховки ≥ 40%.
 *
 * Запуск: npx tsx scripts/test-risk-segments.ts  (или npm run test:risk-segments)
 */
import { RISK_COLORS, riskHatch, TL_Z } from '../src/components/modules/tripTimeline/lib/visuals';
import {
  RISK_FULL_MIN_W,
  RISK_SHORT_MIN_W,
  RISK_MIN_W,
  layoutRiskSegments,
  riskSegmentTextOf,
  riskTextBudgetWithChip,
  type RiskSegmentInput,
} from '../src/components/modules/tripTimeline/lib/riskSegments';
import { stageRiskTitle } from '../src/components/modules/tripTimeline/lib/stageFills';
import type { TimelineStage } from '../src/types';

let passed = 0;
let failed = 0;
const check = (name: string, cond: boolean, extra: unknown = ''): void => {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name}${extra !== '' ? ` — ${JSON.stringify(extra)}` : ''}`);
  }
};

// ────────────────────────────────────────────────────────────────────────────
console.log('1. Пороги текста сегмента (ширина := текст; обрезанного текста нет)');
{
  check('64px → «Риски +10 дн» (полный помещается)', riskSegmentTextOf(10, 64) === 'Риски +10 дн');
  check('120px → «Риски +12 дн»', riskSegmentTextOf(12, 120) === 'Риски +12 дн');
  check('60px → «Риски +3 дн» (ровно по расчёту)', riskSegmentTextOf(3, 60) === 'Риски +3 дн');
  check('39px → «+3» (только для узкого)', riskSegmentTextOf(3, 39) === '+3');
  check('40px → «+3» (полный не помещается — счётчик не теряем)', riskSegmentTextOf(3, 40) === '+3');
  check('60px, запас 10 (текст длиннее) → «+10» вместо обрезанного', riskSegmentTextOf(10, 60) === '+10');
  check('20px → «+5»', riskSegmentTextOf(5, 20) === '+5');
  check('19px → null (текст не помещается)', riskSegmentTextOf(5, 19) === null);
  check('0px → null', riskSegmentTextOf(1, 0) === null);
  check('пороги: FULL > SHORT > MIN', RISK_FULL_MIN_W > RISK_SHORT_MIN_W && RISK_SHORT_MIN_W > RISK_MIN_W);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('2. Геометрия: сегмент сразу после этапа, ширина = запас × день');
{
  const colW = 30;
  // Этап закончился на правом краю дня D (анкер 300 = правый край), запас 2 дн.
  const segs = layoutRiskSegments([{ tripKey: 't1', stageId: 's1', seq: 1, anchor: 300, days: 2 }], 800, colW);
  check('один сегмент нарисован', segs.length === 1, segs);
  check('левый край = анкер этапа (сразу после)', segs[0]?.left === 300, segs[0]);
  check('ширина = 2 дн × 30px = 60px', segs[0]?.width === 60, segs[0]);
  check('правый край = анкер + запас', segs[0]?.right === 360, segs[0]);
  check('текст «Риски +2 дн»', segs[0]?.text === 'Риски +2 дн', segs[0]?.text);

  // Доля дня (половина): анкер = правый край доли.
  const half = layoutRiskSegments([{ tripKey: 't1', stageId: 's2', seq: 1, anchor: 15, days: 2 }], 800, colW);
  check('анкер доли дня (15px) сохраняется', half[0]?.left === 15 && half[0]?.width === 60, half[0]);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('3. Запас 0 / пусто / отрицательный — сегмента нет');
{
  const segs = layoutRiskSegments(
    [
      { tripKey: 't1', stageId: 's0', seq: 1, anchor: 100, days: 0 },
      { tripKey: 't1', stageId: 'sneg', seq: 2, anchor: 200, days: -3 },
      { tripKey: 't1', stageId: 'snan', seq: 3, anchor: 300, days: Number.NaN },
      // валидный — чтобы убедиться, что фильтр не съел всё
      { tripKey: 't1', stageId: 'sok', seq: 4, anchor: 400, days: 1 },
    ],
    1000,
    30,
  );
  check('нет ни одного сегмента для 0/отрицательного/NaN', segs.length === 1, segs);
  check('единственный сегмент — валидный этап', segs[0]?.stageId === 'sok', segs[0]);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('4. Наложение сегментов недопустимо (урезание по следующему анкеру)');
{
  const colW = 30;
  // Два этапа В ОДИН ДЕНЬ (доли дня): sA — правая граница доли 15px, запас 2 дн;
  // sB — правая граница дня 30px, запас 1 дн. sA урезается до 15px (до анкера sB).
  const same = layoutRiskSegments(
    [
      { tripKey: 't1', stageId: 'sA', seq: 1, anchor: 15, days: 2 },
      { tripKey: 't1', stageId: 'sB', seq: 2, anchor: 30, days: 1 },
    ],
    800,
    colW,
  );
  check('оба этапа получили сегменты', same.length === 2, same);
  check('первый — sA (порядок по анкеру/seq)', same[0]?.stageId === 'sA' && same[1]?.stageId === 'sB', same);
  check('sA урезан до анкера sB (15..30)', same[0]?.left === 15 && same[0]?.right === 30, same[0]);
  check('sB — полной ширины (30..60)', same[1]?.left === 30 && same[1]?.width === 30, same[1]);
  check('сегменты не пересекаются', same[0]!.right <= same[1]!.left, same);

  const overlap = layoutRiskSegments(
    [
      { tripKey: 't1', stageId: 's1', seq: 1, anchor: 100, days: 3 },
      { tripKey: 't1', stageId: 's2', seq: 2, anchor: 120, days: 2 },
    ],
    800,
    colW,
  );
  check('пересечение анкеров: [100..120] и [120..180]', overlap[0]?.right === 120 && overlap[1]?.left === 120, overlap);
  check('наложения нет (right ≤ next.left)', overlap[0]!.right <= overlap[1]!.left, overlap);

  // Крошка: анкер следующего сегмента почти сразу — сегмент не рисуем (< 4px).
  const crumb = layoutRiskSegments(
    [
      { tripKey: 't1', stageId: 's1', seq: 1, anchor: 100, days: 5 },
      { tripKey: 't1', stageId: 's2', seq: 2, anchor: 102, days: 1 },
    ],
    800,
    colW,
  );
  check('крошка < 4px отброшена, второй сегмент на месте', crumb.length === 1 && crumb[0]?.stageId === 's2', crumb);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('5. Одинаковый анкер (защита): остаётся ровно один сегмент, наложения нет');
{
  const segs = layoutRiskSegments(
    [
      { tripKey: 't1', stageId: 'sb', seq: 7, anchor: 100, days: 1 },
      { tripKey: 't1', stageId: 'sa', seq: 2, anchor: 100, days: 1 },
    ],
    800,
    30,
  );
  check('ровно один сегмент на одинаковом анкере (крошка отброшена)', segs.length === 1, segs);
  check('уцелевший сегмент не пустой и начинается на анкере', segs[0]?.left === 100 && segs[0]!.width > 0, segs[0]);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('6. Частичная видимость: урезание по окну (не вылезает за видимую область)');
{
  const colW = 30;
  const laneW = 600;
  // Этап у правого края окна: анкер 570, запас 3 дн (90px) — рвётся на 600.
  const edge = layoutRiskSegments([{ tripKey: 't1', stageId: 's1', seq: 1, anchor: 570, days: 3 }], laneW, colW);
  check('сегмент урезан по правому краю окна', edge[0]?.right === laneW && edge[0]?.width === 30, edge[0]);
  // Анкер за окном полностью — сегмента нет.
  const outside = layoutRiskSegments([{ tripKey: 't1', stageId: 's2', seq: 1, anchor: 640, days: 2 }], laneW, colW);
  check('этап за окном — сегмента нет', outside.length === 0, outside);
  // Анкер слева за окном (этап продолжается из-за левого края): видимый огрызок рисуется.
  const left = layoutRiskSegments([{ tripKey: 't1', stageId: 's3', seq: 1, anchor: -45, days: 3 }], laneW, colW);
  check('левый край прижат к 0, ширина = видимый хвост', left[0]?.left === 0 && left[0]?.right === 45, left[0]);
  // Мелкий масштаб: день 10px, запас 3 → 30px (сужается пропорционально).
  const small = layoutRiskSegments([{ tripKey: 't1', stageId: 's4', seq: 1, anchor: 100, days: 3 }], laneW, 10);
  check('масштаб 10px/день: ширина 30px', small[0]?.width === 30, small[0]);
  // Крупный масштаб: день 80px, запас 3 → 240px.
  const big = layoutRiskSegments([{ tripKey: 't1', stageId: 's4', seq: 1, anchor: 100, days: 3 }], 1000, 80);
  check('масштаб 80px/день: ширина 240px', big[0]?.width === 240, big[0]);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('7. Разные рейсы: свои сегменты, но наложение исключено и между рейсами');
{
  const apart = layoutRiskSegments(
    [
      { tripKey: 'tl:t1', stageId: 's1', seq: 1, anchor: 100, days: 2 },
      { tripKey: 'pd:t2', seq: 0, anchor: 300, days: 2 }, // запас записи другого рейса
    ],
    800,
    30,
  );
  check('сегменты на своих местах (разные рейсы, разные анкеры)', apart.length === 2 && apart.every((s) => s.width === 60), apart);
  check('оба начинаются на своём анкере', apart[0]?.left === 100 && apart[1]?.left === 300, apart);

  const collide = layoutRiskSegments(
    [
      { tripKey: 'tl:t1', stageId: 's1', seq: 1, anchor: 100, days: 2 },
      { tripKey: 'pd:t2', seq: 0, anchor: 120, days: 2 },
    ],
    800,
    30,
  );
  check('встречные сегменты разных рейсов не накладываются', collide[0]?.right === 120 && collide[1]?.left === 120, collide);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('8. Слои TL_Z: «Риски» — поверх полос и этапов, ниже меток и «сегодня»');
{
  check('risk > tripBar (полоса «План»)', TL_Z.risk > TL_Z.tripBar);
  check('risk > stage (клетки этапов)', TL_Z.risk > TL_Z.stage);
  check('risk < mark (метки поверх)', TL_Z.risk < TL_Z.mark);
  check('risk < overlay («сегодня»)', TL_Z.risk < TL_Z.overlay);
  check('risk > bz (полосы базы/ремонта)', TL_Z.risk > TL_Z.bz);
  // CSS не принимает дробный z-index: все слои, которые реально ставятся
  // сегментам/меткам/оверлею, обязаны быть ЦЕЛЫМИ (иначе браузер выбрасывает
  // значение и слой уходит под полосу — «риски не видны»).
  check('все слои TL_Z — целые числа', [TL_Z.risk, TL_Z.mark, TL_Z.overlay, TL_Z.tripBar, TL_Z.stage, TL_Z.bz].every((v) => Number.isInteger(v)), TL_Z);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('9. Палитра: WCAG AA текста и непрозрачность штриховки ≥ 40%');
{
  const hex = (h: string): [number, number, number] => {
    const s = h.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)) as [number, number, number];
  };
  const parseRgba = (c: string): { rgb: [number, number, number]; a: number } => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    const p = (m ? m[1] : '').split(',').map((x) => Number(x.trim()));
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const comp = (src: [number, number, number], a: number, dst: [number, number, number]): [number, number, number] =>
    src.map((c, i) => Math.round(c * a + dst[i] * (1 - a))) as [number, number, number];
  const lum = (rgb: [number, number, number]): number => {
    const s = rgb.map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  };
  const ratio = (a: [number, number, number], b: [number, number, number]): number => {
    const l1 = lum(a);
    const l2 = lum(b);
    const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
    return (hi + 0.05) / (lo + 0.05);
  };

  const stripe = parseRgba(RISK_COLORS.stripe);
  const stripe2 = parseRgba(RISK_COLORS.stripe2);
  check('обе полосы штриховки непрозрачны ≥ 40%', stripe.a >= 0.4 && stripe2.a >= 0.4, { dark: stripe.a, light: stripe2.a });
  check('штриховка — repeating-linear-gradient 45deg', /repeating-linear-gradient\(45deg/.test(riskHatch));
  check('штриховка содержит оба тона', riskHatch.includes(RISK_COLORS.stripe) && riskHatch.includes(RISK_COLORS.stripe2));

  const text = hex(RISK_COLORS.text);
  // Фон под сегментом — светлый: белый холст и акцентная светлая полоса «План».
  const bgs: Record<string, [number, number, number]> = { white: [255, 255, 255], planBar: [254, 240, 227] };
  for (const [name, bg] of Object.entries(bgs)) {
    const cDark = comp(stripe.rgb, stripe.a, bg);
    const cLight = comp(stripe2.rgb, stripe2.a, bg);
    const rDark = ratio(text, cDark);
    const rLight = ratio(text, cLight);
    check(`AA ≥ 4.5:1 на тёмной полосе (${name}): ${rDark.toFixed(2)}`, rDark >= 4.5, rDark);
    check(`AA ≥ 4.5:1 на светлой полосе (${name}): ${rLight.toFixed(2)}`, rLight >= 4.5, rLight);
  }
  // Границы сегмента отличимы от обоих тонов (чёткая граница со стороны этапа).
  const edge = hex(RISK_COLORS.edge);
  check('граница со стороны этапа контрастна штриховке', ratio(edge, comp(stripe2.rgb, stripe2.a, [255, 255, 255])) >= 2.2);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('10. Подсказка сегмента «Риски» — буферный текст (запас/накопленный/дата/состояние)');
{
  const stage: TimelineStage = {
    id: 's1',
    type: 'border',
    label: 'Брест',
    plannedDate: '2026-10-01',
    actualDate: '',
    isCritical: false,
    order: 1,
    seq: 1,
    bufferDays: 2,
  };
  const title = stageRiskTitle(
    [{ key: 'border', name: 'Граница', order: 1 }],
    stage,
    { bufferDays: 2, cumBufferDays: 5, effectiveIso: '2026-10-03', stateLabel: 'в пределах запаса' },
  );
  check('заголовок начинается с «Риски «…»: +2 дн»', /^Риски «Граница · Брест»: \+2 дн/.test(title), title);
  check('включает запас и накопленный', title.includes('запас этапа: 2 дн (накопленный по маршруту: 5 дн)'), title);
  check('включает дату с запасом', title.includes('плановая дата с запасом: 03/10'), title);
  check('включает состояние', title.includes('состояние: в пределах запаса'), title);
  check('включает приглашение к клику', title.includes('клик — открыть рейс и выделить этап'), title);
}

// ────────────────────────────────────────────────────────────────────────────
console.log('11. Бюджет текста с чипом направления ВНУТРИ сегмента (не под метку)');
{
  check('чип внутри сегмента справа — бюджет обрезан до чипа', riskTextBudgetWithChip(200, 100, 300, { left: 180, right: 216 }) === 76);
  check('чипа нет — бюджет не меняется', riskTextBudgetWithChip(200, 100, 300, null) === 200);
  check('чип левее сегмента — не влияет', riskTextBudgetWithChip(200, 100, 300, { left: 40, right: 76 }) === 200);
  check('чип почти вплотную слева — бюджет 0', riskTextBudgetWithChip(200, 100, 300, { left: 101, right: 137 }) === 0);
  check(
    'следствие: «Риски +6 дн» → «+6» (бюджет 34px, чип TR внутри)',
    riskSegmentTextOf(6, riskTextBudgetWithChip(180, 802, 982, { left: 840, right: 876 })) === '+6',
  );
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\nИтог: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

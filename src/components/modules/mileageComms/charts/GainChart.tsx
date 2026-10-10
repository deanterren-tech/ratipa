/**
 * Второй график: приросты одометра между измерениями.
 * Синхронизирован с главным графиком (общий диапазон). Столбик — интервал
 * между двумя соседними измерениями; в подсказке длительность, темп прироста и
 * связь со стоянкой. При разрыве интервал НЕ называется «мгновенным скачком» —
 * он помечается как прирост через разрыв. Множество столбиков агрегируется
 * по экранной ширине (без потери суммарного прироста).
 */

import type { GainInterval, Stop } from '../engine/types';
import { timeTicks, useElementWidth } from './chartUtils';
import { fmtAxis, fmtDMHM, fmtDuration, fmtKm, fmtNum } from '../engine/format';

interface Props {
  range: { fromMs: number; toMs: number };
  gains: GainInterval[];
  stops: Stop[];
  selectedStopId: string | null;
  onSelectGain: (g: GainInterval) => void;
  maxBars?: number;
}

const PAD_L = 46;
const PAD_R = 14;
const PAD_T = 12;
const PAD_B = 24;
const H = 170;

const KIND_COLOR: Record<GainInterval['kind'], string> = {
  normal: '#94A3B8',
  stop_rise: '#E11D48',
  resume: '#F59E0B',
  gap: '#6B7280',
  reset: '#7C3AED',
  gps_gap: '#CBD5E1',
};

const KIND_LABEL: Record<GainInterval['kind'], string> = {
  normal: 'обычный прирост',
  stop_rise: 'прирост во время стоянки',
  resume: 'прирост при возобновлении',
  gap: 'прирост через разрыв данных',
  reset: 'сброс/смена счётчика',
  gps_gap: 'измерение непригодно',
};

export default function GainChart({ range, gains, stops, selectedStopId, onSelectGain, maxBars = 220 }: Props) {
  const { ref, width } = useElementWidth<HTMLDivElement>(760);
  const innerW = Math.max(120, width - PAD_L - PAD_R);
  const innerH = H - PAD_T - PAD_B;

  const inRange = gains.filter((g) => g.toMs >= range.fromMs && g.fromMs <= range.toMs);
  // Агрегация: не больше maxBars столбиков; при агрегации суммируется прирост.
  const bucket = Math.max(1, Math.ceil(inRange.length / maxBars));
  interface Bar { fromMs: number; toMs: number; delta: number; hasDelta: boolean; kind: GainInterval['kind']; count: number; items: GainInterval[] }
  const bars: Bar[] = [];
  for (let i = 0; i < inRange.length; i += bucket) {
    const chunk = inRange.slice(i, i + bucket);
    if (!chunk.length) continue;
    let delta = 0;
    let hasDelta = false;
    let worst: GainInterval = chunk[0];
    for (const g of chunk) {
      if (g.deltaKm != null) { delta += g.deltaKm; hasDelta = true; }
      const rank = (x: GainInterval): number => (x.kind === 'stop_rise' ? 5 : x.kind === 'reset' ? 4 : x.kind === 'resume' ? 3 : x.kind === 'gap' ? 2 : x.kind === 'gps_gap' ? 1 : 0);
      if (rank(g) > rank(worst)) worst = g;
    }
    bars.push({ fromMs: chunk[0].fromMs, toMs: chunk[chunk.length - 1].toMs, delta, hasDelta, kind: worst.kind, count: chunk.length, items: chunk });
  }

  const maxAbs = Math.max(
    0.001,
    ...bars.filter((b) => b.hasDelta).map((b) => Math.abs(b.delta)),
    ...inRange.map((g) => (g.deltaKm != null ? Math.abs(g.deltaKm) : 0)),
  );
  const zeroY = PAD_T + innerH / 2;
  const x = (t: number) => PAD_L + ((t - range.fromMs) / Math.max(1, range.toMs - range.fromMs)) * innerW;
  const barH = (b: Bar) => Math.max(1, (Math.abs(b.delta) / maxAbs) * (innerH / 2 - 6));

  const xTicks = timeTicks(range.fromMs, range.toMs, width);
  const stopById = new Map(stops.map((s) => [s.id, s]));

  return (
    <div ref={ref} className="w-full" data-testid="mc-gain-chart">
      <svg width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label="Приросты одометра между измерениями" className="block select-none">
        <rect x={PAD_L} y={PAD_T} width={innerW} height={innerH} fill="#FFFFFF" stroke="#E5E7EB" />
        {/* сетка X */}
        {xTicks.map((t, i) => (
          <g key={`x${i}`}>
            <line x1={x(t)} x2={x(t)} y1={PAD_T} y2={PAD_T + innerH} stroke="#F3F4F6" />
            <text x={x(t)} y={H - 7} textAnchor="middle" fontSize={10} fill="#9CA3AF">{fmtAxis(t)}</text>
          </g>
        ))}
        <line x1={PAD_L} x2={PAD_L + innerW} y1={zeroY} y2={zeroY} stroke="#E5E7EB" />
        <text x={PAD_L - 6} y={zeroY + 3} textAnchor="end" fontSize={10} fill="#9CA3AF">0</text>
        <text x={10} y={PAD_T + 2} fontSize={10} fill="#9CA3AF">прирост, км</text>

        {/* подсветка выбранной стоянки */}
        {selectedStopId && stopById.get(selectedStopId) && (
          <rect
            x={x(Math.max(stopById.get(selectedStopId)!.startMs, range.fromMs))}
            y={PAD_T}
            width={Math.max(2, x(Math.min(stopById.get(selectedStopId)!.endMs, range.toMs)) - x(Math.max(stopById.get(selectedStopId)!.startMs, range.fromMs)))}
            height={innerH}
            fill="rgba(18, 19, 22, 0.05)"
            stroke="#121316"
            strokeDasharray="3 3"
          />
        )}

        {bars.map((b, i) => {
          const left = x(b.fromMs);
          const right = x(b.toMs);
          const w = Math.max(1, right - left - (b.count > 1 ? 0 : 1));
          const h = b.hasDelta ? barH(b) : 2;
          const cy = b.hasDelta && b.delta < 0 ? zeroY + h : zeroY - h;
          const first = b.items[0];
          const last = b.items[b.items.length - 1];
          const stop = first.stopId ? stopById.get(first.stopId) : null;
          const title = [
            `${fmtDMHM(first.fromMs)} → ${fmtDMHM(last.toMs)}`,
            b.count > 1 ? `агрегировано интервалов: ${b.count}` : `длительность интервала: ${fmtDuration(last.toMs - first.fromMs)}`,
            b.hasDelta ? `суммарный прирост: ${fmtKm(b.delta)}` : 'одометр не передаётся',
            first.rateKmh != null && b.count === 1 ? `темп прироста: ${fmtNum(first.rateKmh)} км/ч` : '',
            `оценка: ${KIND_LABEL[b.kind]}`,
            first.gapInside ? 'ВНИМАНИЕ: внутри интервала был разрыв данных — момент прироста неизвестен (не «мгновенный скачок»)' : '',
            stop ? `стоянка: ${fmtDMHM(stop.startMs)} → ${fmtDMHM(stop.endMs)}` : 'вне стоянок',
            first.quality === 'no_odo' ? 'одометр в измерениях отсутствует' : '',
          ].filter(Boolean).join('\n');
          return (
            <rect
              key={`b${i}`}
              x={left}
              y={b.hasDelta && b.delta < 0 ? zeroY : cy}
              width={w}
              height={h}
              fill={KIND_COLOR[b.kind]}
              opacity={b.kind === 'normal' ? 0.75 : 0.95}
              onClick={() => onSelectGain(first)}
              style={{ cursor: 'pointer' }}
            >
              <title>{title}</title>
            </rect>
          );
        })}

        {inRange.length === 0 && (
          <text x={PAD_L + innerW / 2} y={zeroY} textAnchor="middle" fontSize={11} fill="#9CA3AF">
            Интервалов между измерениями за период нет
          </text>
        )}
      </svg>
      <div className="mt-1.5 text-[10px] text-[#6B7280] flex flex-wrap gap-x-3 gap-y-1">
        <span><span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: KIND_COLOR.normal }} />обычный прирост</span>
        <span><span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: KIND_COLOR.stop_rise }} />во время стоянки</span>
        <span><span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: KIND_COLOR.resume }} />при возобновлении</span>
        <span><span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: KIND_COLOR.gap }} />через разрыв данных</span>
        <span><span className="inline-block w-2.5 h-2.5 align-middle mr-1" style={{ background: KIND_COLOR.reset }} />сброс счётчика</span>
        <span>Клик по столбику — приблизить интервал</span>
      </div>
    </div>
  );
}

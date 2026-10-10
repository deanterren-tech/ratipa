/**
 * Общие помощники графиков (собственные SVG-компоненты, без библиотек):
 * измерение ширины контейнера, оси, прореживание точек, построение путей.
 */

import { useEffect, useRef, useState } from 'react';

/** Точка графика: накопленный пробег от начала рейса. */
export interface ChartPt {
  atMs: number;
  km: number;
  /** Абсолютное показание одометра — только в подсказке. */
  odoKm?: number | null;
}

/** Ширина контейнера с отслеживанием resize (для адаптивных SVG). */
export function useElementWidth<T extends HTMLElement>(fallback = 640): { ref: React.RefObject<T | null>; width: number } {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(Math.max(280, Math.round(el.getBoundingClientRect().width || fallback)));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [fallback]);
  return { ref, width };
}

/** Сетка времени: равномерные отметки внутри диапазона. */
export function timeTicks(fromMs: number, toMs: number, width: number): number[] {
  const span = Math.max(1, toMs - fromMs);
  const target = Math.min(7, Math.max(2, Math.floor(width / 130)));
  const step = span / target;
  const out: number[] = [];
  for (let i = 0; i <= target; i += 1) out.push(fromMs + step * i);
  return out;
}

/** Прореживание: не более maxPoints, сохраняются крайние значения бакета. */
export function decimatePoints(points: ChartPt[], maxPoints: number): ChartPt[] {
  if (points.length <= maxPoints) return points;
  const bucket = Math.ceil(points.length / maxPoints);
  const out: ChartPt[] = [];
  for (let i = 0; i < points.length; i += bucket) {
    const chunk = points.slice(i, i + bucket);
    if (chunk.length <= 2) {
      out.push(...chunk);
      continue;
    }
    let min = chunk[0];
    let max = chunk[0];
    for (const p of chunk) {
      if (p.km < min.km) min = p;
      if (p.km > max.km) max = p;
    }
    if (min === max) out.push(chunk[chunk.length - 1]);
    else if (min.atMs <= max.atMs) out.push(min, max);
    else out.push(max, min);
  }
  return out;
}

/** SVG-путь по точкам (М … L …). */
export function pathOf(points: ChartPt[], x: (t: number) => number, y: (km: number) => number): string {
  if (!points.length) return '';
  let d = `M ${x(points[0].atMs).toFixed(1)} ${y(points[0].km).toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    d += ` L ${x(points[i].atMs).toFixed(1)} ${y(points[i].km).toFixed(1)}`;
  }
  return d;
}

/** Кламп времени в диапазон; null — вне видимого отрезка. */
export const clampRange = (aMs: number, bMs: number, fromMs: number, toMs: number): { a: number; b: number } | null => {
  if (bMs < fromMs || aMs > toMs) return null;
  return { a: Math.max(aMs, fromMs), b: Math.min(bMs, toMs) };
};

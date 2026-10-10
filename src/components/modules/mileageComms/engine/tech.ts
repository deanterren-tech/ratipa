/**
 * Технические события рейса и участки непрерывного счётчика.
 *
 * Разные счётчики не склеиваются: сброс показаний, смена источника одометра,
 * смена привязки трекера (из истории привязок) и технические отметки сотрудника
 * разрывают участки анализа. Техотметка НЕ закрывает событие проверки сама —
 * она лишь показывается на шкале и учитывается как контекст.
 */

import type { CounterSegment, MeasureSample, TechEvent, TechMarkRecord } from './types';
import { fmtDMYHM } from './format';

export interface MappingHistoryLite {
  atMs: number;
  action: string; // bind | rebind | unbind | confirm
  comment?: string;
}

const TECH_MARK_LABELS: Record<TechMarkRecord['kind'], string> = {
  works: 'Технические работы',
  tracker_replace: 'Замена трекера',
  odo_setting: 'Изменение настройки счётчика',
};

export const techMarkLabel = (kind: TechMarkRecord['kind']): string => TECH_MARK_LABELS[kind] || 'Техническая отметка';

/**
 * Технические события из измерений: сброс счётчика (уменьшение показаний)
 * и смена источника одометра между соседними измерениями.
 */
export function detectDataTechEvents(samples: MeasureSample[]): TechEvent[] {
  const out: TechEvent[] = [];
  for (let i = 1; i < samples.length; i += 1) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev.odoKm != null && cur.odoKm != null && cur.odoKm < prev.odoKm - 0.001) {
      out.push({
        id: `reset:${cur.atMs}`,
        kind: 'reset',
        atMs: cur.atMs,
        label: 'Сброс/уменьшение счётчика',
        origin: 'data',
        detail: `Одометр ${prev.odoKm.toFixed(1)} → ${cur.odoKm.toFixed(1)} км (${fmtDMYHM(prev.atMs)} → ${fmtDMYHM(cur.atMs)})`,
      });
    }
    if (
      prev.odoSource &&
      cur.odoSource &&
      prev.odoSource !== cur.odoSource
    ) {
      out.push({
        id: `src:${cur.atMs}`,
        kind: 'source_change',
        atMs: cur.atMs,
        label: 'Смена источника одометра',
        origin: 'data',
        detail: `${prev.odoSource} → ${cur.odoSource}`,
      });
    }
  }
  return out;
}

/** События из истории привязок трекера (bind/rebind/unbind) внутри окна. */
export function detectMappingTechEvents(history: MappingHistoryLite[], fromMs: number, toMs: number): TechEvent[] {
  const out: TechEvent[] = [];
  for (const h of history || []) {
    if (!Number.isFinite(h.atMs) || h.atMs < fromMs || h.atMs > toMs) continue;
    if (h.action === 'confirm') continue; // подтверждение привязки — не смена
    const label =
      h.action === 'unbind' ? 'Снятие привязки трекера'
      : h.action === 'bind' ? 'Привязка трекера'
      : 'Смена привязки трекера';
    out.push({
      id: `map:${h.action}:${h.atMs}`,
      kind: 'rebind',
      atMs: h.atMs,
      label,
      origin: 'mapping',
      detail: h.comment,
    });
  }
  return out;
}

/** Технические отметки сотрудника (из журнала проверки) внутри окна. */
export function techEventsFromMarks(marks: TechMarkRecord[], fromMs: number, toMs: number): TechEvent[] {
  return (marks || [])
    .filter((m) => Number.isFinite(m.atMs) && m.atMs >= fromMs && m.atMs <= toMs)
    .map((m) => ({
      id: `mark:${m.id}`,
      kind: 'journal' as const,
      atMs: m.atMs,
      label: techMarkLabel(m.kind),
      origin: 'journal' as const,
      detail: [m.comment, m.by ? `отметил: ${m.by}` : ''].filter(Boolean).join(' · ') || undefined,
    }));
}

/**
 * Участки непрерывного счётчика: разрыв на сбросе и смене источника.
 * Возвращает список; если разрывов нет — один участок.
 */
export function splitSegments(samples: MeasureSample[], fromMs: number, toMs: number): CounterSegment[] {
  const inWindow = samples.filter((s) => s.atMs >= fromMs && s.atMs <= toMs);
  if (!inWindow.length) return [];
  const out: CounterSegment[] = [];
  let segStartIdx = 0;
  let segIndex = 0;
  let breakReason: string | null = null;
  const close = (endIdx: number) => {
    const slice = inWindow.slice(segStartIdx, endIdx + 1);
    out.push({
      index: segIndex,
      fromMs: slice[0].atMs,
      toMs: slice[slice.length - 1].atMs,
      sampleCount: slice.length,
      breakReason,
    });
    segIndex += 1;
  };
  for (let i = 1; i < inWindow.length; i += 1) {
    const prev = inWindow[i - 1];
    const cur = inWindow[i];
    let reason: string | null = null;
    if (prev.odoKm != null && cur.odoKm != null && cur.odoKm < prev.odoKm - 0.001) {
      reason = 'сброс счётчика';
    } else if (prev.odoSource && cur.odoSource && prev.odoSource !== cur.odoSource) {
      reason = 'смена источника одометра';
    }
    if (reason) {
      close(i - 1);
      segStartIdx = i;
      breakReason = reason;
    }
  }
  close(inWindow.length - 1);
  return out;
}

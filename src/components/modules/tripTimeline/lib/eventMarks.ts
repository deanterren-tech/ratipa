/**
 * Компактные маркеры событий для таймлайна (основного и встроенного).
 *
 * Событие показывается НЕ полосой, а маркером на своей реальной дате;
 * близкие события (в пределах одного дня) группируются в один маркер со
 * счётчиком — каждая запись остаётся доступной в подсказке и в журнале рейса.
 */
import type { TimelineVehicleEvent } from '../../../../types';
import { dayNum, fmtDM } from './timeline';

export interface EventMark {
  /** Реальная дата события (номер дня). */
  day: number;
  color: string;
  /** Готовая подсказка одиночного маркера. */
  title: string;
  /** Связь с рейсом (если есть) — маркер кликабелен. */
  tripKey?: string;
  eventId: string;
}

export interface EventMarkGroup {
  /** День маркера (первое событие группы). */
  day: number;
  /** Последний день группы (для подсказки диапазона). */
  lastDay: number;
  count: number;
  items: EventMark[];
  /** Цель перехода по клику: самое новое связанное с рейсом событие. */
  tripKey?: string;
  eventId?: string;
  title: string;
}

/** Маркер одиночного события: подсказка с датой, типом и кратким текстом. */
export const eventMarkOf = (
  e: TimelineVehicleEvent,
  typeName: string,
  typeColor: string,
  hint?: string,
): EventMark | null => {
  const day = dayNum(e.dateFrom);
  if (day == null) return null;
  const short = String(e.note || '').replace(/\s+/g, ' ').trim();
  const shortText = short.length > 140 ? `${short.slice(0, 139)}…` : short;
  const title = `${typeName}${shortText ? `: ${shortText}` : ''} · ${fmtDM(day)}${hint ? ` · ${hint}` : ''}`;
  return { day, color: typeColor, title, tripKey: e.tripKey, eventId: e.id };
};

/**
 * Группировка маркеров: события рядом по времени (разница ≤ 1 дня) собираются
 * в один маркер со счётчиком; подсказка перечисляет каждую запись.
 */
export const groupEventMarks = (marks: EventMark[]): EventMarkGroup[] => {
  const sorted = [...marks].sort((a, b) => a.day - b.day);
  const groups: EventMark[][] = [];
  sorted.forEach((m) => {
    const last = groups[groups.length - 1];
    if (last && m.day - last[last.length - 1].day <= 1) last.push(m);
    else groups.push([m]);
  });
  return groups.map((g) => {
    const day = g[0].day;
    const lastDay = g[g.length - 1].day;
    const target = [...g].reverse().find((m) => m.tripKey);
    const title =
      g.length === 1
        ? g[0].title
        : `События (${g.length}) на ${fmtDM(day)}${lastDay !== day ? `–${fmtDM(lastDay)}` : ''}:\n${g
            .map((m) => `• ${m.title}`)
            .join('\n')}`;
    return {
      day,
      lastDay,
      count: g.length,
      items: g,
      tripKey: target?.tripKey,
      eventId: target?.eventId,
      title,
    };
  });
};

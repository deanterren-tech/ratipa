/**
 * Справочники модуля «Таймлайн рейсов по машинам».
 *
 * Типы этапов расширяются БЕЗ правки кода: рабочий справочник читается из
 * RTDB — `tripTimeline/config/stageTypes` (объект {key: {key, name, order}}).
 * Значения ниже — встроенный fallback и сид для первого заполнения базы.
 * События машин — фиксированный набор видов с цветами полосы на таймлайне.
 */
import type { TimelineStage, TimelineStageType } from '../../../../types';

/** Типы этапов по умолчанию (спецификация: Загрузка, Затаможка, Граница,
 *  Растаможка, Бронь, Выгрузка, Другое). */
export const DEFAULT_STAGE_TYPES: TimelineStageType[] = [
  { key: 'load', name: 'Загрузка', order: 1 },
  { key: 'cust_out', name: 'Затаможка (экспорт)', order: 2 },
  { key: 'border', name: 'Граница', order: 3 },
  { key: 'cust_in', name: 'Растаможка (импорт)', order: 4 },
  { key: 'reserve', name: 'Бронь / согласование перехода', order: 5 },
  { key: 'unl', name: 'Выгрузка', order: 6 },
  { key: 'other', name: 'Другое', order: 7 },
];

export interface EventTypeMeta {
  key: string;
  name: string;
  color: string;
}

/** Виды событий машины. Цвета — семантика полосы на таймлайне (белый текст). */
export const DEFAULT_EVENT_TYPES: EventTypeMeta[] = [
  { key: 'repair', name: 'Ремонт', color: '#D97706' },
  { key: 'base', name: 'На базе', color: '#64748B' },
  { key: 'idle', name: 'Простой / ожидание', color: '#A16207' },
  { key: 'other', name: 'Другое', color: '#7C3AED' },
];

export const eventTypeOf = (kind: string): EventTypeMeta =>
  DEFAULT_EVENT_TYPES.find((t) => t.key === kind) || DEFAULT_EVENT_TYPES[3];

/** Эффективный справочник типов: из базы (если задан), иначе встроенный. */
export const effectiveStageTypes = (fromDb: TimelineStageType[]): TimelineStageType[] => {
  const list = (fromDb || []).filter((t) => t && t.key);
  if (!list.length) return DEFAULT_STAGE_TYPES;
  return [...list].sort((a, b) => (a.order || 0) - (b.order || 0) || a.key.localeCompare(b.key));
};

/** Название типа этапа по ключу. */
export const stageTypeName = (types: TimelineStageType[], stage: TimelineStage): string => {
  const found = types.find((t) => t.key === stage.type);
  return found ? found.name : (stage.type || 'Этап');
};

/** Полное имя этапа: тип + уточнение (какая граница / переход). */
export const stageFullName = (types: TimelineStageType[], stage: TimelineStage): string => {
  const base = stageTypeName(types, stage);
  return stage.label ? `${base} — ${stage.label}` : base;
};

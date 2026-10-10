/**
 * Настройки отображения «Таймлайна рейсов» — в ПРОФИЛЕ пользователя
 * (users_list/{uid}/tlPrefs), а не только в браузере: один и тот же выбор
 * действует на всех устройствах. Здесь — лёгкий внешний store (не React-
 * контекст), чтобы встроенные мини-таймлайны (окно рейса, машины, «Учёта
 * выезда») читали значение без протаскивания пропсов через пол-модуля.
 *
 * По умолчанию перекрёстная подсветка столбца ВКЛЮЧЕНА; инициализацию из
 * профиля и сохранение делает модуль (TripTimelineModule), компоненты лишь
 * подписываются.
 */
import { useSyncExternalStore } from 'react';

let columnHighlight = true;
const listeners = new Set<() => void>();

export const getColumnHighlight = (): boolean => columnHighlight;

export const setColumnHighlight = (value: boolean): void => {
  const next = value !== false;
  if (next === columnHighlight) return;
  columnHighlight = next;
  listeners.forEach((fn) => fn());
};

export const subscribeTimelinePrefs = (fn: () => void): (() => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** Реактивное значение для компонентов («Подсветка столбца» включена). */
export const useColumnHighlight = (): boolean =>
  useSyncExternalStore(subscribeTimelinePrefs, getColumnHighlight, () => true);

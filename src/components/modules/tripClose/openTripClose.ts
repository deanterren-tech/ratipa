/**
 * Точка запуска сценария «Закрыть рейс» из любого места портала.
 *
 * Все входы (карточка плана дохода, меню строки, карточка рейса на таймлайне)
 * запускают ОДИН сценарий: событие принимает AppShell и открывает мастер.
 * Сценарий привязан к конкретной записи плана дохода, а не к номеру машины.
 */
export const OPEN_TRIP_CLOSE_EVENT = 'ratipa:open-trip-close';

export const openTripClose = (tripId: string | null | undefined): boolean => {
  const id = String(tripId || '').trim();
  if (!id) return false;
  window.dispatchEvent(new CustomEvent(OPEN_TRIP_CLOSE_EVENT, { detail: { tripId: id } }));
  return true;
};

/**
 * Правки периода «Учёта выезда» из окна таймлайна (запись — та же, что у
 * модуля «Учёт выезда»: ветка RTDB `baza`, те же поля и тот же журнал).
 *
 * Здесь живут ТОЛЬКО записи в базу, повторяющие существующие правила модуля:
 *  - сохранение полей периода (приезд, срок готовности, фактический выезд,
 *    примечание, заявка на ремонт / завершение ремонта) — запись идёт в те же
 *    поля `baza/<id>`, история — в тот же журнал (baza/<id>/history +
 *    global_history), в том же формате, что пишет модуль (logHistory);
 *  - события ремонта — ВЛОЖЕННАЯ ветка `baza/<periodId>/events/<eventId>`
 *    (Firestore в проекте не используется; буква ТЗ про subcollection
 *    отображена на существующее хранилище периода — см. отчёт);
 *  - явный сдвиг срока готовности из события «Ждём запчасть» — ОТДЕЛЬНОЕ
 *    действие с записью в историю; ничего не двигается автоматически.
 *
 * Никаких расчётов дней/сроков здесь нет — они остаются в lib/sources.
 */
import { push, ref, remove, update } from 'firebase/database';
import { database } from '../../../../api';
import { repairEventLabel, type RepairEvent } from './repairEvents';

export interface PeriodEditor {
  name: string;
  role?: string;
}

const userText = (user: PeriodEditor): string => `${user.name}${user.role ? ` (${user.role})` : ''}`;

/** dd/mm/yyyy (конвенция портала). */
export const ruDate = (iso?: string | null): string => (iso ? String(iso).split('-').reverse().join('/') : '');

/** Подписи полей записи — те же, что в модуле «Учёт выезда» (fieldLabels). */
export const PERIOD_FIELD_LABELS: Record<string, string> = {
  dateArrival: 'Прибыл на базу',
  dateLoading: 'Срок готовности',
  dateRepairStart: 'Заявка на ремонт',
  dateRepairEnd: 'Завершение ремонта',
  dateDeparture: 'Фактический выезд',
  comment: 'Примечание',
};

export interface PeriodHistoryEntry {
  field: string;
  was: string;
  became: string;
  actionType?: 'create' | 'update' | 'delete';
}

const stamp = (): string => {
  const now = new Date();
  return (
    now.toLocaleDateString('ru-RU').replace(/\./g, '/') +
    ' ' +
    now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
  );
};

/**
 * Пути журнала — формат модуля «Учёт выезда» (logHistory): одна запись в
 * baza/<id>/history и одна в global_history на каждое изменение.
 */
const historyPaths = (
  periodId: string,
  entries: PeriodHistoryEntry[],
  user: PeriodEditor,
  carNumber: string,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  entries.forEach((e) => {
    const ev = {
      date: stamp(),
      user: userText(user),
      field: e.field,
      old: e.was || '[Пусто]',
      new: e.became || '[Пусто]',
    };
    const localRef = push(ref(database, `baza/${periodId}/history`));
    out[`baza/${periodId}/history/${localRef.key}`] = ev;
    const globalRef = push(ref(database, 'global_history'));
    out[`global_history/${globalRef.key}`] = {
      ...ev,
      carNumber: carNumber || 'Неизвестно',
      actionType: e.actionType || (e.became === '[Запись стерта]' ? 'delete' : 'update'),
    };
  });
  return out;
};

/**
 * Сохранить поля периода одной атомарной записью (только переданные поля).
 * historyEntries — описания изменений для журнала (в формате модуля).
 */
export const savePeriodFields = async (
  periodId: string,
  fields: Record<string, string>,
  historyEntries: PeriodHistoryEntry[],
  user: PeriodEditor,
  carNumber: string,
): Promise<void> => {
  const updates: Record<string, unknown> = {};
  Object.entries(fields).forEach(([k, v]) => {
    updates[`baza/${periodId}/${k}`] = v;
  });
  Object.assign(updates, historyPaths(periodId, historyEntries, user, carNumber));
  await update(ref(database), updates);
};

export interface RepairEventDraft {
  date: string;
  /**
   * Ключ типа события: для НОВЫХ записей форма пишет 'other' — «Другое»
   * (форма без типа; подпись типа больше не выбирается и не требуется).
   * У уже сохранённых записей тип НЕ переписывается и не удаляется.
   */
  type: string;
  text: string;
  /**
   * Порядковый номер внесения в рамках периода (целое ≥ 1) — присваивается
   * вызывающим слоем (max(seq)+1 по периоду, см. lib/repairEvents.nextEventSeq).
   * При правке события НЕ меняется (порядок внесения сохраняется).
   */
  seq?: number | null;
}

/** Правка события: дата и текст. Тип и сумма — поля старых записей: правка их
 *  НЕ трогает (не переписывает и не обнуляет), в интерфейсе они не показываются. */
export interface RepairEventEditDraft {
  date: string;
  text: string;
}

/** Сводка события для журнала изменений: текст, а у старых записей без текста —
 *  подпись бывшего типа; сумма в сводку больше не входит (в интерфейсе её нет,
 *  данные в базе остаются). */
const eventSummaryText = (e: { date?: string; type?: string; text?: string }): string => {
  const text = String(e.text || '');
  const label = text || repairEventLabel(String(e.type || 'other'));
  const date = e.date ? ruDate(e.date) : '';
  return `${label}${date ? ` ${date}` : ''}`;
};

/**
 * Добавить событие на базе (вложенная ветка events записи периода).
 * Сумма не пишется вовсе (поле у новых записей не создаётся); тип — 'other'
 * («Другое») от вызывающего слоя; type/amount старых записей не изменяются.
 */
export const addRepairEvent = async (
  periodId: string,
  draft: RepairEventDraft,
  user: PeriodEditor,
  carNumber: string,
): Promise<string> => {
  const listRef = push(ref(database, `baza/${periodId}/events`));
  const id = String(listRef.key);
  const doc: Record<string, unknown> = {
    id,
    date: draft.date,
    type: draft.type || 'other',
    text: draft.text,
    author: user.name,
    createdAt: new Date().toISOString(),
  };
  // Порядковый номер внесения: целое ≥ 1 (передаёт вызывающий слой; без номера
  // запись тоже валидна — в чтении порядок возьмётся из createdAt).
  const seq = Math.floor(Number(draft.seq));
  if (Number.isFinite(seq) && seq >= 1) doc.seq = seq;
  const updates: Record<string, unknown> = { [`baza/${periodId}/events/${id}`]: doc };
  Object.assign(
    updates,
    historyPaths(
      periodId,
      [{ field: 'Событие на базе', was: '', became: eventSummaryText(draft), actionType: 'create' }],
      user,
      carNumber,
    ),
  );
  await update(ref(database), updates);
  return id;
};

/** Изменить событие на базе: ТОЛЬКО дата и текст (+ updatedAt/updatedBy и
 *  журнал). Тип и сумма записи не переписываются (данные старых записей
 *  сохраняются как есть). */
export const updateRepairEvent = async (
  periodId: string,
  eventId: string,
  draft: RepairEventEditDraft,
  previous: RepairEvent,
  user: PeriodEditor,
  carNumber: string,
): Promise<void> => {
  const updates: Record<string, unknown> = {
    [`baza/${periodId}/events/${eventId}/date`]: draft.date,
    [`baza/${periodId}/events/${eventId}/text`]: draft.text,
    [`baza/${periodId}/events/${eventId}/updatedAt`]: new Date().toISOString(),
    [`baza/${periodId}/events/${eventId}/updatedBy`]: user.name,
  };
  const before = { date: previous.dateIso, type: previous.type, text: previous.text };
  Object.assign(
    updates,
    historyPaths(
      periodId,
      [{ field: 'Событие на базе (правка)', was: eventSummaryText(before), became: eventSummaryText(draft) }],
      user,
      carNumber,
    ),
  );
  await update(ref(database), updates);
};

/** Удалить событие ремонта (с записью в журнал; подтверждение — в интерфейсе). */
export const deleteRepairEvent = async (
  periodId: string,
  event: RepairEvent,
  user: PeriodEditor,
  carNumber: string,
): Promise<void> => {
  const updates: Record<string, unknown> = {};
  Object.assign(
    updates,
    historyPaths(
      periodId,
      [
        {
          field: 'Событие на базе (удаление)',
          was: eventSummaryText({ date: event.dateIso, type: event.type, text: event.text }),
          became: '[Запись стерта]',
          actionType: 'delete',
        },
      ],
      user,
      carNumber,
    ),
  );
  await update(ref(database), updates);
  await remove(ref(database, `baza/${periodId}/events/${event.id}`));
};

/**
 * Явный сдвиг срока готовности из события «Ждём запчасть»: обновляет
 * dateLoading, помечает событие (shiftedReadyFrom/To) и пишет журнал.
 * Вызывается ТОЛЬКО по нажатию кнопки — автоматического сдвига нет.
 */
export const applyWaitEventShift = async (
  periodId: string,
  eventId: string,
  fromIso: string,
  toIso: string,
  user: PeriodEditor,
  carNumber: string,
): Promise<void> => {
  const updates: Record<string, unknown> = {
    [`baza/${periodId}/dateLoading`]: toIso,
    [`baza/${periodId}/events/${eventId}/shiftedReadyFrom`]: fromIso || '',
    [`baza/${periodId}/events/${eventId}/shiftedReadyTo`]: toIso,
    [`baza/${periodId}/events/${eventId}/updatedAt`]: new Date().toISOString(),
    [`baza/${periodId}/events/${eventId}/updatedBy`]: user.name,
  };
  Object.assign(
    updates,
    historyPaths(
      periodId,
      [
        {
          field: 'Срок готовности (сдвиг из события «Ждём запчасть»)',
          was: fromIso ? ruDate(fromIso) : '',
          became: ruDate(toIso),
        },
      ],
      user,
      carNumber,
    ),
  );
  await update(ref(database), updates);
};

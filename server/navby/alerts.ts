/**
 * Планирование уведомлений модуля «Пробег и связь» (чистая логика).
 *
 * Задача — НЕ заспамить: одно открытое уведомление на пару
 * (автомобиль/обращение, тип), ограничение частоты (cooldown), закрытие
 * уведомления при устранении условия, лимит новых уведомлений за цикл.
 * Сами записи в ratipa_notifications делает store.ts по этому плану.
 */

export type AlertKind =
  | 'no_updates'
  | 'rf_window_over'
  | 'reply_overdue'
  | 'master_needed'
  | 'restored';

export interface AlertCarInput {
  carKey: string;
  plate: string;
  coordAtMs: number | null;
  /** Обработки по этому авто: id и статус (для напоминаний по обращениям). */
  requests: Array<{ id: string; status: string; createdAtMs: number | null; updatedAtMs: number | null }>;
}

export interface AlertConfig {
  enabled: boolean;
  staleHours: number;
  rfWindowHours: number;
  replyRemindHours: number;
  cooldownHours: number;
  maxAlertsPerRun: number;
  roles: string[];
}

export interface AlertStateEntry {
  lastAtMs: number;
  lastKind: string;
  active: boolean;
}

export interface PlannedAlert {
  id: string;
  action: 'upsert' | 'remove';
  kind: AlertKind;
  carKey: string;
  title: string;
  text: string;
  roles: string[];
  atMs: number;
}

export interface RfEntryLite {
  atMs: number | null;
}

const HOUR_MS = 3_600_000;

/** Детерминированные id: один живой id на (объект, тип) — дедупликация. */
export const alertNoUpdatesId = (carKey: string) => `mc_${carKey}_no_updates`;
export const alertRfOverId = (carKey: string) => `mc_${carKey}_rf_over`;
export const alertRestoredId = (carKey: string) => `mc_${carKey}_restored`;
export const alertReplyId = (carKey: string, reqId: string) => `mc_${carKey}_reply_${reqId}`;
export const alertMasterId = (carKey: string, reqId: string) => `mc_${carKey}_master_${reqId}`;

const fmtAge = (nowMs: number, atMs: number): string => {
  const h = Math.floor((nowMs - atMs) / HOUR_MS);
  if (h < 1) return 'меньше часа';
  if (h < 24) return `${h} ч`;
  const d = Math.floor(h / 24);
  return `${d} дн`;
};

/**
 * Чистая функция: какой набор уведомлений должен существовать
 * после цикла опроса. `state` — прошлое состояние (telemetry_alerts).
 * «restored» — разовое уведомление о восстановлении свежести данных.
 */
export function planAlerts(params: {
  nowMs: number;
  cars: AlertCarInput[];
  rfEntries: Record<string, RfEntryLite>;
  config: AlertConfig;
  state: Record<string, AlertStateEntry>;
}): PlannedAlert[] {
  const { nowMs, cars, rfEntries, config, state } = params;
  const out: PlannedAlert[] = [];
  if (!config.enabled) return out;

  const cooldownMs = Math.max(0, config.cooldownHours) * HOUR_MS;
  const staleMs = Math.max(1, config.staleHours) * HOUR_MS;
  const rfWindowMs = Math.max(1, config.rfWindowHours) * HOUR_MS;
  const replyMs = Math.max(1, config.replyRemindHours) * HOUR_MS;

  const roleList = config.roles && config.roles.length ? config.roles : ['root_admin', 'admin', 'manager'];

  const canFire = (id: string, kind: AlertKind): boolean => {
    const prev = state[id];
    if (!prev) return true;
    if (prev.lastKind !== kind) return true;
    return nowMs - (prev.lastAtMs || 0) >= cooldownMs;
  };

  const push = (a: PlannedAlert) => {
    out.push({ ...a, atMs: nowMs });
  };

  const countUpserts = () => out.filter((a) => a.action === 'upsert' && a.kind !== 'restored').length;

  for (const car of cars) {
    const noUpdId = alertNoUpdatesId(car.carKey);
    const rfOverId = alertRfOverId(car.carKey);
    const restoredId = alertRestoredId(car.carKey);

    const hasData = car.coordAtMs != null;
    const stale = hasData && nowMs - (car.coordAtMs as number) > staleMs;
    const rf = rfEntries[car.carKey];
    const rfAt = rf && rf.atMs != null ? rf.atMs : null;
    const inRfWindow = rfAt != null && nowMs - rfAt < rfWindowMs;

    if (stale && inRfWindow) {
      // Окно ожидания после въезда в РФ: НЕ создаём уведомления об отсутствии
      // обновлений, но и не скрываем проблему (контекст виден во вкладке).
      // Условие «устаревшее» больше не действует — открытые закрываем.
      if (state[noUpdId]?.active) push({ id: noUpdId, action: 'remove', kind: 'no_updates', carKey: car.carKey, title: '', text: '', roles: roleList, atMs: nowMs });
      if (state[rfOverId]?.active) push({ id: rfOverId, action: 'remove', kind: 'rf_window_over', carKey: car.carKey, title: '', text: '', roles: roleList, atMs: nowMs });
    } else if (stale) {
      if (rfAt != null && nowMs - rfAt >= rfWindowMs) {
        // Окно ожидания после въезда истекло, свежих данных нет.
        if (state[noUpdId]?.active) push({ id: noUpdId, action: 'remove', kind: 'no_updates', carKey: car.carKey, title: '', text: '', roles: roleList, atMs: nowMs });
        if (canFire(rfOverId, 'rf_window_over') && countUpserts() < config.maxAlertsPerRun) {
          push({
            id: rfOverId, action: 'upsert', kind: 'rf_window_over', carKey: car.carKey,
            title: `Пробег и связь: окно ожидания после въезда в РФ истекло — ${car.plate}`,
            text: `Въезд в РФ подтверждён ${new Date(rfAt).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}, данных с тех пор нет (${fmtAge(nowMs, rfAt)}). Проверьте связь устройства и состояние SIM.`,
            roles: roleList, atMs: nowMs,
          });
        }
      } else if (canFire(noUpdId, 'no_updates') && countUpserts() < config.maxAlertsPerRun) {
        push({
          id: noUpdId, action: 'upsert', kind: 'no_updates', carKey: car.carKey,
          title: `Пробег и связь: нет обновлений — ${car.plate}`,
          text: `Последняя известная позиция старше ${config.staleHours} ч (${fmtAge(nowMs, car.coordAtMs as number)}). Это может быть связь, питание трекера или отсутствие данных; причина не определена.`,
          roles: roleList, atMs: nowMs,
        });
      }
    } else {
      // Свежие данные: закрываем «нет обновлений»/«окно истекло», пишем restored.
      if (state[noUpdId]?.active) push({ id: noUpdId, action: 'remove', kind: 'no_updates', carKey: car.carKey, title: '', text: '', roles: roleList, atMs: nowMs });
      if (state[rfOverId]?.active) push({ id: rfOverId, action: 'remove', kind: 'rf_window_over', carKey: car.carKey, title: '', text: '', roles: roleList, atMs: nowMs });
      if (hasData && (state[noUpdId] || state[rfOverId]) && canFire(restoredId, 'restored')) {
        push({
          id: restoredId, action: 'upsert', kind: 'restored', carKey: car.carKey,
          title: `Пробег и связь: данные восстановлены — ${car.plate}`,
          text: `Поступления по устройству возобновились (координата от ${new Date(car.coordAtMs as number).toLocaleString('ru-RU', { timeZone: 'Europe/Minsk' })}).`,
          roles: roleList, atMs: nowMs,
        });
      }
    }

    // Обращения по авто: напоминание об ответе и «требуется мастер».
    for (const req of car.requests) {
      const replyId = alertReplyId(car.carKey, req.id);
      const masterId = alertMasterId(car.carKey, req.id);
      const base = req.updatedAtMs ?? req.createdAtMs;
      if ((req.status === 'sent' || req.status === 'awaiting_reply') && base != null && nowMs - base > replyMs) {
        if (canFire(replyId, 'reply_overdue') && countUpserts() < config.maxAlertsPerRun) {
          push({
            id: replyId, action: 'upsert', kind: 'reply_overdue', carKey: car.carKey,
            title: `Пробег и связь: нет ответа по обращению — ${car.plate}`,
            text: `Обращение ожидает ответа более ${Math.round(replyMs / HOUR_MS)} ч. Напомните поддержке или зафиксируйте ответ вручную.`,
            roles: roleList, atMs: nowMs,
          });
        }
      } else if (state[replyId]?.active) {
        push({ id: replyId, action: 'remove', kind: 'reply_overdue', carKey: car.carKey, title: '', text: '', roles: roleList, atMs: nowMs });
      }
      if (req.status === 'master_needed') {
        if (canFire(masterId, 'master_needed') && countUpserts() < config.maxAlertsPerRun) {
          push({
            id: masterId, action: 'upsert', kind: 'master_needed', carKey: car.carKey,
            title: `Пробег и связь: требуется осмотр мастером — ${car.plate}`,
            text: `По обращению отмечено «требуется мастер». Запланируйте осмотр оборудования.`,
            roles: roleList, atMs: nowMs,
          });
        }
      } else if (state[masterId]?.active) {
        push({ id: masterId, action: 'remove', kind: 'master_needed', carKey: car.carKey, title: '', text: '', roles: roleList, atMs: nowMs });
      }
    }
  }

  return out;
}

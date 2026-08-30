/**
 * Event Bus — шина событий на Firebase RTDB для коммуникации агентов.
 * Агенты публикуют события в agent_events/, подписчики реагируют.
 */

import { adminDb } from "../../firebaseAdmin.ts";

export interface AgentEvent {
  type: string;
  source: string;
  payload: Record<string, any>;
  timestamp: number;
}

const EVENT_PATHS: Record<string, string[]> = {
  vehicleStatusChanged: ["baza", "trip", "analytics"],
  tripCreated: ["analytics"],
  tripClosed: ["finance", "permit", "document"],
  permitUsed: ["analytics"],
  salaryCalculated: ["archive", "analytics"],
  documentGenerated: [],
  anomalyDetected: ["baza", "analytics"],
};

/** Публикация события */
export async function publishEvent(
  type: string,
  source: string,
  payload: Record<string, any>,
): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.ref("agent_events").child(type).push({
      source,
      payload,
      timestamp: Date.now(),
      processedBy: EVENT_PATHS[type] || [],
    });
    console.log(`[EventBus] Событие ${type} от ${source}`);
  } catch (err) {
    console.error(`[EventBus] Ошибка публикации ${type}:`, err);
  }
}

/** Подписка на события (для использования в Express/cron) */
export function subscribeToEvent(
  type: string,
  callback: (event: AgentEvent) => void,
): () => void {
  if (!adminDb) return () => {};
  const ref = adminDb.ref(`agent_events/${type}`);
  const listener = ref.on("child_added", (snap) => {
    const val = snap.val();
    if (val) {
      callback({ type, ...val });
    }
  });
  return () => ref.off("child_added", listener);
}

export default { publishEvent, subscribeToEvent };
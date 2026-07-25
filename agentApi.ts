// Agent API — единый REST-доступ ко ВСЕМ функциям приложения для бота/агента.
// Delegated-режим: бот действует ЗА реального пользователя (токен верифицирован в agentAuth).
// Все мутации логируются в auditLogs. Права проверяются на сервере (permissions.can).

import { Router, type Response } from "express";
import { adminDb } from "./firebaseAdmin.ts";
import { can, type AgentUser } from "./permissions.ts";
import type { AgentRequest } from "./agentAuth.ts";

export const agentRouter = Router();

// --- Маппинг сущность -> корень RTDB + поведение ---
interface EntitySpec {
  path: string; // корень пути в RTDB
  idField?: string; // поле, содержащее id внутри записи (для save без id в URL)
  generateId?: boolean; // генерировать push-id при POST
  readOnly?: boolean; // только чтение (напр. audit)
  auditLabel: string;
}

const ENTITIES: Record<string, EntitySpec> = {
  vehicles: { path: "vehicleFleet", idField: "id", generateId: true, auditLabel: "Авто (vehicleFleet)" },
  drivers: { path: "driversPool", idField: "id", generateId: true, auditLabel: "Водители (driversPool)" },
  couplings: { path: "tractors", auditLabel: "Сцепки (tractors)" },
  trips: { path: "trips", idField: "id", generateId: true, auditLabel: "Рейсы (trips)" },
  permits: { path: "permits", idField: "id", generateId: true, auditLabel: "Дозволы (permits)" },
  salaries: { path: "salaries", idField: "id", generateId: true, auditLabel: "Зарплата (salaries)" },
  baza: { path: "baza", idField: "id", auditLabel: "Учёт выезда (baza)" },
  archive: { path: "archive", idField: "id", auditLabel: "Архив (archive)" },
  knownFleet: { path: "known_fleet", idField: "id", generateId: true, auditLabel: "Известный автопарк (known_fleet)" },
  directions: { path: "directionsPool", idField: "id", generateId: true, auditLabel: "Направления (directionsPool)" },
  rates: { path: "carsPool", idField: "id", generateId: true, auditLabel: "Ставки (carsPool)" },
  distances: { path: "knownDistancesList", idField: "id", generateId: true, auditLabel: "Расстояния (knownDistancesList)" },
  currencies: { path: "currenciesList", idField: "id", generateId: true, auditLabel: "Валюты (currenciesList)" },
  ferryTemplates: { path: "ferryTemplates", idField: "id", generateId: true, auditLabel: "Паромы (ferryTemplates)" },
  chat: { path: "chat", idField: "id", generateId: true, auditLabel: "Чат (chat)" },
  notifications: { path: "broadcast_notifications", idField: "id", generateId: true, auditLabel: "Уведомления (broadcast_notifications)" },
  archiveVehicles: { path: "archivecars", idField: "id", auditLabel: "Архив авто (archivecars)" },
  vehicleStatuses: { path: "vehicle_statuses", auditLabel: "Статусы ТС (vehicle_statuses)" },
  audit: { path: "auditLogs", readOnly: true, auditLabel: "Журнал аудита (auditLogs)" },
  users: { path: "users_list", idField: "uid", auditLabel: "Пользователи (users_list)" },
  settings: { path: "settings", auditLabel: "Настройки (settings)" },
  couplingsTrailers: { path: "trailers", auditLabel: "Прицепы (trailers)" },
};

function audit(user: AgentUser, action: string, label: string, detail?: any) {
  if (!adminDb) return;
  const ref = adminDb.ref("auditLogs").push();
  ref.set({
    user: user.name,
    role: user.role,
    uid: user.uid,
    action,
    target: label,
    detail: detail ? JSON.stringify(detail).slice(0, 2000) : "",
    timestamp: Date.now(),
  }).catch(() => {});
}

function send(res: Response, code: number, data: any) {
  res.status(code).json(data);
}

// GET /api/agent/:entity  (список) и GET /api/agent/:entity/:id (один)
agentRouter.get("/:entity/:id?", async (req: AgentRequest, res: Response) => {
  const user = req.agentUser!;
  const { entity, id } = req.params;
  const spec = ENTITIES[entity];
  if (!spec) return send(res, 404, { error: `Неизвестная сущность: ${entity}` });
  if (!can(user, entity, "read")) return send(res, 403, { error: "Нет прав на чтение" });

  try {
    const base = adminDb!.ref(spec.path);
    if (id) {
      const snap = await base.child(id).once("value");
      return send(res, 200, { id, data: snap.val() ?? null });
    }
    const snap = await base.once("value");
    const val = snap.val();
    // Преобразуем в массив с id для удобства бота
    const list = val
      ? Object.entries(val).map(([k, v]: [string, any]) => ({ id: k, ...(v || {}) }))
      : [];
    return send(res, 200, { count: list.length, data: list });
  } catch (e: any) {
    return send(res, 500, { error: e?.message || String(e) });
  }
});

// POST /api/agent/:entity  (создать)
agentRouter.post("/:entity", async (req: AgentRequest, res: Response) => {
  const user = req.agentUser!;
  const { entity } = req.params;
  const spec = ENTITIES[entity];
  if (!spec) return send(res, 404, { error: `Неизвестная сущность: ${entity}` });
  if (spec.readOnly) return send(res, 405, { error: "Только чтение" });
  if (!can(user, entity, "write")) return send(res, 403, { error: "Нет прав на запись" });

  try {
    const payload = { ...(req.body || {}) };
    let id: string;
    if (spec.generateId) {
      id = adminDb!.ref(spec.path).push().key!;
      if (spec.idField) payload[spec.idField] = id;
    } else if (spec.idField && payload[spec.idField]) {
      id = String(payload[spec.idField]);
    } else {
      return send(res, 400, { error: "Требуется id в теле запроса" });
    }
    await adminDb!.ref(`${spec.path}/${id}`).set(payload);
    audit(user, "create", spec.auditLabel, { id });
    return send(res, 201, { id, data: payload });
  } catch (e: any) {
    return send(res, 500, { error: e?.message || String(e) });
  }
});

// PUT /api/agent/:entity/:id  (обновить)
agentRouter.put("/:entity/:id", async (req: AgentRequest, res: Response) => {
  const user = req.agentUser!;
  const { entity, id } = req.params;
  const spec = ENTITIES[entity];
  if (!spec) return send(res, 404, { error: `Неизвестная сущность: ${entity}` });
  if (spec.readOnly) return send(res, 405, { error: "Только чтение" });
  if (!can(user, entity, "write")) return send(res, 403, { error: "Нет прав на запись" });

  try {
    const payload = { ...(req.body || {}) };
    if (spec.idField) payload[spec.idField] = id;
    await adminDb!.ref(`${spec.path}/${id}`).set(payload);
    audit(user, "update", spec.auditLabel, { id });
    return send(res, 200, { id, data: payload });
  } catch (e: any) {
    return send(res, 500, { error: e?.message || String(e) });
  }
});

// PATCH /api/agent/:entity/:id  (частичное обновление)
agentRouter.patch("/:entity/:id", async (req: AgentRequest, res: Response) => {
  const user = req.agentUser!;
  const { entity, id } = req.params;
  const spec = ENTITIES[entity];
  if (!spec) return send(res, 404, { error: `Неизвестная сущность: ${entity}` });
  if (spec.readOnly) return send(res, 405, { error: "Только чтение" });
  if (!can(user, entity, "write")) return send(res, 403, { error: "Нет прав на запись" });

  try {
    await adminDb!.ref(`${spec.path}/${id}`).update(req.body || {});
    audit(user, "patch", spec.auditLabel, { id, patch: req.body });
    return send(res, 200, { id, patched: true });
  } catch (e: any) {
    return send(res, 500, { error: e?.message || String(e) });
  }
});

// DELETE /api/agent/:entity/:id  (удалить)
agentRouter.delete("/:entity/:id", async (req: AgentRequest, res: Response) => {
  const user = req.agentUser!;
  const { entity, id } = req.params;
  const spec = ENTITIES[entity];
  if (!spec) return send(res, 404, { error: `Неизвестная сущность: ${entity}` });
  if (spec.readOnly) return send(res, 405, { error: "Только чтение" });
  if (!can(user, entity, "write")) return send(res, 403, { error: "Нет прав на запись" });

  try {
    await adminDb!.ref(`${spec.path}/${id}`).remove();
    audit(user, "delete", spec.auditLabel, { id });
    return send(res, 200, { id, deleted: true });
  } catch (e: any) {
    return send(res, 500, { error: e?.message || String(e) });
  }
});

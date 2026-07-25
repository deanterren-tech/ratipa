// Клиентская обёртка Agent API для бота/агента.
// Бот получает Firebase ID-токен текущего пользователя (user.getIdToken())
// и вызывает эти функции — сервер действует ЗА пользователя (delegated).
//
// Пример использования ботом:
//   import { agentApi } from "@/api";
//   const token = await firebaseUser.getIdToken();
//   const couplings = await agentApi.list("couplings", token);
//   await agentApi.create("permits", token, { number: "130520", car: "AB9271" });

export type AgentAction = "read" | "write";

async function request<T = any>(
  method: string,
  entity: string,
  idToken: string,
  id?: string,
  body?: any,
): Promise<T> {
  const url = id
    ? `/api/agent/${entity}/${id}`
    : `/api/agent/${entity}`;
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error || `Agent API ${res.status}`);
  }
  return data as T;
}

export const agentApi = {
  /** Прочитать список записей сущности */
  list: <T = any>(entity: string, idToken: string) =>
    request<T>("GET", entity, idToken),
  /** Прочитать одну запись по id */
  get: <T = any>(entity: string, id: string, idToken: string) =>
    request<T>("GET", entity, idToken, id),
  /** Создать запись (id генерируется сервером, если сущность support) */
  create: <T = any>(entity: string, idToken: string, data: any) =>
    request<T>("POST", entity, idToken, undefined, data),
  /** Полностью заменить запись */
  update: <T = any>(entity: string, id: string, idToken: string, data: any) =>
    request<T>("PUT", entity, idToken, id, data),
  /** Частично обновить поля записи */
  patch: <T = any>(entity: string, id: string, idToken: string, patch: any) =>
    request<T>("PATCH", entity, idToken, id, patch),
  /** Удалить запись */
  remove: <T = any>(entity: string, id: string, idToken: string) =>
    request<T>("DELETE", entity, idToken, id),
};

export default agentApi;

// Серверная проверка прав доступа (зеркалит логику allowedModules из AppShell.tsx).
// user приходит из верифицированного Firebase ID-токена + профиля users_list/{uid}.
// НЕ доверяем клиенту — user/role/permissions резолвятся на сервере.

export type UserPerms = Record<string, string> | undefined;

export interface AgentUser {
  uid: string;
  name: string;
  email?: string;
  role: string; // root_admin | admin | manager | dispatcher | mechanic | ...
  permissions?: UserPerms;
}

const DEFAULT_READS = [
  "planDohod",
  "planZagruzok",
  "baza",
  "vehicleDriverData",
  "dozvola",
  "disposition",
];

const DEFAULT_WRITES = ["dohod", "salary", "documents"];

// Маппинг entity (роут) -> permissionKey (как в allModules AppShell)
const ENTITY_TO_PERMISSION: Record<string, string> = {
  dashboard: "dashboard",
  dohod: "dohod",
  salary: "salary",
  planDohod: "planDohod",
  planZagruzok: "planZagruzok",
  currentPlanning: "currentPlanning",
  baza: "baza",
  vehicleDriverData: "vehicleDriverData",
  dozvola: "dozvola",
  documents: "documents",
  disposition: "disposition",
  settings: "settings",
  appSettings: "settings",
  admin: "admin",
  // расширенные сущности Agent API
  vehicles: "vehicleDriverData",
  drivers: "vehicleDriverData",
  couplings: "vehicleDriverData",
  trips: "planDohod",
  permits: "dozvola",
  directions: "settings",
  rates: "settings",
  distances: "settings",
  currencies: "settings",
  ferryTemplates: "settings",
  notifications: "dashboard",
  chat: "dashboard",
  users: "admin",
  audit: "admin",
  archive: "baza",
  knownFleet: "baza",
  notebook: "dashboard",
  presence: "dashboard",
  settings_app: "settings",
};

export function permissionKeyFor(entity: string): string {
  return ENTITY_TO_PERMISSION[entity] || entity;
}

export function can(
  user: AgentUser,
  entity: string,
  action: "read" | "write",
): boolean {
  const permKey = permissionKeyFor(entity);

  // Механик — только baza
  if (user.role === "mechanic") {
    return permKey === "baza";
  }

  // Полный доступ для root_admin / владельца
  if (
    user.role === "root_admin" ||
    user.name.includes("Сергей Root") ||
    user.email === "r98ratipaby@gmail.com"
  ) {
    return true;
  }

  // Явные права из профиля
  if (user.permissions && user.permissions[permKey] !== undefined) {
    const p = user.permissions[permKey];
    if (p === "none") return false;
    if (p === "write") return true;
    if (p === "read") return action === "read";
    // неизвестное значение -> трактуем как read
    return action === "read";
  }

  // Fallback по роли
  if (user.role === "admin" || user.role === "manager") {
    if (permKey === "admin") return user.role === "admin";
    return true;
  }

  // Dispatcher / прочие
  if (action === "write") {
    return DEFAULT_WRITES.includes(permKey);
  }
  return DEFAULT_WRITES.includes(permKey) || DEFAULT_READS.includes(permKey);
}

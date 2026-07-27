import { UserProfile } from "../types";

/** Базовые права по ролям (fallback, если нет кастомных/настроенных). */
export const DEFAULT_ROLE_PERMS: Record<string, Record<string, string>> = {
  root_admin: {
    dashboard: "write", dohod: "write", salary: "write", planDohod: "write",
    planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write",
    disposition: "write", documents: "write", settings: "write", admin: "write",
  },
  admin: {
    dashboard: "read", dohod: "write", salary: "write", planDohod: "write",
    planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write",
    disposition: "write", documents: "write", settings: "write", admin: "none",
  },
  manager: {
    dashboard: "read", dohod: "write", salary: "write", planDohod: "write",
    planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write",
    disposition: "write", documents: "write", settings: "write", admin: "none",
  },
  mechanic: { dashboard: "read", baza: "read" },
  dispatcher: {
    dashboard: "read", dohod: "write", salary: "write", planDohod: "read",
    planZagruzok: "read", baza: "read", vehicleDriverData: "read", dozvola: "read",
    disposition: "read", documents: "write", settings: "none", admin: "none",
  },
  accountant: {
    dashboard: "read", dohod: "write", salary: "write", planDohod: "read",
    planZagruzok: "read", baza: "read", vehicleDriverData: "read", dozvola: "read",
    disposition: "read", documents: "write", settings: "none", admin: "none",
  },
  viewer: {
    dashboard: "read", dohod: "none", salary: "none", planDohod: "none",
    planZagruzok: "none", baza: "read", vehicleDriverData: "none", dozvola: "none",
    disposition: "none", documents: "none", settings: "none", admin: "none",
  },
  logist: {
    dashboard: "read", dohod: "none", salary: "none", planDohod: "read",
    planZagruzok: "write", baza: "read", vehicleDriverData: "read", dozvola: "read",
    disposition: "write", documents: "none", settings: "none", admin: "none",
  },
};

const ROOT_USERS = ["Сергей Root", "r98ratipaby@gmail.com"];

/**
 * Резолвит эффективное право доступа пользователя к ключу (модуль или вкладка).
 * Учитывает: root-админов, явные переопределения (permissions[key]),
 * и наследование через роль (DEFAULT_ROLE_PERMS + settings.rolePermissions).
 * Возвращает "none" | "read" | "write".
 */
export function resolvePermission(user: UserProfile, key: string, rolePermissions?: Record<string, Record<string, string>>): "none" | "read" | "write" {
  if (user.role === "root_admin" || ROOT_USERS.includes(user.name) || ROOT_USERS.includes(user.email || "")) {
    return "write";
  }

  // Явное переопределение пользователя
  const custom = user.permissions?.[key];
  if (custom !== undefined && custom !== "inherit") {
    return custom === "write" || custom === "read" ? custom : "none";
  }

  // Наследование через роль
  const role = user.role;
  if (role === "admin" || role === "manager") {
    if (key === "admin") return role === "admin" ? "write" : "none";
    return "write";
  }

  const roleBase =
    (rolePermissions && rolePermissions[role]) ||
    DEFAULT_ROLE_PERMS[role] ||
    DEFAULT_ROLE_PERMS["viewer"];

  const inherited = roleBase[key] || "none";
  return inherited === "write" || inherited === "read" ? inherited : "none";
}

/** Виден ли элемент (право не 'none'). */
export function isAllowed(user: UserProfile, key: string, rolePermissions?: Record<string, Record<string, string>>): boolean {
  return resolvePermission(user, key, rolePermissions) !== "none";
}

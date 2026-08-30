/**
 * Fleet Agent — Авто, водители, сцепки.
 */

import type { Agent, AgentResult, AgentSpec } from "./base-agent.ts";
import { adminDb } from "../../../firebaseAdmin.ts";

const SPEC: AgentSpec = {
  name: "fleet-agent",
  domain: "fleet",
  description: "Автопарк и водители — управление ТС, водителями, сцепками",
  entities: ["vehicleFleet", "driversPool", "tractors", "trailers", "vehicleDriverData"],
  supportedActions: ["search", "addDriver", "linkCoupling", "getDriver", "getVehicle"],
  triviallyPermitted: true,
  priority: 1,
  maxConcurrency: 10,
  timeoutMs: 15000,
  requiredRights: [
    { entity: "vehicleDriverData", action: "read" },
    { entity: "vehicleDriverData", action: "write" },
  ],
};

export class FleetAgent implements Agent {
  spec = SPEC;

  getSystemPrompt(): string {
    return `Домен fleet — автопарк и водители.
Действия:
- search: поиск по автопарку или водителям. Параметры: query
- addDriver: добавить водителя. Параметры: name (ФИО), phone (телефон)
- linkCoupling: привязать сцепку. Параметры: plate (тягач), trailer (прицеп), driver (водитель)
- getDriver: информация о водителе. Параметры: name или phone
- getVehicle: информация о ТС. Параметры: plate`;
  }

  async handle(params: Record<string, any>): Promise<AgentResult> {
    const action = params.action || "general";
    switch (action) {
      case "search":
        return this.search(params.query || params.text || "");
      case "addDriver":
        return this.addDriver(params.name || "", params.phone || "");
      case "linkCoupling":
        return this.linkCoupling(params.plate || "", params.trailer || "", params.driver || "");
      case "getDriver":
        return this.getDriver(params.name || params.phone || "");
      case "getVehicle":
        return this.getVehicle(params.plate || "");
      default:
        return this.general(params.text || "");
    }
  }

  private async search(query: string): Promise<AgentResult> {
    if (!query) return { success: false, message: "Укажите поисковый запрос." };
    try {
      if (!adminDb) throw new Error("Firebase Admin недоступен");
      const results: any[] = [];

      // Поиск по автопарку
      const fleetSnap = await adminDb.ref("vehicleFleet").once("value");
      const fleet = fleetSnap.val() || {};
      Object.entries(fleet).forEach(([id, v]: [string, any]) => {
        if ((v.carNumber || "").toLowerCase().includes(query.toLowerCase()) ||
            (v.driverName || "").toLowerCase().includes(query.toLowerCase())) {
          results.push({ type: "vehicle", id, ...v });
        }
      });

      // Поиск по водителям
      const driversSnap = await adminDb.ref("driversPool").once("value");
      const drivers = driversSnap.val() || {};
      Object.entries(drivers).forEach(([id, v]: [string, any]) => {
        if ((v.name || "").toLowerCase().includes(query.toLowerCase()) ||
            (v.shortNameRu || "").toLowerCase().includes(query.toLowerCase())) {
          results.push({ type: "driver", id, ...v });
        }
      });

      return {
        success: true,
        message: `Найдено: ${results.length} записей`,
        data: results.slice(0, 10),
      };
    } catch (err) {
      return { success: false, message: `Ошибка: ${err}` };
    }
  }

  private async addDriver(name: string, phone: string): Promise<AgentResult> {
    if (!name) return { success: false, message: "Укажите ФИО водителя." };
    try {
      if (!adminDb) throw new Error("Firebase Admin недоступен");
      const ref = adminDb.ref("driversPool").push();
      const driver = {
        name,
        shortNameRu: name,
        phones: phone || "",
        phone: phone || "",
        created: Date.now(),
      };
      await ref.set(driver);
      return {
        success: true,
        message: `✅ Водитель ${name} добавлен`,
        data: { id: ref.key, ...driver },
        action: "addDriver",
        entity: "driversPool",
        entityId: ref.key!,
      };
    } catch (err) {
      return { success: false, message: `Ошибка: ${err}` };
    }
  }

  private async linkCoupling(plate: string, trailer: string, driver: string): Promise<AgentResult> {
    return { success: true, message: "Привязка сцепки будет доступна в следующей версии." };
  }

  private async getDriver(query: string): Promise<AgentResult> {
    if (!query) return { success: false, message: "Укажите имя или телефон." };
    try {
      if (!adminDb) throw new Error("Firebase Admin недоступен");
      const snap = await adminDb.ref("driversPool").once("value");
      const drivers = snap.val() || {};
      const entry = Object.entries(drivers).find(
        ([, v]: [string, any]) =>
          (v.name || "").toLowerCase().includes(query.toLowerCase()) ||
          (v.shortNameRu || "").toLowerCase().includes(query.toLowerCase()) ||
          (v.phone || "").includes(query),
      );
      if (!entry) return { success: false, message: `Водитель "${query}" не найден.` };
      const [id, data] = entry as [string, any];
      return { success: true, message: `${data.name} — ${data.phone || "тел. не указан"}`, data: { id, ...data } };
    } catch (err) {
      return { success: false, message: `Ошибка: ${err}` };
    }
  }

  private async getVehicle(plate: string): Promise<AgentResult> {
    if (!plate) return { success: false, message: "Укажите госномер." };
    try {
      if (!adminDb) throw new Error("Firebase Admin недоступен");
      const snap = await adminDb.ref("vehicleFleet").once("value");
      const fleet = snap.val() || {};
      const entry = Object.entries(fleet).find(
        ([, v]: [string, any]) => (v.carNumber || "").toLowerCase().includes(plate.toLowerCase()),
      );
      if (!entry) return { success: false, message: `ТС "${plate}" не найдено.` };
      const [id, data] = entry as [string, any];
      return { success: true, message: `${data.carNumber} — ${data.driverName || "без водителя"}`, data: { id, ...data } };
    } catch (err) {
      return { success: false, message: `Ошибка: ${err}` };
    }
  }

  private async general(text: string): Promise<AgentResult> {
    const searchMatch = text.match(/(?:найди|поиск|ищи|где)\s+(.+)/i);
    if (searchMatch) return this.search(searchMatch[1]);

    const driverMatch = text.match(/(?:добавь|создай)\s+водител[ья]?\s+(.+?)(?:\s+тел|\s+phone|\s+\d|$)/i);
    if (driverMatch) {
      const name = driverMatch[1].trim();
      const phoneMatch = text.match(/([\+\d\s\-\(\)]{7,})/);
      return this.addDriver(name, phoneMatch ? phoneMatch[1].trim() : "");
    }

    return {
      success: true,
      message: "Доступные команды: /fleet search {query}, /fleet add driver {name} {phone}, /fleet get {plate}",
    };
  }
}
/**
 * Baza Agent — Учёт выезда (контроль статусов ТС).
 */

import type { Agent, AgentResult, AgentSpec } from "./base-agent.ts";
import { adminDb } from "../../../firebaseAdmin.ts";
import { publishEvent } from "../event-bus.ts";

const SPEC: AgentSpec = {
  name: "baza-agent",
  domain: "baza",
  description: "Учёт выезда — контроль статусов ТС (на базе, загрузка, ремонт, выехал)",
  entities: ["baza", "vehicleFleet", "vehicleStatuses"],
  supportedActions: ["setStatus", "listByStatus", "getStatus", "report"],
  triviallyPermitted: true,
  priority: 1,
  maxConcurrency: 10,
  timeoutMs: 15000,
  requiredRights: [
    { entity: "baza", action: "write" },
    { entity: "baza", action: "read" },
  ],
};

export class BazaAgent implements Agent {
  spec = SPEC;

  getSystemPrompt(): string {
    return `Домен baza — учёт выезда (контроль статусов транспортных средств).
Действия:
- setStatus: изменить статус ТС. Параметры: plate (госномер), status (base/loading/repair/departure), comment
- getStatus: узнать статус ТС. Параметры: plate
- listByStatus: список ТС по статусу. Параметры: status
- report: отчёт за период. Параметры: period (week/month), status`;
  }

  async handle(params: Record<string, any>): Promise<AgentResult> {
    const action = params.action || "general";
    const plate = params.plate || params.carNumber || "";
    const status = params.status || "";
    const comment = params.comment || "";

    switch (action) {
      case "setStatus":
        return this.setStatus(plate, status, comment);
      case "getStatus":
        return this.getStatus(plate);
      case "listByStatus":
        return this.listByStatus(status);
      case "report":
        return this.report(params.period || "week");
      default:
        return this.general(params.text || "");
    }
  }

  private async setStatus(plate: string, status: string, comment: string): Promise<AgentResult> {
    if (!plate || !status) {
      return { success: false, message: "Укажите госномер (plate) и новый статус (status)." };
    }

    try {
      if (!adminDb) throw new Error("Firebase Admin недоступен");

      // Поиск ТС по госномеру
      const bazaSnap = await adminDb.ref("baza").once("value");
      const baza = bazaSnap.val() || {};
      const entry = Object.entries(baza).find(
        ([, v]: [string, any]) =>
          (v.carNumber || "").toLowerCase().includes(plate.toLowerCase()) ||
          (v.plate || "").toLowerCase().includes(plate.toLowerCase()),
      );

      if (!entry) {
        return { success: false, message: `ТС "${plate}" не найдено в учёте выезда.` };
      }

      const [id, data] = entry as [string, any];
      const now = Date.now();
      const updates: Record<string, any> = { status };

      if (status === "departure" || status === "выехал") {
        updates.dateDeparture = now;
      } else if (status === "base" || status === "на базе") {
        updates.dateArrival = now;
      } else if (status === "repair" || status === "ремонт") {
        updates.dateRepairStart = now;
      } else if (status === "loading" || status === "загрузка") {
        updates.dateLoading = now;
      }

      if (comment) updates.comment = comment;

      await adminDb.ref(`baza/${id}`).update(updates);

      // Публикация события
      await publishEvent("vehicleStatusChanged", "baza-agent", {
        plate: data.carNumber || plate,
        oldStatus: data.status,
        newStatus: status,
        timestamp: now,
      });

      return {
        success: true,
        message: `✅ ${data.carNumber || plate}: статус изменён на "${status}"`,
        data: { id, plate: data.carNumber || plate, status, ...updates },
        action: "setStatus",
        entity: "baza",
        entityId: id,
      };
    } catch (err) {
      return {
        success: false,
        message: `Ошибка: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  private async getStatus(plate: string): Promise<AgentResult> {
    if (!plate) return { success: false, message: "Укажите госномер." };
    try {
      if (!adminDb) throw new Error("Firebase Admin недоступен");
      const bazaSnap = await adminDb.ref("baza").once("value");
      const baza = bazaSnap.val() || {};
      const entry = Object.entries(baza).find(
        ([, v]: [string, any]) =>
          (v.carNumber || "").toLowerCase().includes(plate.toLowerCase()),
      );
      if (!entry) return { success: false, message: `ТС "${plate}" не найдено.` };
      const [, data] = entry;
      const statusLabels: Record<string, string> = {
        base: "🏁 На базе",
        loading: "📦 Загрузка",
        repair: "🔧 Ремонт",
        departure: "🚛 Выехал",
      };
      return {
        success: true,
        message: `${data.carNumber}: ${statusLabels[data.status] || data.status}`,
        data,
      };
    } catch (err) {
      return { success: false, message: `Ошибка: ${err}` };
    }
  }

  private async listByStatus(status: string): Promise<AgentResult> {
    try {
      if (!adminDb) throw new Error("Firebase Admin недоступен");
      const snap = await adminDb.ref("baza").once("value");
      const all = snap.val() || {};
      const filtered = Object.entries(all)
        .filter(([, v]: [string, any]) => !status || (v.status || "").toLowerCase() === status.toLowerCase())
        .map(([id, v]: [string, any]) => ({ id, ...v } as any));
      return {
        success: true,
        message: `Найдено: ${filtered.length} ТС`,
        data: filtered,
      };
    } catch (err) {
      return { success: false, message: `Ошибка: ${err}` };
    }
  }

  private async report(period: string): Promise<AgentResult> {
    return { success: true, message: `Отчёт за ${period} будет доступен в ближайшее время.` };
  }

  private async general(text: string): Promise<AgentResult> {
    const statusMatch = text.match(/(?:статус|где)\s+([А-ЯA-Z0-9-]+)/i);
    if (statusMatch) return this.getStatus(statusMatch[1]);

    const setStatusMatch = text.match(/(?:постав|отправь|вывед|поменяй)\s+([А-ЯA-Z0-9-]+)\s+(?:на\s+)?(выезд|ремонт|загрузк|баз)/i);
    if (setStatusMatch) {
      const plate = setStatusMatch[1];
      const statusRaw = setStatusMatch[2].toLowerCase();
      const statusMap: Record<string, string> = { выезд: "departure", ремонт: "repair", загрузк: "loading", баз: "base" };
      const status = statusMap[statusRaw] || statusRaw;
      return this.setStatus(plate, status, "");
    }

    return {
      success: true,
      message: "Доступные команды: /baza status {plate}, /baza out {plate}, /baza repair {plate}, /baza list",
    };
  }
}
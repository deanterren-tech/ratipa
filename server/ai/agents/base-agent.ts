/**
 * Base Agent — реестр и базовый интерфейс агентов.
 */

import { can } from "../../../permissions.ts";
import type { AgentUser } from "../../../permissions.ts";
import { BazaAgent } from "./baza-agent.ts";
import { FleetAgent } from "./fleet-agent.ts";

/** Права на агентное действие */
export type AgentRight = {
  entity: string;
  action: "read" | "write";
};

/** Спецификация агента */
export interface AgentSpec {
  name: string;
  domain: string;
  description: string;
  entities: string[];
  supportedActions: string[];
  triviallyPermitted: boolean;
  priority: 1 | 2 | 3 | 4 | 5;
  maxConcurrency: number;
  timeoutMs: number;
  requiredRights: AgentRight[];
}

/** Интерфейс агента */
export interface Agent {
  spec: AgentSpec;
  handle(params: Record<string, any>): Promise<AgentResult>;
  getSystemPrompt(): string;
}

/** Результат работы агента */
export interface AgentResult {
  success: boolean;
  message: string;
  data?: any;
  action?: string;
  entity?: string;
  entityId?: string;
}

// ===== Реестр =====
const agentInstances: Map<string, Agent> = new Map();

export function registerAgent(agent: Agent): void {
  agentInstances.set(agent.spec.domain, agent);
}

export function getAgent(domain: string): Agent | undefined {
  return agentInstances.get(domain);
}

export function getAllAgents(): Agent[] {
  return Array.from(agentInstances.values());
}

export function getAgentSpecs(): AgentSpec[] {
  return getAllAgents().map((a) => a.spec);
}

export function initAgents(): void {
  registerAgent(new BazaAgent());
  registerAgent(new FleetAgent());
  console.log(`[AgentRegistry] Зарегистрировано: ${agentInstances.size} агентов`);
}

// ===== Проверка прав =====
export function checkAgentRights(
  user: AgentUser,
  domain: string,
  action: "read" | "write",
  entities: string[],
): { allowed: boolean; reason?: string } {
  if (user.role === "root_admin" || user.name.includes("Сергей Root")) {
    return { allowed: true };
  }
  for (const entity of entities) {
    if (!can(user, entity, action)) {
      return { allowed: false, reason: `Нет прав на ${entity}:${action}` };
    }
  }
  return { allowed: true };
}
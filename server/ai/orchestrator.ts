/**
 * Orchestrator — центральный диспетчер агентов.
 * 1. Intent Router (NLU) → domain + action + params
 * 2. Safety Gate → проверка прав
 * 3. Agent Dispatcher → запуск агента
 */

import openRouterChat, { type ChatMessage, auditAIRequest } from "./openrouter.ts";
import { getAgent, checkAgentRights, initAgents, getAllAgents } from "./agents/base-agent.ts";
import type { AgentUser } from "../../permissions.ts";

interface IntentResult {
  domain: string;
  action: string;
  params: Record<string, any>;
  confidence: number;
  rawInput: string;
}

interface OrchestratorResponse {
  success: boolean;
  message: string;
  data?: any;
  confidence?: number;
  agent?: string;
}

// Инициализация при импорте
let initialized = false;
function ensureInit() {
  if (!initialized) {
    initAgents();
    initialized = true;
  }
}

/**
 * Системный промпт для Intent Router.
 * Генерируется динамически на основе зарегистрированных агентов.
 */
function buildSystemPrompt(): string {
  const agents = getAllAgents();
  const domains = agents
    .map(
      (a) =>
        `- **${a.spec.domain}**: ${a.spec.description}. Действия: ${a.spec.supportedActions.join(", ")}`,
    )
    .join("\n");

  return `Ты — Intent Router системы RATIPA (логистический портал).
Пользователь пишет запрос на русском. Твоя задача — определить:

- domain: ${agents.map((a) => a.spec.domain).join(" | ")}
- action: конкретное действие в этом domain
- params: извлечённые параметры (plate, dates, суммы, имена)
- confidence: уверенность (0.0 — 1.0)

Доступные домены:
${domains}

Правила:
- Если запрос не относится ни к одному домену → domain: "chat", action: "general"
- Всегда возвращай ТОЛЬКО JSON: { domain, action, params, confidence }
- plate = госномер (латиница + цифры)
- При неопределённости ставь confidence < 0.7
- Если запрос содержит команду на английском (/baza, /fleet и т.д.) — всё равно маршрутизируй в соответствующий домен`;
}

/**
 * Определить намерение пользователя через OpenRouter.
 */
async function routeIntent(input: string, user: AgentUser): Promise<IntentResult> {
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: input },
  ];

  try {
    const result = await openRouterChat(messages, {
      response_format: "json_object",
      temperature: 0.1,
    });

    await auditAIRequest("intent-router", messages, result);

    const parsed = JSON.parse(result.content);
    return {
      domain: parsed.domain || "chat",
      action: parsed.action || "general",
      params: parsed.params || {},
      confidence: parsed.confidence || 0,
      rawInput: input,
    };
  } catch (err) {
    console.error("[Orchestrator] Intent Router error:", err);
    // Fallback: если AI недоступен, пытаемся определить по ключевым словам
    return fallbackRoute(input);
  }
}

/**
 * Fallback-маршрутизация без AI.
 */
function fallbackRoute(input: string): IntentResult {
  const lower = input.toLowerCase();

  // Проверка на /команды
  const cmdMatch = input.match(/^\/(\w+)/);
  if (cmdMatch) {
    const cmd = cmdMatch[1];
    return {
      domain: cmd,
      action: "general",
      params: { text: input, raw: true },
      confidence: 0.9,
      rawInput: input,
    };
  }

  // Ключевые слова
  if (lower.includes("выезд") || lower.includes("баз") || lower.includes("статус") || lower.includes("ремонт")) {
    return { domain: "baza", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }
  if (lower.includes("водител") || lower.includes("авто") || lower.includes("сцепк") || lower.includes("прицеп") || lower.includes("парк")) {
    return { domain: "fleet", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }
  if (lower.includes("рейс") || lower.includes("план") || lower.includes("маршрут")) {
    return { domain: "trip", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }
  if (lower.includes("/permits") || lower.includes("дозвол") || lower.includes("разрешен") || lower.includes("бланк") || lower.includes("квитанц")) {
    return { domain: "permit", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }
  if (lower.includes("зарплат") || lower.includes("доход") || lower.includes("калькуляц") || lower.includes("прибыл")) {
    return { domain: "finance", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }
  if (lower.includes("архив")) {
    return { domain: "archive", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }
  if (lower.includes("аналитик") || lower.includes("отчёт") || lower.includes("дайджест") || lower.includes("статистик")) {
    return { domain: "analytics", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }
  if (lower.includes("документ") || lower.includes("печат") || lower.includes("тир") || lower.includes("карнет")) {
    return { domain: "document", action: "general", params: { text: input }, confidence: 0.6, rawInput: input };
  }

  return { domain: "chat", action: "general", params: { text: input }, confidence: 0.2, rawInput: input };
}

/**
 * Основная точка входа — обработать запрос пользователя.
 */
export async function handleUserRequest(
  input: string,
  user: AgentUser,
): Promise<OrchestratorResponse> {
  ensureInit();

  // 1. Определить намерение
  const intent = await routeIntent(input, user);
  console.log(`[Orchestrator] Intent: ${intent.domain}.${intent.action} (conf=${intent.confidence})`);

  // 2. Если уверенность низкая — сообщить пользователю
  if (intent.confidence < 0.4 && intent.domain === "chat") {
    return {
      success: true,
      message: "Я не совсем понял запрос. Попробуйте написать чётче: «Выведи AC 9271-7 с базы», «Создай рейс», «Покажи дозволы». Или начните с /help",
      confidence: intent.confidence,
    };
  }

  // 3. Safety Gate — проверка прав
  const agent = getAgent(intent.domain);
  if (agent) {
    const rights = checkAgentRights(user, agent.spec.domain, "write", agent.spec.entities);
    if (!rights.allowed) {
      return {
        success: false,
        message: `⛔ ${rights.reason || "Нет доступа"}`,
        data: { domain: intent.domain, action: intent.action },
      };
    }
  }

  // 4. Исполнить через агента
  if (agent) {
    try {
      const result = await agent.handle(intent.params);
      return {
        success: result.success,
        message: result.message,
        data: result.data,
        agent: agent.spec.name,
        confidence: intent.confidence,
      };
    } catch (err) {
      console.error(`[Orchestrator] Agent ${agent.spec.name} error:`, err);
      return {
        success: false,
        message: `Ошибка агента ${agent.spec.name}: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // 5. Если агента нет — просто ответить
  return {
    success: true,
    message: `Запрос принят (domain: ${intent.domain}, action: ${intent.action}). Обработка будет добавлена в следующей версии.`,
    data: intent,
    confidence: intent.confidence,
  };
}

/** Express-маршрут для REST-вызова Orchestrator */
export function orchestratorRouter(agentUser: AgentUser, body: any): Promise<OrchestratorResponse> {
  const input = body?.message || body?.text || "";
  if (!input.trim()) {
    return Promise.resolve({ success: false, message: "Пустой запрос" });
  }
  return handleUserRequest(input, agentUser);
}

export default { handleUserRequest, orchestratorRouter };
/**
 * OpenRouter AI Client — единый клиент для всех AI-запросов.
 * Используется вместо прямых вызовов Gemini.
 * Поддерживает retry, fallback-модели, кэширование, аудит.
 */

import { adminDb } from "../../firebaseAdmin.ts";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_MODEL = "deepseek/deepseek-v4-flash";
const FALLBACK_MODEL = "google/gemini-2.0-flash-001";
const MAX_RETRIES = 3;
const TIMEOUT_MS = 30000;

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export interface AIResponse {
  content: string;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model: string;
}

interface OpenRouterOptions {
  model?: string;
  response_format?: "json_object" | "text";
  temperature?: number;
  max_tokens?: number;
}

// LRU-кэш для Intent Router (TTL 5 мин)
const cache = new Map<string, { result: AIResponse; expiresAt: number }>();
const CACHE_MAX = 50;
const CACHE_TTL = 5 * 60 * 1000;

function getCacheKey(messages: ChatMessage[], options: OpenRouterOptions): string {
  return JSON.stringify({ messages, options });
}

function getApiKey(): string {
  return process.env.OPENROUTER_API_KEY || "";
}

async function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function attemptChat(
  messages: ChatMessage[],
  options: OpenRouterOptions,
  model: string,
): Promise<AIResponse> {
  const key = getApiKey();
  if (!key) throw new Error("OPENROUTER_API_KEY не задан");

  const body: Record<string, any> = {
    model,
    messages,
    temperature: options.temperature ?? 0.1,
    max_tokens: options.max_tokens ?? 1000,
  };
  if (options.response_format === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const res = await fetchWithTimeout(
    OPENROUTER_API,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://ratipa.app",
        "X-Title": "RATIPA Agent System",
      },
      body: JSON.stringify(body),
    },
    TIMEOUT_MS,
  );

  if (res.status === 401 || res.status === 403) {
    throw new Error(`OpenRouter auth error: ${res.status}`);
  }
  if (res.status === 429) {
    throw new Error("OpenRouter rate limited");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenRouter ${res.status}: ${text}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content || "";
  const usage = data.usage || {};
  return { content, usage, model: data.model || model };
}

export async function openRouterChat(
  messages: ChatMessage[],
  options: OpenRouterOptions = {},
): Promise<AIResponse> {
  const model = options.model || DEFAULT_MODEL;
  const cacheKey = options.response_format === "json_object" ? "" : getCacheKey(messages, options);

  // Проверка кэша
  if (cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.result;
    }
  }

  let lastError: Error | null = null;

  // Попытки с основной моделью
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await attemptChat(messages, options, model);

      // Кэширование
      if (cacheKey && result.content) {
        if (cache.size >= CACHE_MAX) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
        cache.set(cacheKey, { result, expiresAt: Date.now() + CACHE_TTL });
      }

      return result;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[OpenRouter] Attempt ${attempt}/${MAX_RETRIES} (${model}): ${lastError.message}`);
      if (attempt < MAX_RETRIES) {
        // Экспоненциальная задержка: 1s, 2s, 4s
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)));
      }
    }
  }

  // Fallback на резервную модель
  if (model !== FALLBACK_MODEL) {
    console.warn(`[OpenRouter] Switching to fallback model: ${FALLBACK_MODEL}`);
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await attemptChat(messages, { ...options, model: FALLBACK_MODEL }, FALLBACK_MODEL);
      } catch (err) {
        console.warn(`[OpenRouter] Fallback attempt ${attempt} failed:`, err);
        if (attempt < 2) await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  throw lastError || new Error("OpenRouter: все попытки исчерпаны");
}

/** Аудит AI-запроса в agent_logs */
export async function auditAIRequest(
  requestType: string,
  messages: ChatMessage[],
  result: AIResponse | null,
  error?: string,
): Promise<void> {
  if (!adminDb) return;
  try {
    await adminDb.ref("agent_logs/ai_requests").push({
      type: requestType,
      model: result?.model || "unknown",
      promptTokens: result?.usage?.prompt_tokens,
      completionTokens: result?.usage?.completion_tokens,
      error: error || null,
      timestamp: Date.now(),
      // Не храним полные messages в production — только для отладки
    });
  } catch {
    // silent
  }
}

export default openRouterChat;
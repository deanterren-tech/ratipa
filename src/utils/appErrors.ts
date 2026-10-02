/**
 * Единый слой ошибок портала.
 *
 * Задача: одна и та же ошибка не должна оставаться только в консоли браузера.
 * Событие проходит три пути:
 *   1) пользователю — понятное уведомление (toast) с тем, что именно не сохранилось;
 *   2) в базу — запись в appErrors для дашборда «Ошибки» в администрировании;
 *   3) наружу (для критических) — уведомление дежурному через /api/report-error.
 *
 * Здесь нет импортов firebase: иначе получился бы цикл (firebase.ts импортирует этот
 * модуль). Доставку в базу подключает configureErrorReporting() — из firebase.ts.
 */

export type AppErrorSeverity = 'critical' | 'error' | 'warning';

export interface AppErrorInput {
  /** Модуль или операция: 'firebase', 'baza', 'payroll', 'render'… */
  scope: string;
  /** Техническое описание для журнала. */
  message: string;
  severity?: AppErrorSeverity;
  /** Технические подробности (обрезаются, секреты вырезаются). */
  detail?: string;
  /** Узел базы, операция над которым сорвалась, если применимо. */
  path?: string;
  /** Что показать пользователю. Если не задано — уведомление не показывается. */
  userMessage?: string;
}

export interface AppErrorRecord extends Omit<AppErrorInput, 'userMessage'> {
  ts: number;
  /** Показывать ли уведомление при этом событии (для тостов). */
  notify?: string;
  uid?: string;
  role?: string;
  url?: string;
  build?: string;
}

type Listener = (record: AppErrorRecord) => void;
type Sink = (record: AppErrorRecord) => void;

const listeners = new Set<Listener>();
let sink: Sink | null = null;

/* ——— Дедупликация: одинаковая ошибка не спамит пользователя и журнал ——— */
const DEDUPE_MS = 60_000;
const seen = new Map<string, number>();

/* ——— Бюджет записей в базу: не больше 20 в минуту с клиента ——— */
const MAX_PER_MINUTE = 20;
let windowStart = 0;
let windowCount = 0;
function takeBudget(): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) { windowStart = now; windowCount = 0; }
  if (windowCount >= MAX_PER_MINUTE) return false;
  windowCount++;
  return true;
}

/** Убираем из технического описания всё, что похоже на секрет, и обрезаем длину. */
export function scrubDetail(text: string): string {
  return String(text || '')
    .replace(/([?&](key|token|apikey|api_key|auth|password)=)[^&\s]+/gi, '$1[СКРЫТО]')
    .replace(/\bAIza[0-9A-Za-z_\-]{20,}\b/g, '[КЛЮЧ СКРЫТ]')
    .replace(/\beyJ[0-9A-Za-z_\-.]{20,}\b/g, '[ТОКЕН СКРЫТ]')
    .replace(/\s+/g, ' ')
    .slice(0, 300);
}

function context(): { uid?: string; role?: string } {
  try {
    const raw = localStorage.getItem('ratipa_user_session') || localStorage.getItem('ratipa_auth_user');
    if (!raw) return {};
    const u = JSON.parse(raw);
    return { uid: typeof u?.uid === 'string' ? u.uid : undefined, role: typeof u?.role === 'string' ? u.role : undefined };
  } catch { return {}; }
}

function shortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

/** Подписка на события ошибок (используется тостами). */
export function onAppError(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Доставка в базу и наружу. Настраивается один раз при старте приложения. */
export function configureErrorReporting(next: Sink): void {
  sink = next;
}

/**
 * Зафиксировать ошибку. Возвращает запись, если событие прошло дедупликацию
 * (иначе null — такое уже сообщалось меньше минуты назад).
 */
export function reportAppError(input: AppErrorInput): AppErrorRecord | null {
  const message = String(input.message || 'Неизвестная ошибка');
  const key = `${input.scope}|${message.slice(0, 120)}`;
  const now = Date.now();
  const last = seen.get(key);
  if (last && now - last < DEDUPE_MS) return null;
  seen.set(key, now);
  if (seen.size > 200) {
    for (const [k, ts] of seen) if (now - ts > DEDUPE_MS) seen.delete(k);
  }

  if (import.meta.env.DEV) console.warn(`[${input.scope}]`, message, input.detail || '');

  const record: AppErrorRecord = {
    ts: now,
    scope: input.scope,
    message,
    severity: input.severity || 'error',
    detail: input.detail ? scrubDetail(input.detail) : undefined,
    path: input.path,
    notify: input.userMessage,
    ...context(),
    url: typeof location !== 'undefined' ? location.origin + location.hash : undefined,
    build: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : undefined,
  };

  listeners.forEach((fn) => { try { fn(record); } catch { /* слушатель не должен ломать поток */ } });

  if (sink && takeBudget()) {
    try { sink(record); } catch { /* доставка не критична для работы интерфейса */ }
  }
  return record;
}

/**
 * Обёртка для catch-блоков: показывает пользователю понятный текст и заводит запись.
 * `userMessage` — что увидит человек; `silent` — только журнал (диагностические случаи).
 */
export function handleFailure(
  scope: string,
  error: unknown,
  opts: { path?: string; userMessage?: string; severity?: AppErrorSeverity; silent?: boolean } = {},
): void {
  const err = error as { message?: string; code?: string; name?: string } | null;
  const raw = err?.message || (typeof error === 'string' ? error : String(error));
  reportAppError({
    scope,
    message: raw,
    detail: [err?.name, err?.code].filter(Boolean).join(' ') || undefined,
    path: opts.path,
    severity: opts.severity || 'error',
    userMessage: opts.silent ? undefined : (opts.userMessage || undefined),
  });
}

export const ID_KEY = () => `${Date.now()}_${shortId()}`;

/** Глобальные перехватчики: падения вне React и сбои загрузки кода после обновления. */
export function installGlobalErrorHandlers(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('error', (event) => {
    const target = event.target as HTMLElement | null;
    // Ошибка загрузки ресурса (чаще всего — устаревший файл после деплоя)
    if (target && (target.tagName === 'SCRIPT' || target.tagName === 'LINK')) {
      reportAppError({
        scope: 'assets',
        severity: 'critical',
        message: `Не загрузился файл приложения: ${(target as HTMLScriptElement).src || (target as HTMLLinkElement).href || ''}`,
        userMessage: 'Не удалось загрузить часть приложения. Обновите страницу — выйдет свежая версия.',
      });
      return;
    }
    reportAppError({
      scope: 'window',
      severity: 'critical',
      message: event.message || 'Ошибка скрипта',
      detail: `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`,
    });
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as { message?: string } | string | undefined;
    reportAppError({
      scope: 'promise',
      severity: 'critical',
      message: typeof reason === 'string' ? reason : (reason?.message || 'Необработанный отказ промиса'),
    });
  });
}

declare const __APP_VERSION__: string;

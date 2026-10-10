/**
 * Серверный клиент Nav.by: Bearer-токен (get-token либо NAVBY_TOKEN),
 * таймауты, ограниченные ретраи (401/403/429/5xx/таймаут), учёт лимита
 * 100 req/min с запасом.
 *
 * Безопасность:
 *  - клиент используется ТОЛЬКО на сервере; токен никогда не покидает процесс;
 *  - в лог попадают только путь, статус и вид ошибки — не токен и не тело;
 *  - при 401 один раз выполняется переполучение токена (если есть логин/пароль).
 *
 * Тестируемость: fetch/sleep/now инжектируются (scripts/test-navby.ts).
 */

import {
  NAVBY_DEFAULT_BASE,
  NAVBY_PATHS,
  NAVBY_HTTP_TIMEOUT_MS,
  NAVBY_RETRY,
  NAVBY_SELF_RATE_PER_MIN,
  navbyDateTimeString,
} from './config.ts';
import type { NormalizedNavbyObject, TelemetrySample } from './parse.ts';
import { normalizeNavbyObject, normalizePosition } from './parse.ts';
import { normalizeParkingItems, type ParkingReport } from './parking.ts';

export type NavbyErrorKind =
  | 'not_configured'
  | 'auth'
  | 'forbidden'
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'bad_response';

export interface NavbyError {
  kind: NavbyErrorKind;
  status?: number;
  detail?: string;
}

export interface NavbyResult<T> {
  ok: boolean;
  status: number;
  data?: T;
  error?: NavbyError;
  /** Сколько HTTP-попыток реально сделано (для наблюдаемости). */
  attempts?: number;
}

export interface NavbyClientOptions {
  base?: string;
  login?: string;
  password?: string;
  staticToken?: string;
  /** Инжекция для тестов. */
  fetchImpl?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (line: string) => void;
  ratePerMin?: number;
  timeoutMs?: number;
}

interface TokenState {
  token: string | null;
  source: 'env' | 'login' | null;
  fetchedAtMs: number | null;
}

export class NavbyClient {
  private base: string;
  private login: string;
  private password: string;
  private fetchImpl: typeof fetch;
  private now: () => number;
  private sleep: (ms: number) => Promise<void>;
  private log: (line: string) => void;
  private ratePerMin: number;
  private timeoutMs: number;
  private token: TokenState;
  /** Отметки времени запросов для скользящего окна лимита. */
  private callTimes: number[] = [];

  constructor(opts: NavbyClientOptions = {}) {
    this.base = (opts.base || NAVBY_DEFAULT_BASE).replace(/\/+$/, '');
    this.login = (opts.login || '').trim();
    this.password = opts.password || '';
    this.fetchImpl = opts.fetchImpl || fetch;
    this.now = opts.now || (() => Date.now());
    this.sleep = opts.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.log = opts.log || (() => {});
    this.ratePerMin = Math.max(1, opts.ratePerMin || NAVBY_SELF_RATE_PER_MIN);
    this.timeoutMs = opts.timeoutMs || NAVBY_HTTP_TIMEOUT_MS;
    this.token = {
      token: opts.staticToken && opts.staticToken.trim() ? opts.staticToken.trim() : null,
      source: opts.staticToken && opts.staticToken.trim() ? 'env' : null,
      fetchedAtMs: null,
    };
  }

  hasCredentials(): boolean {
    return Boolean(this.token.token || (this.login && this.password));
  }

  tokenSource(): 'env' | 'login' | null {
    return this.token.source;
  }

  /** Пауза, если скользящее окно запросов подошло к нашему лимиту. */
  private async respectRateLimit(): Promise<void> {
    const nowMs = this.now();
    this.callTimes = this.callTimes.filter((t) => nowMs - t < 60_000);
    if (this.callTimes.length >= this.ratePerMin) {
      const oldest = this.callTimes[0];
      const waitMs = Math.max(250, 60_000 - (nowMs - oldest) + 100);
      this.log(`[navby] rate limit: ожидание ${Math.round(waitMs / 1000)} с`);
      await this.sleep(waitMs);
      const after = this.now();
      this.callTimes = this.callTimes.filter((t) => after - t < 60_000);
    }
    this.callTimes.push(this.now());
  }

  /** Один HTTP GET с таймаутом. Не логирует тело. */
  private async httpGet(path: string, params: Record<string, string>, token: string | null): Promise<{ status: number; text: string } | NavbyError> {
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url.toString(), {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
      const text = await res.text();
      this.log(`[navby] GET ${path} → ${res.status}`);
      return { status: res.status, text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isTimeout = /abort/i.test(msg);
      this.log(`[navby] GET ${path} → ${isTimeout ? 'timeout' : 'network error'}`);
      return { kind: isTimeout ? 'timeout' : 'network', detail: msg.slice(0, 200) };
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchToken(withTokenRetry = false): Promise<boolean> {
    if (!this.login || !this.password) {
      if (!this.token.token) {
        this.log('[navby] нет креденшелов: задайте NAVBY_TOKEN или NAVBY_LOGIN/NAVBY_PASSWORD');
        return false;
      }
      return true;
    }
    await this.respectRateLimit();
    const res = await this.httpGet(NAVBY_PATHS.token, { login: this.login, password: this.password }, null);
    if ('kind' in res) {
      this.log(`[navby] get-token недоступен: ${res.kind}`);
      return false;
    }
    if (res.status !== 200) {
      this.log(`[navby] get-token → ${res.status}`);
      return false;
    }
    try {
      const data = JSON.parse(res.text);
      if (data && data.status === 'OK' && typeof data.token === 'string' && data.token) {
        this.token = { token: data.token, source: 'login', fetchedAtMs: this.now() };
        if (withTokenRetry) this.log('[navby] токен переполучен');
        return true;
      }
      this.log(`[navby] get-token: неожиданный формат ответа (status=${String(data?.status)})`);
      return false;
    } catch {
      this.log('[navby] get-token: ответ не JSON');
      return false;
    }
  }

  /**
   * GET c политикой ретраев:
   *  - 401 → одно переполучение токена и один повтор;
   *  - 403 → сразу ошибка прав (повторять бессмысленно);
   *  - 429 → уважаем Retry-After (или backoff), не более NAVBY_RETRY.attempts попыток;
   *  - 5xx / таймаут / сеть → backoff, не более NAVBY_RETRY.attempts попыток.
   */
  private async request<T>(path: string, params: Record<string, string>, parse: (items: unknown[]) => T): Promise<NavbyResult<T>> {
    if (!this.token.token) {
      const got = await this.fetchToken();
      if (!got) return { ok: false, status: 0, error: { kind: 'not_configured' } };
    }
    let attempts = 0;
    let reauthed = false;
    let lastError: NavbyError = { kind: 'network' };

    for (let i = 0; i < NAVBY_RETRY.attempts; i++) {
      attempts++;
      await this.respectRateLimit();
      const res = await this.httpGet(path, params, this.token.token);
      if ('kind' in res) {
        lastError = res;
        if (i < NAVBY_RETRY.attempts - 1) {
          const delay = Math.min(NAVBY_RETRY.maxDelayMs, NAVBY_RETRY.baseDelayMs * 2 ** i);
          await this.sleep(delay);
          continue;
        }
        return { ok: false, status: 0, error: lastError, attempts };
      }
      if (res.status === 200) {
        try {
          const data = JSON.parse(res.text);
          const items = data?.root?.result?.items;
          if (!Array.isArray(items)) {
            return { ok: false, status: res.status, error: { kind: 'bad_response', detail: 'нет root.result.items' }, attempts };
          }
          return { ok: true, status: res.status, data: parse(items), attempts };
        } catch {
          return { ok: false, status: res.status, error: { kind: 'bad_response', detail: 'ответ не JSON' }, attempts };
        }
      }
      if (res.status === 401) {
        lastError = { kind: 'auth', status: 401 };
        if (!reauthed && this.login && this.password) {
          reauthed = true;
          this.token = { token: null, source: null, fetchedAtMs: null };
          const got = await this.fetchToken(true);
          if (!got) return { ok: false, status: 401, error: { kind: 'auth', status: 401 }, attempts };
          continue; // повтор с новым токеном, не тратя retry-итерацию впустую
        }
        return { ok: false, status: 401, error: lastError, attempts };
      }
      if (res.status === 403) {
        return { ok: false, status: 403, error: { kind: 'forbidden', status: 403 }, attempts };
      }
      if (res.status === 429) {
        lastError = { kind: 'rate_limit', status: 429 };
        if (i < NAVBY_RETRY.attempts - 1) {
          await this.sleep(Math.min(NAVBY_RETRY.maxDelayMs, NAVBY_RETRY.baseDelayMs * 2 ** (i + 1)));
          continue;
        }
        return { ok: false, status: 429, error: lastError, attempts };
      }
      if (res.status >= 500 || res.status === 408) {
        lastError = { kind: 'server', status: res.status };
        if (i < NAVBY_RETRY.attempts - 1) {
          await this.sleep(Math.min(NAVBY_RETRY.maxDelayMs, NAVBY_RETRY.baseDelayMs * 2 ** i));
          continue;
        }
        return { ok: false, status: res.status, error: lastError, attempts };
      }
      return { ok: false, status: res.status, error: { kind: 'bad_response', status: res.status }, attempts };
    }
    return { ok: false, status: 0, error: lastError, attempts };
  }

  /** Список объектов мониторинга (один запрос, без параметров — подтверждено). */
  async getVehicleList(): Promise<NavbyResult<NormalizedNavbyObject[]>> {
    return this.request(NAVBY_PATHS.vehicleList, {}, (items) =>
      items
        .map((raw) => normalizeNavbyObject((raw || {}) as Record<string, unknown>))
        .filter((x): x is NormalizedNavbyObject => x != null),
    );
  }

  /**
   * Текущие позиции всех объектов одним запросом (подтверждено: 65 объектов
   * в одном ответе). Отдельно возвращаются записи, которые не удалось
   * разобрать (объекты без координат API не отдаёт вовсе).
   */
  async getCurrentPositions(opts?: { extraParams?: Record<string, string> }): Promise<NavbyResult<{ samples: TelemetrySample[]; skipped: number }>> {
    const params: Record<string, string> = {
      get_odometer: 'true',
      get_address: 'true',
      ...(opts?.extraParams || {}),
    };
    let skippedCount = 0;
    return this.request(NAVBY_PATHS.currentPosition, params, (items) => {
      const samples: TelemetrySample[] = [];
      for (const raw of items) {
        const s = normalizePosition((raw || {}) as Record<string, unknown>);
        if (s) samples.push(s);
        else skippedCount++;
      }
      return { samples, skipped: skippedCount };
    });
  }

  /**
   * Отчёт «Стоянка-движение» по одному IMEI (подтверждено живым вызовом
   * 10.10.2026: интервалы стоянка/движение с одометром на границах). Дата-время —
   * строки «YYYY-MM-DD HH:MM:SS» в поясе API (+03). Метод для одного объекта
   * за вызов: вызывается по требованию (открытие анализа рейса), а не поллером.
   */
  async getParkingReport(imei: string, fromMs: number, toMs: number): Promise<NavbyResult<ParkingReport>> {
    const params: Record<string, string> = {
      imei: String(imei),
      date_from: navbyDateTimeString(fromMs),
      date_to: navbyDateTimeString(toMs),
    };
    return this.request(NAVBY_PATHS.parkingReport, params, (items) => normalizeParkingItems(items));
  }
}

/** Клиент из окружения процесса (серверная сторона). */
export function navbyClientFromEnv(env: NodeJS.ProcessEnv = process.env, overrides?: Partial<NavbyClientOptions>): NavbyClient {
  return new NavbyClient({
    base: env.NAVBY_BASE || NAVBY_DEFAULT_BASE,
    login: env.NAVBY_LOGIN,
    password: env.NAVBY_PASSWORD,
    staticToken: env.NAVBY_TOKEN,
    ...overrides,
  });
}

/**
 * Готовность данных модуля.
 *
 * Задача: пока раздел ждёт первый ответ базы, в рабочей области показывается
 * брендовый индикатор, а не пустая таблица. Все подписки портала идут через
 * `onValue`/`onceValue` (firebase.ts), поэтому готовность отслеживается в одном
 * месте и не требует правок в каждом модуле.
 *
 * Модель:
 *  - при входе в раздел открывается «окно первой загрузки»;
 *  - каждая подписка, созданная в этом окне, регистрируется и должна сообщить
 *    первый ответ (данные или ошибку);
 *  - окно закрывается, когда ответили все подписки, созданные при входе;
 *  - если подписок не появилось вовсе (страница без данных) — окно закрывается
 *    по короткой паузе;
 *  - состояние хранится по ключу модуля и НЕ сбрасывается при переключении
 *    разделов: повторный вход в уже загруженный модуль индикатор не показывает;
 *  - подписки, созданные после закрытия окна (фильтры, вкладки, модалки),
 *    состояние загрузки не меняют — они лишь отмечают фоновое обновление.
 */

export type ModulePhase = 'loading' | 'ready' | 'error';

export type ModuleLoadState = {
  phase: ModulePhase;
  /** Понятный пользователю текст без технических деталей. */
  message: string;
  /** Идёт фоновое обновление — контент остаётся видимым. */
  refreshing: boolean;
};

type InternalState = ModuleLoadState & {
  /** Подписки, ожидающие первого ответа в текущем окне. */
  pending: Set<number>;
  /** Окно первой загрузки открыто. */
  windowOpen: boolean;
  /** В окне появилась хотя бы одна подписка. */
  everRegistered: boolean;
  /** Пришёл хотя бы один ответ базы — раздел рабочий, ждать остальные вечно нельзя. */
  answeredAny: boolean;
  silenceTimer: number | null;
  graceTimer: number | null;
  timeoutTimer: number | null;
  refreshTimer: number | null;
  /** Счётчик попыток: смена значения пересоздаёт модуль (кнопка «Повторить»). */
  attempt: number;
};

/**
 * Сколько ждать ВСЕ подписки, созданные при входе.
 * Если часть данных уже пришла, а какая-то подписка молчит (например, тяжёлый
 * узел базы грузится долго), раздел открывается по этому сроку: показываем
 * полученные данные, остальное подтянется обновлением. Ошибка при этом не
 * показывается — раздел работает.
 */
const LOAD_GRACE_MS = 7000;
/** Если не ответила НИ ОДНА подписка — это отказ: показываем ошибку и «Повторить». */
const LOAD_TIMEOUT_MS = 15000;
/** Пауза, за которую страница без подписок успевает заявить о себе. */
const SILENCE_MS = 220;
/** Как долго держится отметка о фоновом обновлении. */
const REFRESH_BADGE_MS = 1400;

const OFFLINE_MESSAGE = 'Нет подключения к интернету. Проверьте сеть и повторите попытку.';
const GENERIC_ERROR_MESSAGE = 'Не удалось получить данные раздела. Повторите попытку.';

const states = new Map<string, InternalState>();
const tokenOwner = new Map<number, string>();
const listeners = new Set<() => void>();

let nextToken = 1;
/** Модуль, которому принадлежат подписки, создаваемые прямо сейчас. */
let windowKey: string | null = null;

const now = () => Date.now();

function clearDebug(token: number) {
  if (!import.meta.env?.DEV) return;
  try {
    const pending: Map<number, string> | undefined = (window as any).__ratipaModuleReads;
    if (pending) pending.delete(token);
  } catch { /* диагностика не должна мешать */ }
}

function notify() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      /* подписчик не должен ломать реестр */
    }
  });
}

function clearTimers(state: InternalState) {
  if (state.silenceTimer !== null) { window.clearTimeout(state.silenceTimer); state.silenceTimer = null; }
  if (state.graceTimer !== null) { window.clearTimeout(state.graceTimer); state.graceTimer = null; }
  if (state.timeoutTimer !== null) { window.clearTimeout(state.timeoutTimer); state.timeoutTimer = null; }
  if (state.refreshTimer !== null) { window.clearTimeout(state.refreshTimer); state.refreshTimer = null; }
}

function createState(): InternalState {
  return {
    phase: 'loading',
    message: 'Загрузка раздела',
    refreshing: false,
    pending: new Set(),
    windowOpen: false,
    everRegistered: false,
    answeredAny: false,
    silenceTimer: null,
    graceTimer: null,
    timeoutTimer: null,
    refreshTimer: null,
    attempt: 0,
  };
}

function stateOf(key: string): InternalState {
  let state = states.get(key);
  if (!state) {
    state = createState();
    states.set(key, state);
  }
  return state;
}

/** Снимок для React: без внутренних полей. */
export function getModuleLoadState(key: string): ModuleLoadState {
  const state = stateOf(key);
  return { phase: state.phase, message: state.message, refreshing: state.refreshing };
}

/** Счётчик попыток: используется как часть key, чтобы пересоздать модуль при повторе. */
export function getModuleAttempt(key: string): number {
  return stateOf(key).attempt;
}

export function subscribeModuleLoad(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function closeWindow(state: InternalState) {
  state.windowOpen = false;
  state.pending.clear();
  if (state.silenceTimer !== null) { window.clearTimeout(state.silenceTimer); state.silenceTimer = null; }
  if (state.graceTimer !== null) { window.clearTimeout(state.graceTimer); state.graceTimer = null; }
  if (state.timeoutTimer !== null) { window.clearTimeout(state.timeoutTimer); state.timeoutTimer = null; }
}

function settle(key: string, state: InternalState) {
  closeWindow(state);
  state.phase = 'ready';
  state.message = 'Загрузка раздела';
  notify();
}

function fail(state: InternalState, message: string, technical?: unknown) {
  // Подробности — только в консоль, в интерфейс уходит понятный текст
  if (technical) console.error('[module-load]', technical);
  closeWindow(state);
  state.phase = 'error';
  state.message = message;
  notify();
}

/**
 * Вход в раздел: открывает окно первой загрузки, если данные ещё не получены.
 * Для уже загруженного раздела ничего не происходит — индикатор не показывается.
 */
export function beginModuleLoad(key: string) {
  const state = stateOf(key);
  if (state.windowOpen) return;
  // Данные уже есть — повторный вход не должен показывать индикатор
  if (state.phase === 'ready') return;

  state.phase = 'loading';
  state.windowOpen = true;
  state.everRegistered = false;
  state.answeredAny = false;
  state.pending.clear();
  windowKey = key;

  // Страница без обязательных данных не должна ждать таймаут
  state.silenceTimer = window.setTimeout(() => {
    state.silenceTimer = null;
    if (state.windowOpen && !state.everRegistered) settle(key, state);
  }, SILENCE_MS);

  // Часть данных пришла, но какая-то подписка молчит — открываем раздел,
  // чтобы рабочий модуль не держался за индикатором. Остальное догрузится.
  state.graceTimer = window.setTimeout(() => {
    state.graceTimer = null;
    if (!state.windowOpen || state.pending.size === 0) return;
    if (!state.answeredAny) return;
    console.warn('[module-load] раздел открыт по времени, без ответа остались подписки:', state.pending.size, key);
    settle(key, state);
  }, LOAD_GRACE_MS);

  // Ни одного ответа за отведённое время — это отказ, а не медленная загрузка.
  state.timeoutTimer = window.setTimeout(() => {
    state.timeoutTimer = null;
    if (!state.windowOpen) return;
    if (state.answeredAny) {
      settle(key, state);
      return;
    }
    fail(
      state,
      typeof navigator !== 'undefined' && navigator.onLine === false ? OFFLINE_MESSAGE : GENERIC_ERROR_MESSAGE,
      new Error('module data timeout: ' + key),
    );
  }, LOAD_TIMEOUT_MS);
}

/**
 * Подписка на данные: регистрируется, только если открыто окно первой загрузки.
 * Возвращает идентификатор для markRead/releaseRead (0 — отслеживание не нужно).
 */
export function registerRead(): number {
  if (!windowKey) return 0;
  const state = states.get(windowKey);
  if (!state || !state.windowOpen) return 0;
  const token = nextToken++;
  tokenOwner.set(token, windowKey);
  state.pending.add(token);
  state.everRegistered = true;
  // Диагностика в режиме разработки: какая подписка не ответила (стек вызова)
  if (import.meta.env?.DEV) {
    try {
      const pending: Map<number, string> = (window as any).__ratipaModuleReads || new Map();
      pending.set(token, `${windowKey} :: ${new Error('read').stack || ''}`);
      (window as any).__ratipaModuleReads = pending;
    } catch { /* диагностика не должна мешать */ }
  }
  return token;
}

function flagRefresh(state: InternalState) {
  state.refreshing = true;
  if (state.refreshTimer !== null) window.clearTimeout(state.refreshTimer);
  state.refreshTimer = window.setTimeout(() => {
    state.refreshTimer = null;
    state.refreshing = false;
    notify();
  }, REFRESH_BADGE_MS);
  notify();
}

/**
 * Ответ базы по подписке: первый — это данные (или ошибка), последующие —
 * фоновое обновление, которое только отмечается значком и не заменяет контент.
 */
export function markRead(token: number, error?: unknown) {
  if (!token) return;
  const key = tokenOwner.get(token);
  if (!key) return;
  const state = states.get(key);
  if (!state) return;

  if (!state.windowOpen || !state.pending.has(token)) {
    if (error) console.error('[module-load] background', error);
    flagRefresh(state);
    return;
  }

  if (error) {
    clearDebug(token);
    fail(state, GENERIC_ERROR_MESSAGE, error);
    return;
  }

  state.answeredAny = true;
  state.pending.delete(token);
  // Владельца токена НЕ удаляем: по нему последующие обновления подписки
  // относятся к своему разделу и отмечаются значком фонового обновления.
  clearDebug(token);
  if (state.pending.size === 0 && state.everRegistered) settle(key, state);
}

/** Подписка снята (уход из раздела или размонтирование). */
export function releaseRead(token: number) {
  if (!token) return;
  const key = tokenOwner.get(token);
  tokenOwner.delete(token);
  clearDebug(token);
  if (!key) return;
  const state = states.get(key);
  if (!state || !state.windowOpen) return;
  state.pending.delete(token);
  if (state.pending.size === 0 && state.everRegistered) {
    // Данные так и не пришли: закрываем окно и ждём следующего входа
    closeWindow(state);
    state.phase = 'loading';
    if (windowKey === key) windowKey = null;
  }
}

/** Повторная загрузка раздела: сбрасывает состояние и пересоздаёт модуль. */
export function retryModuleLoad(key: string) {
  const state = stateOf(key);
  clearTimers(state);
  closeWindow(state);
  state.phase = 'loading';
  state.refreshing = false;
  state.everRegistered = false;
  state.attempt += 1;
  if (windowKey === key) windowKey = null;
  notify();
}

// Потеря сети во время первой загрузки: не ждём таймаут, показываем понятное сообщение
if (typeof window !== 'undefined') {
  window.addEventListener('offline', () => {
    states.forEach((state, key) => {
      if (!state.windowOpen) return;
      fail(state, OFFLINE_MESSAGE, new Error('offline: ' + key));
    });
  });
}

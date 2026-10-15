/**
 * Дата рождения водителя — ЧИСТЫЙ слой проверки правдоподобия и выбора
 * кандидатов для окна «внесите дату рождения».
 *
 * Зачем: в реестре водителей встречаются пустые и неправдоподобные даты
 * рождения. Дата нужна для документов и кадровых данных, поэтому диспетчер
 * водителя обязан её внести сам — окно возникает при входе в портал
 * (см. components/common/DriverBirthPrompt.tsx).
 *
 * Здесь только решения, без React и без базы:
 *  · пороги правдоподобия — ОДНО место (BIRTH_* константы);
 *  · разбор и нормализация даты — через utils/dateText (единый разбор
 *    форматов портала: ISO ГГГГ-ММ-ДД, ДД/ММ/ГГГГ, ДД.ММ.ГГГГ);
 *  · выбор кандидатов «кому нужно окно» — АДРЕСНО: только водители, чей
 *    ответственный диспетчер (drivers/{id}.dispatcherId — стабильный id учётки
 *    из users_list) совпадает с смотрящим. Право settings=write даёт
 *    возможность СОХРАНИТЬ дату, но НЕ даёт видеть чужих водителей: записи без
 *    ответственного и чужие записи в персональное окно не попадают ни у кого,
 *    включая root/администратора — они проверяют полноту данных отдельным
 *    административным инструментом (см. components/modules/AdminDriverDataBlock).
 *
 * Право правки — из общей системы прав портала (resolvePermission, те же
 * ключи, что открывают справочник водителей и данные авто/водителей), без
 * хардкода по ролям.
 */
import { parseDateParts } from './dateText';
import { resolvePermission, type PermissionSubject } from './permissions';

/* ---------------------------------------------------------------------------
 * Пороги правдоподобия даты рождения — ЕДИНОЕ место на весь портал.
 * Меняются здесь и больше нигде.
 * ------------------------------------------------------------------------- */

/** Раньше этого года рождения — почти наверняка опечатка. */
export const BIRTH_YEAR_MIN = 1940;
/** Позже этого года рождения — почти наверняка опечатка. */
export const BIRTH_YEAR_MAX = 2010;
/** Минимальный возраст водителя (полных лет). */
export const BIRTH_MIN_AGE = 18;

/** Ключ localStorage «окно уже показывали» — на пользователя (паттерн анонсов). */
export const BIRTH_PROMPT_STORAGE_PREFIX = 'ratipa_birth_prompt_';

/**
 * Права, дающие правку реестра водителей: сам справочник водителей живёт в
 * «Настройках» (раздел settings → вкладка «База водителей»), и раздел открывает
 * правку ровно по праву settings=write — тем же правом пользуемся здесь.
 *
 * ВАЖНО: право vehicleDriverData сюда НЕ входит: в боевых правах ролей оно
 * выдано и бухгалтеру (write), а это другой раздел («Данные авто/водителей»),
 * и окно по чужому праву получалось бы у тех, кто реестр не ведёт.
 */
export const DRIVER_REGISTRY_WRITE_KEYS = ['settings'] as const;

/** Причина, по которой дату нужно ввести заново. */
export type BirthDateProblem =
  | 'empty'
  | 'unparsable'
  | 'invalid-calendar'
  | 'future'
  | 'too-old'
  | 'too-young';

export interface BirthDateVerdict {
  /** Требуется ввод правильной даты. */
  needsInput: boolean;
  /** Нормализованная ISO-дата (ГГГГ-ММ-ДД), '' — если разобрать не удалось. */
  iso: string;
  /** Причина требования ввода; null — дата правдоподобна. */
  problem: BirthDateProblem | null;
  /** Короткое объяснение для интерфейса ('' — когда всё в порядке). */
  reason: string;
}

/** «Кто смотрит» — минимум профиля, нужный для выбора кандидатов. */
export interface BirthPromptViewer extends PermissionSubject {
  uid?: string;
  name?: string;
}

/** Запись реестра водителей в объёме, нужном окну (структурно). */
export interface BirthPromptDriverLike {
  id?: string;
  name?: string;
  lastNameRu?: string;
  firstNameRu?: string;
  middleNameRu?: string;
  shortNameRu?: string;
  phone?: string;
  phones?: Array<{ id?: string; number?: string; isPrimary?: boolean }>;
  birthDate?: string;
  dispatcherId?: string;
  dispatcherName?: string;
  dispatcher?: string;
  archived?: boolean;
  isArchived?: boolean;
  active?: boolean;
  service?: boolean;
  isService?: boolean;
}

/** Сцепка (центр) — источник номера машины для подписи водителя. */
export interface BirthPromptCouplingLike {
  driverId?: string;
  carNumber?: string;
  vehicleNumbers?: string;
}

/** Кандидат на окно: водитель + что именно не так с его датой. */
export interface BirthPromptCandidate {
  id: string;
  name: string;
  phone: string;
  car: string;
  /** Текущее значение в записи (как хранится: ISO / ДД/ММ/ГГГГ / мусор). */
  current: string;
  problem: BirthDateProblem;
  reason: string;
}

/* ---------------------------------------------------------------------------
 * Разбор и проверка одной даты
 * ------------------------------------------------------------------------- */

/** Сегодняшняя дата в виде ISO (локальная зона) — база для возраста и будущего. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Сдвиг ISO-даты на N лет назад (для порога «младше 18 лет»). */
function yearsAgoISO(now: Date, years: number): string {
  return `${now.getFullYear() - years}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Существует ли такая дата в календаре (30/02/1990 — нет). */
function isRealCalendarDate(y: number, m: number, d: number): boolean {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Нормализовать дату рождения в ISO (ГГГГ-ММ-ДД).
 * Понимает ISO, ДД/ММ/ГГГГ, ДД.ММ.ГГГГ (разбор — единый, utils/dateText).
 * Возвращает '' , если строку датой признать нельзя.
 */
export function normalizeBirthDate(value: string | null | undefined): string {
  const p = parseDateParts(value);
  if (!p) return '';
  if (!isRealCalendarDate(p.y, p.m, p.d)) return '';
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Объяснение причины для интерфейса (подсказка под полем / в окне). */
export function birthDateProblemLabel(problem: BirthDateProblem | null): string {
  switch (problem) {
    case 'empty':
      return 'Дата рождения не заполнена';
    case 'unparsable':
      return 'Дата не распознана — нужен вид ДД/ММ/ГГГГ';
    case 'invalid-calendar':
      return 'Такой даты не существует — проверьте день и месяц';
    case 'future':
      return 'Дата в будущем';
    case 'too-old':
      return `Год раньше ${BIRTH_YEAR_MIN} — похоже на опечатку`;
    case 'too-young':
      return `Возраст меньше ${BIRTH_MIN_AGE} лет — похоже на опечатку`;
    default:
      return '';
  }
}

/**
 * Проверка даты рождения на правдоподобие.
 * Требует ввода, если дата: пустая, не разбирается, не существует в календаре,
 * в будущем, раньше BIRTH_YEAR_MIN, позже BIRTH_YEAR_MAX или даёт возраст
 * меньше BIRTH_MIN_AGE.
 */
export function checkBirthDate(value: string | null | undefined, now: Date = new Date()): BirthDateVerdict {
  const raw = String(value ?? '').trim();
  const bad = (problem: BirthDateProblem): BirthDateVerdict => ({
    needsInput: true,
    iso: '',
    problem,
    reason: birthDateProblemLabel(problem),
  });

  if (!raw) return bad('empty');

  const parts = parseDateParts(raw);
  if (!parts) return bad('unparsable');
  if (!isRealCalendarDate(parts.y, parts.m, parts.d)) return bad('invalid-calendar');

  const iso = `${parts.y}-${String(parts.m).padStart(2, '0')}-${String(parts.d).padStart(2, '0')}`;
  // ISO-строки сравниваются лексикографически как даты — без часовых поясов.
  const today = todayISO(now);

  if (iso > today) {
    const v = bad('future');
    return { ...v, iso };
  }
  if (parts.y < BIRTH_YEAR_MIN) {
    const v = bad('too-old');
    return { ...v, iso };
  }
  if (parts.y > BIRTH_YEAR_MAX) {
    const v = bad('too-young');
    return { ...v, iso };
  }
  if (iso > yearsAgoISO(now, BIRTH_MIN_AGE)) {
    const v = bad('too-young');
    return { ...v, iso };
  }

  return { needsInput: false, iso, problem: null, reason: '' };
}

/** Коротко: нужно ли требовать ввод даты у этой записи. */
export function needsBirthDate(value: string | null | undefined, now: Date = new Date()): boolean {
  return checkBirthDate(value, now).needsInput;
}

/* ---------------------------------------------------------------------------
 * Кто смотрит: право правки и охват записей
 * ------------------------------------------------------------------------- */

/**
 * Есть ли у пользователя право править реестр водителей.
 * Используется общая система прав портала (resolvePermission): переопределения
 * пользователя (customPermissions/permissions) → права роли
 * (settings.rolePermissions → DEFAULT_ROLE_PERMS).
 */
export function canEditDriverRegistry(
  user: BirthPromptViewer | null | undefined,
  rolePermissions?: Record<string, Record<string, string>>,
): boolean {
  if (!user) return false;
  return DRIVER_REGISTRY_WRITE_KEYS.some(
    (key) => resolvePermission(user, key, rolePermissions) === 'write',
  );
}

/**
 * Ответственный диспетчер записи — СТРОГО по стабильному id: смотрящий должен
 * быть указан в самой записи водителя (drivers/{id}.dispatcherId — id учётки из
 * users_list), а не совпадать именем. Пустой dispatcherId = «ответственный не
 * назначен»: запись не принадлежит никому и в персональное окно не попадает.
 */
export function isResponsibleDispatcher(
  user: BirthPromptViewer | null | undefined,
  driver: BirthPromptDriverLike | null | undefined,
): boolean {
  const uid = String(user?.uid ?? '').trim();
  const owner = String(driver?.dispatcherId ?? '').trim();
  return !!uid && !!owner && owner === uid;
}

/* ---------------------------------------------------------------------------
 * Выбор записей: ФИО/телефон/машина/текущее значение даты
 * ------------------------------------------------------------------------- */

/** ФИО водителя: явное имя, иначе сборка из частей (локальная копия правила реестра). */
function candidateName(d: BirthPromptDriverLike): string {
  const explicit = String(d.name ?? '').trim();
  if (explicit) return explicit;
  return [d.lastNameRu, d.firstNameRu, d.middleNameRu]
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
    .join(' ');
}

/** Основной телефон водителя («Диспетчер водителя — drivers/{id}.dispatcherId»-стиль: из phones, иначе phone). */
function candidatePhone(d: BirthPromptDriverLike): string {
  const list = Array.isArray(d.phones) ? d.phones : [];
  const clean = list.map((p) => String(p?.number ?? '').trim()).filter(Boolean);
  if (clean.length > 0) {
    const primary = list.find((p) => p?.isPrimary && String(p?.number ?? '').trim());
    return String(primary?.number ?? clean[0]).trim();
  }
  return String(d.phone ?? '').trim();
}

/** Запись-заглушка («без В.» и т.п.) — не человек, в окно не попадает. */
function isServiceRecord(d: BirthPromptDriverLike): boolean {
  if (d.service === true || d.isService === true) return true;
  const n = candidateName(d).trim().toLowerCase();
  if (!n) return false;
  return /^(без\s*в\.?|без\s*водител[ья]|нет\s*водител[ья]|не\s*назначен[а]?|водитель\s*не\s*назначен|-+|—+|\.+|·)$/.test(n);
}

/** Архивная запись — в новых назначениях не участвует, окно по ней не нужно. */
function isArchivedRecord(d: BirthPromptDriverLike): boolean {
  return d.archived === true || d.isArchived === true || d.active === false;
}

/**
 * Водители, кому нужно окно, в порядке показа.
 *
 * Адресность: в список попадают ТОЛЬКО записи, за которые смотрящий назначен
 * ответственным (dispatchers/{id} — стабильный id). Право правки реестра
 * (settings=write) — условие возможности сохранить, а не охвата: чужие записи
 * и записи без ответственного не попадают сюда ни у кого, в том числе у
 * root/администратора (полнота данных проверяется административным
 * инструментом). Служебные и архивные записи пропускаются.
 */
export function selectBirthPromptCandidates(
  drivers: BirthPromptDriverLike[] | null | undefined,
  viewer: BirthPromptViewer | null | undefined,
  opts: {
    rolePermissions?: Record<string, Record<string, string>>;
    couplings?: BirthPromptCouplingLike[] | null;
    now?: Date;
  } = {},
): BirthPromptCandidate[] {
  const viewerUid = String(viewer?.uid ?? '').trim();
  if (!canEditDriverRegistry(viewer, opts.rolePermissions)) return [];
  if (!viewerUid) return [];

  const carByDriver = new Map<string, string>();
  for (const c of opts.couplings || []) {
    const driverId = String(c?.driverId ?? '').trim();
    if (!driverId) continue;
    const car = String(c?.carNumber ?? '').trim() || String(c?.vehicleNumbers ?? '').trim();
    if (car && !carByDriver.has(driverId)) carByDriver.set(driverId, car);
  }

  const out: BirthPromptCandidate[] = [];
  for (const d of drivers || []) {
    const id = String(d?.id ?? '').trim();
    if (!id) continue;
    if (isServiceRecord(d) || isArchivedRecord(d)) continue;
    if (!isResponsibleDispatcher(viewer, d)) continue;
    const verdict = checkBirthDate(d?.birthDate, opts.now);
    if (!verdict.needsInput || !verdict.problem) continue;
    out.push({
      id,
      name: candidateName(d),
      phone: candidatePhone(d),
      car: carByDriver.get(id) || '',
      current: String(d?.birthDate ?? '').trim(),
      problem: verdict.problem,
      reason: verdict.reason,
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }));
  return out;
}

/* ---------------------------------------------------------------------------
 * «Один раз за сессию»: ключ на пользователя + метка текущего запуска
 * ------------------------------------------------------------------------- */

/** Хранилище ключ-значение (localStorage в портале, объект — в тестах). */
export interface BirthPromptStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Ключ «окно по этому пользователю» — паттерн анонсов портала. */
export function birthPromptStorageKey(uid: string): string {
  return `${BIRTH_PROMPT_STORAGE_PREFIX}${String(uid || '')}`;
}

/**
 * Метка текущего запуска портала. Живёт в памяти: перезагрузка страницы = новый
 * запуск, поэтому «Позже» откладывает окно до следующего запуска, а не навсегда.
 */
let sessionToken = '';

/** Метка запуска (в тестах подставляется своим значением). */
export function currentBirthPromptSession(forced?: string): string {
  if (forced) return forced;
  if (!sessionToken) {
    sessionToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return sessionToken;
}

/** Показывали ли окно этому пользователю в текущем запуске. */
export function wasBirthPromptShown(
  uid: string,
  storage?: BirthPromptStorage | null,
  forcedSession?: string,
): boolean {
  const store = storage === undefined ? safeStorage() : storage;
  const key = birthPromptStorageKey(uid);
  if (!store || !key) return false;
  try {
    const raw = store.getItem(key);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { session?: string };
    return !!parsed && parsed.session === currentBirthPromptSession(forcedSession);
  } catch {
    // Битое значение не должно мешать работе: считаем, что не показывали.
    return false;
  }
}

/** Отметить факт показа в текущем запуске (при закрытии окна). */
export function markBirthPromptShown(
  uid: string,
  storage?: BirthPromptStorage | null,
  forcedSession?: string,
): void {
  const store = storage === undefined ? safeStorage() : storage;
  const key = birthPromptStorageKey(uid);
  if (!store || !key) return;
  try {
    store.setItem(key, JSON.stringify({ session: currentBirthPromptSession(forcedSession), at: new Date().toISOString() }));
  } catch {
    /* приватный режим / нет места — не критично: окно просто вернётся */
  }
}

/** localStorage без падений (приватный режим, SSR). */
function safeStorage(): BirthPromptStorage | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------------
 * Подсказки окна
 * ------------------------------------------------------------------------- */

/** Заголовок окна (один водитель / список). */
export function birthPromptTitle(total: number): string {
  return total > 1 ? 'Даты рождения водителей' : 'Дата рождения водителя';
}

/** Подзаголовок-прогресс: «2 из 3». */
export function birthPromptProgress(index: number, total: number): string {
  const i = Math.max(1, Math.min(index + 1, Math.max(total, 1)));
  return `${i} из ${Math.max(total, 1)}`;
}

/** Зачем нужна дата — честная подсказка в теле окна. */
export const BIRTH_PROMPT_WHY =
  'Дата рождения нужна для документов и кадровых данных водителя: без неё карточка неполная, а сроки по документам считаются неверно.';

/** Что делает «Позже» — без обмана: окно вернётся при следующем входе. */
export const BIRTH_PROMPT_LATER_HINT =
  '«Позже» закроет окно до следующего входа в портал — дату всё равно придётся внести.';

/* ---------------------------------------------------------------------------
 * Живая очередь окна: кандидаты из подписки реестра + что уже внесено
 * ------------------------------------------------------------------------- */

/** Состояние очереди окна на текущий момент — из живого списка кандидатов. */
export interface BirthPromptQueueState {
  /** Уже внесённые за этот заход окна (в порядке внесения). */
  doneIds: string[];
  /** Ещё не внесённые — очередь показа; первый элемент = текущий водитель. */
  pendingIds: string[];
  /** Полный порядок показа: внесённые впереди, затем очередь. */
  ids: string[];
  /** Сколько уже внесено. */
  pos: number;
  /** Счётчик окна: внесённые + остаток очереди. */
  total: number;
}

/**
 * Живая очередь окна. Кандидаты приходят из подписки реестра, поэтому очередь
 * пересчитывается сама, без перезагрузки: внесённая дата уходит в `done`
 * (счётчик успехов растёт), переназначение ответственного убирает запись из
 * кандидатов (уходит у старого), вновь появившиеся записи встают в очередь.
 * `dropped` — записи, которые в этом заходе больше не показываем (переназначили
 * или дата уже внесена параллельно).
 */
export function birthPromptQueue(
  candidates: BirthPromptCandidate[] | null | undefined,
  state: { done?: string[] | null; dropped?: string[] | null } = {},
): BirthPromptQueueState {
  const doneIds = (state.done || []).map(String);
  const doneSet = new Set(doneIds);
  const droppedSet = new Set((state.dropped || []).map(String));
  const pendingIds = (candidates || [])
    .map((c) => String(c?.id ?? '').trim())
    .filter((id) => !!id && !doneSet.has(id) && !droppedSet.has(id));
  return {
    doneIds,
    pendingIds,
    ids: [...doneIds, ...pendingIds],
    pos: doneIds.length,
    total: doneIds.length + pendingIds.length,
  };
}

/* ---------------------------------------------------------------------------
 * Проверка права ЗАПИСИ в момент сохранения
 * ------------------------------------------------------------------------- */

/** Почему запись даты сейчас запрещена (null — можно писать). */
export type BirthSaveBlockReason =
  | 'not-found'
  | 'no-right'
  | 'not-responsible'
  | 'already-filled';

/**
 * Можно ли СЕЙЧАС записать дату по этой записи — проверка в момент сохранения,
 * а не только при открытии окна: право правки, ответственность по стабильному
 * id и то, что дата всё ещё требует ввода (её могли внести параллельно).
 */
export function birthSaveBlockReason(
  user: BirthPromptViewer | null | undefined,
  driver: BirthPromptDriverLike | null | undefined,
  opts: { rolePermissions?: Record<string, Record<string, string>>; now?: Date } = {},
): BirthSaveBlockReason | null {
  if (!driver || !String(driver.id ?? '').trim()) return 'not-found';
  if (!canEditDriverRegistry(user, opts.rolePermissions)) return 'no-right';
  if (!isResponsibleDispatcher(user, driver)) return 'not-responsible';
  if (!needsBirthDate(driver.birthDate, opts.now)) return 'already-filled';
  return null;
}

/** Текст отказа для окна — по причине из birthSaveBlockReason. */
export function birthSaveBlockLabel(reason: BirthSaveBlockReason): string {
  switch (reason) {
    case 'not-found':
      return 'Запись водителя не найдена — окно обновится само.';
    case 'no-right':
      return 'Нет права правки реестра водителей — дату вносит ответственный диспетчер.';
    case 'not-responsible':
      return 'Водитель больше не закреплён за вами — запрос переназначен ответственному.';
    case 'already-filled':
      return 'Дата рождения уже внесена — запись снята с очереди.';
    default:
      return '';
  }
}

/**
 * «Закрыть рейс» — единый пошаговый сценарий из шести шагов.
 *
 * Здесь только ЧИСТАЯ логика: определения шагов, состояния, прогресс, правила
 * завершения, сводка и защита от повторных операций. Ни базы, ни React:
 * состояние пишет `src/firebase/tripCloseService.ts`, показывает `TripCloseWizard`.
 *
 * Правила, заданные владельцем:
 *  · «Отложено» ≠ «Выполнено»; «Не требуется» — только с обоснованием;
 *  · шаг «Зарплата» не означает фактическую выплату денег;
 *  · повторный запуск не повторяет выполненные операции;
 *  · несделанные шаги не отменяют уже сохранённые действия.
 */

export type StepKey = 'planDohod' | 'salary' | 'vyezd' | 'zagruzka' | 'docs' | 'mdp';

export type StepStatus = 'pending' | 'in_progress' | 'done' | 'postponed' | 'not_needed';

export interface StepState {
  status: StepStatus;
  at?: string;
  by?: string;
  /** Причина откладывания или обоснование «не требуется». */
  note?: string;
  refs?: Record<string, string>;
}

export interface TripCloseDoc {
  id: string;
  /** Тип/название документа из книги выдачи: CMR, книжка МДП, дозвол, T1… */
  type: string;
  number?: string;
  issuedAt?: string;
  issuedTo?: string;
  accepted: boolean;
  acceptedAt?: string;
  acceptedBy?: string;
  note?: string;
}

export interface TripCloseMdpBook {
  id: string;
  number: string;
  carNumber?: string;
  driverName?: string;
  issuedAt?: string;
  returned: boolean;
  returnedAt?: string;
  acceptedBy?: string;
  /** Комплектность подтверждена отдельно от факта возврата. */
  complete?: boolean;
  /** Явно указанная связь с документом книги выдачи. */
  docId?: string;
  note?: string;
}

export interface TripCloseOperation {
  at?: string;
  by?: string;
  id?: string;
  summary?: string;
}

export interface TripCloseState {
  tripId: string;
  carNumber: string;
  driverNames: string[];
  route: string;
  dateStart?: string;
  dateEnd?: string;
  planDohodId: string;
  initiator?: { uid?: string; name?: string };
  createdAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  currentStep?: StepKey;
  steps: Record<StepKey, StepState>;
  operations?: Record<string, TripCloseOperation>;
  errors?: Array<{ at: string; step: StepKey; message: string }>;
  docs?: TripCloseDoc[];
  mdp?: TripCloseMdpBook[];
  flags?: { docsNone?: boolean; mdpNotUsed?: boolean };
  zagruzka?: {
    dispatcher?: string;
    driver?: string;
    readyDate?: string;
    location?: string;
    mode?: 'auto' | 'manual';
    confirmedBy?: string;
    confirmedAt?: string;
  };
  lock?: { by: string; uid?: string; at: string; expiresAt: string };
  completedAt?: string;
  completedBy?: string;
}

export const STEP_ORDER: StepKey[] = ['planDohod', 'salary', 'vyezd', 'zagruzka', 'docs', 'mdp'];

export interface StepDef {
  key: StepKey;
  label: string;
  short: string;
  permissionKey: string;
  hint: string;
}

export const STEP_DEFS: StepDef[] = [
  { key: 'planDohod', label: 'План дохода', short: 'План дохода', permissionKey: 'planDohod', hint: 'Даты рейса, «Факт км» и расходы статьями; сохранение и архивация уже существующим механизмом.' },
  { key: 'salary', label: 'Зарплата водителя', short: 'Зарплата', permissionKey: 'salary', hint: 'Расчёт и запись по существующим ставкам. Факт выплаты денег оформляется отдельно.' },
  { key: 'vyezd', label: 'Учёт выезда', short: 'Учёт выезда', permissionKey: 'baza', hint: 'Дата приезда (подтверждает пользователь) и срок готовности автомобиля.' },
  { key: 'zagruzka', label: 'План загрузок', short: 'План загрузок', permissionKey: 'planZagruzok', hint: 'Данные следующей работы: копирование и открытие таблицы, подтверждение внесения.' },
  { key: 'docs', label: 'Книга выдачи', short: 'Книга выдачи', permissionKey: 'bookIssue', hint: 'Отметить документы, фактически принятые после возвращения из рейса.' },
  { key: 'mdp', label: 'Журнал МДП', short: 'Журнал МДП', permissionKey: 'bookIssue', hint: 'Возврат книжки МДП или явное подтверждение, что она не использовалась.' },
];

export const stepDef = (key: StepKey): StepDef => STEP_DEFS.find((d) => d.key === key) || STEP_DEFS[0];

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  pending: 'не начат',
  in_progress: 'в работе',
  done: 'выполнен',
  postponed: 'отложен',
  not_needed: 'не требуется',
};

export const emptySteps = (): Record<StepKey, StepState> =>
  STEP_ORDER.reduce((acc, key) => {
    acc[key] = { status: 'pending' };
    return acc;
  }, {} as Record<StepKey, StepState>);

export const emptyState = (seed: {
  tripId: string;
  carNumber: string;
  driverNames?: string[];
  route?: string;
  dateStart?: string;
  dateEnd?: string;
  planDohodId?: string;
  initiator?: { uid?: string; name?: string };
}): TripCloseState => ({
  tripId: seed.tripId,
  carNumber: seed.carNumber,
  driverNames: seed.driverNames || [],
  route: seed.route || '',
  dateStart: seed.dateStart,
  dateEnd: seed.dateEnd,
  planDohodId: seed.planDohodId || seed.tripId,
  initiator: seed.initiator,
  currentStep: 'planDohod',
  steps: emptySteps(),
  operations: {},
  errors: [],
  docs: [],
  mdp: [],
  flags: {},
});

export const normalizeState = (raw: Partial<TripCloseState> | null | undefined, tripId: string): TripCloseState => {
  const seed = emptyState({
    tripId,
    carNumber: String(raw?.carNumber || ''),
    driverNames: Array.isArray(raw?.driverNames) ? raw!.driverNames!.filter(Boolean).map(String) : [],
    route: String(raw?.route || ''),
    dateStart: raw?.dateStart,
    dateEnd: raw?.dateEnd,
    planDohodId: String(raw?.planDohodId || tripId),
    initiator: raw?.initiator,
  });
  const steps = { ...emptySteps() };
  STEP_ORDER.forEach((key) => {
    const s = raw?.steps?.[key];
    if (s && s.status) steps[key] = { ...s };
  });
  return {
    ...seed,
    ...raw,
    tripId,
    steps,
    operations: raw?.operations || {},
    errors: Array.isArray(raw?.errors) ? raw!.errors! : [],
    docs: Array.isArray(raw?.docs) ? raw!.docs!.filter(Boolean) : [],
    mdp: Array.isArray(raw?.mdp) ? raw!.mdp!.filter(Boolean) : [],
    flags: raw?.flags || {},
  };
};

export const stepDone = (state: TripCloseState, key: StepKey): boolean => state.steps[key]?.status === 'done';

/** Шаг «закрыт» для прогресса: выполнен либо обоснованно «не требуется». */
export const stepSettled = (state: TripCloseState, key: StepKey): boolean => {
  const st = state.steps[key]?.status;
  if (st === 'done') return true;
  if (st === 'not_needed') return Boolean(String(state.steps[key]?.note || '').trim());
  return false;
};

export interface TripCloseProgress {
  done: number;
  settled: number;
  total: number;
  postponed: StepKey[];
  pending: StepKey[];
  inProgress: StepKey[];
  canFinish: boolean;
  completed: boolean;
}

export const deriveProgress = (state: TripCloseState): TripCloseProgress => {
  const settled = STEP_ORDER.filter((k) => stepSettled(state, k));
  const postponed = STEP_ORDER.filter((k) => state.steps[k]?.status === 'postponed');
  const pending = STEP_ORDER.filter((k) => (state.steps[k]?.status || 'pending') === 'pending');
  const inProgress = STEP_ORDER.filter((k) => state.steps[k]?.status === 'in_progress');
  return {
    done: STEP_ORDER.filter((k) => stepDone(state, k)).length,
    settled: settled.length,
    total: STEP_ORDER.length,
    postponed,
    pending,
    inProgress,
    canFinish: settled.length === STEP_ORDER.length && postponed.length === 0,
    completed: Boolean(state.completedAt),
  };
};

/** Точка продолжения: первый незакрытый (или отложенный) шаг. */
export const nextStep = (state: TripCloseState): StepKey | null => {
  if (state.completedAt) return null;
  const open = STEP_ORDER.find((k) => !stepSettled(state, k) && state.steps[k]?.status !== 'postponed');
  if (open) return open;
  return STEP_ORDER.find((k) => state.steps[k]?.status === 'postponed') || null;
};

export const hasOperation = (state: TripCloseState, key: string): boolean => Boolean(state.operations?.[key]?.at);

export const STEP_OPERATION_KEYS: Record<StepKey, string> = {
  planDohod: 'planSaved',
  salary: 'salarySaved',
  vyezd: 'vyezdSaved',
  zagruzka: 'zagruzkaConfirmed',
  docs: 'docsAccepted',
  mdp: 'mdpReturned',
};

export const planStepIssues = (
  plan: { factKm?: unknown; dateStart?: unknown; dateEnd?: unknown } | null | undefined,
): string[] => {
  const issues: string[] = [];
  if (!plan) return ['Запись плана дохода не найдена'];
  const rawKm = plan.factKm;
  const km = rawKm === '' || rawKm === null || rawKm === undefined ? null : Number(rawKm);
  if (km === null || !Number.isFinite(km)) {
    issues.push('В плане дохода не заполнен «Факт км» — впишите его вручную (плановый пробег и GPS-пробег не подставляются)');
  }
  const rawStart = String(plan.dateStart || '');
  const rawEnd = String(plan.dateEnd || '');
  if (!rawStart.trim()) issues.push('Не заполнена дата старта');
  if (!rawEnd.trim()) issues.push('Не заполнена дата финиша');
  return issues;
};

/** Нужна ли повторная проверка зарплаты: план изменился после её оформления. */
export const salaryRecheckNeeded = (
  snapshot: { dateStart?: string; dateEnd?: string; factKm?: number | null } | null | undefined,
  plan: { dateStart?: unknown; dateEnd?: unknown; factKm?: unknown } | null | undefined,
): { needed: boolean; reasons: string[] } => {
  if (!snapshot || !plan) return { needed: false, reasons: [] };
  const reasons: string[] = [];
  const planStart = plan.dateStart ? String(plan.dateStart) : '';
  const planEnd = plan.dateEnd ? String(plan.dateEnd) : '';
  const rawKm = plan.factKm;
  const planKm = rawKm === '' || rawKm === null || rawKm === undefined ? null : Number(rawKm);
  if (planStart && snapshot.dateStart && planStart !== snapshot.dateStart) reasons.push('дата старта');
  if (planEnd && snapshot.dateEnd && planEnd !== snapshot.dateEnd) reasons.push('дата финиша');
  if (planKm !== null && snapshot.factKm !== null && snapshot.factKm !== undefined && planKm !== snapshot.factKm) reasons.push('«Факт км»');
  return { needed: reasons.length > 0, reasons };
};

export const missingInSummary = (state: TripCloseState): { docs: TripCloseDoc[]; mdp: TripCloseMdpBook[] } => ({
  docs: (state.docs || []).filter((d) => !d.accepted),
  mdp: (state.mdp || []).filter((b) => !b.returned),
});

export interface SummaryLine {
  key: StepKey;
  label: string;
  result: string;
  tone: 'ok' | 'warn' | 'muted';
}

export const summaryLines = (state: TripCloseState): SummaryLine[] => {
  const missing = missingInSummary(state);
  const st = (key: StepKey): StepStatus => state.steps[key]?.status || 'pending';
  const noteOf = (key: StepKey): string => String(state.steps[key]?.note || '').trim();

  const plain = (key: StepKey, okText: string, skipText: string): { result: string; tone: SummaryLine['tone'] } => {
    const status = st(key);
    if (status === 'done') return { result: okText, tone: 'ok' };
    if (status === 'not_needed') return { result: `${skipText}${noteOf(key) ? ` — ${noteOf(key)}` : ''}`, tone: 'muted' };
    if (status === 'postponed') return { result: `Отложено${noteOf(key) ? ` — ${noteOf(key)}` : ''}`, tone: 'warn' };
    if (status === 'in_progress') return { result: 'В работе — не завершено', tone: 'warn' };
    return { result: 'Не начато', tone: 'muted' };
  };

  const docsOutcome = (): { result: string; tone: SummaryLine['tone'] } => {
    if (st('docs') !== 'done') return plain('docs', '', 'Не требуется');
    if (state.flags?.docsNone) return { result: 'Подтверждено: документы по рейсу не выдавались', tone: 'muted' };
    if (missing.docs.length) return { result: `Документы приняты частично — не принято: ${missing.docs.length}`, tone: 'warn' };
    const accepted = (state.docs || []).length;
    return { result: accepted ? `Документы приняты: ${accepted}` : 'Документы приняты', tone: 'ok' };
  };

  const mdpOutcome = (): { result: string; tone: SummaryLine['tone'] } => {
    if (st('mdp') !== 'done') return plain('mdp', '', 'Не требуется');
    if (state.flags?.mdpNotUsed) return { result: 'Подтверждено: книжка МДП в этом рейсе не использовалась', tone: 'muted' };
    if (missing.mdp.length) return { result: `Возврат книжки не подтверждён — книжек без возврата: ${missing.mdp.length}`, tone: 'warn' };
    const total = (state.mdp || []).length;
    return { result: total ? `Возврат подтверждён: ${total}` : 'Возврат подтверждён', tone: 'ok' };
  };

  return [
    { key: 'planDohod', label: STEP_DEFS[0].label, ...plain('planDohod', 'Сохранён и архивирован', 'Не требуется') },
    { key: 'salary', label: STEP_DEFS[1].label, ...plain('salary', 'Расчёт сохранён (факт выплаты оформляется отдельно)', 'Не требуется') },
    { key: 'vyezd', label: STEP_DEFS[2].label, ...plain('vyezd', 'Запись «Учёта выезда» оформлена', 'Не требуется') },
    { key: 'zagruzka', label: STEP_DEFS[3].label, ...plain('zagruzka', state.zagruzka?.mode === 'auto' ? 'Внесено интеграцией' : 'Внесено и подтверждено', 'Не требуется') },
    { key: 'docs', label: STEP_DEFS[4].label, ...docsOutcome() },
    { key: 'mdp', label: STEP_DEFS[5].label, ...mdpOutcome() },
  ];
};

/** Короткая подпись для карточек: «Закрытие рейса: 4/6 · следующий шаг: Книга выдачи». */
export const progressLabel = (state: TripCloseState): string => {
  const p = deriveProgress(state);
  if (p.completed) return 'Сценарий закрытия завершён';
  const next = nextStep(state);
  return `Закрытие рейса: ${p.settled}/${p.total}${next ? ` · следующий шаг: ${stepDef(next).short}` : ''}`;
};

/** Блокировка жива? (истекает, чтобы чужой сценарий не висел вечно) */
export const lockIsActive = (lock: TripCloseState['lock'], now = Date.now()): boolean => {
  if (!lock?.expiresAt) return false;
  const t = new Date(lock.expiresAt).getTime();
  return Number.isFinite(t) && t > now;
};

export const LOCK_TTL_MS = 20 * 60 * 1000;

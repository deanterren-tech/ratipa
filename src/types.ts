export interface PhoneNumber {
  id: string;
  number: string;
  isPrimary: boolean;
}

export type UserRole =
  | "root_admin"
  | "admin"
  | "dispatcher"
  | "manager"
  | "accountant"
  | "viewer"
  | "mechanic";

export interface UserPermissions {
  dohod: "none" | "read" | "write";
  salary: "none" | "read" | "write";
  planDohod: "none" | "read" | "write";
  planZagruzok: "none" | "read" | "write";
  baza: "none" | "read" | "write";
  dozvola: "none" | "read" | "write";
  documentTracking: "none" | "read" | "write";
  disposition: "none" | "read" | "write";
  documents?: "none" | "read" | "write";
  settings: "none" | "read" | "write";
  admin: "none" | "read" | "write";
  dashboard?: "none" | "read" | "write";
  vehicleDriverData?: "none" | "read" | "write";
  currentPlanning?: "none" | "read" | "write";
  archives?: "none" | "read" | "write";
  bookIssue?: "none" | "read" | "write";
  tabel?: "none" | "read" | "write";
  mdpJournal?: "none" | "read" | "write";
  driverExpenses?: "none" | "read" | "write";
  bookIssueRR?: "none" | "read" | "write";
  /** Модуль «Таймлайн рейсов по машинам» (tripTimeline). */
  tripTimeline?: "none" | "read" | "write";
}

export interface UserProfile {
  uid: string;
  isDispatcher?: boolean;
  name: string;
  email: string;
  role: UserRole;
  permissions: UserPermissions;
  customPermissions?: any;
  createdAt: string;
  lastActive?: string;
  isOnline?: boolean;
  currentModule?: string;
  password?: string;
  color?: string;
  /**
   * Фотография профиля в виде data URL (уменьшенная до 256×256, обрезка по центру).
   * Пусто или отсутствует — показываются выбранный цвет и инициалы.
   */
  avatarPhoto?: string;
  /** Персональный масштаб фреймов Google-таблиц по модулям: { disposition, planZagruzok, currentPlanning } -> 50..200 */
  sheetZoom?: Record<string, number>;
  /** Выбранный пользователем режим отображения списков по модулям: { vehicles: 'grid4' | 'grid2' | 'list' } */
  viewModes?: Record<string, string>;
  /** Пройденные превью обновлений: { [версия приложения]: 'done' | 'skipped' } */
  onboarding?: Record<string, string>;
  /**
   * Имя и фамилия — отдельные поля профиля.
   * `name` остаётся полным отображаемым именем и логином входа («Имя Фамилия»),
   * чтобы не ломать существующую авторизацию и старые записи.
   */
  firstName?: string;
  lastName?: string;
  /**
   * Акцентная тема интерфейса (id варианта из src/theme/accent.ts).
   * Личная настройка пользователя: применяется при входе и хранится в профиле.
   */
  accentColor?: string;
}

export interface VehicleHistoryItem {
  id: string;
  date: string;
  user: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface Vehicle {
  id: string; // matches document or push key
  carNumber: string;
  driverName: string;
  driverId?: string;
  driverRaw?: string;
  driverShortNameRu?: string;
  migrationStatus?: 'matched' | 'ambiguous' | 'unmatched';
  dateArrival: string;
  dateLoading: string;
  dateRepairStart: string;
  dateRepairEnd: string;
  dateDeparture: string;
  comment: string;
  status: "base" | "loading" | "repair" | "departure" | "archive";
  currentStatus?: "ON_TRIP" | "ON_BASE";
  history?: VehicleHistoryItem[];
  
  // Dynamic fields merged from dispatcher/baza records
  brandModel?: string;
  brands?: string;
  brandsRu?: string;
  brandsLat?: string;
  trailerMake?: string;
  vehicleNumbers?: string;
  trailerNumber?: string;
  dispatcherName?: string;
  dispatcher?: string;
  /** Идентификатор учётной записи диспетчера (стабильная связь) */
  dispatcherId?: string;
  driverPhone?: string;
  phone?: string;
  ownerName?: string;
  tariffId?: string;
  /** Ставка за км (€/км) из справочника — есть у записей tractors/couplings. */
  rate?: number;
  /** Группа ставок (directories/rateGroups.id) — привязка авто к справочнику ставок. */
  rateGroupId?: string;
}

export interface Leg {
  id: string;
  from: string;
  to: string;
  dist?: number; // legacy field
  distance?: number; // fallback
  emptyRun?: number;
  freight: number;
  infoRate?: number;
  infoRateCurrency?: string;
  infoCurrency?: string;
  ferryCost?: number;
  ferryCurrency?: string;
  ferrySelectValue?: string;
  coeff: number;
  direction?: string;
  additionalExpenses?: number;
  otherExpenses?: number;
  distanceSource?: string;
  isManual?: boolean;
  isApproximate?: boolean;

  // New map & route properties
  origin?: string;
  destination?: string;
  waypoints?: string[];
  mapProvider?: string;
  vehicleType?: string;
  selectedRouteIndex?: number;
  routes?: any[];
  segments?: any[];
  totalDistanceKm?: number;
  manualOverride?: boolean;
}

export interface RouteCalculation {
  id: string;
  legs: Omit<Leg, "id">[]; // legacy doesn't have id on history legs securely
  from?: string;
  to?: string;
  distance?: number;
  km?: number;
  freight: number;
  expenses?: number;
  netProfit?: number;
  dailyProfit?: number;
  days?: number;
  direction?: string;
  globalDirection?: string;
  totalKm?: number;
  totalFreight?: number;
  totalExpenses?: number;
  additionalExpenses?: number;
  expenseItems?: { label: string; amount: number }[];
  totalProfit?: number;
  datetime?: string; // legacy field
  date?: string;
  logist?: string; // legacy field
  userId?: string;
  username?: string;
}

export interface SalaryLog {
  id: string;
  car: string;
  rate: number;
  km: number;
  mark: string;
  idleDays: number;
  totalDays: number;
  bonus: number;
  driver: string;
  totalSalary: number;
  salaryPerDay: number;
  datetime: string;
  logist: string;
  kmMoney?: number;
  idleMoney?: number;
  daysMoney?: number;
  comment?: string;
  carId?: string;
  driverId?: string;
  /** Фактический ключ ветки salaryHistory/months|byDispatcher, под которым лежит запись.
   *  Служебное поле только для чтения/удаления — в базу не записывается. */
  storageKey?: string;
}

export interface LegPlan {
  freightCurrency?: string;
  infoCurrency?: string;
  infoRateCurrency?: string;
  from: string;
  to: string;
  km: number;
  emptyRunKm?: number;
  emptyRun?: number; // Added to match PlanDohodModule.tsx
  rate: number;
  freight?: number; // Added to match PlanDohodModule.tsx
  referenceRate?: string;
  referenceCurrency?: string;
  ferry: number;
  ferryCost?: number; // Added to match PlanDohodModule.tsx
  infoRate?: number; // Added to match PlanDohodModule.tsx
  coeff: number;
  waypoints?: string[];
  mapProvider?: "google" | "yandex";
}

export interface PotentialLoad {
  id: string;
  name: string;
  legs: LegPlan[];
  totalKm: number;
  totalFreight: number;
  totalExpenses: number;
  ferryCost: number;
  extraExpense: number;
  extraExpenseNote: string;
  referenceRate?: number;
  referenceCurrency?: string;
  profit: number;
  profitFact: number;
  dateStart?: string;
  dateEnd?: string;
  days?: number;
}

export interface TripPlan {
  id: string; // Firebase id
  carNumber: string;
  logist: string;
  direction: string;
  dateStart: string;
  dateEnd: string;
  days: number;
  totalKm: number;
  totalFreight: number;
  totalExpenses: number;
  extraExpense: number;
  extraExpenseNote: string;
  emptyRunKm?: number;
  ferryCost?: number;
  referenceRate?: number;
  referenceCurrency?: "EUR" | "USD" | "RUB" | "BYN";
  profit: number;
  factKm: number;
  profitFact: number;
  tripNote: string;
  stripColor: string;
  legs: LegPlan[];
  potentialLoads?: PotentialLoad[];
  activeLegIndex?: number;
  dispatcher: string;
  /** Имя и фамилия диспетчера из учётной записи (отображение) */
  dispatcherName?: string;
  /** Идентификатор учётной записи диспетчера (стабильная связь) */
  dispatcherId?: string;
  driverName?: string;
  currentMonth: string;
  isArchived: boolean;
}

// ---- Таймлайн рейсов по машинам (модуль tripTimeline) ----
// Все даты хранятся строками YYYY-MM-DD (без времени и часовых поясов) —
// так не бывает сдвигов по дням. Ветки RTDB: tripTimeline/trips,
// tripTimeline/vehicleEvents, конфиг справочника — tripTimeline/config/stageTypes.

/** Этап рейса: плановая/фактическая дата, критический срок, причина и меры. */
export interface TimelineStage {
  id: string;
  /** Ключ типа из расширяемого справочника (load, border, unl, …). */
  type: string;
  /** «Уточнение»: конкретный переход/КПП или пояснение к этапу. */
  label?: string;
  /** План, YYYY-MM-DD. */
  plannedDate?: string;
  /** Факт, YYYY-MM-DD. */
  actualDate?: string;
  /** Критический срок — ставится флагом на любом этапе. */
  isCritical?: boolean;
  /** Причина просрочки. */
  reason?: string;
  /** Принятые меры. */
  action?: string;
  /** Порядок этапа в рейсе. */
  order: number;
}

/** Рейс для таймлайна машин (ветка RTDB: tripTimeline/trips/{id}). */
export interface TimelineTrip {
  id: string;
  /** couplings.id — связь с единой базой сцепок. */
  vehicleId?: string;
  /** Номер машины (тягача) — ключ строки таймлайна. */
  carNumber: string;
  /** Маршрут текстом. */
  route: string;
  /** uid пользователя-диспетчера (users_list). */
  dispatcherId?: string;
  /** Имя диспетчера для отображения (снимок на момент сохранения). */
  dispatcherName?: string;
  /** Запас на риски после плана, дней. */
  bufferDays: number;
  /** Архивный рейс (не автоархивация — только флаг пользователя). */
  archived?: boolean;
  /** Вычисляемый диапазон рейса (мин/макс по плану и факту) — для окна загрузки. */
  startDate?: string;
  endDate?: string;
  createdAt?: string;
  updatedAt?: string;
  stages: TimelineStage[];
}

/** Событие машины: ремонт / на базе / простой / другое (tripTimeline/vehicleEvents/{id}). */
export interface TimelineVehicleEvent {
  id: string;
  vehicleId?: string;
  carNumber: string;
  /** repair | base | idle | other */
  kind: string;
  dateFrom: string;
  dateTo?: string;
  note?: string;
  /** Явная связь с целым рейсом журнала (`pd:<planId>` | `tl:<id>`).
   *  Заполняется при создании события в карточке рейса; старые события машины
   *  без связи сохраняются как есть и не привязываются по совпадению дат. */
  tripKey?: string;
  /** Необязательная связь с этапом этого рейса (TimelineStage.id). */
  stageId?: string;
  createdAt?: string;
  updatedAt?: string;
}

/** Тип этапа из расширяемого справочника (tripTimeline/config/stageTypes). */
export interface TimelineStageType {
  key: string;
  name: string;
  order: number;
}

// ---- Контроль плана этапов рейса (модуль tripTimeline) ----
// Плановые даты промежуточных этапов блокируются после ЯВНОГО сохранения плана
// («Сохранить план этапов»); разблокировка — только разовым разрешением
// администратора (одно на пару «рейс + пользователь»). Ветки:
// tripTimeline/planGuard/<tripKey> — состояние плана, версия и история;
// tripTimeline/planPerms/<tripKey>/<uid> — действующее разовое разрешение.

/** Запись истории плана этапов (кто/когда/что). */
export interface TimelinePlanHistoryEntry {
  at: string;
  /** Имя пользователя. */
  by: string;
  /** uid пользователя, если известен. */
  byId?: string;
  action: 'initial' | 'update' | 'admin-update' | 'grant' | 'revoke';
  note?: string;
}

/** Состояние плана этапов рейса: блокировка после сохранения + история. */
export interface TimelinePlanGuard {
  /** Версия плана: инкремент при каждом окончательном сохранении. */
  version: number;
  /** Рейс создан после включения контроля — план ещё черновик. */
  draftCreated?: boolean;
  /** Первичное окончательное сохранение (для исторических планов отсутствует). */
  initialSavedAt?: string;
  initialSavedBy?: string;
  initialSavedById?: string;
  /** План был заполнен до включения контроля: автор/дата неизвестны. */
  legacy?: boolean;
  updatedAt?: string;
  updatedBy?: string;
  updatedById?: string;
  history?: TimelinePlanHistoryEntry[];
}

/** Разовое разрешение администратора: ровно одно на пару (рейс, пользователь). */
export interface TimelinePlanPermission {
  userId: string;
  userName: string;
  grantedAt: string;
  grantedBy: string;
  grantedById?: string;
  /** Версия плана на момент выдачи — защита от молчаливой перезаписи. */
  planVersion: number;
}

export interface Permit {
  id: string;
  country: string;
  type: string;
  permitNumber: string;
  status: "available" | "used" | "lost" | "archive";
  dateIssued: string;
  assignedVehicle: string;
  comments: string;
  history?: {
    date: string;
    action: string;
    user: string;
  }[];
}

export interface ChatMessage {
  id: string;
  moduleId: string;
  text: string;
  username: string;
  timestamp: number;
  userId: string;
  time?: string;
  isEdited?: boolean;
}

export interface AuditLog {
  id: string;
  date: string;
  timestamp?: number;
  user: string;
  role: string;
  actionType: string;
  module: string;
  entityId: string;
  details: string;
}

export interface Announcement {
  id: string;
  text: string;
  date: string;
  author: string;
  important: boolean;
}

export interface HighlightData {
  id?: string;
  title: string;
  text: string;
  imageUrl?: string;
  date: string;
  author: string;
  height?: number;
  isImportant?: boolean;
  linkUrl?: string;
}

export interface QuickLink {
  id: string;
  title: string;
  url: string;
}

export interface ExternalTab {
  id: string;
  title: string;
  url: string;
}

export interface CurrentPlanningTab {
  id: string;
  name: string;
  sheetUrl: string;
}

export interface PlanZagruzokTab {
  id: string;
  name: string;
  sheetUrl: string;
  blacklist?: boolean;
}

export interface CurrencyPreset {
  id: string;
  code: string;
}

export interface MenuStructureGroup {
  id: string;
  label: string;
  isDropdown: boolean;
  icon?: string;
  subtabKeys?: string[];
  singleModuleKey?: string;
  customLabels?: Record<string, string>; // to rename subtabs/modules individually
}

/** Ссылка из инструкции на раздел приложения. */
export interface InstructionLink {
  label: string;
  module: string;
}

/** Инструкция по типовой рабочей задаче (модуль «Инструкции»). */
export interface Instruction {
  id: string;
  /** Тема или рабочий процесс — по ним инструкции группируются в списке. */
  theme: string;
  title: string;
  /** Краткое описание: когда и зачем выполнять задачу. */
  summary: string;
  /** Предварительные условия или нужные данные. */
  prerequisites?: string[];
  /** Нумерованный порядок действий. */
  steps: string[];
  /** Подсказки и типичные ошибки. */
  tips?: string[];
  /** Ссылки на разделы приложения. */
  links?: InstructionLink[];
  /** Содержание требует уточнения: порядок шагов ещё не подтверждён. */
  needsWork?: boolean;
}

export interface AppSettings {
  googleSheetsId: string;
  googleSheetsUrl: string;
  googleSheetsEmbedUrl: string;
  planZagruzokSheetUrl?: string;
  planZagruzokBlacklistUrl?: string;
  dispositionSheetUrl?: string;
  bookIssueSheetUrl?: string;
  tabelSheetUrl?: string;
  mdpJournalSheetUrl?: string;
  driverExpensesUrl?: string;
  bookIssueRRUrl?: string;
  googleDriveUrl?: string;
  gpsBeltranssputnikUrl?: string;
  gpsWialonUrl?: string;
  gpsEraGlonassUrl?: string;
  currentPlanningTabs?: CurrentPlanningTab[];
  planZagruzokTabs?: PlanZagruzokTab[];
  announcements: Announcement[];
  highlight: HighlightData | null;
  highlights?: HighlightData[];
  quickLinks: QuickLink[];
  externalTabs?: ExternalTab[];
  /** Рабочие инструкции — модуль «Инструкции» в разделе «Текущее». */
  instructions?: Instruction[];
  /** Подсказки про сам портал — меню пользователя → «Инструкции по порталу». */
  portalInstructions?: Instruction[];
  /** Папка Google Диска с материалами к инструкциям (кнопка «Google Диск»). */
  instructionsDriveUrl?: string;
  bamapUrl?: string;
  asmapUrl?: string;
  idleRate: number;
  perDiemRate: number;
  rolePermissions?: Record<string, Record<string, string>>;
  moduleOrder: string[];
  customPhrases: string[];
  customPhrasesRoles?: string[];
  drivers?: any[];
  menuStructure?: MenuStructureGroup[];
  mapboxUsage?: {
    count: number;
    limit: number;
    allowExceed: boolean;
    loadsCount?: number;
    loadsLimit?: number;
    allowExceedLoads?: boolean;
    currentMonth: string;
    lastReset?: string;
  };
  notificationAccess?: {
    enabledRoles?: string[];
    configRoles?: string[];
    roleNotificationTypes?: Record<string, string[]>;
    roleAvailableChannels?: Record<string, string[]>;
  };
  /** Верссия сессии. Root-admin инкрементирует её, чтобы принудительно разлогинить ВСЕХ пользователей (force-logout). */
  globalSessionVersion?: number;
}

export interface FerryTemplate {
  id?: string;
  name?: string;
  price?: number;
  from?: string;
  to?: string;
  eur?: number;
  usd?: number;
}

export interface RouteTemplate {
  id?: string;
  name: string;
  globalDir?: string;
  legs: (Omit<Leg, "id"> & {
    from: string;
    to: string;
    distance?: number;
    dist?: number;
    infoCurrency?: string;
    ferrySelectValue?: string;
    customFerryCost?: number;
  })[];
}

export interface DistancePreset {
  id: string;
  from: string;
  to: string;
  distance: number;
  checkpoints?: string[];
  countryFrom?: string;
  countryTo?: string;
  countryGroup?: string;
}

export interface Checkpoint {
  id: string;
  name: string;
  country: string;
  countryFrom?: string;
  countryTo?: string;
  active?: boolean;
}

// ---- AI Audit Agent System ----
export interface AgentAuditConfig {
  enabled: boolean;
  agent1Enabled: boolean;
  agent2Enabled: boolean;
  agent1Interval: string; // e.g. "every week", "every 2 days"
  agent2Interval: string;
  telegramChatId: string;
  lastRunAgent1: number;
  lastRunAgent2: number;
  lastErrorAgent1: string;
  lastErrorAgent2: string;
  cronJobIdAgent1: string;
  cronJobIdAgent2: string;
  suggestionsSentCount: number;
}

export interface AgentAuditRun {
  id: string;
  timestamp: number;
  agent: 'portal' | 'tasks';
  status: 'running' | 'success' | 'error';
  error?: string;
  suggestionsCount: number;
  durationSec: number;
  triggeredBy: 'schedule' | 'manual';
}

export interface AgentSuggestion {
  id: string;
  hash: string; // dedup key
  timestamp: number;
  agent: 'portal' | 'tasks';
  title: string;
  category: string; // portal | tasks | firebase | security | ux-ui | ai
  description: string;
  importance: string;
  solution: string;
  effect: string;
  priority: 'high' | 'medium' | 'low';
  complexity: string;
  sources: string;
  sentToTelegram: boolean;
  sentAt?: number;
  status: 'new' | 'reviewed' | 'accepted' | 'rejected' | 'implemented';
}

export interface CarRateGroup {
  id: string;
  name: string;
  rate: number;
  perDiemRate?: number;
  vehicles: string[];
  comment?: string;
}

// ---- Directories (unified reference data for the whole app) ----
export interface DirectoryBrand {
  key: string;
  name: string;
}
export interface DirectoryDispatcher {
  id: string;
  name: string;
  color?: string;
}
export interface DirectoryRateGroup {
  id: string;
  name: string;
  rate: number;
  perDiemRate?: number | null;
  comment?: string;
}
export interface DirectoryStatusType {
  id: string;
  label: string;
  color?: string;
  category?: "park" | "trip" | "archive";
}
export interface DirectoryDirection {
  id: string;
  label: string;
}

export interface DirectionPreset {
  id: string;
  name: string;
  coeff: number;
}

export interface Driver {
  id: string;
  name: string;
  nameLat?: string;
  lastNameRu?: string;
  firstNameRu?: string;
  middleNameRu?: string;
  lastNameLat?: string;
  firstNameLat?: string;
  middleNameLat?: string;
  shortNameRu?: string;
  shortNameLat?: string;
  phone?: string;
  phones?: Array<{id: string; isPrimary: boolean; number: string}>;
  license?: string;
  licenseNumber?: string;
  passport?: string;
  personalId?: string;
  passportStart?: string;
  passportEnd?: string;
  passportIssued?: string;
  birthDate?: string;
  rateGroupId?: string;
  dispatcher?: string;
  dispatcherName?: string;
  dispatcherId?: string;
  comment?: string;
}

export const DISPATCHER_COLORS_PRESETS = [
  {
    key: "blue",
    name: "Синий",
    bg: "bg-[#EFF6FF] border-blue-200/80",
    darkText: "text-blue-900",
    colorCode: "#3b82f6",
  },
  {
    key: "emerald",
    name: "Изумрудный",
    bg: "bg-[#ECFDF5] border-emerald-300/80",
    darkText: "text-emerald-950",
    colorCode: "#10b981",
  },
  {
    key: "purple",
    name: "Фиолетовый",
    bg: "bg-[#FAF5FF] border-purple-200/80",
    darkText: "text-purple-950",
    colorCode: "#a855f7",
  },
  {
    key: "amber",
    name: "Янтарный",
    bg: "bg-[#FFFBEB] border-amber-200/80",
    darkText: "text-amber-950",
    colorCode: "#f59e0b",
  },
  {
    key: "rose",
    name: "Розовый",
    bg: "bg-[#FFF1F2] border-rose-200/80",
    darkText: "text-rose-950",
    colorCode: "#f43f5e",
  },
  {
    key: "indigo",
    name: "Индиго",
    bg: "bg-[#F5F3FF] border-indigo-200/80",
    darkText: "text-indigo-950",
    colorCode: "#6366f1",
  },
  {
    key: "teal",
    name: "Бирюзовый",
    bg: "bg-[#F0FDFA] border-teal-300/80",
    darkText: "text-teal-950",
    colorCode: "#14b8a6",
  },
  {
    key: "orange",
    name: "Оранжевый",
    bg: "bg-[#FFF7ED] border-orange-200/80",
    darkText: "text-orange-950",
    colorCode: "#f97316",
  },
  {
    key: "slate",
    name: "Серый",
    bg: "bg-[#F8FAFC] border-slate-200/80",
    darkText: "text-slate-900",
    colorCode: "#64748b",
  },
  {
    key: "yellow",
    name: "Желтый",
    bg: "bg-[#FEFCE8] border-yellow-200/80",
    darkText: "text-yellow-950",
    colorCode: "#eab308",
  },
  {
    key: "cyan",
    name: "Голубой",
    bg: "bg-[#ECFEFF] border-cyan-300/80",
    darkText: "text-cyan-950",
    colorCode: "#06b6d4",
  },
  {
    key: "lime",
    name: "Салатовый",
    bg: "bg-[#F7FEE7] border-lime-300/80",
    darkText: "text-lime-950",
    colorCode: "#84cc16",
  },
  {
    key: "fuchsia",
    name: "Фуксия",
    bg: "bg-[#FDF4FF] border-fuchsia-200/80",
    darkText: "text-fuchsia-950",
    colorCode: "#d946ef",
  },
  {
    key: "pink",
    name: "Светло-розовый",
    bg: "bg-[#FDF2F8] border-pink-200/80",
    darkText: "text-pink-950",
    colorCode: "#ec4899",
  },
  {
    key: "red",
    name: "Красный",
    bg: "bg-[#FEF2F2] border-red-200/80",
    darkText: "text-red-950",
    colorCode: "#ef4444",
  },
];

export const allModules = [
  {
    key: "dashboard",
    label: "Главная",
    icon: "LayoutDashboard",
    permissionKey: "dashboard",
  },
  {
    key: "dohod",
    label: "Калькуляция",
    icon: "Calculator",
    permissionKey: "dohod",
  },
  {
    key: "salary",
    label: "Зарплата Водителей",
    icon: "Wallet",
    permissionKey: "salary",
  },
  {
    key: "planDohod",
    label: "План Дохода",
    icon: "TrendingUp",
    permissionKey: "planDohod",
  },
  {
    key: "planZagruzok",
    label: "План Загрузок",
    icon: "FileSpreadsheet",
    permissionKey: "planZagruzok",
  },
  { key: "baza", label: "Учет выезда", icon: "Truck", permissionKey: "baza" },
  {
    key: "dozvola",
    label: "Учет Дозволов",
    icon: "FileText",
    permissionKey: "dozvola",
  },
  {
    key: "disposition",
    label: "Диспозиция",
    icon: "Map",
    permissionKey: "disposition",
  },
  {
    key: "driverExpenses",
    label: "Расходы водителей",
    icon: "Coins",
    permissionKey: "driverExpenses",
  },
  {
    key: "bookIssueRR",
    label: "Книга выдачи РР",
    icon: "BookCheck",
    permissionKey: "bookIssueRR",
  },
  {
    key: "settings",
    label: "Справочники",
    icon: "Settings",
    permissionKey: "settings",
  },
  {
    key: "admin",
    label: "Администрирование",
    icon: "ShieldAlert",
    permissionKey: "admin",
  },
];

/** Запись в ветке `baza` (учёт выезда). Поля опциональны — данные приходят из Firebase. */
export interface BazaRecord {
  id?: string;
  carId?: string | null;
  carNumber?: string;
  brandModel?: string;
  driverId?: string | null;
  driverName?: string;
  driverShortNameRu?: string;
  status?: "base" | "loading" | "repair" | "departure" | "archive";
  dateDeparture?: string;
  [key: string]: unknown;
}

/** Запись сцепки (тягач+прицеп) из ветки `vehicleFleet` / `vehicle_driver_data`. Поля опциональны. */
export interface CouplingRecord {
  id?: string;
  coupling?: string;
  carNumber?: string;
  vehicleNumbers?: string;
  trailerNumber?: string;
  trailerMake?: string;
  brandModel?: string;
  brands?: string;
  brandsRu?: string;
  brand?: string;
  vehicleType?: string;
  year?: string | number;
  dimensions?: string;
  weight?: string | number;
  rate?: number;
  dispatcher?: string;
  dispatcherName?: string;
  dispatcherId?: string;
  driverId?: string;
  driverName?: string;
  driverNameRu?: string;
  driverShortNameRu?: string;
  isLocation?: boolean;
  [key: string]: unknown;
}

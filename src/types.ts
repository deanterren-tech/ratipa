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
  analysis?: "none" | "read" | "write";
  dashboard?: "none" | "read" | "write";
  vehicleDriverData?: "none" | "read" | "write";
  currentPlanning?: "none" | "read" | "write";
  archives?: "none" | "read" | "write";
}

export interface UserProfile {
  uid: string;
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
  driverPhone?: string;
  phone?: string;
  ownerName?: string;
  tariffId?: string;
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
  activeLegIndex: number;
  dispatcher: string;
  driverName?: string;
  currentMonth: string;
  isArchived: boolean;
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

export interface AppSettings {
  googleSheetsId: string;
  googleSheetsUrl: string;
  googleSheetsEmbedUrl: string;
  planZagruzokSheetUrl?: string;
  planZagruzokBlacklistUrl?: string;
  dispositionSheetUrl?: string;
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

export interface CouplingRecord {
  id: string;
  carNumber: string;          // tractor (gos-number)
  trailerNumber?: string;     // trailer (gos-number) — the "coupling"
  brand?: string;             // key -> directories/vehicleBrands
  trailerBrand?: string;      // key -> directories/trailerBrands
  driverId?: string;          // -> driversPool
  driverName?: string;        // denormalized for display
  dispatcher?: string;        // -> directories/dispatchers (id or name)
  rateGroupId?: string;       // -> directories/rateGroups
  status?: string;            // key -> directories/statusTypes
  statusSince?: string;
  comment?: string;
}

export interface DirectionPreset {
  id: string;
  name: string;
  coeff: number;
}

export interface Driver {
  id: string;
  name: string;
  lastNameRu?: string;
  firstNameRu?: string;
  middleNameRu?: string;
  lastNameLat?: string;
  firstNameLat?: string;
  middleNameLat?: string;
  shortNameRu?: string;
  shortNameLat?: string;
  phone?: string;
  license?: string;
  rateGroupId?: string;
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
  {
    key: "analysis",
    label: "Анализ",
    icon: "PieChart",
    permissionKey: "analysis",
  },
];

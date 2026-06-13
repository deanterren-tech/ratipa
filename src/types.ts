export type UserRole = 'root_admin' | 'admin' | 'dispatcher' | 'manager' | 'accountant' | 'viewer';

export interface UserPermissions {
  dohod: 'none' | 'read' | 'write';
  salary: 'none' | 'read' | 'write';
  planDohod: 'none' | 'read' | 'write';
  planZagruzok: 'none' | 'read' | 'write';
  baza: 'none' | 'read' | 'write';
  dozvola: 'none' | 'read' | 'write';
  documentTracking: 'none' | 'read' | 'write';
  disposition: 'none' | 'read' | 'write';
  settings: 'none' | 'read' | 'write';
  admin: 'none' | 'read' | 'write';
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  role: UserRole;
  permissions: UserPermissions;
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
  dateArrival: string;
  dateLoading: string;
  dateRepairStart: string;
  dateRepairEnd: string;
  dateDeparture: string;
  comment: string;
  status: 'base' | 'loading' | 'repair' | 'departure' | 'archive';
  history?: VehicleHistoryItem[];
}

export interface Leg {
  id: string;
  from: string;
  to: string;
  dist?: number;     // legacy field
  distance?: number; // fallback
  freight: number;
  infoRate?: number;
  infoCurrency?: string;
  ferryCost?: number;
  ferryCurrency?: string;
  ferrySelectValue?: string;
  coeff: number;
  direction?: string;
}

export interface RouteCalculation {
  id: string;
  legs: Omit<Leg, 'id'>[]; // legacy doesn't have id on history legs securely
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
}

export interface LegPlan {
  from: string;
  to: string;
  km: number;
  rate: number;
  referenceRate?: string;
  referenceCurrency?: string;
  ferry: number;
  coeff: number;
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
  ferryCost?: number;
  referenceRate?: number;
  referenceCurrency?: 'EUR' | 'USD' | 'RUB' | 'BYN';
  profit: number;
  factKm: number;
  profitFact: number;
  tripNote: string;
  stripColor: string;
  legs: LegPlan[];
  potentialLoads?: PotentialLoad[];
  activeLegIndex: number;
  dispatcher: string;
  currentMonth: string;
  isArchived: boolean;
}

export interface Permit {
  id: string;
  country: string;
  type: string;
  permitNumber: string;
  status: 'available' | 'used' | 'lost' | 'archive';
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
  title: string;
  text: string;
  imageUrl?: string;
  date: string;
  author: string;
  height?: number;
}

export interface QuickLink {
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

export interface AppSettings {
  googleSheetsId: string;
  googleSheetsUrl: string;
  googleSheetsEmbedUrl: string;
  planZagruzokSheetUrl?: string;
  planZagruzokBlacklistUrl?: string;
  dispositionSheetUrl?: string;
  gpsBeltranssputnikUrl?: string;
  gpsWialonUrl?: string;
  gpsEraGlonassUrl?: string;
  currentPlanningTabs?: CurrentPlanningTab[];
  planZagruzokTabs?: PlanZagruzokTab[];
  announcements: Announcement[];
  highlight: HighlightData | null;
  quickLinks: QuickLink[];
  idleRate: number;
  perDiemRate: number;
  moduleOrder: string[];
  customPhrases: string[];
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
  legs: (Omit<Leg, 'id'> & {from: string; to: string; distance?: number; dist?: number; infoCurrency?: string; ferrySelectValue?: string; customFerryCost?: number})[];
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

export interface DirectionPreset {
  id: string;
  name: string;
  coeff: number;
}

export interface Driver {
  id: string;
  name: string;
  phone?: string;
  license?: string;
  rateGroupId?: string;
  comment?: string;
}

export const DISPATCHER_COLORS_PRESETS = [
  { key: 'blue', name: 'Синий', bg: 'bg-[#EFF6FF] border-blue-200/80', darkText: 'text-blue-900', colorCode: '#3b82f6' },
  { key: 'emerald', name: 'Изумрудный', bg: 'bg-[#ECFDF5] border-emerald-300/80', darkText: 'text-emerald-950', colorCode: '#10b981' },
  { key: 'purple', name: 'Фиолетовый', bg: 'bg-[#FAF5FF] border-purple-200/80', darkText: 'text-purple-950', colorCode: '#a855f7' },
  { key: 'amber', name: 'Янтарный', bg: 'bg-[#FFFBEB] border-amber-200/80', darkText: 'text-amber-950', colorCode: '#f59e0b' },
  { key: 'rose', name: 'Розовый', bg: 'bg-[#FFF1F2] border-rose-200/80', darkText: 'text-rose-950', colorCode: '#f43f5e' },
  { key: 'indigo', name: 'Индиго', bg: 'bg-[#F5F3FF] border-indigo-200/80', darkText: 'text-indigo-950', colorCode: '#6366f1' },
  { key: 'teal', name: 'Бирюзовый', bg: 'bg-[#F0FDFA] border-teal-300/80', darkText: 'text-teal-950', colorCode: '#14b8a6' },
  { key: 'orange', name: 'Оранжевый', bg: 'bg-[#FFF7ED] border-orange-200/80', darkText: 'text-orange-950', colorCode: '#f97316' },
  { key: 'slate', name: 'Серый', bg: 'bg-[#F8FAFC] border-slate-200/80', darkText: 'text-slate-900', colorCode: '#64748b' },
  { key: 'yellow', name: 'Желтый', bg: 'bg-[#FEFCE8] border-yellow-200/80', darkText: 'text-yellow-950', colorCode: '#eab308' }
];

export const allModules = [
    { key: 'dashboard', label: 'Главная', icon: 'LayoutDashboard', permissionKey: 'dashboard' },
    { key: 'dohod', label: 'Калькуляция', icon: 'Calculator', permissionKey: 'dohod' },
    { key: 'salary', label: 'Зарплата Водителей', icon: 'Wallet', permissionKey: 'salary' },
    { key: 'planDohod', label: 'План Дохода', icon: 'TrendingUp', permissionKey: 'planDohod' },
    { key: 'planZagruzok', label: 'План Загрузок', icon: 'FileSpreadsheet', permissionKey: 'planZagruzok' },
    { key: 'baza', label: 'Учет выезда', icon: 'Truck', permissionKey: 'baza' },
    { key: 'dozvola', label: 'Учет Дозволов', icon: 'FileText', permissionKey: 'dozvola' },
    { key: 'disposition', label: 'Диспозиция', icon: 'Map', permissionKey: 'disposition' },
    { key: 'settings', label: 'Справочники', icon: 'Settings', permissionKey: 'settings' },
    { key: 'admin', label: 'Администрирование', icon: 'ShieldAlert', permissionKey: 'admin' }
];

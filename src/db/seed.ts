// Seed-константы начальных данных (используются dbService при первом запуске / локальном режиме).
// Вынесено из firebase.ts для уменьшения монолита.
import {
  UserProfile,
  Vehicle,
  TripPlan,
  Permit,
  FerryTemplate,
  DistancePreset,
  CarRateGroup,
  DirectionPreset,
  AppSettings,
} from "../types";

// Seed initial mock user data, matching known administrators (Sergei, Sergei Terez) with password 'ratipa2026'
export const DEFAULT_USERS: UserProfile[] = [
  {
    uid: "sergei-ru-uid-112",
    name: "Сергей",
    email: "sergei.ru@ratipa.com",
    role: "root_admin",
    permissions: {
      dohod: "write",
      salary: "write",
      planDohod: "write",
      planZagruzok: "write",
      baza: "write",
      dozvola: "write",
      documentTracking: "write",
      disposition: "write",
      documents: "write",
      settings: "write",
      admin: "write",
      dashboard: "write",
      vehicleDriverData: "write",

      currentPlanning: "write",
    },
    createdAt: new Date().toISOString(),
  },
];

// Seed other core tables to avoid blank views
export const INITIAL_VEHICLES: Vehicle[] = [
  {
    id: "v1",
    carNumber: "AA1234BB",
    driverName: "Иван Петров",
    dateArrival: "2026-06-08",
    dateLoading: "2026-06-09",
    dateRepairStart: "",
    dateRepairEnd: "",
    dateDeparture: "2026-06-11",
    comment: "Груз готов",
    status: "departure",
  },
  {
    id: "v2",
    carNumber: "EE9876BC",
    driverName: "Сергей Семенов",
    dateArrival: "2026-06-09",
    dateLoading: "",
    dateRepairStart: "2026-06-10",
    dateRepairEnd: "",
    dateDeparture: "",
    comment: "Замена тормозных колодок",
    status: "repair",
  },
  {
    id: "v3",
    carNumber: "HH4567KK",
    driverName: "Дмитрий Козлов",
    dateArrival: "2026-06-10",
    dateLoading: "2026-06-11",
    dateRepairStart: "",
    dateRepairEnd: "",
    dateDeparture: "",
    comment: "Ожидает таможню",
    status: "base",
  },
];

export const INITIAL_TRIPS: TripPlan[] = [
  {
    id: "t1",
    carNumber: "AA1234BB",
    dispatcher: "Aleksey",
    logist: "Василий",
    direction: "BY-PL-DE",
    dateStart: "2026-06-11",
    dateEnd: "2026-06-16",
    days: 5,
    totalKm: 1250,
    totalFreight: 2200,
    totalExpenses: 950,
    extraExpense: 0,
    extraExpenseNote: "",
    profit: 1250,
    factKm: 1250,
    profitFact: 1250,
    tripNote: "Загрузка 20 тонн",
    stripColor: "#10B981",
    legs: [],
    activeLegIndex: 0,
    currentMonth: "June",
    isArchived: false,
  },
  {
    id: "t2",
    carNumber: "HH4567KK",
    dispatcher: "Aleksey",
    logist: "Татьяна",
    direction: "BY-DE-FR",
    dateStart: "2026-06-12",
    dateEnd: "2026-06-18",
    days: 6,
    totalKm: 1850,
    totalFreight: 3100,
    totalExpenses: 1400,
    extraExpense: 0,
    extraExpenseNote: "",
    profit: 1700,
    factKm: 1850,
    profitFact: 1700,
    tripNote: "Сборный рейс",
    stripColor: "#3B82F6",
    legs: [],
    activeLegIndex: 0,
    currentMonth: "June",
    isArchived: false,
  },
];

export const INITIAL_PERMITS: Permit[] = [
  {
    id: "p1",
    country: "Польша",
    type: "Транзит квоты",
    permitNumber: "PL-005691-26",
    status: "available",
    dateIssued: "2026-05-20",
    assignedVehicle: "",
    comments: "Оригинал в офисе",
    history: [],
  },
  {
    id: "p2",
    country: "Германия",
    type: "Двусторонний",
    permitNumber: "DE-883511-26",
    status: "used",
    dateIssued: "2026-06-01",
    assignedVehicle: "AA1234BB",
    comments: "Выдан водителю Иван Петров",
    history: [
      {
        date: "2026-06-01",
        action: "Польша-Германия транзит",
        user: "Aleksey",
      },
    ],
  },
];

export const INITIAL_FERRY_TEMPLATES: FerryTemplate[] = [
  { id: "f1", name: "Liepaja - Travemünde", price: 420 },
  { id: "f2", name: "Klaipeda - Kiel", price: 480 },
  { id: "f3", name: "Ventspils - Nynashamn", price: 310 },
];

export const INITIAL_DISTANCES: DistancePreset[] = [
  { id: "d1", from: "Минск", to: "Варшава", distance: 550 },
  { id: "d2", from: "Варшава", to: "Берлин", distance: 570 },
  { id: "d3", from: "Берлин", to: "Париж", distance: 1050 },
];

export const INITIAL_CARS_POOL: CarRateGroup[] = [
  {
    id: "c1",
    name: "Группа 0.14",
    rate: 0.14,
    vehicles: ["АЕ 5541-7"],
    comment: "",
  },
  {
    id: "c2",
    name: "Группа 0.15",
    rate: 0.15,
    vehicles: ["АЕ 1120-7"],
    comment: "",
  },
];

export const INITIAL_DIRECTIONS: DirectionPreset[] = [
  { id: "dir1", name: "Турция", coeff: 0 },
  { id: "dir2", name: "Китай", coeff: 1.5 },
];

export const INITIAL_SETTINGS: AppSettings = {
  googleSheetsId: "1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM",
  googleSheetsUrl:
    "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit?pli=1&gid=0#gid=0",
  googleSheetsEmbedUrl:
    "https://docs.google.com/spreadsheets/d/e/2PACX-1vT39hGnyX0R0WjE5wV3g_j_iY16A9-q_y9y-H4S3-B87Hdfm4g/pubhtml",
  planZagruzokSheetUrl:
    "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0",
  dispositionSheetUrl:
    "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0",
  googleDriveUrl:
    "https://drive.google.com/drive/folders/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM",
  announcements: [
    {
      id: "a1",
      text: "С 15 июня вводится летнее ограничение на проезд тяжеловозов по южным трассам.",
      date: "2026-06-10",
      author: "Сергей",
      important: true,
    },
    {
      id: "a2",
      text: "База дозволов обновлена, новые бланки по Германии прибыли в отдел логистики.",
      date: "2026-06-09",
      author: "Aleksey",
      important: false,
    },
  ],
  highlight: {
    id: "h1",
    title: "Внимание: Летние ограничения",
    text: "Вводится летнее ограничение на проезд тяжеловозов по южным трассам. Пожалуйста, скорректируйте маршруты.",
    imageUrl:
      "https://images.unsplash.com/photo-1544620347-c4fd6a3d5957?q=80&w=2000&auto=format&fit=crop",
    date: "2026-06-11",
    author: "",
  },
  highlights: [
    {
      id: "h1",
      title: "Внимание: Летние ограничения",
      text: "Вводится летнее ограничение на проезд тяжеловозов по южным трассам. Пожалуйста, скорректируйте маршруты.",
      imageUrl:
        "https://images.unsplash.com/photo-1544620347-c4fd6a3d5957?q=80&w=2000&auto=format&fit=crop",
      date: "2026-06-11",
      author: "",
    },
  ],
  quickLinks: [
    { id: "l1", title: "Таможенные Калькуляторы", url: "https://customs.gov" },
    {
      id: "l2",
      title: "Паромные Расписания DFDS",
      url: "https://www.dfds.com",
    },
  ],
  externalTabs: [],
  idleRate: 30,
  perDiemRate: 7,
  moduleOrder: [
    "dashboard",
    "dohod",
    "salary",
    "planDohod",
    "planZagruzok",
    "currentPlanning",
    "baza",
    "dozvola",
    "disposition",
    "settings",
    "admin",
  ],
  customPhrases: ["Сдал отчетность", "На погрузке", "В пути", "Завершил рейс"],
  mapboxUsage: {
    count: 0,
    limit: 100000,
    allowExceed: false,
    loadsCount: 0,
    loadsLimit: 50000,
    allowExceedLoads: false,
    currentMonth: "2026-07",
    lastReset: "2026-07-05T00:00:00.000Z",
  },
};

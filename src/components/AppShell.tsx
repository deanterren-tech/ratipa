import React, {useState, useEffect, useMemo, useRef, Suspense, lazy} from 'react'
import { UserProfile, AppSettings } from '../types'
import UserAvatar from './UserAvatar'
import TopBarCalendar from './TopBarCalendar'
import { getUserFullName } from '../utils/userName'
import { currencySymbol, currencyName } from '../utils/currencyMeta'
import { APP_VERSION, APP_VERSION_LABEL } from '../version'
import {dbService, useFirebase} from '../api'
import {motion, AnimatePresence} from 'motion/react'
import CommandCenter from './CommandCenter';
import {useKeyboardShortcuts} from '../hooks/useKeyboardShortcuts'
import { resolvePermission } from '../utils/permissions';
import AccountSettingsModal from './AccountSettingsModal'
import ErrorPage from './common/ErrorPage'
import ModuleDataContainer from './common/ModuleLoadState'
import {useNotifications} from '../hooks/useNotifications'
import {useConverter} from '../hooks/useConverter'
import UpdateTour from './UpdateTour'
import PortalInstructionsModal from './PortalInstructionsModal'
import {usePresence} from '../hooks/usePresence'
import {useChat} from '../hooks/useChat'
import { LayoutDashboard, Calculator, Wallet, TrendingUp, FileSpreadsheet, Truck, FileText, Files, Clock, Map, Settings, Settings2, ShieldAlert, LogOut, Menu, X, Radio, MessageSquare, Send, Trash2, Sparkles, ChevronDown, ArrowUp, Pencil, Calendar, Bell, BellRing, Check, CheckCheck, AlertTriangle, Info, LineChart, ExternalLink, Wifi, WifiOff, RefreshCw, Home, Sliders, BookOpen, ClipboardList, DollarSign, BookMarked, Grid3x3 } from 'lucide-react';

// Import newly created business modules
const DashboardModule = lazy(() => import('./modules/DashboardModule'));
const DohodModule = lazy(() => import('./modules/DohodModule'));
const SalaryModule = lazy(() => import('./modules/SalaryModule'));
const PlanDohodModule = lazy(() => import('./modules/PlanDohodModule'));
const PlanZagruzokModule = lazy(() => import('./modules/PlanZagruzokModule'));
const CurrentPlanningModule = lazy(() => import('./modules/CurrentPlanningModule'));
const BazaModule = lazy(() => import('./modules/BazaModule'));
const DozvolaModule = lazy(() => import('./modules/DozvolaModule'));
const DispositionModule = lazy(() => import('./modules/DispositionModule'));
const SettingsModule = lazy(() => import('./modules/SettingsModule'));
const DirectoriesModule = lazy(() => import('./modules/DirectoriesModule'));
const AdminModule = lazy(() => import('./modules/AdminModule'));
const DocumentsModule = lazy(() => import('./modules/DocumentsModule'));
const InstructionsModule = lazy(() => import('./modules/InstructionsModule'));
const VehicleDriverDataModule = lazy(() => import('./modules/VehicleDriverDataModule'));
const BookIssueModule = lazy(() => import('./modules/BookIssueModule'));
const TabelModule = lazy(() => import('./modules/TabelModule'));
const MdpJournalModule = lazy(() => import('./modules/MdpJournalModule'));
const AgentAuditModule = lazy(() => import('./modules/AgentAuditModule'));
const NotFoundPage = lazy(() => import('./common/NotFoundPage'));

const groupIconMap: Record<string, React.ComponentType<any>> = {
  g_home: LayoutDashboard,
  g_planning: Calendar,
  g_calc: Calculator,
  g_salary: Wallet,
  g_veh_drv: Truck,
  g_baza: Truck,
  g_dozvola: FileText,
  g_docs: Files,
  g_disp: Map,
  g_settings: Settings,
  g_appSettings: Settings2,
  g_admin: ShieldAlert,
};

interface AppShellProps {
  user: UserProfile;
  onLogout: () => void;
}

export default function AppShell({ user, onLogout }: AppShellProps) {
  useKeyboardShortcuts();

  const getDefaultModule = () => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      // Модуль — первый сегмент: #dozvola/map → модуль «dozvola», вкладка «map»
      return hash.split('/')[0].split('?')[0];
    }
    const saved = localStorage.getItem('ratipa_last_module');
    if (saved && saved !== 'undefined') {
      return saved;
    }
    return user && user.role === 'mechanic' ? 'baza' : 'dashboard';
  };

  const [activeModule, setActiveModule] = useState<string>(getDefaultModule());
  const [loadedModules, setLoadedModules] = useState<string[]>([getDefaultModule()]);
  const [isCommandCenterOpen, setIsCommandCenterOpen] = useState(false);
  const [offlineMode, setOfflineMode] = useState(() => localStorage.getItem('offline_mode') === 'true');

  const toggleOfflineMode = () => {
    const newVal = !offlineMode;
    setOfflineMode(newVal);
    localStorage.setItem('offline_mode', newVal ? 'true' : 'false');
    window.dispatchEvent(new Event('ratipa-offline-mode-change'));
  };

  useEffect(() => {
    if (activeModule) {
      localStorage.setItem('ratipa_last_module', activeModule);
    }
  }, [activeModule]);

  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) {
        // Подмаршруты модуля (#dozvola/map) не меняют активный модуль
        setActiveModule(hash.split('/')[0].split('?')[0]);
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  useEffect(() => {
    const handleToggleSearch = () => {
      setIsCommandCenterOpen(prev => !prev);
    };
    const handleCloseSearch = () => {
      setIsCommandCenterOpen(false);
    };
    window.addEventListener('ratipa-toggle-search', handleToggleSearch);
    window.addEventListener('ratipa-close-search', handleCloseSearch);
    return () => {
      window.removeEventListener('ratipa-toggle-search', handleToggleSearch);
      window.removeEventListener('ratipa-close-search', handleCloseSearch);
    };
  }, []);

  useEffect(() => {
    setLoadedModules((prev) => {
      if (!prev.includes(activeModule)) {
        return [...prev, activeModule];
      }
      return prev;
    });
  }, [activeModule]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [isContextTarget, setIsContextTarget] = useState<string | null>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);
  const lastOpenedRef = useRef<number>(0);
  const closeTimeoutRef = useRef<any>(null);

  const handleMouseEnterGroup = (groupId: string) => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setOpenDropdownId(groupId);
    lastOpenedRef.current = Date.now();
  };

  const handleMouseLeaveGroup = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
    }
    closeTimeoutRef.current = setTimeout(() => {
      setOpenDropdownId(null);
    }, 200);
  };

  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) clearTimeout(closeTimeoutRef.current);
    };
  }, []);

  // Close navigation dropdown on click outside
  useEffect(() => {
    const handleOutsideClick = () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      setOpenDropdownId(null);
    };
    window.addEventListener('click', handleOutsideClick);
    return () => window.removeEventListener('click', handleOutsideClick);
  }, []);

  // Settings state (used by useNotifications — must be declared before hook calls)
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // --- Extracted logic via custom hooks ---
  const notif = useNotifications(user, settings);
  const conv = useConverter();
  /**
   * Превью обновлений: показывается один раз на пользователя и версию.
   * Факт прохождения хранится в профиле (users_list/{uid}.onboarding.{версия}),
   * поэтому повторный вход и перезагрузка страницы не показывают его снова.
   * Открыть повторно можно из меню пользователя — пункт «Что нового».
   */
  const [tourOpen, setTourOpen] = useState(false);
  /** Подсказки про портал из меню пользователя. */
  const [portalHelpOpen, setPortalHelpOpen] = useState(false);
  /**
   * Ключ версии для хранения в базе: точка в ключах Firebase Realtime Database
   * недопустима («2.0.0» → «2_0_0»), иначе запись молча отклоняется.
   */
  const tourVersionKey = APP_VERSION.replace(/[.#$/\[\]]/g, '_');
  /**
   * Кому вообще показывать превью: только тем, у кого есть рабочая «Главная» —
   * то же условие, что в allowedModules ниже (у механиков навигация ограничена
   * «Учётом выезда», и подсказки про главную, ссылки и разделы им недоступны).
   */
  const tourAvailable = !!user && (
    user.role === 'mechanic'
      ? false
      : user.role === 'root_admin'
        || resolvePermission(user, 'dashboard', settings?.rolePermissions) !== 'none'
  );
  /**
   * Отметка «показано» ставится СРАЗУ при показе, а не только при закрытии:
   * иначе перезагрузка или повторный вход (например, пользователь ушёл, не закрыв окно)
   * показывали превью второй раз.
   *
   * Основное хранилище — профиль (для всех устройств пользователя), страховка —
   * localStorage на случай, если запись в базу не прошла (нет сети, нет прав на запись).
   */
  const tourLocalKey = user?.uid ? `ratipa_tour_seen_${tourVersionKey}_${user.uid}` : '';
  const tourSeenLocal = (() => {
    if (!tourLocalKey) return false;
    try { return window.localStorage.getItem(tourLocalKey) === '1'; } catch { return false; }
  })();
  const tourSeen = !!user?.onboarding?.[tourVersionKey] || tourSeenLocal;
  const [tourShownThisSession, setTourShownThisSession] = useState(false);

  const markTourSeen = (status: 'shown' | 'done' | 'skipped') => {
    if (!user?.uid) return;
    if (tourLocalKey) {
      try { window.localStorage.setItem(tourLocalKey, '1'); } catch { /* приватный режим — не критично */ }
    }
    dbService.saveUserOnboarding(user.uid, tourVersionKey, status);
  };
  useEffect(() => {
    if (tourShownThisSession || tourSeen || !user?.uid || !tourAvailable) return;
    let cancelled = false;
    let attempts = 0;
    // Показываем после загрузки данных: ждём, пока рабочая область перестанет грузиться
    const tryShow = () => {
      if (cancelled) return;
      const busy = !!document.querySelector('[data-module-loading]');
      if (!busy || attempts >= 6) {
        setTourShownThisSession(true);
        setTourOpen(true);
        // отмечаем факт показа сразу — повторная загрузка страницы не покажет превью снова
        markTourSeen('shown');
        return;
      }
      attempts += 1;
      window.setTimeout(tryShow, 900);
    };
    const timer = window.setTimeout(tryShow, 1600);
    return () => { cancelled = true; window.clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, tourSeen, tourShownThisSession, tourVersionKey, tourAvailable]);

  const closeTour = (reason: 'done' | 'skipped') => {
    setTourOpen(false);
    markTourSeen(reason);
  };
  const presence = usePresence(user, activeModule);
  useChat(user);

  const {
    filteredNotifications,
    unreadNotifsCount,
    isNotifOpen,
    setIsNotifOpen,
    notifTab,
    setNotifTab,
    notifRef,
    activeUnreadBroadcasts,
    markNotifAsRead,
    markAllNotifsAsRead,
    deleteNotif,
    clearAllNotifications,
  } = notif;

  const {
    isConverterOpen,
    setIsConverterOpen,
    isEditingCurrencies,
    setIsEditingCurrencies,
    isRatesLoading,
    activeCurrency,
    setActiveCurrency,
    activeValue,
    setActiveValue,
    selectedCurrencyCodes,
    setSelectedCurrencyCodes,
    rates,
    displayValues,
    converterRef,
    converterDesktopRef,
    converterPanelRef,
    fetchNbrbRates,
    ratesUpdatedAt,
    ratesError,
    availableCurrencies,
  } = conv;

  const {
    isDbOnline,
    onlineUsers,
  } = presence;

  // Dynamic page title
  useEffect(() => {
    const activeObj = allModules.find(m => m.key === activeModule);
    if (activeObj) {
      document.title = `Ratipa | ${activeObj.label}`;
    } else {
      document.title = 'Ratipa';
    }
  }, [activeModule]);

  // Scroll to top
  const mainScrollRef = useRef<HTMLDivElement>(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 300);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeModule]);

  /**
   * Профили пользователей — тот же источник (users_list), что и в топ-баре, меню и
   * настройках. Блок онлайна показывает настроенные фотографию или цветную иконку,
   * отдельного набора аватаров и цветов для него нет.
   */
  const [profiles, setProfiles] = useState<UserProfile[]>([]);

  // Живая подписка на профили: смена фотографии или цвета сразу видна в онлайне,
  // вручную задавать аватар заново не нужно.
  useEffect(() => {
    const unsubscribe = dbService.getUsers((list) => setProfiles(list || []));
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  /** Профиль для записи онлайна: по uid, при отсутствии — по имени. */
  const profileFor = (online: any): UserProfile | undefined => {
    const uid = String(online?.uid || '');
    if (uid) {
      const byUid = profiles.find((p) => p.uid === uid);
      if (byUid) return byUid;
    }
    const name = String(online?.name || '').trim();
    return name ? profiles.find((p) => getUserFullName(p).trim() === name) : undefined;
  };

  // Меню пользователя и окно настроек учётной записи
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);

  const handleLogoutSequence = () => {
    dbService.logAction(user.name, user.role, "Выход", "Auth", user.uid, "Вышел из учетной записи");
    onLogout();
  };

  // Escape закрывает меню пользователя
  useEffect(() => {
    if (!isUserMenuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsUserMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isUserMenuOpen]);

  /**
   * Положение окна конвертера: раскрывается СЛЕВА от своей кнопки в топ-баре.
   * Кнопок две (для узких и для широких экранов), поэтому берём ту, что видна,
   * замеряем её прямоугольник и ставим панель так, чтобы её правый край был
   * на 8 px левее кнопки. На узких экранах положение ограничивается отступом
   * 12 px от края — окно не вылезает за экран.
   */
  const [converterPos, setConverterPos] = useState<{ right: number; top: number } | null>(null);
  useEffect(() => {
    if (!isConverterOpen) return;
    const measure = () => {
      const buttons = [converterRef.current, converterDesktopRef.current]
        .map((wrap) => (wrap ? wrap.querySelector('button') : null))
        .filter((btn): btn is HTMLButtonElement => !!btn && btn.getBoundingClientRect().width > 0);
      const btn = buttons[0];
      if (!btn) return;
      const r = btn.getBoundingClientRect();
      const vw = window.innerWidth;
      const panelW = Math.min(376, vw - 24);
      const right = Math.max(12, Math.min(vw - r.left + 8, vw - 12 - panelW));
      // Верх — заведомо ниже топ-бара: берём максимум из низа кнопки и низа шапки
      const header = document.querySelector('header');
      const headerBottom = header ? Math.round(header.getBoundingClientRect().bottom) : 0;
      const top = Math.max(Math.round(r.bottom) + 8, headerBottom + 8);
      setConverterPos({ right, top });
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConverterOpen]);

  // Close notifications, converter and mobile menu dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
      const isConverterClick = 
        (converterRef.current && converterRef.current.contains(event.target as Node)) ||
        (converterDesktopRef.current && converterDesktopRef.current.contains(event.target as Node)) ||
        (converterPanelRef.current && converterPanelRef.current.contains(event.target as Node));
      if (!isConverterClick) {
        setIsConverterOpen(false);
      }
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(event.target as Node)) {
        setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // List of possible modules
  const allModules = [
    { key: 'dashboard', label: 'Главная', icon: LayoutDashboard, permissionKey: 'dashboard' },
    { key: 'dohod', label: 'Калькуляция', icon: Calculator, permissionKey: 'dohod' },
    { key: 'salary', label: 'Зарплата Водителей', icon: Wallet, permissionKey: 'salary' },
    { key: 'planDohod', label: 'План Дохода', icon: TrendingUp, permissionKey: 'planDohod' },
    { key: 'planZagruzok', label: 'План Загрузок', icon: FileSpreadsheet, permissionKey: 'planZagruzok' },
    { key: 'currentPlanning', label: 'Текущее планирование', icon: Calendar, permissionKey: 'currentPlanning' },
    { key: 'baza', label: 'Учет выезда', icon: Truck, permissionKey: 'baza' },
    { key: 'vehicleDriverData', label: 'Авто и Водители', icon: FileText, permissionKey: 'vehicleDriverData' },
    { key: 'dozvola', label: 'Учет Дозволов', icon: FileText, permissionKey: 'dozvola' },
    { key: 'documents', label: 'Документы', icon: Files, permissionKey: 'documents' },
  { key: 'instructions', label: 'Инструкции', icon: BookMarked, permissionKey: 'instructions' },
    { key: 'disposition', label: 'Диспозиция', icon: Map, permissionKey: 'disposition' },
    { key: 'appSettings', label: 'Справочники', icon: Settings2, permissionKey: 'settings' },
    { key: 'settings', label: 'База данных', icon: BookOpen, permissionKey: 'settings' },
    { key: 'bookIssue', label: 'Книга выдачи', icon: BookOpen, permissionKey: 'bookIssue' },
    { key: 'tabel', label: 'Табель', icon: ClipboardList, permissionKey: 'bookIssue' },
    { key: 'mdpJournal', label: 'Журнал МДП', icon: FileText, permissionKey: 'bookIssue' },
    { key: 'agentAudit', label: 'AI-аудиторы', icon: Sparkles, permissionKey: 'admin' },
    { key: 'admin', label: 'Администрирование', icon: ShieldAlert, permissionKey: 'admin' }
  ];

  const allowedModules = useMemo(() => {
    if (user.role === 'mechanic') {
      return allModules.filter(mod => mod.key === 'baza');
    }
    return allModules.filter(mod => {
      // Доступ root — только по роли. Проверки по имени и почте убраны:
    // это обход модели разрешений (владелец и так имеет роль root_admin).
    if (user.role === 'root_admin') return true;
      return resolvePermission(user, mod.permissionKey, settings?.rolePermissions) !== 'none';
    });
  }, [user.role, user.name, user.email, user.permissions, settings?.rolePermissions]);

  useEffect(() => {
    return dbService.getSettings(setSettings);
  }, []);

  // Ошибки маршрута. Раньше неизвестный адрес молча подменялся первым доступным
  // разделом, и пользователь не понимал, опечатка это или отсутствие прав.
  // Теперь: маршрут неизвестен → 404, раздел закрыт для роли → 403.
  // Автоматического перехода нет, поэтому цикл редиректов невозможен.
  const [routeError, setRouteError] = useState<403 | 404 | null>(null);
  const SYSTEM_MODULE_KEYS = ['dashboard', 'settings', 'appSettings', 'admin'];
  useEffect(() => {
    if (!activeModule) { setRouteError(null); return; }
    const knownKeys = [...allModules.map(m => m.key), ...SYSTEM_MODULE_KEYS];
    if (!knownKeys.includes(activeModule)) { setRouteError(404); return; }
    if (!allowedModules.some((m: any) => m.key === activeModule)) { setRouteError(403); return; }
    setRouteError(null);
  }, [activeModule, allowedModules]);

  const navModules = useMemo(() => {
    const modules = [...allowedModules];
    if (settings && settings.moduleOrder) {
       modules.sort((a,b) => {
         const orderA = settings.moduleOrder.indexOf(a.key);
         const orderB = settings.moduleOrder.indexOf(b.key);
         const idxA = orderA === -1 ? 99 : orderA;
         const idxB = orderB === -1 ? 99 : orderB;
         return idxA - idxB;
       });
    }
    return modules;
  }, [allowedModules, settings]);

  const menuGroups = useMemo(() => {
    if (settings && settings.menuStructure && settings.menuStructure.length > 0) {
      return settings.menuStructure.map((g: any) => {
        if (g.subtabKeys) {
          return { ...g, subtabKeys: g.subtabKeys.map((k: string) => k === 'settings' ? 'appSettings' : k) };
        }
        return g;
      });
    }
    return [
      { id: 'g_home', label: 'Главная', isDropdown: false, singleModuleKey: 'dashboard' },
      { id: 'g_ops', label: 'Текущее', isDropdown: true, subtabKeys: ['disposition', 'baza', 'documents', 'vehicleDriverData', 'dozvola', 'instructions'] },
      { id: 'g_planning', label: 'Планирование', isDropdown: true, subtabKeys: ['planZagruzok', 'planDohod', 'currentPlanning', 'dohod'] },
      { id: 'g_report', label: 'Отчетность', isDropdown: true, subtabKeys: ['salary', 'bookIssue', 'tabel', 'mdpJournal'] },
      { id: 'g_settings', label: 'Настройки', isDropdown: true, subtabKeys: ['settings', 'appSettings', 'admin'] }
    ];
  }, [settings]);

  const getSubtabLabel = (group: any, subtabKey: string) => {
    if (group.customLabels && group.customLabels[subtabKey]) {
      return group.customLabels[subtabKey];
    }
    const found = allModules.find(m => m.key === subtabKey);
    return found ? found.label : subtabKey;
  };

  const getAllowedSubtabs = (group: any) => {
    if (!group.subtabKeys) return [];
    return group.subtabKeys.filter((subtabKey: string) => {
      if (subtabKey === 'dashboard') return false;
      return allowedModules.some(m => m.key === subtabKey);
    });
  };

  const isGroupVisible = (group: any) => {
    if (group.singleModuleKey === 'dashboard') return false;
    if (group.isDropdown) {
      const allowed = getAllowedSubtabs(group);
      return allowed.length > 0;
    } else {
      if (!group.singleModuleKey) return false;
      return allowedModules.some(m => m.key === group.singleModuleKey);
    }
  };

  const handleNavigate = (moduleKey: string) => {
    window.location.hash = moduleKey;
    setActiveModule(moduleKey);
    setIsSidebarOpen(false);
  };

  const renderModuleByKey = (key: string) => {
    switch (key) {
      case 'dashboard':
        return <DashboardModule user={user} onNavigate={handleNavigate} />;
      case 'currentPlanning':
        return <CurrentPlanningModule user={user} />;
      case 'dohod':
        return <DohodModule user={user} />;
      case 'salary':
        return <SalaryModule user={user} />;
      case 'planDohod':
        return <PlanDohodModule user={user} />;
      case 'planZagruzok':
        return <PlanZagruzokModule user={user} />;
      case 'baza':
        return <BazaModule user={user} settings={settings} />;
      case 'vehicleDriverData':
        return <VehicleDriverDataModule user={user} />;
      case 'dozvola':
        return <DozvolaModule user={user} />;
      case 'documents':
        return <DocumentsModule user={user} />;
      case 'instructions':
        return <InstructionsModule user={user} settings={settings} />;
      case 'disposition':
        return <DispositionModule user={user} />;
      case 'settings':
        return <DirectoriesModule user={user} />;
      case 'appSettings':
        return <SettingsModule user={user} />;
      case 'admin':
        return <AdminModule user={user} />;
      case 'bookIssue':
        return <BookIssueModule user={user} settings={settings} />;
      case 'tabel':
        return <TabelModule user={user} settings={settings} />;
      case 'mdpJournal':
        return <MdpJournalModule user={user} settings={settings} />;
      case 'agentAudit':
        return <AgentAuditModule user={user} />;
      default:
        return <NotFoundPage onNavigate={handleNavigate} />;
    }
  };

  const activeModuleMeta = allModules.find(m => m.key === activeModule);

  return (
    <div className={`min-h-screen ${activeModule === "admin" ? "bg-transparent" : "bg-slate-50"} flex flex-col font-sans transition-all duration-300`}>
      {!useFirebase && (
        <div className="bg-amber-500 text-white text-[11px] font-bold text-center py-1 px-3">
          ⚠ Офлайн-режим: данные сохраняются только локально на этом устройстве и не синхронизируются с сервером.
        </div>
      )}

      {/* Modern Responsive Capsule Header */}
<header className="relative bg-white text-[#121316] border-b border-[#E5E7EB] h-14 md:h-[3.75rem] flex items-center justify-between px-3 sm:px-5 lg:px-6 shrink-0 sticky top-0 z-50 select-none gap-2 sm:gap-3">
        
        {/* На узких экранах: конвертер валют и календарь рядом */}
        <div className="md:hidden flex items-center gap-2 shrink-0">
          <div className="relative font-sans" ref={converterRef}>
            <button
              type="button"
              onClick={() => setIsConverterOpen(!isConverterOpen)}
              aria-haspopup="dialog"
              aria-expanded={isConverterOpen}
              aria-label="Конвертер валют"
              className={`relative h-8 w-8 shrink-0 rounded-lg border transition-colors cursor-pointer flex items-center justify-center select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] active:scale-[0.98] ${
                isConverterOpen
                  ? 'text-[var(--accent-ink)] bg-[var(--accent-10)] hover:bg-[var(--accent-15)] border-[var(--accent-25)]'
                  : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:bg-[#F3F4F6] hover:text-[#121316] hover:border-[#D1D5DB]'
              }`}
              title="Конвертер валют"
            >
              <DollarSign size={15} strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>
          <TopBarCalendar />
        </div>

        {/* Mobile: логотип строго по центру экрана (absolute, вне flex-потока) */}
        <div className="md:hidden absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 pointer-events-none">
          <div className="flex items-center gap-2.5 cursor-pointer group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] pointer-events-auto"
               tabIndex={0} role="button"
               onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNavigate(user.role === 'mechanic' ? 'baza' : 'dashboard'); } }}
               onClick={() => handleNavigate(user.role === 'mechanic' ? 'baza' : 'dashboard')}>
            <img
              src="/portal.svg"
              alt="Ratipa Portal"
              width={1261}
              height={385}
              className="h-6 w-auto shrink-0 select-none opacity-90 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
              draggable={false}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-5 flex-1 min-w-0">
          {/* Left Brand Area */}
          <div className="flex items-center shrink-0 flex-1 md:flex-none justify-center md:justify-start">
            
            <div className="hidden md:flex items-center gap-2.5 cursor-pointer group rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]" tabIndex={0} role="button"
                 onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNavigate(user.role === 'mechanic' ? 'baza' : 'dashboard'); } }}
                 onClick={() => handleNavigate(user.role === 'mechanic' ? 'baza' : 'dashboard')}>
              {/* Полный фирменный логотип (portal.svg). Пропорции сохранены:
                  1261×385 ≈ 3,28:1 — высота задаётся, ширина считается сама. */}
              <img
                src="/portal.svg"
                alt="Ratipa Portal"
                width={1261}
                height={385}
                className="h-6 md:h-7 w-auto shrink-0 select-none opacity-90 transition-opacity duration-300 ease-out group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none"
                draggable={false}
              />
              {activeModule !== 'dashboard' && (
                <>
                  <span className="text-[#D1D5DB] hidden md:inline select-none">/</span>
                  <span className="text-xs font-medium text-[#6B7280] hidden md:inline">
                    {activeModuleMeta ? activeModuleMeta.label : 'Главная'}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Navigation Menu */}
          <nav className="hidden md:flex items-center gap-0.5 overflow-x-auto lg:overflow-visible whitespace-nowrap scrollbar-none max-w-[50vw] sm:max-w-[70vw] lg:max-w-none flex-nowrap shrink relative" aria-label="Разделы портала">
          {menuGroups.filter(isGroupVisible).map((group) => {
            const GroupIcon = groupIconMap[group.id] || Calendar;
            if (group.isDropdown) {
              const allowedSubtabs = getAllowedSubtabs(group);
              const isChildActive = allowedSubtabs.includes(activeModule);
              const isOpen = openDropdownId === group.id;
              
              return (
                <div
                  key={group.id}
                  className="relative inline-block"
                  onMouseEnter={() => handleMouseEnterGroup(group.id)}
                  onMouseLeave={handleMouseLeaveGroup}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const now = Date.now();
                      if (now - lastOpenedRef.current < 300) {
                        return;
                      }
                      setOpenDropdownId(isOpen ? null : group.id);
                    }}
                    className={`h-8 px-3 rounded-lg text-[11px] tracking-tight flex items-center gap-1.5 cursor-pointer shrink-0 select-none border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                      isChildActive
                        ? 'text-[var(--accent-ink)] bg-[var(--accent-10)] border-[var(--accent-25)] font-semibold'
                        : 'text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] border-transparent font-medium'
                    }`}
                  >
                    <GroupIcon className={`h-3 w-3 ${isChildActive ? 'text-[var(--accent-ink)]' : 'text-[#9CA3AF]'}`} />
                    <span>{group.label}</span>
                    <ChevronDown className={`h-3 w-3 ${isChildActive ? 'text-[var(--accent-ink)]' : 'text-[#9CA3AF]'} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {isOpen && (
                    <div className="absolute left-0 top-full pt-1.5 min-w-[200px] z-50">
                      <div className="bg-white border border-[#E5E7EB] rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] py-1.5 animate-in fade-in slide-in-from-top-1 duration-150">
                        {allowedSubtabs.map((subKey) => {
                          const subLabel = getSubtabLabel(group, subKey);
                          const isActive = activeModule === subKey;
                          const foundSub = allModules.find(m => m.key === subKey);
                          const SubIcon = foundSub?.icon || Calendar;
                          return (
                            <a
                              key={subKey}
                              href={`#${subKey}`}
                              onClick={(e) => {
                                if (!e.metaKey && !e.ctrlKey) {
                                  e.preventDefault();
                                  handleNavigate(subKey);
                                  setOpenDropdownId(null);
                                }
                              }}
                              className={`flex items-center gap-2.5 h-9 px-3 mx-1.5 text-[11px] tracking-tight leading-snug rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                                isActive
                                  ? 'bg-[var(--accent-10)] text-[var(--accent-ink)] font-semibold'
                                  : 'text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#121316] font-medium'
                              }`}
                            >
                              <SubIcon className={`h-3.5 w-3.5 ${isActive ? 'text-[var(--accent-ink)]' : 'text-[#9CA3AF]'}`} />
                              <span className="flex-1">{subLabel}</span>
                            </a>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              );
            } else {
              const itemKey = group.singleModuleKey!;
              const foundModule = allModules.find(m => m.key === itemKey);
              if (!foundModule) return null;
              const isActive = activeModule === itemKey;
              const displayLabel = group.customLabels && group.customLabels[itemKey] ? group.customLabels[itemKey] : group.label;
              const ItemIcon = foundModule.icon || Calendar;
              
              return (
                <a
                  key={group.id}
                  href={`#${itemKey}`}
                  onClick={(e) => {
                    if (!e.metaKey && !e.ctrlKey) {
                      e.preventDefault();
                      handleNavigate(itemKey);
                    }
                  }}
                  className={`h-8 px-3 rounded-lg text-[11px] tracking-tight flex items-center gap-1.5 relative cursor-pointer shrink-0 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                    isActive
                      ? 'text-[var(--accent-ink)] bg-[var(--accent-10)] border-[var(--accent-25)] font-semibold'
                      : 'text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] border-transparent font-medium'
                  }`}
                >
                  <ItemIcon className={`h-3 w-3 ${isActive ? 'text-[var(--accent-ink)]' : 'text-[#9CA3AF]'}`} />
                  <span>{displayLabel}</span>
                </a>
              );
            }
          })}
          
          {settings?.externalTabs?.map((extTab) => (
            <a
              key={extTab.id}
              href={extTab.url}
              target="_blank"
              rel="noopener noreferrer"
              className="h-8 px-3 rounded-lg text-[11px] tracking-tight font-medium text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] flex items-center gap-1.5 border border-transparent transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
            >
              <ExternalLink className="h-3 w-3 text-[#9CA3AF]" />
              <span>{extTab.title}</span>
            </a>
          ))}
        </nav>
        </div>

        {/* Right Section: Avatars, Sync state + Profile badge + Logout */}
        <div className="flex items-center gap-1.5 md:gap-3 shrink-0">
          
          {/* Avatar overlap stack */}
          <div className="hidden md:flex items-center -space-x-2 mr-1 relative group cursor-pointer">
            {onlineUsers.slice(0, 3).map((u) => {
               // Тот же аватар и тот же профиль, что и в остальных местах портала:
               // фотография, если выбрана, иначе настроенная цветная иконка.
               const profile = profileFor(u);
               const label = getUserFullName(profile || u);
               return (
                 <UserAvatar
                   key={u.presenceId}
                   name={label}
                   firstName={profile?.firstName}
                   lastName={profile?.lastName}
                   color={profile?.color}
                   photo={profile?.avatarPhoto}
                   size={28}
                   title={label}
                   className="border-2 border-white"
                 />
               )
            })}
            {onlineUsers.length > 3 && (
               <div className="h-7 w-7 rounded-full bg-[var(--accent-solid)] border-2 border-white flex items-center justify-center text-[10px] font-semibold text-[var(--accent-on)]">
                 +{onlineUsers.length - 3}
               </div>
            )}
            
            {/* Hover Popover with full user list */}
            {onlineUsers.length > 0 && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-[#E5E7EB] rounded-xl p-3 shadow-[0_8px_24px_rgba(15,23,42,0.12)] opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-opacity z-50">
                <span className="text-[10px] font-semibold text-[#6B7280] tracking-wider uppercase mb-2 block">Пользователи онлайн</span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                  {onlineUsers.map(u => (
                    <div key={u.presenceId} className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] shrink-0"></span>
                       <UserAvatar
                         name={getUserFullName(profileFor(u) || u)}
                         firstName={profileFor(u)?.firstName ?? (u as any).firstName}
                         lastName={profileFor(u)?.lastName ?? (u as any).lastName}
                         color={profileFor(u)?.color}
                         photo={profileFor(u)?.avatarPhoto}
                         size={20}
                         textClassName="text-[9px]"
                       />
                       <span className="text-[11px] tracking-tight font-medium text-[#121316] truncate" title={`${getUserFullName(profileFor(u) || u)} (${u.role})`}>{getUserFullName(profileFor(u) || u)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Конвертер валют и календарь (широкие экраны) — одна пара, общий шаг 8 px */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <div className="relative font-sans" ref={converterDesktopRef}>
              <button
                type="button"
                onClick={() => setIsConverterOpen(!isConverterOpen)}
                aria-haspopup="dialog"
                aria-expanded={isConverterOpen}
                aria-label="Конвертер валют"
                className={`relative h-8 w-8 shrink-0 rounded-lg border transition-colors cursor-pointer flex items-center justify-center select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] active:scale-[0.98] ${
                  isConverterOpen
                    ? 'text-[var(--accent-ink)] bg-[var(--accent-10)] hover:bg-[var(--accent-15)] border-[var(--accent-25)]'
                    : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:bg-[#F3F4F6] hover:text-[#121316] hover:border-[#D1D5DB]'
                }`}
                title="Конвертер валют"
              >
                <DollarSign size={15} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
            <TopBarCalendar />
          </div>

          {/* Fully featured Notifications Center dropdown */}

          {/* Live indicator badge */}
          {/* User Badge Profile info */}
          {/* Меню пользователя: имя, аватар и инициалы открывают список действий */}
          <div className="relative" ref={userMenuRef}>
            <button
              type="button"
              onClick={() => setIsUserMenuOpen((v) => !v)}
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              aria-controls="user-menu"
              title="Меню пользователя"
              /* Наведение — как у пунктов основного меню: та же плашка #F3F4F6,
                 прозрачная рамка, rounded-lg и transition-colors, без свечения и бордера */
              className="group flex items-center gap-2 h-9 pl-1 pr-1.5 sm:pr-2.5 rounded-lg border border-transparent hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
            >
              <UserAvatar firstName={user.firstName} lastName={user.lastName} name={getUserFullName(user)} color={user.color} photo={user.avatarPhoto} size={28} />
              <span className="hidden xl:block text-left leading-tight min-w-0">
                <span className="block text-xs font-medium text-[#121316] tracking-tight truncate max-w-[140px]">{getUserFullName(user)}</span>
                <span className="block text-[10px] font-medium text-[#6B7280] group-hover:text-[#121316] transition-colors">
                  {user.role === 'root_admin' ? 'Админ' : 'Сотрудник'}
                </span>
              </span>
              <ChevronDown className={`hidden xl:block h-3.5 w-3.5 text-[#9CA3AF] transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {isUserMenuOpen && (
              <div
                id="user-menu"
                role="menu"
                aria-label="Меню пользователя"
                className="absolute right-0 top-full mt-1.5 w-64 bg-white border border-[#E5E7EB] rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] py-1.5 z-[1200]"
              >
                {/* Данные пользователя — только для чтения.
                    Почта здесь не показывается: адрес остаётся в профиле и в админке. */}
                <div className="px-3 py-3 border-b border-[#F3F4F6]">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar firstName={user.firstName} lastName={user.lastName} name={getUserFullName(user)} color={user.color} photo={user.avatarPhoto} size={36} textClassName="text-xs" />
                    <div className="min-w-0">
                      <div className="text-[11px] tracking-tight font-semibold text-[#121316] truncate">{getUserFullName(user)}</div>
                      <div className="text-[10px] text-[#6B7280] truncate">
                        {user.role === 'root_admin' ? 'Разработчик (Root)' : user.role === 'admin' ? 'Администратор' : 'Сотрудник'}
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setIsUserMenuOpen(false); setIsAccountOpen(true); }}
                  className="w-full flex items-center gap-2.5 h-9 px-3 text-[11px] tracking-tight font-medium text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#121316] transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:bg-[#F3F4F6]"
                >
                  <Settings className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
                  Настройки учётной записи
                </button>

                {/* Повторно открыть знакомство с обновлениями */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setIsUserMenuOpen(false); setTourShownThisSession(true); setTourOpen(true); }}
                  className="w-full flex items-center gap-2.5 h-9 px-3 text-[11px] tracking-tight font-medium text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#121316] transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:bg-[#F3F4F6]"
                >
                  <Sparkles className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
                  Что нового
                </button>

                {/* Подсказки по работе с порталом */}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setIsUserMenuOpen(false); setPortalHelpOpen(true); }}
                  className="w-full flex items-center gap-2.5 h-9 px-3 text-[11px] tracking-tight font-medium text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#121316] transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:bg-[#F3F4F6]"
                >
                  <BookMarked className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
                  Инструкции по порталу
                </button>

                <div className="my-1.5 h-px bg-[#F3F4F6]" />

                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setIsUserMenuOpen(false); handleLogoutSequence(); }}
                  className="w-full flex items-center gap-2.5 h-9 px-3 text-[11px] tracking-tight font-medium text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:bg-rose-50"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Выйти из системы
                </button>

                {/* Версия приложения — единый источник: package.json */}
                <div className="mt-1 pt-2 border-t border-[#F3F4F6] px-3 pb-1.5">
                  <span className="text-[10px] font-medium text-[#9CA3AF] tabular-nums">{APP_VERSION_LABEL}</span>
                </div>
              </div>
            )}
          </div>

        </div>

      {/* Настройки учётной записи */}
      <AccountSettingsModal
        isOpen={isAccountOpen}
        user={user}
        onClose={() => setIsAccountOpen(false)}
      />

      {/* Превью обновлений: знакомство с изменениями при первом входе после
          обновления. Про акцентную тему рассказываем только как о личной
          настройке из настроек учётной записи. */}
      <PortalInstructionsModal
        isOpen={portalHelpOpen}
        settings={settings}
        onClose={() => setPortalHelpOpen(false)}
      />

      <UpdateTour
        isOpen={tourOpen}
        accentAvailable={!!user?.uid}
        linksCount={Array.isArray(settings?.quickLinks) ? settings!.quickLinks.filter((l) => l && l.url).length : 0}
        canSeeVehicles={user.role !== 'mechanic' && (user.role === 'root_admin' || resolvePermission(user, 'vehicleDriverData', settings?.rolePermissions) !== 'none')}
        onClose={closeTour}
      />

      {/* Converter Panel — окно раскрывается слева от своей кнопки в топ-баре:
          правый край панели на 8 px левее кнопки, верх — под топ-баром.
          Положение считается по фактическому прямоугольнику видимой кнопки
          (кнопок две: для узких и широких экранов) и пересчитывается при
          изменении размера окна. На узких экранах окно ограничено отступом
          12 px от краёв и не выходит за пределы экрана.
          Расчёты полностью в useConverter: панель только показывает displayValues
          и передаёт ввод пользователя. Ничего, что меняет результат само по себе. */}
            <AnimatePresence>
              {isConverterOpen && (
                <motion.div
                  ref={converterPanelRef}
                  initial={{ opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  role="dialog"
                  aria-label="Конвертер валют"
                  style={{
                    right: converterPos ? converterPos.right : 12,
                    top: converterPos ? converterPos.top : 76,
                  }}
                  className="fixed w-[376px] max-w-[calc(100vw-1.5rem)] max-h-[calc(100vh-120px)] overflow-y-auto bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_16px_40px_rgba(15,23,42,0.16)] z-[2000]"
                >
                  {/* Заголовок: знак валюты, название, источник курса и действия */}
                  <div className="flex items-center gap-3 px-4 py-4 border-b border-[#E5E7EB] select-none">
                    <span className="w-9 h-9 rounded-xl bg-[var(--accent-8)] border border-[var(--accent-20)] text-[var(--accent-ink)] flex items-center justify-center shrink-0">
                      <DollarSign size={16} strokeWidth={1.5} aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-semibold text-[#121316] tracking-tight">Конвертер валют</h3>
                      <p className="text-[11px] text-[#6B7280] mt-0.5 truncate">
                        {isEditingCurrencies
                          ? 'Отметьте валюты для списка'
                          : `Курсы НБРБ${ratesUpdatedAt ? ` · обновлено ${ratesUpdatedAt}` : ''}`}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setIsEditingCurrencies(!isEditingCurrencies); }}
                        title="Выбор валют"
                        aria-label="Выбор валют"
                        aria-pressed={isEditingCurrencies}
                        className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] active:scale-[0.98] ${
                          isEditingCurrencies
                            ? 'bg-[var(--accent-10)] text-[var(--accent-ink)] border-[var(--accent-25)] hover:bg-[var(--accent-15)]'
                            : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:bg-[#F3F4F6] hover:text-[#121316] hover:border-[#D1D5DB]'
                        }`}
                      >
                        <Sliders size={14} strokeWidth={1.5} aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); fetchNbrbRates(); }}
                        disabled={isRatesLoading}
                        title="Обновить курсы из НБРБ"
                        aria-label="Обновить курсы из НБРБ"
                        className="h-8 w-8 rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#121316] hover:border-[#D1D5DB] flex items-center justify-center transition-colors cursor-pointer active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                      >
                        <RefreshCw size={14} strokeWidth={1.5} className={isRatesLoading ? 'animate-spin' : ''} aria-hidden="true" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setIsConverterOpen(false); }}
                        title="Закрыть"
                        aria-label="Закрыть конвертер"
                        className="h-8 w-8 rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#121316] hover:border-[#D1D5DB] flex items-center justify-center transition-colors cursor-pointer active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                      >
                        <X size={14} strokeWidth={1.5} aria-hidden="true" />
                      </button>
                    </div>
                  </div>

                  {isEditingCurrencies ? (
                    /* Выбор валют: отмечаемые строки, минимум одна остаётся */
                    <div className="px-4 py-4">
                      <div className="flex items-center justify-between px-0.5 mb-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Валюты в списке</span>
                        <button
                          type="button"
                          onClick={() => setIsEditingCurrencies(false)}
                          className="text-[11px] font-semibold uppercase tracking-wider text-[var(--accent-ink)] hover:underline cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                        >
                          Готово
                        </button>
                      </div>
                      {ratesError && (
                        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 mb-2 text-[11px] leading-snug text-rose-700">
                          <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0 mt-px" aria-hidden="true" />
                          <span>{ratesError}</span>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1.5 max-h-[300px] overflow-y-auto custom-scrollbar pr-1" role="group" aria-label="Валюты в списке">
                        {(availableCurrencies.length > 0 ? availableCurrencies : [
                          { id: "1", code: "USD" }, { id: "2", code: "EUR" }, { id: "3", code: "RUB" },
                          { id: "4", code: "BYN" }, { id: "5", code: "TRY" }, { id: "6", code: "KZT" }, { id: "7", code: "CNY" }
                        ]).map(curr => {
                          const isSelected = selectedCurrencyCodes.includes(curr.code);
                          const isLastOne = isSelected && selectedCurrencyCodes.length === 1;
                          return (
                            <button
                              key={curr.code}
                              type="button"
                              role="checkbox"
                              aria-checked={isSelected}
                              aria-disabled={isLastOne || undefined}
                              title={isLastOne ? 'В списке должна остаться хотя бы одна валюта' : `${currencyName(curr.code)}`}
                              onClick={() => {
                                // Правило прежнее: последнюю валюту убрать нельзя
                                if (isSelected) {
                                  if (selectedCurrencyCodes.length > 1) {
                                    setSelectedCurrencyCodes(prev => prev.filter(c => c !== curr.code));
                                  }
                                } else {
                                  setSelectedCurrencyCodes(prev => [...prev, curr.code]);
                                }
                              }}
                              className={`flex items-center gap-2 h-9 px-2.5 rounded-lg border text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                                isSelected
                                  ? 'bg-[var(--accent-8)] border-[var(--accent-25)] text-[var(--accent-ink)] font-semibold'
                                  : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F3F4F6] hover:text-[#121316]'
                              } ${isLastOne ? 'opacity-70' : ''}`}
                            >
                              <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                                isSelected ? 'bg-[var(--accent-solid)] border-[var(--accent-solid)]' : 'bg-white border-[#D1D5DB]'
                              }`}>
                                {isSelected && <Check size={11} className="text-[var(--accent-on)]" aria-hidden="true" />}
                              </span>
                              <span className="text-[11px] font-semibold tabular-nums shrink-0">{curr.code}</span>
                              <span className={`text-[10px] truncate ${isSelected ? 'text-[#4B5563]' : 'text-[#9CA3AF]'}`}>
                                {currencyName(curr.code)}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    /* Значения: поле редактируемой валюты выделено, остальные пересчитаны */
                    <div className="px-4 py-4 space-y-2 max-h-[62vh] md:max-h-[430px] overflow-y-auto custom-scrollbar">
                      {ratesError && (
                        <div role="alert" className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2.5 text-[11px] leading-snug text-rose-700">
                          <AlertTriangle size={14} strokeWidth={1.5} className="shrink-0 mt-px" aria-hidden="true" />
                          <span>{ratesError}</span>
                        </div>
                      )}
                      {selectedCurrencyCodes.map(code => {
                        const isActive = activeCurrency === code;
                        const rate = rates[code];
                        const symbol = currencySymbol(code);
                        const value = displayValues[code] ?? '';
                        return (
                          <div
                            key={code}
                            className={`rounded-xl border p-2.5 transition-colors ${
                              isActive
                                ? 'border-[var(--accent-30)] bg-[var(--accent-5)]'
                                : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[12px] font-bold shrink-0 transition-colors ${
                                  isActive
                                    ? 'bg-[var(--accent-solid)] text-[var(--accent-on)]'
                                    : 'bg-[#F3F4F6] text-[#4B5563]'
                                }`}>
                                  {symbol}
                                </span>
                                <span className="text-[11px] font-medium text-[#4B5563] truncate">{currencyName(code)}</span>
                                <span className="text-[10px] font-semibold text-[#9CA3AF] tabular-nums shrink-0">{code}</span>
                              </div>
                              <span className="text-[11px] text-[#9CA3AF] font-mono tabular-nums shrink-0">
                                {code === 'BYN' ? 'базовая' : (rate ? `1 ${code} = ${Number(rate).toFixed(4)} BYN` : '—')}
                              </span>
                            </div>
                            <div className="relative flex items-center">
                              <input
                                type="text"
                                inputMode="decimal"
                                value={value}
                                onChange={(e) => { setActiveCurrency(code); setActiveValue(e.target.value.replace(',', '.')); }}
                                aria-label={`Сумма в ${code}`}
                                placeholder="0.00"
                                className={`w-full h-10 pl-3 pr-10 rounded-xl border bg-white text-base font-semibold tabular-nums text-[#121316] placeholder:text-[#D1D5DB] transition-colors focus:outline-none ${
                                  isActive
                                    ? 'border-[var(--accent-ui)] ring-2 ring-[var(--accent-30)]'
                                    : 'border-[#E5E7EB] hover:border-[#D1D5DB] focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)]'
                                }`}
                              />
                              {value !== '' && (
                                <button
                                  type="button"
                                  onClick={() => { setActiveCurrency(code); setActiveValue(''); }}
                                  title={`Очистить сумму в ${code}`}
                                  aria-label={`Очистить сумму в ${code}`}
                                  className="absolute right-1.5 h-8 w-8 rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                                >
                                  <X size={13} strokeWidth={1.5} aria-hidden="true" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Подвал: что редактируется сейчас и откуда курсы */}
                  <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-[#E5E7EB] select-none">
                    <span className="text-[11px] text-[#6B7280] truncate">
                      {isEditingCurrencies ? (
                        'В списке одна валюта останется всегда'
                      ) : (
                        <>Редактируется: <span className="font-semibold text-[var(--accent-ink)] tabular-nums">{activeCurrency}</span></>
                      )}
                    </span>
                    <span className="text-[11px] text-[#9CA3AF] shrink-0">Источник: НБРБ</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
      </header>

      {/* Main Container workspace */}
      <div className="flex-1 flex relative w-full max-w-full overflow-hidden">

        {/* Dynamic active viewport card frame */}
        <main 
          ref={mainScrollRef} 
          className={`flex-1 w-full max-w-full relative pb-52 md:pb-0 ${
                      activeModule === 'dashboard' 
                        ? 'p-0 bg-[#F9FAFB] overflow-hidden' 
                        : activeModule === 'admin'
                        ? 'p-3 sm:p-4 lg:p-6 bg-[#F9FAFB] overflow-y-auto overflow-x-hidden'
                        : 'p-3 sm:p-4 lg:p-6 overflow-y-auto overflow-x-hidden bg-[#F9FAFB]'
                    }`}
        >
          {/* Ошибка маршрута: 404 — адрес неизвестен, 403 — раздел закрыт для роли.
              Шапка остаётся на месте, чтобы пользователь мог уйти по навигации. */}
          {routeError && (
            <ErrorPage
              code={routeError}
              onHome={() => { window.location.hash = '#dashboard'; setActiveModule('dashboard'); }}
              onBack={() => window.history.back()}
            />
          )}
          {!routeError && allModules.map((mod) => {
            const isSystemModule = ['dashboard', 'settings', 'appSettings', 'admin'].includes(mod.key);
            const isAllowed = isSystemModule
              ? true
              : (user.role === 'mechanic' ? (mod.key === 'baza') : (user.role === 'root_admin' || resolvePermission(user, mod.permissionKey, settings?.rolePermissions) !== 'none'));
            if (!isAllowed) return null;

            const isActive = activeModule === mod.key;
            if (!isActive && !loadedModules.includes(mod.key)) return null;
            // Индикатор загрузки данных раздела: пока не получен первый ответ базы,
            // рабочая область закрыта брендовым индикатором — пустая таблица не видна.
            // Шапка и навигация портала остаются видимыми.
            return (
              <ModuleDataContainer key={mod.key} moduleKey={mod.key} isActive={isActive}>
                <motion.div
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: isActive ? 1 : 0, y: isActive ? 0 : 3 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="h-full"
                >
                  <Suspense fallback={null}>
                    {renderModuleByKey(mod.key)}
                  </Suspense>
                </motion.div>
              </ModuleDataContainer>
            );
          })}
        </main>

      </div>

      {/* Scroll to Top Button */}
      {showScrollTop && (
        <button
          onClick={() => {
            mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="fixed right-4 bottom-20 md:bottom-6 z-[1000] flex items-center justify-center w-11 h-11 bg-[#121316] text-[#70FC8E] hover:bg-[#121316] transition-colors select-none cursor-pointer rounded-full shadow-lg active:scale-95"
          title="Наверх"
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
        </button>
      )}

      {/* Chat widget removed per request — data now flows via portal modules */}

      {/* Real-time Broadcast Push Notifications — blocking modal */}
      {activeUnreadBroadcasts.length > 0 && (
        <AnimatePresence>
          {activeUnreadBroadcasts.map((notif, notifIdx) => (
            <motion.div data-scroll-lock="modal"
              key={notif.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[9999] bg-[#121316]/80 backdrop-blur-sm flex items-center justify-center p-4"
              style={{ zIndex: 10000 + notifIdx }}
            >
              <motion.div
                initial={{ scale: 0.9, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                exit={{ scale: 0.95, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="bg-[#121316] text-white rounded-xl border border-slate-700/60 shadow-[0_20px_80px_rgba(0,0,0,0.6)] p-6 sm:p-8 w-full max-w-lg relative overflow-hidden flex flex-col gap-4"
              >
                {/* Highlight bar */}
                <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#70FC8E]" />

                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-[#121316] border border-slate-700 rounded-xl text-[#70FC8E]">
                      <BellRing className="h-5 w-5" />
                    </div>
                    <div>
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-[#70FC8E] block">
                        Важное Распоряжение
                      </span>
                      <span className="text-[10px] text-[#9CA3AF] font-mono">
                        от {notif.createdBy} • {new Date(notif.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                  </div>
                </div>

                <h3 className="text-base font-semibold text-white leading-snug">
                  Внимание!
                </h3>

                <p className="text-sm text-[#F3F4F6] font-medium leading-relaxed whitespace-pre-wrap select-text max-h-[40vh] overflow-y-auto custom-scrollbar">
                  {notif.text}
                </p>

                <div className="bg-[#121316]/60 border border-slate-700/40 rounded-xl px-3.5 py-2.5 text-[10px] text-[#9CA3AF] font-medium">
                  Для продолжения работы с порталом подтвердите, что вы ознакомились с уведомлением
                </div>

                <button
                  onClick={() => dbService.markBroadcastNotificationAsRead(notif.id, user.uid, user.name)}
                  className="w-full mt-1 py-3 px-4 bg-[#70FC8E] hover:bg-[#5be277] active:scale-[0.99] text-[#121316] font-semibold text-xs uppercase tracking-widest rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-center gap-2 shadow-lg"
                >
                  <Check className="h-4 w-4" strokeWidth={3} />
                  Подтвердить прочтение
                </button>
              </motion.div>
            </motion.div>
          ))}
        </AnimatePresence>
      )}

      {/* === Mobile Floating Nav с крупной активной капсулой === */}
            <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-end justify-center pb-0 safe-bottom pointer-events-none select-none"
                 style={{paddingBottom: 'calc(0.5rem + env(safe-area-inset-bottom, 0px))'}}>
              <div className="mx-1.5 bg-white/70 backdrop-blur-[14px] border border-white/30 rounded-[32px] shadow-[0_4px_24px_rgba(0,0,0,0.08)] flex items-stretch justify-around overflow-hidden w-full pointer-events-auto">
                {[
                  { key: 'dashboard', label: 'Главная', icon: LayoutDashboard },
                  { key: 'planZagruzok', label: 'Загрузки', icon: FileSpreadsheet },
                  { key: 'disposition', label: 'Карта', icon: Map },
                  { key: 'baza', label: 'Выезд', icon: Truck },
                  { key: '__menu', label: 'Ещё', icon: Grid3x3, isMenu: true },
                ].map((item) => {
                  const Icon = item.icon;
                  const active = item.isMenu ? isMobileMenuOpen : activeModule === item.key;
                  return (
                    <button
                      key={item.key}
                      onClick={() => {
                        if (item.isMenu) {
                          setIsMobileMenuOpen(!isMobileMenuOpen);
                        } else {
                          setIsMobileMenuOpen(false);
                          handleNavigate(item.key);
                        }
                      }}
                      onContextMenu={(e) => {
                        if (!item.isMenu) {
                          e.preventDefault();
                          setIsContextTarget(item.key);
                          setIsContextMenuOpen(true);
                        }
                      }}
                      className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2.5 min-h-[60px] transition-all duration-200 relative outline-none ${
                        active
                          ? 'text-white bg-[#3765F6] mx-1 my-2 rounded-2xl shadow-md'
                          : 'text-[#6B7280] hover:text-[#4B5563] bg-transparent'
                      }`}
                    >
                      <Icon className={`h-5 w-5 ${active ? 'stroke-[2.5] fill-white' : 'stroke-[1.5] fill-none text-[#6B7280]'}`} />
                      <span className={`text-[9px] leading-tight text-center ${active ? 'font-semibold' : 'font-medium'}`}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>

      {/* === Context Menu (right-click) === */}
      {isContextMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[60] bg-transparent" onClick={() => setIsContextMenuOpen(false)}>
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 w-56 bg-[rgba(255,255,255,0.65)] backdrop-blur-[18px] border border-[rgba(229,229,229,0.15)] rounded-2xl shadow-[0_8px_32px_rgba(0,0,0,0.12)] overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] border-b border-[rgba(229,229,229,0.15)]">
              {isContextTarget ? (allModules.find(m => m.key === isContextTarget)?.label || 'Действия') : 'Действия'}
            </div>
            <div className="space-y-0.5 p-1">
              <button
                onClick={() => { setIsContextMenuOpen(false); setIsMobileMenuOpen(false); if (isContextTarget) handleNavigate(isContextTarget); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-[#121316] hover:bg-[rgba(0,0,0,0.04)] transition-colors cursor-pointer text-left rounded-lg"
              >
                <ExternalLink className="h-4 w-4" /> Открыть раздел
              </button>
              <button
                onClick={() => { setIsContextMenuOpen(false); setIsMobileMenuOpen(true); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-[#121316] hover:bg-[rgba(0,0,0,0.04)] transition-colors cursor-pointer text-left rounded-lg"
              >
                <Grid3x3 className="h-4 w-4" /> Все инструменты
              </button>
              <button
                onClick={() => { setIsContextMenuOpen(false); window.location.reload(); }}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 text-xs font-medium text-[#6B7280] hover:bg-[rgba(0,0,0,0.04)] transition-colors cursor-pointer text-left rounded-lg"
              >
                <RefreshCw className="h-4 w-4" /> Обновить страницу
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === Mobile Все инструменты — grouped list === */}
            {isMobileMenuOpen && (
              <div data-scroll-lock="modal" className="md:hidden fixed inset-0 z-40 bg-black/20 backdrop-blur-[3px] motion-safe"
                   onClick={() => setIsMobileMenuOpen(false)}>
                <div ref={mobileMenuRef}
                     className="flex items-end justify-center px-3 pb-2 min-h-full"
                     onClick={(e) => e.stopPropagation()}>
                  <motion.div
                    initial={{ y: 40, opacity: 0, scale: 0.96 }}
                    animate={{ y: 0, opacity: 1, scale: 1 }}
                    transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                    className="w-full bg-white border border-slate-200/40 shadow-[0_8px_30px_rgba(0,0,0,0.08)] rounded-2xl flex flex-col max-h-[80vh]"
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {/* Header — всегда видим */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 shrink-0">
                      <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-2">
                        <Grid3x3 className="w-4 h-4" /> Все инструменты
                      </span>
                      <button onClick={() => setIsMobileMenuOpen(false)}
                              className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition cursor-pointer rounded-xl">
                        <X className="w-5 h-5" />
                      </button>
                    </div>

                    {/* Content — scrollable */}
                    <div className="overflow-y-auto flex-1 px-4 py-3 custom-scrollbar space-y-3"
                         style={{ WebkitOverflowScrolling: 'touch' }}>
                      {(() => {
                        const menuGroups = [
                          { id: 'g_ops', label: 'Текущее', icon: Map,
                            items: ['disposition', 'baza', 'documents', 'vehicleDriverData', 'dozvola', 'instructions'] },
                          { id: 'g_planning', label: 'Планирование', icon: Calendar,
                            items: ['planZagruzok', 'planDohod', 'currentPlanning', 'dohod'] },
                          { id: 'g_report', label: 'Отчетность', icon: Wallet,
                            items: ['salary', 'bookIssue', 'tabel', 'mdpJournal'] },
                          { id: 'g_settings', label: 'Настройки', icon: Settings2,
                            items: ['settings', 'appSettings', 'admin', 'agentAudit'] },
                        ];

                        const visibleGroups = menuGroups
                          .map((g) => ({ ...g, allowedItems: g.items.filter((k) => allowedModules.some((m: any) => m.key === k)) }))
                          .filter((g) => g.allowedItems.length > 0);

                        return visibleGroups.map((group) => {
                          // Иконка группы — из локального списка выше (компонент lucide),
                          // каст не нужен: типы выводятся из литерала menuGroups.
                          const GroupIcon = group.icon;
                          return (
                            <div key={group.id}>
                              {/* Заголовок группы */}
                              <div className="flex items-center gap-2 px-2 py-1.5 mb-1.5">
                                <GroupIcon className="w-3.5 h-3.5 text-slate-400" />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{group.label}</span>
                              </div>

                              {/* Пункты группы */}
                              <div className="bg-slate-50/40 rounded-xl overflow-hidden divide-y divide-slate-100/60 border border-slate-200/20">
                                {group.allowedItems.map((key) => {
                                  const mod = allModules.find((m) => m.key === key);
                                  if (!mod) return null;
                                  const Icon = mod.icon || Calendar;
                                  const isActive = activeModule === key;
                                  return (
                                    <button
                                      key={key}
                                      onClick={() => { setIsMobileMenuOpen(false); handleNavigate(key); }}
                                      onContextMenu={(e) => {
                                        e.preventDefault();
                                        setIsContextTarget(key);
                                        setIsContextMenuOpen(true);
                                        setIsMobileMenuOpen(false);
                                      }}
                                      className={`w-full flex items-center gap-3 px-3 py-2.5 min-h-[44px] text-left transition-all duration-100 cursor-pointer ${
                                        isActive
                                          ? 'bg-[#3765F6]/10 text-slate-900 font-semibold'
                                          : 'bg-transparent text-slate-700 hover:bg-slate-100/60 font-medium'
                                      }`}
                                    >
                                      <Icon className={`h-5 w-5 ${isActive ? 'stroke-[2] fill-[#3765F6]' : 'stroke-[1.2] fill-none text-slate-500'}`} />
                                      <span className="flex-1 text-xs">{mod.label}</span>
                                      {isActive && (
                                        <span className="w-1.5 h-1.5 rounded-full bg-[#3765F6] shrink-0" />
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        });
                      })()}

                      {/* Нижние кнопки: Обновить + Учётная запись */}
                      <div className="flex flex-wrap gap-2.5 pt-3 border-t border-slate-100">
                        <button
                          onClick={() => window.location.reload()}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100/50 hover:bg-slate-200/40 transition-colors text-slate-600 font-medium text-xs min-h-[44px] cursor-pointer"
                        >
                          <RefreshCw className="h-4 w-4" /> Обновить
                        </button>
                        <button
                          onClick={() => { setIsMobileMenuOpen(false); setIsAccountOpen(true); }}
                          className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-100/50 hover:bg-slate-200/40 transition-colors text-slate-600 font-medium text-xs min-h-[44px] cursor-pointer"
                        >
                          <Settings className="h-4 w-4" /> Учётная запись
                        </button>
                      </div>

                      {/* Версия */}
                      <div className="text-center py-0.5">
                        <span className="text-[10px] font-medium text-slate-400 tabular-nums">{APP_VERSION_LABEL}</span>
                      </div>
                    </div>
                  </motion.div>
                </div>
              </div>
            )}

      <CommandCenter 
        user={user} 
        isOpen={isCommandCenterOpen} 
        onClose={() => setIsCommandCenterOpen(false)} 
        onNavigate={handleNavigate} 
      />
    </div>
  );
}
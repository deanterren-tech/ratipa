import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { UserProfile, AppSettings, ChatMessage } from '../types';
import { dbService, database, useFirebase, onValue } from '../firebase';
import { ref, set, push, update, remove } from 'firebase/database';
import { motion, AnimatePresence } from 'motion/react';
import CommandCenter from './CommandCenter';
import TypingText from './TypingText';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { 
  LayoutDashboard, 
  Calculator, 
  Wallet, 
  TrendingUp, 
  FileSpreadsheet, 
  Truck, 
  FileText, 
  Files,
  Clock, 
  Map,
  Settings, 
  ShieldAlert, 
  LogOut, 
  Menu, 
  X, 
  Radio,
  MessageSquare,
  Send,
  Trash2,
  Sparkles,
  ChevronDown,
  ArrowUp,
  Pencil,
  Calendar,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  AlertTriangle,
  Info,
  LineChart,
  ExternalLink,
  Wifi,
  WifiOff,
  DollarSign,
  RefreshCw,
  Sliders,
  BookOpen
} from 'lucide-react';

interface NotificationItem {
  id: string;
  title: string;
  text: string;
  type: 'info' | 'warning' | 'success' | 'alert';
  date: string;
  isRead: boolean;
  dispatcher?: string;
  isDeleted?: boolean;
  targetRoles?: string[];
}

const defaultNotifications: NotificationItem[] = [
  {
    id: 'notif_1',
    title: '🛠️ Ремонт закончен — BY 1982 MH',
    text: 'Тягач BY 1982 MH (водитель Козлов) успешно прошел ремонт осей SAF. Готов к рейсу! Диспетчер: Алексей. Нужно грузить!',
    type: 'success',
    date: '13.06.2026 10:15',
    isRead: false,
    dispatcher: 'Алексей'
  },
  {
    id: 'notif_2',
    title: '📦 Срок готовности — BY 8812 AM',
    text: 'Машина должна быть готова к 15.06.2026. Подходит дата готовности — необходимо планировать погрузку! Диспетчер: Татьяна.',
    type: 'warning',
    date: '12.06.2026 18:40',
    isRead: false,
    dispatcher: 'Татьяна'
  }
];

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
const AdminModule = lazy(() => import('./modules/AdminModule'));
const DocumentsModule = lazy(() => import('./modules/DocumentsModule'));
const VehicleDriverDataModule = lazy(() => import('./modules/VehicleDriverDataModule'));
const AnalysisModule = lazy(() => import('./modules/AnalysisModule'));

const groupIconMap: Record<string, React.ComponentType<any>> = {
  g_home: LayoutDashboard,
  g_planning: Calendar,
  g_calc: Calculator,
  g_salary: Wallet,
  g_veh_drv: Truck,
  g_analysis: TrendingUp,
  g_baza: Truck,
  g_dozvola: FileText,
  g_docs: Files,
  g_disp: Map,
  g_settings: Settings,
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
      return hash;
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
        setActiveModule(hash);
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
    }, 200); // 200ms grace period prevents accidental closures
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
  const [isDbOnline, setIsDbOnline] = useState(false);
  const [onlineUsers, setOnlineUsers] = useState<any[]>([]);

  // Real-time broadcast push notifications state & sync
  const [broadcastNotifications, setBroadcastNotifications] = useState<any[]>([]);

  useEffect(() => {
    return dbService.getBroadcastNotifications(setBroadcastNotifications);
  }, []);

  const activeUnreadBroadcasts = useMemo(() => {
    if (!user) return [];
    return broadcastNotifications.filter(notif => {
      const readBy = notif.readBy || {};
      return !readBy[user.uid];
    });
  }, [broadcastNotifications, user]);

  // Notifications states
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [userNotifState, setUserNotifState] = useState<Record<string, {isRead: boolean, isDeleted: boolean}>>({});
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [notifTab, setNotifTab] = useState<'all' | 'unread'>('all');
  const notifRef = useRef<HTMLDivElement>(null);

  // Converter states
  const [isConverterOpen, setIsConverterOpen] = useState(false);
  const [isEditingCurrencies, setIsEditingCurrencies] = useState(false);
  const [isRatesLoading, setIsRatesLoading] = useState(false);
  const [activeCurrency, setActiveCurrency] = useState<string>('USD');
  const [activeValue, setActiveValue] = useState<string>('100');
  const [availableCurrencies, setAvailableCurrencies] = useState<any[]>([]);
  
  const [selectedCurrencyCodes, setSelectedCurrencyCodes] = useState<string[]>(() => {
    const saved = localStorage.getItem('ratipa_selected_currencies');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      } catch (e) {}
    }
    return ['USD', 'EUR', 'BYN', 'RUB'];
  });

  const [rates, setRates] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('ratipa_converter_rates');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      USD: 3.25,
      EUR: 3.55,
      RUB: 0.036,
      BYN: 1.0,
      TRY: 0.10,
      KZT: 0.0073,
      CNY: 0.45
    };
  });
  const converterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return dbService.getCurrencies((list) => {
      setAvailableCurrencies(list || []);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('ratipa_selected_currencies', JSON.stringify(selectedCurrencyCodes));
  }, [selectedCurrencyCodes]);

  const fetchNbrbRates = async () => {
    setIsRatesLoading(true);
    try {
      // Try the server-side API proxy first to bypass client CORS / VPN / network issues
      let response = await fetch('/api/nbrb-rates');
      const contentType = response.headers.get('content-type') || '';
      
      if (!response.ok || !contentType.includes('application/json')) {
        console.log('NBRB rates info: fallback loaded.');
        response = await fetch('https://www.nbrb.by/api/exrates/rates?periodicity=0');
      }
      
      if (!response.ok) throw new Error('Data status check');
      const data = await response.json();
      
      if (Array.isArray(data)) {
        const foundRates: Record<string, number> = { BYN: 1.0 };
        data.forEach((item: any) => {
          if (item && item.Cur_Abbreviation && item.Cur_OfficialRate && item.Cur_Scale) {
            foundRates[item.Cur_Abbreviation] = item.Cur_OfficialRate / item.Cur_Scale;
          }
        });

        if (foundRates.USD && foundRates.EUR && foundRates.RUB) {
          setRates(prev => {
            const merged = { ...prev, ...foundRates };
            localStorage.setItem('ratipa_converter_rates', JSON.stringify(merged));
            return merged;
          });
        }
      } else {
        throw new Error('Expected data structure');
      }
    } catch (error) {
      console.log('NBRB rates info: rates initialization completed.');
    } finally {
      setIsRatesLoading(false);
    }
  };

  useEffect(() => {
    fetchNbrbRates();
  }, []);

  const getDisplayValue = (currency: string) => {
    if (activeCurrency === currency) {
      return activeValue;
    }
    const numericVal = parseFloat(activeValue);
    if (isNaN(numericVal) || numericVal === 0) {
      return '';
    }
    const fromRate = rates[activeCurrency] || 1.0;
    const toRate = rates[currency] || 1.0;
    const valInByn = numericVal * fromRate;
    const targetVal = valInByn / toRate;
    if (currency === 'RUB') {
      return targetVal.toFixed(1);
    }
    return targetVal.toFixed(2);
  };

  // Real-time Database references for notification auto-generation
  const [bazaCars, setBazaCars] = useState<any[]>([]);
  const [tripsDashboard, setTripsDashboard] = useState<any[]>([]);

  // Close notifications, converter and mobile menu dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
      if (converterRef.current && !converterRef.current.contains(event.target as Node)) {
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

  // Sync notifications from Firebase Realtime Database
  useEffect(() => {
    if (!useFirebase || !user) return;
    try {
      const notifRef = ref(database, 'ratipa_notifications');
      const unsubNotif = onValue(notifRef, snap => {
        const val = snap.val();
        if (val) {
          const list: NotificationItem[] = Object.keys(val).map(key => ({
            id: key,
            ...val[key]
          }));
          
          list.sort((a, b) => {
            const tA = a.id.startsWith('notif_') ? parseInt(a.id.replace('notif_', '')) : (a.id.includes('_') ? parseInt(a.id.split('_').slice(-1)[0]) || 0 : 0);
            const tB = b.id.startsWith('notif_') ? parseInt(b.id.replace('notif_', '')) : (b.id.includes('_') ? parseInt(b.id.split('_').slice(-1)[0]) || 0 : 0);
            if (tA && tB) return tB - tA;
            const dateA = a.date || '';
            const dateB = b.date || '';
            return dateB.localeCompare(dateA);
          });
          
          setNotifications(list);
        } else {
          setNotifications([]);
        }
      });
      
      const userNotifRef = ref(database, `users/${user.uid}/notificationStates`);
      const unsubUserNotif = onValue(userNotifRef, snap => {
        setUserNotifState(snap.val() || {});
      });

      return () => {
        unsubNotif();
        unsubUserNotif();
      }
    } catch (e) {
      console.warn("Error subscribing to ratipa_notifications in Firebase", e);
    }
  }, [useFirebase, user]);

  // Subscribe to baza_cars and trips_dashboard
  useEffect(() => {
    if (!useFirebase) return;
    try {
      const unsubBaza = onValue(ref(database, 'baza_cars'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setBazaCars(list);
      });
      const unsubTrips = onValue(ref(database, 'trips_dashboard'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setTripsDashboard(list);
      });
      return () => {
        unsubBaza();
        unsubTrips();
      };
    } catch (e) {
      console.warn("Error subscribing in AppShell notification updater:", e);
    }
  }, [useFirebase]);

  const markNotifAsRead = (id: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (useFirebase && user) {
      try {
        const currentReadState = userNotifState[id]?.isRead || false;
        update(ref(database, `users/${user.uid}/notificationStates/${id}`), { isRead: !currentReadState });
      } catch (err) {
        console.warn("Failed to mark read in firebase", err);
      }
    }
  };

  const markAllNotifsAsRead = () => {
    if (useFirebase && user) {
      try {
        const updates: Record<string, any> = {};
        notifications.forEach(n => {
          if (!userNotifState[n.id]?.isRead && !userNotifState[n.id]?.isDeleted) {
            updates[`users/${user.uid}/notificationStates/${n.id}/isRead`] = true;
          }
        });
        if (Object.keys(updates).length > 0) {
          update(ref(database), updates);
        }
      } catch (err) {
        console.warn("Failed to mark all read in firebase", err);
      }
    }
  };

  const deleteNotif = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (useFirebase && user) {
      try {
        update(ref(database, `users/${user.uid}/notificationStates/${id}`), { isDeleted: true });
      } catch (err) {
        console.warn("Failed to mark deleted in firebase", err);
      }
    }
  };

  const clearAllNotifications = () => {
    if (useFirebase && user) {
      try {
        const updates: Record<string, any> = {};
        notifications.forEach(n => {
          updates[`users/${user.uid}/notificationStates/${n.id}/isDeleted`] = true;
        });
        if (Object.keys(updates).length > 0) {
          update(ref(database), updates);
        }
      } catch (err) {
        console.warn("Failed to clear notifications in firebase", err);
      }
    }
  };

  // Dynamic Webpage Tab title
  useEffect(() => {
    const activeObj = allModules.find(m => m.key === activeModule);
    if (activeObj) {
      document.title = `Ratipa | ${activeObj.label}`;
    } else {
      document.title = 'Ratipa';
    }
  }, [activeModule]);

  // Scroll to Top states
  const mainScrollRef = useRef<HTMLDivElement>(null);

  // Chat states
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [unreadCount, setUnreadCount] = useState(0);
  const [lastOpenedTime, setLastOpenedTime] = useState<number>(() => {
    return Number(localStorage.getItem('chat_last_opened_time') || Date.now());
  });
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // States for user colors and message editing
  const [usersForColors, setUsersForColors] = useState<UserProfile[]>([]);
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  // Subscribe to all users to map message colors in real time
  useEffect(() => {
    const unsub = dbService.getUsers((users) => {
      setUsersForColors(users);
    });
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  const handleUpdateMessage = (id: string) => {
    const text = editingText.trim();
    if (!text) return;
    dbService.updateChatMessage(id, text);
    setEditingMsgId(null);
    setEditingText('');
  };

  // Subscribe to global dispatcher chat
  useEffect(() => {
    const unsubscribeChat = dbService.getChatMessages('global_panel_chat', (msgs) => {
      const sorted = [...msgs].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
      setChatMessages(sorted);
    });

    return () => {
      if (typeof unsubscribeChat === 'function') {
         unsubscribeChat();
      }
    };
  }, []);

  // Set up global hotkeys (chat removed per request — ESC now only closes modals via useKeyboardShortcuts)
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Alt + C previously toggled chat — removed.
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, []);

  // Track unread messages
  useEffect(() => {
    if (isChatOpen) {
      const now = Date.now();
      setLastOpenedTime(now);
      localStorage.setItem('chat_last_opened_time', String(now));
      setUnreadCount(0);
    } else {
      const unread = chatMessages.filter(m => m.timestamp > lastOpenedTime && m.userId !== user.uid).length;
      setUnreadCount(unread);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatMessages, isChatOpen, user.uid]);

  // Scroll to bottom
  useEffect(() => {
    if (isChatOpen) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [chatMessages, isChatOpen]);

  const handleSendGlobalMessage = () => {
    const text = chatInput.trim();
    if (!text) return;

    dbService.sendChatMessage('global_panel_chat', text, user.name, user.uid);
    setChatInput('');
  };

  const handleDeleteGlobalMessage = (id: string, e: React.MouseEvent) => {
    console.log("Delete message", id);
    e.stopPropagation();
    dbService.deleteChatMessage(id);
  };

  // Presence & Heartbeat ticker
  useEffect(() => {
    const cleanup = dbService.trackPresence(user, activeModule);
    setIsDbOnline(dbService.isOnline());

    const unsubscribeOnline = dbService.getOnlineUsers((users) => {
      // Keep users that were active recently (e.g. within 5 mins)
      const now = new Date().getTime();
      const activeUsers = users.filter((u: any) => {
         const t = new Date(u.lastActive).getTime();
         return (now - t) < 5 * 60 * 1000;
      });
      setOnlineUsers(activeUsers);
    });

    return () => {
      cleanup();
      if (typeof unsubscribeOnline === 'function') {
         unsubscribeOnline();
      }
    };
  }, [activeModule, user]);

  const handleLogoutSequence = () => {
    dbService.logAction(user.name, user.role, "Выход", "Auth", user.uid, "Вышел из учетной записи");
    onLogout();
  };

  // List of possible modules with tags, keys, icons, and labels
  const allModules = [
    { key: 'dashboard', label: 'Главная', icon: LayoutDashboard, permissionKey: 'dashboard' },
    { key: 'dohod', label: 'Калькуляция', icon: Calculator, permissionKey: 'dohod' },
    { key: 'salary', label: 'Зарплата Водителей', icon: Wallet, permissionKey: 'salary' },
    { key: 'planDohod', label: 'План Дохода', icon: TrendingUp, permissionKey: 'planDohod' },
    { key: 'planZagruzok', label: 'План Загрузок', icon: FileSpreadsheet, permissionKey: 'planZagruzok' },
    { key: 'currentPlanning', label: 'Текущее планирование', icon: Calendar, permissionKey: 'currentPlanning' },
    { key: 'baza', label: 'Учет выезда', icon: Truck, permissionKey: 'baza' },
    { key: 'vehicleDriverData', label: 'Авто и Водители', icon: FileText, permissionKey: 'vehicleDriverData' },
    { key: 'analysis', label: 'Анализ', icon: TrendingUp, permissionKey: 'analysis' },
    { key: 'dozvola', label: 'Учет Дозволов', icon: FileText, permissionKey: 'dozvola' },
    { key: 'documents', label: 'Документы', icon: Files, permissionKey: 'documents' },
    { key: 'disposition', label: 'Диспозиция', icon: Map, permissionKey: 'disposition' },
    { key: 'settings', label: 'Справочники', icon: Settings, permissionKey: 'settings' },
    { key: 'admin', label: 'Администрирование', icon: ShieldAlert, permissionKey: 'admin' }
  ];

  // Filter modules based on user's permission (not 'none' and matching admin fields)
  const allowedModules = useMemo(() => {
    if (user.role === 'mechanic') {
      return allModules.filter(mod => mod.key === 'baza');
    }
    return allModules.filter(mod => {
      // Allow root admin OR user named 'Сергей Root' OR specific email completely
      if (user.role === 'root_admin' || user.name.includes('Сергей Root') || user.email === 'r98ratipaby@gmail.com') return true;
      
      // If explicit permission is set in user.permissions, use it
      if (user.permissions && user.permissions[mod.permissionKey] !== undefined) {
        return user.permissions[mod.permissionKey] !== 'none';
      }
      
      // Fallback to default permissions based on role if missing in user.permissions
      const role = user.role;
      if (role === 'admin' || role === 'manager') {
        if (mod.permissionKey === 'admin') return role === 'admin';
        return true;
      }
      
      // Default fallback (dispatcher or others)
      const defaultReads = ['planDohod', 'planZagruzok', 'baza', 'vehicleDriverData', 'dozvola', 'disposition'];
      const defaultWrites = ['dohod', 'salary', 'documents'];
      return defaultWrites.includes(mod.permissionKey) || defaultReads.includes(mod.permissionKey);
    });
  }, [user.role, user.permissions]);

  const [settings, setSettings] = useState<AppSettings | null>(null);

  const filteredNotifications = useMemo(() => {
    if (!user) return [];
    
    // Check if notifications are enabled for this role globally
    if (settings?.notificationAccess) {
      const enabledRoles = settings.notificationAccess.enabledRoles || [];
      if (enabledRoles.length > 0 && !enabledRoles.includes(user.role)) {
        return [];
      }
    }

    const visible = notifications.filter(n => {
      if (userNotifState[n.id]?.isDeleted) return false;

      // Check if targeted to specific roles by sender
      if (n.targetRoles && n.targetRoles.length > 0) {
        if (!n.targetRoles.includes(user.role)) return false;
      }

      // Check allowed notification types per role configured by Admin
      if (settings?.notificationAccess?.roleNotificationTypes) {
        const allowedTypes = settings.notificationAccess.roleNotificationTypes[user.role];
        if (allowedTypes && n.type && !allowedTypes.includes(n.type)) {
          return false;
        }
      }

      return true;
    });

    if (notifTab === 'unread') {
      return visible.filter(n => !userNotifState[n.id]?.isRead);
    }
    return visible;
  }, [notifications, notifTab, userNotifState, user, settings]);

  const unreadNotifsCount = useMemo(() => {
    return filteredNotifications.filter(n => !userNotifState[n.id]?.isRead).length;
  }, [filteredNotifications, userNotifState]);

  const menuGroups = useMemo(() => {
    if (settings && settings.menuStructure && settings.menuStructure.length > 0) {
      return settings.menuStructure;
    }
    return [
      { id: 'g_home', label: 'Главная', isDropdown: false, singleModuleKey: 'dashboard' },
      { id: 'g_planning', label: 'Планирование', isDropdown: true, subtabKeys: ['planDohod', 'planZagruzok', 'currentPlanning'] },
      { id: 'g_calc', label: 'Калькуляция', isDropdown: false, singleModuleKey: 'dohod' },
      { id: 'g_salary', label: 'Зарплата', isDropdown: false, singleModuleKey: 'salary' },
      { id: 'g_veh_drv', label: 'Авто и Водители', isDropdown: false, singleModuleKey: 'vehicleDriverData' },
      { id: 'g_analysis', label: 'Анализ', isDropdown: false, singleModuleKey: 'analysis' },
      { id: 'g_baza', label: 'Учет выезда', isDropdown: false, singleModuleKey: 'baza' },
      { id: 'g_dozvola', label: 'Дозволы', isDropdown: false, singleModuleKey: 'dozvola' },
      { id: 'g_docs', label: 'Документы', isDropdown: false, singleModuleKey: 'documents' },
      { id: 'g_disp', label: 'Диспозиция', isDropdown: false, singleModuleKey: 'disposition' },
      { id: 'g_settings', label: 'Справочники', isDropdown: false, singleModuleKey: 'settings' },
      { id: 'g_admin', label: 'Админ', isDropdown: false, singleModuleKey: 'admin' }
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

  useEffect(() => {
     return dbService.getSettings(setSettings);
  }, []);

  // Redirect to first available tab if active is not allowed
  useEffect(() => {
    const isAllowed = allowedModules.some(m => m.key === activeModule);
    if (!isAllowed && allowedModules.length > 0) {
      // Find modules sorted by settings.moduleOrder if possible
      const sortedModules = [...allowedModules];
      if (settings && settings.moduleOrder) {
        sortedModules.sort((a,b) => {
          const orderA = settings.moduleOrder.indexOf(a.key);
          const orderB = settings.moduleOrder.indexOf(b.key);
          const idxA = orderA === -1 ? 99 : orderA;
          const idxB = orderB === -1 ? 99 : orderB;
          return idxA - idxB;
        });
      }
      setActiveModule(sortedModules[0].key);
    }
  }, [activeModule, allowedModules]);

  const navModules = useMemo(() => {
    const modules = [...allowedModules];
    if (settings && settings.moduleOrder) {
       // sort modules based on settings.moduleOrder
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


  const handleNavigate = (moduleKey: string) => {
    window.location.hash = moduleKey;
    setActiveModule(moduleKey);
    setIsSidebarOpen(false);
  };

  // Render the currently selected main active workspace component
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
        return <BazaModule user={user} />;
      case 'vehicleDriverData':
        return <VehicleDriverDataModule user={user} />;
      case 'dozvola':
        return <DozvolaModule user={user} />;
      case 'documents':
        return <DocumentsModule user={user} />;
      case 'disposition':
        return <DispositionModule user={user} />;
      case 'analysis':
        return <AnalysisModule user={user} />;
      case 'settings':
        return <SettingsModule user={user} />;
      case 'admin':
        return <AdminModule user={user} />;
      default:
        return null;
    }
  };

  const activeModuleMeta = allModules.find(m => m.key === activeModule);

  return (
    <div className={`min-h-screen ${activeModule === "admin" ? "bg-transparent" : "bg-slate-50"} flex flex-col font-sans transition-all duration-300`}>
      
      {/* Modern Responsive Capsule Header - fully blended light premium top bar */}
      <header className="bg-white/45 backdrop-blur-lg text-slate-900 border-b border-slate-200/35 min-h-[3.5rem] py-1 md:py-0 md:h-14 flex items-center justify-between px-3 sm:px-8 shrink-0 sticky top-0 z-50 select-none gap-2 sm:gap-3 transition-colors duration-300">
        
        {/* Left Aligned Section combining Brand Area & Nav Menu close to it */}
        <div className="flex items-center gap-2 sm:gap-6 flex-1 min-w-0">
          {/* Left Brand Area */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1.5 rounded-xl hover:bg-slate-200/40 transition xl:hidden focus:outline-none border border-transparent"
            >
              {isSidebarOpen ? <X className="h-6 w-6 text-slate-700" /> : <Menu className="h-6 w-6 text-slate-700" />}
            </button>
            
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => handleNavigate(user.role === 'mechanic' ? 'baza' : 'dashboard')}>
              <div className="flex items-baseline gap-1.5 font-sans">
                <span className="font-black tracking-tight text-sm md:text-base uppercase text-slate-900 leading-none group-hover:text-[#3765F6] transition-colors duration-200">
                  RATIPA PORTAL
                </span>
              </div>
              {activeModule !== 'dashboard' && (
                <>
                  <span className="text-slate-300 hidden md:inline select-none">/</span>
                  <span className="text-xs font-bold text-slate-500 font-sans tracking-tight hidden md:inline transition-colors duration-200">
                    {activeModuleMeta ? activeModuleMeta.label : 'Главная'}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Navigation Menu aligned left, closer to Logo - borderless, light, premium design */}
          <nav className="hidden xl:flex items-center gap-1.5 p-1 rounded-2xl overflow-x-auto lg:overflow-visible whitespace-nowrap scrollbar-none max-w-[50vw] sm:max-w-[70vw] lg:max-w-none flex-nowrap shrink relative">
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
                        return; // Ignore immediate click from simulated touch hover
                      }
                      setOpenDropdownId(isOpen ? null : group.id);
                    }}
                    className={`text-[9.5px] md:text-[10px] font-extrabold tracking-tight uppercase transition-all duration-200 py-1.5 px-3 md:px-4 rounded-xl flex items-center gap-1.5 cursor-pointer shrink-0 select-none border ${
                      isChildActive 
                        ? 'text-[#3765F6] bg-[#3765F6]/8 border-[#3765F6]/20 shadow-2xs font-black' 
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/40 border-transparent'
                    }`}
                  >
                    <GroupIcon className={`h-3 w-3 ${isChildActive ? 'text-[#3765F6]' : 'text-slate-400'}`} />
                    <span>{group.label}</span>
                    <ChevronDown className={`h-3 w-3 ${isChildActive ? 'text-[#3765F6]' : 'text-slate-400'} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  
                  {isOpen && (
                    <div className="absolute left-0 top-full pt-1.5 min-w-[200px] z-50">
                      <div className="bg-white border border-slate-200/60 rounded-2xl shadow-xl py-2 animate-in fade-in slide-in-from-top-1 duration-150">
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
                              className={`flex items-center gap-2 px-4 py-2.5 text-xs transition-all duration-200 rounded-xl mx-1 ${
                                isActive 
                                  ? 'bg-[#3765F6]/8 text-[#3765F6] font-black border border-[#3765F6]/15' 
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950 border border-transparent'
                              }`}
                            >
                              <SubIcon className={`h-3.5 w-3.5 ${isActive ? 'text-[#3765F6]' : 'text-slate-400'}`} />
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
                  className={`text-[9.5px] md:text-[10px] font-extrabold tracking-tight uppercase transition-all duration-200 py-1.5 px-3 md:px-4 rounded-xl flex items-center gap-1.5 relative cursor-pointer shrink-0 border ${
                    isActive 
                      ? 'text-[#3765F6] bg-[#3765F6]/8 border-[#3765F6]/20 shadow-2xs font-black' 
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/40 border-transparent'
                  }`}
                >
                  <ItemIcon className={`h-3 w-3 ${isActive ? 'text-[#3765F6]' : 'text-slate-400'}`} />
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
              className="text-[9.5px] md:text-[10px] font-extrabold tracking-tight uppercase transition-all duration-200 py-1.5 px-3 md:px-3.5 rounded-xl text-slate-500 hover:text-slate-900 hover:bg-slate-200/40 flex items-center gap-1 border border-transparent cursor-pointer shrink-0"
            >
              <ExternalLink className="h-3 w-3 text-slate-400" />
              <span>{extTab.title}</span>
            </a>
          ))}
        </nav>
        </div>

        {/* Right Section: Avatars, Sync state + Profile badge + Logout */}
        <div className="flex items-center gap-2 md:gap-4 shrink-0">
          
          {/* Animated Text in Top Bar */}
          {settings?.customPhrases && settings.customPhrases.length > 0 && 
           (!settings.customPhrasesRoles || settings.customPhrasesRoles.length === 0 || settings.customPhrasesRoles.includes(user.role)) && (
            <div className="hidden lg:flex items-center mr-2 border-r border-slate-200/60 pr-4 h-6">
              <TypingText 
                phrases={settings.customPhrases} 
                className="text-[11.5px] font-mono font-bold text-slate-500 tracking-tight"
              />
            </div>
          )}
          
          {/* Avatar overlap stack exactly like the image dashboard */}
          <div className="hidden md:flex items-center -space-x-2 mr-1 relative group cursor-pointer">
            {onlineUsers.slice(0, 3).map((u, i) => {
               // Cycle through some nice colors for background
               const colors = ['bg-indigo-100 text-indigo-700', 'bg-emerald-100 text-emerald-700', 'bg-amber-100 text-amber-700', 'bg-sky-100 text-sky-700', 'bg-rose-100 text-rose-700'];
               const colorClass = colors[i % colors.length];
               return (
                 <div key={u.presenceId} className={`h-7 w-7 rounded-full border-2 border-white flex items-center justify-center text-[10px] font-bold shadow-xs ${colorClass}`}>
                   {u.name.substring(0, 2).toUpperCase()}
                 </div>
               )
            })}
            {onlineUsers.length > 3 && (
               <div className="h-7 w-7 rounded-full bg-[#3765F6] border-2 border-white flex items-center justify-center text-[9px] font-black text-white shadow-xs">
                 +{onlineUsers.length - 3}
               </div>
            )}
            
            {/* Hover Popover with full user list */}
            {onlineUsers.length > 0 && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-slate-200 shadow-xl rounded-xl p-3 opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-all duration-200 z-50">
                <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-2 block">Пользователи онлайн</span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                  {onlineUsers.map(u => (
                    <div key={u.presenceId} className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] animate-pulse shrink-0"></span>
                       <span className="text-xs font-bold text-slate-800 truncate" title={`${u.name} (${u.role})`}>{u.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Currency Converter Widget */}
          <div className="relative font-sans" ref={converterRef}>
            <button
              type="button"
              onClick={() => setIsConverterOpen(!isConverterOpen)}
              className={`relative p-2 rounded-xl border transition-all duration-200 active:scale-95 cursor-pointer flex items-center justify-center shadow-2xs ${
                isConverterOpen 
                  ? 'bg-[#3765F6]/10 text-[#3765F6] border-[#3765F6]/25 shadow-xs' 
                  : 'bg-white/60 text-slate-500 hover:text-slate-900 hover:bg-white border-slate-200/40'
              }`}
              title="Конвертер валют"
            >
              <DollarSign size={16} />
            </button>

            <AnimatePresence>
              {isConverterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 12, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 12, scale: 0.96 }}
                  transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                  className="fixed sm:absolute top-14 sm:top-auto left-4 right-4 sm:left-auto sm:right-0 mt-2 sm:mt-3 sm:w-80 bg-white border border-slate-200 rounded-2xl shadow-xl shadow-slate-900/5 z-[2000] overflow-hidden p-5 max-w-[400px] mx-auto"
                >
                  <div className="border-b border-slate-100/60 pb-3 mb-4 flex justify-between items-center select-none">
                    <div>
                      <h3 className="text-xs font-black text-slate-900 font-sans tracking-tight uppercase">Конвертер валют</h3>
                      <p className="text-[10px] text-slate-400 font-sans font-bold mt-0.5">Официальные курсы НБРБ</p>
                    </div>
                    
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditingCurrencies(!isEditingCurrencies);
                        }}
                        title="Настройка списка валют"
                        className={`p-1.5 rounded-xl border transition-all flex items-center justify-center cursor-pointer active:scale-95 ${
                          isEditingCurrencies
                            ? 'bg-[#3765F6] text-white border-[#3765F6]'
                            : 'bg-white/60 hover:bg-[#3765F6]/10 border border-slate-200/40 text-slate-500 hover:text-[#3765F6] hover:border-[#3765F6]/20'
                        }`}
                      >
                        <Sliders size={10.5} />
                      </button>
                      
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          fetchNbrbRates();
                        }}
                        disabled={isRatesLoading}
                        title="Обновить курсы из НБРБ"
                        className="p-1.5 rounded-xl bg-white/60 hover:bg-[#3765F6]/10 border border-slate-200/40 text-slate-500 hover:text-[#3765F6] hover:border-[#3765F6]/20 transition-all flex items-center justify-center cursor-pointer active:scale-95 disabled:opacity-50"
                      >
                        <RefreshCw size={10.5} className={`${isRatesLoading ? 'animate-spin' : ''}`} />
                      </button>
                    </div>
                  </div>

                  {isEditingCurrencies ? (
                    <div className="space-y-3 py-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Выберите валюты</span>
                        <button
                          onClick={() => setIsEditingCurrencies(false)}
                          className="text-[10px] font-black text-[#3765F6] hover:underline uppercase tracking-wider cursor-pointer"
                        >
                          Готово
                        </button>
                      </div>
                      <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
                        {(availableCurrencies.length > 0 ? availableCurrencies : [
                          { id: "1", code: "USD" },
                          { id: "2", code: "EUR" },
                          { id: "3", code: "RUB" },
                          { id: "4", code: "BYN" },
                          { id: "5", code: "TRY" },
                          { id: "6", code: "KZT" },
                          { id: "7", code: "CNY" }
                        ]).map(curr => {
                          const isSelected = selectedCurrencyCodes.includes(curr.code);
                          return (
                            <button
                              key={curr.code}
                              onClick={() => {
                                if (isSelected) {
                                  if (selectedCurrencyCodes.length > 1) {
                                    setSelectedCurrencyCodes(prev => prev.filter(c => c !== curr.code));
                                  }
                                } else {
                                  setSelectedCurrencyCodes(prev => [...prev, curr.code]);
                                }
                              }}
                              className={`p-2 rounded-xl text-xs font-bold border text-left flex items-center justify-between transition-all cursor-pointer ${
                                isSelected 
                                  ? 'bg-[#3765F6]/5 border-[#3765F6] text-[#3765F6]' 
                                  : 'bg-slate-50 border-slate-200/60 text-slate-400 hover:bg-slate-100'
                              }`}
                            >
                              <span>{curr.code}</span>
                              <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-[#3765F6]' : 'bg-slate-300'}`} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-4 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                      {selectedCurrencyCodes.map(code => {
                        let currencyLabel = `${code} Валюта`;
                        let currencySymbol = code;
                        if (code === 'USD') { currencyLabel = 'USD ($) Доллар'; currencySymbol = '$'; }
                        else if (code === 'EUR') { currencyLabel = 'EUR (€) Евро'; currencySymbol = '€'; }
                        else if (code === 'BYN') { currencyLabel = 'BYN (Br) Бел. рубль'; currencySymbol = 'Br'; }
                        else if (code === 'RUB') { currencyLabel = 'RUB (₽) Рус. рубль'; currencySymbol = '₽'; }
                        else if (code === 'TRY') { currencyLabel = 'TRY (₺) Лира'; currencySymbol = '₺'; }
                        else if (code === 'KZT') { currencyLabel = 'KZT (₸) Тенге'; currencySymbol = '₸'; }
                        else if (code === 'CNY') { currencyLabel = 'CNY (¥) Юань'; currencySymbol = '¥'; }

                        return (
                          <div className="group relative" key={code}>
                            <div className="flex justify-between items-center mb-1 select-none">
                              <label className="text-[9px] font-extrabold text-slate-400 uppercase tracking-widest font-sans">{currencyLabel}</label>
                              {code !== 'BYN' && rates[code] && (
                                <span className="text-[8.5px] font-bold text-slate-400 font-mono">
                                  1 {code} = {Number(rates[code]).toFixed(4)} BYN
                                </span>
                              )}
                              {code === 'BYN' && (
                                <span className="text-[8.5px] font-bold text-slate-400 font-mono">Базовая валюта</span>
                              )}
                            </div>
                            <div className="relative flex items-center">
                              <span className="absolute left-3 text-xs font-black text-slate-400 group-focus-within:text-[#3765F6] transition-colors select-none">{currencySymbol}</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={getDisplayValue(code)}
                                onChange={(e) => {
                                  setActiveCurrency(code);
                                  setActiveValue(e.target.value.replace(',', '.'));
                                }}
                                className="w-full pl-8 pr-3.5 py-2 bg-slate-50/40 hover:bg-slate-50/70 border border-slate-200/50 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-4 focus:ring-[#3765F6]/8 transition-all"
                                placeholder="0.00"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Fully featured Notifications Center dropdown */}
          <div className="relative font-sans" ref={notifRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className={`relative p-2 rounded-xl border transition-all duration-200 active:scale-95 cursor-pointer flex items-center justify-center shadow-2xs ${
                isNotifOpen 
                  ? 'bg-[#3765F6]/10 text-[#3765F6] border-[#3765F6]/25 shadow-xs' 
                  : 'bg-white/60 text-slate-500 hover:text-slate-900 hover:bg-white border-slate-200/40'
              }`}
              title="Уведомления"
            >
              <Bell size={16} className={`${unreadNotifsCount > 0 ? 'animate-pulse' : ''}`} />
              {unreadNotifsCount > 0 && (
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 px-1 rounded-full bg-rose-500 text-white text-[8.5px] font-black items-center justify-center border border-white leading-none shadow-sm">
                  {unreadNotifsCount}
                </span>
              )}
            </button>

            <AnimatePresence>
              {isNotifOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="fixed sm:absolute top-14 sm:top-auto left-4 right-4 sm:left-auto sm:right-0 mt-2 sm:mt-3 sm:w-80 md:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl z-[2000] overflow-hidden max-w-[400px] mx-auto"
                >
                  {/* Dropdown Header */}
                  <div className="p-4 border-b border-slate-100 bg-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-extrabold text-slate-950 font-sans">Уведомления</h3>
                        <p className="text-[10px] text-slate-400 font-sans font-medium mt-0.5">События и важные оповещения</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {unreadNotifsCount > 0 && (
                          <button
                            type="button"
                            onClick={markAllNotifsAsRead}
                            className="p-1 text-slate-400 hover:text-emerald-500 transition rounded hover:bg-slate-50 cursor-pointer"
                            title="Прочитать все"
                          >
                            <CheckCheck size={14} className="stroke-[2.5]" />
                          </button>
                        )}
                        {notifications.length > 0 && (
                          <button
                            type="button"
                            onClick={clearAllNotifications}
                            className="text-[9.5px] uppercase font-black tracking-wider text-rose-500 hover:text-rose-600 transition cursor-pointer"
                          >
                            Очистить
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Filter Tabs & Counter numbers */}
                    <div className="flex gap-1.5 mt-3 bg-slate-50 border border-slate-100 rounded-xl p-1">
                      <button
                        type="button"
                        onClick={() => setNotifTab('all')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-[10px] font-extrabold uppercase rounded-lg transition tracking-wide cursor-pointer ${
                          notifTab === 'all' 
                            ? 'bg-white text-slate-950 shadow-xs border border-slate-200/20' 
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Все
                        <span className={`px-1.5 py-0.5 rounded-full text-[8.5px] font-bold ${
                          notifTab === 'all' ? 'bg-slate-150 text-slate-800' : 'bg-slate-200/50 text-slate-500'
                        }`}>
                          {notifications.length}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotifTab('unread')}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-1 text-[10px] font-extrabold uppercase rounded-lg transition tracking-wide cursor-pointer ${
                          notifTab === 'unread' 
                            ? 'bg-white text-slate-950 shadow-xs border border-slate-200/20' 
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Непрочитанные
                        <span className={`px-1.5 py-0.5 rounded-full text-[8.5px] font-bold ${
                          unreadNotifsCount > 0 ? 'bg-rose-100 text-rose-600 font-extrabold' : 'bg-slate-200/50 text-slate-500'
                        }`}>
                          {unreadNotifsCount}
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Scrollable list viewport wrapper */}
                  <div className="max-h-72 overflow-y-auto divide-y divide-slate-50 custom-scrollbar bg-white">
                    {filteredNotifications.length === 0 ? (
                      <div className="p-8 text-center flex flex-col items-center justify-center bg-white">
                        <div className="h-10 w-10 rounded-full bg-slate-50 flex items-center justify-center text-slate-300 mb-2">
                          <Bell size={18} className="opacity-60" />
                        </div>
                        <h4 className="text-xs font-bold text-slate-700">Уведомлений нет</h4>
                        <p className="text-[10px] text-slate-400 mt-1 max-w-[200px] leading-normal font-medium">
                          {notifTab === 'unread' ? 'У вас нет непрочитанных уведомлений.' : 'Здесь будут отображаться важные обновления и системные алерты.'}
                        </p>
                      </div>
                    ) : (
                      filteredNotifications.map((notif) => {
                        const isWarning = notif.type === 'warning';
                        const isAlert = notif.type === 'alert';
                        const isSuccess = notif.type === 'success';
                        
                        let barColor = 'bg-sky-400';
                        let badgeBg = 'bg-sky-50 text-sky-500';
                        let IconComp = Info;
                        
                        if (isWarning) {
                          barColor = 'bg-amber-400';
                          badgeBg = 'bg-amber-50 text-amber-500';
                          IconComp = AlertTriangle;
                        } else if (isAlert) {
                          barColor = 'bg-rose-500';
                          badgeBg = 'bg-rose-50/70 text-rose-500';
                          IconComp = ShieldAlert;
                        } else if (isSuccess) {
                          barColor = 'bg-emerald-400';
                          badgeBg = 'bg-emerald-50 text-emerald-500';
                          IconComp = Check;
                        }

                        return (
                          <div 
                            key={notif.id} 
                            onClick={() => markNotifAsRead(notif.id)}
                            className={`flex group items-start gap-3 p-3.5 transition hover:bg-slate-50/80 relative cursor-pointer ${
                              userNotifState[notif.id]?.isRead ? 'opacity-55' : ''
                            }`}
                          >
                            {/* Color bar on left edge */}
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${barColor}`} />

                            <div className={`p-1.5 rounded-lg shrink-0 mt-0.5 ${badgeBg}`}>
                              <IconComp size={13} className="stroke-[2.5]" />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-1.5 mb-1">
                                <h4 className="text-[11px] font-black text-slate-900 leading-snug truncate">
                                  {notif.title}
                                </h4>
                                <span className="text-[8.5px] font-bold text-slate-400 shrink-0 font-mono">
                                  {notif.date}
                                </span>
                              </div>
                              <p className="text-[10.5px] leading-relaxed text-slate-500 font-medium">
                                {notif.text}
                              </p>
                              {notif.dispatcher && (
                                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                  {String(user?.name || '').toLowerCase() === String(notif.dispatcher || '').toLowerCase() ? (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-black tracking-wide bg-[#c3fb12] text-[#2f4201] uppercase border border-[#c3fb12]/40 animate-pulse-slow">
                                      <span className="w-1 h-1 rounded-full bg-[#2f4201]" />
                                      ДЛЯ ВАС (Ваша машина)
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[8.5px] font-semibold tracking-wide bg-slate-100 text-slate-600 uppercase border border-slate-200">
                                      Диспетчер: {notif.dispatcher}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>

                            {/* Actions block inside item */}
                            <div className="flex items-center gap-0.5 shrink-0 pl-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  markNotifAsRead(notif.id);
                                }}
                                className="p-1 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition cursor-pointer"
                                title={notif.isRead ? 'Отметить как непрочитанное' : 'Отметить как прочитанное'}
                              >
                                {notif.isRead ? <Check size={11} className="stroke-[3]" /> : <CheckCheck size={11} className="stroke-[2.5]" />}
                              </button>
                              <button
                                type="button"
                                onClick={(e) => deleteNotif(notif.id, e)}
                                className="p-1 rounded hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                                title="Удалить уведомление"
                              >
                                <X size={11} className="stroke-[3]" />
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>

                  {/* Informational context */}
                  <div className="p-4 bg-slate-50 border-t border-slate-150 rounded-b-2xl">
                    <div>
                      <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono block mb-1">События Учёта выезда</span>
                      <div className="flex flex-col gap-1.5 mt-1.5">
                        <div className="text-[9.5px] text-slate-500 font-bold flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
                          <span>🛠️ Ремонт успешно завершен (Оповестить диспетчера)</span>
                        </div>
                        <div className="text-[9.5px] text-slate-500 font-bold flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse" />
                          <span>📦 Подходит срок готовности (Нужно срочно грузить машину!)</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Live indicator badge */}
          <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 bg-white/60 rounded-xl border border-slate-200/40 shadow-2xs">
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
            </span>
            <span className="text-[11px] font-bold text-slate-500 font-sans">
              Активна
            </span>
          </div>

          {/* User Badge Profile info */}
          <div className="flex items-center gap-2.5 pl-1.5 sm:pl-2.5 border-l border-slate-200/40">
            <div className="h-7.5 w-7.5 rounded-xl bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/20 flex items-center justify-center text-[11px] font-black shadow-3xs select-none">
              {user.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="hidden xl:block text-left text-xs leading-none">
              <div className="font-extrabold text-slate-900 tracking-tight">{user.name}</div>
              <span className="text-[9.5px] font-bold text-slate-400 block mt-0.5 uppercase tracking-wider">
                {user.role === 'root_admin' ? 'Админ' : 'Сотрудник'}
              </span>
            </div>
          </div>

          {/* Logout Action Button */}
          <button
            onClick={handleLogoutSequence}
            className="p-1.5 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-transparent transition-colors duration-200 cursor-pointer"
            title="Завершить сессию"
          >
            <LogOut className="h-4 w-4" />
          </button>

        </div>
      </header>

      {/* Main Container workspace */}
      <div className="flex-1 flex relative w-full max-w-full overflow-hidden">
        
        {/* Navigation Sidebar (Only displays for mobile/tablet screens in drawing mode) */}
        {isSidebarOpen && (
          <aside className="fixed top-14 bottom-0 left-0 w-64 bg-white border-r border-slate-150 flex flex-col z-40 xl:hidden">
            <div className="flex-1 p-5 py-6 space-y-3 overflow-y-auto select-none">
              <span className="text-[9px] uppercase font-bold text-slate-400 tracking-widest block pl-3 pb-2 border-b border-slate-100 mb-2">
                РАЗДЕЛЫ КООРДИНАТОРА
              </span>
              
              {menuGroups.filter(isGroupVisible).map((group) => {
                if (group.isDropdown) {
                  const allowedSubtabs = getAllowedSubtabs(group);
                  return (
                    <div key={group.id} className="space-y-1 pb-2">
                      <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider block pl-3 pt-2">
                        {group.label}
                      </span>
                      {allowedSubtabs.map((subKey) => {
                        const found = allModules.find(m => m.key === subKey);
                        if (!found) return null;
                        const IconComp = found.icon;
                        const isActive = activeModule === subKey;
                        const subLabel = getSubtabLabel(group, subKey);
                        return (
                          <a
                            key={subKey}
                            href={`#${subKey}`}
                            onClick={(e) => {
                              if (!e.metaKey && !e.ctrlKey) {
                                e.preventDefault();
                                handleNavigate(subKey);
                              }
                            }}
                            className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-xs font-bold transition-all duration-150 cursor-pointer ${
                              isActive 
                                ? 'bg-slate-950 text-white shadow-lg shadow-black/10 scale-102 border-l-4 border-[#3765F6]' 
                                : 'text-slate-600 hover:bg-slate-50 hover:text-black'
                            }`}
                          >
                            <IconComp className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#3765F6]' : 'text-slate-400'}`} />
                            <span>{subLabel}</span>
                          </a>
                        );
                      })}
                    </div>
                  );
                } else {
                  const itemKey = group.singleModuleKey!;
                  const found = allModules.find(m => m.key === itemKey);
                  if (!found) return null;
                  const IconComp = found.icon;
                  const isActive = activeModule === itemKey;
                  const displayLabel = group.customLabels && group.customLabels[itemKey] ? group.customLabels[itemKey] : group.label;
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
                      className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-xs font-bold transition-all duration-150 cursor-pointer ${
                        isActive 
                          ? 'bg-slate-950 text-white shadow-lg shadow-black/10 scale-102 border-l-4 border-[#3765F6]' 
                          : 'text-slate-600 hover:bg-slate-50 hover:text-black'
                      }`}
                    >
                      <IconComp className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#3765F6]' : 'text-slate-400'}`} />
                      <span>{displayLabel}</span>
                    </a>
                  );
                }
              })}
              
              {settings?.externalTabs?.map((extTab) => {
                return (
                  <a
                    key={extTab.id}
                    href={extTab.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full flex items-center gap-3 px-3.5 py-3 rounded-2xl text-xs font-bold text-slate-600 hover:bg-slate-50 hover:text-black transition-all duration-150 cursor-pointer"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
                    <span className="flex-1 truncate">{extTab.title}</span>
                  </a>
                );
              })}
            </div>

            <div className="p-4 py-5 border-t border-slate-100 text-center select-none bg-slate-50/50">
              <span className="text-[9px] font-bold text-slate-400 font-mono tracking-widest block">
                ПАНЕЛЬ RATIPA v2.0
              </span>
            </div>
          </aside>
        )}

        {/* Backdrop for mobile drawer */}
        {isSidebarOpen && (
          <div 
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 top-14 bg-slate-950/20 backdrop-blur-xs z-30 xl:hidden"
          />
        )}

        {/* Dynamic active viewport card frame with subtle shadow and round corners */}
        <main 
          ref={mainScrollRef} 
          className={`flex-1 overflow-y-auto overflow-x-hidden w-full max-w-full relative ${
            activeModule === 'dashboard' 
              ? 'p-0 bg-slate-50' 
              : activeModule === 'admin'
              ? 'p-3 sm:p-4 lg:p-6 bg-transparent'
              : 'p-3 sm:p-4 lg:p-6 bg-[#f4f5f6]'
          }`}
        >
          {allModules.map((mod) => {
            const isAllowed = user.role === 'mechanic' ? (mod.key === 'baza') : (user.role === 'root_admin' || (user.permissions && user.permissions[mod.permissionKey] && user.permissions[mod.permissionKey] !== 'none'));
            if (!isAllowed) return null;

            const isActive = activeModule === mod.key;
            if (!isActive) return null;
            return (
              <div
                key={mod.key}
                className="h-full"
              >
                <motion.div
                  initial={{ opacity: 0, y: 3 }}
                  animate={{ opacity: isActive ? 1 : 0, y: isActive ? 0 : 3 }}
                  transition={{ duration: 0.15, ease: "easeOut" }}
                  className="h-full"
                >
                  <Suspense fallback={<div className="p-8 flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900"></div></div>}>
                    {renderModuleByKey(mod.key)}
                  </Suspense>
                </motion.div>
              </div>
            );
          })}
        </main>

      </div>

      {/* Scroll to Top Button */}
      <button
        onClick={() => {
          mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        className="fixed bottom-0 right-0 z-[1000] flex items-center justify-center gap-1.5 px-4 py-2.5 bg-slate-950 text-[#70FC8E] border-t border-l border-slate-800 hover:bg-slate-900 transition-all duration-200 select-none cursor-pointer rounded-tl-xl shadow-[-4px_-4px_15px_rgba(0,0,0,0.2)] tracking-widest uppercase font-mono text-[9px] font-black"
        title="Наверх"
      >
        <ArrowUp className="h-3 w-3" />
        наверх
      </button>

      {/* Chat widget removed per request — data now flows via portal modules */}

      {/* Real-time Broadcast Push Notifications Overlay Stack (Top-Right) */}
      <div className="fixed top-20 right-6 z-[2000] flex flex-col gap-3.5 max-w-sm w-[calc(100%-3rem)] pointer-events-none">
        <AnimatePresence>
          {activeUnreadBroadcasts.map((notif) => (
            <motion.div
              key={notif.id}
              initial={{ opacity: 0, y: -20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.15 } }}
              className="pointer-events-auto bg-slate-950 text-white rounded-2xl border border-slate-800 shadow-[0_15px_50px_rgba(0,0,0,0.5)] p-5 relative overflow-hidden flex flex-col gap-3"
            >
              {/* Highlight bar */}
              <div className="absolute top-0 left-0 right-0 h-1.5 bg-[#70FC8E]" />

              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <div className="p-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[#70FC8E] mt-0.5 animate-pulse">
                    <BellRing className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <span className="text-[9.5px] font-black uppercase tracking-widest text-[#70FC8E] block">
                      Важное Распоряжение
                    </span>
                    <span className="text-[8.5px] text-slate-400 font-mono">
                      от {notif.createdBy} • {new Date(notif.createdAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>

              <p className="text-xs text-slate-100 font-medium leading-relaxed whitespace-pre-wrap select-text">
                {notif.text}
              </p>

              <button
                onClick={() => dbService.markBroadcastNotificationAsRead(notif.id, user.uid, user.name)}
                className="w-full mt-1.5 py-2 px-4 bg-[#70FC8E] hover:bg-[#5be277] active:scale-98 text-slate-950 font-black text-[10px] uppercase tracking-widest rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                Прочитано / Закрыть
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      <CommandCenter 
        user={user} 
        isOpen={isCommandCenterOpen} 
        onClose={() => setIsCommandCenterOpen(false)} 
        onNavigate={handleNavigate} 
      />
    </div>
  );
}

import React, { useState, useEffect, useMemo, useRef, Suspense, lazy } from 'react';
import { UserProfile, AppSettings, ChatMessage } from '../types';
import { dbService, database, useFirebase, onValue } from '../firebase';
import { ref, set, push, update, remove } from 'firebase/database';
import { motion, AnimatePresence } from 'motion/react';
import CommandCenter from './CommandCenter';
import TypingText from './TypingText';
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
  RefreshCw
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
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsCommandCenterOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    if (!loadedModules.includes(activeModule)) {
      setLoadedModules((prev) => [...prev, activeModule]);
    }
  }, [activeModule, loadedModules]);

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
  const [showEditRates, setShowEditRates] = useState(false);
  const [isRatesLoading, setIsRatesLoading] = useState(false);
  const [activeCurrency, setActiveCurrency] = useState<string>('USD');
  const [activeValue, setActiveValue] = useState<string>('100');
  const [rates, setRates] = useState(() => {
    const saved = localStorage.getItem('ratipa_converter_rates');
    if (saved) {
      try { return JSON.parse(saved); } catch (e) {}
    }
    return {
      USD: 3.25,
      EUR: 3.55,
      RUB: 0.036,
      BYN: 1.0
    };
  });
  const converterRef = useRef<HTMLDivElement>(null);

  const fetchNbrbRates = async () => {
    setIsRatesLoading(true);
    try {
      // Try the server-side API proxy first to bypass client CORS / VPN / network issues
      let response = await fetch('/api/nbrb-rates');
      if (!response.ok) {
        console.warn('Backend NBRB rates proxy failed, falling back to direct browser fetch...');
        response = await fetch('https://www.nbrb.by/api/exrates/rates?periodicity=0');
      }
      if (!response.ok) throw new Error('NBRB status not ok');
      const data = await response.json();
      
      const foundRates: Record<string, number> = { BYN: 1.0 };
      data.forEach((item: any) => {
        if (item.Cur_Abbreviation === 'USD') {
          foundRates.USD = item.Cur_OfficialRate / item.Cur_Scale;
        } else if (item.Cur_Abbreviation === 'EUR') {
          foundRates.EUR = item.Cur_OfficialRate / item.Cur_Scale;
        } else if (item.Cur_Abbreviation === 'RUB') {
          foundRates.RUB = item.Cur_OfficialRate / item.Cur_Scale;
        }
      });

      if (foundRates.USD && foundRates.EUR && foundRates.RUB) {
        setRates(prev => {
          const merged = { ...prev, ...foundRates };
          localStorage.setItem('ratipa_converter_rates', JSON.stringify(merged));
          return merged;
        });
      }
    } catch (error) {
      console.error('Failed to fetch NBRB rates:', error);
    } finally {
      setIsRatesLoading(false);
    }
  };

  useEffect(() => {
    fetchNbrbRates();
  }, []);

  const updateRate = (currency: string, newRate: number) => {
    const updated = { ...rates, [currency]: newRate };
    setRates(updated);
    localStorage.setItem('ratipa_converter_rates', JSON.stringify(updated));
  };

  const getDisplayValue = (currency: string) => {
    if (activeCurrency === currency) {
      return activeValue;
    }
    const numericVal = parseFloat(activeValue);
    if (isNaN(numericVal) || numericVal === 0) {
      return '';
    }
    const valInByn = numericVal * rates[activeCurrency as keyof typeof rates];
    const targetVal = valInByn / rates[currency as keyof typeof rates];
    if (currency === 'RUB') {
      return targetVal.toFixed(1);
    }
    return targetVal.toFixed(2);
  };

  // Real-time Database references for notification auto-generation
  const [bazaCars, setBazaCars] = useState<any[]>([]);
  const [tripsDashboard, setTripsDashboard] = useState<any[]>([]);

  // Close notifications and converter dropdowns on click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setIsNotifOpen(false);
      }
      if (converterRef.current && !converterRef.current.contains(event.target as Node)) {
        setIsConverterOpen(false);
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

  const unreadNotifsCount = useMemo(() => {
    return notifications.filter(n => !userNotifState[n.id]?.isRead && !userNotifState[n.id]?.isDeleted).length;
  }, [notifications, userNotifState]);

  const filteredNotifications = useMemo(() => {
    const visible = notifications.filter(n => !userNotifState[n.id]?.isDeleted);
    if (notifTab === 'unread') {
      return visible.filter(n => !userNotifState[n.id]?.isRead);
    }
    return visible;
  }, [notifications, notifTab, userNotifState]);

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

  // Set up global hotkeys
  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Esc key: Close chat if open
      if (e.key === 'Escape') {
        if (isChatOpen) {
          setIsChatOpen(false);
        }
      }
      
      // Alt + C : Toggle chat
      if (e.altKey && (e.key === 'c' || e.key === 'с' || e.key === 'C')) {
        e.preventDefault();
        setIsChatOpen(prev => !prev);
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isChatOpen]);

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
  }, [chatMessages, isChatOpen, lastOpenedTime, user.uid]);

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
  }, [activeModule, allowedModules, settings]);

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
    <div className="min-h-screen bg-[#f4f5f6] flex flex-col font-sans transition-all duration-300">
      
      {/* Modern Responsive Capsule Header with high-fidelity layout */}
      <header className="bg-white/95 backdrop-blur-md text-slate-900 border-b border-slate-200/50 min-h-[3.5rem] py-1 md:py-0 md:h-14 flex items-center justify-between px-4 sm:px-8 shrink-0 sticky top-0 z-50 select-none shadow-xs gap-3">
        
        {/* Left Aligned Section combining Brand Area & Nav Menu close to it */}
        <div className="flex items-center gap-6 flex-1 min-w-0">
          {/* Left Brand Area */}
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setIsSidebarOpen(!isSidebarOpen)}
              className="p-1 rounded-xl hover:bg-slate-50 transition lg:hidden focus:outline-none"
            >
              {isSidebarOpen ? <X className="h-6 w-6 text-slate-700" /> : <Menu className="h-6 w-6 text-slate-700" />}
            </button>
            
            <div className="flex items-center gap-2.5 cursor-pointer" onClick={() => handleNavigate(user.role === 'mechanic' ? 'baza' : 'dashboard')}>
              <div className="flex items-baseline font-sans">
                <span className="font-extrabold tracking-[-0.02em] text-base md:text-lg uppercase text-slate-950 leading-none">
                  RATIPA PORTAL
                </span>
              </div>
            </div>
          </div>

          {/* Navigation Menu aligned left, closer to Logo */}
          <nav className="flex items-center gap-1 bg-[#f0f2f4] p-[3px] rounded-full border border-slate-200/50 shadow-inner overflow-x-auto md:overflow-visible whitespace-nowrap scrollbar-none max-w-[50vw] sm:max-w-[70vw] lg:max-w-none flex-nowrap shrink relative">
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
                    className={`text-[9.5px] md:text-[10px] font-extrabold tracking-tight uppercase transition-all duration-150 py-1.5 px-3 md:px-4 rounded-full flex items-center gap-1.5 cursor-pointer shrink-0 select-none ${
                      isChildActive 
                        ? 'text-white bg-slate-950 shadow-xs' 
                        : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
                    }`}
                  >
                    <GroupIcon className={`h-3 w-3 ${isChildActive ? 'text-white' : 'text-slate-400'}`} />
                    <span>{group.label}</span>
                    <ChevronDown className={`h-3 w-3 ${isChildActive ? 'text-white' : 'text-slate-400'} transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
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
                              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all duration-150 ${
                                isActive 
                                  ? 'bg-slate-950 text-white font-extrabold' 
                                  : 'text-slate-600 hover:bg-slate-50 hover:text-slate-950'
                              }`}
                            >
                              <SubIcon className={`h-3.5 w-3.5 ${isActive ? 'text-[#70FC8E]' : 'text-slate-400'}`} />
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
                  className={`text-[9.5px] md:text-[10px] font-extrabold tracking-tight uppercase transition-all duration-150 py-1.5 px-3 md:px-4 rounded-full flex items-center gap-1.5 relative cursor-pointer shrink-0 ${
                    isActive ? 'text-white bg-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
                  }`}
                >
                  <ItemIcon className={`h-3 w-3 ${isActive ? 'text-white' : 'text-slate-400'}`} />
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
              className="text-[9.5px] md:text-[10px] font-extrabold tracking-tight uppercase transition-all duration-150 py-1.5 px-3 md:px-3.5 rounded-full text-slate-500 hover:text-slate-900 hover:bg-white/40 flex items-center gap-1 cursor-pointer shrink-0"
            >
              <ExternalLink className="h-3 w-3 text-slate-400" />
              <span>{extTab.title}</span>
            </a>
          ))}
        </nav>
        </div>

        {/* Right Section: Avatars, Sync state + Profile badge + Logout */}
        <div className="flex items-center gap-4 shrink-0">
          
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
               <div className="h-7 w-7 rounded-full bg-slate-900 border-2 border-white flex items-center justify-center text-[9px] font-black text-[#70FC8E] shadow-xs">
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
              className={`relative p-2 rounded-full border transition-all duration-205 active:scale-95 cursor-pointer flex items-center justify-center ${
                isConverterOpen 
                  ? 'bg-slate-950 text-[#70FC8E] border-slate-950 shadow-md scale-105' 
                  : 'bg-slate-50 text-slate-700 hover:text-slate-950 hover:bg-slate-100 border-slate-200/60'
              }`}
              title="Конвертер валют"
            >
              <DollarSign size={16} />
            </button>

            <AnimatePresence>
              {isConverterOpen && (
                <motion.div
                  initial={{ opacity: 0, y: 10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.95 }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                  className="absolute right-0 mt-3 w-80 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden p-5"
                >
                  <div className="border-b border-slate-100 pb-2.5 mb-3.5 flex justify-between items-center select-none">
                    <div>
                      <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-950 font-sans">Конвертер валют</h3>
                      <p className="text-[9px] text-slate-400 font-mono tracking-widest mt-0.5 uppercase">Курсы из API НБРБ</p>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        fetchNbrbRates();
                      }}
                      disabled={isRatesLoading}
                      title="Обновить курсы из НБРБ"
                      className="p-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-500 hover:text-slate-800 transition-all flex items-center justify-center cursor-pointer active:scale-95 disabled:opacity-50"
                    >
                      <RefreshCw size={10} className={`${isRatesLoading ? 'animate-spin' : ''}`} />
                    </button>
                  </div>

                  <div className="space-y-3">
                    {/* USD Field */}
                    <div>
                      <div className="flex justify-between items-center mb-1 select-none">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider font-mono">USD ($) Доллар</label>
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={getDisplayValue('USD')}
                          onChange={(e) => {
                            setActiveCurrency('USD');
                            setActiveValue(e.target.value.replace(',', '.'));
                          }}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    {/* EUR Field */}
                    <div>
                      <div className="flex justify-between items-center mb-1 select-none">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider font-mono">EUR (€) Евро</label>
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={getDisplayValue('EUR')}
                          onChange={(e) => {
                            setActiveCurrency('EUR');
                            setActiveValue(e.target.value.replace(',', '.'));
                          }}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    {/* BYN Field */}
                    <div>
                      <div className="flex justify-between items-center mb-1 select-none">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider font-mono">BYN (Br) Бел. рубль</label>
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={getDisplayValue('BYN')}
                          onChange={(e) => {
                            setActiveCurrency('BYN');
                            setActiveValue(e.target.value.replace(',', '.'));
                          }}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                          placeholder="0.00"
                        />
                      </div>
                    </div>

                    {/* RUB Field */}
                    <div>
                      <div className="flex justify-between items-center mb-1 select-none">
                        <label className="text-[9px] font-black text-slate-400 uppercase tracking-wider font-mono">RUB (₽) Рус. рубль</label>
                      </div>
                      <div className="relative">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={getDisplayValue('RUB')}
                          onChange={(e) => {
                            setActiveCurrency('RUB');
                            setActiveValue(e.target.value.replace(',', '.'));
                          }}
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                          placeholder="0.00"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Expandable Rates Section */}
                  <div className="mt-4 pt-3 border-t border-slate-100">
                    <button
                      type="button"
                      onClick={() => setShowEditRates(!showEditRates)}
                      className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-800 tracking-wider flex items-center gap-1 cursor-pointer select-none"
                    >
                      <span>{showEditRates ? 'Скрыть курсы' : 'Настройка курсов'}</span>
                      <ChevronDown size={12} className={`transition-transform duration-200 ${showEditRates ? 'rotate-180' : ''}`} />
                    </button>

                    {showEditRates && (
                      <div className="mt-2.5 space-y-2.5 bg-slate-50/50 p-3 rounded-xl border border-slate-100">
                        <span className="text-[8.5px] font-bold text-slate-400 uppercase tracking-widest block font-mono select-none">Курс к 1 BYN:</span>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[8.5px] font-black text-slate-400 uppercase block font-mono mb-1 select-none">1 USD =</label>
                            <input
                              type="number"
                              step="0.01"
                              value={rates.USD}
                              onChange={(e) => updateRate('USD', parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 focus:outline-none"
                            />
                            <span className="text-[8px] text-slate-400 font-mono block mt-0.5 select-none">BYN</span>
                          </div>
                          <div>
                            <label className="text-[8.5px] font-black text-slate-400 uppercase block font-mono mb-1 select-none">1 EUR =</label>
                            <input
                              type="number"
                              step="0.01"
                              value={rates.EUR}
                              onChange={(e) => updateRate('EUR', parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 focus:outline-none"
                            />
                            <span className="text-[8px] text-slate-400 font-mono block mt-0.5 select-none">BYN</span>
                          </div>
                          <div>
                            <label className="text-[8.5px] font-black text-slate-400 uppercase block font-mono mb-1 select-none">1 RUB =</label>
                            <input
                              type="number"
                              step="0.0001"
                              value={rates.RUB}
                              onChange={(e) => updateRate('RUB', parseFloat(e.target.value) || 0)}
                              className="w-full px-2 py-1 bg-white border border-slate-200 rounded-lg text-[11px] font-bold text-slate-800 focus:outline-none"
                            />
                            <span className="text-[8px] text-slate-400 font-mono block mt-0.5 select-none">BYN</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Fully featured Notifications Center dropdown */}
          <div className="relative font-sans" ref={notifRef}>
            <button
              type="button"
              onClick={() => setIsNotifOpen(!isNotifOpen)}
              className={`relative p-2 rounded-full border transition-all duration-205 active:scale-95 cursor-pointer flex items-center justify-center ${
                isNotifOpen 
                  ? 'bg-slate-950 text-[#70FC8E] border-slate-950 shadow-md scale-105' 
                  : 'bg-slate-50 text-slate-700 hover:text-slate-950 hover:bg-slate-100 border-slate-200/60'
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
                  className="absolute right-0 mt-3 w-80 sm:w-96 bg-white border border-slate-200 rounded-2xl shadow-xl z-50 overflow-hidden"
                >
                  {/* Dropdown Header */}
                  <div className="p-4 border-b border-slate-100 bg-white">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-950 font-sans">Уведомления</h3>
                        <p className="text-[9px] text-slate-400 font-mono tracking-widest mt-0.5 uppercase">Системные события и алерты</p>
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
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-slate-50 rounded-full border border-slate-200/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#70FC8E] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#70FC8E]"></span>
            </span>
            <span className="text-[8.5px] font-black tracking-wider uppercase text-slate-600 font-mono">
              Подключено
            </span>
          </div>

          {/* User Badge Profile info */}
          <div className="flex items-center gap-2 pl-1 border-l border-slate-200/50">
            <div className="h-8 w-8 rounded-full bg-slate-900 border border-slate-200 flex items-center justify-center text-xs font-black text-[#70FC8E] shadow-xs">
              {user.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="hidden xl:block text-left text-xs leading-none">
              <div className="font-extrabold text-slate-800">{user.name}</div>
              <span className="text-[8px] uppercase tracking-wider text-slate-400 font-black block mt-0.5">
                {user.role === 'root_admin' ? 'АДМИН' : 'ПОЛЬЗОВАТЕЛЬ'}
              </span>
            </div>
          </div>

          {/* Logout Action Button */}
          <button
            onClick={handleLogoutSequence}
            className="p-1.5 rounded-full text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-transparent transition cursor-pointer"
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
          <aside className="fixed inset-y-20 left-0 w-64 bg-white border-r border-slate-100 flex flex-col z-40 lg:hidden">
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
                                ? 'bg-slate-950 text-white shadow-lg shadow-black/10 scale-102 border-l-4 border-[#00E371]' 
                                : 'text-slate-600 hover:bg-slate-50 hover:text-black'
                            }`}
                          >
                            <IconComp className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#00E371]' : 'text-slate-400'}`} />
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
                          ? 'bg-slate-950 text-white shadow-lg shadow-black/10 scale-102 border-l-4 border-[#00E371]' 
                          : 'text-slate-600 hover:bg-slate-50 hover:text-black'
                      }`}
                    >
                      <IconComp className={`h-4 w-4 shrink-0 ${isActive ? 'text-[#00E371]' : 'text-slate-400'}`} />
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
            className="fixed inset-0 top-20 bg-slate-950/10 backdrop-blur-xs z-30 lg:hidden"
          />
        )}

        {/* Dynamic active viewport card frame with subtle shadow and round corners */}
        <main 
          ref={mainScrollRef} 
          className="flex-1 p-3 sm:p-4 lg:p-6 overflow-y-auto overflow-x-hidden w-full max-w-full relative bg-[#f4f5f6]"
        >
          {allModules.map((mod) => {
            const isAllowed = user.role === 'mechanic' ? (mod.key === 'baza') : (user.role === 'root_admin' || (user.permissions && user.permissions[mod.permissionKey] && user.permissions[mod.permissionKey] !== 'none'));
            if (!isAllowed) return null;

            const isLoaded = loadedModules.includes(mod.key);
            if (!isLoaded) return null;

            const isActive = activeModule === mod.key;

            return (
              <div
                key={mod.key}
                style={{ display: isActive ? 'block' : 'none' }}
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

      {/* Global floating chat button & widget (Relocated to bottom-left) */}
      <div className="fixed bottom-6 left-6 z-[1000] flex flex-col items-start pointer-events-none select-none">
        
        {/* Chat Window */}
        {isChatOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="pointer-events-auto w-[380px] max-w-[calc(100vw-2rem)] h-[500px] bg-slate-900 border border-slate-800 rounded-[2.2rem] shadow-2xl flex flex-col overflow-hidden mb-4 select-text"
          >
            {/* Header */}
            <div className="bg-slate-950 p-4 border-b border-slate-800 flex justify-between items-center select-none">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-[#70FC8E]" />
                <span className="text-xs font-black uppercase text-white tracking-widest">Общий Чат Диспетчеров</span>
                <span className="bg-[#70FC8E]/10 border border-[#70FC8E]/20 text-[#70FC8E] text-[8.5px] font-black px-2 py-0.5 rounded-full uppercase">
                  Live
                </span>
              </div>
              <button 
                onClick={() => setIsChatOpen(false)}
                className="text-slate-500 hover:text-white p-1 hover:bg-slate-800 rounded-full transition cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Message Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-slate-950/20 max-h-[380px]">
              {chatMessages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-xs text-slate-500 font-extrabold font-mono uppercase">
                  Сообщений пока нет
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {chatMessages.map((msg) => {
                    const isOwn = msg.userId === user.uid;
                    const isSys = msg.userId === 'system';
                    
                    // Match user color key
                    const msgUser = usersForColors.find(u => u.uid === msg.userId || u.name === msg.username);
                    const colorKey = msgUser?.color;

                    // Mapped Tailwind style classes for custom message bubbles inside dark wrapper
                    const chatPresets: Record<string, string> = {
                      blue: 'bg-blue-950/50 text-blue-200 border border-blue-800/50',
                      emerald: 'bg-emerald-950/50 text-emerald-200 border border-emerald-800/50',
                      purple: 'bg-purple-950/50 text-purple-200 border border-purple-800/50',
                      amber: 'bg-amber-950/50 text-amber-200 border border-amber-800/50',
                      rose: 'bg-rose-950/50 text-rose-200 border border-rose-800/50',
                      indigo: 'bg-indigo-950/50 text-indigo-200 border border-indigo-800/50',
                      teal: 'bg-teal-950/50 text-teal-200 border border-teal-800/50',
                      orange: 'bg-orange-950/50 text-orange-200 border border-orange-850',
                      slate: 'bg-slate-800/80 text-slate-200 border border-slate-700',
                      yellow: 'bg-yellow-950/55 text-yellow-250 border border-yellow-800/50'
                    };

                    const fontColorMap: Record<string, string> = {
                      blue: 'text-blue-400',
                      emerald: 'text-emerald-400',
                      purple: 'text-purple-400',
                      amber: 'text-[#f59e0b]',
                      rose: 'text-rose-400',
                      indigo: 'text-indigo-400',
                      teal: 'text-teal-400',
                      orange: 'text-orange-400',
                      slate: 'text-slate-400',
                      yellow: 'text-yellow-400'
                    };

                    const usernameClass = colorKey ? fontColorMap[colorKey] : 'text-[#70FC8E]';
                    const isCurrentlyEditing = editingMsgId === msg.id;

                    return (
                      <div key={msg.id} className={`flex flex-col ${isOwn ? 'items-end' : 'items-start'} group animate-fade-in`}>
                        <div className="flex items-center gap-1.5 mb-0.5 px-1">
                          <span className={`text-[10px] font-black ${usernameClass}`}>
                            {msg.username}
                          </span>
                          
                          {/* edit/trash controls for message owners or system admin */}
                          {!isSys && !isCurrentlyEditing && (
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition duration-150">
                              {isOwn && (
                                <button
                                  onClick={() => {
                                    setEditingMsgId(msg.id);
                                    setEditingText(msg.text);
                                  }}
                                  className="text-slate-500 hover:text-[#70FC8E] transition duration-100 cursor-pointer"
                                  title="Редактировать"
                                >
                                  <Pencil className="h-2.5 w-2.5" />
                                </button>
                              )}
                              {true && (
                                <button
                                  onClick={(e) => handleDeleteGlobalMessage(msg.id, e)}
                                  className="text-slate-500 hover:text-rose-500 transition duration-100 cursor-pointer"
                                  title="Удалить"
                                >
                                  <Trash2 className="h-2.5 w-2.5" />
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        <div 
                          className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-xs leading-relaxed whitespace-pre-wrap ${
                            isSys 
                              ? 'bg-[#70FC8E]/5 border border-[#70FC8E]/15 text-[#70FC8E] font-mono' 
                              : colorKey && chatPresets[colorKey]
                                ? `${chatPresets[colorKey]} ${isOwn ? 'rounded-br-none' : 'rounded-bl-none'}`
                                : isOwn 
                                  ? 'bg-[#70FC8E] text-slate-950 rounded-br-none font-bold' 
                                  : 'bg-slate-800 text-slate-200 border border-slate-700 rounded-bl-none'
                          }`}
                        >
                          {isCurrentlyEditing ? (
                            <div className="flex flex-col gap-1.5 w-[250px]">
                              <textarea
                                value={editingText}
                                onChange={(e) => setEditingText(e.target.value)}
                                className="w-full text-xs p-2 bg-slate-900 border border-slate-700 text-slate-100 rounded-xl outline-none focus:border-[#70FC8E] resize-none h-16"
                              />
                              <div className="flex justify-end gap-1.5 select-none">
                                <button 
                                  onClick={() => { setEditingMsgId(null); setEditingText(''); }}
                                  className="px-2 py-1 text-[9px] font-black uppercase text-slate-400 hover:text-white"
                                >
                                  Отмена
                                </button>
                                <button 
                                  onClick={() => handleUpdateMessage(msg.id)}
                                  className="px-2 py-1 text-[9px] font-black uppercase bg-[#70FC8E] text-slate-950 hover:bg-[#5be277] rounded flex items-center justify-center transition"
                                >
                                  Ок
                                </button>
                              </div>
                            </div>
                          ) : (
                            <>
                              {msg.text}
                              {msg.isEdited && <span className="text-[8px] font-semibold text-slate-400 italic block mt-1 select-none">(ред.)</span>}
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              )}
            </div>

            {/* Input Form */}
            <div className="p-3 bg-slate-950 border-t border-slate-800/80 flex gap-2 items-center mt-auto">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleSendGlobalMessage();
                  }
                }}
                placeholder="Напишите сообщение..."
                className="flex-1 bg-slate-900 border border-slate-800 text-slate-100 text-xs px-3.5 py-2.5 rounded-2xl outline-none focus:border-[#70FC8E]"
              />
              <button
                onClick={handleSendGlobalMessage}
                className="bg-[#70FC8E] hover:bg-[#5be277] text-slate-950 font-black h-9 w-9 rounded-2xl flex items-center justify-center transition cursor-pointer"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}

         {/* Sticky Trigger Button */}
        <button
          onClick={() => setIsChatOpen(!isChatOpen)}
          className="pointer-events-auto flex items-center justify-center h-12 w-12 sm:h-14 sm:w-14 rounded-full bg-slate-950 text-[#70FC8E] shadow-[0_8px_30px_rgba(0,0,0,0.30)] hover:scale-105 active:scale-95 transition border border-slate-850 cursor-pointer relative"
        >
          {isChatOpen ? (
            <ChevronDown className="h-5 sm:h-6 w-5 sm:w-6 text-slate-400" />
          ) : (
            <MessageSquare className="h-5 sm:h-6 w-5 sm:w-6" />
          )}

          {/* New message badge count */}
          {!isChatOpen && unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-rose-500 text-white font-black text-[9px] h-5 w-5 rounded-full flex items-center justify-center border-2 border-slate-950">
              {unreadCount}
            </span>
          )}
        </button>

      </div>

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

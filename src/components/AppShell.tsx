import React, {useState, useEffect, useMemo, useRef, Suspense, lazy} from 'react'
import {UserProfile, AppSettings, ChatMessage} from '../types'
import {dbService, database, useFirebase, onValue} from '../api'
import {ref, set, push, update} from 'firebase/database'
import {motion, AnimatePresence} from 'motion/react'
import CommandCenter from './CommandCenter';
import TypingText from './TypingText';
import {useKeyboardShortcuts} from '../hooks/useKeyboardShortcuts'
import { resolvePermission } from '../utils/permissions';
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
  Settings2,
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
  Home,
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
const VehicleDriverDataModule = lazy(() => import('./modules/VehicleDriverDataModule'));

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
  const prevOnlineUsersRef = useRef<string>('');
  const onlineUsersTimeoutRef = useRef<any>(null);

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
  const [activeCurrency, setActiveCurrency] = useState<string>(() => localStorage.getItem('ratipa_converter_currency') || 'USD');
  const [activeValue, setActiveValue] = useState<string>(() => localStorage.getItem('ratipa_converter_value') || '100');
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
  const converterDesktopRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    return dbService.getCurrencies((list) => {
      setAvailableCurrencies(list || []);
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('ratipa_selected_currencies', JSON.stringify(selectedCurrencyCodes));
  }, [selectedCurrencyCodes]);

  useEffect(() => {
    localStorage.setItem('ratipa_converter_currency', activeCurrency);
  }, [activeCurrency]);

  useEffect(() => {
    localStorage.setItem('ratipa_converter_value', activeValue);
  }, [activeValue]);

  const fetchNbrbRates = async () => {
    setIsRatesLoading(true);
    try {
      // Try the server-side API proxy first to bypass client CORS / VPN / network issues
      let response = await fetch('/api/nbrb-rates');
      const contentType = response.headers.get('content-type') || '';
      
      if (!response.ok || !contentType.includes('application/json')) {
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
      const isConverterClick = 
        (converterRef.current && converterRef.current.contains(event.target as Node)) ||
        (converterDesktopRef.current && converterDesktopRef.current.contains(event.target as Node));
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
      const unsubBaza = dbService.getVehicleFleet((list) => setBazaCars(list || []));
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
        update(ref(database, `users/${user.uid}/notificationStates/${id}`), { isRead: !currentReadState }).catch((err) => console.warn("Failed to mark read in firebase", err));
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
          update(ref(database), updates).catch((err) => console.warn("Failed to update notifications in firebase", err));
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
        update(ref(database, `users/${user.uid}/notificationStates/${id}`), { isDeleted: true }).catch((err) => console.warn("Failed to mark deleted in firebase", err));
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
          update(ref(database), updates).catch((err) => console.warn("Failed to update notifications in firebase", err));
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
  const [showScrollTop, setShowScrollTop] = useState(false);

  // Show "scroll to top" button only after the user scrolls down
  useEffect(() => {
    const el = mainScrollRef.current;
    if (!el) return;
    const onScroll = () => setShowScrollTop(el.scrollTop > 300);
    onScroll();
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [activeModule]);

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
      // Стабилизация: не обновляем, если список не изменился
      const key = activeUsers.map((u: any) => u.uid + ':' + u.currentModule + ':' + u.lastActive).join('|');
      if (key !== prevOnlineUsersRef.current) {
        prevOnlineUsersRef.current = key;
        // Debounce: отложенное обновление, чтобы сгладить каскад onValue
        if (onlineUsersTimeoutRef.current) clearTimeout(onlineUsersTimeoutRef.current);
        onlineUsersTimeoutRef.current = setTimeout(() => {
          setOnlineUsers(activeUsers);
        }, 2000);
      }
    });

    return () => {
      cleanup();
      if (typeof unsubscribeOnline === 'function') {
         unsubscribeOnline();
      }
      if (onlineUsersTimeoutRef.current) clearTimeout(onlineUsersTimeoutRef.current);
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
    { key: 'dozvola', label: 'Учет Дозволов', icon: FileText, permissionKey: 'dozvola' },
    { key: 'documents', label: 'Документы', icon: Files, permissionKey: 'documents' },
    { key: 'disposition', label: 'Диспозиция', icon: Map, permissionKey: 'disposition' },
    { key: 'appSettings', label: 'База данных', icon: Settings2, permissionKey: 'settings' },
    { key: 'settings', label: 'Справочники', icon: BookOpen, permissionKey: 'settings' },
    { key: 'admin', label: 'Администрирование', icon: ShieldAlert, permissionKey: 'admin' }
  ];

  // Filter modules based on user's permission (not 'none' and matching admin fields)
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const allowedModules = useMemo(() => {
    if (user.role === 'mechanic') {
      return allModules.filter(mod => mod.key === 'baza');
    }
    return allModules.filter(mod => {
      // Root admin gets everything
      if (user.role === 'root_admin' || user.name.includes('Сергей Root') || user.email === 'r98ratipaby@gmail.com') return true;
      
      // Единая проверка через resolvePermission
      return resolvePermission(user, mod.permissionKey, settings?.rolePermissions) !== 'none';
    });
  }, [user.role, user.name, user.email, user.permissions, settings?.rolePermissions]);

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
      // Fix: ensure g_settings uses appSettings (База данных), not settings (Справочники)
      return settings.menuStructure.map((g: any) => {
        if (g.subtabKeys) {
          return { ...g, subtabKeys: g.subtabKeys.map((k: string) => k === 'settings' ? 'appSettings' : k) };
        }
        return g;
      });
    }
    return [
      { id: 'g_home', label: 'Главная', isDropdown: false, singleModuleKey: 'dashboard' },
      { id: 'g_ops', label: 'Текущее', isDropdown: true, subtabKeys: ['disposition', 'baza', 'documents', 'vehicleDriverData', 'dozvola'] },
      { id: 'g_planning', label: 'Планирование', isDropdown: true, subtabKeys: ['planDohod', 'currentPlanning', 'dohod', 'planZagruzok'] },
      { id: 'g_report', label: 'Отчетность', isDropdown: true, subtabKeys: ['salary'] },
      { id: 'g_settings', label: 'Настройки', isDropdown: true, subtabKeys: ['appSettings', 'admin'] }
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

  // Redirect to first available tab only if the active key is NOT a known module at all
  // (protects against broken/invalid hashes). System/console keys (settings, appSettings,
  // admin, dashboard) are never force-redirected even if absent from allowedModules.
  const SYSTEM_MODULE_KEYS = ['dashboard', 'settings', 'appSettings', 'admin'];
  useEffect(() => {
    const knownKeys = allModules.map(m => m.key);
    if (!knownKeys.includes(activeModule) && !SYSTEM_MODULE_KEYS.includes(activeModule)) {
      if (allowedModules.length > 0) {
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
        return <DirectoriesModule user={user} />;
      case 'appSettings':
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
      {!useFirebase && (
        <div className="bg-amber-500 text-white text-[11px] font-bold text-center py-1 px-3">
          ⚠ Офлайн-режим: данные сохраняются только локально на этом устройстве и не синхронизируются с сервером.
        </div>
      )}
      
      {/* Modern Responsive Capsule Header - fully blended light premium top bar */}
 <header className="bg-white text-slate-900 border-b border-slate-200/35 min-h-[3.5rem] py-1 md:py-0 md:h-14 flex items-center justify-between px-3 sm:px-8 shrink-0 sticky top-0 z-50 select-none gap-2 sm:gap-3 transition-colors duration-300">
        
        {/* Left: Currency Converter on mobile */}
        <div className="md:hidden flex items-center shrink-0">
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
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-6 flex-1 min-w-0">
          {/* Left Brand Area */}
          <div className="flex items-center gap-3 shrink-0 flex-1 md:flex-none justify-center md:justify-start">
            
            <div className="flex items-center gap-3 cursor-pointer group" onClick={() => handleNavigate(user.role === 'mechanic' ? 'baza' : 'dashboard')}>
              <div className="flex items-baseline gap-1.5 font-sans">
                <span className="font-medium tracking-tight text-sm md:text-base uppercase text-slate-900 leading-none group-hover:text-[#3765F6] transition-colors duration-200">
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
          <nav className="hidden md:flex items-center gap-1.5 p-1 rounded-2xl overflow-x-auto lg:overflow-visible whitespace-nowrap scrollbar-none max-w-[50vw] sm:max-w-[70vw] lg:max-w-none flex-nowrap shrink relative">
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
                        ? 'text-[#3765F6] bg-[#3765F6]/8 border-[#3765F6]/20 shadow-2xs font-semibold' 
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
                                  ? 'bg-[#3765F6]/8 text-[#3765F6] font-semibold border border-[#3765F6]/15' 
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
                      ? 'text-[#3765F6] bg-[#3765F6]/8 border-[#3765F6]/20 shadow-2xs font-semibold' 
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
               <div className="h-7 w-7 rounded-full bg-[#3765F6] border-2 border-white flex items-center justify-center text-[9px] font-semibold text-white shadow-xs">
                 +{onlineUsers.length - 3}
               </div>
            )}
            
            {/* Hover Popover with full user list */}
            {onlineUsers.length > 0 && (
              <div className="absolute top-full right-0 mt-2 w-48 bg-white border border-slate-200 shadow-xl rounded-xl p-3 opacity-0 group-hover:opacity-100 invisible group-hover:visible transition-all duration-200 z-50">
                <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider mb-2 block">Пользователи онлайн</span>
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1 custom-scrollbar">
                  {onlineUsers.map(u => (
                    <div key={u.presenceId} className="flex items-center gap-2">
                       <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)] shrink-0"></span>
                       <span className="text-xs font-bold text-slate-800 truncate" title={`${u.name} (${u.role})`}>{u.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Currency Converter Widget - desktop only */}
          <div className="hidden md:block relative font-sans" ref={converterDesktopRef}>
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
          </div>

          {/* Fully featured Notifications Center dropdown */}

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
          <div className="flex items-center gap-2.5 pl-1.5 sm:pl-2.5">
            <div className="h-7.5 w-7.5 rounded-xl bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/20 flex items-center justify-center text-[11px] font-semibold shadow-3xs select-none">
              {user.name.substring(0, 2).toUpperCase()}
            </div>
            <div className="hidden xl:block text-left text-xs leading-none">
              <div className="font-bold text-slate-900 tracking-tight">{user.name}</div>
              <span className="text-[9.5px] font-bold text-slate-400 block mt-0.5 uppercase tracking-wider">
                {user.role === 'root_admin' ? 'Админ' : 'Сотрудник'}
              </span>
            </div>
            {/* Desktop logout button — visible only on xl screens */}
            <button
              onClick={handleLogoutSequence}
              className="hidden xl:flex items-center justify-center min-h-[36px] min-w-[36px] text-slate-400 hover:text-rose-600 transition cursor-pointer ml-1"
              title="Выйти"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </div>


        </div>

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
                      <h3 className="text-xs font-bold text-slate-900 font-sans tracking-tight uppercase">Конвертер валют</h3>
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
                        <span className="text-[9px] font-bold uppercase text-slate-400 tracking-wider">Выберите валюты</span>
                        <button
                          onClick={() => setIsEditingCurrencies(false)}
                          className="text-[10px] font-bold text-[#3765F6] hover:underline uppercase tracking-wider cursor-pointer"
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
                              <span className="absolute left-3 text-xs font-semibold text-slate-400 group-focus-within:text-[#3765F6] transition-colors select-none">{currencySymbol}</span>
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
      </header>

      {/* Main Container workspace */}
      <div className="flex-1 flex relative w-full max-w-full overflow-hidden">

        

        {/* Dynamic active viewport card frame with subtle shadow and round corners */}
        <main 
          ref={mainScrollRef} 
          className={`flex-1 w-full max-w-full relative pb-20 md:pb-0 ${
                      activeModule === 'dashboard' 
                        ? 'p-0 bg-slate-50 overflow-hidden' 
                        : activeModule === 'admin'
                        ? 'p-3 sm:p-4 lg:p-6 bg-slate-50 overflow-y-auto overflow-x-hidden'
                        : 'p-3 sm:p-4 lg:p-6 overflow-y-auto overflow-x-hidden bg-slate-50'
                    }`}
        >
          {allModules.map((mod) => {
            const isSystemModule = ['dashboard', 'settings', 'appSettings', 'admin'].includes(mod.key);
            const isAllowed = isSystemModule
              ? true
              : (user.role === 'mechanic' ? (mod.key === 'baza') : (user.role === 'root_admin' || resolvePermission(user, mod.permissionKey, settings?.rolePermissions) !== 'none'));
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

      {/* Scroll to Top Button (round, only visible after scrolling down) */}
      {showScrollTop && (
        <button
          onClick={() => {
            mainScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }}
          className="fixed right-4 bottom-20 md:bottom-6 z-[1000] flex items-center justify-center w-11 h-11 bg-slate-950 text-[#70FC8E] hover:bg-slate-900 transition-all duration-200 select-none cursor-pointer rounded-full shadow-lg active:scale-95"
          title="Наверх"
        >
          <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
        </button>
      )}

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
                  <div className="p-1.5 bg-slate-900 border border-slate-800 rounded-lg text-[#70FC8E] mt-0.5">
                    <BellRing className="h-4.5 w-4.5" />
                  </div>
                  <div>
                    <span className="text-[9.5px] font-bold uppercase tracking-widest text-[#70FC8E] block">
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
                className="w-full mt-1.5 py-2 px-4 bg-[#70FC8E] hover:bg-[#5be277] active:scale-98 text-slate-950 font-bold text-[10px] uppercase tracking-widest rounded-xl transition-all duration-150 cursor-pointer flex items-center justify-center gap-1.5 shadow-md"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                Прочитано / Закрыть
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Mobile bottom navigation (small screens only) */}
 <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-slate-200 flex items-stretch justify-around px-3 py-2 select-none" style={{paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))'}}>
        {[
          { key: 'dashboard', label: 'Главная', icon: Home },
          { key: 'planZagruzok', label: 'Загрузки', icon: FileSpreadsheet },
          { key: 'dohod', label: 'Калькуляция', icon: Calculator },
        ].map((item) => {
          const Icon = item.icon;
          const active = activeModule === item.key;
          return (
            <button
              key={item.key}
              onClick={() => { setIsMobileMenuOpen(false); handleNavigate(item.key); }}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-all duration-150 ${active ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
            >
              <Icon className="h-6 w-6" strokeWidth={1.5} fill="none" />
              <span className={`text-[11px] leading-tight text-center ${active ? 'font-semibold text-slate-900' : 'font-normal text-slate-400'}`}>{item.label}</span>
            </button>
          );
        })}
        <button
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className={`flex-1 flex flex-col items-center justify-center gap-1 py-1.5 rounded-xl transition-all duration-150 ${isMobileMenuOpen ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
        >
          <Menu className="h-6 w-6" strokeWidth={1.5} fill="none" />
          <span className={`text-[11px] leading-tight text-center ${isMobileMenuOpen ? 'font-semibold text-slate-900' : 'font-normal text-slate-400'}`}>Меню</span>
        </button>
      </nav>

      {/* Mobile "all tools" panel (small screens only) */}
      {isMobileMenuOpen && (
 <div className="md:hidden fixed inset-0 z-40 bg-slate-950/20 overflow-y-auto" onClick={() => setIsMobileMenuOpen(false)}>
          <div className="min-h-full flex items-end justify-center px-2 pt-2 pb-20" onClick={(e) => e.stopPropagation()}>
            <div className="w-full bg-white rounded-[1.75rem] border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.08)] p-6">
              <div className="flex items-center justify-between mb-5 px-1">
                <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">Все инструменты</span>
                <button onClick={() => setIsMobileMenuOpen(false)} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-600 transition cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-3">
              {allowedModules.map((mod) => {
                const Icon = mod.icon || Calendar;
                const active = activeModule === mod.key;
                return (
                  <button
                    key={mod.key}
                    onClick={() => { setIsMobileMenuOpen(false); handleNavigate(mod.key); }}
                    className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl transition-all duration-150 active:scale-95 ${
                      active 
                        ? 'bg-slate-900 text-white shadow-sm border border-slate-800' 
                        : 'bg-slate-50 text-slate-600 hover:bg-slate-100 border border-transparent'
                    }`}
                  >
                    <Icon className="h-6 w-6" strokeWidth={1.5} fill="none" />
                    <span className="text-[11px] font-medium leading-tight text-center">{mod.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-3 mt-6 pt-5 border-t border-slate-100">
              <button
                onClick={() => window.location.reload()}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-slate-100 hover:bg-slate-200 transition text-slate-700 font-semibold text-xs active:scale-95 min-h-[44px]"
              >
                <RefreshCw className="h-5 w-5" /> Обновить
              </button>
              <button
                onClick={() => { setIsMobileMenuOpen(false); handleLogoutSequence(); }}
                className="flex items-center justify-center gap-2 py-3 rounded-xl bg-rose-100 hover:bg-rose-200 transition text-rose-600 font-semibold text-xs active:scale-95 min-h-[44px]"
              >
                <LogOut className="h-5 w-5" /> Выход
              </button>
            </div>
          </div>
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
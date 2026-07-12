import React, { useState, useEffect } from 'react';
import { UserProfile, AuditLog, AppSettings, Vehicle, TripPlan, Permit, HighlightData } from '../../types';
import { dbService } from '../../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  Users, 
  ExternalLink, 
  FileText, 
  Truck, 
  ChevronRight,
  ChevronLeft,
  Edit2,
  Save,
  X,
  Sparkles,
  Plus,
  Trash2,
  Clock,
  ArrowRight,
  TrendingUp,
  Calculator,
  Wallet,
  FileSpreadsheet,
  Calendar,
  Files,
  Map,
  Settings,
  ShieldAlert,
  LayoutDashboard
} from 'lucide-react';

const formatDateToRu = (dateVal: any): string => {
  if (!dateVal) return '';
  try {
    const cleanVal = String(dateVal).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanVal)) {
      const [y, m, d] = cleanVal.split('-');
      return `${d}.${m}.${y}`;
    }
    const dateObj = new Date(cleanVal);
    if (!isNaN(dateObj.getTime())) {
      const d = String(dateObj.getDate()).padStart(2, '0');
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const y = dateObj.getFullYear();
      return `${d}.${m}.${y}`;
    }
  } catch (e) {
    // fallback
  }
  return String(dateVal);
};

const getTimeOfDayGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Доброго дня';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
};

const SUGGESTED_BACKGROUND_ITEMS = [
  { key: 'planDohod', label: 'План дохода', icon: TrendingUp, color: 'text-[#3765F6]', top: '14%', left: '4%', delay: 0, duration: 16, xDist: 24, yDist: 20 },
  { key: 'currentPlanning', label: 'Текущее планирование', icon: Calendar, color: 'text-rose-500', top: '46%', left: '3%', delay: 1.5, duration: 19, xDist: 26, yDist: 18 },
  { key: 'baza', label: 'База', icon: Truck, color: 'text-emerald-500', top: '76%', left: '8%', delay: 0.8, duration: 15, xDist: 20, yDist: 22 },
  { key: 'dohod', label: 'Калькуляция', icon: Calculator, color: 'text-indigo-500', top: '12%', right: '8%', delay: 3, duration: 18, xDist: -26, yDist: 20 },
  { key: 'documents', label: 'Документы', icon: Files, color: 'text-purple-500', top: '42%', right: '3%', delay: 0.5, duration: 17, xDist: -22, yDist: 18 },
  { key: 'analysis', label: 'Аналитика', icon: Activity, color: 'text-cyan-500', top: '72%', right: '6%', delay: 2.2, duration: 16, xDist: -24, yDist: 16 },
  { key: 'dozvola', label: 'Дозвола', icon: FileText, color: 'text-teal-500', top: '22%', left: '12%', delay: 4, duration: 18, xDist: 24, yDist: -18 },
  { key: 'settings', label: 'Справочники', icon: Settings, color: 'text-[#606E80]', top: '56%', right: '12%', delay: 1.2, duration: 20, xDist: -22, yDist: -20 }
];

interface DashboardModuleProps {
  user: UserProfile;
  onNavigate: (module: string) => void;
}

export default function DashboardModule({ user, onNavigate }: DashboardModuleProps) {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<TripPlan[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [isDbOnline, setIsDbOnline] = useState(false);
  const [isEditingHighlight, setIsEditingHighlight] = useState(false);
  const [timeStr, setTimeStr] = useState('');
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const [backgroundPills, setBackgroundPills] = useState<typeof SUGGESTED_BACKGROUND_ITEMS>([]);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  // Launcher, Highlight Modal, and Search States
  const [isLauncherOpen, setIsLauncherOpen] = useState(false);
  const [selectedPreviewHighlight, setSelectedPreviewHighlight] = useState<HighlightData | null>(null);
  const [launcherSearch, setLauncherSearch] = useState('');
  const [hoveredPillKey, setHoveredPillKey] = useState<string | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion) return;
    
    let frameId: number;
    const handleMouseMove = (e: MouseEvent) => {
      frameId = requestAnimationFrame(() => {
        const x = (e.clientX / window.innerWidth) - 0.5;
        const y = (e.clientY / window.innerHeight) - 0.5;
        setMousePos({ x, y });
      });
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      cancelAnimationFrame(frameId);
    };
  }, [prefersReducedMotion]);

  useEffect(() => {
    // Pick a randomized subset of 5 suggested tools so the background stays fresh
    const shuffled = [...SUGGESTED_BACKGROUND_ITEMS].sort(() => 0.5 - Math.random());
    setBackgroundPills(shuffled.slice(0, 5));
  }, []);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', second: '2-digit' };
      setTimeStr(now.toLocaleTimeString('ru-RU', options));
    };
    updateTime();
    const timer = setInterval(updateTime, 1000);
    return () => clearInterval(timer);
  }, []);
  
  // Carousel states
  const [activeSlideIndex, setActiveSlideIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const [editHighlights, setEditHighlights] = useState<HighlightData[]>([]);
  const [selectedEditIndex, setSelectedEditIndex] = useState<number>(0);

  const currentHighlights = settings?.highlights && Array.isArray(settings.highlights) && settings.highlights.length > 0
    ? settings.highlights
    : (settings?.highlight ? [settings.highlight] : []);

  useEffect(() => {
    if (activeSlideIndex >= currentHighlights.length) {
      setActiveSlideIndex(Math.max(0, currentHighlights.length - 1));
    }
  }, [currentHighlights.length, activeSlideIndex]);

  useEffect(() => {
    if (isEditingHighlight || currentHighlights.length <= 1 || isHovered) return;

    const interval = setInterval(() => {
      setActiveSlideIndex((prev) => (prev + 1) % currentHighlights.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isEditingHighlight, currentHighlights.length, isHovered]);

  useEffect(() => {
    // 1. Sync Audit Logs
    const unsubscribeAudit = dbService.getAuditLogs(setAuditLogs);

    // 2. Sync Settings/Announcements
    const unsubscribeSettings = dbService.getSettings(setSettings);

    // 4. Sync metrics counts
    const unsubscribeVehicles = dbService.getVehicles(setVehicles);
    const unsubscribeTrips = dbService.getTrips(setTrips);
    const unsubscribePermits = dbService.getPermits(setPermits);

    // Is DB connected
    setIsDbOnline(dbService.isOnline());

    return () => {
      if (typeof unsubscribeAudit === 'function') unsubscribeAudit();
      if (typeof unsubscribeSettings === 'function') unsubscribeSettings();
      if (typeof unsubscribeVehicles === 'function') unsubscribeVehicles();
      if (typeof unsubscribeTrips === 'function') unsubscribeTrips();
      if (typeof unsubscribePermits === 'function') unsubscribePermits();
    };
  }, []);

  const isAdmin = user.role === 'admin' || user.role === 'root_admin';

  const startEditHighlight = () => {
    const existing = settings?.highlights && Array.isArray(settings.highlights) && settings.highlights.length > 0
      ? settings.highlights
      : (settings?.highlight ? [settings.highlight] : []);

    if (existing.length === 0) {
      existing.push({
        id: 'h_' + Date.now(),
        title: '',
        text: '',
        imageUrl: '',
        date: new Date().toISOString().split('T')[0],
        author: user.name
      });
    }

    const normalized = existing.map((h, i) => ({
      ...h,
      id: h.id || `h_${Date.now()}_${i}`
    }));

    setEditHighlights(JSON.parse(JSON.stringify(normalized)));
    setSelectedEditIndex(0);
    setIsEditingHighlight(true);
  };

  const handleFieldChange = (field: keyof HighlightData, value: any) => {
    setEditHighlights(prev => {
      const copy = [...prev];
      if (copy[selectedEditIndex]) {
        copy[selectedEditIndex] = {
          ...copy[selectedEditIndex],
          [field]: value
        };
      }
      return copy;
    });
  };

  const addEditSlide = () => {
    const newSlide: HighlightData = {
      id: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      title: 'Новый Слайд ' + (editHighlights.length + 1),
      text: '',
      imageUrl: '',
      date: new Date().toISOString().split('T')[0],
      author: user.name
    };
    setEditHighlights([...editHighlights, newSlide]);
    setSelectedEditIndex(editHighlights.length);
  };

  const deleteEditSlide = (indexToDelete: number) => {
    if (editHighlights.length <= 1) return;
    const filtered = editHighlights.filter((_, idx) => idx !== indexToDelete);
    setEditHighlights(filtered);
    if (selectedEditIndex >= filtered.length) {
      setSelectedEditIndex(Math.max(0, filtered.length - 1));
    }
  };

  const saveHighlight = async () => {
    if (settings) {
      const cleaned = editHighlights.map(h => ({
        ...h,
        title: h.title.trim(),
        text: h.text.trim(),
        imageUrl: h.imageUrl?.trim() || ''
      })).filter(h => h.title !== '' || h.text !== '');

      if (cleaned.length === 0) {
        cleaned.push({
          id: 'h_1',
          title: 'Внимание: Летние ограничения',
          text: 'Вводится летнее ограничение на проезд тяжеловозов по южным трассам.',
          imageUrl: 'https://images.unsplash.com/photo-1544620347-c4fd6a3d5957?q=80&w=2000&auto=format&fit=crop',
          date: new Date().toISOString().split('T')[0],
          author: user.name
        });
      }

      const updatedSettings = {
        ...settings,
        highlights: cleaned,
        highlight: cleaned[0]
      };

      await dbService.saveSettings(updatedSettings, user.name, user.role);
      setIsEditingHighlight(false);
      setActiveSlideIndex(0);
    }
  };

  // Allowed tools list for background, launcher, and navigation
  const allModulesList = [
    { key: 'planDohod', label: 'План Дохода', icon: TrendingUp, description: 'Финансовое планирование по машинам, операционные заметки и блокнот', permissionKey: 'planDohod', iconColor: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' },
    { key: 'currentPlanning', label: 'Текущее планирование', icon: Calendar, description: 'Календарь рейсов, планирование загрузок и распределение', permissionKey: 'currentPlanning', iconColor: 'bg-rose-500/10 text-rose-400 border border-rose-500/20' },
    { key: 'baza', label: 'Учет выезда (База)', icon: Truck, description: 'Оперативный контроль машин на базе, ремонтах и в рейсе', permissionKey: 'baza', iconColor: 'bg-sky-500/10 text-sky-400 border border-sky-500/20' },
    { key: 'dohod', label: 'Калькуляция', icon: Calculator, description: 'Расчет затрат, маржинальности и стоимости маршрутов', permissionKey: 'dohod', iconColor: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' },
    { key: 'salary', label: 'Зарплата', icon: Wallet, description: 'Контроль начислений и выплат водителям', permissionKey: 'salary', iconColor: 'bg-amber-500/10 text-amber-400 border border-amber-500/20' },
    { key: 'planZagruzok', label: 'План Загрузок', icon: FileSpreadsheet, description: 'Табличный план погрузок и логистических цепочек', permissionKey: 'planZagruzok', iconColor: 'bg-violet-500/10 text-violet-400 border border-violet-500/20' },
    { key: 'vehicleDriverData', label: 'Авто и Водители', icon: Users, description: 'Реестр тягачей, полуприцепов и карточки водителей', permissionKey: 'vehicleDriverData', iconColor: 'bg-blue-500/10 text-blue-400 border border-blue-500/20' },
    { key: 'dozvola', label: 'Учет Дозволов', icon: FileText, description: 'Управление разрешениями и дозволами', permissionKey: 'dozvola', iconColor: 'bg-teal-500/10 text-teal-400 border border-teal-500/20' },
    { key: 'documents', label: 'Документы', icon: Files, description: 'Архив и реестры документов, накладных и счетов', permissionKey: 'documents', iconColor: 'bg-purple-500/10 text-purple-400 border border-purple-500/20' },
    { key: 'disposition', label: 'Диспозиция', icon: Map, description: 'Геолокация, интерактивная карта и трекинг', permissionKey: 'disposition', iconColor: 'bg-orange-500/10 text-orange-400 border border-orange-500/20' },
    { key: 'analysis', label: 'Аналитика', icon: Activity, description: 'Статистика, диаграммы и отчеты компании', permissionKey: 'analysis', iconColor: 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' },
    { key: 'settings', label: 'Справочники', icon: Settings, description: 'Управление справочниками системы и параметрами', permissionKey: 'settings', iconColor: 'bg-slate-500/10 text-slate-400 border border-slate-500/20' },
    { key: 'admin', label: 'Администрирование', icon: ShieldAlert, description: 'Настройка прав доступа, логов и системных опций', permissionKey: 'admin', iconColor: 'bg-red-500/10 text-red-400 border border-red-500/20' }
  ];

  const allowedTools = allModulesList.filter(mod => {
    if (user.role === 'mechanic') {
      return mod.key === 'baza';
    }
    if (user.role === 'root_admin' || user.name.includes('Сергей Root') || user.email === 'r98ratipaby@gmail.com') return true;
    if (user.permissions && user.permissions[mod.permissionKey] !== undefined) {
      return user.permissions[mod.permissionKey] !== 'none';
    }
    const role = user.role;
    if (role === 'admin' || role === 'manager') {
      if (mod.permissionKey === 'admin') return role === 'admin';
      return true;
    }
    return false;
  });

  const filteredTools = allowedTools.filter(mod => {
    const s = launcherSearch.toLowerCase().trim();
    if (!s) return true;
    return mod.label.toLowerCase().includes(s) || mod.description.toLowerCase().includes(s);
  });

  // Quick stats calculations
  const totalVehiclesOnBase = vehicles.filter(v => v.status === 'base').length;
  const totalVehiclesOnRepair = vehicles.filter(v => v.status === 'repair').length;
  const totalActiveTrips = trips.filter(t => !t.isArchived).length;
  const totalAvailablePermits = permits.filter(p => p.status === 'available').length;

  return (
    <div className="w-full relative min-h-screen flex flex-col justify-between p-6 sm:p-8 md:p-10 select-none text-slate-900 overflow-hidden">
      
      {/* 1. Base solid background layer - Completely stable, no gaps, matches screen */}
      <div className="absolute inset-0 bg-slate-50 pointer-events-none z-0" />

      {/* 2. Technical overlay grid over base */}
      <div className="absolute inset-0 tech-grid opacity-[0.08] pointer-events-none z-0" />
      
      {/* 3. Cursor-reactive ambient glow layers with graceful independent movement and reduced-motion check */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
        <motion.div
          className="absolute -top-32 -left-32 w-[650px] h-[650px] rounded-full bg-[#3765F6]/14 blur-[130px] md:blur-[170px]"
          animate={prefersReducedMotion ? {
            x: [0, 20, -10, 0],
            y: [0, -15, 15, 0],
          } : {
            x: mousePos.x * 70,
            y: mousePos.y * 70,
          }}
          transition={prefersReducedMotion ? {
            duration: 25,
            repeat: Infinity,
            ease: "easeInOut"
          } : {
            type: 'spring',
            stiffness: 30,
            damping: 22
          }}
        />
        <motion.div
          className="absolute -bottom-32 right-[10%] w-[700px] h-[550px] rounded-full bg-[#70FC8E]/11 blur-[130px] md:blur-[170px]"
          animate={prefersReducedMotion ? {
            x: [0, -20, 20, 0],
            y: [0, 15, -15, 0],
          } : {
            x: mousePos.x * -55,
            y: mousePos.y * -55,
          }}
          transition={prefersReducedMotion ? {
            duration: 30,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 2
          } : {
            type: 'spring',
            stiffness: 35,
            damping: 24
          }}
        />
        <motion.div
          className="absolute top-[20%] left-[25%] w-[500px] h-[500px] rounded-full bg-blue-500/5 blur-[120px] md:blur-[160px]"
          animate={prefersReducedMotion ? {} : {
            x: mousePos.x * 40,
            y: mousePos.y * -40,
          }}
          transition={{
            type: 'spring',
            stiffness: 40,
            damping: 26
          }}
        />
      </div>

      {/* 4. Ambient Floating Pills/Cards in the background with slow drift and hover interactivity */}
      {backgroundPills.map((pill, idx) => {
        const IconComp = pill.icon;
        const stylePos: React.CSSProperties = {
          position: 'absolute',
          top: pill.top,
          ...(pill.left ? { left: pill.left } : { right: pill.right }),
        };
        const isHoveredPill = hoveredPillKey === pill.key;

        return (
          <motion.div
            key={`${pill.key}-${idx}`}
            style={stylePos}
            tabIndex={0}
            onClick={() => onNavigate(pill.key)}
            onMouseEnter={() => setHoveredPillKey(pill.key)}
            onMouseLeave={() => setHoveredPillKey(null)}
            onFocus={() => setHoveredPillKey(pill.key)}
            onBlur={() => setHoveredPillKey(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onNavigate(pill.key);
              }
            }}
            className="hidden md:flex items-center gap-2.5 px-3.5 py-2 bg-white/45 border border-slate-200/35 rounded-full text-xs font-semibold text-slate-500/80 cursor-pointer z-10 shadow-3xs backdrop-blur-3xs transition-all duration-200 select-none outline-none focus-visible:ring-2 focus-visible:ring-[#3765F6]/40 opacity-60 hover:opacity-100 focus:opacity-100 active:opacity-100"
            animate={prefersReducedMotion ? {} : {
              x: isHoveredPill ? [0, pill.xDist * 0.15, 0] : [0, pill.xDist * 0.75, 0],
              y: isHoveredPill ? [0, pill.yDist * 0.15, 0] : [0, pill.yDist * 0.75, 0],
            }}
            whileHover={prefersReducedMotion ? {} : {
              scale: 1.03,
              filter: 'brightness(1.04)',
              backgroundColor: 'rgba(255, 255, 255, 0.96)',
              borderColor: 'rgba(55, 101, 246, 0.65)',
              boxShadow: '0 8px 24px -4px rgba(55, 101, 246, 0.16), 0 0 16px rgba(55, 101, 246, 0.1)',
              color: '#181d25',
            }}
            transition={prefersReducedMotion ? { duration: 0.2 } : {
              duration: isHoveredPill ? pill.duration * 3.0 : pill.duration * 1.2,
              repeat: Infinity,
              ease: "easeInOut",
              delay: isHoveredPill ? 0 : pill.delay,
            }}
          >
            <IconComp size={12.5} className={`${pill.color} ${isHoveredPill ? 'opacity-100 scale-105' : 'opacity-70'} transition-all duration-200`} />
            <span className="font-sans text-[11px] font-bold tracking-tight">{pill.label}</span>
          </motion.div>
        );
      })}

      {/* TOP ZONE: Clean operational indicators with no heavy borders or system labels */}
      <div className="relative z-10 w-full flex flex-col sm:flex-row items-center justify-end gap-4 pb-4 mb-4 select-none">
        {/* Real-time Clock */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-white/95 border border-slate-200/60 rounded-2xl px-4 py-2 flex items-center gap-2 shadow-xs">
            <Clock size={13} className="text-[#3765F6] animate-pulse" />
            <span className="font-mono text-xs font-black text-slate-800">{timeStr || "00:00:00"}</span>
          </div>
        </div>
      </div>

      {/* CENTER ZONE: Central command greeting & primary CTAs */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center max-w-4xl mx-auto py-6 select-none">
        
        {/* Dynamic customized display name greeting - no gradient, calm product typography */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight mb-3 select-text font-sans text-slate-900">
          {getTimeOfDayGreeting()}, <span className="text-[#3765F6]">{user?.name || "Пользователь"}</span>
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto leading-relaxed mb-8 font-medium">
          Добро пожаловать в единую операционную среду Ratipa. Управляйте парком автомобилей, планируйте доходность и координируйте логистику в реальном времени.
        </p>

        {/* Operational Announcement Card / News Briefing block (Highlights as elegant news-card) */}
        {(currentHighlights.length > 0 || isAdmin) && (() => {
          const slide = currentHighlights[activeSlideIndex];
          const defaultImage = 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?q=80&w=800&auto=format&fit=crop';
          const isImageBroken = slide ? !!imageErrors[slide.id || activeSlideIndex] : false;
          const displayImageUrl = (slide && slide.imageUrl && !isImageBroken) ? slide.imageUrl : defaultImage;

          return (
            <div 
              className="w-full max-w-2xl bg-white/95 border border-slate-200/80 rounded-3xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 mb-8 relative select-none text-left flex flex-col md:flex-row cursor-pointer"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              onClick={() => {
                if (slide) {
                  setSelectedPreviewHighlight(slide);
                }
              }}
            >
              {/* Left/Top Column: Image preview */}
              <div className="w-full md:w-2/5 h-44 md:h-auto min-h-[140px] relative overflow-hidden bg-slate-100 shrink-0">
                <img 
                  src={displayImageUrl} 
                  alt={slide?.title || 'Новость'}
                  className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (slide) {
                      setImageErrors(prev => ({ ...prev, [slide.id || activeSlideIndex]: true }));
                    }
                  }}
                />
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-rose-600 text-white font-sans font-bold tracking-wide text-[9px] px-2.5 py-1 rounded-lg shadow-sm">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                  </span>
                  <span>{slide?.isImportant ? 'Важно' : 'Новость'}</span>
                </div>
              </div>

              {/* Right/Bottom Column: Content & controls */}
              <div className="flex-1 p-5 md:p-6 flex flex-col justify-between gap-4">
                <div className="space-y-1.5">
                  {/* Meta details header row */}
                  <div className="flex items-center justify-between text-xs font-sans font-medium text-slate-400">
                    <span className="font-semibold">{slide?.author || 'Редакция'}</span>
                    <span>{slide?.date ? formatDateToRu(slide.date) : ''}</span>
                  </div>

                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeSlideIndex}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <h4 className="font-extrabold text-slate-900 text-base leading-snug mb-1 hover:text-[#3765F6] transition-colors line-clamp-1">
                        {slide?.title || 'Важная информация'}
                      </h4>
                      <p className="text-slate-500 text-xs leading-relaxed font-medium line-clamp-2 md:line-clamp-3">
                        {slide?.text || 'Активных объявлений нет.'}
                      </p>
                    </motion.div>
                  </AnimatePresence>
                </div>

                {/* Bottom controls / indicators */}
                <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-1" onClick={(e) => e.stopPropagation()}>
                  <span className="text-xs text-slate-400 font-medium font-sans">
                    Новость {activeSlideIndex + 1} из {currentHighlights.length}
                  </span>

                  <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200/60 rounded-xl p-1 shadow-2xs">
                    {currentHighlights.length > 1 && (
                      <>
                        <button 
                          onClick={() => setActiveSlideIndex(prev => (prev - 1 + currentHighlights.length) % currentHighlights.length)}
                          className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition cursor-pointer bg-transparent border border-transparent"
                          title="Назад"
                        >
                          <ChevronLeft size={13} />
                        </button>
                        <button 
                          onClick={() => setActiveSlideIndex(prev => (prev + 1) % currentHighlights.length)}
                          className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-700 transition cursor-pointer bg-transparent border border-transparent"
                          title="Вперед"
                        >
                          <ChevronRight size={13} />
                        </button>
                      </>
                    )}
                    {isAdmin && (
                      <button 
                        onClick={startEditHighlight} 
                        className="p-1.5 rounded-lg hover:bg-[#3765F6]/10 text-slate-400 hover:text-[#3765F6] transition cursor-pointer shrink-0 bg-transparent border border-transparent"
                        title="Редактировать новость"
                      >
                        <Edit2 size={12} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* Direct action controllers */}
        <div className="flex flex-col sm:flex-row items-center gap-4 relative z-20 w-full sm:w-auto">
          <button
            onClick={() => onNavigate('planDohod')}
            className="w-full sm:w-auto px-8 py-4 bg-[#3765F6] hover:bg-blue-600 text-white font-extrabold text-xs tracking-wider uppercase rounded-2xl shadow-md shadow-blue-500/10 hover:shadow-blue-500/20 transition duration-150 flex items-center justify-center gap-2 cursor-pointer border border-transparent"
          >
            <span>ОТКРЫТЬ ПЛАН ДОХОДА</span>
            <ArrowRight size={14} className="stroke-[2.5]" />
          </button>
          
          <button
            onClick={() => onNavigate('dohod')}
            className="w-full sm:w-auto px-8 py-4 bg-white border border-slate-200 hover:border-[#3765F6]/40 text-slate-700 hover:text-slate-900 font-extrabold text-xs tracking-wider uppercase rounded-2xl shadow-xs hover:bg-slate-50 transition duration-150 flex items-center justify-center gap-2.5 cursor-pointer group"
          >
            <Calculator size={14} className="text-[#3765F6] group-hover:rotate-12 transition-transform" />
            <span>КАЛЬКУЛЯЦИЯ</span>
            <ChevronRight size={12} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

      </div>

      {/* BOTTOM ZONE: Integrated resources drawer & persistent status tracker */}
      <div className="relative z-10 w-full mt-8 select-none">
        
        {/* Useful Resource Links row */}
        {settings?.quickLinks && settings.quickLinks.length > 0 && (
          <div className="w-full max-w-4xl mx-auto mb-8 p-5 bg-white/60 border border-slate-200/50 rounded-[1.6rem] shadow-2xs">
            <span className="text-xs font-bold text-slate-800 block mb-3 text-center">
              Рекомендуемые ресурсы и полезные ссылки
            </span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {settings.quickLinks.map((link) => (
                <a 
                  key={link.id} 
                  href={link.url} 
                  target="_blank" 
                  rel="noopener noreferrer" 
                  className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 hover:border-[#3765F6]/30 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-[#3765F6] transition-all shadow-xs group hover:scale-[1.01]"
                >
                  <ExternalLink size={11} className="text-slate-400 group-hover:text-[#3765F6] transition-colors shrink-0" />
                  <span className="truncate max-w-[140px]">{link.title}</span>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* COMPREHENSIVE GLASSMORPHIC LAUNCHER OVERLAY MODAL */}
      <AnimatePresence>
        {isLauncherOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-950/90 backdrop-blur-xl z-[999] flex items-center justify-center p-4 overflow-y-auto select-none"
            onClick={() => setIsLauncherOpen(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              transition={{ type: "spring", duration: 0.4 }}
              className="w-full max-w-4xl bg-slate-900/80 border border-slate-800 rounded-[2.5rem] p-6 md:p-8 shadow-2xl relative max-h-[85vh] overflow-y-auto flex flex-col custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close controls */}
              <button 
                onClick={() => setIsLauncherOpen(false)}
                className="absolute top-6 right-6 p-2 rounded-full hover:bg-slate-800/80 text-slate-400 hover:text-white transition cursor-pointer border border-transparent bg-transparent"
              >
                <X size={18} />
              </button>

              {/* Header Zone */}
              <div className="flex items-center gap-3 border-b border-slate-800/60 pb-5 mb-6">
                <LayoutDashboard size={20} className="text-amber-400" />
                <div>
                  <h3 className="text-lg font-black uppercase text-white tracking-wider">Панель рабочих инструментов</h3>
                  <span className="text-[9px] font-mono uppercase tracking-widest text-slate-500 block mt-0.5">Доступно разделов: {allowedTools.length}</span>
                </div>
              </div>

              {/* Launcher Search Bar */}
              <div className="relative mb-6 select-text">
                <input 
                  type="text"
                  placeholder="Быстрый поиск по названию или описанию модуля..."
                  value={launcherSearch}
                  onChange={(e) => setLauncherSearch(e.target.value)}
                  className="w-full bg-slate-950 text-slate-150 text-xs px-5 py-3.5 rounded-2xl border border-slate-800 focus:border-amber-500/50 outline-none focus:ring-1 focus:ring-amber-500/30 transition-all font-medium font-sans"
                />
                {launcherSearch && (
                  <button 
                    onClick={() => setLauncherSearch('')}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 text-xs cursor-pointer font-bold border border-transparent bg-transparent"
                  >
                    Очистить
                  </button>
                )}
              </div>

              {/* Tools Interactive Grid */}
              {filteredTools.length === 0 ? (
                <div className="py-12 text-center text-slate-500 font-mono text-xs uppercase font-extrabold select-none">
                  Разделы не найдены
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 overflow-y-auto pr-1">
                  {filteredTools.map((mod) => {
                    const IconComp = mod.icon;
                    return (
                      <motion.div
                        key={mod.key}
                        whileHover={{ scale: 1.015 }}
                        className="p-4 bg-slate-950/60 hover:bg-slate-950 border border-slate-850 hover:border-amber-500/20 rounded-2xl transition-all duration-150 cursor-pointer flex flex-col justify-between group h-32"
                        onClick={() => {
                          onNavigate(mod.key);
                          setIsLauncherOpen(false);
                        }}
                      >
                        <div className="flex items-start gap-3">
                          <div className={`p-2.5 rounded-xl ${mod.iconColor} shrink-0 transition-all group-hover:scale-105`}>
                            <IconComp size={16} />
                          </div>
                          <div className="min-w-0">
                            <h4 className="text-xs font-black text-white group-hover:text-amber-300 transition-colors uppercase tracking-wide truncate">
                              {mod.label}
                            </h4>
                            <p className="text-slate-400 group-hover:text-slate-350 text-[10px] font-medium leading-normal line-clamp-2 mt-1.5 transition-colors">
                              {mod.description}
                            </p>
                          </div>
                        </div>
                        
                        <div className="flex justify-end items-center text-[9px] font-mono tracking-widest uppercase text-slate-600 group-hover:text-amber-400 font-black transition-colors pt-2">
                          <span>Запустить</span>
                          <ArrowRight size={10} className="ml-1 opacity-0 group-hover:opacity-100 transition-all translate-x-[-4px] group-hover:translate-x-0" />
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* DETAILED HIGHLIGHT PREVIEW COVER MODAL */}
      <AnimatePresence>
        {selectedPreviewHighlight && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[1000] flex items-center justify-center p-4 select-none"
            onClick={() => setSelectedPreviewHighlight(null)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-lg bg-white border border-slate-200 rounded-[2.5rem] overflow-hidden shadow-2xl relative select-text"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Cover Image */}
              <div className="h-56 w-full overflow-hidden relative bg-slate-100">
                <img 
                  src={selectedPreviewHighlight.imageUrl || 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?q=80&w=800&auto=format&fit=crop'} 
                  alt={selectedPreviewHighlight.title}
                  className="w-full h-full object-cover"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent" />
                <button 
                  onClick={() => setSelectedPreviewHighlight(null)}
                  className="absolute top-4 right-4 p-2.5 bg-white/90 hover:bg-white border border-slate-200/50 rounded-full text-slate-700 hover:text-slate-900 shadow-md transition cursor-pointer select-none"
                >
                  <X size={14} className="stroke-[2.5]" />
                </button>

                <div className="absolute bottom-4 left-6 flex items-center gap-1.5 bg-red-600 text-white font-sans font-black uppercase tracking-wider text-[8px] px-2.5 py-1 rounded-lg shadow-sm">
                  <span>{selectedPreviewHighlight.isImportant ? 'СРОЧНО' : 'НОВОСТЬ'}</span>
                </div>
              </div>

              {/* Content Zone */}
              <div className="p-6 md:p-8">
                <h4 className="text-xl md:text-2xl font-black text-slate-900 tracking-tight mb-4">
                  {selectedPreviewHighlight.title}
                </h4>
                <div className="text-slate-600 text-xs sm:text-sm leading-relaxed max-h-48 overflow-y-auto pr-1 font-medium font-sans custom-scrollbar">
                  {selectedPreviewHighlight.text}
                </div>
                
                {/* Optional CTA Link */}
                {selectedPreviewHighlight.linkUrl && (
                  <div className="mt-6">
                    <a 
                      href={selectedPreviewHighlight.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-black text-[#3765F6] hover:text-blue-700 uppercase tracking-widest transition"
                    >
                      <span>Читать подробнее</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                )}

                {/* Meta details */}
                <div className="mt-8 pt-4 border-t border-slate-100 flex items-center justify-between text-[10px] font-mono text-slate-400 uppercase tracking-wider select-none">
                  <span>Автор: {selectedPreviewHighlight.author || "Редакция"}</span>
                  <span>{formatDateToRu(selectedPreviewHighlight.date)}</span>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* HIGH-CONTRAST HIGHLIGHTS EDITOR OVERLAY DIALOG - NEW CLEAN LIGHT STYLE */}
      <AnimatePresence>
        {isEditingHighlight && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[1001] flex items-center justify-center p-4 select-text"
            onClick={() => setIsEditingHighlight(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-2xl bg-white border border-slate-200 rounded-[2.5rem] p-6 md:p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto flex flex-col custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6 select-none">
                <div className="flex items-center gap-2 text-[#3765F6]">
                  <Edit2 size={18} className="stroke-[2.5]" />
                  <span className="text-sm font-black uppercase tracking-wider font-sans">Редактор новостной ленты</span>
                </div>
                <button 
                  onClick={() => setIsEditingHighlight(false)}
                  className="p-1.5 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-800 transition cursor-pointer border border-transparent bg-transparent"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Slider tabs selectors */}
              <div className="flex flex-wrap items-center gap-1.5 mb-6 select-none bg-slate-50 p-1.5 rounded-2xl border border-slate-200/50">
                {editHighlights.map((h, index) => (
                  <button
                    key={h.id || index}
                    type="button"
                    onClick={() => setSelectedEditIndex(index)}
                    className={`px-3.5 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer border border-transparent ${
                      selectedEditIndex === index 
                        ? 'bg-[#3765F6] text-white shadow-sm' 
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200 bg-transparent'
                    }`}
                  >
                    Новость {index + 1}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addEditSlide}
                  className="px-3 py-1.5 rounded-xl bg-slate-200/60 hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-[10px] font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer border border-transparent"
                >
                  <Plus size={12} className="stroke-[2.5]" /> Добавить
                </button>
              </div>

              {/* Current Slide Fields */}
              {editHighlights[selectedEditIndex] && (
                <div className="space-y-5">
                  
                  {/* Grid fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Title */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Заголовок новости</label>
                      <input
                        type="text"
                        className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-[#3765F6]/50 focus:ring-1 focus:ring-[#3765F6]/20 outline-none transition font-sans font-bold"
                        value={editHighlights[selectedEditIndex].title}
                        onChange={(e) => handleFieldChange('title', e.target.value)}
                        placeholder="Например: Введение летних ограничений"
                      />
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Дата публикации</label>
                      <input
                        type="date"
                        className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-[#3765F6]/50 outline-none transition font-sans font-bold"
                        value={editHighlights[selectedEditIndex].date || ''}
                        onChange={(e) => handleFieldChange('date', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Text Description */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Текст новости</label>
                    <textarea
                      rows={3}
                      className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-[#3765F6]/50 focus:ring-1 focus:ring-[#3765F6]/20 outline-none transition resize-none font-sans font-medium"
                      value={editHighlights[selectedEditIndex].text}
                      onChange={(e) => handleFieldChange('text', e.target.value)}
                      placeholder="Подробный информационный текст для сотрудников..."
                    />
                  </div>

                  {/* Image URL with Preset selection */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Ссылка на обложку (или выберите пресет ниже)</label>
                    <input
                      type="text"
                      className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-[#3765F6]/50 outline-none transition font-mono"
                      value={editHighlights[selectedEditIndex].imageUrl || ''}
                      onChange={(e) => handleFieldChange('imageUrl', e.target.value)}
                      placeholder="https://images.unsplash.com/..."
                    />
                    
                    {/* Quick presets list */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                      <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">Быстрый выбор:</span>
                      {[
                        { label: '🚚 В пути', url: 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?q=80&w=800&auto=format&fit=crop' },
                        { label: '📦 Логистика', url: 'https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?q=80&w=800&auto=format&fit=crop' },
                        { label: '🗺️ Дорога', url: 'https://images.unsplash.com/photo-1524661135-423995f22d0b?q=80&w=800&auto=format&fit=crop' },
                        { label: '📅 Офис', url: 'https://images.unsplash.com/photo-1454165804606-c3d57bc86b40?q=80&w=800&auto=format&fit=crop' }
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => handleFieldChange('imageUrl', preset.url)}
                          className="px-2.5 py-1 bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-950 hover:border-slate-300 rounded-lg text-[9px] font-bold transition cursor-pointer"
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Importance & CTA Link inside grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                    {/* Optional link */}
                    <div>
                      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">Ссылка кнопки (опционально)</label>
                      <input
                        type="text"
                        className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-[#3765F6]/50 outline-none transition font-sans"
                        value={editHighlights[selectedEditIndex].linkUrl || ''}
                        onChange={(e) => handleFieldChange('linkUrl', e.target.value)}
                        placeholder="https://..."
                      />
                    </div>

                    {/* Importance flag */}
                    <div className="flex flex-col justify-end pb-3">
                      <label className="relative flex items-center gap-2.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          className="w-4 h-4 rounded text-[#3765F6] border-slate-300 focus:ring-[#3765F6] cursor-pointer"
                          checked={!!editHighlights[selectedEditIndex].isImportant}
                          onChange={(e) => handleFieldChange('isImportant', e.target.checked)}
                        />
                        <div className="text-left">
                          <span className="text-xs font-bold text-slate-800 block">Пометить как Срочно</span>
                          <span className="text-[9px] text-slate-400 font-medium block">Выведет красный индикатор «СРОЧНО» на главной</span>
                        </div>
                      </label>
                    </div>
                  </div>

                  {/* Normal Live Preview Panel */}
                  <div className="border border-slate-200/80 rounded-2xl p-4 bg-slate-50/50">
                    <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">Предпросмотр на главной</span>
                    
                    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-2xs flex flex-col sm:flex-row select-none pointer-events-none">
                      <div className="w-full sm:w-1/3 h-28 relative overflow-hidden bg-slate-100 shrink-0">
                        <img 
                          src={editHighlights[selectedEditIndex]?.imageUrl || 'https://images.unsplash.com/photo-1519003722824-194d4455a60c?q=80&w=800&auto=format&fit=crop'} 
                          alt="Preview"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600 text-white font-sans font-black uppercase tracking-wider text-[7px] px-1.5 py-0.5 rounded shadow-sm">
                          <span>{editHighlights[selectedEditIndex]?.isImportant ? 'СРОЧНО' : 'НОВОСТЬ'}</span>
                        </div>
                      </div>
                      <div className="flex-1 p-4 flex flex-col justify-between gap-2 text-left">
                        <div className="space-y-0.5">
                          <div className="flex justify-between text-[9px] font-mono text-slate-400">
                            <span>{editHighlights[selectedEditIndex]?.author || user.name}</span>
                            <span>{editHighlights[selectedEditIndex]?.date ? formatDateToRu(editHighlights[selectedEditIndex].date) : ''}</span>
                          </div>
                          <h5 className="font-extrabold text-slate-900 text-xs sm:text-sm leading-snug line-clamp-1">
                            {editHighlights[selectedEditIndex]?.title || 'Важная информация'}
                          </h5>
                          <p className="text-slate-500 text-[10.5px] leading-relaxed line-clamp-2">
                            {editHighlights[selectedEditIndex]?.text || 'Текст новости...'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Actions Bar inside editing */}
                  <div className="flex items-center justify-between pt-4 border-t border-slate-100 mt-6 select-none">
                    {editHighlights.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => deleteEditSlide(selectedEditIndex)}
                        className="px-4 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer"
                      >
                        <Trash2 size={13} /> Удалить этот слайд
                      </button>
                    ) : (
                      <div />
                    )}

                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() => setIsEditingHighlight(false)}
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer border border-transparent"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={saveHighlight}
                        className="px-5 py-2 bg-[#3765F6] hover:bg-blue-600 text-white rounded-xl text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer border border-transparent"
                      >
                        <Save size={13} /> Сохранить новость
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

    </div>
  );
}

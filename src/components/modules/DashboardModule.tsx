import React, { useState, useEffect } from 'react';
import { UserProfile, AuditLog, AppSettings, Vehicle, TripPlan, Permit, HighlightData } from '../../types';
import { dbService } from '../../api';
import {motion, AnimatePresence} from 'motion/react';
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

} from 'lucide-react';

const formatDateToRu = (dateVal: any): string => {
  if (!dateVal) return '';
  try {
    const cleanVal = String(dateVal).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(cleanVal)) {
      const [y, m, d] = cleanVal.split('-');
      return `${d}/${m}/${y}`;
    }
    const dateObj = new Date(cleanVal);
    if (!isNaN(dateObj.getTime())) {
      const d = String(dateObj.getDate()).padStart(2, '0');
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const y = dateObj.getFullYear();
      return `${d}/${m}/${y}`;
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
  // Ambient pills removed (design simplification)

  const [imageErrors, setImageErrors] = useState<Record<string, boolean>>({});

  // Launcher removed (design simplification — navigation via bottom menu)
  const [selectedPreviewHighlight, setSelectedPreviewHighlight] = useState<HighlightData | null>(null);
  const [hoveredPillKey, setHoveredPillKey] = useState<string | null>(null);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReducedMotion(e.matches);
    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
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

      // Локально обновляем settings СРАЗУ, чтобы UI показал новое без перезагрузки
      // (подписка getSettings может "не дёрнуться" мгновенно после записи).
      setSettings(updatedSettings);
      setEditHighlights(JSON.parse(JSON.stringify(cleaned)));

      try {
        await dbService.saveSettings(updatedSettings, user.name, user.role);
      } catch (err: any) {
        console.error('[saveHighlight] saveSettings failed:', err);
      }
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



  return (
    <div className="w-full relative h-full flex flex-col justify-between p-6 sm:p-8 md:p-10 select-none text-slate-900 overflow-hidden">
      
      {/* 2. Technical overlay grid over base */}
      <div className="absolute inset-0 tech-grid opacity-[0.08] pointer-events-none z-0" />
      
      {/* 3. Calm ambient glow — static, no movement (animation removed per request) */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
        <div className="absolute -top-32 -left-32 w-[650px] h-[650px] rounded-full bg-slate-900/14 blur-[130px] md:blur-[170px]" />
        <div className="absolute -bottom-32 right-[10%] w-[700px] h-[550px] rounded-full bg-[#70FC8E]/11 blur-[130px] md:blur-[170px]" />
        <div className="absolute top-[20%] left-[25%] w-[500px] h-[500px] rounded-full bg-blue-500/5 blur-[120px] md:blur-[160px]" />
      </div>

      {/* Ambient floating pills removed (design simplification) */}

          {/* TOP ZONE: Clean operational indicators with no heavy borders or system labels */}
      <div className="relative z-10 w-full flex flex-col sm:flex-row items-center justify-end gap-4 pb-4 mb-4 select-none">
        {/* Real-time Clock */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="bg-white/95 border border-slate-200/60 rounded-2xl px-4 py-2 flex items-center gap-2 shadow-xs">
            <Clock size={13} className="text-slate-500" />
            <span className="font-mono text-xs font-bold text-slate-800">{timeStr || "00:00:00"}</span>
          </div>
        </div>
      </div>

      {/* CENTER ZONE: Central command greeting & primary CTAs */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center max-w-4xl mx-auto py-3 select-none overflow-y-auto min-h-0">
        
        {/* Dynamic customized display name greeting - no gradient, calm product typography */}
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-3 select-text font-sans text-slate-900">
          {getTimeOfDayGreeting()}, <span className="text-slate-900 font-bold">{user?.name || "Пользователь"}</span>
        </h1>

        <p className="text-xs sm:text-sm text-slate-500 max-w-lg mx-auto leading-relaxed mb-8 font-medium">
          Добро пожаловать в единую операционную среду Ratipa. Управляйте парком автомобилей, планируйте доходность и координируйте логистику в реальном времени.
        </p>

        {/* Operational Announcement Card / News Briefing block (Highlights as elegant news-card) */}
        {(currentHighlights.length > 0 || isAdmin) && (() => {
          const slide = currentHighlights[activeSlideIndex];
          const defaultImage = '';
          const isImageBroken = slide ? !!imageErrors[slide.id || activeSlideIndex] : false;
          const displayImageUrl = (slide && slide.imageUrl && !isImageBroken) ? slide.imageUrl : '';
          const showGradient = !displayImageUrl;

          return (
            <div 
              className="w-full max-w-2xl bg-white/95 border border-slate-200/80 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200 mb-8 relative select-none text-left flex flex-col md:flex-row cursor-pointer"
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              onClick={() => {
                if (slide) {
                  setSelectedPreviewHighlight(slide);
                }
              }}
            >
              {/* Left/Top Column: Image preview */}
              <div className={`w-full md:w-2/5 h-44 md:h-auto min-h-[140px] relative overflow-hidden shrink-0 ${showGradient ? 'bg-gradient-to-br from-slate-100 to-slate-200' : 'bg-slate-100'}`}>
                {displayImageUrl ? (
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
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <span className="text-3xl opacity-20">📰</span>
                  </div>
                )}
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
                      <h4 className="font-bold text-slate-900 text-base leading-snug mb-1 hover:text-slate-900 transition-colors line-clamp-1">
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
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 transition cursor-pointer shrink-0 bg-transparent border border-transparent"
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

        {/* Announcements from admin */}
        {settings?.announcements && settings.announcements.length > 0 && (
          <div className="w-full max-w-2xl space-y-1.5 mb-6">
            <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              <span>Объявления</span>
            </div>
            {settings.announcements.slice(0, 4).map((ann) => (
              <div 
                key={ann.id}
                className={"flex items-start gap-2.5 px-4 py-2.5 rounded-xl text-xs " + (
                  ann.important 
                    ? "bg-amber-500/10 border border-amber-500/20 text-slate-800 font-semibold" 
                    : "bg-white/70 border border-slate-200/50 text-slate-600 font-medium"
                )}
              >
                <span className="leading-relaxed flex-1">{ann.text}</span>
                <span className="text-[9px] text-slate-400 whitespace-nowrap mt-0.5">{ann.author} • {ann.date}</span>
              </div>
            ))}
          </div>
        )}

        {/* Direct action controllers */}
        <div className="flex flex-col sm:flex-row items-center gap-4 relative z-20 w-full sm:w-auto">
          <button
            onClick={() => onNavigate('planDohod')}
            className="w-full sm:w-auto px-8 py-4 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs tracking-wider uppercase rounded-2xl shadow-sm transition duration-150 flex items-center justify-center gap-2 cursor-pointer border border-transparent"
          >
            <span>ОТКРЫТЬ ПЛАН ДОХОДА</span>
            <ArrowRight size={14} className="stroke-[2.5]" />
          </button>
          
          <button
            onClick={() => onNavigate('dohod')}
            className="w-full sm:w-auto px-8 py-4 bg-white border border-slate-200/60 hover:border-slate-300 text-slate-700 hover:text-slate-900 font-bold text-xs tracking-wider uppercase rounded-2xl shadow-sm hover:bg-slate-50 transition duration-150 flex items-center justify-center gap-2.5 cursor-pointer group"
          >
            <Calculator size={14} className="text-slate-500 group-hover:rotate-12 transition-transform" />
            <span>КАЛЬКУЛЯЦИЯ</span>
            <ChevronRight size={12} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

      </div>

      {/* BOTTOM ZONE: Integrated resources drawer & persistent status tracker */}
      <div className="relative z-10 w-full mt-8 select-none">
        
        {/* Useful Resource Links row */}
        {settings?.quickLinks && settings.quickLinks.length > 0 && (
          <div className="w-full max-w-4xl mx-auto mb-8 p-5 bg-white/60 border border-slate-200/50 rounded-2xl shadow-2xs">
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
                  className="inline-flex items-center gap-2 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 hover:text-slate-900 transition-all shadow-xs group hover:scale-[1.01]"
                >
                  <ExternalLink size={11} className="text-slate-400 group-hover:text-slate-700 transition-colors shrink-0" />
                  <span className="truncate max-w-[140px]">{link.title}</span>
                </a>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* DETAILED HIGHLIGHT PREVIEW COVER MODAL */}
      <AnimatePresence>
        {selectedPreviewHighlight && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
 className="fixed inset-0 bg-slate-900/60 z-[1000] flex items-end sm:items-center justify-center p-0 sm:p-4 select-none overflow-y-auto"
            onClick={() => setSelectedPreviewHighlight(null)}
          >
            <motion.div 
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              transition={{ type: 'spring', damping: 28, stiffness: 300 }}
              className="w-full sm:max-w-lg sm:mx-4 bg-white sm:border sm:border-slate-200 rounded-2xl shadow-sm relative select-text mt-auto sm:mt-0"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button 
                onClick={() => setSelectedPreviewHighlight(null)}
                className="absolute top-3 right-3 z-20 w-8 h-8 flex items-center justify-center text-slate-400 hover:text-slate-700 transition cursor-pointer"
              >
                <X size={16} className="stroke-[2.5]" />
              </button>

              {/* Cover Image */}
              <div className="relative w-full bg-gradient-to-br from-slate-100 to-slate-200 rounded-t-2xl overflow-hidden">
                <div className="aspect-[16/6] w-full overflow-hidden">
                  {selectedPreviewHighlight.imageUrl ? (
                  <img 
                    src={selectedPreviewHighlight.imageUrl} 
                    alt={selectedPreviewHighlight.title}
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      const target = e.target as HTMLImageElement;
                      if (!target.dataset.fallbackAttempted) {
                        target.dataset.fallbackAttempted = 'true';
                        target.style.display = 'none';
                      }
                    }}
                  />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                      <span className="text-4xl opacity-30">📰</span>
                    </div>
                  )}
                </div>
                <div className="absolute inset-0 bg-gradient-to-t from-white/80 via-transparent to-transparent pointer-events-none" />
                <div className="absolute bottom-3 left-4 flex items-center gap-1.5 bg-red-600 text-white font-sans font-bold text-[9px] px-2.5 py-1 rounded-lg shadow-sm">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-white"></span>
                  </span>
                  <span>{selectedPreviewHighlight.isImportant ? 'СРОЧНО' : 'НОВОСТЬ'}</span>
                </div>
              </div>

              {/* Content Zone */}
              <div className="p-4 sm:p-6">
                <h4 className="text-base sm:text-xl font-bold text-slate-900 tracking-tight mb-2 leading-snug">
                  {selectedPreviewHighlight.title}
                </h4>
                <div className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                  {selectedPreviewHighlight.text}
                </div>
                
                {selectedPreviewHighlight.linkUrl && (
                  <div className="mt-3">
                    <a 
                      href={selectedPreviewHighlight.linkUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 text-xs font-bold text-slate-900 hover:text-slate-700 transition"
                    >
                      <span>Читать подробнее</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                  <span className="font-medium">{selectedPreviewHighlight.author || "Редакция"}</span>
                  <span className="font-mono">{formatDateToRu(selectedPreviewHighlight.date)}</span>
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
 className="fixed inset-0 bg-slate-900/60 z-[1001] flex items-center justify-center p-4 select-text overflow-y-auto"
            onClick={() => setIsEditingHighlight(false)}
          >
            <motion.div 
              initial={{ scale: 0.95, y: 15 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 15 }}
              className="w-full max-w-2xl bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 md:p-8 shadow-sm relative flex flex-col custom-scrollbar"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6 select-none">
                <div className="flex items-center gap-2 text-slate-900">
                  <Edit2 size={18} className="stroke-[2.5]" />
                  <span className="text-sm font-bold uppercase tracking-wider font-sans">Редактор новостной ленты</span>
                </div>
                <button 
                  onClick={() => setIsEditingHighlight(false)}
                  className="p-1.5 hover:bg-slate-100 text-slate-400 hover:text-slate-800 transition cursor-pointer border border-transparent bg-transparent"
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
                    className={`px-3.5 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition cursor-pointer border border-transparent ${
                      selectedEditIndex === index 
                        ? 'bg-slate-900 text-white shadow-sm' 
                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200 bg-transparent'
                    }`}
                  >
                    Новость {index + 1}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={addEditSlide}
                  className="px-3 py-1.5 rounded-xl bg-slate-200/60 hover:bg-slate-200 text-slate-700 hover:text-slate-900 text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 cursor-pointer border border-transparent"
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
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Заголовок новости</label>
                      <input
                        type="text"
                        className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-slate-300 focus:ring-1 focus:ring-slate-200/50 outline-none transition font-sans font-bold"
                        value={editHighlights[selectedEditIndex].title}
                        onChange={(e) => handleFieldChange('title', e.target.value)}
                        placeholder="Например: Введение летних ограничений"
                      />
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Дата публикации</label>
                      <input
                        type="date"
                        className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-slate-300 outline-none transition font-sans font-bold"
                        value={editHighlights[selectedEditIndex].date || ''}
                        onChange={(e) => handleFieldChange('date', e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Text Description */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Текст новости</label>
                    <textarea
                      rows={3}
                      className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-slate-300 focus:ring-1 focus:ring-slate-200/50 outline-none transition resize-none font-sans font-medium"
                      value={editHighlights[selectedEditIndex].text}
                      onChange={(e) => handleFieldChange('text', e.target.value)}
                      placeholder="Подробный информационный текст для сотрудников..."
                    />
                  </div>

                  {/* Image URL with Preset selection */}
                  <div>
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Ссылка на обложку (или выберите пресет ниже)</label>
                    <input
                      type="text"
                      className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-slate-300 outline-none transition font-mono"
                      value={editHighlights[selectedEditIndex].imageUrl || ''}
                      onChange={(e) => handleFieldChange('imageUrl', e.target.value)}
                      placeholder="https://images.unsplash.com/... (или оставьте пустым)"
                    />
                    
                    {/* Quick presets list */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                      <span className="text-[9px] font-bold text-slate-400 uppercase mr-1">Быстрый выбор:</span>
                      {[
                        { label: '🚚 В пути', urls: [
                          'https://images.unsplash.com/photo-1601584115197-04ecc0da31d7?q=80&w=800&auto=format&fit=crop',
                          'https://images.unsplash.com/photo-1571068316344-75bc76f77890?q=80&w=800&auto=format&fit=crop',
                          'https://images.unsplash.com/photo-1517524008697-84bbe3c3fd98?q=80&w=800&auto=format&fit=crop',
                        ] },
                        { label: '📦 Логистика', urls: [
                          'https://images.unsplash.com/photo-1565891741441-64926e441838?q=80&w=800&auto=format&fit=crop',
                          'https://images.unsplash.com/photo-1581091226825-a6a2a5aee158?q=80&w=800&auto=format&fit=crop',
                          'https://images.unsplash.com/photo-1566576912321-d58ddd7a6088?q=80&w=800&auto=format&fit=crop',
                        ] },
                        { label: '🛣️ Дорога', urls: [
                          'https://images.unsplash.com/photo-1519003722824-194d4455a60c?q=80&w=800&auto=format&fit=crop',
                          'https://images.unsplash.com/photo-1502920917128-1aa500764cbd?q=80&w=800&auto=format&fit=crop',
                        ] },
                        { label: '🏢 Офис', urls: [
                          'https://images.unsplash.com/photo-1497366811353-6870744d04b2?q=80&w=800&auto=format&fit=crop',
                          'https://images.unsplash.com/photo-1542744173-8e7e53415bb0?q=80&w=800&auto=format&fit=crop',
                          'https://images.unsplash.com/photo-1531973576160-7125cd663d86?q=80&w=800&auto=format&fit=crop',
                        ] },
                      ].map((preset) => (
                        <button
                          key={preset.label}
                          type="button"
                          onClick={() => {
                            const pool = preset.urls;
                            const url = pool[Math.floor(Math.random() * pool.length)];
                            handleFieldChange('imageUrl', url);
                          }}
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
                      <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Ссылка кнопки (опционально)</label>
                      <input
                        type="text"
                        className="w-full bg-white text-slate-900 text-xs p-3.5 rounded-xl border border-slate-200 focus:border-slate-300 outline-none transition font-sans"
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
                          className="w-4 h-4 rounded accent-slate-900 border-slate-300 focus:ring-slate-300 cursor-pointer"
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
                      <div className="w-full sm:w-1/3 h-28 relative overflow-hidden bg-gradient-to-br from-slate-100 to-slate-200 shrink-0 flex items-center justify-center">
                        {editHighlights[selectedEditIndex]?.imageUrl ? (
                        <img 
                          src={editHighlights[selectedEditIndex]?.imageUrl} 
                          alt="Preview"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                        ) : (
                          <span className="text-2xl opacity-20">📰</span>
                        )}
                        <div className="absolute top-2 left-2 flex items-center gap-1 bg-red-600 text-white font-sans font-bold uppercase tracking-wider text-[7px] px-1.5 py-0.5 rounded shadow-sm">
                          <span>{editHighlights[selectedEditIndex]?.isImportant ? 'СРОЧНО' : 'НОВОСТЬ'}</span>
                        </div>
                      </div>
                      <div className="flex-1 p-4 flex flex-col justify-between gap-2 text-left">
                        <div className="space-y-0.5">
                          <div className="flex justify-between text-[9px] font-mono text-slate-400">
                            <span>{editHighlights[selectedEditIndex]?.author || user.name}</span>
                            <span>{editHighlights[selectedEditIndex]?.date ? formatDateToRu(editHighlights[selectedEditIndex].date) : ''}</span>
                          </div>
                          <h5 className="font-bold text-slate-900 text-xs sm:text-sm leading-snug line-clamp-1">
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
                        className="px-4 py-2 bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-600 rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer"
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
                        className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-[10px] font-bold uppercase tracking-wider transition cursor-pointer border border-transparent"
                      >
                        Отмена
                      </button>
                      <button
                        type="button"
                        onClick={saveHighlight}
                        className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition cursor-pointer border border-transparent"
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
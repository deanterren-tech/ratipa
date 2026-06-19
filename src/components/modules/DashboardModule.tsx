import React, { useState, useEffect } from 'react';
import { UserProfile, AuditLog, AppSettings, Vehicle, TripPlan, Permit, HighlightData } from '../../types';
import { dbService, firebaseConfig } from '../../firebase';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Activity, 
  Users, 
  Bell, 
  ExternalLink, 
  FileText, 
  Truck, 
  MapPin, 
  Radio, 
  CheckCircle, 
  AlertTriangle,
  ChevronRight,
  ChevronLeft,
  Edit2,
  Save,
  X,
  Sparkles,
  Check,
  Plus,
  Trash2
} from 'lucide-react';
import TypingText from '../TypingText';

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

const formatDateTimeToRu = (dateVal: any): string => {
  if (!dateVal) return '';
  try {
    const cleanVal = String(dateVal).trim();
    const dateObj = new Date(cleanVal);
    if (!isNaN(dateObj.getTime())) {
      const d = String(dateObj.getDate()).padStart(2, '0');
      const m = String(dateObj.getMonth() + 1).padStart(2, '0');
      const y = dateObj.getFullYear();
      const h = String(dateObj.getHours()).padStart(2, '0');
      const min = String(dateObj.getMinutes()).padStart(2, '0');
      return `${d}.${m}.${y} ${h}:${min}`;
    }
  } catch (e) {
    // fallback
  }
  return String(dateVal);
};


interface DashboardModuleProps {
  user: UserProfile;
  onNavigate: (module: string) => void;
}

const getFallbackBamapNews = () => [
  {
    title: 'О введении временных ограничений движения транспортных средств по автомобильным дорогам общего пользования',
    link: 'https://bamap.org/information/news/2026/06/seasonal_limits/',
    pubDate: new Date().toISOString(),
    description: 'Министерством транспорта и коммуникаций Республики Беларусь введены временные весенне-летние ограничения нагрузок на оси транспортных средств на республиканских автомобильных дорогах общего пользования.'
  },
  {
    title: 'Об изменениях в порядке оформления и использования разрешений ЕКМТ на международные автомобильные перевозки грузов',
    link: 'https://bamap.org/information/news/2026/05/ecmt_permits_news/',
    pubDate: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(),
    description: 'Ассоциация «БАМАП» информирует перевозчиков об уточнении правил заполнения бортовых журналов к разрешениям ЕКМТ при выполнении транзитных рейсов.'
  },
  {
    title: 'Разъяснения ГТК Республики Беларусь по вопросам применения таможенной процедуры таможенного транзита при перевозках по книжкам МДП (TIR)',
    link: 'https://bamap.org/information/news/2026/05/tir_customs_guide/',
    pubDate: new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString(),
    description: 'Государственным таможенным комитетом подготовлены инструкции для международных перевозчиков о порядке электронного предварительного декларирования товаров при въезде на таможенную территорию ЕАЭС.'
  },
  {
    title: 'Информационный семинар БАМАП: Актуальные вопросы осуществления международных автомобильных перевозок в современных условиях',
    link: 'https://bamap.org/information/news/2026/04/seminar_results/',
    pubDate: new Date(Date.now() - 15 * 24 * 3600 * 1000).toISOString(),
    description: 'Состоялся онлайн-семинар с участием представителей Минтранса, ГТК и Транспортной инспекции, посвященный оптимизации логистических маршрутов.'
  }
];

export default function DashboardModule({ user, onNavigate }: DashboardModuleProps) {
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [trips, setTrips] = useState<TripPlan[]>([]);
  const [permits, setPermits] = useState<Permit[]>([]);
  const [isDbOnline, setIsDbOnline] = useState(false);
  const [isEditingHighlight, setIsEditingHighlight] = useState(false);
  const [editHighlight, setEditHighlight] = useState<HighlightData | null>(null);
  
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
    }, 5000); // 5 seconds interval

    return () => clearInterval(interval);
  }, [isEditingHighlight, currentHighlights.length, isHovered]);

  const [newsTab, setNewsTab] = useState<'bamap' | 'asmap' | 'system'>('bamap');

  const [bamapNews, setBamapNews] = useState<any[]>([]);
  const [bamapLoading, setBamapLoading] = useState(true);

  const [highlightHeight, setHighlightHeight] = useState<number>(() => {
    return 240;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (settings && settings.highlight && settings.highlight.height) {
      if (!isResizing) {
        setHighlightHeight(settings.highlight.height);
      }
    }
  }, [settings?.highlight?.height, isResizing]);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const cardEl = document.getElementById('dashboard-highlight-card');
      if (cardEl) {
        const rect = cardEl.getBoundingClientRect();
        const newHeight = Math.max(160, Math.min(960, e.clientY - rect.top));
        setHighlightHeight(newHeight);
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
      // Save globally if admin
      const cardEl = document.getElementById('dashboard-highlight-card');
      if (cardEl && (user.role === 'admin' || user.role === 'root_admin')) {
        const rect = cardEl.getBoundingClientRect();
        const newHeight = Math.max(160, Math.min(960, parseInt(cardEl.style.height || String(rect.height))));
        if (settings) {
           const firstHighlight = settings.highlight || { title: '', text: '', date: '', author: '' };
           const updatedHighlights = (settings.highlights || []).map(h => ({ ...h, height: newHeight }));
           dbService.saveSettings({
             ...settings,
             highlight: { ...firstHighlight, height: newHeight },
             highlights: updatedHighlights.length > 0 ? updatedHighlights : undefined
           }, user.name, user.role);
        }
      }
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, settings, user]);

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

    // Fetch Bamap News via public RSS-to-JSON
    fetch('https://api.rss2json.com/v1/api.json?rss_url=https%3A%2F%2Fbamap.org%2Frss%2Fnews.xml')
      .then(r => r.json())
      .then(res => {
        if (res.status === 'ok' && res.items && res.items.length > 0) {
          setBamapNews(res.items);
        } else {
          setBamapNews(getFallbackBamapNews());
        }
      })
      .catch(err => {
        console.warn('Could not retrieve news feed, using offline BAMAP news');
        setBamapNews(getFallbackBamapNews());
      })
      .finally(() => setBamapLoading(false));

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

  // Quick stats calculations
  const totalVehiclesOnBase = vehicles.filter(v => v.status === 'base').length;
  const totalVehiclesOnRepair = vehicles.filter(v => v.status === 'repair').length;
  const totalActiveTrips = trips.filter(t => t.status === 'active').length;
  const totalAvailablePermits = permits.filter(p => p.status === 'available').length;

  return (
    <div className="w-full space-y-8 pb-16">
      
      {/* SECTION 00: Sleek Heading with Pill Selectors and Quick Buttons */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pt-2 select-none">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[9px] font-black tracking-widest text-slate-900 bg-[#70FC8E] px-2.5 py-0.5 rounded-full uppercase font-mono">
              СИСТЕМА RATIPA
            </span>
            <span className="text-[9px] font-black tracking-widest text-slate-400 uppercase font-mono">
              v2.4 ЗАЩИЩЕННАЯ СЕТЬ
            </span>
          </div>
          <h1 className="text-4xl lg:text-5xl font-black tracking-tighter text-slate-900 uppercase leading-none flex items-baseline">
            Ratipa {settings?.customPhrases && settings.customPhrases.length > 0 && <TypingText phrases={settings.customPhrases} />}
          </h1>
        </div>

        {/* Dynamic Controls mimicking the reference image precisely */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Connected state badge pill */}
          <div className="bg-slate-50 text-slate-600 font-mono text-[10px] font-black px-4 py-2.5 rounded-full flex items-center gap-2 shadow-xs border border-slate-200/50">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#70FC8E] opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-[#70FC8E]"></span>
            </span>
            <span>ПОДКЛЮЧЕНО</span>
          </div>

          {/* "Add widget" styled action trigger */}
          <button 
            onClick={() => onNavigate('settings')}
            className="px-4 py-2.5 rounded-full bg-white border border-slate-200/60 hover:bg-slate-50 text-[10px] font-extrabold tracking-tight text-slate-800 transition cursor-pointer shadow-xs"
          >
            + СПРАВОЧНИКИ
          </button>

          {/* "Create report" pill button trigger */}
          <button 
            onClick={() => onNavigate('dohod')}
            className="px-4 py-2.5 rounded-full bg-slate-900 text-[#70FC8E] font-black hover:bg-slate-800 text-[10px] tracking-tight uppercase transition cursor-pointer shadow-xs"
          >
            КАЛЬКУЛЯЦИЯ
          </button>
        </div>
      </div>

      {/* SECTION HIGHLIGHT: NEW */}
      {(currentHighlights.length > 0 || isAdmin) && (
        <div 
          id="dashboard-highlight-card"
          onMouseEnter={() => setIsHovered(true)}
          onMouseLeave={() => setIsHovered(false)}
          style={{ height: `${highlightHeight}px`, minHeight: '160px', maxHeight: '960px' }}
          className="rounded-[2.2rem] p-8 text-white shadow-xl overflow-hidden relative select-none"
        >
          {isEditingHighlight ? (
             <div className="relative z-10 flex flex-col h-full justify-between gap-4 max-w-2xl mx-auto bg-slate-950/80 backdrop-blur-md p-6 rounded-3xl border border-white/10 shadow-2xl animate-fade-in overflow-y-auto">
               <div className="flex-1 min-h-0">
                  <div className="flex items-center gap-2 mb-4 border-b border-white/10 pb-3">
                     <div className="p-1.5 rounded-lg bg-emerald-500/20 text-emerald-400">
                        <Sparkles size={18} className="animate-spin-slow" />
                     </div>
                     <div>
                        <h3 className="text-sm font-black uppercase tracking-wider text-white font-mono">Редактирование Карусели Хайлайтов</h3>
                        <p className="text-[9px] text-slate-400 font-mono uppercase tracking-widest">Управление слайдами на главном дашборде</p>
                     </div>
                  </div>

                  {/* Slide Tabs Manager */}
                  <div className="flex items-center justify-between gap-3 bg-white/5 border border-white/10 rounded-2xl p-2.5 mb-4 max-sm:flex-col max-sm:items-stretch">
                     <div className="flex flex-wrap items-center gap-1.5 max-h-24 overflow-y-auto pr-1">
                        {editHighlights.map((slide, idx) => (
                           <div 
                              key={slide.id || idx}
                              className={`group/btn flex items-center gap-1.5 pl-3 pr-2 py-1 rounded-xl text-xs font-bold transition cursor-pointer select-none ${
                                 selectedEditIndex === idx 
                                    ? 'bg-[#70FC8E] text-slate-950 font-black' 
                                    : 'bg-white/5 text-slate-300 hover:bg-white/10 border border-white/10'
                              }`}
                              onClick={() => setSelectedEditIndex(idx)}
                           >
                              <span className="font-mono text-[9px]">#{idx + 1}</span>
                              <span className="truncate max-w-[80px]">
                                 {slide.title || 'Без названия'}
                              </span>
                              {editHighlights.length > 1 && (
                                 <button
                                    type="button"
                                    onClick={(e) => {
                                       e.stopPropagation();
                                       deleteEditSlide(idx);
                                    }}
                                    className={`p-0.5 rounded-md hover:bg-rose-500 hover:text-white transition cursor-pointer ${
                                       selectedEditIndex === idx ? 'text-slate-900' : 'text-slate-400'
                                    }`}
                                    title="Удалить слайд"
                                 >
                                    <X size={10} className="stroke-[3]" />
                                 </button>
                              )}
                           </div>
                        ))}
                     </div>
                     <button
                        type="button"
                        onClick={addEditSlide}
                        className="px-3 py-1.5 bg-blue-500/15 hover:bg-blue-500/25 text-blue-400 border border-blue-500/30 rounded-xl font-black text-[10px] uppercase tracking-wider flex items-center justify-center gap-1 transition cursor-pointer flex-shrink-0"
                     >
                        <Plus size={12} className="stroke-[3.5]" />
                        <span>Добавить слайд</span>
                     </button>
                  </div>

                  <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
                     <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">Заголовок Слайда #{selectedEditIndex + 1}</label>
                        <input 
                          type="text"
                          value={editHighlights[selectedEditIndex]?.title || ''} 
                          onChange={e => handleFieldChange('title', e.target.value)}
                          placeholder="Введите привлекающий внимание заголовок..."
                          className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm font-bold text-white outline-none focus:border-emerald-500/50 transition placeholder-slate-600"
                        />
                     </div>

                     <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">Текст / Описание</label>
                        <textarea 
                          value={editHighlights[selectedEditIndex]?.text || ''} 
                          onChange={e => handleFieldChange('text', e.target.value)}
                          placeholder="Важное объявление, девиз компании, или мотивация дня..."
                          rows={2}
                          className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-3 text-sm font-semibold text-white outline-none focus:border-emerald-500/50 transition placeholder-slate-600 resize-none"
                        />
                     </div>

                     <div className="flex flex-col gap-1.5">
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono">Ссылка на изображение (Обложка)</label>
                        <input 
                          type="text"
                          value={editHighlights[selectedEditIndex]?.imageUrl || ''} 
                          onChange={e => handleFieldChange('imageUrl', e.target.value)}
                          placeholder="https://images.unsplash.com/photo-..."
                          className="w-full bg-slate-900/60 border border-white/10 rounded-xl px-4 py-2.5 text-xs font-semibold text-white outline-none focus:border-emerald-500/50 transition placeholder-slate-600"
                        />
                        {editHighlights[selectedEditIndex]?.imageUrl && (
                           <div className="mt-2 w-full h-32 md:h-44 rounded-2xl overflow-hidden border border-white/10 bg-slate-950 relative group shadow-inner">
                              <img 
                                 referrerPolicy="no-referrer" 
                                 src={editHighlights[selectedEditIndex].imageUrl} 
                                 alt="preview" 
                                 className="w-full h-full object-cover transition duration-300" 
                              />
                              <div className="absolute top-2 right-2 bg-slate-950/80 backdrop-blur-md px-2.5 py-1 rounded-lg text-[9px] font-mono text-slate-300 font-black border border-white/10">
                                 Превью обложки (по размеру окна)
                              </div>
                           </div>
                        )}
                     </div>
                  </div>
               </div>

               <div className="flex items-center justify-end gap-2.5 border-t border-white/10 pt-4 mt-2">
                 <button 
                   onClick={() => setIsEditingHighlight(false)} 
                   className="px-4 py-2 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 text-slate-300 font-bold text-xs transition cursor-pointer flex items-center gap-1.5"
                 >
                   <X size={14}/>
                   <span>Отмена</span>
                 </button>
                 <button 
                   onClick={saveHighlight} 
                   className="px-5 py-2 rounded-xl bg-[#70FC8E] hover:bg-[#5ae076] text-slate-950 font-black text-xs uppercase tracking-tight transition cursor-pointer flex items-center gap-1.5 shadow-md"
                 >
                   <Check size={14} className="stroke-[3.5]" />
                   <span>Сохранить</span>
                 </button>
               </div>
             </div>
          ) : (
            <>
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={activeSlideIndex}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4, ease: "easeInOut" }}
                  className="absolute inset-0 w-full h-full"
                >
                  {currentHighlights[activeSlideIndex]?.imageUrl && (
                    <img 
                      src={currentHighlights[activeSlideIndex].imageUrl} 
                      alt={currentHighlights[activeSlideIndex].title} 
                      referrerPolicy="no-referrer"
                      className="absolute inset-0 w-full h-full object-cover" 
                    />
                  )}
                  <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-[1px]" />
                  
                  {/* Content overlay */}
                  <div className="absolute inset-0 p-8 flex flex-col justify-between">
                    <div>
                       {/* Top buffer space to prevent overlap with floating absolute panel */}
                       <div className="h-6" />

                       <div className="mt-4 max-w-3xl">
                         <h2 className="text-2xl md:text-3xl font-black uppercase tracking-tighter leading-tight drop-shadow-md">
                            {currentHighlights[activeSlideIndex]?.title}
                         </h2>
                         <p className="text-slate-200 mt-2.5 text-sm md:text-base font-medium line-clamp-3 leading-relaxed drop-shadow-xs max-w-4xl">
                            {currentHighlights[activeSlideIndex]?.text}
                         </p>
                       </div>
                    </div>

                    <div className="flex items-end justify-between mt-auto">
                      <div className="text-[11px] text-slate-400 font-mono font-medium flex items-center gap-2">
                        {currentHighlights[activeSlideIndex]?.author && (
                           <span className="bg-slate-900/30 px-2 py-0.5 rounded border border-slate-800/30">
                              {currentHighlights[activeSlideIndex].author}
                           </span>
                        )}
                        <span>{formatDateToRu(currentHighlights[activeSlideIndex]?.date)}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>

              {/* Static overlay: Slide number counter indicator and edit tools */}
              <div className="absolute inset-x-8 top-8 flex items-center justify-between pointer-events-none z-20">
                 <div className="pointer-events-auto">
                    <span className="text-[10px] font-black text-[#70FC8E] bg-slate-950/80 backdrop-blur-md px-3 py-1.5 rounded-full font-mono border border-slate-705/30 shadow-md">
                       {activeSlideIndex + 1} / {currentHighlights.length}
                    </span>
                 </div>
                 {isAdmin && (
                   <button 
                     onClick={startEditHighlight} 
                     className="pointer-events-auto bg-slate-900/80 hover:bg-[#70FC8E] text-slate-300 hover:text-slate-950 p-2 rounded-full border border-slate-700/50 hover:border-[#70FC8E] transition active:scale-95 cursor-pointer shadow-lg"
                     title="Редактировать карусель"
                   >
                      <Edit2 size={13} className="stroke-[2.5]" />
                   </button>
                 )}
              </div>

              {/* Carousel manual selectors navigation dot bars */}
              {currentHighlights.length > 1 && (
                 <div className="absolute right-8 bottom-8 flex items-center gap-1.5 bg-slate-950/50 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/5 z-20">
                    {currentHighlights.map((_, idx) => (
                       <button
                          key={idx}
                          type="button"
                          onClick={() => setActiveSlideIndex(idx)}
                          className={`h-2.5 rounded-full transition-all duration-300 cursor-pointer ${
                             activeSlideIndex === idx 
                                ? 'w-6 bg-[#70FC8E]' 
                                : 'w-2.5 bg-white/30 hover:bg-white/60'
                          }`}
                          title={`Перейти к слайду ${idx + 1}`}
                       />
                    ))}
                 </div>
              )}

              {/* Prev / Next manual pagination arrows visible on Hover over the card */}
              {currentHighlights.length > 1 && (
                 <>
                    <button 
                       onClick={() => setActiveSlideIndex((prev) => (prev - 1 + currentHighlights.length) % currentHighlights.length)}
                       className="absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-slate-950/60 hover:bg-[#70FC8E] text-white hover:text-slate-950 transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100 hover:scale-105 border border-white/10 z-20"
                       style={{ transform: 'translateY(-50%)' }}
                    >
                       <ChevronLeft size={18} />
                    </button>
                    <button 
                       onClick={() => setActiveSlideIndex((prev) => (prev + 1) % currentHighlights.length)}
                       className="absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full bg-slate-950/60 hover:bg-[#70FC8E] text-white hover:text-slate-950 transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100 hover:scale-105 border border-white/10 z-20"
                       style={{ transform: 'translateY(-50%)' }}
                    >
                       <ChevronRight size={18} />
                    </button>
                 </>
              )}

              {/* Resize handle at the bottom edge */}
              {isAdmin && (
                <div 
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setIsResizing(true);
                  }}
                  className="absolute bottom-0 left-0 right-0 h-4 bg-slate-900/40 hover:bg-slate-900/80 cursor-ns-resize flex items-center justify-center transition-all group z-20"
                  title="Перетащите для изменения высоты"
                >
                  <div className="w-16 h-1 bg-white/40 group-hover:bg-white/80 rounded-full transition-colors" />
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* SECTION MIDDLE: News and Bookmarks */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* News Section */}
        <div className="lg:col-span-2 bg-white rounded-[2.2rem] p-8 border border-slate-200 shadow-sm flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900">Информационная Лента</h2>
                <div className="flex gap-2 flex-wrap">
                    <button 
                        onClick={() => setNewsTab('bamap')} 
                        className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition cursor-pointer ${
                            newsTab === 'bamap' 
                            ? 'bg-slate-950 text-[#70FC8E]' 
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                        }`}
                    >
                        Сайт БАМАП
                    </button>
                    <button 
                        onClick={() => setNewsTab('asmap')} 
                        className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition cursor-pointer ${
                            newsTab === 'asmap' 
                            ? 'bg-slate-950 text-[#70FC8E]' 
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                        }`}
                    >
                        Сайт АСМАП
                    </button>
                    <button 
                        onClick={() => setNewsTab('system')} 
                        className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider transition cursor-pointer ${
                            newsTab === 'system' 
                            ? 'bg-slate-950 text-[#70FC8E]' 
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'
                        }`}
                    >
                        Объявления ({settings?.announcements?.length || 0})
                    </button>
                </div>
            </div>

            {newsTab === 'bamap' ? (
                <div className="space-y-4 flex-1 flex flex-col">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-indigo-50 border border-indigo-100 rounded-xl text-xs gap-2 select-none">
                        <div>
                          <span className="text-indigo-800 font-bold block">ОФИЦИАЛЬНЫЙ САЙТ БАМАП</span>
                          <span className="text-[10px] text-indigo-500">Для прямого и быстрого просмотра новостей организации</span>
                        </div>
                        <a 
                            href={settings?.bamapUrl || "https://bamap.org/information/news/"} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="bg-indigo-600 hover:bg-indigo-700 text-white font-black uppercase text-[9px] tracking-wide px-3 py-2 rounded-lg flex items-center gap-1.5 self-start sm:self-center transition shadow-sm"
                        >
                            Открыть в новой вкладке <ExternalLink size={11} />
                        </a>
                    </div>
                    <div className="w-full relative bg-slate-100 rounded-2xl border border-slate-200 h-[500px] overflow-hidden">
                        <iframe 
                            src={settings?.bamapUrl || "https://bamap.org/information/news/"} 
                            className="w-full h-full border-0 rounded-2xl bg-white" 
                            title="Сайт БАМАП"
                            referrerPolicy="no-referrer"
                            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                        />
                    </div>
                </div>
            ) : newsTab === 'asmap' ? (
                <div className="space-y-4 flex-1 flex flex-col">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-emerald-50 border border-emerald-150 rounded-xl text-xs gap-2 select-none">
                        <div>
                          <span className="text-emerald-800 font-bold block">ОФИЦИАЛЬНЫЙ САЙТ АСМАП</span>
                          <span className="text-[10px] text-emerald-600">Ассоциация международных автомобильных перевозчиков РФ</span>
                        </div>
                        <a 
                            href={settings?.asmapUrl || "https://www.asmap.ru/news/"} 
                            target="_blank" 
                            rel="noopener noreferrer" 
                            className="bg-emerald-600 hover:bg-emerald-700 text-white font-black uppercase text-[9px] tracking-wide px-3 py-2 rounded-lg flex items-center gap-1.5 self-start sm:self-center transition shadow-sm"
                        >
                            Открыть в новой вкладке <ExternalLink size={11} />
                        </a>
                    </div>
                    <div className="w-full relative bg-slate-100 rounded-2xl border border-slate-200 h-[500px] overflow-hidden">
                        <iframe 
                            src={settings?.asmapUrl || "https://www.asmap.ru/news/"} 
                            className="w-full h-full border-0 rounded-2xl bg-white" 
                            title="Сайт АСМАП"
                            referrerPolicy="no-referrer"
                            sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                        />
                    </div>
                </div>
            ) : (
                <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {settings?.announcements?.map((ann) => (
                    <div key={ann.id} className={`p-4 rounded-2xl border ${ann.important ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                        <small className="text-slate-500 font-mono">{formatDateToRu(ann.date)} - {ann.author}</small>
                        <p className="font-semibold text-slate-800">{ann.text}</p>
                    </div>
                  ))}
                  {(!settings?.announcements || settings.announcements.length === 0) && (
                      <div className="p-8 text-center text-slate-400 font-bold text-xs uppercase tracking-wider font-mono">Объявления отсутствуют</div>
                  )}
                </div>
            )}
        </div>

        {/* Bookmarks Section */}
        <div className="lg:col-span-1 bg-white rounded-[2.2rem] p-8 border border-slate-200 shadow-sm">
            <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900 mb-6">Полезные ссылки</h2>
            <div className="space-y-3">
              {settings?.quickLinks?.map((link) => (
                <a key={link.id} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 transition">
                  <ExternalLink size={16} className="text-slate-400" />
                  <span className="font-semibold text-slate-700">{link.title}</span>
                </a>
              ))}
            </div>
        </div>
      </div>

      {/* Decorative spacing line */}
      <div className="border-t border-slate-200/50 pt-4 flex flex-col md:flex-row md:items-center justify-between gap-4 text-[9px] text-slate-400 font-mono tracking-wider">
        <span>СИСТЕМА БЕЗОПАСНОСТИ RATIPA [3-BAR BEN-V2]</span>
        <span>СИНХРОНИЗАЦИЯ ПОСЛЕДНИХ МЕТРИК УСПЕШНО ЗАВЕРШЕНА</span>
      </div>

    </div>
  );
}

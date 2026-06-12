import React, { useState, useEffect } from 'react';
import { UserProfile, AuditLog, AppSettings, Vehicle, TripPlan, Permit, HighlightData } from '../../types';
import { dbService, firebaseConfig } from '../../firebase';
import { motion } from 'motion/react';
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
  Edit2,
  Save,
  X
} from 'lucide-react';
import TypingText from '../TypingText';


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
  const [editHighlight, setEditHighlight] = useState<HighlightData | null>(null);

  const [highlightHeight, setHighlightHeight] = useState<number>(() => {
    return Number(localStorage.getItem('ratipa_highlight_height')) || 240;
  });
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isResizing) return;
    const handleMouseMove = (e: MouseEvent) => {
      const cardEl = document.getElementById('dashboard-highlight-card');
      if (cardEl) {
        const rect = cardEl.getBoundingClientRect();
        const newHeight = Math.max(160, Math.min(960, e.clientY - rect.top));
        setHighlightHeight(newHeight);
        localStorage.setItem('ratipa_highlight_height', String(newHeight));
      }
    };
    const handleMouseUp = () => {
      setIsResizing(false);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

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
    setEditHighlight(settings?.highlight || { title: '', text: '', imageUrl: '', date: new Date().toISOString().split('T')[0], author: user.name });
    setIsEditingHighlight(true);
  };

  const saveHighlight = async () => {
    if (editHighlight && settings) {
      dbService.saveSettings({ ...settings, highlight: editHighlight }, user.name, user.role);
      setIsEditingHighlight(false);
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
      {(settings?.highlight || isAdmin) && (
        <div 
          id="dashboard-highlight-card"
          style={{ height: `${highlightHeight}px`, minHeight: '160px', maxHeight: '960px' }}
          className="rounded-[2.2rem] p-8 text-white shadow-xl overflow-hidden relative select-none"
        >
          {isEditingHighlight ? (
            <div className="relative z-10 flex flex-col gap-3">
              <input 
                value={editHighlight?.title || ''} 
                onChange={e => setEditHighlight(prev => prev ? {...prev, title: e.target.value} : null)}
                placeholder="Заголовок"
                className="w-full bg-slate-800 p-2 rounded text-white"
              />
              <textarea 
                value={editHighlight?.text || ''} 
                onChange={e => setEditHighlight(prev => prev ? {...prev, text: e.target.value} : null)}
                placeholder="Текст"
                className="w-full bg-slate-800 p-2 rounded text-white"
              />
               <input 
                value={editHighlight?.imageUrl || ''} 
                onChange={e => setEditHighlight(prev => prev ? {...prev, imageUrl: e.target.value} : null)}
                placeholder="URL Изображения"
                className="w-full bg-slate-800 p-2 rounded text-white"
              />
              <div className="flex gap-2">
                <button onClick={saveHighlight} className="p-2 bg-emerald-600 rounded"><Save size={16}/></button>
                <button onClick={() => setIsEditingHighlight(false)} className="p-2 bg-rose-600 rounded"><X size={16}/></button>
              </div>
            </div>
          ) : (
            <>
              {settings?.highlight?.imageUrl && (
                <img 
                  src={settings.highlight.imageUrl} 
                  alt={settings.highlight.title} 
                  className="absolute inset-0 w-full h-full object-cover" 
                />
              )}
              <div className="absolute inset-0 bg-slate-900/70" />
              <div className="relative z-10">
                {isAdmin && (
                  <button onClick={startEditHighlight} className="absolute right-0 top-0 p-2 text-slate-300 hover:text-white"><Edit2 size={16}/></button>
                )}
                <h2 className="text-3xl font-black uppercase tracking-tighter">{settings?.highlight?.title}</h2>
                <p className="text-slate-100 mt-3 text-lg line-clamp-3">{settings?.highlight?.text}</p>
                <div className="mt-6 text-sm text-slate-300 font-mono">
                  {settings?.highlight?.author && !settings.highlight.author.toLowerCase().includes('администрация') ? `${settings.highlight.author} • ` : null}
                  {settings?.highlight?.date}
                </div>
              </div>

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
        <div className="lg:col-span-2 bg-white rounded-[2.2rem] p-8 border border-slate-200 shadow-sm">
            <h2 className="text-xl font-black uppercase tracking-tighter text-slate-900 mb-6">Новости</h2>
            <div className="space-y-4">
              {settings?.announcements?.map((ann) => (
                <div key={ann.id} className={`p-4 rounded-2xl border ${ann.important ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                    <small className="text-slate-500 font-mono">{ann.date} - {ann.author}</small>
                    <p className="font-semibold text-slate-800">{ann.text}</p>
                </div>
              ))}
            </div>
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

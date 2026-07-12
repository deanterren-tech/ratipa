import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../firebase';
import { getEmbeddableSheetUrl } from '../../utils/embed';
import { 
  ZoomIn, 
  ZoomOut, 
  Maximize2, 
  Minimize2, 
  RefreshCw, 
  ExternalLink,
  LayoutTemplate
} from 'lucide-react';

interface CurrentPlanningModuleProps {
  user: UserProfile;
}

export default function CurrentPlanningModule({ user }: CurrentPlanningModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('ratipa_zoom_currentPlanning');
    return saved ? parseFloat(saved) : 1;
  });

  useEffect(() => {
    localStorage.setItem('ratipa_zoom_currentPlanning', zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    const unsubscribe = dbService.getSettings((s) => setSettings(s));
    return () => unsubscribe();
  }, []);

  const tabs = settings?.currentPlanningTabs || [];

  useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
       const allowedTabs = tabs.filter(t => user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions[`currentPlanning_${t.id}`] !== 'none'));
       if (allowedTabs.length > 0) {
         setActiveTabId(allowedTabs[0].id);
       }
    }
  }, [tabs, activeTabId, user]);

  const allowedTabs = tabs.filter(t => user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions[`currentPlanning_${t.id}`] !== 'none'));

  const handleRefresh = () => {
    if (activeTabId) {
      setRefreshKeys(prev => ({ ...prev, [activeTabId]: (prev[activeTabId] || 0) + 1 }));
    }
  };

  if (allowedTabs.length === 0) {
    return (
      <div className="bg-white rounded-[2rem] p-10 shadow-sm border border-slate-200 text-center flex flex-col justify-center items-center h-full">
        <span className="text-sm font-black text-slate-800 uppercase font-mono tracking-wider">Нет доступных вкладок</span>
        <p className="text-xs text-slate-500 max-w-xs mt-2 font-medium">
          Вам не назначено прав доступа ни к одной подвкладке текущего планирования.
        </p>
      </div>
    );
  }

  const activeTab = allowedTabs.find(t => t.id === activeTabId) || allowedTabs[0];
  const embedUrl = activeTab?.sheetUrl ? getEmbeddableSheetUrl(activeTab.sheetUrl) : "";

  return (
    <div className={`w-full flex flex-col space-y-2 font-sans ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-2 lg:p-4' : 'h-full'}`}>
      
      {/* Header & Tabs */}
      <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 border border-slate-200/40 shadow-xs flex flex-col gap-3 select-none">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
              <LayoutTemplate className="h-4.5 w-4.5 text-orange-600" />
            </div>
            <div>
              <h1 className="text-base sm:text-lg font-bold text-slate-950 font-sans tracking-tight">
                Текущее планирование
              </h1>
              <p className="text-[11px] text-slate-500 font-medium hidden sm:block font-sans">
                Расписание, мониторинг и управление текущими рейсами
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto justify-start sm:justify-end">
            <div className="flex bg-slate-150/45 border border-slate-200/40 p-0.5 rounded-xl items-center select-none shadow-3xs">
              <button 
                onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} 
                className="p-1.5 hover:bg-white text-slate-500 hover:text-slate-800 rounded-lg transition-all active:scale-90 cursor-pointer"
                title="Уменьшить масштаб"
              >
                <ZoomOut className="w-3.5 h-3.5"/>
              </button>
              <span className="text-[10px] font-bold w-10 text-center font-mono text-slate-600 select-none">{Math.round(zoomLevel * 100)}%</span>
              <button 
                onClick={() => setZoomLevel(z => Math.min(2, z + 0.1))} 
                className="p-1.5 hover:bg-white text-slate-500 hover:text-slate-800 rounded-lg transition-all active:scale-90 cursor-pointer"
                title="Увеличить масштаб"
              >
                <ZoomIn className="w-3.5 h-3.5"/>
              </button>
            </div>

            <button
              onClick={handleRefresh}
              className="flex items-center justify-center bg-white/60 hover:bg-slate-50 text-slate-600 hover:text-slate-800 w-8.5 h-8.5 rounded-xl border border-slate-200/50 hover:border-slate-300 shadow-3xs transition-all active:scale-90 cursor-pointer"
              title="Обновить таблицу"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
  
            <a
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center bg-white/60 hover:bg-slate-50 text-slate-600 hover:text-slate-800 w-8.5 h-8.5 rounded-xl border border-slate-200/50 hover:border-slate-300 shadow-3xs transition-all active:scale-90 cursor-pointer"
              title="Открыть в новой вкладке"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
  
            <button
              onClick={() => setIsFocusMode(!isFocusMode)}
              className={`flex items-center justify-center w-8.5 h-8.5 rounded-xl border shadow-3xs transition-all active:scale-90 cursor-pointer ${
                isFocusMode 
                  ? 'bg-orange-600 border-orange-600 text-white shadow-sm hover:bg-orange-700' 
                  : 'bg-white/60 border-slate-200/50 hover:border-slate-300 text-slate-600 hover:text-slate-800 hover:bg-slate-50'
              }`}
              title={isFocusMode ? "Выйти из полноэкранного режима" : "Развернуть на весь экран"}
            >
              {isFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 custom-scrollbar">
          {allowedTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`px-4 py-1.5 text-[11px] font-bold tracking-tight rounded-lg transition-all duration-150 cursor-pointer whitespace-nowrap border ${
                activeTabId === tab.id 
                  ? 'bg-white text-slate-900 shadow-xs border-slate-200' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/60 border-transparent'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
      </div>

      {/* Frame */}
      <div 
         ref={scrollContainerRef}
         className={`relative bg-white/65 backdrop-blur-md rounded-2xl border border-slate-200/40 shadow-xs overflow-hidden flex-1 flex flex-col min-h-0 ${isFocusMode ? '' : 'h-[880px]'}`}
      >
         {activeTab && activeTab.sheetUrl ? (
            <div style={{
                width: `${100 / zoomLevel}%`,
                height: `${100 / zoomLevel}%`,
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'top left'
              }} 
              className="absolute top-0 left-0"
            >
              <iframe 
                key={`${activeTab.id}-${refreshKeys[activeTab.id] || 0}`}
                src={embedUrl}
                className="w-full h-full border-none"
                title={`google-sheet-${activeTab.id}`}
              />
            </div>
         ) : (
            <div className="absolute inset-0 bg-white rounded-3xl flex items-center justify-center border border-slate-200/60 p-10">
               <div className="text-center font-mono font-black uppercase tracking-widest text-slate-400 text-xs">
                  Ссылка на Google Таблицу не указана.
               </div>
            </div>
         )}
      </div>
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../firebase';
import { ZoomIn, ZoomOut, Maximize2, Minimize2, RefreshCw } from 'lucide-react';

interface CurrentPlanningModuleProps {
  user: UserProfile;
}

export default function CurrentPlanningModule({ user }: CurrentPlanningModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});

  const [frameHeight, setFrameHeight] = useState(() => {
    const saved = localStorage.getItem('ratipa_height_currentPlanning');
    return saved ? parseInt(saved, 10) : 600;
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('ratipa_height_currentPlanning', frameHeight.toString());
  }, [frameHeight]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [activeTabId]);

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
       // Also check permissions
       const allowedTabs = tabs.filter(t => user.role === 'root_admin' || user.permissions[`currentPlanning_${t.id}`] !== 'none');
       if (allowedTabs.length > 0) {
         setActiveTabId(allowedTabs[0].id);
       }
    }
  }, [tabs, activeTabId, user]);

  const allowedTabs = tabs.filter(t => user.role === 'root_admin' || user.permissions[`currentPlanning_${t.id}`] !== 'none');

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

  return (
    <div className={`w-full flex flex-col space-y-4 font-sans ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-2 lg:p-6' : 'h-full'}`}>
      
      {/* Header & Tabs */}
      <div className="bg-white rounded-[2rem] p-4 border border-slate-200/60 shadow-sm flex flex-col sm:flex-row justify-between items-center gap-4">
        <div className="flex overflow-x-auto custom-scrollbar gap-2 w-full sm:w-auto">
          {allowedTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTabId(tab.id)}
              className={`px-4 py-2 rounded-xl text-[10px] sm:text-xs font-black uppercase tracking-wider transition whitespace-nowrap outline-none ${
                activeTabId === tab.id 
                  ? 'bg-blue-100 text-blue-900 shadow-sm'
                  : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'
              }`}
            >
              {tab.name}
            </button>
          ))}
        </div>
        
        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button 
            onClick={handleRefresh}
            className="flex items-center justify-center w-10 h-10 bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 rounded-xl transition cursor-pointer"
            title="Обновить"
          >
             <RefreshCw className="w-4 h-4" />
          </button>
          <div className="flex bg-slate-100 p-1 rounded-xl items-center">
             <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="p-1 hover:bg-white rounded transition text-slate-600 cursor-pointer"><ZoomOut className="w-4 h-4"/></button>
             <span className="text-[10px] font-black w-10 text-center font-mono text-slate-700">{Math.round(zoomLevel * 100)}%</span>
             <button onClick={() => setZoomLevel(z => Math.min(2, z + 0.1))} className="p-1 hover:bg-white rounded transition text-slate-600 cursor-pointer"><ZoomIn className="w-4 h-4"/></button>
          </div>
          <button
            onClick={() => setIsFocusMode(!isFocusMode)}
            className={`flex items-center gap-2 text-[10px] sm:text-xs font-black px-4 py-2.5 rounded-xl border transition cursor-pointer uppercase tracking-tight ${
              isFocusMode 
                ? 'bg-blue-500 border-blue-500 text-white shadow-sm' 
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {isFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="hidden sm:inline">{isFocusMode ? 'Свернуть' : 'Экран'}</span>
          </button>
        </div>
      </div>

      {/* Frame */}
      <div 
         ref={scrollContainerRef}
         className="flex-1 bg-slate-100 rounded-[2rem] overflow-hidden border border-slate-200/60 shadow-sm relative"
         style={isFocusMode ? { minHeight: 'calc(100vh - 120px)' } : { height: '680px' }}
      >
         {allowedTabs.some(t => t.sheetUrl) ? (
            <div style={{
                width: `${100 / zoomLevel}%`,
                height: `${100 / zoomLevel}%`,
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'top left'
              }} 
              className="absolute top-0 left-0"
            >
               {allowedTabs.map(tab => tab.sheetUrl ? (
                 <iframe 
                   key={`${tab.id}-${refreshKeys[tab.id] || 0}`}
                   src={tab.sheetUrl}
                   className="w-full h-full border-none"
                   style={{ display: activeTabId === tab.id ? 'block' : 'none' }}
                   title={`google-sheet-${tab.id}`}
                 />
               ) : null)}
            </div>
         ) : null}

         {activeTab && !activeTab.sheetUrl && (
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

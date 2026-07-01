import { useState, useEffect, useRef } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../firebase';
import { 
  FileSpreadsheet, 
  Maximize2, 
  Minimize2, 
  RefreshCw, 
  ExternalLink, 
  HelpCircle,
  Link2,
  Lock,
  ZoomIn,
  ZoomOut
} from 'lucide-react';
import { useToast } from '../ToastProvider';

interface PlanZagruzokModuleProps {
  user: UserProfile;
}

export default function PlanZagruzokModule({ user }: PlanZagruzokModuleProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [loadedFrameIds, setLoadedFrameIds] = useState<Record<string, boolean>>({});
  const [iframeKey, setIframeKey] = useState(0); 
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeIsLoading = activeTabId ? !loadedFrameIds[activeTabId] : true;
  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('ratipa_zoom_planZagruzok');
    return saved ? parseFloat(saved) : 1;
  });

  const [frameHeight, setFrameHeight] = useState(() => {
    const saved = localStorage.getItem('ratipa_height_planZagruzok');
    return saved ? parseInt(saved, 10) : 600;
  });

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('ratipa_height_planZagruzok', frameHeight.toString());
  }, [frameHeight]);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      // Prevent scrolling the main body/parent page while scroll starts/happens over google sheets
      e.preventDefault();
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [activeTabId]); // Re-attach when tab changes or ref is ready

  useEffect(() => {
    localStorage.setItem('ratipa_zoom_planZagruzok', zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    const unsubscribe = dbService.getSettings((s) => setSettings(s));
    return () => unsubscribe();
  }, []);

  const dynamicTabs = settings?.planZagruzokTabs || [];
  const allowedDynamicTabs = dynamicTabs.filter(t => user.role === 'root_admin' || user.permissions[`planZagruzok_${t.id}`] !== 'none');
  const hasBasePermission = user.role === 'root_admin' || user.permissions.planZagruzok !== 'none';

  const allowedTabs = [
    ...(hasBasePermission ? [
      { 
        id: 'plan', 
        name: 'План загрузок', 
        sheetUrl: settings?.planZagruzokSheetUrl || settings?.googleSheetsUrl || "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0", 
        variant: 'default' 
      },
      ...(settings?.planZagruzokBlacklistUrl ? [
        { 
          id: 'blacklist', 
          name: 'Черный список', 
          sheetUrl: settings?.planZagruzokBlacklistUrl, 
          variant: 'rose' 
        }
      ] : [])
    ] : []),
    ...allowedDynamicTabs.map(t => ({
      id: t.id,
      name: t.name,
      sheetUrl: t.sheetUrl,
      variant: 'blue'
    }))
  ];

  useEffect(() => {
    if (allowedTabs.length > 0 && !activeTabId) {
      setActiveTabId(allowedTabs[0].id);
    } else if (allowedTabs.length > 0 && !allowedTabs.some(t => t.id === activeTabId)) {
      setActiveTabId(allowedTabs[0].id);
    }
  }, [allowedTabs, activeTabId]);

  const activeTabObj = allowedTabs.find(t => t.id === activeTabId) || allowedTabs[0];
  const embedUrl = activeTabObj?.sheetUrl || "";
  const sheetsExternalUrl = embedUrl;

  const handleRefresh = () => {
    if (activeTabId) {
      setLoadedFrameIds(prev => ({ ...prev, [activeTabId]: false }));
      setIframeKey(prev => prev + 1);
    }
  };

  return (
    <div className={`w-full space-y-6 font-sans flex flex-col ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-2 lg:p-6' : 'h-full'}`}>
      
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col lg:flex-row items-center justify-between gap-6 select-none">
        
        <div className="flex items-center gap-4 w-full lg:w-auto">
          <div className="w-12 h-12 rounded-full bg-[#70FC8E]/15 border border-[#70FC8E]/45 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="h-5 w-5 text-slate-900" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">
                План Загрузок {activeTabObj && activeTabObj.id !== 'plan' && activeTabObj.id !== 'blacklist' && `| ${activeTabObj.name}`}
              </h1>
              <span className="bg-[#70FC8E] text-slate-950 text-[9px] font-mono font-black px-2.5 py-0.5 rounded-full border border-black/5 uppercase tracking-wider">
                Синхр Google Таблиц
              </span>
            </div>
            <div className="flex gap-2 mt-2.5 flex-wrap">
              {allowedTabs.map(tab => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-lg transition shrink-0 cursor-pointer ${
                    activeTabId === tab.id 
                      ? tab.variant === 'rose'
                        ? 'bg-rose-500 text-white shadow-sm'
                        : tab.variant === 'blue'
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-slate-900 text-[#70FC8E] shadow-sm'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-800'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-start lg:justify-end">
          
          <div className="flex bg-slate-100 p-1 rounded-xl items-center">
             <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="p-1 hover:bg-white rounded transition text-slate-600 cursor-pointer"><ZoomOut className="w-4 h-4"/></button>
             <span className="text-[10px] font-black w-10 text-center font-mono text-slate-700">{Math.round(zoomLevel * 100)}%</span>
             <button onClick={() => setZoomLevel(z => Math.min(2, z + 0.1))} className="p-1 hover:bg-white rounded transition text-slate-600 cursor-pointer"><ZoomIn className="w-4 h-4"/></button>
          </div>

          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-black px-4 py-2.5 rounded-xl border border-slate-200/50 transition cursor-pointer"
            title="Перезагрузить фрейм"
          >
            <RefreshCw className="h-4 w-4 text-slate-500" />
            <span className="hidden sm:inline">Обновить</span>
          </button>

          <a
            href={sheetsExternalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-slate-950 hover:bg-slate-850 text-[#70FC8E] text-xs font-black px-4 py-2.5 rounded-xl transition cursor-pointer shadow-xs uppercase tracking-tight hidden sm:flex"
          >
            <ExternalLink className="h-4 w-4" />
            <span>Новая вкладка</span>
          </a>

          <button
            onClick={() => setIsFocusMode(!isFocusMode)}
            className={`flex items-center gap-2 text-xs font-black px-4 py-2.5 rounded-xl border transition cursor-pointer uppercase tracking-tight ${
              isFocusMode 
                ? 'bg-[#70FC8E] border-[#70FC8E] text-slate-950 hover:opacity-90 shadow-sm' 
                : 'bg-white border-slate-250 text-slate-705 lg:hover:bg-slate-50'
            }`}
          >
            {isFocusMode ? (
              <>
                <Minimize2 className="h-4 w-4" />
                <span className="hidden sm:inline">Свернуть</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4" />
                <span className="hidden sm:inline">Экран</span>
              </>
            )}
          </button>

        </div>
      </div>

      <div 
        className="relative bg-slate-100 rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden flex-1 flex flex-col min-h-0"
      >
        
        {activeIsLoading && (
          <div className="absolute inset-0 bg-white/85 backdrop-blur-md flex flex-col justify-center items-center z-10 transition duration-350 select-none">
            <div className="relative">
              <div className="h-14 w-14 rounded-full border-4 border-slate-100 border-t-slate-950 animate-spin" />
              <FileSpreadsheet className="h-5 w-5 text-slate-900 absolute top-4.5 left-4.5" />
            </div>
            <span className="text-sm font-black text-slate-900 mt-5 uppercase tracking-wider font-mono animate-pulse">
              Интеграция Google Таблиц...
            </span>
          </div>
        )}

        {allowedTabs.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center items-center p-8 text-center bg-slate-50 select-none">
            <Lock className="h-10 w-10 text-slate-900 mb-2" />
            <span className="text-sm font-black text-slate-900 uppercase tracking-tight">Доступ Заблокирован</span>
          </div>
        ) : (
          <div ref={scrollContainerRef} className="w-full h-full relative overflow-auto bg-slate-100/50">
            <div style={{
               width: `${100 / zoomLevel}%`,
               height: `${100 / zoomLevel}%`,
               transform: `scale(${zoomLevel})`,
               transformOrigin: '0 0',
               minHeight: '100%',
               position: 'absolute'
            }}>
              {allowedTabs.map(tab => (
                <iframe
                  key={tab.id + '-' + (activeTabId === tab.id ? iframeKey : 0)}
                  src={tab.sheetUrl}
                  onLoad={() => setLoadedFrameIds(prev => ({ ...prev, [tab.id]: true }))}
                  className="w-full h-full border-0 absolute top-0 left-0"
                  style={{ display: activeTabId === tab.id ? 'block' : 'none' }}
                  allow="clipboard-write"
                  title={`План Загрузок Ratipa ${tab.name}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

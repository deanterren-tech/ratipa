import {useState, useEffect, useRef, useMemo} from 'react'
import {UserProfile, AppSettings} from '../../types'
import {dbService} from '../../api'
import {getEmbeddableSheetUrl} from '../../utils/embed'
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
import {useToast} from '../ToastProvider'

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

  const allowedTabs = useMemo(() => {
    const dynamicTabs = settings?.planZagruzokTabs || [];
    const allowedDynamicTabs = dynamicTabs.filter(t => user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions[`planZagruzok_${t.id}`] !== 'none'));
    const hasBasePermission = user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions.planZagruzok !== 'none');

    return [
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
  }, [settings, user.role, user.permissions]);

  useEffect(() => {
    const firstAllowedId = allowedTabs[0]?.id;
    if (!firstAllowedId) return;
    if (!activeTabId || !allowedTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(firstAllowedId);
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
    <div className={`w-full space-y-4 font-sans flex flex-col ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-4 lg:p-6' : 'h-full'}`}>
      
      <div className="bg-white/60 backdrop-blur-md rounded-3xl p-4 lg:px-6 border border-slate-200/50 shadow-sm flex flex-col sm:flex-row items-center justify-between gap-4 select-none">
        
        <div className="flex items-center gap-3.5 w-full sm:w-auto">
          <div className="w-10 h-10 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-[#3765F6]">
            <FileSpreadsheet className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-base font-bold text-slate-900 tracking-tight">
                План загрузок {activeTabObj && activeTabObj.id !== 'plan' && activeTabObj.id !== 'blacklist' && `| ${activeTabObj.name}`}
              </h1>
            </div>
            <div className="flex gap-2 mt-2 flex-wrap">
              {allowedTabs.map(tab => (
                <button 
                  key={tab.id}
                  onClick={() => setActiveTabId(tab.id)}
                  className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-xl transition duration-150 shrink-0 cursor-pointer border ${
                    activeTabId === tab.id 
                      ? tab.variant === 'rose'
                        ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                        : tab.variant === 'blue'
                          ? 'bg-[#3765F6] border-[#3765F6] text-white shadow-xs'
                          : 'bg-slate-900 border-slate-900 text-white shadow-xs'
                      : 'bg-white/45 border-slate-200/50 text-slate-500 hover:bg-white/80 hover:text-slate-800'
                  }`}
                >
                  {tab.name}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-start sm:justify-end">
          
          <div className="flex bg-white/45 border border-slate-200/50 p-1 rounded-xl items-center shadow-2xs">
             <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="p-1 hover:bg-white rounded-lg transition text-slate-500 hover:text-slate-800 cursor-pointer"><ZoomOut className="w-3.5 h-3.5"/></button>
             <span className="text-[10px] font-bold w-10 text-center font-mono text-slate-700">{Math.round(zoomLevel * 100)}%</span>
             <button onClick={() => setZoomLevel(z => Math.min(2, z + 0.1))} className="p-1 hover:bg-white rounded-lg transition text-slate-500 hover:text-slate-800 cursor-pointer"><ZoomIn className="w-3.5 h-3.5"/></button>
          </div>

          <button
            onClick={handleRefresh}
            className="flex items-center gap-1.5 bg-white/65 hover:bg-white border border-slate-200/50 hover:border-slate-300 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition shadow-2xs cursor-pointer"
            title="Перезагрузить фрейм"
          >
            <RefreshCw className="h-3.5 w-3.5 text-slate-500" />
            <span>Обновить</span>
          </button>

          <a
            href={sheetsExternalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 bg-[#3765F6] hover:bg-[#2555E5] text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer shadow-sm hidden sm:flex"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            <span>Новая вкладка</span>
          </a>

          <button
            onClick={() => setIsFocusMode(!isFocusMode)}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-xl border transition cursor-pointer ${
              isFocusMode 
                ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800 shadow-sm' 
                : 'bg-white/65 border-slate-200/50 text-slate-700 hover:bg-white hover:border-slate-300 shadow-2xs'
            }`}
          >
            {isFocusMode ? (
              <>
                <Minimize2 className="h-3.5 w-3.5" />
                <span>Свернуть</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-3.5 w-3.5" />
                <span>На весь экран</span>
              </>
            )}
          </button>

        </div>
      </div>

      <div 
        className={`relative bg-white/60 backdrop-blur-md rounded-3xl p-1.5 border border-slate-200/50 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0 ${isFocusMode ? '' : 'h-[880px]'}`}
      >
        
        {activeIsLoading && (
          <div className="absolute inset-0 bg-white/95 rounded-3xl flex flex-col p-8 gap-6 z-10 transition duration-350 select-none">
            {/* Skeleton Header */}
            <div className="flex items-center justify-between">
              <div className="h-6 w-48 bg-slate-200 rounded-lg" />
              <div className="flex gap-2">
                <div className="h-10 w-24 bg-slate-100 rounded-xl" />
                <div className="h-10 w-24 bg-slate-100 rounded-xl" />
              </div>
            </div>
            {/* Skeleton Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 flex-1 overflow-hidden">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="border border-slate-200/40 rounded-2xl p-5 space-y-4 bg-white/60 backdrop-blur-xs shadow-2xs">
                  <div className="flex justify-between items-center">
                    <div className="h-4 w-2/3 bg-slate-200 rounded" />
                    <div className="h-4 w-1/4 bg-slate-100 rounded" />
                  </div>
                  <div className="space-y-2">
                    <div className="h-3 w-full bg-slate-100 rounded" />
                    <div className="h-3 w-5/6 bg-slate-100 rounded" />
                    <div className="h-3 w-4/6 bg-slate-100 rounded" />
                  </div>
                  <div className="pt-2 flex gap-2">
                    <div className="h-7 w-16 bg-slate-100 rounded-lg" />
                    <div className="h-7 w-16 bg-slate-100 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {allowedTabs.length === 0 ? (
          <div className="flex-1 flex flex-col justify-center items-center p-8 text-center bg-slate-50/50 rounded-2xl select-none">
            <Lock className="h-10 w-10 text-slate-400 mb-3" />
            <span className="text-sm font-bold text-slate-800 uppercase tracking-tight">Доступ Заблокирован</span>
          </div>
        ) : (
          <div ref={scrollContainerRef} className="w-full h-full relative overflow-auto bg-slate-50/50 rounded-2xl">
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
                  src={getEmbeddableSheetUrl(tab.sheetUrl)}
                  onLoad={() => setLoadedFrameIds(prev => ({ ...prev, [tab.id]: true }))}
                  className="w-full h-full border-0 absolute top-0 left-0 rounded-2xl"
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
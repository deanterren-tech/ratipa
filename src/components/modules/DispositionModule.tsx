import { useState, useEffect, useRef } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../firebase';
import { 
  Map, 
  Maximize2, 
  Minimize2, 
  RefreshCw, 
  ExternalLink,
  Lock,
  ZoomIn,
  ZoomOut,
  Navigation,
  X,
  Minus
} from 'lucide-react';
import { useToast } from '../ToastProvider';

interface DispositionModuleProps {
  user: UserProfile;
}

export default function DispositionModule({ user }: DispositionModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isIframeLoading, setIsIframeLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0); 
  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('ratipa_zoom_disposition');
    return saved ? parseFloat(saved) : 1;
  });

  // Beltranssputnik GPS Notebook State
  const [isGpsOpen, setIsGpsOpen] = useState(() => localStorage.getItem('ratipa_gps_visible') === 'true');
  const [isGpsMinimized, setIsGpsMinimized] = useState(() => localStorage.getItem('ratipa_gps_minimized') === 'true');
  const [gpsTab, setGpsTab] = useState<'beltranssputnik' | 'wialon' | 'era_glonass'>('beltranssputnik');
  const [gpsPos, setGpsPos] = useState({ x: 20, y: 100 });
  const [gpsSize, setGpsSize] = useState({ width: 380, height: 450 });
  const [isGpsDragging, setIsGpsDragging] = useState(false);
  const [isGpsResizing, setIsGpsResizing] = useState(false);
  const [gpsDragOffset, setGpsDragOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isGpsDragging) {
        setGpsPos({
          x: Math.max(0, Math.min(window.innerWidth - 50, e.clientX - gpsDragOffset.x)),
          y: Math.max(0, Math.min(window.innerHeight - 50, e.clientY - gpsDragOffset.y))
        });
      } else if (isGpsResizing) {
        setGpsSize(prev => ({
          width: Math.max(250, Math.min(800, e.clientX - gpsPos.x + 10)),
          height: Math.max(150, Math.min(800, e.clientY - gpsPos.y + 10))
        }));
      }
    };
    const handleMouseUp = () => {
      setIsGpsDragging(false);
      setIsGpsResizing(false);
    };

    if (isGpsDragging || isGpsResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isGpsDragging, isGpsResizing, gpsDragOffset, gpsPos]);

  useEffect(() => {
    localStorage.setItem('ratipa_zoom_disposition', zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    const unsubscribe = dbService.getSettings((s) => setSettings(s));
    return () => unsubscribe();
  }, []);

  const fallbackUrl = settings?.googleSheetsUrl || "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0";
  const embedUrl = settings?.dispositionSheetUrl || fallbackUrl; 

  const handleRefresh = () => {
    setIsIframeLoading(true);
    setIframeKey(prev => prev + 1);
  };

  const renderGpsNotebook = () => {
    if (!isGpsOpen) return null;

    if (isGpsMinimized) {
      return (
        <div className="fixed bottom-4 left-4 z-50">
          <button
            type="button"
            onClick={() => {
              setIsGpsMinimized(false);
              localStorage.setItem('ratipa_gps_minimized', 'false');
            }}
            className="bg-indigo-500 hover:bg-indigo-600 font-sans text-white text-xs font-black uppercase tracking-widest py-3 px-6 rounded-full flex items-center gap-2 shadow-[0_10px_25px_rgba(99,102,241,0.4)] border border-indigo-600 transition-all duration-150 transform hover:scale-105 active:scale-95 cursor-pointer"
          >
            <Navigation size={14} className="animate-bounce" />
            <span>GPS: Белтрансспутник</span>
          </button>
        </div>
      );
    }

    return (
      <div 
        style={{
          position: 'fixed',
          left: `${gpsPos.x}px`,
          top: `${gpsPos.y}px`,
          width: `${gpsSize.width}px`,
          height: `${gpsSize.height}px`,
          zIndex: 100,
        }}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200/60 overflow-hidden flex flex-col font-sans"
      >
        <div 
          onMouseDown={(e) => {
            setIsGpsDragging(true);
            setGpsDragOffset({ x: e.clientX - gpsPos.x, y: e.clientY - gpsPos.y });
          }}
          className="bg-slate-50 border-b border-slate-200 p-3 flex items-center justify-between cursor-move select-none"
        >
          <div className="flex items-center gap-2">
            <span className="p-1 px-2.5 bg-indigo-500/10 text-indigo-600 font-black text-[9px] rounded-full uppercase tracking-wider font-mono">
              GPS
            </span>
            <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Белтрансспутник</h3>
          </div>
          <div className="flex items-center gap-1">
            <button 
              type="button"
              onClick={() => {
                setIsGpsMinimized(true);
                localStorage.setItem('ratipa_gps_minimized', 'true');
              }}
              className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-200 cursor-pointer"
            >
              <Minus size={15} />
            </button>
            <button 
              type="button"
              onClick={() => {
                setIsGpsOpen(false);
                localStorage.setItem('ratipa_gps_visible', 'false');
              }}
              className="text-slate-400 hover:text-slate-600 transition p-1 rounded-lg hover:bg-slate-200 cursor-pointer"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex flex-col p-3 overflow-hidden bg-white">
          <div className="flex items-center gap-2 mb-3 bg-slate-50 p-1 rounded-xl">
             <button onClick={() => setGpsTab('beltranssputnik')} className={`flex-1 text-[10px] font-black uppercase tracking-wider py-1.5 rounded-lg transition ${gpsTab === 'beltranssputnik' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-500 hover:bg-slate-100'}`}>Белтрансспутник</button>
             <button onClick={() => setGpsTab('wialon')} className={`flex-1 text-[10px] font-black uppercase tracking-wider py-1.5 rounded-lg transition ${gpsTab === 'wialon' ? 'bg-white shadow-sm text-orange-600' : 'text-slate-500 hover:bg-slate-100'}`}>Wialon</button>
             <button onClick={() => setGpsTab('era_glonass')} className={`flex-1 text-[10px] font-black uppercase tracking-wider py-1.5 rounded-lg transition ${gpsTab === 'era_glonass' ? 'bg-white shadow-sm text-blue-600' : 'text-slate-500 hover:bg-slate-100'}`}>ЭРА ГЛОНАСС</button>
          </div>

          <div className="flex-1 bg-slate-100 rounded-xl overflow-hidden border border-slate-200 relative">
             <iframe
               src={settings?.gpsBeltranssputnikUrl || "https://beltranssputnik.by"}
               className="w-full h-full border-0 absolute inset-0"
               style={{ display: gpsTab === 'beltranssputnik' ? 'block' : 'none' }}
               referrerPolicy="no-referrer"
               title="Белтрансспутник"
             />
             <iframe
               src={settings?.gpsWialonUrl || "https://hosting.wialon.com/"}
               className="w-full h-full border-0 absolute inset-0"
               style={{ display: gpsTab === 'wialon' ? 'block' : 'none' }}
               referrerPolicy="no-referrer"
               title="Wialon"
             />
             <iframe
               src={settings?.gpsEraGlonassUrl || "https://aoglonass.ru/"}
               className="w-full h-full border-0 absolute inset-0"
               style={{ display: gpsTab === 'era_glonass' ? 'block' : 'none' }}
               referrerPolicy="no-referrer"
               title="ЭРА ГЛОНАСС"
             />
             <div className="absolute top-2 right-2 flex bg-white/80 p-1 rounded-md text-[9px] shadow-sm font-bold text-slate-500 backdrop-blur pointer-events-none">
                Сайт в iframe
             </div>
          </div>
        </div>

        <div 
          onMouseDown={(e) => {
            e.stopPropagation();
            setIsGpsResizing(true);
          }}
          className="absolute right-0 bottom-0 w-4 h-4 cursor-se-resize z-50 flex items-end justify-end p-1"
        >
          <div className="w-2 h-2 bg-slate-300 rounded-tl-sm"/>
        </div>
      </div>
    );
  };

  return (
    <div className={`w-full space-y-6 font-sans flex flex-col ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-2 lg:p-6' : 'h-full'}`}>
      {renderGpsNotebook()}
      
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col lg:flex-row items-center justify-between gap-6 select-none">
        
        <div className="flex items-center gap-4 w-full lg:w-auto">
          <div className="w-12 h-12 rounded-full bg-[#f97316]/10 border border-[#f97316]/30 flex items-center justify-center shrink-0">
            <Map className="h-5 w-5 text-[#f97316]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">
                Диспозиция
              </h1>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1 font-medium hidden sm:block">
              Полная таблица с информацией о текущем местонахождении авто, статусах и комментариях.
            </p>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row items-center gap-4 w-full lg:w-auto justify-start lg:justify-end">
          
          <div className="flex items-center gap-2.5">
            <button
               onClick={() => {
                 setIsGpsOpen(!isGpsOpen);
                 localStorage.setItem('ratipa_gps_visible', (!isGpsOpen).toString());
                 if (!isGpsOpen) setIsGpsMinimized(false);
               }}
               className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-tight transition cursor-pointer hidden sm:flex ${isGpsOpen ? 'bg-indigo-100 text-indigo-900 shadow-sm border border-indigo-200/50' : 'bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200/50'}`}
            >
               <Navigation className={`h-3.5 w-3.5 ${isGpsOpen ? 'text-indigo-600' : ''}`} />
               GPS Блокнот
            </button>

            <div className="flex bg-slate-100 p-1 rounded-xl items-center mr-2">
               <button onClick={() => setZoomLevel(z => Math.max(0.5, z - 0.1))} className="p-1 hover:bg-white rounded transition text-slate-600"><ZoomOut className="w-4 h-4"/></button>
               <span className="text-[10px] font-black w-10 text-center font-mono text-slate-700">{Math.round(zoomLevel * 100)}%</span>
               <button onClick={() => setZoomLevel(z => Math.min(2, z + 0.1))} className="p-1 hover:bg-white rounded transition text-slate-600"><ZoomIn className="w-4 h-4"/></button>
            </div>

            <button
              onClick={handleRefresh}
              className="flex items-center justify-center bg-slate-50 hover:bg-slate-100 text-slate-700 w-10 h-10 rounded-xl border border-slate-200/50 transition cursor-pointer"
              title="Перезагрузить фрейм"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
  
            <a
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 bg-slate-950 hover:bg-slate-850 text-white text-[11px] font-black px-4 py-2.5 rounded-xl transition cursor-pointer shadow-xs uppercase tracking-tight hidden sm:flex"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Вкладка</span>
            </a>
  
            <button
              onClick={() => setIsFocusMode(!isFocusMode)}
              className={`flex items-center justify-center w-10 h-10 rounded-xl border transition cursor-pointer ${
                isFocusMode 
                  ? 'bg-[#f97316] border-[#f97316] text-white shadow-sm' 
                  : 'bg-white border-slate-250 text-slate-700 hover:bg-slate-50'
              }`}
              title="На весь экран"
            >
              {isFocusMode ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>

        </div>
      </div>

      <div 
        className="relative bg-slate-100 rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden flex-1 flex flex-col"
        style={{ minHeight: isFocusMode ? 'calc(100vh - 120px)' : 'calc(100vh - 230px)' }}
      >
        
        {isIframeLoading && (
          <div className="absolute inset-0 bg-white/85 backdrop-blur-md flex flex-col justify-center items-center z-10 transition duration-350 select-none">
            <div className="relative">
              <div className="h-14 w-14 rounded-full border-4 border-slate-100 border-t-[#f97316] animate-spin" />
              <Map className="h-5 w-5 text-[#f97316] absolute top-4.5 left-4.5" />
            </div>
            <span className="text-sm font-black text-slate-900 mt-5 uppercase tracking-wider font-mono animate-pulse">
              Загрузка карты диспозиции...
            </span>
          </div>
        )}

        {user.permissions.disposition === 'none' ? (
          <div className="flex-1 flex flex-col justify-center items-center p-8 text-center select-none">
            <Lock className="h-10 w-10 text-slate-900 mb-2" />
            <span className="text-sm font-black text-slate-900 uppercase tracking-tight">Доступ Заблокирован</span>
          </div>
        ) : (
          <div className="w-full h-full relative overflow-auto bg-slate-100/50" style={{ minHeight: isFocusMode ? 'calc(100vh - 130px)' : 'calc(100vh - 240px)' }}>
            <div style={{
               width: `${100 / zoomLevel}%`,
               height: `${100 / zoomLevel}%`,
               transform: `scale(${zoomLevel})`,
               transformOrigin: '0 0',
               minHeight: '100%',
               position: 'absolute'
            }}>
              <iframe
                key={iframeKey}
                src={embedUrl}
                onLoad={() => setIsIframeLoading(false)}
                className="w-full h-full border-0 absolute top-0 left-0"
                allow="clipboard-write"
                title="Диспозиция"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

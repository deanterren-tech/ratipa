import React, {useState, useEffect, useRef} from 'react'
import {UserProfile, AppSettings} from '../../types'
import {dbService} from '../../api'
import {getEmbeddableSheetUrl} from '../../utils/embed'
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
  Minus,
  Truck,
  Home,
  Search,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet
} from 'lucide-react';

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

  const [frameHeight, setFrameHeight] = useState(() => {
    const saved = localStorage.getItem('ratipa_height_disposition');
    return saved ? parseInt(saved, 10) : 600;
  });

   const scrollContainerRef = useRef<HTMLDivElement>(null);
   const gpsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    localStorage.setItem('ratipa_height_disposition', frameHeight.toString());
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
  }, [iframeKey]);

  // Beltranssputnik GPS Notebook State
  const [isGpsOpen, setIsGpsOpen] = useState(() => localStorage.getItem('ratipa_gps_visible') === 'true');
  const [isGpsMinimized, setIsGpsMinimized] = useState(() => localStorage.getItem('ratipa_gps_minimized') === 'true');
  const [gpsTab, setGpsTab] = useState<'beltranssputnik' | 'wialon' | 'era_glonass'>('beltranssputnik');

  useEffect(() => {
    const el = gpsContainerRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', handleWheel);
    };
  }, [gpsTab, isGpsOpen]);
  
  const [gpsPos, setGpsPos] = useState<{ x: number; y: number }>(() => {
    try {
      const saved = localStorage.getItem('ratipa_gps_pos');
      return saved ? JSON.parse(saved) : { x: 20, y: 100 };
    } catch {
      return { x: 20, y: 100 };
    }
  });

  const [gpsSize, setGpsSize] = useState<{ width: number; height: number }>(() => {
    try {
      const saved = localStorage.getItem('ratipa_gps_size');
      return saved ? JSON.parse(saved) : { width: 850, height: 580 };
    } catch {
      return { width: 850, height: 580 };
    }
  });

  const [isGpsDragging, setIsGpsDragging] = useState(false);
  const [isGpsResizing, setIsGpsResizing] = useState<string | false>(false);
  const [gpsDragOffset, setGpsDragOffset] = useState({ x: 0, y: 0 });
  const [gpsResizeStart, setGpsResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0, mouseX: 0, mouseY: 0 });

  const gpsPosRef = React.useRef(gpsPos);
  const gpsSizeRef = React.useRef(gpsSize);
  React.useEffect(() => { gpsPosRef.current = gpsPos; }, [gpsPos]);
  React.useEffect(() => { gpsSizeRef.current = gpsSize; }, [gpsSize]);

  const gpsWindowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const el = gpsWindowRef.current;
      if (!el) return;
      
      if (isGpsDragging) {
        const nextX = Math.max(0, Math.min(window.innerWidth - 100, e.clientX - gpsDragOffset.x));
        const nextY = Math.max(0, Math.min(window.innerHeight - 100, e.clientY - gpsDragOffset.y));
        el.style.left = `${nextX}px`;
        el.style.top = `${nextY}px`;
        gpsPosRef.current = { x: nextX, y: nextY };
      } else if (isGpsResizing) {
        const deltaX = e.clientX - gpsResizeStart.mouseX;
        const deltaY = e.clientY - gpsResizeStart.mouseY;

        let newW = gpsResizeStart.w;
        let newH = gpsResizeStart.h;
        let newX = gpsResizeStart.x;
        let newY = gpsResizeStart.y;

        if (isGpsResizing.includes('e')) {
          newW = Math.max(250, gpsResizeStart.w + deltaX);
        }
        if (isGpsResizing.includes('s')) {
          newH = Math.max(150, gpsResizeStart.h + deltaY);
        }
        if (isGpsResizing.includes('w')) {
          newW = Math.max(250, gpsResizeStart.w - deltaX);
          newX = gpsResizeStart.x + (gpsResizeStart.w - newW);
        }
        if (isGpsResizing.includes('n')) {
          newH = Math.max(150, gpsResizeStart.h - deltaY);
          newY = gpsResizeStart.y + (gpsResizeStart.h - newH);
        }

        el.style.width = `${newW}px`;
        el.style.height = `${newH}px`;
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
        
        gpsSizeRef.current = { width: newW, height: newH };
        gpsPosRef.current = { x: newX, y: newY };
      }
    };
    const handleMouseUp = () => {
      if (isGpsDragging) {
        setGpsPos(gpsPosRef.current);
        setIsGpsDragging(false);
      }
      if (isGpsResizing) {
        setGpsSize(gpsSizeRef.current);
        setGpsPos(gpsPosRef.current);
        setIsGpsResizing(false);
      }
      try {
        localStorage.setItem('ratipa_gps_pos', JSON.stringify(gpsPosRef.current));
        localStorage.setItem('ratipa_gps_size', JSON.stringify(gpsSizeRef.current));
      } catch (err) {
        console.error('Error saving GPS coords to storage:', err);
      }
    };

    if (isGpsDragging || isGpsResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isGpsDragging, isGpsResizing, gpsDragOffset, gpsResizeStart]);

  useEffect(() => {
    localStorage.setItem('ratipa_zoom_disposition', zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    const unsubscribe = dbService.getSettings((s) => setSettings(s));
    return () => unsubscribe();
  }, []);

  const embedUrl = getEmbeddableSheetUrl(settings?.dispositionSheetUrl || settings?.googleSheetsUrl || ""); 

  const handleRefresh = () => {
    setIsIframeLoading(true);
    setIframeKey(prev => prev + 1);
  };

  const renderGpsNotebook = () => {
    if (!isGpsOpen) return null;

    if (isGpsMinimized) {
      return (
        <div className="fixed bottom-4 left-4 z-50 animate-fade-in">
          <button
            type="button"
            onClick={() => {
              setIsGpsMinimized(false);
              localStorage.setItem('ratipa_gps_minimized', 'false');
            }}
            className="bg-[#3765F6] hover:bg-[#3765F6]/90 font-sans text-white text-xs font-bold tracking-tight py-2.5 px-5 rounded-xl flex items-center gap-2 shadow-lg shadow-[#3765F6]/20 border border-[#3765F6]/20 transition-all duration-150 transform hover:scale-[1.03] active:scale-95 cursor-pointer"
          >
            <Navigation size={13} />
            <span>GPS Мониторинг</span>
          </button>
        </div>
      );
    }

    return (
      <div 
        ref={gpsWindowRef}
        style={{
          position: 'fixed',
          left: `${gpsPos.x}px`,
          top: `${gpsPos.y}px`,
          width: `${gpsSize.width}px`,
          height: `${gpsSize.height}px`,
          zIndex: 100,
        }}
        className="bg-white/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-slate-200/40 overflow-hidden flex flex-col font-sans"
      >
        <div 
          onMouseDown={(e) => {
            setIsGpsDragging(true);
            setGpsDragOffset({ x: e.clientX - gpsPos.x, y: e.clientY - gpsPos.y });
          }}
          className="bg-white/60 border-b border-slate-100 p-3 flex items-center justify-between cursor-move select-none gap-4"
        >
          <div className="flex items-center gap-2 shrink-0">
            <span className="p-1 px-2.5 bg-[#3765F6]/10 text-[#3765F6] font-bold text-[9px] rounded-lg uppercase tracking-wider font-mono">
              GPS
            </span>
            <h3 className="text-xs font-bold text-slate-800 tracking-tight hidden sm:block font-sans">
              {gpsTab === 'beltranssputnik' ? 'Белтранс' : gpsTab === 'wialon' ? 'Wialon' : 'ГЛОНАСС'}
            </h3>
          </div>

          {/* Centered Segmented Tabs in the Header */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl gap-1 shrink-0" onMouseDown={(e) => e.stopPropagation()}>
            <button
              onClick={() => setGpsTab('beltranssputnik')}
              className={`px-3 py-1 text-[10px] font-bold tracking-tight rounded-lg transition-all duration-150 cursor-pointer ${
                gpsTab === 'beltranssputnik' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/30' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/30'
              }`}
            >
              Белтранс
            </button>
            <button
              onClick={() => setGpsTab('wialon')}
              className={`px-3 py-1 text-[10px] font-bold tracking-tight rounded-lg transition-all duration-150 cursor-pointer ${
                gpsTab === 'wialon' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/30' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/30'
              }`}
            >
              Wialon
            </button>
            <button
              onClick={() => setGpsTab('era_glonass')}
              className={`px-3 py-1 text-[10px] font-bold tracking-tight rounded-lg transition-all duration-150 cursor-pointer ${
                gpsTab === 'era_glonass' 
                  ? 'bg-white text-slate-900 shadow-xs border border-slate-200/30' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-white/30'
              }`}
            >
              ГЛОНАСС
            </button>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button 
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setIsGpsMinimized(true);
                localStorage.setItem('ratipa_gps_minimized', 'true');
              }}
              className="text-slate-400 hover:text-slate-700 transition-all p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              title="Свернуть"
            >
              <Minus size={14} />
            </button>
            <button 
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => {
                setIsGpsOpen(false);
                localStorage.setItem('ratipa_gps_visible', 'false');
              }}
              className="text-slate-400 hover:text-rose-600 transition-all p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
              title="Закрыть"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 p-2 overflow-hidden bg-white/40 flex flex-row gap-2 min-h-0">
          {/* Map Container */}
          <div ref={gpsContainerRef} className="flex-1 bg-white rounded-xl overflow-hidden border border-slate-100 relative">
             <iframe
               src={settings?.gpsBeltranssputnikUrl || "https://beltranssputnik.by"}
               className="w-full h-full border-0 absolute inset-0"
               style={{ 
                 display: gpsTab === 'beltranssputnik' ? 'block' : 'none',
                 pointerEvents: (isGpsDragging || isGpsResizing) ? 'none' : 'auto'
               }}
               referrerPolicy="no-referrer"
               title="Белтрансспутник"
             />
             <iframe
               src={settings?.gpsWialonUrl || "https://hosting.wialon.com/"}
               className="w-full h-full border-0 absolute inset-0"
               style={{ 
                 display: gpsTab === 'wialon' ? 'block' : 'none',
                 pointerEvents: (isGpsDragging || isGpsResizing) ? 'none' : 'auto'
               }}
               referrerPolicy="no-referrer"
               title="Wialon"
             />
             <iframe
               src={settings?.gpsEraGlonassUrl || "https://aoglonass.ru/"}
               className="w-full h-full border-0 absolute inset-0"
               style={{ 
                 display: gpsTab === 'era_glonass' ? 'block' : 'none',
                 pointerEvents: (isGpsDragging || isGpsResizing) ? 'none' : 'auto'
               }}
               referrerPolicy="no-referrer"
               title="ЭРА ГЛОНАСС"
             />
             <div className="absolute top-2 right-2 flex bg-white/80 p-1 px-2 rounded-lg text-[9px] shadow-sm font-bold text-slate-500 backdrop-blur pointer-events-none border border-slate-200/50">
                Сайт в iframe
             </div>
          </div>
        </div>

        {/* Multi-angle Resize Handles for GPS window */}
        {[
          { dir: 'n', cursor: 'ns-resize', className: 'absolute top-0 left-3 right-3 h-2 z-50' },
          { dir: 's', cursor: 'ns-resize', className: 'absolute bottom-0 left-3 right-3 h-2 z-50' },
          { dir: 'w', cursor: 'ew-resize', className: 'absolute top-3 bottom-3 left-0 w-2 z-50' },
          { dir: 'e', cursor: 'ew-resize', className: 'absolute top-3 bottom-3 right-0 w-2 z-50' },
          { dir: 'nw', cursor: 'nwse-resize', className: 'absolute top-0 left-0 w-4 h-4 z-50' },
          { dir: 'ne', cursor: 'nesw-resize', className: 'absolute top-0 right-0 w-4 h-4 z-50' },
          { dir: 'sw', cursor: 'nesw-resize', className: 'absolute bottom-0 left-0 w-4 h-4 z-50' },
          { dir: 'se', cursor: 'nwse-resize', className: 'absolute bottom-0 right-0 w-5 h-5 flex items-end justify-end p-1.5 group z-50' }
        ].map(handle => (
          <div 
            key={handle.dir}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsGpsResizing(handle.dir);
              setGpsResizeStart({
                x: gpsPos.x,
                y: gpsPos.y,
                w: gpsSize.width,
                h: gpsSize.height,
                mouseX: e.clientX,
                mouseY: e.clientY
              });
            }}
            className={handle.className}
            style={{ cursor: handle.cursor }}
            title={handle.dir === 'se' ? "Растянуть GPS блокнот" : ""}
          >
            {handle.dir === 'se' && (
              <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-slate-400 group-hover:border-slate-700 transition-colors pointer-events-none" />
            )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className={`w-full space-y-2 font-sans flex flex-col ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-2 lg:p-4' : 'h-full'}`}>
      {(isGpsDragging || isGpsResizing) && (
        <div 
          className="fixed inset-0 z-[99999] bg-transparent select-none pointer-events-auto"
          style={{ cursor: isGpsDragging ? 'move' : 'resize' }}
        />
      )}
      {renderGpsNotebook()}
      
      <div className="bg-white/70 backdrop-blur-xl rounded-2xl p-4 border border-slate-200/40 shadow-xs flex flex-col sm:flex-row items-center justify-between gap-3 select-none">
        
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="w-9 h-9 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
            <Map className="h-4.5 w-4.5 text-orange-600" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-slate-950 font-sans tracking-tight">
                Диспозиция
              </h1>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5 font-medium hidden sm:block font-sans">
              Полная таблица с информацией о местонахождении авто, статусах и комментариях
            </p>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-2.5 w-full sm:w-auto justify-start sm:justify-end">
          
          <div className="flex items-center gap-2">
            <button
               onClick={() => {
                 setIsGpsOpen(!isGpsOpen);
                 localStorage.setItem('ratipa_gps_visible', (!isGpsOpen).toString());
                 if (!isGpsOpen) setIsGpsMinimized(false);
               }}
               className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[11px] font-bold tracking-tight border transition-all duration-150 active:scale-95 cursor-pointer hidden sm:flex ${isGpsOpen ? 'bg-[#3765F6]/10 text-[#3765F6] border-[#3765F6]/25 shadow-xs font-semibold' : 'bg-white/65 text-slate-600 border-slate-200/50 hover:bg-slate-50 hover:text-slate-800 hover:border-slate-300'}`}
            >
               <Navigation className={`h-3 w-3 ${isGpsOpen ? 'text-[#3765F6]' : ''}`} />
               GPS Блокнот
            </button>

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
              className="flex items-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-bold px-3 py-1.5 rounded-xl transition-all shadow-xs tracking-tight hidden sm:flex hover:shadow-sm active:scale-95 cursor-pointer"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              <span>Открыть в новой вкладке</span>
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
      </div>

      <div 
        className={`relative bg-white/65 backdrop-blur-md rounded-2xl border border-slate-200/40 shadow-xs overflow-hidden flex-1 flex flex-col min-h-0 ${isFocusMode ? '' : 'h-[880px]'}`}
      >
        
        {(!settings || isIframeLoading) && (
          <div className="absolute inset-0 bg-white/85 backdrop-blur-md flex flex-col p-8 gap-6 z-10 transition duration-350 select-none">
            {/* Table Area Skeleton */}
            <div className="flex-1 bg-white/40 rounded-2xl border border-slate-200/30 flex items-center justify-center relative overflow-hidden animate-pulse">
              <div className="text-center space-y-2.5 z-10">
                <FileSpreadsheet className="h-8 w-8 text-[#3765F6]/40 mx-auto animate-bounce" />
                <p className="text-xs font-bold uppercase text-slate-500 tracking-wider font-sans">Интеграция Google Sheets</p>
                <p className="text-[11px] text-slate-400 normal-case font-bold font-sans">Загрузка таблицы диспозиции...</p>
              </div>
            </div>
            {/* Sidebar/Details Skeleton */}
            <div className="h-24 flex gap-4">
              <div className="flex-1 bg-white/40 border border-slate-200/30 rounded-xl p-4 flex flex-col justify-between animate-pulse">
                <div className="h-3 w-1/3 bg-slate-200/60 rounded" />
                <div className="h-4 w-1/2 bg-slate-100/60 rounded" />
              </div>
              <div className="flex-1 bg-white/40 border border-slate-200/30 rounded-xl p-4 flex flex-col justify-between animate-pulse">
                <div className="h-3 w-1/4 bg-slate-200/60 rounded" />
                <div className="h-4 w-2/3 bg-slate-100/60 rounded" />
              </div>
              <div className="flex-1 bg-white/40 border border-slate-200/30 rounded-xl p-4 flex flex-col justify-between animate-pulse">
                <div className="h-3 w-1/2 bg-slate-200/60 rounded" />
                <div className="h-4 w-1/3 bg-slate-100/60 rounded" />
              </div>
            </div>
          </div>
        )}

        {user.permissions.disposition === 'none' ? (
          <div className="flex-1 flex flex-col justify-center items-center p-8 text-center select-none">
            <Lock className="h-10 w-10 text-slate-900 mb-2" />
            <span className="text-sm font-black text-slate-900 uppercase tracking-tight">Доступ Заблокирован</span>
          </div>
        ) : (
          <div ref={scrollContainerRef} className="w-full h-full relative overflow-auto bg-slate-50/40 overscroll-contain">
            <div style={{
               width: `${100 / zoomLevel}%`,
               height: `${100 / zoomLevel}%`,
               transform: `scale(${zoomLevel})`,
               transformOrigin: '0 0',
               minHeight: '100%',
               position: 'absolute'
            }}>
              {settings && embedUrl && (
                <iframe
                  key={iframeKey + '-' + embedUrl}
                  src={embedUrl}
                  onLoad={() => setIsIframeLoading(false)}
                  className="w-full h-full border-0 absolute top-0 left-0"
                  style={{
                    pointerEvents: (isGpsDragging || isGpsResizing) ? 'none' : 'auto'
                  }}
                  allow="clipboard-write"
                  title="Диспозиция"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

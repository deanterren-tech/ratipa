import {useState, useEffect, useRef} from 'react'
import {UserProfile, AppSettings} from '../../types'
import {dbService} from '../../api'
import {getEmbeddableSheetUrl} from '../../utils/embed'
import GoogleSheetFrame from '../common/GoogleSheetFrame'
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
  FileSpreadsheet,
  Satellite,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface DispositionModuleProps {
  user: UserProfile;
}

type GpsTab = 'beltranssputnik' | 'wialon' | 'era_glonass';

export default function DispositionModule({ user }: DispositionModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isIframeLoading, setIsIframeLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0);

  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('ratipa_zoom_disposition');
    return saved ? parseInt(saved, 10) : 100;
  });

  const [frameHeight, setFrameHeight] = useState(() => {
    const saved = localStorage.getItem('ratipa_height_disposition');
    return saved ? parseInt(saved, 10) : 600;
  });

  // GPS notebook state
  const [gpsOpen, setGpsOpen] = useState(false);
  const [gpsMin, setGpsMin] = useState(false);
  const [gpsTab, setGpsTab] = useState<GpsTab>('beltranssputnik');
  const [gpsPos, setGpsPos] = useState<{ x: number; y: number }>({ x: 20, y: 100 });
  const [gpsSize, setGpsSize] = useState<{ width: number; height: number }>({ width: 850, height: 580 });
  const [isGpsDragging, setIsGpsDragging] = useState(false);
  const [isGpsResizing, setIsGpsResizing] = useState<string | false>(false);
  const [gpsDragOffset, setGpsDragOffset] = useState({ x: 0, y: 0 });
  const [gpsResizeStart, setGpsResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0, mouseX: 0, mouseY: 0 });
  const gpsPosRef = useRef(gpsPos);
  const gpsSizeRef = useRef(gpsSize);
  const gpsWindowRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => { gpsPosRef.current = gpsPos; }, [gpsPos]);
  useEffect(() => { gpsSizeRef.current = gpsSize; }, [gpsSize]);

  useEffect(() => {
    localStorage.setItem('ratipa_zoom_disposition', zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    localStorage.setItem('ratipa_height_disposition', frameHeight.toString());
  }, [frameHeight]);

  useEffect(() => {
    const unsubscribe = dbService.getSettings((s) => setSettings(s));
    return () => unsubscribe();
  }, []);

  // GPS drag/resize handlers
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
        if (isGpsResizing.includes('e')) newW = Math.max(250, gpsResizeStart.w + deltaX);
        if (isGpsResizing.includes('s')) newH = Math.max(150, gpsResizeStart.h + deltaY);
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
      if (isGpsDragging) { setGpsPos(gpsPosRef.current); setIsGpsDragging(false); }
      if (isGpsResizing) { setGpsSize(gpsSizeRef.current); setGpsPos(gpsPosRef.current); setIsGpsResizing(false); }
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

  const embedUrl = getEmbeddableSheetUrl(settings?.dispositionSheetUrl || settings?.googleSheetsUrl || "");
  
  const gpsUrls: Record<GpsTab, string> = {
    beltranssputnik: settings?.gpsBeltranssputnikUrl || "https://beltranssputnik.by",
    wialon: settings?.gpsWialonUrl || "https://hosting.wialon.com/",
    era_glonass: settings?.gpsEraGlonassUrl || "https://aoglonass.ru/",
  };

  const handleRefresh = () => {
    setIframeKey(prev => prev + 1);
    setIsIframeLoading(true);
  };

  const iconBtn =
    "inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200/70 bg-white/60 text-slate-700 hover:bg-white transition backdrop-blur cursor-pointer";

  const renderGpsNotebook = () => {
    if (!gpsOpen) return null;

    if (gpsMin) {
      return (
        <div className="fixed bottom-4 left-4 z-50 animate-[fade-in_0.2s_ease]">
          <button
            type="button"
            onClick={() => { setGpsMin(false); }}
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
          position: "fixed",
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
              onClick={() => { setGpsMin(true); }}
              className="text-slate-400 hover:text-slate-700 transition-all p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"
              title="Свернуть"
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => { setGpsOpen(false); }}
              className="text-slate-400 hover:text-rose-600 transition-all p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer"
              title="Закрыть"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        <div className="flex-1 p-2 overflow-hidden bg-white/40 flex flex-row gap-2 min-h-0">
          <div className="flex-1 bg-white rounded-xl overflow-hidden border border-slate-100 relative">
            <iframe
              src={gpsUrls.beltranssputnik}
              className="w-full h-full border-0 absolute inset-0"
              style={{ 
                display: gpsTab === 'beltranssputnik' ? 'block' : 'none',
                pointerEvents: (isGpsDragging || isGpsResizing) ? 'none' : 'auto'
              }}
              referrerPolicy="no-referrer"
              title="Белтрансспутник"
            />
            <iframe
              src={gpsUrls.wialon}
              className="w-full h-full border-0 absolute inset-0"
              style={{ 
                display: gpsTab === 'wialon' ? 'block' : 'none',
                pointerEvents: (isGpsDragging || isGpsResizing) ? 'none' : 'auto'
              }}
              referrerPolicy="no-referrer"
              title="Wialon"
            />
            <iframe
              src={gpsUrls.era_glonass}
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

        {/* Resize handles */}
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
      
      <GoogleSheetFrame
        title="Диспозиция"
        subtitle="Полная таблица с информацией о местонахождении авто, статусах и комментариях"
        url={embedUrl}
        zoom={zoomLevel}
        onZoomChange={setZoomLevel}
        onRefresh={handleRefresh}
        collapseKey="disposition"
        toolbar
      >
        {!embedUrl ? (
          <div className="absolute inset-0 flex items-center justify-center text-center text-slate-400 text-sm px-8">
            Ссылка на таблицу диспозиции не задана.<br />
            Укажите её в Справочниках / Настройках (dispositionSheetUrl).
          </div>
        ) : (
          <div
            style={{
              width: `${10000 / zoomLevel}%`,
              height: `${10000 / zoomLevel}%`,
              transform: `scale(${zoomLevel / 100})`,
              transformOrigin: "top left",
            }}
          >
            <iframe
              key={iframeKey + "-" + embedUrl}
              src={embedUrl}
              title="Диспозиция"
              className="w-full h-full border-0"
              onLoad={() => setIsIframeLoading(false)}
            />
          </div>
        )}
      </GoogleSheetFrame>
    </div>
  );
}
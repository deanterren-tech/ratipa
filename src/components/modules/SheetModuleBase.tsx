import { useState, useRef, useEffect } from "react";
import { dbService } from "../../api";
import { AppSettings, UserProfile } from "../../types";
import { getEmbeddableSheetUrl } from "../../utils/embed";
import {
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Minimize2,
  ExternalLink,
  Satellite,
  ChevronDown,
  ChevronUp,
  Navigation,
  X,
  Loader2,
  AlertCircle,
  type LucideIcon,
} from "lucide-react";

type GpsTab = "beltranssputnik" | "wialon" | "era_glonass";

/** Столько ждём открытие таблицы, прежде чем показать сообщение об ошибке. */
const LOAD_TIMEOUT_MS = 20000;

export interface SheetTab {
  id: string;
  name: string;
  sheetUrl: string;
}

interface SheetModuleBaseProps {
  user: UserProfile;
  moduleKey: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  tabs: SheetTab[];
  gpsUrls: Record<GpsTab, string>;
  gpsEnabled?: boolean;
  showTabs?: boolean;
}

/**
 * Единая оболочка для модулей-таблиц (Диспозиция / Текущее планирование / План загрузок).
 * Внутренние функции едины для всех экранов: плавающая плашка поверх фрейма со
 * сворачиванием, GPS-блокнот (drag + resize), зум, табы, открытие в новой вкладке.
 * На телефоне (<768px) модуль — ОБЫЧНАЯ СТРАНИЦА в потоке оболочки: шапка портала
 * видна сверху, нижняя навигация снизу, скролл не блокируется; переход назад — через
 * навигацию приложения (своей кнопки «Назад» у страницы нет). На десктопе поведение
 * прежнее — слой ниже шапки на всю высоту экрана.
 */
export default function SheetModuleBase({
  user,
  moduleKey,
  title,
  subtitle,
  icon: Icon,
  tabs,
  gpsUrls,
  gpsEnabled = true,
  showTabs = true,
}: SheetModuleBaseProps) {
  const scaleKey = `ratipa_sheet_zoom_${user.uid || user.name || 'default'}_${moduleKey}`;
  const [zoom, setZoom] = useState(() => {
    const saved = localStorage.getItem(scaleKey);
    return saved ? Number(saved) : 100;
  });
  const [frameKey, setFrameKey] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  // Таблица не успела открыться за отведённое время — показываем понятное
  // сообщение с повтором. Способ повтора прежний: перезагрузка кадра.
  const [loadError, setLoadError] = useState(false);
  // Таймер ложной ошибки: обязательно снимаем его при успешной загрузке,
  // иначе экран ошибки появляется поверх уже работающей таблицы.
  const loadTimerRef = useRef<number | null>(null);

  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  useEffect(() => {
    const first = tabs[0]?.id;
    if (!first) return;
    if (!activeTabId || !tabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(first);
    }
  }, [tabs, activeTabId]);

  const activeTab = tabs.find((t) => t.id === activeTabId) || tabs[0];
  const embedUrl = activeTab ? getEmbeddableSheetUrl(activeTab.sheetUrl) : "";

  useEffect(() => {
    if (embedUrl) setLoading(true);
  }, [frameKey, embedUrl]);

  useEffect(() => {
    if (loadTimerRef.current) { window.clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }
    if (!embedUrl) { setLoadError(false); return; }
    setLoadError(false);
    loadTimerRef.current = window.setTimeout(() => {
      loadTimerRef.current = null;
      setLoadError(true);
      setLoading(false);
    }, LOAD_TIMEOUT_MS);
    return () => {
      if (loadTimerRef.current) { window.clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }
    };
  }, [frameKey, embedUrl]);

  /** Успешная загрузка кадра: снимаем экран загрузки И таймер ошибки. */
  const handleFrameLoad = () => {
    if (loadTimerRef.current) { window.clearTimeout(loadTimerRef.current); loadTimerRef.current = null; }
    setLoading(false);
    setLoadError(false);
  };

  const retryLoad = () => {
    setLoadError(false);
    setLoading(true);
    setFrameKey((k) => k + 1);
  };

  const changeZoom = (next: number) => {
    const clamped = Math.max(50, Math.min(200, next));
    setZoom(clamped);
    localStorage.setItem(scaleKey, String(clamped));
  };

  // === GPS-блокнот: drag + resize ===
  const [gpsOpen, setGpsOpen] = useState(false);
  const [gpsMin, setGpsMin] = useState(false);
  const [gpsTab, setGpsTab] = useState<GpsTab>("beltranssputnik");

  const [gpsPos, setGpsPos] = useState<{ x: number; y: number }>(() => {
    const saved = localStorage.getItem(`ratipa_gps_pos_${user.uid}_${moduleKey}`);
    return saved ? JSON.parse(saved) : { x: 20, y: 100 };
  });
  const [gpsSize, setGpsSize] = useState<{ width: number; height: number }>(() => {
    const saved = localStorage.getItem(`ratipa_gps_size_${user.uid}_${moduleKey}`);
    return saved ? JSON.parse(saved) : { width: 850, height: 580 };
  });
  const [isGpsDragging, setIsGpsDragging] = useState(false);
  const [isGpsResizing, setIsGpsResizing] = useState<string | false>(false);
  const [gpsDragOffset, setGpsDragOffset] = useState({ x: 0, y: 0 });
  const [gpsResizeStart, setGpsResizeStart] = useState({ x: 0, y: 0, w: 0, h: 0, mouseX: 0, mouseY: 0 });
  const gpsPosRef = useRef(gpsPos);
  const gpsSizeRef = useRef(gpsSize);
  const gpsWindowRef = useRef<HTMLDivElement>(null);
  useEffect(() => { gpsPosRef.current = gpsPos; }, [gpsPos]);
  useEffect(() => { gpsSizeRef.current = gpsSize; }, [gpsSize]);
  useEffect(() => { if (gpsPos) localStorage.setItem(`ratipa_gps_pos_${user.uid}_${moduleKey}`, JSON.stringify(gpsPos)); }, [gpsPos, user.uid, moduleKey]);
  useEffect(() => { if (gpsSize) localStorage.setItem(`ratipa_gps_size_${user.uid}_${moduleKey}`, JSON.stringify(gpsSize)); }, [gpsSize, user.uid, moduleKey]);

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
        if (isGpsResizing.includes("e")) newW = Math.max(250, gpsResizeStart.w + deltaX);
        if (isGpsResizing.includes("s")) newH = Math.max(150, gpsResizeStart.h + deltaY);
        if (isGpsResizing.includes("w")) {
          newW = Math.max(250, gpsResizeStart.w - deltaX);
          newX = gpsResizeStart.x + (gpsResizeStart.w - newW);
        }
        if (isGpsResizing.includes("n")) {
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
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    }
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isGpsDragging, isGpsResizing, gpsDragOffset, gpsResizeStart]);

  const iconBtn =
    "inline-flex items-center justify-center h-8 w-9 sm:w-8 rounded-lg text-[#4B5563] hover:bg-[#F3F4F6] hover:text-[#121316] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]";
  const iconBtnActive =
    "inline-flex items-center justify-center h-8 w-9 sm:w-8 rounded-lg bg-[var(--accent-15)] text-[var(--accent-ink)] hover:bg-[var(--accent-20)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]";

  return (
    /* На телефоне (<768px) — обычная страница в потоке оболочки (relative, в прокрутке
       main): шапка портала сверху, нижняя навигация снизу, без оверлея. Страница занимает
       ровно область раздела и всегда помещается — ничего не уходит под полосу навигации.
       С md: — прежний слой ниже шапки (fixed top-16 bottom-0 z-40), как было. */
    <div className="fixed inset-0 z-[4500] overflow-hidden bg-[#F8F9FA] max-md:relative max-md:inset-auto max-md:z-0 max-md:h-full md:top-16 md:bottom-0 md:z-40">
      {/* === ШАПКА МОДУЛЯ: лежит поверх верхней части фрейма таблицы === */}
      {collapsed ? (
        /* Свёрнутая панель: от неё остаётся только кнопка поверх таблицы — как было раньше. */
        <button
          type="button"
          onClick={() => setCollapsed(false)}
          title={`Показать панель «${title}»`}
          aria-label={`Показать панель «${title}»`}
          aria-expanded={false}
          className="absolute right-3 top-3 z-[101] inline-flex min-h-[44px] max-w-[calc(100vw-24px)] items-center gap-1.5 rounded-xl bg-[var(--accent-solid)] px-3 text-xs font-semibold text-[var(--accent-on)] shadow-sm transition-all hover:bg-[var(--accent-hover)] active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] sm:min-h-0 sm:py-2"
        >
          <ChevronDown className="h-4 w-4 shrink-0" />
          <span className="truncate">{title}</span>
        </button>
      ) : (
        <div className="absolute left-0 right-0 top-0 z-[100] border-b border-[#E5E7EB] bg-white px-3 shadow-[0_8px_30px_rgba(0,0,0,0.06)] sm:px-4">
          <div className="flex items-center justify-between gap-3 flex-wrap py-2">
            <div className="flex items-center gap-1 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#4B5563]">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-[15px] font-semibold leading-none tracking-tight text-[#121316]">
                  {title}
                </h1>
                <p className="mt-0.5 hidden truncate text-[11px] text-[#6B7280] sm:block">
                  {subtitle}
                </p>
              </div>

              {/* Вкладки — подчёркнутая полоса как в «Учёте дозволов» */}
              {showTabs && tabs.length > 0 && (
                <div className="ml-1 flex items-center gap-4 overflow-x-auto scrollbar-none sm:ml-3">
                  {tabs.map((tab) => {
                    const active = tab.id === activeTabId;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => { setActiveTabId(tab.id); setFrameKey((k) => k + 1); }}
                        className={`-mb-2 cursor-pointer whitespace-nowrap border-b-2 px-0.5 pb-1.5 pt-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] ${
                          active
                            ? "border-[#121316] font-semibold text-[#121316]"
                            : "border-transparent text-[#6B7280] hover:text-[#121316]"
                        }`}
                        aria-current={active ? "page" : undefined}
                      >
                        {tab.name}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5">
              <button className={iconBtn} title="Увеличить масштаб" onClick={() => changeZoom(zoom + 10)}>
                <ZoomIn className="h-4 w-4" />
              </button>
              <button className={iconBtn} title="Уменьшить масштаб" onClick={() => changeZoom(zoom - 10)}>
                <ZoomOut className="h-4 w-4" />
              </button>
              <button
                className={iconBtn}
                title="Обновить таблицу"
                onClick={() => setFrameKey((k) => k + 1)}
              >
                <RefreshCw className="h-4 w-4" />
              </button>
              {gpsEnabled && (
                <button
                  className={gpsOpen ? iconBtnActive : iconBtn}
                  aria-pressed={gpsOpen}
                  title="GPS-блокнот"
                  onClick={() => { setGpsOpen((o) => !o); setGpsMin(false); }}
                >
                  <Satellite className="h-4 w-4" />
                </button>
              )}
              {embedUrl && (
                <a className={iconBtn} title="Открыть в новой вкладке" href={embedUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}
              <button className={iconBtn} title="На весь экран (браузер)" onClick={() => {
                const el = document.documentElement;
                if (!document.fullscreenElement) el.requestFullscreen?.();
                else document.exitFullscreen?.();
              }}>
                <Maximize2 className="h-4 w-4" />
              </button>
              <button
                className={iconBtn}
                title="Свернуть панель"
                aria-expanded={true}
                onClick={() => setCollapsed(true)}
              >
                <ChevronUp className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* === ОБЛАСТЬ ТАБЛИЦЫ (рамка принадлежит порталу, содержимое — Google).
             Занимает всю высоту: плашка при наложении закрывает её верхнюю часть. === */}
      <div className="absolute inset-0 px-1.5 pt-1.5 pb-[calc(env(safe-area-inset-bottom,0px)+6px)] sm:p-3">
        <div className="relative h-full w-full overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
        {embedUrl ? (
          <>
            <div
              style={{
                width: `${10000 / zoom}%`,
                height: `${10000 / zoom}%`,
                transform: `scale(${zoom / 100})`,
                transformOrigin: "top left",
              }}
            >
              <iframe
                key={frameKey + "-" + embedUrl}
                src={embedUrl}
                title={activeTab?.name || title}
                onLoad={handleFrameLoad}
                className="w-full h-full border-0"
              />
            </div>
            {loading && !loadError && (
              <div className="absolute inset-0 z-[2] flex items-center justify-center bg-white">
                <div className="flex flex-col items-center gap-3.5 px-8 text-center">
                  <img
                    src="/R-logo-2.svg"
                    alt=""
                    aria-hidden="true"
                    className="h-9 w-9 opacity-90"
                    draggable={false}
                  />
                  <div className="flex items-center gap-2 text-[#4B5563]">
                    <Loader2 className="h-4 w-4 animate-spin text-[var(--accent-ui)] motion-reduce:animate-none" />
                    <span className="text-[13px] font-medium">Загружаем таблицу…</span>
                  </div>
                  <p className="max-w-sm text-[11px] leading-relaxed text-[#9CA3AF]">
                    {title} · данные открываются из Google Таблицы
                  </p>
                </div>
              </div>
            )}
            {loadError && (
              <div className="absolute inset-0 z-[2] flex items-center justify-center bg-white">
                <div className="flex max-w-sm flex-col items-center gap-2.5 px-8 text-center">
                  <AlertCircle className="h-5 w-5 text-[#6B7280]" />
                  <p className="text-[13px] font-semibold text-[#121316]">Не удалось загрузить таблицу</p>
                  <p className="text-[11px] leading-relaxed text-[#6B7280]">
                    Проверьте подключение к интернету и попробуйте ещё раз.
                  </p>
                  <button
                    type="button"
                    onClick={retryLoad}
                    className="mt-1 inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--accent-solid)] px-4 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Повторить
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-8 text-center">
            <p className="text-[13px] font-semibold text-[#121316]">Ссылка на таблицу не задана</p>
            <p className="text-xs text-[#6B7280]">Укажите её в Справочниках или Настройках.</p>
          </div>
        )}
        </div>
      </div>

      {/* overlay при drag/resize GPS */}
      {(isGpsDragging || isGpsResizing) && (
        <div className="fixed inset-0 z-[99999] bg-transparent select-none pointer-events-auto" style={{ cursor: isGpsDragging ? "move" : "resize" }} />
      )}

      {/* === GPS-БЛОКНОТ (полный, drag + resize) === */}
      {gpsEnabled && gpsOpen &&
        (gpsMin ? (
          <div className="fixed bottom-[calc(env(safe-area-inset-bottom,0px)+108px)] md:bottom-4 left-4 z-50">
            <button
              type="button"
              onClick={() => { setGpsMin(false); }}
              className="bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] rounded-xl text-xs font-semibold px-4 py-2.5 transition-all cursor-pointer shadow-sm active:scale-95 flex items-center gap-2"
            >
              <Navigation size={13} />
              <span>GPS Мониторинг</span>
            </button>
          </div>
        ) : (
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
            className="flex flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_25px_60px_rgba(0,0,0,0.12)]"
          >
            <div
              onMouseDown={(e) => {
                setIsGpsDragging(true);
                setGpsDragOffset({ x: e.clientX - gpsPos.x, y: e.clientY - gpsPos.y });
              }}
              className="flex cursor-move select-none items-center justify-between gap-4 border-b border-[#E5E7EB] bg-white px-3 py-2.5"
            >
              <div className="flex items-center gap-2 shrink-0">
                <span className="rounded-lg bg-[#F3F4F6] px-2 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-[#4B5563]">
                  GPS
                </span>
                <h3 className="hidden text-xs font-semibold tracking-tight text-[#121316] sm:block">
                  {gpsTab === "beltranssputnik" ? "Белтранс" : gpsTab === "wialon" ? "Wialon" : "ГЛОНАСС"}
                </h3>
              </div>

              <div className="flex gap-1 rounded-xl bg-[#F3F4F6] p-1" onMouseDown={(e) => e.stopPropagation()}>
                <button
                  onClick={() => setGpsTab("beltranssputnik")}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    gpsTab === "beltranssputnik" ? "bg-[#121316] text-white" : "text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]"
                  }`}
                >
                  Белтранс
                </button>
                <button
                  onClick={() => setGpsTab("wialon")}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    gpsTab === "wialon" ? "bg-[#121316] text-white" : "text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]"
                  }`}
                >
                  Wialon
                </button>
                <button
                  onClick={() => setGpsTab("era_glonass")}
                  className={`cursor-pointer rounded-lg px-3 py-1.5 text-[11px] font-medium transition-colors ${
                    gpsTab === "era_glonass" ? "bg-[#121316] text-white" : "text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]"
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
                  className="cursor-pointer rounded-lg p-1.5 text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
                  title="Свернуть"
                >
                  <Minimize2 size={14} />
                </button>
                <button
                  type="button"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => { setGpsOpen(false); }}
                  className="cursor-pointer rounded-lg p-1.5 text-[#9CA3AF] transition-colors hover:bg-rose-50 hover:text-rose-600"
                  title="Закрыть"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            <div className="flex min-h-0 flex-1 flex-row gap-2 overflow-hidden bg-white p-2">
              <div className="relative flex-1 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
                <iframe
                  src={gpsUrls.beltranssputnik}
                  className="w-full h-full border-0 absolute inset-0"
                  style={{ display: gpsTab === "beltranssputnik" ? "block" : "none", pointerEvents: (isGpsDragging || isGpsResizing) ? "none" : "auto" }}
                  referrerPolicy="no-referrer"
                  title="Белтрансспутник"
                />
                <iframe
                  src={gpsUrls.wialon}
                  className="w-full h-full border-0 absolute inset-0"
                  style={{ display: gpsTab === "wialon" ? "block" : "none", pointerEvents: (isGpsDragging || isGpsResizing) ? "none" : "auto" }}
                  referrerPolicy="no-referrer"
                  title="Wialon"
                />
                <iframe
                  src={gpsUrls.era_glonass}
                  className="w-full h-full border-0 absolute inset-0"
                  style={{ display: gpsTab === "era_glonass" ? "block" : "none", pointerEvents: (isGpsDragging || isGpsResizing) ? "none" : "auto" }}
                  referrerPolicy="no-referrer"
                  title="ЭРА ГЛОНАСС"
                />
                <div className="absolute top-2 right-2 flex bg-white p-1 px-2 rounded-lg text-[9px] font-semibold text-[#6B7280] pointer-events-none border border-[#E5E7EB]">
                  Сайт в iframe
                </div>
              </div>
            </div>

            {/* Ресайз-хэндлы */}
            {[
              { dir: "n", cursor: "ns-resize", className: "absolute top-0 left-3 right-3 h-2 z-50" },
              { dir: "s", cursor: "ns-resize", className: "absolute bottom-0 left-3 right-3 h-2 z-50" },
              { dir: "w", cursor: "ew-resize", className: "absolute top-3 bottom-3 left-0 w-2 z-50" },
              { dir: "e", cursor: "ew-resize", className: "absolute top-3 bottom-3 right-0 w-2 z-50" },
              { dir: "nw", cursor: "nwse-resize", className: "absolute top-0 left-0 w-4 h-4 z-50" },
              { dir: "ne", cursor: "nesw-resize", className: "absolute top-0 right-0 w-4 h-4 z-50" },
              { dir: "sw", cursor: "nesw-resize", className: "absolute bottom-0 left-0 w-4 h-4 z-50" },
              { dir: "se", cursor: "nwse-resize", className: "absolute bottom-0 right-0 w-5 h-5 flex items-end justify-end p-1.5 group z-50" },
            ].map((handle) => (
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
                    mouseY: e.clientY,
                  });
                }}
                className={handle.className}
                style={{ cursor: handle.cursor }}
                title={handle.dir === "se" ? "Растянуть GPS блокнот" : ""}
              >
                {handle.dir === "se" && (
                  <div className="w-2.5 h-2.5 border-r-2 border-b-2 border-[#9CA3AF] group-hover:border-[#4B5563] transition-colors pointer-events-none" />
                )}
              </div>
            ))}
          </div>
        ))}
    </div>
  );
}

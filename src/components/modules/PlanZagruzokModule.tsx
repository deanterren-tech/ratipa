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
  ChevronDown,
  ChevronUp,
  Table2,
  Loader2,
} from "lucide-react";

interface PlanZagruzokModuleProps {
  user: UserProfile;
}

interface TabItem {
  id: string;
  name: string;
  sheetUrl: string;
  variant?: "default" | "rose" | "blue";
  blacklist?: boolean;
}

const MODULE_KEY = "planZagruzok";

export default function PlanZagruzokModule({ user }: PlanZagruzokModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    const unsub = dbService.getSettings(setSettings);
    return () => unsub();
  }, []);

  const initialZoom = user.sheetZoom?.[MODULE_KEY] ?? 100;
  const [zoom, setZoom] = useState(initialZoom);
  const [frameKey, setFrameKey] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const hasBase = user.role === "root_admin" || user.role === "admin" || (user.permissions && user.permissions.planZagruzok !== "none");

  const allowedTabs: TabItem[] = (() => {
    const tabs: TabItem[] = [];
    if (hasBase) {
      if (settings?.planZagruzokSheetUrl) {
        tabs.push({ id: "plan", name: "План загрузок", sheetUrl: settings.planZagruzokSheetUrl, variant: "default" });
      }
    }
    // Чёрный список и динамические вкладки — берутся из настроек (planZagruzokTabs),
    // отдельная жёстко заданная вкладка не используется. Для обратной совместимости
    // отдельное поле planZagruzokBlacklistUrl тоже превращаем во вкладку-таб.
    if (settings?.planZagruzokBlacklistUrl) {
      tabs.push({ id: "blacklist", name: "Чёрный список", sheetUrl: settings.planZagruzokBlacklistUrl, variant: "rose", blacklist: true });
    }
    const dyn = settings?.planZagruzokTabs || [];
    dyn.forEach((t) => {
      const isBlacklist = !!t.blacklist;
      const perm = user.permissions?.[`planZagruzok_${t.id}`];
      if (user.role === "root_admin" || user.role === "admin" || perm !== "none") {
        tabs.push({
          id: t.id,
          name: t.name,
          sheetUrl: t.sheetUrl,
          variant: isBlacklist ? "rose" : "blue",
          blacklist: isBlacklist,
        });
      }
    });
    return tabs;
  })();

  useEffect(() => {
    const first = allowedTabs[0]?.id;
    if (!first) return;
    if (!activeTabId || !allowedTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(first);
    }
  }, [allowedTabs, activeTabId]);

  const activeTab = allowedTabs.find((t) => t.id === activeTabId) || allowedTabs[0];
  const embedUrl = activeTab ? getEmbeddableSheetUrl(activeTab.sheetUrl) : "";

  // Сбрасываем индикатор загрузки при смене таба / обновлении
  useEffect(() => {
    if (embedUrl) setLoading(true);
  }, [frameKey, embedUrl]);

  const changeZoom = (next: number) => {
    const clamped = Math.max(50, Math.min(200, next));
    setZoom(clamped);
    dbService.saveUserSheetZoom(user.uid, MODULE_KEY, clamped);
  };

  const iconBtn =
    "inline-flex items-center justify-center h-7 w-7 sm:h-8 sm:w-8 rounded-lg border border-slate-200/70 bg-white/60 text-slate-700 hover:bg-white transition backdrop-blur";

  return (
    <div className="fixed top-16 inset-x-0 bottom-0 z-40 bg-slate-100 overflow-hidden">
      {/* === FULL-SCREEN IFRAME === */}
      <div className="absolute inset-0">
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
                title={activeTab?.name || "План загрузок"}
                onLoad={() => setLoading(false)}
                className="w-full h-full border-0"
              />
            </div>
            {loading && (
              <div className="absolute inset-0 z-[1] flex items-center justify-center bg-slate-100/70 backdrop-blur-sm">
                <div className="flex flex-col items-center gap-3 text-slate-500">
                  <Loader2 className="h-8 w-8 animate-spin text-[#3765F6]" />
                  <span className="text-xs font-bold uppercase tracking-wider">Загрузка таблицы…</span>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-center text-slate-400 text-sm px-8">
            Ссылка на таблицу не задана.
            <br />
            Укажите её в Настройках (planZagruzokSheetUrl / planZagruzokTabs).
          </div>
        )}
      </div>

      {/* === FLOATING HEADER OVERLAY === */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="absolute top-3 right-3 z-[101] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#3765F6]/90 text-white text-xs font-bold shadow-lg backdrop-blur hover:bg-[#3765F6] transition active:scale-95"
        >
          <ChevronDown className="h-4 w-4" /> План загрузок
        </button>
      ) : (
        <div className="absolute top-0 left-0 right-0 z-[100] px-3 sm:px-4 py-2.5 bg-white/70 backdrop-blur-xl border-b border-white/40 shadow-sm">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                <Table2 className="h-4 w-4 text-orange-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-bold text-slate-950 tracking-tight leading-none">
                  План загрузок
                </h1>
                <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate hidden sm:block">
                  Полная таблица планирования загрузок
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1 sm:gap-1.5">
              <button className={iconBtn} title="Уменьшить масштаб" onClick={() => changeZoom(zoom - 10)}>
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-[11px] font-mono text-slate-600 w-9 text-center">{zoom}%</span>
              <button className={iconBtn} title="Увеличить масштаб" onClick={() => changeZoom(zoom + 10)}>
                <ZoomIn className="h-4 w-4" />
              </button>
              <button className={iconBtn} title="Обновить таблицу" onClick={() => setFrameKey((k) => k + 1)}>
                <RefreshCw className="h-4 w-4" />
              </button>
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
              <button className={iconBtn} title="Скрыть плашку" onClick={() => setCollapsed(true)}>
                <ChevronUp className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Tabs row */}
          {allowedTabs.length > 1 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {allowedTabs.map((tab) => {
                const active = tab.id === activeTabId;
                const activeCls =
                  tab.variant === "rose"
                    ? "bg-rose-600 border-rose-600 text-white shadow-xs"
                    : tab.variant === "blue"
                    ? "bg-[#3765F6] border-[#3765F6] text-white shadow-xs"
                    : "bg-slate-900 border-slate-900 text-white shadow-xs";
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTabId(tab.id); setFrameKey((k) => k + 1); }}
                    className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-xl transition duration-150 shrink-0 cursor-pointer border ${
                      active
                        ? activeCls
                        : "bg-white/45 border-slate-200/50 text-slate-500 hover:bg-white/80 hover:text-slate-800"
                    }`}
                  >
                    {tab.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

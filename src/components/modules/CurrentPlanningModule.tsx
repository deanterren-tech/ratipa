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
} from "lucide-react";

interface CurrentPlanningModuleProps {
  user: UserProfile;
}

export default function CurrentPlanningModule({ user }: CurrentPlanningModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    const unsub = dbService.getSettings(setSettings);
    return () => unsub();
  }, []);

  const [zoom, setZoom] = useState(100);
  const [frameKey, setFrameKey] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const allowedTabs = (settings?.currentPlanningTabs || []).filter(
    (t) => user.role === "root_admin" || user.role === "admin" || (user.permissions && user.permissions[`currentPlanning_${t.id}`] !== "none")
  );

  useEffect(() => {
    const first = allowedTabs[0]?.id;
    if (!first) return;
    if (!activeTabId || !allowedTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(first);
    }
  }, [allowedTabs, activeTabId]);

  const activeTab = allowedTabs.find((t) => t.id === activeTabId) || allowedTabs[0];
  const embedUrl = activeTab ? getEmbeddableSheetUrl(activeTab.sheetUrl) : "";

  const iconBtn =
    "inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200/70 bg-white/60 text-slate-700 hover:bg-white transition backdrop-blur";

  return (
    <div className="fixed top-16 inset-x-0 bottom-0 z-40 bg-slate-100 overflow-hidden">
      {/* === FULL-SCREEN IFRAME === */}
      <div className="absolute inset-0">
        {embedUrl ? (
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
              title={activeTab?.name || "Текущее планирование"}
              className="w-full h-full border-0"
            />
          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center text-center text-slate-400 text-sm px-8">
            Ссылка на таблицу не задана.
            <br />
            Укажите её в Настройках (currentPlanningTabs).
          </div>
        )}
      </div>

      {/* === FLOATING HEADER OVERLAY === */}
      {collapsed ? (
        <button
          onClick={() => setCollapsed(false)}
          className="absolute top-3 right-3 z-[101] inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#3765F6]/90 text-white text-xs font-bold shadow-lg backdrop-blur hover:bg-[#3765F6] transition active:scale-95"
        >
          <ChevronDown className="h-4 w-4" /> Текущее планирование
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
                  Текущее планирование
                </h1>
                <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate hidden sm:block">
                  Расписание, мониторинг и управление текущими рейсами
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button className={iconBtn} title="Уменьшить масштаб" onClick={() => setZoom((z) => Math.max(50, z - 10))}>
                <ZoomOut className="h-4 w-4" />
              </button>
              <span className="text-[11px] font-mono text-slate-600 w-9 text-center">{zoom}%</span>
              <button className={iconBtn} title="Увеличить масштаб" onClick={() => setZoom((z) => Math.min(200, z + 10))}>
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
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTabId(tab.id)}
                    className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-xl transition duration-150 shrink-0 cursor-pointer border ${
                      active
                        ? "bg-[#3765F6] border-[#3765F6] text-white shadow-xs"
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
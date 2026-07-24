import {useState} from 'react'
import type {ReactNode} from 'react'
import {RefreshCw, ExternalLink, ZoomIn, ZoomOut, Maximize2, Minimize2, ChevronDown, ChevronUp, Table2} from 'lucide-react'

export interface SheetTab {
  id: string
  name: string
  variant?: 'default' | 'rose' | 'blue'
}

interface GoogleSheetFrameProps {
  url?: string
  title?: string
  subtitle?: string
  /** 100-based (100 = 100%). */
  zoom?: number
  onZoomChange?: (z: number) => void
  toolbar?: boolean
  tabs?: SheetTab[]
  activeTabId?: string | null
  onTabChange?: (id: string) => void
  children?: ReactNode
  /** ключ для сохранения состояния "свернута плашка" в localStorage */
  collapseKey?: string
  /** колбэк обновления (кнопка "Обновить") */
  onRefresh?: () => void
}

/**
 * Эталонный Google Sheet Frame (вид как в ratipa-clean DispositionPage), адаптированный под AppShell.
 * - плашка с инструментами идёт В ПОТОКЕ сразу под топбаром (не перекрывает выпадающее меню)
 * - iframe занимает ВЕСЬ остаток контейнера до краёв (без отступов/rounded)
 * - зум, обновить, открыть в новой вкладке, fullscreen браузера, скрыть/показать плашку
 * - вкладки (tabs) рендерятся в плашке
 * - состояние "свернута плашка" сохраняется в localStorage
 */
export default function GoogleSheetFrame({
  url,
  title = 'Google Таблица',
  subtitle,
  zoom,
  onZoomChange,
  toolbar = true,
  tabs,
  activeTabId,
  onTabChange,
  children,
  collapseKey,
  onRefresh,
}: GoogleSheetFrameProps) {
  const [collapsed, setCollapsed] = useState(() => {
    if (!collapseKey) return false
    try {
      return localStorage.getItem(`ratipa_sheet_collapsed_${collapseKey}`) === 'true'
    } catch {
      return false
    }
  })
  const [internalKey, setInternalKey] = useState(0)
  const [isBrowserFullscreen, setIsBrowserFullscreen] = useState(false)

  const iconBtn =
    "inline-flex items-center justify-center h-8 w-8 rounded-lg border border-slate-200/70 bg-white/60 text-slate-700 hover:bg-white transition backdrop-blur cursor-pointer"

  const toggleCollapse = () => {
    setCollapsed((c) => {
      const next = !c
      if (collapseKey) {
        try {
          localStorage.setItem(`ratipa_sheet_collapsed_${collapseKey}`, String(next))
        } catch {
          /* ignore */
        }
      }
      return next
    })
  }

  const handleRefresh = () => {
    if (onRefresh) onRefresh()
    else setInternalKey((k) => k + 1)
  }

  const toggleBrowserFullscreen = () => {
    const el = document.documentElement
    if (!document.fullscreenElement) {
      el.requestFullscreen?.()
      setIsBrowserFullscreen(true)
    } else {
      document.exitFullscreen?.()
      setIsBrowserFullscreen(false)
    }
  }

  const content = children ? (
    <div className="absolute inset-0">{children}</div>
  ) : (
    <iframe
      key={internalKey}
      src={url}
      title={title}
      className="w-full h-full border-0 absolute inset-0"
      referrerPolicy="no-referrer"
    />
  )

  return (
    <div className="relative w-full h-full flex flex-col min-h-0 bg-slate-100">
      {/* === ПЛАШКА В ПОТОКЕ (под топбаром) === */}
      {toolbar && !collapsed && (
        <div className="shrink-0 px-3 sm:px-4 py-2.5 bg-white/70 backdrop-blur-xl border-b border-white/40 shadow-sm z-10">
          <div className="flex items-center justify-between gap-3">
            {/* Left: icon + title */}
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded-xl bg-orange-500/10 border border-orange-500/20 flex items-center justify-center shrink-0">
                <Table2 className="h-4 w-4 text-orange-600" />
              </div>
              <div className="min-w-0">
                <h1 className="text-sm sm:text-base font-bold text-slate-950 tracking-tight leading-none truncate">
                  {title}
                </h1>
                {subtitle && (
                  <p className="text-[10px] sm:text-[11px] text-slate-500 mt-0.5 truncate hidden sm:block">
                    {subtitle}
                  </p>
                )}
              </div>
            </div>

            {/* Right: tools */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Zoom */}
              {onZoomChange && zoom !== undefined && (
                <div className="flex items-center bg-slate-100/60 border border-slate-200/40 p-0.5 rounded-xl">
                  <button
                    className="p-1.5 hover:bg-white text-slate-500 hover:text-slate-800 rounded-lg transition active:scale-90 cursor-pointer"
                    title="Уменьшить масштаб"
                    onClick={() => onZoomChange(Math.max(50, zoom - 10))}
                  >
                    <ZoomOut className="h-4 w-4" />
                  </button>
                  <span className="text-[11px] font-mono text-slate-600 w-9 text-center">{zoom}%</span>
                  <button
                    className="p-1.5 hover:bg-white text-slate-500 hover:text-slate-800 rounded-lg transition active:scale-90 cursor-pointer"
                    title="Увеличить масштаб"
                    onClick={() => onZoomChange(Math.min(200, zoom + 10))}
                  >
                    <ZoomIn className="h-4 w-4" />
                  </button>
                </div>
              )}

              <button className={iconBtn} title="Обновить таблицу" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" />
              </button>

              {url && (
                <a
                  className={iconBtn}
                  title="Открыть в новой вкладке"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              )}

              <button
                className={iconBtn}
                title="На весь экран (браузер)"
                onClick={toggleBrowserFullscreen}
              >
                {isBrowserFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              </button>

              <button className={iconBtn} title="Скрыть плашку" onClick={toggleCollapse}>
                <ChevronUp className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Tabs row */}
          {tabs && tabs.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
              {tabs.map((tab) => {
                const active = tab.id === activeTabId
                const activeCls =
                  tab.variant === 'rose'
                    ? 'bg-rose-600 border-rose-600 text-white shadow-xs'
                    : tab.variant === 'blue'
                    ? 'bg-[#3765F6] border-[#3765F6] text-white shadow-xs'
                    : 'bg-slate-900 border-slate-900 text-white shadow-xs'
                return (
                  <button
                    key={tab.id}
                    onClick={() => onTabChange?.(tab.id)}
                    className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1.5 rounded-xl transition duration-150 shrink-0 cursor-pointer border ${
                      active
                        ? activeCls
                        : 'bg-white/45 border-slate-200/50 text-slate-500 hover:bg-white/80 hover:text-slate-800'
                    }`}
                  >
                    {tab.name}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* === IFRAME НА ВЕСЬ ОСТАТОК (до краёв) === */}
      <div className="flex-1 relative min-h-0">
        {content}

        {/* Collapsed badge — в углу iframe-area */}
        {toolbar && collapsed && (
          <button
            onClick={toggleCollapse}
            className="absolute top-3 right-3 z-20 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#3765F6]/90 text-white text-xs font-bold shadow-lg backdrop-blur hover:bg-[#3765F6] transition active:scale-95 cursor-pointer"
          >
            <ChevronDown className="h-4 w-4" /> {title}
          </button>
        )}
      </div>
    </div>
  )
}
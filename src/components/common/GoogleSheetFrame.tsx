import {useState, useRef} from 'react'
import type {ReactNode} from 'react'
import {RefreshCw, ExternalLink, Table2} from 'lucide-react'

interface GoogleSheetFrameProps {
  url?: string;
  title?: string;
  height?: number | string;
  /** показывать тулбар (обновить / открыть) — по умолчанию true */
  toolbar?: boolean;
  /** кастомное содержимое вместо iframe (напр. iframe с зумом) */
  children?: ReactNode;
}

/**
 * Единая обёртка для Google-таблицы как фрейм (вид, как в ratipa-clean / PlanZagruzok).
 * Красивaя карточка + тулбар с обновлением и открытием в новой вкладке.
 * Используется во всех модулях, где таблица отображается через iframe.
 */
export default function GoogleSheetFrame({ url, title = 'Google Таблица', height = 880, toolbar = true, children }: GoogleSheetFrameProps) {
  const [key, setKey] = useState(0);
  const frameRef = useRef<HTMLIFrameElement>(null);

  return (
    <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-slate-200/50 shadow-sm overflow-hidden flex flex-col min-h-0">
      {toolbar && (
        <div className="bg-white/60 backdrop-blur-md rounded-t-3xl px-4 lg:px-6 py-3 border-b border-slate-200/50 flex items-center justify-between gap-3 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0 text-[#3765F6]">
              <Table2 className="w-4 h-4" />
            </div>
            <span className="text-sm font-bold text-slate-800 truncate">{title}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setKey(k => k + 1)}
              className="flex items-center gap-1.5 bg-white/65 hover:bg-white border border-slate-200/50 hover:border-slate-300 text-slate-700 text-xs font-semibold px-3 py-1.5 rounded-xl transition shadow-2xs cursor-pointer"
              title="Обновить"
            >
              <RefreshCw className="w-3.5 h-3.5" /> Обновить
            </button>
            {url && (
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 bg-[#3765F6] hover:bg-[#2555E5] text-white text-xs font-semibold px-3 py-1.5 rounded-xl transition cursor-pointer shadow-sm"
                title="Открыть в новой вкладке"
              >
                <ExternalLink className="w-3.5 h-3.5" /> Открыть
              </a>
            )}
          </div>
        </div>
      )}
      <div className="relative flex-1 min-h-0" style={{ height: typeof height === 'number' ? `${height}px` : height }}>
        {children ? children : (
          <iframe
            key={key}
            ref={frameRef}
            src={url}
            title={title}
            className="w-full h-full border-0 absolute inset-0"
            referrerPolicy="no-referrer"
          />
        )}
      </div>
    </div>
  );
}

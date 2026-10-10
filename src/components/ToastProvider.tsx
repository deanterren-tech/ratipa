import {createContext, useContext, useState, ReactNode, useCallback, useRef, useEffect} from 'react'
import {onAppError} from '../utils/appErrors'
import {motion, AnimatePresence, useReducedMotion} from 'motion/react'
import {CheckCircle2, AlertCircle, AlertTriangle, Info, X} from 'lucide-react'

type ToastType = 'success' | 'error' | 'info' | 'warning';

/** Действие в уведомлении (например, «Повторить» после ошибки сохранения). */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

interface ToastOptions {
  id: string;
  message: string;
  type: ToastType;
  action?: ToastAction;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, action?: ToastAction) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

/** Время показа: ошибку держим дольше — её нужно успеть прочитать. */
const DURATION: Record<ToastType, number> = {
  success: 4000,
  info: 4500,
  warning: 6000,
  error: 8000,
};

const STYLE: Record<ToastType, { icon: any; iconColor: string; bar: string }> = {
  success: { icon: CheckCircle2, iconColor: 'text-emerald-600', bar: 'bg-emerald-500' },
  error:   { icon: AlertCircle,  iconColor: 'text-rose-600',    bar: 'bg-rose-500' },
  warning: { icon: AlertTriangle, iconColor: 'text-amber-600',  bar: 'bg-amber-500' },
  info:    { icon: Info,          iconColor: 'text-[var(--accent-ink)]',  bar: 'bg-[var(--accent-ui)]' },
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastOptions[]>([]);
  const shouldReduceMotion = useReducedMotion();
  const timers = useRef<Record<string, number>>({});
  const remaining = useRef<Record<string, number>>({});
  const startedAt = useRef<Record<string, number>>({});

  const clearTimer = (id: string) => {
    if (timers.current[id]) {
      window.clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
  };

  const removeToast = useCallback((id: string) => {
    clearTimer(id);
    delete remaining.current[id];
    delete startedAt.current[id];
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const schedule = useCallback((id: string, ms: number) => {
    clearTimer(id);
    remaining.current[id] = ms;
    startedAt.current[id] = Date.now();
    timers.current[id] = window.setTimeout(() => removeToast(id), ms);
  }, [removeToast]);

  /** Пауза при наведении: уведомление не исчезнет, пока его читают. */
  const pauseToast = (id: string) => {
    if (!startedAt.current[id]) return;
    clearTimer(id);
    const left = (remaining.current[id] ?? 0) - (Date.now() - startedAt.current[id]);
    remaining.current[id] = Math.max(1200, left);
  };

  const resumeToast = (id: string) => {
    if (remaining.current[id] === undefined) return;
    schedule(id, remaining.current[id]);
  };

  const toast = useCallback((message: string, type: ToastType = 'info', action?: ToastAction) => {
    const text = String(message || '').trim();
    if (!text) return; // пустое уведомление не показываем

    setToasts((prev) => {
      // Одно и то же событие не дублируется, пока предыдущее на экране
      if (prev.some(t => t.message === text && t.type === type)) return prev;

      const id = Math.random().toString(36).substring(2, 9);
      // Уведомление с действием держим дольше — его нужно успеть прочитать и нажать.
      schedule(id, action ? 20000 : DURATION[type]);
      return [...prev, { id, message: text, type, ...(action ? { action } : {}) }].slice(-4);
    });
  }, [schedule]);

  useEffect(() => () => {
    Object.keys(timers.current).forEach(clearTimer);
  }, []);

  // Ошибки из общего слоя (firebase, рендер, сеть) показываются тем же уведомлением,
  // что и обычные: пользователь узнаёт о неудачном сохранении сразу, а не по факту потери данных.
  useEffect(() => onAppError((record) => {
    if (record.notify) toast(record.notify, 'error');
  }), [toast]);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      {/* Область уведомлений: контейнер не перехватывает клики, интерактивны сами уведомления.
          На узких экранах уведомление занимает ширину минус отступы и не выходит за экран. */}
      <div
        className="fixed z-[9999] top-4 right-4 left-4 sm:left-auto flex flex-col gap-2.5 pointer-events-none items-stretch sm:items-end"
        aria-live="polite"
        aria-atomic="false"
      >
        <AnimatePresence>
          {toasts.map((t) => {
            const { icon: IconComponent, iconColor, bar } = STYLE[t.type];
            const isError = t.type === 'error';
            return (
              <motion.div
                key={t.id}
                role={isError ? 'alert' : 'status'}
                data-ui="toast"
                data-toast-type={t.type}
                onMouseEnter={() => pauseToast(t.id)}
                onMouseLeave={() => resumeToast(t.id)}
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.97, x: 16 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, x: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.97, x: 16, transition: { duration: 0.15 } }}
                transition={shouldReduceMotion ? { duration: 0.1 } : { type: 'spring', stiffness: 300, damping: 28 }}
                className="pointer-events-auto relative overflow-hidden flex items-start gap-3 w-full sm:w-[360px] max-w-full px-3.5 py-3 bg-white border border-[#E5E7EB] rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)]"
              >
                {/* Тип передаётся иконкой и цветом, не только цветом */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${bar}`} />
                <IconComponent className={`${iconColor} w-4 h-4 shrink-0 mt-0.5 ml-1`} aria-hidden="true" />
                <p className="flex-1 text-xs leading-relaxed text-[#121316] break-words">{t.message}</p>
                {t.action ? (
                  <button
                    type="button"
                    data-ui="toast-action"
                    onClick={() => {
                      const act = t.action;
                      removeToast(t.id);
                      act?.onClick();
                    }}
                    className="shrink-0 px-2.5 py-1 text-[11px] font-semibold text-[var(--accent-on)] bg-[var(--accent-ui)] hover:bg-[var(--accent-ui-hover)] rounded-lg transition-colors cursor-pointer"
                  >
                    {t.action.label}
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={() => removeToast(t.id)}
                  aria-label="Закрыть уведомление"
                  className="p-1 -m-0.5 shrink-0 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
};

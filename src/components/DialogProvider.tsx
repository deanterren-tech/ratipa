import {createContext, useContext, useState, ReactNode, useCallback, useEffect, useRef} from 'react'
import {motion, AnimatePresence} from 'motion/react'
import {AlertTriangle, HelpCircle, Info, PencilLine} from 'lucide-react'

type DialogType = 'alert' | 'confirm' | 'prompt' | 'unsaved';

/** Вариант оформления и поведение подтверждения. */
export interface DialogVariantOptions {
  /** 'danger' — необратимое действие: кнопка подтверждения красная, Enter не подтверждает. */
  variant?: 'default' | 'danger';
  /** Своя подпись кнопки подтверждения — пользователь видит, ЧТО именно подтверждает. */
  confirmLabel?: string;
  /** Своя подпись кнопки отмены. */
  cancelLabel?: string;
}

/** Параметры подтверждения выхода с несохранёнными изменениями. */
export interface UnsavedDialogOptions {
  /** Список изменённых полей/блоков — честно показываем, что будет потеряно. */
  changed?: string[];
  /** Своё сообщение (по умолчанию — стандартный текст про потерю изменений). */
  message?: string;
}

/** Выбор в брендированном подтверждении выхода. */
export type UnsavedChoice = 'discard' | 'stay';

interface DialogOptions extends DialogVariantOptions {
  title?: string;
  message: string;
  defaultValue?: string;
  changed?: string[];
}

interface DialogState extends DialogOptions {
  isOpen: boolean;
  type: DialogType;
  resolve: (value: any) => void;
  inputValue: string;
}

interface DialogContextType {
  showAlert: (message: string, title?: string, options?: DialogVariantOptions) => Promise<void>;
  showConfirm: (message: string, title?: string, options?: DialogVariantOptions) => Promise<boolean>;
  showPrompt: (message: string, defaultValue?: string, title?: string, options?: DialogVariantOptions) => Promise<string | null>;
  /**
   * Единое брендированное окно «Есть несохранённые изменения» для всех окон с
   * несохранёнными данными — РОВНО две кнопки: «Отмена» (основная, в фокусе по
   * умолчанию, ничего не теряется) и «Выйти без сохранения» (опасное действие,
   * оформлено деструктивно). Кнопки «Сохранить и выйти» нет: сохранение
   * выполняется единственной кнопкой «Сохранить» в самом окне.
   * Esc и клик по фону равны «Отмена»; Tab/Shift+Tab ходят только внутри окна.
   */
  showUnsaved: (options?: UnsavedDialogOptions) => Promise<UnsavedChoice>;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within DialogProvider');
  return context;
};

/** Заголовок по умолчанию: должен называть действие, а не просто «Подтверждение». */
const DEFAULT_TITLE: Record<DialogType, string> = {
  alert: 'Внимание',
  confirm: 'Подтвердите действие',
  prompt: 'Ввод данных',
  unsaved: 'Выйти без сохранения?',
};

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  /** Время открытия: Esc, которым ОТКРЫЛИ окно, не должен его же закрывать. */
  const openedAtRef = useRef(0);
  const [dialog, setDialog] = useState<DialogState>({
    isOpen: false,
    type: 'alert',
    message: '',
    title: '',
    inputValue: '',
    variant: 'default',
    resolve: () => {},
  });

  const open = (next: Omit<DialogState, 'resolve' | 'isOpen'> & { resolve: (v: any) => void }) => {
    openedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setDialog({ ...next, isOpen: true });
  };

  const showAlert = useCallback((message: string, title?: string, options?: DialogVariantOptions) => {
    return new Promise<void>((resolve) => {
      open({
        type: 'alert', message, title: title || DEFAULT_TITLE.alert,
        inputValue: '', variant: options?.variant || 'default',
        confirmLabel: options?.confirmLabel, cancelLabel: options?.cancelLabel,
        resolve,
      });
    });
  }, []);

  const showConfirm = useCallback((message: string, title?: string, options?: DialogVariantOptions) => {
    return new Promise<boolean>((resolve) => {
      open({
        type: 'confirm', message, title: title || DEFAULT_TITLE.confirm,
        inputValue: '', variant: options?.variant || 'default',
        confirmLabel: options?.confirmLabel, cancelLabel: options?.cancelLabel,
        resolve,
      });
    });
  }, []);

  const showPrompt = useCallback((message: string, defaultValue = '', title?: string, options?: DialogVariantOptions) => {
    return new Promise<string | null>((resolve) => {
      open({
        type: 'prompt', message, title: title || DEFAULT_TITLE.prompt,
        inputValue: defaultValue, variant: options?.variant || 'default',
        confirmLabel: options?.confirmLabel, cancelLabel: options?.cancelLabel,
        resolve,
      });
    });
  }, []);

  const showUnsaved = useCallback((options?: UnsavedDialogOptions) => {
    return new Promise<UnsavedChoice>((resolve) => {
      open({
        type: 'unsaved',
        title: 'Выйти без сохранения?',
        message: options?.message || 'Есть несохранённые изменения.',
        changed: options?.changed || [],
        inputValue: '',
        variant: 'danger',
        resolve,
      });
    });
  }, []);

  const handleClose = (value: any) => {
    setDialog(prev => {
      prev.resolve(value);
      return { ...prev, isOpen: false };
    });
  };

  const cancelValue = dialog.type === 'prompt' ? null : dialog.type === 'confirm' ? false : dialog.type === 'unsaved' ? 'stay' : undefined;
  const confirmValue = dialog.type === 'prompt' ? dialog.inputValue : dialog.type === 'unsaved' ? 'discard' : true;
  const isDanger = dialog.variant === 'danger';
  // Enter подтверждает только безопасное и однозначное действие; в окне выхода
  // Enter активирует кнопку с фокусом (по умолчанию «Отмена») нативно.
  const enterConfirms = !isDanger && dialog.type !== 'unsaved';

  useEffect(() => {
    if (!dialog.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      // Клавиша, которой открыли это окно (её timeStamp раньше открытия), не
      // должна его закрывать тем же нажатием.
      if (typeof e.timeStamp === 'number' && e.timeStamp > 0 && e.timeStamp <= openedAtRef.current) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose(cancelValue);
      } else if (e.key === 'Enter' && dialog.type !== 'prompt' && dialog.type !== 'unsaved' && enterConfirms) {
        const el = e.target as HTMLElement | null;
        if (el && el.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleClose(confirmValue);
      } else if (e.key === 'Tab' && dialog.type === 'unsaved') {
        // Фокус-трап: Tab/Shift+Tab ходят только внутри окна подтверждения
        const host = surfaceRef.current;
        if (!host) return;
        const items = Array.from(host.querySelectorAll<HTMLElement>('button:not([disabled])'));
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !host.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !host.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog.isOpen, dialog.type, enterConfirms, cancelValue, confirmValue]);

  const Icon = dialog.type === 'unsaved' ? AlertTriangle : dialog.type === 'prompt' ? PencilLine
    : dialog.type === 'confirm' ? (isDanger ? AlertTriangle : HelpCircle)
    : Info;

  return (
    <DialogContext.Provider value={{ showAlert, showConfirm, showPrompt, showUnsaved }}>
      {children}
      <AnimatePresence>
        {dialog.isOpen && (
          <div
            data-ratipa-dialog="1"
            data-scroll-lock="modal"
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 overflow-y-auto"
            onMouseDown={dialog.type === 'unsaved' ? (e) => { if (e.target === e.currentTarget) handleClose('stay'); } : undefined}
          >
            <motion.div
              ref={surfaceRef}
              role="dialog"
              aria-modal="true"
              aria-label={dialog.title || DEFAULT_TITLE[dialog.type]}
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.12 } }}
              transition={{ type: 'spring', stiffness: 320, damping: 30 }}
              className="bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] w-full max-w-md overflow-hidden"
            >
              <div className="flex items-start gap-3 px-5 pt-5">
                <div className={`p-2 rounded-lg shrink-0 ${
                  isDanger ? 'bg-rose-50 text-rose-600' : 'bg-[#F3F4F6] text-[var(--accent-ink)]'
                }`}>
                  <Icon className="w-4 h-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold text-[#121316]">{dialog.title}</h3>
                  <p className="text-xs text-[#4B5563] leading-relaxed whitespace-pre-wrap mt-1">
                    {dialog.message}
                  </p>
                  {dialog.type === 'unsaved' && dialog.changed && dialog.changed.length ? (
                    <div className="mt-2 text-xs text-[#4B5563]">
                      <span className="text-[#6B7280]">Будут потеряны изменения:</span>
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {dialog.changed.map((c) => (
                          <li key={c} className="flex items-start gap-1.5">
                            <span className="mt-[5px] w-1 h-1 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
                            <span>{c}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              </div>

              {dialog.type === 'prompt' && (
                <div className="px-5 pt-4">
                  <input
                    type="text"
                    autoFocus
                    value={dialog.inputValue}
                    onChange={e => setDialog(prev => ({ ...prev, inputValue: e.target.value }))}
                    className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs text-[#121316] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                  />
                </div>
              )}

              {dialog.type === 'unsaved' ? (
                <div className="px-5 py-4 mt-4 flex flex-wrap justify-end gap-2.5 border-t border-[#E5E7EB]">
                  <button
                    type="button"
                    data-ui="unsaved-cancel"
                    autoFocus
                    onClick={() => handleClose('stay')}
                    className="px-4 py-2 text-xs font-semibold text-[var(--accent-on)] bg-[var(--accent-ui)] hover:bg-[var(--accent-ui-hover)] rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    data-ui="unsaved-discard"
                    onClick={() => handleClose('discard')}
                    className="px-4 py-2 text-xs font-medium text-rose-600 bg-rose-50 border border-rose-200 hover:bg-rose-100 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
                  >
                    Выйти без сохранения
                  </button>
                </div>
              ) : (
              <div className="px-5 py-4 mt-4 flex justify-end gap-2.5 border-t border-[#E5E7EB]">
                {dialog.type !== 'alert' && (
                  <button
                    type="button"
                    onClick={() => handleClose(cancelValue)}
                    className="px-4 py-2 text-xs font-medium text-[#4B5563] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] rounded-lg transition-colors cursor-pointer"
                  >
                    {dialog.cancelLabel || 'Отмена'}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleClose(confirmValue)}
                  autoFocus={dialog.type !== 'prompt'}
                  className={`px-4 py-2 text-xs font-medium rounded-lg transition-colors cursor-pointer ${
                    isDanger
                      ? 'text-white bg-rose-600 hover:bg-rose-700'
                      : 'text-[var(--accent-on)] bg-[var(--accent-ui)] hover:bg-[var(--accent-ui-hover)]'
                  }`}
                >
                  {dialog.confirmLabel || (dialog.type === 'alert' ? 'Понятно' : 'Подтвердить')}
                </button>
              </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DialogContext.Provider>
  );
};

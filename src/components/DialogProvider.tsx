import {createContext, useContext, useState, ReactNode, useCallback, useEffect} from 'react'
import {motion, AnimatePresence} from 'motion/react'
import {AlertTriangle, HelpCircle, Info, PencilLine} from 'lucide-react'

type DialogType = 'alert' | 'confirm' | 'prompt';

/** Вариант оформления и поведение подтверждения. */
export interface DialogVariantOptions {
  /** 'danger' — необратимое действие: кнопка подтверждения красная, Enter не подтверждает. */
  variant?: 'default' | 'danger';
  /** Своя подпись кнопки подтверждения — пользователь видит, ЧТО именно подтверждает. */
  confirmLabel?: string;
  /** Своя подпись кнопки отмены. */
  cancelLabel?: string;
}

interface DialogOptions extends DialogVariantOptions {
  title?: string;
  message: string;
  defaultValue?: string;
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
};

export const DialogProvider = ({ children }: { children: ReactNode }) => {
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

  const handleClose = (value: any) => {
    setDialog(prev => {
      prev.resolve(value);
      return { ...prev, isOpen: false };
    });
  };

  const cancelValue = dialog.type === 'prompt' ? null : (dialog.type === 'confirm' ? false : undefined);
  const confirmValue = dialog.type === 'prompt' ? dialog.inputValue : true;
  const isDanger = dialog.variant === 'danger';
  // Enter подтверждает только безопасное и однозначное действие
  const enterConfirms = !isDanger;

  useEffect(() => {
    if (!dialog.isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose(cancelValue);
      } else if (e.key === 'Enter' && dialog.type !== 'prompt' && enterConfirms) {
        const el = e.target as HTMLElement | null;
        if (el && el.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleClose(confirmValue);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog.isOpen, dialog.type, enterConfirms, cancelValue, confirmValue]);

  const Icon = dialog.type === 'prompt' ? PencilLine
    : dialog.type === 'confirm' ? (isDanger ? AlertTriangle : HelpCircle)
    : Info;

  return (
    <DialogContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
      {children}
      <AnimatePresence>
        {dialog.isOpen && (
          <div data-scroll-lock="modal" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 overflow-y-auto">
            <motion.div
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
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DialogContext.Provider>
  );
};

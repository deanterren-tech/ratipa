import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type DialogType = 'alert' | 'confirm' | 'prompt';

interface DialogOptions {
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
  showAlert: (message: string, title?: string) => Promise<void>;
  showConfirm: (message: string, title?: string) => Promise<boolean>;
  showPrompt: (message: string, defaultValue?: string, title?: string) => Promise<string | null>;
}

const DialogContext = createContext<DialogContextType | undefined>(undefined);

export const useDialog = () => {
  const context = useContext(DialogContext);
  if (!context) throw new Error('useDialog must be used within DialogProvider');
  return context;
};

export const DialogProvider = ({ children }: { children: ReactNode }) => {
  const [dialog, setDialog] = useState<DialogState>({
    isOpen: false,
    type: 'alert',
    message: '',
    title: '',
    inputValue: '',
    resolve: () => {},
  });

  const showAlert = useCallback((message: string, title = 'Внимание') => {
    return new Promise<void>((resolve) => {
      setDialog({ isOpen: true, type: 'alert', message, title, resolve, inputValue: '' });
    });
  }, []);

  const showConfirm = useCallback((message: string, title = 'Подтверждение') => {
    return new Promise<boolean>((resolve) => {
      setDialog({ isOpen: true, type: 'confirm', message, title, resolve, inputValue: '' });
    });
  }, []);

  const showPrompt = useCallback((message: string, defaultValue = '', title = 'Ввод данных') => {
    return new Promise<string | null>((resolve) => {
      setDialog({ isOpen: true, type: 'prompt', message, title, resolve, inputValue: defaultValue });
    });
  }, []);

  const handleClose = (value: any) => {
    setDialog(prev => {
      prev.resolve(value);
      return { ...prev, isOpen: false };
    });
  };

  return (
    <DialogContext.Provider value={{ showAlert, showConfirm, showPrompt }}>
      {children}
      <AnimatePresence>
        {dialog.isOpen && (
          <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden"
            >
              <div className="p-5">
                <h3 className="text-lg font-bold text-slate-900 mb-2">{dialog.title}</h3>
                <p className="text-slate-600 text-sm whitespace-pre-wrap">{dialog.message}</p>
                
                {dialog.type === 'prompt' && (
                  <input
                    type="text"
                    autoFocus
                    value={dialog.inputValue}
                    onChange={e => setDialog(prev => ({ ...prev, inputValue: e.target.value }))}
                    onKeyDown={e => {
                      if (e.key === 'Enter') handleClose(dialog.inputValue);
                      if (e.key === 'Escape') handleClose(null);
                    }}
                    className="mt-4 w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:border-blue-500"
                  />
                )}
              </div>
              
              <div className="bg-slate-50 p-4 flex justify-end gap-2 border-t border-slate-100">
                {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                  <button
                    onClick={() => handleClose(dialog.type === 'prompt' ? null : false)}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-800 hover:bg-slate-200/50 rounded-lg transition"
                  >
                    Отмена
                  </button>
                )}
                <button
                  onClick={() => handleClose(dialog.type === 'prompt' ? dialog.inputValue : true)}
                  autoFocus={dialog.type !== 'prompt'}
                  className="px-4 py-2 text-sm font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition"
                >
                  ОК
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </DialogContext.Provider>
  );
};

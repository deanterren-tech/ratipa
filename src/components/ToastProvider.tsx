import {createContext, useContext, useState, ReactNode, useCallback} from 'react'
import {motion, AnimatePresence, useReducedMotion} from 'motion/react'
import {CheckCircle2, AlertCircle, AlertTriangle, Info, X} from 'lucide-react'

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastOptions {
  id: string;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within ToastProvider');
  return context;
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastOptions[]>([]);
  const shouldReduceMotion = useReducedMotion();

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, message, type }]);
    
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed top-5 right-5 z-[9999] flex flex-col gap-2.5 pointer-events-none max-w-sm w-full sm:w-auto">
        <AnimatePresence>
          {toasts.map((t) => {
            let IconComponent = Info;
            let iconColor = "";

            if (t.type === 'success') {
              IconComponent = CheckCircle2;
              iconColor = "text-emerald-500";
            } else if (t.type === 'error') {
              IconComponent = AlertCircle;
              iconColor = "text-rose-500";
            } else if (t.type === 'warning') {
              IconComponent = AlertTriangle;
              iconColor = "text-amber-500";
            } else {
              IconComponent = Info;
              iconColor = "text-[#3765F6]";
            }

            return (
              <motion.div
                key={t.id}
                initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.95, x: 20 }}
                animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1, x: 0 }}
                exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.93, x: 25, transition: { duration: 0.15 } }}
                transition={shouldReduceMotion ? { duration: 0.1 } : { type: 'spring', stiffness: 280, damping: 26 }}
 className="pointer-events-auto border border-slate-200/50 rounded-2xl p-4 min-w-[320px] max-w-sm flex items-start gap-3.5 relative overflow-hidden select-none transition-all duration-300 bg-white shadow-xl shadow-slate-900/5 hover:shadow-2xl hover:shadow-slate-900/10 text-slate-800"
              >
                {/* Visual side-marker color bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                  t.type === 'success' ? 'bg-emerald-500' :
                  t.type === 'error' ? 'bg-rose-500' :
                  t.type === 'warning' ? 'bg-amber-500' : 'bg-[#3765F6]'
                }`} />

                <div className="pl-1 shrink-0">
                  <IconComponent className={`${iconColor} w-5 h-5 shrink-0`} />
                </div>
                
                <div className="flex-1 pr-4">
                  <p className="text-[13px] font-bold leading-relaxed tracking-tight text-slate-800 font-sans">{t.message}</p>
                </div>

                <button 
                  onClick={() => removeToast(t.id)} 
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/30 transition-all duration-150 cursor-pointer active:scale-95 shrink-0"
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

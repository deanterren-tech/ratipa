import {useState, useEffect, useRef} from 'react'
import {Search, User, Truck, X} from 'lucide-react'
import {motion, AnimatePresence} from 'motion/react'
import {database, dbService} from '../api'
import {ref} from 'firebase/database'
import {UserProfile} from '../types'
import {formatDriverShortName} from '../utils/driverSync'

interface CommandCenterProps {
  user: UserProfile;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (moduleKey: string) => void;
}

export default function CommandCenter({ user, isOpen, onClose, onNavigate }: CommandCenterProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    
    // Simulate searching through base
    const searchData = () => {
       const unsub = dbService.getVehicleFleet((list) => {
         const found = (list || []).filter(t =>
           String(t.name || t.carNumber || '').toLowerCase().includes(query.toLowerCase()) ||
           String(t.driver || t.driverName || '').toLowerCase().includes(query.toLowerCase())
         );
         setResults(found.map(f => ({
            type: 'tractor',
            title: f.name || f.carNumber,
            subtitle: (f.driver || f.driverName) ? formatDriverShortName(f.driver || f.driverName) : 'Без водителя',
            status: f.status || 'Свободен',
            module: 'baza'
         })));
       });
    };
    
    const timeout = setTimeout(searchData, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-20 px-4"
        onClick={onClose}
      >
        <motion.div 
          initial={{ opacity: 0, y: -20, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          transition={{ duration: 0.15 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-200"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center px-4 py-3 border-b border-slate-100 gap-3">
            <Search className="text-slate-400 w-5 h-5" />
            <input 
              ref={inputRef}
              type="text" 
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Поиск по тягачам, водителям, документам..." 
              className="flex-1 bg-transparent border-none outline-none text-slate-800 placeholder:text-slate-400 font-medium"
            />
            <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-100 transition">
              <X className="w-5 h-5" />
            </button>
          </div>
          
          <div className="max-h-[60vh] overflow-y-auto p-2">
             {results.length > 0 ? (
               <div className="flex flex-col gap-1">
                 {results.map((r, i) => (
                    <div 
                      key={r.module + i} 
                      onClick={() => {
                        onNavigate(r.module);
                        onClose();
                      }}
                      className="flex items-center justify-between p-3 rounded-xl hover:bg-slate-50 cursor-pointer transition border border-transparent hover:border-slate-200"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500">
                          <Truck className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="font-bold text-slate-900">{r.title}</div>
                          <div className="text-xs text-slate-500 flex items-center gap-1 mt-0.5">
                            <User className="w-3 h-3" /> {r.subtitle}
                          </div>
                        </div>
                      </div>
                      <div className="text-xs font-mono font-bold px-2 py-1 bg-emerald-100 text-emerald-700 rounded-md">
                         {r.status}
                      </div>
                    </div>
                 ))}
               </div>
             ) : query.length >= 2 ? (
               <div className="py-8 text-center text-slate-400 text-sm">
                 Ничего не найдено по запросу "{query}"
               </div>
             ) : (
               <div className="py-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                 <Search className="w-8 h-8 opacity-20" />
                 <span>Начните вводить для поиска</span>
               </div>
             )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
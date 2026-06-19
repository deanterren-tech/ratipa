import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile, AuditLog } from '../../../types';
import { dbService } from '../../../firebase';
import { useFirebase, database } from '../../../firebase';
import { History, Search } from 'lucide-react';
import { ref, onValue } from 'firebase/database';

interface DozvolaHistoryProps {
  user: UserProfile;
}

export default function DozvolaHistory({ user }: DozvolaHistoryProps) {
  const [history, setHistory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (useFirebase) {
      const dbRef = ref(database, 'dozvolsHistoryV4');
      const unsub = onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
          list.sort((a, b) => b.id.localeCompare(a.id));
          setHistory(list.slice(0, 150));
        } else {
          setHistory([]);
        }
      });
      return () => unsub();
    }
  }, []);

  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return history;
    const lower = (searchTerm || '').toLowerCase();
    return history.filter(h => 
      ((h.doc || '').toLowerCase().includes(lower)) ||
      ((h.action || '').toLowerCase().includes(lower)) ||
      ((h.logist || '').toLowerCase().includes(lower)) ||
      ((h.meta || '').toLowerCase().includes(lower)) ||
      ((h.time || '').toLowerCase().includes(lower))
    );
  }, [history, searchTerm]);

  return (
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col">
        <div className="flex flex-col md:flex-row md:items-center justify-between pb-3 border-b border-slate-100 mb-4 gap-4">
          <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-2 m-0 shrink-0">
              <History className="h-5 w-5" /> Полный журнал логирования
          </h2>
          
          <div className="relative w-full md:w-80">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
                type="text"
                placeholder="Поиск по документам, авторам, действиям..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-2 transition-all font-medium"
            />
          </div>
        </div>
        
        {/* Swipe Help Badge for Mobile */}
        <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-center uppercase tracking-wider select-none">
           <span className="inline-block animate-pulse text-blue-500 mr-1.5 font-sans">↔</span> Таблица логов прокручивается вправо для просмотра деталей действий
        </div>

        <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="bg-slate-50/60 border-b border-slate-200/55 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                        <th className="p-4 pl-6">Время</th>
                        <th className="p-4">Логист</th>
                        <th className="p-4">Бланк дозвола</th>
                        <th className="p-4">Действие выполнено</th>
                        <th className="p-4 pr-6">Параметры и связи (Было ➔ Стало)</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredHistory.map((h, i) => (
                        <tr key={i} className="hover:bg-slate-50/40 transition">
                            <td className="p-4 pl-6"><span className="text-[11px] text-slate-500 font-medium">{h.time}</span></td>
                            <td className="p-4"><strong>{h.logist}</strong></td>
                            <td className="p-4"><span className="font-bold text-slate-900">{h.doc}</span></td>
                            <td className="p-4"><span className="font-bold text-slate-700">{h.action}</span></td>
                            <td className="p-4 pr-6"><span className="font-medium text-slate-600 text-[11px] leading-tight block">{h.meta}</span></td>
                        </tr>
                    ))}
                    {filteredHistory.length === 0 && (
                        <tr>
                            <td colSpan={5} className="text-center p-12 text-slate-400 font-black text-xs uppercase tracking-wider font-mono">
                                Ничего не найдено.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </div>
  );
}

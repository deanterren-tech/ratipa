import React, { useState, useEffect } from 'react';
import { UserProfile, AuditLog } from '../../../types';
import { dbService } from '../../../firebase';
import { useFirebase, database } from '../../../firebase';
import { History } from 'lucide-react';
import { ref, onValue } from 'firebase/database';

interface DozvolaHistoryProps {
  user: UserProfile;
}

export default function DozvolaHistory({ user }: DozvolaHistoryProps) {
  const [history, setHistory] = useState<any[]>([]);

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

  return (
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col">
        <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 font-mono pb-3 border-b border-slate-100 mb-4 flex items-center gap-2">
            <History className="h-5 w-5" /> Полный журнал логирования и цепочек передач документов
        </h2>
        
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
                    {history.map((h, i) => (
                        <tr key={i} className="hover:bg-slate-50/40 transition">
                            <td className="p-4 pl-6"><span className="text-[11px] text-slate-500 font-medium">{h.time}</span></td>
                            <td className="p-4"><strong>{h.logist}</strong></td>
                            <td className="p-4"><span className="font-bold text-slate-900">{h.doc}</span></td>
                            <td className="p-4"><span className="font-bold text-slate-700">{h.action}</span></td>
                            <td className="p-4 pr-6"><span className="font-medium text-slate-600 text-[11px] leading-tight block">{h.meta}</span></td>
                        </tr>
                    ))}
                    {history.length === 0 && (
                        <tr>
                            <td colSpan={5} className="text-center p-12 text-slate-400 font-black text-xs uppercase tracking-wider font-mono">
                                Журнал операций пуст.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    </div>
  );
}

import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile } from '../../../types';
import { useFirebase, database } from '../../../firebase';
import { History, Search, FileText, Trash2 } from 'lucide-react';
import { ref, onValue, remove } from 'firebase/database';

interface DozvolaHistoryProps {
  user: UserProfile;
}

export default function DozvolaHistory({ user }: DozvolaHistoryProps) {
  const [subTab, setSubTab] = useState<'actions' | 'documents'>('actions');
  const [history, setHistory] = useState<any[]>([]);
  const [docHistory, setDocHistory] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (!useFirebase) return;

    // Load action logs
    const actionRef = ref(database, 'dozvolsHistoryV4');
    const unsubAction = onValue(actionRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        list.sort((a, b) => a.id < b.id ? 1 : (a.id > b.id ? -1 : 0));
        setHistory(list);
      } else {
        setHistory([]);
      }
    });

    // Load document history
    const docRef = ref(database, 'dozvolsDocumentsHistoryV1');
    const unsubDoc = onValue(docRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const list = Object.keys(data).map(key => ({ id: key, ...data[key] }));
        list.sort((a, b) => a.id < b.id ? 1 : (a.id > b.id ? -1 : 0));
        setDocHistory(list);
      } else {
        setDocHistory([]);
      }
    });

    return () => {
      unsubAction();
      unsubDoc();
    };
  }, []);

  // Filtered operational logs
  const filteredHistory = useMemo(() => {
    if (!searchTerm.trim()) return history;
    const lower = searchTerm.toLowerCase();
    return history.filter(h => 
      (h.doc && String(h.doc).toLowerCase().includes(lower)) ||
      (h.action && String(h.action).toLowerCase().includes(lower)) ||
      (h.logist && String(h.logist).toLowerCase().includes(lower)) ||
      (h.meta && String(h.meta).toLowerCase().includes(lower)) ||
      (h.time && String(h.time).toLowerCase().includes(lower))
    );
  }, [history, searchTerm]);

  // Filtered documents history
  const filteredDocHistory = useMemo(() => {
    if (!searchTerm.trim()) return docHistory;
    const lower = searchTerm.toLowerCase();
    return docHistory.filter(h => 
      (h.documentName && String(h.documentName).toLowerCase().includes(lower)) ||
      (h.action && String(h.action).toLowerCase().includes(lower)) ||
      (h.logist && String(h.logist).toLowerCase().includes(lower)) ||
      (h.details && String(h.details).toLowerCase().includes(lower)) ||
      (h.time && String(h.time).toLowerCase().includes(lower))
    );
  }, [docHistory, searchTerm]);

  // Delete handlers
  const handleDeleteActionLog = (id: string) => {
    if (confirm("Вы действительно хотите удалить эту запись из журнала операций?")) {
      remove(ref(database, `dozvolsHistoryV4/${id}`))
        .then(() => alert("Запись успешно удалена"))
        .catch(err => alert("Ошибка при удалении: " + err.message));
    }
  };

  const handleDeleteDocLog = (id: string) => {
    if (confirm("Вы действительно хотите удалить эту запись о формировании документа?")) {
      remove(ref(database, `dozvolsDocumentsHistoryV1/${id}`))
        .then(() => alert("Запись успешно удалена"))
        .catch(err => alert("Ошибка при удалении: " + err.message));
    }
  };

  const hasWriteAccess = user.role === 'root_admin' || user.permissions?.dozvola === 'write';

  return (
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col space-y-6">
        
        {/* Tab switcher & Search */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-3 border-b border-slate-100 gap-4">
          <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-xl w-fit">
            <button
              onClick={() => setSubTab('actions')}
              className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight transition ${
                subTab === 'actions' 
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Журнал Действий
            </button>
            <button
              onClick={() => setSubTab('documents')}
              className={`px-4 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight transition flex items-center gap-1.5 ${
                subTab === 'documents' 
                  ? 'bg-white text-slate-900 shadow-sm border border-slate-200/50' 
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <FileText size={14} className="text-blue-500" />
              История Документов
            </button>
          </div>
          
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
        <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-center uppercase tracking-wider select-none">
           <span className="inline-block animate-pulse text-blue-500 mr-1.5 font-sans">↔</span> Таблица прокручивается вправо для просмотра всех деталей
        </div>

        {subTab === 'actions' ? (
          <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                  <thead>
                      <tr className="bg-slate-50/60 border-b border-slate-200/55 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                          <th className="p-4 pl-6">Время</th>
                          <th className="p-4">Логист</th>
                          <th className="p-4">Бланк дозвола</th>
                          <th className="p-4">Действие выполнено</th>
                          <th className="p-4">Параметры и связи</th>
                          {hasWriteAccess && <th className="p-4 text-right pr-6 w-16"></th>}
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredHistory.map((h) => (
                          <tr key={h.id} className="hover:bg-slate-50/40 transition">
                              <td className="p-4 pl-6"><span className="text-[11px] text-slate-500 font-medium">{h.time}</span></td>
                              <td className="p-4"><strong>{h.logist}</strong></td>
                              <td className="p-4"><span className="font-bold text-slate-900">{h.doc}</span></td>
                              <td className="p-4"><span className="font-bold text-slate-700">{h.action}</span></td>
                              <td className="p-4"><span className="font-medium text-slate-600 text-[11px] leading-tight block">{h.meta}</span></td>
                              {hasWriteAccess && (
                                <td className="p-4 pr-6 text-right">
                                  <button
                                    onClick={() => handleDeleteActionLog(h.id)}
                                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                    title="Удалить запись"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              )}
                          </tr>
                      ))}
                      {filteredHistory.length === 0 && (
                          <tr>
                              <td colSpan={6} className="text-center p-12 text-slate-400 font-black text-xs uppercase tracking-wider font-mono">
                                  Ничего не найдено.
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
        ) : (
          <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                  <thead>
                      <tr className="bg-slate-50/60 border-b border-slate-200/55 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                          <th className="p-4 pl-6">Время формирования</th>
                          <th className="p-4">Логист</th>
                          <th className="p-4">Название документа</th>
                          <th className="p-4">Тип / Действие</th>
                          <th className="p-4">Детали (Что сдано / Специфика)</th>
                          {hasWriteAccess && <th className="p-4 text-right pr-6 w-16"></th>}
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                      {filteredDocHistory.map((h) => (
                          <tr key={h.id} className="hover:bg-slate-50/40 transition">
                              <td className="p-4 pl-6"><span className="text-[11px] text-slate-500 font-medium">{h.time}</span></td>
                              <td className="p-4"><strong>{h.logist}</strong></td>
                              <td className="p-4"><span className="font-bold text-slate-900 flex items-center gap-1.5"><FileText size={13} className="text-slate-400" /> {h.documentName}</span></td>
                              <td className="p-4"><span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-black text-[9px] uppercase tracking-wide">{h.action || 'Формирование'}</span></td>
                              <td className="p-4"><span className="font-medium text-slate-600 text-[11px] leading-tight block max-w-md break-words">{h.details}</span></td>
                              {hasWriteAccess && (
                                <td className="p-4 pr-6 text-right">
                                  <button
                                    onClick={() => handleDeleteDocLog(h.id)}
                                    className="p-1.5 text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                    title="Удалить запись"
                                  >
                                    <Trash2 size={14} />
                                  </button>
                                </td>
                              )}
                          </tr>
                      ))}
                      {filteredDocHistory.length === 0 && (
                          <tr>
                              <td colSpan={6} className="text-center p-12 text-slate-400 font-black text-xs uppercase tracking-wider font-mono">
                                  Записей о формировании документов не найдено.
                              </td>
                          </tr>
                      )}
                  </tbody>
              </table>
          </div>
        )}
    </div>
  );
}

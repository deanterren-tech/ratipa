import {useToast} from '../../ToastProvider'
import {useDialog} from '../../DialogProvider'
import {useState, useEffect, useMemo} from 'react'
import {UserProfile} from '../../../types'
import { useFirebase, database, onValue } from '../../../firebase'
import {Search, FileText, Trash2} from 'lucide-react'
import { ref, remove } from 'firebase/database'

interface DozvolaHistoryProps {
  user: UserProfile;
}

export default function DozvolaHistory({ user }: DozvolaHistoryProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
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
  const handleDeleteActionLog = async (id: string) => {
    if (await showConfirm("Вы действительно хотите удалить эту запись из журнала операций?")) {
      remove(ref(database, `dozvolsHistoryV4/${id}`))
        .then(() => toast("Запись успешно удалена", 'success'))
        .catch(err => toast("Ошибка при удалении: " + (err instanceof Error ? err.message : String(err)), 'error'));
    }
  };

  const handleDeleteDocLog = async (id: string) => {
    if (await showConfirm("Вы действительно хотите удалить эту запись о формировании документа?")) {
      remove(ref(database, `dozvolsDocumentsHistoryV1/${id}`))
        .then(() => toast("Запись успешно удалена", 'success'))
        .catch(err => toast("Ошибка при удалении: " + (err instanceof Error ? err.message : String(err)), 'error'));
    }
  };

  const hasWriteAccess = user.role === 'root_admin' || user.permissions?.dozvola === 'write';

  return (
 <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col space-y-6">
        
        {/* Tab switcher & Search */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between pb-3 border-b border-slate-100 gap-4">
          <div className="flex items-center gap-1.5 p-1 bg-slate-100/75 rounded-xl w-fit">
            <button
              onClick={() => setSubTab('actions')}
              className={`px-4 min-h-[44px] py-2 rounded-lg text-xs font-semibold transition ${
                              subTab === "actions"
                                ? "bg-white text-slate-900 shadow-xs"
                                : "text-slate-500 hover:text-slate-800 hover:bg-slate-150"
                            }`}
            >
              Журнал действий
            </button>
            <button
              onClick={() => setSubTab('documents')}
              className={`px-4 min-h-[44px] py-2 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 ${
                              subTab === "documents"
                                ? "bg-white text-slate-900 shadow-xs"
                                : "text-slate-500 hover:text-slate-800 hover:bg-slate-150"
                            }`}
            >
              <FileText size={14} className="text-[#3765F6]" />
              История документов
            </button>
          </div>
          
          <div className="relative w-full md:w-80">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
                type="text"
                placeholder="Поиск по документам, авторам..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 w-full bg-slate-50/50 border border-slate-200/60 text-slate-700 text-xs rounded-xl focus:ring-0 focus:border-[#3765F6] block p-2.5 transition-all font-semibold"
            />
          </div>
        </div>
        
        {/* Swipe Help Badge for Mobile */}
        

        {subTab === 'actions' ? (
          <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse">
                  <thead>
                      <tr className="bg-slate-50/60 border-b border-slate-200/55 text-[10px] font-bold text-slate-400">
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
                              <td className="p-4"><span className="font-semibold text-slate-700">{h.action}</span></td>
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
                              <td colSpan={6} className="text-center p-12 text-slate-400 font-bold text-xs">
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
                      <tr className="bg-slate-50/60 border-b border-slate-200/55 text-[10px] font-bold text-slate-400">
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
                              <td className="p-4"><span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-bold text-[9px]">{h.action || 'Формирование'}</span></td>
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
                              <td colSpan={6} className="text-center p-12 text-slate-400 font-bold text-xs">
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

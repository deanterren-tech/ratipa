import {useDialog} from '../../DialogProvider'
import React, {useState, useEffect} from 'react'
import {UserProfile} from '../../../types'
import {Plus, Trash2, X, Edit} from 'lucide-react'
import { useFirebase, database, onValue } from '../../../firebase'
import { ref, set, remove, push } from 'firebase/database'

interface DozvolaTypesDirectoryProps {
  user: UserProfile;
}

export default function DozvolaTypesDirectory({ user }: DozvolaTypesDirectoryProps) {
  const { showConfirm } = useDialog();
  const [types, setTypes] = useState<any>({});
  const [typesOrder, setTypesOrder] = useState<string[]>([]);
  const [printMappings, setPrintMappings] = useState<any>({});

  const [isEditingType, setIsEditingType] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [typeName, setTypeName] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (!useFirebase) return;
    const subs: (() => void)[] = [];
    const listen = (path: string, setter: (val: any) => void) => {
      const dbRef = ref(database, path);
      const unsub = onValue(dbRef, (snap) => setter(snap.val() || (Array.isArray(snap.val()) ? [] : {})));
      subs.push(() => unsub());
    };

    listen("dozvolsTypesV4", setTypes);
    listen("dozvolsTypesOrderV4", (val) => setTypesOrder(Array.isArray(val) ? val : Object.keys(val || {})));
    listen("dozvolsPermitPrintMappingsV1", setPrintMappings);

    return () => subs.forEach(s => s());
  }, []);

  const openEditor = (id: string) => {
      setEditingId(id);
      if (id) {
          const tName = types[id]?.name || '';
          setTypeName(tName);
          const map = printMappings[tName] || {};
          setCountry(map.country || '');
          setCategory(map.category || '');
          setYear(parseInt(map.year) || new Date().getFullYear());
      } else {
          setTypeName("");
          setCountry("");
          setCategory("");
          setYear(new Date().getFullYear());
      }
      setIsEditingType(true);
  };

  const handleSaveType = (e: React.FormEvent) => {
      e.preventDefault();
      if (!typeName.trim()) return;

      const tName = typeName.trim();
      const oldName = editingId ? types[editingId]?.name : '';
      let newId = editingId;
      if (!newId) {
          newId = push(ref(database, 'dozvolsTypesV4')).key || Date.now().toString();
          if (useFirebase) {
              set(ref(database, `dozvolsTypesV4/${newId}`), { id: newId, name: tName });
              set(ref(database, 'dozvolsTypesOrderV4'), [...typesOrder, newId]);
          }
      } else {
          if (useFirebase && oldName && oldName !== tName) {
              // Меняем имя в справочнике типов
              set(ref(database, `dozvolsTypesV4/${newId}/name`), tName);
              // Удаляем СТАРЫЙ маппинг, чтобы не плодить записи
              remove(ref(database, `dozvolsPermitPrintMappingsV1/${oldName}`));
          }
      }

      if (useFirebase) {
          set(ref(database, `dozvolsPermitPrintMappingsV1/${tName}`), {
              country: country.trim(),
              category: category.trim(),
              year
          });
      }

      setIsEditingType(false);
  };

  const handleDeleteType = async (id: string, name: string) => {
      if (!(await showConfirm(`Точно удалить вида дозвола: ${name}? В реестре он останется как текст, но пропадет из вкладок.`))) return;
      if (useFirebase) {
          remove(ref(database, `dozvolsTypesV4/${id}`));
          remove(ref(database, `dozvolsPermitPrintMappingsV1/${name}`));
          set(ref(database, 'dozvolsTypesOrderV4'), typesOrder.filter(fid => fid !== id));
      }
  };

  const moveItem = (index: number, direction: number) => {
      const newOrder = [...typesOrder];
      if (index + direction < 0 || index + direction >= newOrder.length) return;
      const t = newOrder[index];
      newOrder[index] = newOrder[index + direction];
      newOrder[index + direction] = t;
      if (useFirebase) set(ref(database, 'dozvolsTypesOrderV4'), newOrder);
  };

  return (
 <div className="bg-white rounded-2xl border border-slate-200/50 shadow-sm overflow-hidden font-sans">
      <div className="p-6 border-b border-slate-100/80 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              Справочник видов дозволов
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 font-medium">Реестр типов для вкладки и автозаполнения документов</p>
        </div>

        {user.permissions?.dozvola === "write" && (
            <button 
              onClick={() => openEditor('')} 
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 min-h-[44px] py-2.5 rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm hover:shadow-md active:scale-95"
            >
                <Plus className="h-4 w-4" />
                <span>Создать вид</span>
            </button>
        )}
      </div>

      {/* Swipe Help Badge for Mobile */}
      <div className="block lg:hidden text-[10px] font-semibold text-slate-500 bg-slate-50 border-b border-slate-100 px-4 py-2.5 text-center select-none">
         <span className="inline-block text-[#3765F6] mr-1.5 font-sans">↔</span> Таблица видов прокручивается вправо для просмотра деталей
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-slate-50/40 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              <th className="px-3 py-2 pl-5 w-16 text-center">Позиция</th>
              <th className="px-3 py-2">Название вида (Вкладка)</th>
              <th className="px-3 py-2">Страна (для документов)</th>
              <th className="px-3 py-2">Категория ЕВРО</th>
              <th className="px-3 py-2">Год бланка</th>
              <th className="px-3 py-2 pr-5 text-right">Управление</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {typesOrder
              .filter(id => types[id])
              .map((id, index) => {
                const t = types[id];
                const printMap = printMappings[t.name] || {};

                return (
                  <tr key={id} className="hover:bg-[#3765F6]/5 transition-colors group">
                    <td className="px-3 py-2 pl-5">
                        <div className="flex items-center justify-center gap-1.5">
                            <button disabled={index === 0} onClick={() => moveItem(index, -1)} className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-slate-600 cursor-pointer disabled:opacity-30 rounded-md hover:bg-slate-100 transition" title="Выше">▲</button>
                            <span className="text-[10px] font-bold text-slate-400 w-4 text-center">{index + 1}</span>
                            <button disabled={index === typesOrder.length - 1} onClick={() => moveItem(index, 1)} className="w-7 h-7 flex items-center justify-center text-slate-300 hover:text-slate-600 cursor-pointer disabled:opacity-30 rounded-md hover:bg-slate-100 transition" title="Ниже">▼</button>
                        </div>
                    </td>
                    <td className="px-3 py-2 font-bold text-slate-900 cursor-pointer hover:text-[#3765F6] transition" onClick={() => openEditor(t.id)}>
                        <div className="flex items-center gap-2">
                            {t.name}
                        </div>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-600">{printMap.country || (<span className="text-slate-300 text-[10px]">auto: {t.name}</span>)}</td>
                    <td className="px-3 py-2">
                      {printMap.category 
                          ? <span className="bg-slate-50 text-slate-600 px-2 py-0.5 rounded-lg font-mono font-bold text-[10px] border border-slate-200/50">{printMap.category}</span>
                          : <span className="text-slate-300 text-[10px] font-bold">—</span>
                      }
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-500">{printMap.year || new Date().getFullYear()}</td>
                    <td className="px-3 py-2 pr-5 text-right">
                      <div className="flex justify-end gap-1 items-center">
                          <button onClick={() => handleDeleteType(t.id, t.name)} className="p-1.5 text-rose-500 hover:text-rose-600 hover:bg-rose-50/60 rounded-lg transition cursor-pointer border border-transparent hover:border-rose-100">
                            <Trash2 className="h-4 w-4" />
                          </button>
                          <button onClick={() => openEditor(t.id)} className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer">
                            <Edit className="h-4 w-4" />
                          </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            {typesOrder.filter(id => types[id]).length === 0 && (
              <tr key="empty">
                <td colSpan={6} className="p-10 text-center text-slate-400 font-bold text-xs">Справочник пуст</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isEditingType && (
 <div className="fixed inset-0 z-50 bg-slate-950/40 flex justify-center items-center p-4 overflow-y-auto">
 <div className="bg-white rounded-2xl max-w-md w-full shadow-sm border border-slate-200 my-4">
              <div className="p-6 border-b border-slate-100 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest block font-mono">
                    Type Setup
                  </span>
                  <h2 className="text-base font-bold text-slate-900 tracking-tight">
                    {editingId ? "Редактирование вида" : "Новый вид дозвола"}
                  </h2>
                </div>
                <button
                  onClick={() => setIsEditingType(false)}
                  className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <form onSubmit={handleSaveType} className="p-6 space-y-5 flex flex-col">
                  <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Отображаемое название (Вкладка)</label>
                      <input required type="text" value={typeName} onChange={e => setTypeName(e.target.value)} className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition" placeholder="TR B, PL Euro 6..." />
                  </div>
                  <div>
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Страна (для автозаполнения документов)</label>
                      <input type="text" value={country} onChange={e => setCountry(e.target.value)} className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 placeholder:font-medium placeholder:text-slate-300 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition" placeholder="Польша, Италия..." />
                  </div>
                  <div className="flex gap-4">
                      <div className="flex-1">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Категория (ЕВРО)</label>
                          <input type="text" value={category} onChange={e => setCategory(e.target.value)} className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 placeholder:font-medium placeholder:text-slate-300 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition" placeholder="Euro 5, универсальн..." />
                      </div>
                      <div className="w-24">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block font-mono">Год</label>
                          <input type="number" value={year || ''} onChange={e => setYear(parseInt(e.target.value))} className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 placeholder:font-medium placeholder:text-slate-300 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition" />
                      </div>
                  </div>

                  <div className="pt-4 border-t border-slate-100 flex justify-end gap-2.5 mt-2">
                    <button type="button" onClick={() => setIsEditingType(false)} className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-700 transition cursor-pointer active:scale-95">
                      Отмена
                    </button>
                    <button type="submit" className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition shadow-sm hover:shadow-md active:scale-95">
                      Сохранить
                    </button>
                  </div>
              </form>
            </div>
          </div>
      )}
    </div>
  );
}

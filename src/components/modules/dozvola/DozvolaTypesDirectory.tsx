import { useDialog } from '../../DialogProvider';
import React, { useState, useEffect } from "react";
import { UserProfile } from "../../../types";
import { Plus, GripVertical, Trash2 } from "lucide-react";
import { useFirebase, database } from "../../../firebase";
import { ref, onValue, set, remove, push } from "firebase/database";

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
      let newId = editingId;
      if (!newId) {
          newId = push(ref(database, 'dozvolsTypesV4')).key || Date.now().toString();
          if (useFirebase) {
              set(ref(database, `dozvolsTypesV4/${newId}`), { id: newId, name: tName });
              set(ref(database, 'dozvolsTypesOrderV4'), [...typesOrder, newId]);
          }
      } else {
          const oldName = types[newId]?.name;
          if (useFirebase && oldName && oldName !== tName) {
              set(ref(database, `dozvolsTypesV4/${newId}/name`), tName);
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
    <div className="bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden">
      <div className="p-5 bg-slate-50 border-b border-slate-200/55 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">
              Справочник Типов Дозволов
            </h2>
            <p className="text-[10px] uppercase font-bold text-slate-400 mt-0.5">Вкладки и автозаполнение документов</p>
        </div>

        {user.permissions.dozvola === "write" && (
            <button onClick={() => openEditor('')} className="flex items-center gap-2 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] px-4 py-2 rounded-xl text-xs font-black uppercase transition cursor-pointer shadow-sm">
                <Plus className="h-4 w-4" />
                Создать вид
            </button>
        )}
      </div>

      {/* Swipe Help Badge for Mobile */}
      <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-center uppercase tracking-wider select-none">
         <span className="inline-block text-blue-500 mr-1.5 font-sans">↔</span> Таблица видов прокручивается вправо для просмотра деталей
      </div>

      <div className="overflow-x-auto custom-scrollbar">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-slate-50/60 border-b border-slate-200/55 text-[10px] uppercase font-black text-slate-400 tracking-wider">
              <th className="p-4 pl-6 w-16 text-center">Позиция</th>
              <th className="p-4">Название вида (Вкладка)</th>
              <th className="p-4">Страна (для документов)</th>
              <th className="p-4">Категория ЕВРО</th>
              <th className="p-4">Год бланка</th>
              <th className="p-4 pr-6 text-right">Управление</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-xs">
            {typesOrder
              .filter(id => types[id])
              .map((id, index) => {
                const t = types[id];
                const printMap = printMappings[t.name] || {};

                return (
                  <tr key={id} className="hover:bg-slate-50/40 transition">
                    <td className="p-4 pl-6">
                        <div className="flex flex-col items-center gap-1">
                            <button disabled={index === 0} onClick={() => moveItem(index, -1)} className="text-slate-300 hover:text-slate-600 cursor-pointer disabled:opacity-30">▲</button>
                            <span className="text-[10px] font-black text-slate-400">{index + 1}</span>
                            <button disabled={index === typesOrder.length - 1} onClick={() => moveItem(index, 1)} className="text-slate-300 hover:text-slate-600 cursor-pointer disabled:opacity-30">▼</button>
                        </div>
                    </td>
                    <td className="p-4 font-black text-slate-900 cursor-pointer hover:text-blue-600 transition" onClick={() => openEditor(t.id)}>
                        <div className="flex items-center gap-2">
                            {t.name}
                        </div>
                    </td>
                    <td className="p-4 font-bold text-slate-600">{printMap.country || (<span className="text-slate-300 text-[10px]">auto: {t.name}</span>)}</td>
                    <td className="p-4">
                      {printMap.category 
                          ? <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded-lg font-mono font-black text-[10px] border border-slate-200/50">{printMap.category}</span>
                          : <span className="text-slate-300 text-[10px] font-black">—</span>
                      }
                    </td>
                    <td className="p-4 font-bold text-slate-500">{printMap.year || new Date().getFullYear()}</td>
                    <td className="p-4 pr-6 text-right">
                      <div className="flex justify-end gap-2">
                          <button onClick={() => handleDeleteType(t.id, t.name)} className="p-2 text-rose-300 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer">
                            <Trash2 className="h-4 w-4" />
                          </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            {typesOrder.filter(id => types[id]).length === 0 && (
              <tr key="empty">
                <td colSpan={6} className="p-10 text-center text-slate-400 font-bold text-xs uppercase tracking-wider font-mono">Справочник пуст</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isEditingType && (
          <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-md flex justify-center items-center p-4">
            <div className="bg-white rounded-[2.2rem] max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200/60 overflow-hidden">
              <div className="p-6 border-b border-slate-200/55 flex items-center justify-between">
                <div>
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                    Type Setup
                  </span>
                  <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">
                    {editingId ? "Редактирование вида" : "Новый вид дозвола"}
                  </h2>
                </div>
                <button
                  onClick={() => setIsEditingType(false)}
                  className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-xs font-black flex items-center justify-center cursor-pointer transition"
                >
                  ✕
                </button>
              </div>
              <form onSubmit={handleSaveType} className="p-6 space-y-5 flex flex-col">
                  <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">Отображаемое название (Вкладка)</label>
                      <input required type="text" value={typeName} onChange={e => setTypeName(e.target.value)} className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition" placeholder="TR B, PL Euro 6..." />
                  </div>
                  <div>
                      <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">Страна (для автозаполнения документов)</label>
                      <input type="text" value={country} onChange={e => setCountry(e.target.value)} className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 placeholder:font-medium placeholder:text-slate-300 focus:outline-none focus:bg-white focus:border-slate-300 transition" placeholder="Польша, Италия..." />
                  </div>
                  <div className="flex gap-4">
                      <div className="flex-1">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">Категория (ЕВРО)</label>
                          <input type="text" value={category} onChange={e => setCategory(e.target.value)} className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 placeholder:font-medium placeholder:text-slate-300 focus:outline-none focus:bg-white focus:border-slate-300 transition" placeholder="Euro 5, универсальн..." />
                      </div>
                      <div className="w-24">
                          <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">Год</label>
                          <input type="number" value={year || ''} onChange={e => setYear(parseInt(e.target.value))} className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 placeholder:font-medium placeholder:text-slate-300 focus:outline-none focus:bg-white focus:border-slate-300 transition" />
                      </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200/55 flex justify-end gap-2.5 mt-2">
                    <button type="button" onClick={() => setIsEditingType(false)} className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-extrabold text-slate-700 transition cursor-pointer">
                      Отмена
                    </button>
                    <button type="submit" className="px-5 py-2.5 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] font-black rounded-xl text-xs uppercase tracking-wide cursor-pointer transition shadow-sm">
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

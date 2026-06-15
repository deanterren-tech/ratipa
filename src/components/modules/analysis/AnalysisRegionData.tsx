import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile } from '../../../types';
import { useFirebase, database } from '../../../firebase';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { Plus, Trash2, Edit2, Check, X, GripVertical, Search, Sparkles, Loader2 } from 'lucide-react';

interface AnalysisRegionDataProps {
  regionId: string;
  regionName: string;
  user: UserProfile;
}

interface ItemRecord {
  id: string;
  groupId: string;
  route: string;
  rate: string;
  contact: string;
  status: 'normal' | 'warning' | 'error';
}

interface GroupRecord {
  id: string;
  name: string;
  order: number;
}

export default function AnalysisRegionData({ regionId, regionName, user }: AnalysisRegionDataProps) {
  const [groups, setGroups] = useState<GroupRecord[]>([]);
  const [records, setRecords] = useState<ItemRecord[]>([]);
  
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editGroupText, setEditGroupText] = useState('');

  const [isAddingGroup, setIsAddingGroup] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');

  const [searchTerm, setSearchTerm] = useState('');
  
  // AI State
  const [aiText, setAiText] = useState('');
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [targetGroupId, setTargetGroupId] = useState<string>('');

  // Realtime loading
  useEffect(() => {
    if (!useFirebase || !regionId) return;
    
    const unsubs: any[] = [];
    
    unsubs.push(onValue(ref(database, `analysisGroups/${regionId}`), (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => (a.order || 0) - (b.order || 0));
        setGroups(arr);
        if (arr.length > 0 && !targetGroupId) {
          setTargetGroupId(arr[0].id);
        }
      } else {
        setGroups([]);
        setTargetGroupId('');
      }
    }));
    
    unsubs.push(onValue(ref(database, `analysisRecords/${regionId}`), (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.keys(data).map(k => ({ id: k, ...data[k] }));
        setRecords(arr);
      } else {
        setRecords([]);
      }
    }));

    return () => unsubs.forEach(u => u());
  }, [regionId]);

  const handleAddGroupSubmit = () => {
    if (!useFirebase) return;
    if (newGroupName.trim()) {
      const newRef = push(ref(database, `analysisGroups/${regionId}`));
      set(newRef, { name: newGroupName.trim(), order: groups.length });
    }
    setIsAddingGroup(false);
    setNewGroupName('');
  };

  const handleEditGroup = (g: GroupRecord) => {
    setEditingGroupId(g.id);
    setEditGroupText(g.name);
  };
  
  const handleSaveGroup = (id: string) => {
    if (editGroupText.trim() && useFirebase) {
      update(ref(database, `analysisGroups/${regionId}/${id}`), { name: editGroupText.trim() });
    }
    setEditingGroupId(null);
  };

  const handleDeleteGroup = (id: string) => {
    if (confirm("Вы уверены? Эта группа и все ее записи будут удалены.")) {
      if (useFirebase) {
        remove(ref(database, `analysisGroups/${regionId}/${id}`));
        const toDelete = records.filter(r => r.groupId === id);
        toDelete.forEach(r => remove(ref(database, `analysisRecords/${regionId}/${r.id}`)));
      }
    }
  };

  const handleAddRecord = (groupId: string) => {
    if (useFirebase) {
      const newRef = push(ref(database, `analysisRecords/${regionId}`));
      set(newRef, { 
        groupId, 
        route: '', 
        rate: '', 
        contact: '',
        notes: '',
        color: 'bg-white',
        createdAt: new Date().toISOString()
      });
    }
  };

  const handleUpdateRecord = (id: string, field: string, value: string) => {
    if (useFirebase) {
      // Small debounce simulation by keeping local state or just immediate push since it's an internal tool.
      // Assuming we just fire updates directly since data size per field is small.
      update(ref(database, `analysisRecords/${regionId}/${id}`), { [field]: value });
    }
  };

  const handleDeleteRecord = (id: string) => {
    if (useFirebase) {
      remove(ref(database, `analysisRecords/${regionId}/${id}`));
    }
  };

  const handleParseAi = async () => {
    if (!aiText.trim() || !targetGroupId || !useFirebase) return;
    setIsAiLoading(true);
    try {
      const resp = await fetch('/api/parse-analysis-text', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ text: aiText })
      });
      const resData = await resp.json();
      if (resData.results && Array.isArray(resData.results)) {
         resData.results.forEach((item: any) => {
            const newRef = push(ref(database, `analysisRecords/${regionId}`));
            set(newRef, {
               groupId: targetGroupId,
               route: item.route || '',
               rate: item.rate || '',
               contact: item.contact || '',
               notes: item.notes || '',
               color: 'bg-white',
               createdAt: new Date().toISOString()
            });
         });
         setAiText('');
      } else {
         alert("Не удалось распознать данные");
      }
    } catch (e) {
      console.error(e);
      alert("Ошибка при распознавании");
    } finally {
      setIsAiLoading(false);
    }
  };

  const filteredGroups = useMemo(() => {
    if (!searchTerm.trim()) return groups.map(g => ({ group: g, recs: records.filter(r => r.groupId === g.id) }));
    const lower = searchTerm.toLowerCase();
    
    return groups.map(group => {
      const groupRecords = records.filter(r => r.groupId === group.id);
      const matchedRecords = groupRecords.filter(r => 
        (r.route || '').toLowerCase().includes(lower) || 
        (r.rate || '').toLowerCase().includes(lower) || 
        (r.contact || '').toLowerCase().includes(lower)
      );
      
      const isGroupMatch = group.name.toLowerCase().includes(lower);
      return {
        group,
        recs: isGroupMatch ? groupRecords : matchedRecords
      };
    }).filter(item => item.recs.length > 0 || item.group.name.toLowerCase().includes(lower));
  }, [groups, records, searchTerm]);

  if (!regionId) return null;

  return (
    <div className="bg-white rounded-[1.5rem] lg:rounded-[2rem] p-4 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] min-h-[60vh] w-full max-w-full overflow-hidden">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between mb-6 gap-4 border-b border-slate-100 pb-4">
        <h2 className="text-xl font-black tracking-tight text-slate-800">{regionName} <span className="text-slate-400 font-medium text-sm ml-2">Таблица просчетов</span></h2>
        
        <div className="flex flex-col sm:flex-row items-center gap-2 lg:gap-4 w-full xl:w-auto">
            <div className="relative w-full sm:w-64">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <Search className="h-4 w-4 text-slate-400" />
                </div>
                <input
                    type="text"
                    placeholder="Поиск по таблицам..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-9 w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl focus:ring-blue-500 focus:border-blue-500 block p-2 transition-all font-medium"
                />
            </div>

            {isAddingGroup ? (
            <div className="flex items-center gap-2 w-full sm:w-auto">
                <input 
                type="text"
                autoFocus
                className="flex-1 sm:w-64 bg-slate-50 border border-emerald-200 focus:border-emerald-500 rounded-xl px-3 py-2 text-xs font-bold text-slate-800 outline-none transition"
                placeholder="Новая группа маршрутов..."
                value={newGroupName}
                onChange={e => setNewGroupName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAddGroupSubmit()}
                />
                <button onClick={handleAddGroupSubmit} className="bg-emerald-500 text-white p-2 rounded-xl hover:bg-emerald-600 transition"><Check size={16} /></button>
                <button onClick={() => { setIsAddingGroup(false); setNewGroupName(''); }} className="bg-slate-100 text-slate-500 p-2 rounded-xl hover:bg-slate-200 transition"><X size={16} /></button>
            </div>
            ) : (
            <button
                onClick={() => setIsAddingGroup(true)}
                className="w-full sm:w-auto justify-center bg-emerald-50 text-emerald-600 hover:bg-emerald-100 hover:text-emerald-700 rounded-xl px-3 py-2 text-xs font-bold transition flex items-center gap-2"
            >
                <Plus size={14} /> Новая группа маршрутов
            </button>
            )}
        </div>
      </div>

      {groups.length > 0 && (
         <div className="mb-8 p-4 bg-indigo-50/50 border border-indigo-100 rounded-2xl flex flex-col md:flex-row gap-4 items-start relative overflow-hidden">
            <div className="absolute right-0 top-0 w-32 h-32 bg-indigo-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
            
            <div className="flex flex-col gap-1 w-full md:w-1/3 shrink-0">
               <span className="text-xs font-black uppercase text-indigo-700 flex items-center gap-1.5"><Sparkles size={14}/> AI Помощник</span>
               <p className="text-[10px] text-indigo-600/70 font-medium leading-tight">Вставьте сырой текст (из мессенджера или почты), и AI автоматически распределит данные Маршрут / Ставка / Контора по столбцам выбранной таблицы.</p>
               
               <select 
                  className="mt-2 text-[10px] p-2 border border-indigo-200 text-indigo-800 bg-white rounded-xl outline-none font-bold w-full focus:ring-2 focus:ring-indigo-500"
                  value={targetGroupId}
                  onChange={e => setTargetGroupId(e.target.value)}
                  disabled={isAiLoading}
               >
                 {groups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                 ))}
               </select>
            </div>
            
            <div className="flex-1 w-full relative">
               <textarea
                  className="w-full h-24 p-3 bg-white border border-indigo-200 rounded-xl text-xs outline-none placeholder-indigo-300 resize-none focus:ring-2 focus:ring-indigo-500 transition-all font-medium text-slate-700"
                  placeholder="Вставьте текст, например: 'Икша - Тюмень 215С НДС Гарант Кристина'..."
                  value={aiText}
                  onChange={e => setAiText(e.target.value)}
                  disabled={isAiLoading}
               />
               <button
                 onClick={handleParseAi}
                 disabled={!aiText.trim() || isAiLoading}
                 className="absolute bottom-3 right-3 bg-indigo-600 text-white rounded-lg px-3 py-1.5 text-xs font-bold shadow hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
               >
                 {isAiLoading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12}/>}
                 Распознать
               </button>
            </div>
         </div>
      )}

      <div className="flex flex-col gap-8">
        {filteredGroups.length === 0 ? (
          <div className="text-center py-12 bg-slate-50/50 border border-slate-100 rounded-2xl">
            <p className="text-slate-400 font-medium text-sm">Таблица пуста или по запросу ничего не найдено.</p>
          </div>
        ) : (
          filteredGroups.map(item => {
            const group = item.group;
            const groupRecords = item.recs;
            return (
              <div key={group.id} className="border border-slate-200 rounded-2xl overflow-hidden bg-white shadow-sm">
                
                {/* Group Header */}
                <div className="bg-[#fcebb6] px-4 py-3 border-b border-[#f3d97f] flex items-center justify-between">
                  {editingGroupId === group.id ? (
                    <div className="flex items-center gap-2 w-full max-w-md">
                      <input 
                        className="flex-1 bg-white border border-[#d8be65] rounded px-2 py-1 text-xs font-black text-slate-800 outline-none"
                        value={editGroupText}
                        onChange={e => setEditGroupText(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSaveGroup(group.id)}
                        autoFocus
                      />
                      <button onClick={() => handleSaveGroup(group.id)} className="text-emerald-700 bg-emerald-100/50 p-1 rounded hover:bg-emerald-200"><Check size={14}/></button>
                      <button onClick={() => setEditingGroupId(null)} className="text-rose-700 bg-rose-100/50 p-1 rounded hover:bg-rose-200"><X size={14}/></button>
                    </div>
                  ) : (
                    <h3 className="text-sm font-black text-[#5a4800] tracking-tight">{group.name}</h3>
                  )}

                  <div className="flex flex-wrap items-center gap-2 opacity-50 hover:opacity-100 transition-opacity">
                    <button onClick={() => handleEditGroup(group)} className="text-[#8b7218] p-1.5 hover:bg-[#ebd582] rounded transition"><Edit2 size={13} /></button>
                    <button onClick={() => handleDeleteGroup(group.id)} className="text-[#a42929] p-1.5 hover:bg-[#e4a4a4] rounded transition"><Trash2 size={13} /></button>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse min-w-[600px]">
                    <thead className="bg-[#f0f3f5] border-b border-slate-200">
                      <tr>
                        <th className="p-3 text-[10px] uppercase font-black text-slate-500 w-1/4">Маршрут</th>
                        <th className="p-3 text-[10px] uppercase font-black text-slate-500 w-1/5">Ставка</th>
                        <th className="p-3 text-[10px] uppercase font-black text-slate-500 w-1/4">Контора и контакт</th>
                        <th className="p-3 text-[10px] uppercase font-black text-slate-500 min-w-[150px]">Примечания</th>
                        <th className="p-3 text-[10px] uppercase font-black text-slate-500 w-16 text-center"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {groupRecords.map(record => (
                        <tr key={record.id} className={`transition-colors text-xs font-semibold ${record.color || 'bg-white hover:bg-slate-50/50'}`}>
                          
                          <td className="p-0 border-r border-slate-100/50 relative">
                            <textarea 
                              className="w-full h-full min-h-[44px] p-3 bg-transparent resize-none outline-none placeholder-slate-300 text-slate-800"
                              placeholder="Например: Подольск - Екат..."
                              value={record.route}
                              onChange={e => handleUpdateRecord(record.id, 'route', e.target.value)}
                            />
                            {record.createdAt && (
                              <div className="absolute bottom-1 right-2 text-[9px] text-slate-400 pointer-events-none">
                                {new Date(record.createdAt).toLocaleDateString('ru-RU')}
                              </div>
                            )}
                          </td>
                          <td className="p-0 border-r border-slate-100/50">
                            <textarea 
                              className="w-full h-full min-h-[44px] p-3 bg-transparent resize-none outline-none placeholder-slate-300 text-slate-800"
                              placeholder="130 к без НДС"
                              value={record.rate}
                              onChange={e => handleUpdateRecord(record.id, 'rate', e.target.value)}
                            />
                          </td>
                          <td className="p-0 border-r border-slate-100/50">
                            <textarea 
                              className="w-full h-full min-h-[44px] p-3 bg-transparent resize-none outline-none placeholder-slate-300 text-slate-800"
                              placeholder="ТК ВОЛ, Дмитрий +7 953 099 0003"
                              value={record.contact}
                              onChange={e => handleUpdateRecord(record.id, 'contact', e.target.value)}
                            />
                          </td>
                          <td className="p-0 border-r border-slate-100/50">
                            <textarea 
                              className="w-full h-full min-h-[44px] p-3 bg-transparent resize-none outline-none placeholder-slate-300 text-slate-800"
                              placeholder="Примечание..."
                              value={record.notes || ''}
                              onChange={e => handleUpdateRecord(record.id, 'notes', e.target.value)}
                            />
                          </td>
                          <td className="p-2 align-middle text-center w-16">
                              <div className="flex flex-col items-center justify-center gap-1.5 opacity-50 hover:opacity-100 transition-opacity">
                                <div className="flex gap-1">
                                  <button onClick={() => handleUpdateRecord(record.id, 'color', 'bg-white hover:bg-slate-50/50')} className="w-3 h-3 rounded-full bg-slate-200 border border-slate-300 cursor-pointer" title="По умолчанию"></button>
                                  <button onClick={() => handleUpdateRecord(record.id, 'color', 'bg-rose-50 hover:bg-rose-100')} className="w-3 h-3 rounded-full bg-rose-300 border border-rose-400 cursor-pointer" title="Красный (отказ)"></button>
                                </div>
                                <div className="flex gap-1">
                                  <button onClick={() => handleUpdateRecord(record.id, 'color', 'bg-orange-50 hover:bg-orange-100')} className="w-3 h-3 rounded-full bg-orange-300 border border-orange-400 cursor-pointer" title="Оранжевый"></button>
                                  <button onClick={() => handleUpdateRecord(record.id, 'color', 'bg-blue-50 hover:bg-blue-100')} className="w-3 h-3 rounded-full bg-blue-300 border border-blue-400 cursor-pointer" title="Синий"></button>
                                </div>
                                <button onClick={() => handleDeleteRecord(record.id)} className="p-1 mt-1 text-slate-300 hover:text-rose-500 hover:bg-rose-50 rounded transition" title="Удалить строку">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Add Row Button */}
                <div className="p-2 border-t border-slate-100 bg-slate-50/20">
                  <button
                    onClick={() => handleAddRecord(group.id)}
                    className="text-xs font-bold text-slate-500 hover:text-slate-800 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition flex items-center gap-1.5"
                  >
                    <Plus size={13} /> Добавить строку
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

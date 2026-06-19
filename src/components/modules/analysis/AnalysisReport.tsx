import React, { useState, useEffect, useMemo } from 'react';
import { useFirebase, database } from '../../../firebase';
import { ref, get } from 'firebase/database';
import { LineChart, LayoutDashboard, Compass, Activity, MapPin, Search } from 'lucide-react';

interface AnalysisReportProps {
  regions: {id: string, name: string}[];
}

export default function AnalysisReport({ regions }: AnalysisReportProps) {
  const [dataLoaded, setDataLoaded] = useState(false);
  const [allGroups, setAllGroups] = useState<any[]>([]);
  const [allRecords, setAllRecords] = useState<any[]>([]);
  
  const [globalSearch, setGlobalSearch] = useState('');

  useEffect(() => {
    if (!useFirebase || regions.length === 0) return;
    
    const loadAll = async () => {
      let gArr: any[] = [];
      let rArr: any[] = [];
      
      for (const reg of regions) {
        const groupsSnap = await get(ref(database, `analysisGroups/${reg.id}`));
        const recordsSnap = await get(ref(database, `analysisRecords/${reg.id}`));
        
        const gData = groupsSnap.val();
        if (gData) {
          Object.keys(gData).forEach(k => {
            gArr.push({ id: k, regionId: reg.id, regionName: reg.name, ...gData[k] });
          });
        }
        
        const rData = recordsSnap.val();
        if (rData) {
          Object.keys(rData).forEach(k => {
            rArr.push({ id: k, regionId: reg.id, regionName: reg.name, ...rData[k] });
          });
        }
      }
      
      setAllGroups(gArr);
      setAllRecords(rArr);
      setDataLoaded(true);
    };

    loadAll();
  }, [regions]);

  const parseRate = (rateStr: string) => {
    if (!rateStr) return null;
    const match = rateStr.replace(/\s/g, '').replace(',', '.').match(/\d+(?:\.\d+)?/);
    if (match) {
      let num = parseFloat(match[0]);
      if (num < 1000 && num > 0) num *= 1000; // '130' -> 130000
      return num;
    }
    return null;
  };

  const regionStats = useMemo(() => {
    const stats: Record<string, any> = {};
    regions.forEach(r => {
      const regRecords = allRecords.filter(rec => rec.regionId === r.id);
      const rates = regRecords.map(rec => parseRate(rec.rate)).filter(v => v !== null) as number[];
      
      stats[r.id] = {
        total: regRecords.length,
        avg: rates.length > 0 ? Math.round(rates.reduce((a,b)=>a+b, 0) / rates.length) : null,
        min: rates.length > 0 ? Math.min(...rates) : null,
        max: rates.length > 0 ? Math.max(...rates) : null,
        active: regRecords.filter(x => x.color !== 'bg-rose-50 hover:bg-rose-100').length,
        errorCount: regRecords.filter(x => x.color === 'bg-rose-50 hover:bg-rose-100').length,
      };
    });
    return stats;
  }, [allRecords, regions]);

  const stats = useMemo(() => {
    return {
      totalRoutes: allRecords.length,
      totalRegions: regions.length,
    };
  }, [allRecords, regions]);

  const topCalculations = useMemo(() => {
    return allRecords
      .map(rec => ({
        ...rec,
        parsedValue: parseRate(rec.rate) || 0
      }))
      .filter(rec => rec.parsedValue > 0)
      .sort((a, b) => b.parsedValue - a.parsedValue)
      .slice(0, 2);
  }, [allRecords]);

  const regionRoutesLookup = useMemo(() => {
    const lookup: Record<string, any[]> = {};
    
    regions.forEach(r => {
      const routesMap: Record<string, { originalName: string, records: any[] }> = {};
      const regRecords = allRecords.filter(rec => rec.regionId === r.id);
      
      regRecords.forEach(rec => {
        if (!rec.route || !rec.route.trim()) return;
        const normalized = rec.route.toUpperCase().trim().replace(/\s*[-—/]\s*/g, ' - ');
        if (!routesMap[normalized]) {
          routesMap[normalized] = {
            originalName: rec.route.trim(),
            records: []
          };
        }
        routesMap[normalized].records.push(rec);
      });
      
      lookup[r.id] = Object.keys(routesMap).map(key => {
        const routeData = routesMap[key];
        const rates = routeData.records
          .map(rec => parseRate(rec.rate))
          .filter((v): v is number => v !== null);
          
        return {
          name: routeData.originalName,
          avg: rates.length > 0 ? Math.round(rates.reduce((a,b)=>a+b, 0) / rates.length) : null,
          min: rates.length > 0 ? Math.min(...rates) : null,
          max: rates.length > 0 ? Math.max(...rates) : null,
          count: routeData.records.length
        };
      });
    });
    
    return lookup;
  }, [allRecords, regions]);

  const searchResults = useMemo(() => {
    if (!globalSearch.trim()) return [];
    const lower = (globalSearch || '').toLowerCase();
    
    return allRecords.map(rec => {
       const group = allGroups.find(g => g.id === rec.groupId);
       return {
         ...rec,
         groupName: group?.name || 'Без группы'
       };
    }).filter(r => 
      (r.route || '').toLowerCase().includes(lower) ||
      (r.rate || '').toLowerCase().includes(lower) ||
      (r.contact || '').toLowerCase().includes(lower) ||
      (r.notes || '').toLowerCase().includes(lower) ||
      (r.regionName || '').toLowerCase().includes(lower) ||
      (r.groupName || '').toLowerCase().includes(lower)
    );
  }, [allRecords, allGroups, globalSearch]);

  return (
    <div className="bg-white rounded-[1.5rem] lg:rounded-[2rem] p-4 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] min-h-[60vh] w-full max-w-full overflow-hidden">
      
      <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
           <h2 className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2">
             <LineChart className="text-indigo-500" size={20} />
             Сводный Анализ Направлений
           </h2>
           <p className="text-sm text-slate-500 font-medium mt-1">
             Агрегация данных со всех таблиц проработки региональных маршрутов
           </p>
        </div>
        <div className="relative w-full md:w-72">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
            </div>
            <input
                type="text"
                placeholder="Общий поиск по всем регионам..."
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
                className="pl-9 w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl focus:ring-indigo-500 focus:border-indigo-500 block p-2 transition-all font-medium"
            />
        </div>
      </div>

      {!dataLoaded && regions.length > 0 ? (
        <div className="text-center py-12 text-slate-400 font-medium text-xs uppercase tracking-widest animate-pulse">
          Загрузка аналитики...
        </div>
      ) : regions.length === 0 ? (
        <div className="text-center py-12 bg-slate-50 border border-slate-100 rounded-2xl">
           <p className="text-slate-400 font-medium text-sm">Добавьте хотя бы одно направление для анализа.</p>
        </div>
      ) : globalSearch.trim() ? (
         <div className="space-y-4">
             <h3 className="text-sm font-black uppercase tracking-wider text-slate-500 mb-4">Результаты поиска ({searchResults.length})</h3>
             {searchResults.length === 0 ? (
                <div className="text-center py-12 bg-slate-50 border border-slate-100 rounded-2xl">
                   <p className="text-slate-400 font-medium text-sm">По вашему запросу ничего не найдено.</p>
                </div>
             ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {searchResults.map((res: any) => (
                      <div key={res.id} className="border border-slate-200 rounded-2xl p-4 bg-white shadow-sm flex flex-col hover:border-indigo-300 transition-colors">
                         <div className="flex items-center justify-between mb-2 pb-2 border-b border-slate-100/60">
                            <span className="text-[10px] font-black uppercase text-indigo-500 tracking-wider bg-indigo-50 px-2 py-0.5 rounded">{res.regionName}</span>
                            <div className="flex items-center gap-2">
                               {res.createdAt && <span className="text-[9px] font-bold text-slate-300">{new Date(res.createdAt).toLocaleDateString('ru-RU')}</span>}
                               <span className="text-[10px] font-bold text-slate-400">{res.groupName}</span>
                            </div>
                         </div>
                         <div className="space-y-3 flex-1 flex flex-col justify-between">
                            <div>
                               <p className="text-[10px] uppercase font-bold text-slate-400 w-full mb-0.5">Маршрут</p>
                               <p className="text-xs font-semibold text-slate-800 break-words">{res.route || '—'}</p>
                            </div>
                            <div className="flex gap-4">
                               <div className="flex-1">
                                  <p className="text-[10px] uppercase font-bold text-slate-400 w-full mb-0.5">Ставка</p>
                                  <p className="text-xs font-semibold text-slate-800 break-words">{res.rate || '—'}</p>
                               </div>
                               <div className="flex-1">
                                  <p className="text-[10px] uppercase font-bold text-slate-400 w-full mb-0.5">Контора / Контакт</p>
                                  <p className="text-xs font-semibold text-slate-700 break-words">{res.contact || '—'}</p>
                               </div>
                            </div>
                            {res.notes && (
                            <div>
                               <p className="text-[10px] uppercase font-bold text-slate-400 w-full mb-0.5">Примечание</p>
                               <p className="text-xs font-semibold text-slate-600 break-words italic">{res.notes}</p>
                            </div>
                            )}
                         </div>
                      </div>
                  ))}
                </div>
             )}
         </div>
      ) : (
        <div className="space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-5 hover:bg-slate-100/30 transition">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 mb-3"><LayoutDashboard size={14}/></span>
              <p className="text-2xl font-black text-slate-800 tracking-tight">{stats.totalRegions}</p>
              <p className="text-[10px] uppercase tracking-widest font-black text-slate-400 mt-1">Всего направлений</p>
            </div>
            
            <div className="bg-slate-50 border border-slate-200/50 rounded-2xl p-5 hover:bg-slate-100/30 transition">
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-100 text-indigo-600 mb-3"><Compass size={14}/></span>
              <p className="text-2xl font-black text-slate-800 tracking-tight">{stats.totalRoutes}</p>
              <p className="text-[10px] uppercase tracking-widest font-black text-slate-400 mt-1">Всего просчетов</p>
            </div>

            {/* Top 1 Maximum Rate card */}
            <div className="bg-gradient-to-br from-indigo-50/50 to-blue-50/30 border border-indigo-100/70 rounded-2xl p-5 relative overflow-hidden group hover:shadow-xs transition">
              <div className="absolute top-0 right-0 w-20 h-20 bg-indigo-200/10 rounded-full blur-xl group-hover:scale-125 transition-all"></div>
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-indigo-150 text-indigo-700 mb-2 font-black text-[10px] select-none">★ 1</span>
              {topCalculations[0] ? (
                <div>
                  <p className="text-[11px] font-extrabold text-slate-800 truncate" title={topCalculations[0].route}>{topCalculations[0].route || '—'}</p>
                  <p className="text-lg font-black text-indigo-600 tracking-tight mt-0.5 leading-none">{topCalculations[0].rate || '—'}</p>
                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-indigo-100/40 gap-2">
                    <span className="text-[8px] font-black uppercase tracking-wider text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded shrink-0">{topCalculations[0].regionName}</span>
                    <span className="text-[9px] font-bold text-slate-500 truncate" title={topCalculations[0].contact}>{topCalculations[0].contact || '—'}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 font-semibold py-3">Нет данных</p>
              )}
              <p className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 mt-2">Топ-1 Макс Ставка</p>
            </div>

            {/* Top 2 Maximum Rate card */}
            <div className="bg-gradient-to-br from-emerald-50/50 to-green-50/30 border border-emerald-100/70 rounded-2xl p-5 relative overflow-hidden group hover:shadow-xs transition">
              <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-200/10 rounded-full blur-xl group-hover:scale-125 transition-all"></div>
              <span className="flex items-center justify-center w-8 h-8 rounded-full bg-emerald-150 text-emerald-700 mb-2 font-black text-[10px] select-none">★ 2</span>
              {topCalculations[1] ? (
                <div>
                  <p className="text-[11px] font-extrabold text-slate-800 truncate" title={topCalculations[1].route}>{topCalculations[1].route || '—'}</p>
                  <p className="text-lg font-black text-emerald-600 tracking-tight mt-0.5 leading-none">{topCalculations[1].rate || '—'}</p>
                  <div className="flex items-center justify-between mt-2 pt-1 border-t border-emerald-100/40 gap-2">
                    <span className="text-[8px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded shrink-0">{topCalculations[1].regionName}</span>
                    <span className="text-[9px] font-bold text-slate-500 truncate" title={topCalculations[1].contact}>{topCalculations[1].contact || '—'}</span>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 font-semibold py-3">Нет данных</p>
              )}
              <p className="text-[9px] uppercase tracking-wider font-extrabold text-slate-400 mt-2">Топ-2  Макс Ставка</p>
            </div>
          </div>

          {/* Region Breakdown */}
          <div className="pt-6 border-t border-slate-100">
             <div className="mb-4">
                <h3 className="text-xs font-black uppercase tracking-wider text-slate-500">Детализация по направлениям</h3>
                <p className="text-[10px] text-slate-400 mt-0.5 font-bold">Список всех внесенных маршрутов внутри каждого направления с расчетом средних, минимальных и максимальных ставок</p>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {regions.map(r => {
                  const routesForThisRegion = regionRoutesLookup[r.id] || [];
                  
                  return (
                    <div key={r.id} className="border border-slate-200 rounded-2xl p-5 bg-white shadow-sm flex flex-col hover:border-indigo-100 transition-colors">
                       <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-2.5">
                          <h4 className="text-sm font-black text-slate-800">{r.name}</h4>
                          <span className="text-[10px] font-extrabold text-slate-400 uppercase tracking-wider bg-slate-50 px-2 py-0.5 rounded-full border border-slate-200/50">
                             Всего просчетов: {regionStats[r.id]?.total || 0}
                          </span>
                       </div>
                       
                       {routesForThisRegion.length === 0 ? (
                          <div className="text-center py-8 text-slate-400 text-xs italic font-semibold">
                             Маршруты не внесены
                          </div>
                       ) : (
                          <div className="space-y-4 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                             {routesForThisRegion.map((rt, idx) => (
                                <div key={rt.name + idx} className="space-y-1.5 pb-3 border-b border-slate-50 last:border-0 last:pb-0">
                                   <div className="flex items-center justify-between">
                                      <span className="text-xs font-black text-slate-700">{rt.name}</span>
                                      <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">Записей: {rt.count}</span>
                                   </div>
                                   
                                   <div className="grid grid-cols-3 gap-2">
                                      <div className="bg-slate-50/50 p-1.5 rounded-lg border border-slate-100">
                                         <p className="text-[8px] uppercase font-bold text-slate-400 tracking-wider mb-0.5">Средняя</p>
                                         <span className="text-[10.5px] font-black text-slate-700">
                                            {rt.avg ? `${rt.avg.toLocaleString('ru-RU')} ₽` : '—'}
                                         </span>
                                      </div>
                                      <div className="bg-emerald-50/40 p-1.5 rounded-lg border border-emerald-100/45">
                                         <p className="text-[8px] uppercase font-bold text-emerald-500 tracking-wider mb-0.5">Мин</p>
                                         <span className="text-[10.5px] font-black text-emerald-700">
                                            {rt.min ? `${rt.min.toLocaleString('ru-RU')} ₽` : '—'}
                                         </span>
                                      </div>
                                      <div className="bg-indigo-50/40 p-1.5 rounded-lg border border-indigo-100/45">
                                         <p className="text-[8px] uppercase font-bold text-indigo-500 tracking-wider mb-0.5">Макс</p>
                                         <span className="text-[10.5px] font-black text-indigo-700">
                                            {rt.max ? `${rt.max.toLocaleString('ru-RU')} ₽` : '—'}
                                         </span>
                                      </div>
                                   </div>
                                </div>
                             ))}
                          </div>
                       )}
                    </div>
                  );
                })}
             </div>
          </div>
        </div>
      )}
    </div>
  );
}

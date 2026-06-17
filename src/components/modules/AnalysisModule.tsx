import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { useFirebase, database, onValue } from '../../firebase';
import { ref, set, push, remove, update } from 'firebase/database';
import { LineChart, Settings, Plus, X, ListPlus, Map, RefreshCw } from 'lucide-react';
import AnalysisRegionData from './analysis/AnalysisRegionData';
import AnalysisReport from './analysis/AnalysisReport';
import AnalysisConstructor from './analysis/AnalysisConstructor';

interface AnalysisModuleProps {
  user: UserProfile;
}

export default function AnalysisModule({ user }: AnalysisModuleProps) {
  const [activeTab, setActiveTab] = useState<string>('report');
  const [regions, setRegions] = useState<{id: string, name: string}[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newRegionName, setNewRegionName] = useState('');

  // Load regions
  useEffect(() => {
    if (!useFirebase) return;
    const unsub = onValue(ref(database, 'analysisRegions'), (snap) => {
      const data = snap.val();
      if (data) {
        const arr = Object.keys(data).map(k => ({ id: k, name: data[k].name || 'Новый' }));
        setRegions(arr);
        // If there's no active tab except 'report', 'settings', and regions exist, maybe we don't force change, 
        // let the user decide. Default is 'report'
      } else {
        setRegions([]);
      }
    });
    return () => unsub();
  }, []);

  const handleAddRegion = () => {
    if (!newRegionName.trim()) return;
    if (useFirebase) {
      const newRef = push(ref(database, 'analysisRegions'));
      set(newRef, { name: newRegionName.trim() });
    }
    setNewRegionName('');
  };

  const handleDeleteRegion = (id: string, name: string) => {
    if (confirm(`Удалить направление ${name}? Все данные по нему тоже будут удалены.`)) {
      if (useFirebase) {
        remove(ref(database, `analysisRegions/${id}`));
        remove(ref(database, `analysisGroups/${id}`));
        remove(ref(database, `analysisRecords/${id}`));
      }
      if (activeTab === id) setActiveTab('report');
    }
  };

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-2 border-b border-slate-200/40">
        <div className="flex items-center gap-1 bg-[#f0f2f4] p-[3px] rounded-full border border-slate-200/50 shadow-inner max-w-full overflow-x-auto scrollbar-hide select-none">
          <button
            onClick={() => setActiveTab('report')}
            className={`text-[10px] font-extrabold tracking-tight uppercase transition-all duration-150 py-1.5 px-4 rounded-full relative cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'report' 
                ? 'bg-slate-950 text-white shadow-sm font-black' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
            }`}
          >
            <LineChart size={12} /> Сводный отчет
          </button>

          <button
            onClick={() => setActiveTab('constructor')}
            className={`text-[10px] font-extrabold tracking-tight uppercase transition-all duration-150 py-1.5 px-4 rounded-full relative cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
              activeTab === 'constructor' 
                ? 'bg-slate-950 text-white shadow-sm font-black' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
            }`}
          >
            <Map size={12} /> Конструктор
          </button>
          
          {regions.map(r => (
            <button
              key={r.id}
              onClick={() => setActiveTab(r.id)}
              className={`text-[10px] font-extrabold tracking-tight uppercase transition-all duration-150 py-1.5 px-4 rounded-full relative cursor-pointer flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === r.id 
                  ? 'bg-slate-950 text-white shadow-sm font-black' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
              }`}
            >
              <ListPlus size={12} /> {r.name}
            </button>
          ))}
        </div>

        <button
          onClick={() => setIsSettingsOpen(!isSettingsOpen)}
          className={`text-[10px] font-extrabold tracking-tight uppercase transition-all duration-150 py-2 px-4 rounded-full cursor-pointer flex items-center gap-1.5 whitespace-nowrap md:ml-auto ${
            isSettingsOpen 
              ? 'bg-slate-800 text-white shadow-sm' 
              : 'text-slate-500 hover:text-slate-900 bg-[#f0f2f4] border border-slate-200/50 hover:bg-slate-200/60'
          }`}
        >
          <Settings size={12} /> Настройка направлений
        </button>
      </div>

      {isSettingsOpen && (
        <div className="bg-white rounded-[1.5rem] lg:rounded-[2rem] p-4 lg:p-6 border border-slate-200 shadow-sm animate-in fade-in slide-in-from-top-4">
          <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 mb-4">Справочник направлений</h3>
          <div className="flex gap-2 max-w-sm mb-6">
            <input 
              type="text"
              value={newRegionName}
              onChange={e => setNewRegionName(e.target.value)}
              placeholder="Название нового направления"
              className="flex-1 bg-slate-50 border border-slate-200 text-slate-700 text-xs rounded-xl px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition"
              onKeyDown={(e) => e.key === 'Enter' && handleAddRegion()}
            />
            <button
              onClick={handleAddRegion}
              className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl px-4 py-2 text-xs font-bold transition flex items-center gap-1"
            >
              <Plus size={14} /> Добавить
            </button>
          </div>

          <div className="flex flex-col gap-2 max-w-md">
            {regions.length === 0 ? (
              <p className="text-xs text-slate-400 font-medium">Нет добавленных направлений. Добавьте, например, "Турция" или "Китай".</p>
            ) : regions.map(r => (
              <div key={r.id} className="flex items-center justify-between bg-slate-50 border border-slate-100 rounded-xl px-4 py-2.5">
                <span className="text-xs font-bold text-slate-700">{r.name}</span>
                <button 
                  onClick={() => handleDeleteRegion(r.id, r.name)}
                  className="text-slate-300 hover:text-rose-500 transition p-1"
                  title="Удалить направление"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'report' ? (
        <AnalysisReport regions={regions} />
      ) : activeTab === 'constructor' ? (
        <AnalysisConstructor />
      ) : (
        <AnalysisRegionData 
            regionId={activeTab} 
            regionName={regions.find(r => r.id === activeTab)?.name || ''} 
            user={user} 
        />
      )}
    </div>
  );
}

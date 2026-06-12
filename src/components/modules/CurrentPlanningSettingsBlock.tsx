import React, { useState, useEffect } from 'react';
import { UserProfile, AppSettings, CurrentPlanningTab } from '../../types';
import { dbService } from '../../firebase';
import { Plus, Trash2 } from 'lucide-react';
import { useToast } from '../ToastProvider';

interface Props {
  user: UserProfile;
}

export default function CurrentPlanningSettingsBlock({ user }: Props) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  useEffect(() => {
    return dbService.getSettings(setSettings);
  }, []);

  const handleAddTab = () => {
    if (!settings) return;
    const newTab: CurrentPlanningTab = {
      id: "tab_" + Date.now(),
      name: "Новая вкладка",
      sheetUrl: ""
    };
    dbService.saveSettings({
      ...settings,
      currentPlanningTabs: [...(settings.currentPlanningTabs || []), newTab]
    }, user.name, user.role);
    toast('Вкладка добавлена', 'success');
  };

  const handleUpdateTab = (id: string, field: keyof CurrentPlanningTab, value: string) => {
    if (!settings) return;
    const tabs = settings.currentPlanningTabs || [];
    const updated = tabs.map(t => t.id === id ? { ...t, [field]: value } : t);
    dbService.saveSettings({
      ...settings,
      currentPlanningTabs: updated
    }, user.name, user.role);
  };

  const handleDeleteTab = (id: string) => {
    if (!settings) return;
    const tabs = settings.currentPlanningTabs || [];
    dbService.saveSettings({
      ...settings,
      currentPlanningTabs: tabs.filter(t => t.id !== id)
    }, user.name, user.role);
    toast('Вкладка удалена', 'success');
  };

  if (!settings) return null;

  const tabs = settings.currentPlanningTabs || [];

  return (
    <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] mt-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-5">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
          Текущее планирование (Вкладки)
        </h2>
        <button 
          onClick={handleAddTab}
          className="flex items-center gap-1 text-[10px] uppercase font-black tracking-widest text-[#70FC8E] bg-slate-900 px-3 py-1.5 rounded-lg hover:bg-slate-800 transition cursor-pointer"
        >
          <Plus size={12}/> Добавить
        </button>
      </div>

      <div className="space-y-4">
        {tabs.map(tab => (
          <div key={tab.id} className="flex flex-col gap-2 p-4 bg-slate-50 border border-slate-200 rounded-xl">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono mb-1 block">Название вкладки</label>
                <input
                  type="text"
                  value={tab.name}
                  onChange={e => handleUpdateTab(tab.id, 'name', e.target.value)}
                  className="w-full bg-white border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold outline-none focus:border-blue-400"
                />
              </div>
              <div className="relative">
                <label className="text-[9px] uppercase font-bold text-slate-400 font-mono mb-1 block">Google Sheets URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={tab.sheetUrl}
                    onChange={e => handleUpdateTab(tab.id, 'sheetUrl', e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                    className="w-full bg-white border border-slate-200 px-3 py-2 rounded-lg text-xs font-bold outline-none focus:border-blue-400"
                  />
                  <button onClick={() => handleDeleteTab(tab.id)} className="p-2 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer">
                    <Trash2 size={16}/>
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[9px] text-slate-400 font-mono italic">
              ID доступа: currentPlanning_{tab.id}
            </div>
          </div>
        ))}
        {tabs.length === 0 && (
          <div className="text-center py-6 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-200">
            Нет добавленных подвкладок
          </div>
        )}
      </div>
    </div>
  );
}

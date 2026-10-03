import {useState, useEffect} from 'react'
import {UserProfile, AppSettings, CurrentPlanningTab} from '../../types'
import {dbService} from '../../api'
import {Plus, Trash2} from 'lucide-react'
import {useToast} from '../ToastProvider'

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
 <div className="bg-white rounded-2xl p-6 lg:p-8 border border-[#E5E7EB] shadow-sm space-y-6 w-full select-none mt-6">
      <div className="flex items-center justify-between border-b border-[#E5E7EB] pb-4">
        <div>
          <span className="bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB] font-bold text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono tracking-wider">
            Google Sheets Integration
          </span>
          <h2 className="text-sm font-bold tracking-tight text-[#121316] mt-2 flex items-center gap-1.5">
            Вкладки текущего планирования
          </h2>
          <p className="text-[10px] text-[#6B7280] font-medium mt-1 leading-relaxed">
            Управление доступными листами Google Sheets для планирования.
          </p>
        </div>
        <button 
          onClick={handleAddTab}
          className="flex items-center gap-1.5 text-xs font-semibold text-[var(--accent-on)] bg-[var(--accent-ui)] hover:bg-[var(--accent-ui)] active:scale-[0.98] px-4 py-2 rounded-xl shadow-xs transition cursor-pointer"
        >
          <Plus size={14} className="opacity-90" /> 
          <span className="hidden sm:inline">Добавить</span>
        </button>
      </div>

      <div className="space-y-4">
        {tabs.map(tab => (
 <div key={tab.id} className="flex flex-col gap-4 p-5 bg-white border border-[#E5E7EB] shadow-xs rounded-[1.5rem]">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-1.5 block">Название вкладки</label>
                <input
                  type="text"
                  value={tab.name}
                  onChange={e => handleUpdateTab(tab.id, 'name', e.target.value)}
                  className="w-full bg-white/45 border border-white/50 shadow-sm px-4 py-2.5 rounded-xl text-xs font-bold text-[#121316] outline-none focus:ring-4 focus:ring-[#F3F4F6] focus:border-[var(--accent-ui)] transition"
                  placeholder="Например, Мой план"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-[#9CA3AF] uppercase tracking-wider mb-1.5 block">Google Sheets URL</label>
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={tab.sheetUrl}
                    onChange={e => handleUpdateTab(tab.id, 'sheetUrl', e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/.../edit"
                    className="w-full bg-white/45 border border-white/50 shadow-sm px-4 py-2.5 rounded-xl text-xs font-bold text-[#121316] outline-none focus:ring-4 focus:ring-[#F3F4F6] focus:border-[var(--accent-ui)] transition"
                  />
                  <button 
                    onClick={() => handleDeleteTab(tab.id)} 
                    className="p-2.5 text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 border border-white/45 shadow-xs rounded-xl cursor-pointer transition-all active:scale-95 flex items-center justify-center shrink-0"
                    title="Удалить вкладку"
                  >
                    <Trash2 size={16}/>
                  </button>
                </div>
              </div>
            </div>
            <div className="text-[10px] font-bold text-[#9CA3AF] flex items-center gap-1.5">
              <span>ID доступа:</span>
              <code className="bg-[#F3F4F6] text-[#4B5563] px-1.5 py-0.5 rounded border border-[#E5E7EB] font-mono text-[9px] font-black">
                {`currentPlanning_${tab.id}`}
              </code>
            </div>
          </div>
        ))}
        {tabs.length === 0 && (
 <div className="text-center py-10 text-[#6B7280] text-xs font-medium bg-white rounded-[1.5rem] border border-[#E5E7EB] shadow-inner flex flex-col items-center gap-3">
            <span className="p-3 bg-[#F8F9FA] text-[#9CA3AF] rounded-full border border-[#E5E7EB] shadow-sm">
               <Plus size={24} />
            </span>
            <span className="font-semibold text-[#6B7280] tracking-wider text-[10px] font-mono">Нет добавленных вкладок</span>
          </div>
        )}
      </div>
    </div>
  );
}

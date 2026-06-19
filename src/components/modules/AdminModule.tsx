import React, { useState, useEffect } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../firebase';
import { ShieldAlert, ArrowUp, ArrowDown, Search, Activity, Lock } from 'lucide-react';
import UserManagementBlock from './UserManagementBlock';
import AdminOnlinePresenceBlock from './AdminOnlinePresenceBlock';
import CurrentPlanningSettingsBlock from './CurrentPlanningSettingsBlock';
import PlanZagruzokSettingsBlock from './PlanZagruzokSettingsBlock';
import PlanDohodDispatchersSettingsBlock from './PlanDohodDispatchersSettingsBlock';
import { LayoutDashboard, Calculator, Wallet, TrendingUp, FileSpreadsheet, Map, Truck, FileText, Clock, Settings } from 'lucide-react';

interface AdminModuleProps {
  user: UserProfile;
}

export default function AdminModule({ user }: AdminModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [searchLogs, setSearchLogs] = useState('');

  // Fetch data
  useEffect(() => {
    const unsubSettings = dbService.getSettings(setSettings);
    const unsubLogs = dbService.getAuditLogs(setLogs);
    return () => {
      unsubSettings();
      unsubLogs();
    };
  }, []);

  const saveSettings = (newStgs: AppSettings) => {
    setSettings(newStgs);
    dbService.saveSettings(newStgs, user.name, user.role);
  };

  const allModules = [
    { key: 'dashboard', label: 'Главная', icon: LayoutDashboard },
    { key: 'dohod', label: 'Калькуляция', icon: Calculator },
    { key: 'salary', label: 'Зарплата Водителей', icon: Wallet },
    { key: 'planDohod', label: 'План Дохода', icon: TrendingUp },
    { key: 'planZagruzok', label: 'План Загрузок', icon: FileSpreadsheet },
    { key: 'currentPlanning', label: 'Текущее Планирование', icon: Map },
    { key: 'baza', label: 'Учет выезда', icon: Truck },
    { key: 'dozvola', label: 'Учет Дозволов', icon: FileText },
    { key: 'disposition', label: 'Диспозиция', icon: Map },
    { key: 'settings', label: 'Справочники', icon: Settings },
    { key: 'admin', label: 'Администрирование', icon: ShieldAlert }
  ];

  const moveModule = (moduleKey: string, direction: 'up' | 'down') => {
    if (!settings) return;
    const currentOrder = settings.moduleOrder || allModules.map(m => m.key);
    const order = [...currentOrder];
    // Ensure all keys are in order array
    allModules.forEach(m => { if (!order.includes(m.key)) order.push(m.key); });
    
    const idx = order.indexOf(moduleKey);
    if (idx < 0) return;
    
    if (direction === 'up' && idx > 0) {
      const temp = order[idx - 1];
      order[idx - 1] = order[idx];
      order[idx] = temp;
    } else if (direction === 'down' && idx < order.length - 1) {
      const temp = order[idx + 1];
      order[idx + 1] = order[idx];
      order[idx] = temp;
    }
    saveSettings({ ...settings, moduleOrder: order });
  };

  // Audit Logs filtering
  const filteredLogs = logs.filter(
    l => l.user.toLowerCase().includes(searchLogs.toLowerCase()) ||
         l.details.toLowerCase().includes(searchLogs.toLowerCase()) ||
         l.module.toLowerCase().includes(searchLogs.toLowerCase())
  );

  // Lock non-admins completely
  if (user.role !== 'root_admin' && user.role !== 'admin') {
    return (
      <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgba(0,0,0,0.01)] border border-slate-200/50 text-center flex flex-col justify-center items-center py-24 select-none">
        <Lock className="h-12 w-12 text-slate-400 mb-4" style={{ strokeWidth: 1.5 }} />
        <span className="text-sm font-black text-slate-900 uppercase font-mono tracking-wider">Доступ заблокирован</span>
        <p className="text-xs text-slate-500 max-w-xs mt-2 font-medium">
          Панель root-администрирования доступна только Сергей.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 font-sans">
      
      {/* Banner */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] select-none">
        <span className="bg-rose-500 text-white font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono tracking-wider">
          Secured Root Console
        </span>
        <h1 className="text-2xl lg:text-3xl font-black text-slate-900 mt-1.5 flex items-center gap-2 uppercase tracking-tight">
          <ShieldAlert className="h-6 w-6 text-slate-900" style={{ fill: '#c3fb12' }} />
          Разграничение доступа {user.role === 'admin' && '(Admin View)'}
        </h1>
        <p className="text-xs text-slate-500 mt-1 font-semibold">
          Управление учетными записями, правами доступа, визуальными параметрами и логирование системы.
        </p>
      </div>

      <UserManagementBlock user={user} />

      <AdminOnlinePresenceBlock user={user} />
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <div className="space-y-6">
          <CurrentPlanningSettingsBlock user={user} />
          <PlanZagruzokSettingsBlock user={user} />
          <PlanDohodDispatchersSettingsBlock user={user} />
          
          <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
             <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-5">
               Порядок модулей в меню
             </h2>
             {allModules.slice().sort((a,b) => {
               if(!settings || !settings.moduleOrder) return 0;
               const orderA = settings.moduleOrder.indexOf(a.key);
               const orderB = settings.moduleOrder.indexOf(b.key);
               return (orderA === -1 ? 99 : orderA) - (orderB === -1 ? 99 : orderB);
             }).map((item, idx) => (
                <div key={item.key} className="flex justify-between items-center py-2 px-3 border border-slate-100 rounded-xl mb-2 bg-slate-50">
                  <span className="text-xs font-bold capitalize flex items-center gap-2">
                     <item.icon size={14} className="text-slate-400"/> {item.label}
                  </span>
                  <div className="flex gap-1">
                    <button onClick={() => moveModule(item.key, 'up')} disabled={idx === 0} className="p-1.5 hover:bg-white border border-transparent hover:border-slate-200 transition rounded-lg text-slate-400 disabled:opacity-30 cursor-pointer"><ArrowUp size={14}/></button>
                    <button onClick={() => moveModule(item.key, 'down')} disabled={idx === allModules.length - 1} className="p-1.5 hover:bg-white border border-transparent hover:border-slate-200 transition rounded-lg text-slate-400 disabled:opacity-30 cursor-pointer"><ArrowDown size={14}/></button>
                  </div>
                </div>
             ))}
          </div>

          <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-5">
               Фразы для анимированного текста (по 1 в строке)
            </h2>
            <textarea
              className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:border-slate-400 font-mono"
              rows={5}
              value={settings?.customPhrases?.join('\n') || ''}
              onChange={(e) => {
                if(!settings) return;
                saveSettings({...settings, customPhrases: e.target.value.split('\n')});
              }}
            />
          </div>
        </div>

        {/* Right Column: Global AuditTrail stream (Slate design structure) */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col h-[750px]">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 mb-3 border-b border-slate-100 pb-3.5">
            <Activity className="h-4.5 w-4.5 text-rose-500 animate-pulse" />
            Сквозной Аудит Действий
          </h2>

          <div className="relative mb-4 shrink-0">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              placeholder="Фильтр по оператору, деталям..."
              value={searchLogs}
              onChange={(e) => setSearchLogs(e.target.value)}
              className="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-slate-400 focus:bg-white transition duration-150 rounded-xl text-xs font-bold"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1 custom-scrollbar">
            {filteredLogs.map((log) => (
              <div key={log.id} className="text-xs border-l-3 border-[#c3fb12] bg-slate-50/50 hover:bg-slate-50 p-3.5 rounded-r-2xl transition duration-100">
                <div className="flex justify-between font-black text-slate-550 mb-1.5 font-mono text-[9px] uppercase tracking-wider">
                  <span className="text-slate-900">{log.user} ({log.role})</span>
                  <span className="text-slate-400">{new Date(log.date).toLocaleString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</span>
                </div>
                <p className="text-slate-800 font-bold leading-normal">{log.details}</p>
                <div className="text-[9px] text-[#c3fb12] font-mono tracking-normal bg-slate-950 p-1.5 rounded-lg mt-2 flex items-center justify-between">
                  <span>MODULE: {log.module}</span>
                  <span className="text-slate-400 text-[8px]">ACTION: {log.actionType}</span>
                </div>
              </div>
            ))}
            {!filteredLogs.length && (
              <div className="text-center py-16 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">
                Логов не обнаружено.
              </div>
            )}
          </div>
        </div>

      </div>

    </div>
  );
}

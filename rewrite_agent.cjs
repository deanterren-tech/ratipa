const fs = require('fs');

const code = `
import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { dbService } from '../../firebase';
import { useDialog } from '../DialogProvider';
import { ref, onValue, set } from 'firebase/database';
import { database } from '../../firebase';
import { 
  Sparkles, 
  Key, 
  RefreshCw, 
  Copy, 
  Check, 
  AlertTriangle, 
  Activity, 
  Globe, 
  ShieldCheck, 
  Terminal, 
  Play, 
  X, 
  Clock, 
  Calendar,
  Lock,
  Database,
  Map,
  Truck,
  Settings,
  Bell
} from 'lucide-react';
import { useToast } from '../ToastProvider';

interface AdminAgentBlockProps {
  user: UserProfile;
}

export default function AdminAgentBlock({ user }: AdminAgentBlockProps) {
  const { showConfirm } = useDialog();
  const toast = useToast();

  const [agentEnabled, setAgentEnabled] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [externalApis, setExternalApis] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<any[]>([]);
  const [logsFilter, setLogsFilter] = useState('');

  const modules = [
    { id: 'admin', name: 'Администрирование', icon: ShieldCheck },
    { id: 'planDohod', name: 'План дохода и финансы', icon: Activity },
    { id: 'baza', name: 'База автопарка и водители', icon: Truck },
    { id: 'disposition', name: 'Учет выезда (Диспозиция)', icon: Map },
    { id: 'settings', name: 'Справочники и тарифы', icon: Database },
    { id: 'notifications', name: 'Уведомления', icon: Bell },
  ];

  const permissionLevels = [
    { value: 'full', label: 'Полный доступ' },
    { value: 'read_only', label: 'Только чтение' },
    { value: 'settings_only', label: 'Настройки без изменения данных' },
    { value: 'none', label: 'Нет доступа' }
  ];

  useEffect(() => {
    const configRef = ref(database, 'agent_config');
    const unsub = onValue(configRef, (snapshot) => {
      const data = snapshot.val() || {};
      setAgentEnabled(data.enabled || false);
      setPermissions(data.permissions || {});
      setExternalApis(data.externalApis || {});
    });

    const logsRef = ref(database, 'agent_logs');
    const unsubLogs = onValue(logsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        setLogs(Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => b.timestamp - a.timestamp));
      } else {
        setLogs([]);
      }
    });

    return () => { unsub(); unsubLogs(); };
  }, []);

  const saveConfig = (newEnabled: boolean, newPerms: any, newApis: any) => {
    set(ref(database, 'agent_config'), {
      enabled: newEnabled,
      permissions: newPerms,
      externalApis: newApis,
      lastUpdated: Date.now(),
      updatedBy: user.name
    });
    toast('Настройки агента сохранены', 'success');
  };

  const toggleAgent = () => {
    const newVal = !agentEnabled;
    setAgentEnabled(newVal);
    saveConfig(newVal, permissions, externalApis);
  };

  const updatePermission = (moduleId: string, level: string) => {
    const newPerms = { ...permissions, [moduleId]: level };
    setPermissions(newPerms);
    saveConfig(agentEnabled, newPerms, externalApis);
  };

  const updateApi = (key: string, value: string) => {
    const newApis = { ...externalApis, [key]: value };
    setExternalApis(newApis);
    saveConfig(agentEnabled, permissions, newApis);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center border border-indigo-100 shadow-sm">
          <Sparkles className="w-5 h-5 text-indigo-500" />
        </div>
        <div>
          <h2 className="text-lg font-black text-slate-800 tracking-tight">Агент API</h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">Центр управления AI-Агентом, права доступа и интеграции</p>
        </div>
      </div>

      {/* STATUS BLOCK */}
      <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5 flex flex-col md:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Activity className="w-4 h-4 text-indigo-500" />
            Состояние агента
          </h3>
          <p className="text-xs text-slate-500 mt-1 max-w-md">
            Включение или отключение глобального доступа AI-агента к системе. Если выключено, агент не сможет выполнять никакие операции.
          </p>
        </div>
        <div className="flex items-center gap-3 bg-white px-4 py-3 rounded-2xl border border-slate-200 shadow-sm">
          <span className={\`text-xs font-black uppercase tracking-widest \${agentEnabled ? 'text-emerald-500' : 'text-slate-400'}\`}>
            {agentEnabled ? 'ON' : 'OFF'}
          </span>
          <button 
            onClick={toggleAgent}
            className={\`w-14 h-7 rounded-full p-1 transition-colors duration-300 ease-in-out cursor-pointer \${agentEnabled ? 'bg-emerald-500' : 'bg-slate-300'}\`}
          >
            <div className={\`w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 \${agentEnabled ? 'translate-x-7' : 'translate-x-0'}\`} />
          </button>
        </div>
      </div>

      {/* MODULES PERMISSIONS */}
      <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5">
        <div className="mb-5">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Lock className="w-4 h-4 text-rose-500" />
            Доступы к модулям
          </h3>
          <p className="text-xs text-slate-500 mt-1">Настройка прав доступа агента к разделам приложения</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {modules.map(mod => {
            const Icon = mod.icon;
            const currentPerm = permissions[mod.id] || 'none';
            return (
              <div key={mod.id} className="bg-white border border-slate-100 rounded-2xl p-4 flex items-center justify-between gap-4 shadow-sm hover:shadow-md transition">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-slate-600" />
                  </div>
                  <span className="text-xs font-bold text-slate-700">{mod.name}</span>
                </div>
                <select 
                  value={currentPerm}
                  onChange={(e) => updatePermission(mod.id, e.target.value)}
                  disabled={!agentEnabled}
                  className="bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700 rounded-xl px-3 py-1.5 outline-none focus:border-indigo-400 disabled:opacity-50 cursor-pointer"
                >
                  {permissionLevels.map(lvl => (
                    <option key={lvl.value} value={lvl.value}>{lvl.label}</option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </div>

      {/* EXTERNAL APIS */}
      <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5">
        <div className="mb-5">
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Globe className="w-4 h-4 text-emerald-500" />
            Интеграции внешних API
          </h3>
          <p className="text-xs text-slate-500 mt-1">Управление ключами и токенами для работы агента со сторонними сервисами (безопасное хранение без жесткой привязки к промптам)</p>
        </div>
        
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="sm:col-span-1 text-xs font-bold text-slate-700 flex items-center">OpenAI / Gemini Key</div>
            <div className="sm:col-span-2">
              <input 
                type="password" 
                value={externalApis['ai_model'] || ''}
                onChange={e => updateApi('ai_model', e.target.value)}
                placeholder="sk-..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-400"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="sm:col-span-1 text-xs font-bold text-slate-700 flex items-center">Mapbox API (Геокодинг)</div>
            <div className="sm:col-span-2">
              <input 
                type="password" 
                value={externalApis['mapbox'] || ''}
                onChange={e => updateApi('mapbox', e.target.value)}
                placeholder="pk.ey..."
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-400"
              />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-white border border-slate-100 rounded-2xl p-4 shadow-sm">
            <div className="sm:col-span-1 text-xs font-bold text-slate-700 flex items-center">Wialon / GPS Token</div>
            <div className="sm:col-span-2">
              <input 
                type="password" 
                value={externalApis['wialon'] || ''}
                onChange={e => updateApi('wialon', e.target.value)}
                placeholder="Токен авторизации"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-emerald-400"
              />
            </div>
          </div>
        </div>
      </div>

      {/* LOGS */}
      <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <Terminal className="w-4 h-4 text-slate-500" />
              Журнал действий агента
            </h3>
            <p className="text-xs text-slate-500 mt-1">История вызовов и изменений</p>
          </div>
          <div className="relative">
            <input 
              type="text"
              placeholder="Поиск по логам..."
              value={logsFilter}
              onChange={e => setLogsFilter(e.target.value)}
              className="pl-3 pr-8 py-2 text-xs bg-white border border-slate-200 shadow-sm rounded-xl w-[200px] focus:outline-none focus:border-indigo-400"
            />
            {logsFilter && (
              <button onClick={() => setLogsFilter('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto max-h-[300px] border border-slate-200/60 rounded-xl bg-white/50 custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50 backdrop-blur z-10 shadow-sm">
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
                <th className="p-3 pl-4">Время</th>
                <th className="p-3">Модуль</th>
                <th className="p-3">Действие</th>
                <th className="p-3">Результат</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.filter(l => !logsFilter || JSON.stringify(l).toLowerCase().includes(logsFilter.toLowerCase())).map(log => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition text-xs font-medium text-slate-700">
                  <td className="p-3 pl-4 whitespace-nowrap text-slate-500">
                    {new Date(log.timestamp).toLocaleString('ru-RU')}
                  </td>
                  <td className="p-3">
                    <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-[10px] font-bold text-slate-600 uppercase tracking-wider">
                      {log.module}
                    </span>
                  </td>
                  <td className="p-3 text-slate-800">{log.actionType}</td>
                  <td className="p-3">
                    <span className={\`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider \${log.status === 'success' ? 'text-emerald-700 bg-emerald-50' : 'text-rose-700 bg-rose-50'}\`}>
                      {log.status || 'unknown'}
                    </span>
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Логи пока пусты
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  );
}
`;

fs.writeFileSync('src/components/modules/AdminAgentBlock.tsx', code);

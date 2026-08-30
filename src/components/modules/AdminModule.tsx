import {useDialog} from '../DialogProvider'
import {useState, useEffect} from 'react'
import {UserProfile, AppSettings} from '../../types'
import { dbService, directoryService } from '../../api';
import { 
  ShieldAlert, 
  ArrowUp, 
  ArrowDown, 
  Search, 
  Activity, 
  Lock, 
  Plus, 
  Trash2, 
  Settings2, 
  GripVertical, 
  RotateCcw, 
  Sparkles, 
  ChevronLeft, 
  ChevronRight, 
  Check, 
  X,
  Users,
  Bell,
  Compass,
  ShieldCheck,
  LayoutDashboard, 
  Calculator, 
  Wallet, 
  TrendingUp, 
  FileSpreadsheet, 
  Map, 
  Truck, 
  FileText, 
  Clock,
  Settings,
  LogOut,
  Shield,
} from 'lucide-react';
import UserManagementBlock from './UserManagementBlock';
import AdminOnlinePresenceBlock from './AdminOnlinePresenceBlock';

import AdminFirebaseConfigBlock from './AdminFirebaseConfigBlock';
import AdminAgentBlock from './AdminAgentBlock';
import AdminAuditLogsBlock from './AdminAuditLogsBlock';
import AdminWelcomePhrasesBlock from './AdminWelcomePhrasesBlock';
import {pdService} from '../../api';

interface AdminModuleProps {
  user: UserProfile;
}


export default function AdminModule({ user }: AdminModuleProps) {
  const { showConfirm } = useDialog();
  

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [searchLogs, setSearchLogs] = useState('');
  const [userListCount, setUserListCount] = useState(0);
  const [dispatchersCount, setDispatchersCount] = useState(0);
  const [customPhrasesText, setCustomPhrasesText] = useState('');
  const [activeTab, setActiveTab] = useState<'users' | 'system' | 'welcome' | 'push' | 'agent'>('users');
  useEffect(() => {
    if (settings?.customPhrases) setCustomPhrasesText(settings.customPhrases.join('\n'));
  }, [settings?.customPhrases]);

  // Fetch data
  useEffect(() => {
    const unsubSettings = dbService.getSettings(setSettings);
    const unsubLogs = dbService.getAuditLogs(setLogs);
    const unsubUsers = dbService.getUsers((list) => setUserListCount(list?.length || 0));
    const unsubDisp = directoryService.getDispatchersFlat((disp) => setDispatchersCount(disp?.length || 0));
    return () => {
      unsubSettings();
      unsubLogs();
      unsubUsers();
      unsubDisp();
    };
  }, []);

  const saveSettings = (newStgs: AppSettings) => {
    setSettings(newStgs);
    dbService.saveSettings(newStgs, user.name, user.role);
  };

  // Принудительно завершить ВСЕ активные сессии (force-logout).
  // Инкрементируем globalSessionVersion -> все клиенты получают обновление и разлогиниваются.
  const handleForceLogoutAll = () => {
    showConfirm(
      'Все пользователи будут принудительно выведены из системы. Им потребуется повторно авторизоваться. Это безопасно после обновлений — гарантирует, что у всех подхватятся новые функции и схема данных.',
      'Завершить все сессии?'
    ).then((ok) => {
      if (!ok) return;
      const nextVersion = (Number(settings?.globalSessionVersion || 0)) + 1;
      saveSettings({ ...(settings as AppSettings), globalSessionVersion: nextVersion });
    });
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
    { key: 'appSettings', label: 'Настройки', icon: Settings2 },
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
    l => String(l.user || '').toLowerCase().includes(searchLogs.toLowerCase()) ||
         String(l.details || '').toLowerCase().includes(searchLogs.toLowerCase()) ||
         String(l.module || '').toLowerCase().includes(searchLogs.toLowerCase())
  );

  // Lock non-admins completely
  if (user.role !== 'root_admin' && user.role !== 'admin') {
    return (
      <div className="bg-white rounded-[2rem] p-8 border border-slate-200 shadow-[0_15px_45px_rgba(0,0,0,0.1)] text-center flex flex-col justify-center items-center py-24 select-none">
        <Lock className="h-12 w-12 text-slate-400 mb-4" style={{ strokeWidth: 1.5 }} />
        <span className="text-sm font-bold text-slate-900 uppercase font-mono tracking-wider">Доступ заблокирован</span>
        <p className="text-xs text-slate-500 max-w-xs mt-2 font-medium">
          Панель root-администрирования доступна только администраторам.
        </p>
      </div>
    );
  }

  const tabsList = [
    { id: 'users', label: 'Пользователи и Сессии', icon: Users, count: userListCount },

    { id: 'welcome', label: 'Бегущая строка', icon: Sparkles, count: settings?.customPhrases?.length || 0 },
    { id: 'system', label: 'Система и Настройки', icon: Settings, count: 0 },
    { id: 'agent', label: 'Агент (API)', icon: Sparkles, count: 0 },
  ] as const;

  return (
    <div className="w-full space-y-6 font-sans relative">

      {/* UNIFIED PANEL */}
      <div className="bg-white rounded-[2rem] border border-slate-200 shadow-[0_15px_45px_rgba(0,0,0,0.1)] overflow-hidden flex flex-col min-h-[85vh] relative">
        
        {/* HEADER BAR */}
        <div className="p-6 lg:p-8 border-b border-slate-100 bg-slate-50/80 select-none z-10 shrink-0">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">Модуль Администрирование</span>
              <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                <Shield className="w-7 h-7 text-slate-800" />
                <span>Панель администратора</span>
              </h1>
              <p className="text-xs text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
                Конфигурация прав доступа сотрудников, структуры навигационного меню, параметров планирования и пуш-рассылок Ratipa
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] bg-slate-50 border border-slate-200 shadow-xs text-slate-700 font-bold px-3.5 py-1.5 rounded-xl font-mono uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>{user.role === 'root_admin' ? 'Root доступ' : 'Администратор'}</span>
            </div>
          </div>

          {/* PREMIUM SCROLLABLE TAB NAVIGATOR */}
          <div className="mt-6 flex flex-wrap gap-1 p-1 bg-slate-50 border border-slate-200 rounded-2xl max-w-max">
            {tabsList.map((t) => {
              const IconComp = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 select-none cursor-pointer active:scale-95 ${
                    isActive 
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200/60' 
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/50'
                  }`}
                >
                  <IconComp className={`w-3.5 h-3.5 transition-transform duration-150 ${isActive ? 'text-[#3765F6]' : 'text-slate-400'}`} />
                  <span>{t.label}</span>
                  {t.count > 0 && (
                    <span className={`text-[8.5px] px-1.5 py-0.5 rounded-full font-mono font-bold leading-none transition-colors ${
                      isActive ? 'bg-[#3765F6]/10 text-[#3765F6] font-bold' : 'bg-slate-900/5 text-slate-500 border border-slate-200/60 font-bold'
                    }`}>
                      {t.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* CONTENT AREA */}
        <div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar relative z-0">
          <div className="space-y-6 max-w-full mx-auto">
          <div className={activeTab === 'users' ? 'space-y-6' : 'hidden'}>
            <UserManagementBlock user={user} />
            <AdminOnlinePresenceBlock user={user} />
          </div>



          <div className={activeTab === 'system' ? 'space-y-6' : 'hidden'}>
            <AdminFirebaseConfigBlock />

            {/* Force Logout All Sessions — только для Root Admin */}
            {user.role === 'root_admin' && (
              <div className="bg-white rounded-[1.8rem] p-6 lg:p-8 border border-rose-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 w-full">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <span className="bg-rose-500/10 text-rose-600 border border-rose-500/20 font-mono text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1.5 inline-block">
                      Безопасность сессий
                    </span>
                    <h2 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
                      <ShieldAlert className="h-4.5 w-4.5 text-rose-500" />
                      Завершение всех сессий
                    </h2>
                    <p className="text-[11px] text-slate-500 mt-1 max-w-md">
                      Принудительно выводит из системы всех пользователей. Используйте после обновлений, чтобы все гарантированно вошли заново и работали на актуальной схеме данных.
                    </p>
                  </div>
                  <button
                    onClick={handleForceLogoutAll}
                    className="bg-rose-500 hover:bg-rose-600 active:scale-[0.98] text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-sm border border-rose-500/20 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    Завершить все сессии
                  </button>
                </div>
                <div className="text-[10px] font-mono text-slate-400">
                  Текущая версия сессии: {settings?.globalSessionVersion || 0}
                </div>
              </div>
            )}

            <div className="mt-6">
              {/* Redesigned Audit Logs Block */}
              <AdminAuditLogsBlock logs={logs} />
            </div>
          </div>

          <div className={activeTab === 'welcome' ? 'space-y-6' : 'hidden'}>
            <AdminWelcomePhrasesBlock settings={settings} onSave={saveSettings} />
          </div>

          <div className={activeTab === 'agent' ? 'space-y-6' : 'hidden'}>
            <AdminAgentBlock user={user} />
          </div>

        </div>
      </div>

    </div>
      </div>
  );
}
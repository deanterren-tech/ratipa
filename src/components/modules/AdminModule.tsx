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
  FolderPlus, 
  GripVertical, 
  Folder, 
  Link2, 
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
  LogOut
} from 'lucide-react';
import UserManagementBlock from './UserManagementBlock';
import AdminOnlinePresenceBlock from './AdminOnlinePresenceBlock';
import CurrentPlanningSettingsBlock from './CurrentPlanningSettingsBlock';
import PlanZagruzokSettingsBlock from './PlanZagruzokSettingsBlock';
import AdminFirebaseConfigBlock from './AdminFirebaseConfigBlock';
import AdminMapboxLimitsBlock from './AdminMapboxLimitsBlock';
import AdminAgentBlock from './AdminAgentBlock';
import MenuDesignerBlock from './MenuDesignerBlock';
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
      <div className="bg-white/60 backdrop-blur-xl rounded-[2rem] p-8 shadow-sm border border-white/40 text-center flex flex-col justify-center items-center py-24 select-none">
        <Lock className="h-12 w-12 text-slate-400 mb-4" style={{ strokeWidth: 1.5 }} />
        <span className="text-sm font-black text-slate-900 uppercase font-mono tracking-wider">Доступ заблокирован</span>
        <p className="text-xs text-slate-500 max-w-xs mt-2 font-medium">
          Панель root-администрирования доступна только администраторам.
        </p>
      </div>
    );
  }

  const [activeTab, setActiveTab] = useState<'users' | 'planning' | 'income' | 'navigation' | 'system' | 'welcome' | 'push' | 'agent'>('users');

  const tabsList = [
    { id: 'users', label: 'Пользователи и Сессии', icon: Users, count: userListCount },
    { id: 'planning', label: 'Планирование', icon: Compass, count: (settings?.currentPlanningTabs?.length || 0) + (settings?.planZagruzokTabs?.length || 0) },
    { id: 'income', label: 'План Дохода', icon: TrendingUp, count: dispatchersCount },
    { id: 'navigation', label: 'Конструктор меню', icon: FolderPlus, count: settings?.menuStructure?.length || 10 },
    { id: 'welcome', label: 'Бегущая строка', icon: Sparkles, count: settings?.customPhrases?.length || 0 },
    { id: 'system', label: 'Система и Настройки', icon: Settings, count: 0 },
    { id: 'agent', label: 'Агент (API)', icon: Sparkles, count: 0 },
  ] as const;

  return (
    <div className="w-full space-y-6 font-sans relative">

      {/* BACKGROUND ELEMENTS */}
      <div className="fixed inset-0 bg-[#f4f5f6] -z-20" />
      <div className="fixed inset-0 tech-grid opacity-[0.08] pointer-events-none -z-10" />
      <div className="fixed inset-0 overflow-hidden pointer-events-none select-none -z-10">
        <div className="absolute -top-32 -left-32 w-[650px] h-[650px] rounded-full bg-[#3765F6]/10 blur-[130px] md:blur-[170px]" />
        <div className="absolute -bottom-32 right-[10%] w-[700px] h-[550px] rounded-full bg-[#3765F6]/10 blur-[130px] md:blur-[170px]" />
        <div className="absolute top-[40%] left-[20%] w-[500px] h-[400px] rounded-full bg-[#3765F6]/10 blur-[130px] md:blur-[140px]" />
      </div>

      
      {/* UNIFIED GLASS PANEL */}
      <div className="bg-white/40 backdrop-blur-xl rounded-[2rem] border border-white/45 shadow-sm overflow-hidden flex flex-col min-h-[85vh] relative">
        {/* INNER GLOWS FOR THE PANEL */}
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-white/60 to-transparent pointer-events-none" />
        
        {/* HEADER BAR */}
        <div className="p-6 lg:p-8 border-b border-white/40 bg-white/10 backdrop-blur-md select-none z-10 shrink-0">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
            <div>
              <div className="inline-flex items-center gap-1.5 bg-[#3765F6]/5 border border-[#3765F6]/10 text-[#3765F6] font-mono text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-2">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-500"></span>
                </span>
                <span>Ratipa Control Center</span>
              </div>
              <h1 className="text-base font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-[#3765F6]" />
                <span>Панель администратора</span>
              </h1>
              <p className="text-xs text-slate-500 font-medium mt-1 max-w-2xl leading-relaxed">
                Конфигурация прав доступа сотрудников, структуры навигационного меню, параметров планирования и пуш-рассылок Ratipa
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-[10px] bg-white/60 border border-white/50 shadow-xs text-slate-700 font-bold px-3.5 py-1.5 rounded-xl font-mono uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-emerald-500" />
              <span>{user.role === 'root_admin' ? 'Root доступ' : 'Администратор'}</span>
            </div>
          </div>

          {/* PREMIUM SCROLLABLE TAB NAVIGATOR */}
          <div className="mt-6 flex flex-wrap gap-1 p-1 bg-white/30 backdrop-blur-md shadow-inner rounded-2xl border border-white/40 max-w-max">
            {tabsList.map((t) => {
              const IconComp = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setActiveTab(t.id)}
                  className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold tracking-tight transition-all duration-200 select-none cursor-pointer active:scale-95 ${
                    isActive 
                      ? 'bg-[#3765F6] text-white shadow-xs border border-[#3765F6]/10 scale-[1.01]' 
                      : 'text-slate-500 hover:text-slate-800 hover:bg-white/40'
                  }`}
                >
                  <IconComp className={`w-3.5 h-3.5 transition-transform duration-150 ${isActive ? 'text-white scale-110' : 'text-slate-400'}`} />
                  <span>{t.label}</span>
                  {t.count > 0 && (
                    <span className={`text-[8.5px] px-1.5 py-0.5 rounded-full font-mono font-bold leading-none transition-colors ${
                      isActive ? 'bg-white/20 text-white font-bold' : 'bg-slate-900/5 text-slate-500 border border-white/30 font-bold'
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
          <div className="space-y-6 max-w-7xl mx-auto">
          <div className={activeTab === 'users' ? 'space-y-6' : 'hidden'}>
            <UserManagementBlock user={user} />
            <AdminOnlinePresenceBlock user={user} />
          </div>

          <div className={activeTab === 'planning' ? 'space-y-6' : 'hidden'}>
            <CurrentPlanningSettingsBlock user={user} />
            <PlanZagruzokSettingsBlock user={user} />
          </div>

          <div className={activeTab === 'income' ? 'space-y-6' : 'hidden'}>
            <div className="bg-white/40 backdrop-blur-md rounded-[1.8rem] p-6 lg:p-8 border border-white/45 shadow-xs">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-4 h-4 text-[#3765F6]" />
                <h2 className="text-sm font-bold text-slate-900">Диспетчеры</h2>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Справочник диспетчеров теперь единый — управляется в разделе <b>«Справочники» → «Диспетчеры»</b>.
                Там же доступны цвета и перетаскивание для изменения порядка вывода.
              </p>
            </div>
          </div>

          <div className={activeTab === 'navigation' ? 'space-y-6' : 'hidden'}>
            <MenuDesignerBlock settings={settings} onSave={saveSettings} />
          </div>

          <div className={activeTab === 'system' ? 'space-y-6' : 'hidden'}>
            <AdminFirebaseConfigBlock />
            <AdminMapboxLimitsBlock settings={settings} user={user} />

            {/* Force Logout All Sessions — только для Root Admin */}
            {user.role === 'root_admin' && (
              <div className="bg-white/40 backdrop-blur-md rounded-[1.8rem] p-6 lg:p-8 border border-rose-200/60 shadow-xs space-y-4 w-full">
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
                    className="bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition-all shadow-xs border border-rose-600/20 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
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

            {/* Read-Only Dynamic Menu Overview */}
            <div className="bg-white/40 backdrop-blur-md rounded-[1.8rem] p-6 lg:p-8 border border-white/45 shadow-xs space-y-6 w-full">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/40 pb-5">
                <div>
                  <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1.5 inline-block">
                    Current Navigation Map
                  </span>
                  <h2 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
                    <Folder className="h-4.5 w-4.5 text-[#3765F6]" />
                    Активная навигация Ratipa
                  </h2>
                </div>
                <button
                  onClick={() => setActiveTab('navigation')}
                  className="bg-[#3765F6] hover:bg-[#2555E5] active:scale-[0.98] text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all shadow-xs border border-[#3765F6]/10 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
                >
                  <Settings className="w-3.5 h-3.5" />
                  Перейти в конструктор
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3.5">
                {(settings?.menuStructure || [
                  { id: 'g_home', label: 'Главная', isDropdown: false, singleModuleKey: 'dashboard' },
                  { id: 'g_planning', label: 'Планирование', isDropdown: true, subtabKeys: ['planDohod', 'planZagruzok', 'currentPlanning'] },
                  { id: 'g_calc', label: 'Калькуляция', isDropdown: false, singleModuleKey: 'dohod' },
                  { id: 'g_salary', label: 'Зарплата', isDropdown: false, singleModuleKey: 'salary' },
                  { id: 'g_baza', label: 'Учет выезда', isDropdown: false, singleModuleKey: 'baza' },
                  { id: 'g_dozvola', label: 'Дозволы', isDropdown: false, singleModuleKey: 'dozvola' },
                  { id: 'g_docs', label: 'Документы', isDropdown: false, singleModuleKey: 'documents' },
                  { id: 'g_disp', label: 'Диспозиция', isDropdown: false, singleModuleKey: 'disposition' },
                  { id: 'g_settings', label: 'Справочники', isDropdown: false, singleModuleKey: 'settings' },
                  { id: 'g_admin', label: 'Админ', isDropdown: false, singleModuleKey: 'admin' }
                ]).map((group) => (
                  <div key={group.id} className="p-4 bg-white/50 backdrop-blur-sm rounded-[1.25rem] border border-white/50 shadow-xs flex items-center gap-3">
                    <div className={`p-2.5 rounded-xl text-xs shrink-0 ${group.isDropdown ? 'bg-[#3765F6]/10 text-[#3765F6]' : 'bg-slate-900/5 text-slate-700'}`}>
                      {group.isDropdown ? <Folder size={14} /> : <Link2 size={14} />}
                    </div>
                    <div className="min-w-0">
                      <span className="text-[11px] font-black text-slate-800 block truncate leading-tight">{group.label}</span>
                      <span className="text-[8.5px] font-mono font-bold uppercase tracking-widest text-slate-400">
                        {group.isDropdown ? `Группа (${group.subtabKeys?.length || 0} вкл.)` : 'Прямая ссылка'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

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
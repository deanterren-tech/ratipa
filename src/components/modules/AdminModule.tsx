import {useDialog} from '../DialogProvider'
import {useState, useEffect} from 'react'
import {UserProfile, AppSettings} from '../../types'
import {dbService} from '../../firebase'
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
  Settings 
} from 'lucide-react';
import UserManagementBlock from './UserManagementBlock';
import AdminOnlinePresenceBlock from './AdminOnlinePresenceBlock';
import CurrentPlanningSettingsBlock from './CurrentPlanningSettingsBlock';
import PlanZagruzokSettingsBlock from './PlanZagruzokSettingsBlock';
import PlanDohodDispatchersSettingsBlock from './PlanDohodDispatchersSettingsBlock';
import AdminFirebaseConfigBlock from './AdminFirebaseConfigBlock';
import AdminMapboxLimitsBlock from './AdminMapboxLimitsBlock';
import AdminAgentBlock from './AdminAgentBlock';
import MenuDesignerBlock from './MenuDesignerBlock';
import AdminAuditLogsBlock from './AdminAuditLogsBlock';
import AdminWelcomePhrasesBlock from './AdminWelcomePhrasesBlock';
import {pdService} from '../../firebase/planDohodService'

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
    const unsubDisp = pdService.subscribeDispatchers((disp) => setDispatchersCount(disp?.length || 0));
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
            <PlanDohodDispatchersSettingsBlock user={user} />
          </div>

          <div className={activeTab === 'navigation' ? 'space-y-6' : 'hidden'}>
            <MenuDesignerBlock settings={settings} onSave={saveSettings} />
          </div>

          <div className={activeTab === 'system' ? 'space-y-6' : 'hidden'}>
            <AdminFirebaseConfigBlock />
            <AdminMapboxLimitsBlock settings={settings} user={user} />

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

            {/* Old Constructor Block Placeholder (To be replaced) */}
            <div className="hidden">

                {/* Main Constructor Area */}
                {(() => {
                  const currentStructure = settings?.menuStructure || [
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
                  ];

                  const AVAILABLE_MODULES = [
                    { key: 'dashboard', label: 'Главная', icon: LayoutDashboard },
                    { key: 'dohod', label: 'Калькуляция', icon: Calculator },
                    { key: 'salary', label: 'Зарплата Водителей', icon: Wallet },
                    { key: 'planDohod', label: 'План Дохода', icon: TrendingUp },
                    { key: 'planZagruzok', label: 'План Загрузок', icon: FileSpreadsheet },
                    { key: 'currentPlanning', label: 'Текущее планирование', icon: Map },
                    { key: 'baza', label: 'Учет выезда', icon: Truck },
                    { key: 'vehicleDriverData', label: 'Авто и Водители', icon: FileText },
                    { key: 'analysis', label: 'Анализ', icon: TrendingUp },
                    { key: 'dozvola', label: 'Учет Дозволов', icon: FileText },
                    { key: 'documents', label: 'Документы', icon: FileText },
                    { key: 'disposition', label: 'Диспозиция', icon: Map },
                    { key: 'settings', label: 'Справочники', icon: Settings },
                    { key: 'admin', label: 'Администрирование', icon: ShieldAlert }
                  ];

                  const getModuleIcon = (key: string) => {
                    const found = AVAILABLE_MODULES.find(m => m.key === key);
                    if (!found) return <Settings size={13} className="text-slate-400" />;
                    const IconComp = found.icon;
                    return <IconComp size={13} className="text-slate-500" />;
                  };

                  const moveGroup = (idx: number, dir: 'up' | 'down') => {
                    const list = [...currentStructure];
                    if (dir === 'up' && idx > 0) {
                      const temp = list[idx - 1];
                      list[idx - 1] = list[idx];
                      list[idx] = temp;
                    } else if (dir === 'down' && idx < list.length - 1) {
                      const temp = list[idx + 1];
                      list[idx + 1] = list[idx];
                      list[idx] = temp;
                    }
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const deleteGroup = (id: string) => {
                    const list = currentStructure.filter(g => g.id !== id);
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const renameGroup = (id: string, label: string) => {
                    const list = currentStructure.map(g => g.id === id ? { ...g, label } : g);
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const toggleGroupType = (id: string) => {
                    const list = currentStructure.map(g => {
                      if (g.id === id) {
                        const isDropdown = !g.isDropdown;
                        return {
                          ...g,
                          isDropdown,
                          subtabKeys: isDropdown ? (g.subtabKeys || [g.singleModuleKey || 'dashboard']) : undefined,
                          singleModuleKey: !isDropdown ? (g.subtabKeys?.[0] || 'dashboard') : undefined
                        };
                      }
                      return g;
                    });
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const setStandaloneKey = (id: string, singleModuleKey: string) => {
                    const list = currentStructure.map(g => g.id === id ? { ...g, singleModuleKey } : g);
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const updateSubtabLabel = (groupId: string, subKey: string, customLabel: string) => {
                    const list = currentStructure.map(g => {
                      if (g.id === groupId) {
                        const customLabels = { ...(g.customLabels || {}), [subKey]: customLabel };
                        return { ...g, customLabels };
                      }
                      return g;
                    });
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const addSubtab = (groupId: string, subKey: string) => {
                    if (!subKey) return;
                    const list = currentStructure.map(g => {
                      if (g.id === groupId) {
                        const subtabKeys = [...(g.subtabKeys || [])];
                        if (!subtabKeys.includes(subKey)) {
                          subtabKeys.push(subKey);
                        }
                        return { ...g, subtabKeys };
                      }
                      return g;
                    });
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const deleteSubtab = (groupId: string, subKey: string) => {
                    const list = currentStructure.map(g => {
                      if (g.id === groupId) {
                        const subtabKeys = (g.subtabKeys || []).filter(k => k !== subKey);
                        return { ...g, subtabKeys };
                      }
                      return g;
                    });
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const moveSubtab = (groupId: string, subIdx: number, dir: 'up' | 'down') => {
                    const list = currentStructure.map(g => {
                      if (g.id === groupId && g.subtabKeys) {
                        const subtabKeys = [...g.subtabKeys];
                        if (dir === 'up' && subIdx > 0) {
                          const temp = subtabKeys[subIdx - 1];
                          subtabKeys[subIdx - 1] = subtabKeys[subIdx];
                          subtabKeys[subIdx] = temp;
                        } else if (dir === 'down' && subIdx < subtabKeys.length - 1) {
                          const temp = subtabKeys[subIdx + 1];
                          subtabKeys[subIdx + 1] = subtabKeys[subIdx];
                          subtabKeys[subIdx] = temp;
                        }
                        return { ...g, subtabKeys };
                      }
                      return g;
                    });
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const addGroup = () => {
                    const newGroup = {
                      id: 'g_' + Date.now(),
                      label: 'Новая группа',
                      isDropdown: true,
                      subtabKeys: []
                    };
                    saveSettings({ ...settings!, menuStructure: [...currentStructure, newGroup] });
                  };

                  const addStandaloneLink = (moduleKey = 'dashboard') => {
                    const mInfo = AVAILABLE_MODULES.find(m => m.key === moduleKey) || AVAILABLE_MODULES[0];
                    const newGroup = {
                      id: 'g_' + Date.now(),
                      label: mInfo.label,
                      isDropdown: false,
                      singleModuleKey: moduleKey
                    };
                    saveSettings({ ...settings!, menuStructure: [...currentStructure, newGroup] });
                  };

                  // INTERACTIVE MOVE HELPERS:
                  const moveStandaloneToGroup = (id: string, targetGroupId: string) => {
                    const sourceGroup = currentStructure.find(g => g.id === id);
                    if (!sourceGroup || !sourceGroup.singleModuleKey) return;
                    const subKey = sourceGroup.singleModuleKey;

                    const list = currentStructure.filter(g => g.id !== id).map(g => {
                      if (g.id === targetGroupId) {
                        const subtabKeys = [...(g.subtabKeys || [])];
                        if (!subtabKeys.includes(subKey)) {
                          subtabKeys.push(subKey);
                        }
                        return { ...g, subtabKeys };
                      }
                      return g;
                    });
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const extractSubtabToStandalone = (groupId: string, subKey: string) => {
                    const targetGroup = currentStructure.find(g => g.id === groupId);
                    const customLabel = targetGroup?.customLabels?.[subKey] || AVAILABLE_MODULES.find(m => m.key === subKey)?.label || subKey;
                    
                    const newGroup = {
                      id: 'g_' + Date.now(),
                      label: customLabel,
                      isDropdown: false,
                      singleModuleKey: subKey
                    };

                    const list = currentStructure.map(g => {
                      if (g.id === groupId) {
                        const subtabKeys = (g.subtabKeys || []).filter(k => k !== subKey);
                        return { ...g, subtabKeys };
                      }
                      return g;
                    });

                    list.push(newGroup);
                    saveSettings({ ...settings!, menuStructure: list });
                  };

                  const moveSubtabToGroup = (sourceGroupId: string, subKey: string, targetGroupId: string) => {
                    const list = currentStructure.map(g => {
                      if (g.id === sourceGroupId) {
                        const subtabKeys = (g.subtabKeys || []).filter(k => k !== subKey);
                        return { ...g, subtabKeys };
                      }
                      return g;
                    });

                    const updatedList = list.map(g => {
                      if (g.id === targetGroupId) {
                        const subtabKeys = [...(g.subtabKeys || [])];
                        if (!subtabKeys.includes(subKey)) {
                          subtabKeys.push(subKey);
                        }
                        return { ...g, subtabKeys };
                      }
                      return g;
                    });

                    saveSettings({ ...settings!, menuStructure: updatedList });
                  };

                  const restoreDefaultMenu = async () => {
                    if (await showConfirm("Вы уверены, что хотите сбросить структуру меню к стандартному виду? Все текущие группы и переименования будут сброшены.")) {
                      const defaults = [
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
                      ];
                      saveSettings({ ...settings!, menuStructure: defaults });
                    }
                  };

                  // UTILS to find where modules are:
                  const getModuleUtilization = (key: string) => {
                    for (const group of currentStructure) {
                      if (group.isDropdown && group.subtabKeys?.includes(key)) {
                        return { state: 'grouped', groupLabel: group.label, groupId: group.id };
                      }
                      if (!group.isDropdown && group.singleModuleKey === key) {
                        return { state: 'standalone', groupLabel: group.label, groupId: group.id };
                      }
                    }
                    return { state: 'unused' };
                  };

                  const dropdownGroups = currentStructure.filter(g => g.isDropdown);

                  return (
                    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 font-sans">
                      
                      {/* Left: Interactive Menu list */}
                      <div className="xl:col-span-8 space-y-4">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-black uppercase text-slate-400 tracking-wider">
                            Структура Активного Меню ({currentStructure.length})
                          </span>
                        </div>

                        <div className="space-y-3">
                          {currentStructure.map((group, idx) => {
                            return (
                              <div 
                                key={group.id} 
                                className={`p-4 rounded-2xl border transition-all duration-300 ${
                                  group.isDropdown 
                                    ? 'bg-gradient-to-br from-lime-50/40 to-white border-lime-200/60 shadow-[0_4px_20px_rgba(132,204,22,0.02)]' 
                                    : 'bg-white/60 backdrop-blur-md border-white/40 shadow-[0_4px_16px_rgba(0,0,0,0.01)]'
                                }`}
                              >
                                {/* Card Header Area */}
                                <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-dashed border-white/40">
                                  {/* Left: Drag Grip, Rename, Icon */}
                                  <div className="flex items-center gap-2.5 flex-1 min-w-0">
                                    <div className="text-slate-300 hover:text-slate-400 cursor-grab shrink-0">
                                      <GripVertical size={14} />
                                    </div>
                                    
                                    <div className={`p-1.5 rounded-lg shrink-0 ${group.isDropdown ? 'bg-lime-100 text-lime-700' : 'bg-white/50 backdrop-blur-md shadow-inner text-slate-700'}`}>
                                      {group.isDropdown ? <Folder size={14} /> : <Link2 size={14} />}
                                    </div>

                                    <div className="flex-1 min-w-0">
                                      <input
                                        type="text"
                                        value={group.label}
                                        onChange={(e) => renameGroup(group.id, e.target.value)}
                                        className="w-full bg-transparent border-b border-transparent hover:border-white/40 focus:border-[#3765F6] text-[#3765F6] font-extrabold text-slate-800 text-xs px-1 py-0.5 outline-none transition"
                                        placeholder="Название вкладки"
                                      />
                                    </div>
                                  </div>

                                  {/* Center: Mode Segmented Toggle */}
                                  <div className="flex items-center gap-3 shrink-0">
                                    <div className="flex bg-white/40 backdrop-blur-md shadow-inner p-0.5 rounded-xl border border-white/40">
                                      <button
                                        onClick={() => { if (!group.isDropdown) toggleGroupType(group.id); }}
                                        className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                                          group.isDropdown
                                            ? 'bg-white/60 backdrop-blur-md text-lime-700 shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                      >
                                        🗀 Группа
                                      </button>
                                      <button
                                        onClick={() => { if (group.isDropdown) toggleGroupType(group.id); }}
                                        className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                                          !group.isDropdown
                                            ? 'bg-white/60 backdrop-blur-md text-slate-900 shadow-xs'
                                            : 'text-slate-500 hover:text-slate-800'
                                        }`}
                                      >
                                        🡥 Ссылка
                                      </button>
                                    </div>

                                    {/* Right: Actions */}
                                    <div className="flex items-center gap-1 border-l border-white/40 pl-3">
                                      <button 
                                        onClick={() => moveGroup(idx, 'up')} 
                                        disabled={idx === 0} 
                                        className="p-1 hover:bg-white/50 backdrop-blur-md border border-white/50 shadow-inner/30 transition rounded-lg text-slate-400 disabled:opacity-30 cursor-pointer"
                                        title="Вверх"
                                      >
                                        <ArrowUp size={13}/>
                                      </button>
                                      <button 
                                        onClick={() => moveGroup(idx, 'down')} 
                                        disabled={idx === currentStructure.length - 1} 
                                        className="p-1 hover:bg-white/50 backdrop-blur-md border border-white/50 shadow-inner/30 transition rounded-lg text-slate-400 disabled:opacity-30 cursor-pointer"
                                        title="Вниз"
                                      >
                                        <ArrowDown size={13}/>
                                      </button>
                                      <button 
                                        onClick={() => deleteGroup(group.id)} 
                                        className="p-1 hover:bg-rose-50 text-rose-500 rounded-lg cursor-pointer"
                                        title="Удалить раздел"
                                      >
                                        <Trash2 size={13}/>
                                      </button>
                                    </div>
                                  </div>
                                </div>

                                {/* Card Body Configuration */}
                                <div className="mt-3">
                                  {group.isDropdown ? (
                                    <div className="space-y-2">
                                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider block">
                                        Подвкладки в этой группе:
                                      </span>

                                      <div className="flex flex-wrap gap-2 items-center bg-white/30 backdrop-blur-sm p-2.5 rounded-2xl border border-white/40">
                                        {(!group.subtabKeys || group.subtabKeys.length === 0) ? (
                                          <span className="text-[10px] text-slate-400 font-medium italic py-1 pl-1">
                                            Нет подвкладок. Выберите страницу справа или добавьте ниже.
                                          </span>
                                        ) : (
                                          group.subtabKeys.map((subKey, subIdx) => {
                                            const currentLabel = group.customLabels?.[subKey] || AVAILABLE_MODULES.find(m => m.key === subKey)?.label || subKey;
                                            return (
                                              <div 
                                                key={subKey} 
                                                className="flex items-center gap-1.5 bg-white/50 backdrop-blur-md border border-white/50 shadow-inner hover:border-white/40 pl-2 pr-1.5 py-1 rounded-xl text-xs shadow-xs transition shrink-0"
                                              >
                                                <span className="p-0.5 rounded bg-white/40 backdrop-blur-sm shrink-0">
                                                  {getModuleIcon(subKey)}
                                                </span>
                                                <input
                                                  type="text"
                                                  value={currentLabel}
                                                  onChange={(e) => updateSubtabLabel(group.id, subKey, e.target.value)}
                                                  className="w-24 bg-transparent border-0 font-extrabold text-slate-700 focus:ring-0 focus:outline-none text-[11px] px-0.5"
                                                  title="Кликните для переименования подвкладки"
                                                />
                                                <div className="flex items-center gap-0.5 border-l border-white/40 pl-1.5">
                                                  <button 
                                                    onClick={() => moveSubtab(group.id, subIdx, 'up')} 
                                                    disabled={subIdx === 0} 
                                                    className="p-0.5 hover:bg-white/50 text-slate-400 disabled:opacity-20 rounded"
                                                    title="Влево"
                                                  >
                                                    <ChevronLeft size={11} />
                                                  </button>
                                                  <button 
                                                    onClick={() => moveSubtab(group.id, subIdx, 'down')} 
                                                    disabled={subIdx === (group.subtabKeys || []).length - 1} 
                                                    className="p-0.5 hover:bg-white/50 text-slate-400 disabled:opacity-20 rounded"
                                                    title="Вправо"
                                                  >
                                                    <ChevronRight size={11} />
                                                  </button>
                                                  <button 
                                                    onClick={() => deleteSubtab(group.id, subKey)} 
                                                    className="p-0.5 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded"
                                                    title="Удалить"
                                                  >
                                                    <X size={11} />
                                                  </button>
                                                </div>
                                              </div>
                                            );
                                          })
                                        )}

                                        {/* Quick select append button */}
                                        <select
                                          onChange={(e) => {
                                            if (e.target.value) {
                                              addSubtab(group.id, e.target.value);
                                              e.target.value = '';
                                            }
                                          }}
                                          className="bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/50 rounded-xl px-2.5 py-1 text-[10px] font-black outline-none cursor-pointer transition select-none"
                                          defaultValue=""
                                        >
                                          <option value="" disabled>+ Добавить подвкладку...</option>
                                          {AVAILABLE_MODULES.filter(m => !(group.subtabKeys || []).includes(m.key)).map(m => (
                                            <option key={m.key} value={m.key}>{m.label}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="flex flex-wrap items-center gap-3 bg-white/30 backdrop-blur-sm p-2.5 rounded-2xl border border-white/40">
                                      <span className="text-[9px] uppercase font-bold text-slate-400 tracking-wider">
                                        Направление ссылки:
                                      </span>
                                      
                                      <div className="flex items-center gap-2">
                                        <div className="p-1 rounded bg-white/60 backdrop-blur-md border border-white/40 shrink-0">
                                          {getModuleIcon(group.singleModuleKey || 'dashboard')}
                                        </div>
                                        <select
                                          value={group.singleModuleKey || 'dashboard'}
                                          onChange={(e) => setStandaloneKey(group.id, e.target.value)}
                                          className="bg-white/50 backdrop-blur-md border border-white/50 shadow-inner rounded-xl px-3 py-1 text-xs font-bold text-slate-700 outline-none cursor-pointer hover:bg-white/40"
                                        >
                                          {AVAILABLE_MODULES.map(m => (
                                            <option key={m.key} value={m.key}>{m.label}</option>
                                          ))}
                                        </select>
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Right: Quick Tools & Status utilization dashboard */}
                      <div className="xl:col-span-4 space-y-4">
                        <span className="text-xs font-black uppercase text-slate-400 tracking-wider block">
                          Панель управления
                        </span>

                        <div className="p-5 rounded-2xl bg-white/50 backdrop-blur-md border border-white/50 shadow-inner/60 space-y-4">
                          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
                            <Sparkles size={13} className="text-yellow-500" />
                            Быстрое добавление
                          </h3>

                          <div className="grid grid-cols-1 gap-2.5">
                            <button
                              onClick={addGroup}
                              className="flex items-center justify-center gap-2 py-3 bg-lime-500 hover:bg-lime-600 text-white rounded-xl text-xs font-black uppercase tracking-widest transition shadow-sm hover:shadow cursor-pointer"
                            >
                              <FolderPlus size={14} />
                              Создать Группу
                            </button>
                            <button
                              onClick={() => addStandaloneLink('dashboard')}
                              className="flex items-center justify-center gap-2 py-3 bg-[#3765F6] hover:bg-[#2555E5] text-white shadow-sm rounded-xl text-xs font-black uppercase tracking-widest transition shadow-sm hover:shadow cursor-pointer"
                            >
                              <Plus size={14} />
                              Создать Ссылку
                            </button>
                            
                            <button
                              onClick={restoreDefaultMenu}
                              className="flex items-center justify-center gap-2 py-2.5 bg-white/60 backdrop-blur-md hover:bg-white/50 border border-white/40 text-slate-600 rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer"
                              title="Полностью восстановить исходную структуру"
                            >
                              <RotateCcw size={12} className="text-slate-500" />
                              Сбросить к стандарту
                            </button>
                          </div>
                        </div>

                        {/* Usage map of pages */}
                        <div className="p-5 rounded-2xl bg-white/50 backdrop-blur-md border border-white/50 shadow-inner/60 space-y-3">
                          <div>
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
                              Доступность страниц
                            </h3>
                            <p className="text-[10px] text-slate-400 font-medium">
                              Где находится каждая страница в вашем меню.
                            </p>
                          </div>

                          <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                            {AVAILABLE_MODULES.map(module => {
                              const util = getModuleUtilization(module.key);
                              return (
                                <div key={module.key} className="p-2 bg-white/30 backdrop-blur-sm rounded-xl border border-white/40 flex items-center justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <div className="p-1 rounded bg-white">
                                      {getModuleIcon(module.key)}
                                    </div>
                                    <span className="text-[11px] font-bold text-slate-700 truncate">{module.label}</span>
                                  </div>

                                  <div className="shrink-0 flex items-center gap-1.5">
                                    {util.state === 'unused' ? (
                                      <span className="text-[8px] bg-white/50 backdrop-blur-md shadow-inner text-slate-600 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                        Скрыт
                                      </span>
                                    ) : util.state === 'standalone' ? (
                                      <span className="text-[8px] bg-sky-100 text-sky-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                        В корне
                                      </span>
                                    ) : (
                                      <span className="text-[8px] bg-lime-100 text-lime-800 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider truncate max-w-[80px]" title={`В группе: ${util.groupLabel}`}>
                                        в: {util.groupLabel}
                                      </span>
                                    )}

                                    {/* Quick actions for hidden pages */}
                                    {util.state === 'unused' && (
                                      <select
                                        onChange={(e) => {
                                          if (e.target.value === 'main') {
                                            addStandaloneLink(module.key);
                                          } else if (e.target.value) {
                                            addSubtab(e.target.value, module.key);
                                          }
                                          e.target.value = '';
                                        }}
                                        className="text-[10px] font-black bg-white/50 backdrop-blur-md border border-white/50 shadow-inner hover:border-white/40 rounded-lg px-1.5 py-0.5 outline-none text-slate-600 cursor-pointer"
                                        defaultValue=""
                                      >
                                        <option value="" disabled>+</option>
                                        <option value="main">В меню</option>
                                        {dropdownGroups.map(dg => (
                                          <option key={dg.id} value={dg.id}>В г.: {dg.label}</option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                      </div>
                    </div>
                  );
                })()}
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

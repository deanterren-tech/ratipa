import {useState, useEffect} from 'react'
import {motion, AnimatePresence} from 'motion/react'
import {AppSettings, MenuStructureGroup} from '../../types'
import {useToast} from '../ToastProvider'
import {useDialog} from '../DialogProvider'
import { 
  FolderPlus, Plus, RotateCcw, Sparkles, Check, X, Folder, Link2, 
  ArrowUp, ArrowDown, Trash2, ChevronLeft, ChevronRight, GripVertical, AlertCircle, Save, Undo
} from 'lucide-react';
import { 
  LayoutDashboard, Calculator, Wallet, TrendingUp, FileSpreadsheet, Map, Truck, FileText, Settings, ShieldAlert 
} from 'lucide-react';

interface MenuDesignerBlockProps {
  settings: AppSettings | null;
  onSave: (newSettings: AppSettings) => void;
}

const AVAILABLE_MODULES = [
  { key: 'dashboard', label: 'Главная', icon: LayoutDashboard },
  { key: 'dohod', label: 'Калькуляция', icon: Calculator },
  { key: 'salary', label: 'Зарплата Водителей', icon: Wallet },
  { key: 'planDohod', label: 'План Дохода', icon: TrendingUp },
  { key: 'planZagruzok', label: 'План Загрузок', icon: FileSpreadsheet },
  { key: 'currentPlanning', label: 'Текущее планирование', icon: Map },
  { key: 'baza', label: 'Учет выезда', icon: Truck },
  { key: 'vehicleDriverData', label: 'Авто и Водители', icon: FileText },
  { key: 'dozvola', label: 'Учет Дозволов', icon: FileText },
  { key: 'documents', label: 'Документы', icon: FileText },
  { key: 'disposition', label: 'Диспозиция', icon: Map },
  { key: 'settings', label: 'Справочники', icon: Settings },
  { key: 'admin', label: 'Администрирование', icon: ShieldAlert }
];

const DEFAULT_STRUCTURE = [
  { id: 'g_home', label: 'Главная', isDropdown: false, singleModuleKey: 'dashboard' },
  { id: 'g_planning', label: 'Планирование', isDropdown: true, subtabKeys: ['planDohod', 'currentPlanning', 'dohod', 'planZagruzok'] },
  { id: 'g_ops', label: 'Операции', isDropdown: true, subtabKeys: ['disposition', 'baza', 'documents', 'vehicleDriverData', 'dozvola'] },
  { id: 'g_report', label: 'Отчетность', isDropdown: true, subtabKeys: ['salary'] },
  { id: 'g_settings', label: 'Настройки', isDropdown: true, subtabKeys: ['settings', 'admin'] }
];

export default function MenuDesignerBlock({ settings, onSave }: MenuDesignerBlockProps) {
  const { toast } = useToast();
  const { showConfirm } = useDialog();

  const [draft, setDraft] = useState<MenuStructureGroup[]>([]);

  // Sync draft from settings initially
  useEffect(() => {
    if (settings?.menuStructure) {
      setDraft(JSON.parse(JSON.stringify(settings.menuStructure)));
    } else {
      setDraft(JSON.parse(JSON.stringify(DEFAULT_STRUCTURE)));
    }
  }, [settings?.menuStructure]);

  // Check if draft has unsaved changes compared to actual settings
  const hasChanges = JSON.stringify(draft) !== JSON.stringify(settings?.menuStructure || DEFAULT_STRUCTURE);

  const getModuleIcon = (key: string) => {
    const found = AVAILABLE_MODULES.find(m => m.key === key);
    if (!found) return <Settings size={14} className="text-slate-400" />;
    const IconComp = found.icon;
    return <IconComp size={14} className="text-indigo-600" />;
  };

  const saveToSystem = () => {
    if (!settings) return;
    onSave({
      ...settings,
      menuStructure: draft
    });
    toast('Конфигурация меню успешно сохранена и применена к системе!', 'success');
  };

  const discardChanges = () => {
    if (settings?.menuStructure) {
      setDraft(JSON.parse(JSON.stringify(settings.menuStructure)));
    } else {
      setDraft(JSON.parse(JSON.stringify(DEFAULT_STRUCTURE)));
    }
    toast('Черновик успешно сброшен к последней сохраненной версии', 'info');
  };

  const restoreToStandardDefaults = async () => {
    const confirm = await showConfirm(
      'Вы уверены, что хотите сбросить структуру меню к стандартному виду? Это заменит ваш текущий черновик стандартной конфигурацией. Для применения в систему всё равно потребуется нажать кнопку «Сохранить».'
    );
    if (confirm) {
      setDraft(JSON.parse(JSON.stringify(DEFAULT_STRUCTURE)));
      toast('Черновик сброшен к стандартному шаблону. Нажмите «Сохранить», чтобы применить.', 'warning');
    }
  };

  // Group operations
  const moveGroup = (idx: number, dir: 'up' | 'down') => {
    const list = [...draft];
    if (dir === 'up' && idx > 0) {
      const temp = list[idx - 1];
      list[idx - 1] = list[idx];
      list[idx] = temp;
    } else if (dir === 'down' && idx < list.length - 1) {
      const temp = list[idx + 1];
      list[idx + 1] = list[idx];
      list[idx] = temp;
    }
    setDraft(list);
  };

  const deleteGroup = (id: string) => {
    setDraft(draft.filter(g => g.id !== id));
  };

  const renameGroup = (id: string, label: string) => {
    setDraft(draft.map(g => g.id === id ? { ...g, label } : g));
  };

  const toggleGroupType = (id: string) => {
    setDraft(draft.map(g => {
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
    }));
  };

  const setStandaloneKey = (id: string, singleModuleKey: string) => {
    setDraft(draft.map(g => g.id === id ? { ...g, singleModuleKey } : g));
  };

  // Subtab operations
  const updateSubtabLabel = (groupId: string, subKey: string, customLabel: string) => {
    setDraft(draft.map(g => {
      if (g.id === groupId) {
        const customLabels = { ...(g.customLabels || {}), [subKey]: customLabel };
        return { ...g, customLabels };
      }
      return g;
    }));
  };

  const addSubtab = (groupId: string, subKey: string) => {
    if (!subKey) return;
    setDraft(draft.map(g => {
      if (g.id === groupId) {
        const subtabKeys = [...(g.subtabKeys || [])];
        if (!subtabKeys.includes(subKey)) {
          subtabKeys.push(subKey);
        }
        return { ...g, subtabKeys };
      }
      return g;
    }));
  };

  const deleteSubtab = (groupId: string, subKey: string) => {
    setDraft(draft.map(g => {
      if (g.id === groupId) {
        const subtabKeys = (g.subtabKeys || []).filter(k => k !== subKey);
        return { ...g, subtabKeys };
      }
      return g;
    }));
  };

  const moveSubtab = (groupId: string, subIdx: number, dir: 'up' | 'down') => {
    setDraft(draft.map(g => {
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
    }));
  };

  const addGroup = () => {
    const newGroup: MenuStructureGroup = {
      id: 'g_' + Date.now(),
      label: 'Новая группа',
      isDropdown: true,
      subtabKeys: []
    };
    setDraft([...draft, newGroup]);
  };

  const addStandaloneLink = (moduleKey = 'dashboard') => {
    const mInfo = AVAILABLE_MODULES.find(m => m.key === moduleKey) || AVAILABLE_MODULES[0];
    const newGroup: MenuStructureGroup = {
      id: 'g_' + Date.now(),
      label: mInfo.label,
      isDropdown: false,
      singleModuleKey: moduleKey
    };
    setDraft([...draft, newGroup]);
  };

  const getModuleUtilization = (key: string) => {
    for (const group of draft) {
      if (group.isDropdown && group.subtabKeys?.includes(key)) {
        return { state: 'grouped', groupLabel: group.label, groupId: group.id };
      }
      if (!group.isDropdown && group.singleModuleKey === key) {
        return { state: 'standalone', groupLabel: group.label, groupId: group.id };
      }
    }
    return { state: 'unused' };
  };

  const dropdownGroups = draft.filter(g => g.isDropdown);

  return (
    <div className="w-full space-y-6">
      
      {/* Draft Status & Alert Panel */}
      <AnimatePresence mode="wait">
        {hasChanges && (
          <motion.div 
            initial={{ opacity: 0, y: -15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 backdrop-blur-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm"
          >
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-xl bg-amber-500/20 flex items-center justify-center text-amber-700 shrink-0">
                <AlertCircle size={20} className="animate-bounce" />
              </div>
              <div>
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-amber-800">Черновик содержит изменения</h4>
                <p className="text-[10px] text-amber-700 font-semibold mt-0.5 leading-normal">
                  Вы изменили структуру меню. Эти настройки не повлияют на навигацию других пользователей, пока вы не примените их на сервере.
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-2 w-full md:w-auto shrink-0">
              <button
                onClick={discardChanges}
                className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-white/75 hover:bg-white border border-amber-200 text-amber-900 transition-all active:scale-[0.98] cursor-pointer"
              >
                <Undo size={12} />
                Отменить
              </button>
              <button
                onClick={saveToSystem}
                className="flex-1 md:flex-initial flex items-center justify-center gap-1.5 px-4.5 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest bg-emerald-600 hover:bg-emerald-700 text-white shadow-md border border-emerald-750 transition-all active:scale-[0.98] cursor-pointer"
              >
                <Save size={12} />
                Применить изменения
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Editor Controls Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        
        {/* Left Side: Dynamic list of current active groups */}
        <div className="xl:col-span-8 space-y-4">
          <div className="flex justify-between items-center bg-white/40 border border-white/50 backdrop-blur-sm rounded-2xl p-4 shadow-xs">
            <div>
              <span className="text-[9px] font-black uppercase text-indigo-600 font-mono tracking-widest block">STRUCTURE PLANNER</span>
              <h3 className="text-xs font-black uppercase text-slate-800 mt-1 tracking-wider">
                Структура Активного Меню ({draft.length} разделов)
              </h3>
            </div>
            <div className="flex items-center gap-2">
              {!hasChanges && (
                <span className="text-[8px] font-mono bg-indigo-600/10 text-indigo-700 font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full border border-indigo-550/10 flex items-center gap-1">
                  <span className="h-1.5 w-1.5 bg-indigo-600 rounded-full" />
                  Актуально
                </span>
              )}
            </div>
          </div>

          <div className="space-y-3.5">
            <AnimatePresence initial={false}>
              {draft.map((group, idx) => (
                <motion.div 
                  key={group.id} 
                  layoutId={`menu-group-${group.id}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  transition={{ duration: 0.18 }}
                  className={`p-5 rounded-[1.5rem] border transition-all duration-300 ${
                    group.isDropdown 
                      ? 'bg-gradient-to-br from-indigo-500/[0.04] to-white/70 border-indigo-200/50 shadow-sm' 
                      : 'bg-white/55 backdrop-blur-md border-white/45 shadow-sm'
                  }`}
                >
                  {/* Card Header */}
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-4 border-b border-dashed border-slate-900/10">
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div className="text-slate-300 p-1 rounded hover:bg-slate-900/5 cursor-grab shrink-0">
                        <GripVertical size={14} />
                      </div>
                      
                      <div className={`p-2 rounded-xl shrink-0 ${group.isDropdown ? 'bg-indigo-600/10 text-indigo-700' : 'bg-slate-900/5 text-slate-700'}`}>
                        {group.isDropdown ? <Folder size={15} /> : <Link2 size={15} />}
                      </div>

                      <div className="flex-1 min-w-0">
                        <input
                          type="text"
                          value={group.label}
                          onChange={(e) => renameGroup(group.id, e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-slate-300/60 focus:border-indigo-500 font-extrabold text-slate-800 text-xs px-1 py-0.5 outline-none transition"
                          placeholder="Название вкладки"
                        />
                      </div>
                    </div>

                    {/* Right Hand Side Header Controls */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex bg-slate-900/5 p-0.5 rounded-xl border border-white/30">
                        <button
                          onClick={() => { if (!group.isDropdown) toggleGroupType(group.id); }}
                          className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                            group.isDropdown
                              ? 'bg-white text-indigo-700 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          🗀 Группа
                        </button>
                        <button
                          onClick={() => { if (group.isDropdown) toggleGroupType(group.id); }}
                          className={`px-3 py-1 text-[9px] font-black uppercase tracking-wider rounded-lg transition-all cursor-pointer ${
                            !group.isDropdown
                              ? 'bg-white text-indigo-700 shadow-xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          🡥 Ссылка
                        </button>
                      </div>

                      <div className="flex items-center gap-1 border-l border-slate-900/10 pl-3">
                        <button 
                          onClick={() => moveGroup(idx, 'up')} 
                          disabled={idx === 0} 
                          className="p-1.5 hover:bg-white/60 border border-white/40 shadow-xs transition rounded-xl text-slate-400 disabled:opacity-20 cursor-pointer"
                          title="Переместить вверх"
                        >
                          <ArrowUp size={13}/>
                        </button>
                        <button 
                          onClick={() => moveGroup(idx, 'down')} 
                          disabled={idx === draft.length - 1} 
                          className="p-1.5 hover:bg-white/60 border border-white/40 shadow-xs transition rounded-xl text-slate-400 disabled:opacity-20 cursor-pointer"
                          title="Переместить вниз"
                        >
                          <ArrowDown size={13}/>
                        </button>
                        <button 
                          onClick={() => deleteGroup(group.id)} 
                          className="p-1.5 hover:bg-rose-50 text-rose-500 hover:border-rose-100 border border-transparent rounded-xl cursor-pointer"
                          title="Удалить этот раздел"
                        >
                          <Trash2 size={13}/>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Card Body content */}
                  <div className="mt-3.5">
                    {group.isDropdown ? (
                      <div className="space-y-2">
                        <span className="text-[9px] uppercase font-black text-slate-400 tracking-widest block font-mono">
                          ПОДВКЛАДКИ В ГРУППЕ:
                        </span>

                        <div className="flex flex-wrap gap-2.5 items-center bg-white/35 backdrop-blur-sm p-3 rounded-2xl border border-white/45">
                          {(!group.subtabKeys || group.subtabKeys.length === 0) ? (
                            <span className="text-[10px] text-slate-400 font-medium italic py-1 pl-1">
                              Подвкладки отсутствуют. Выберите из списка справа или добавьте ниже.
                            </span>
                          ) : (
                            group.subtabKeys.map((subKey, subIdx) => {
                              const currentLabel = group.customLabels?.[subKey] || AVAILABLE_MODULES.find(m => m.key === subKey)?.label || subKey;
                              return (
                                <div 
                                  key={subKey} 
                                  className="flex items-center gap-1.5 bg-white/55 border border-white/50 shadow-xs pl-2.5 pr-2 py-1.5 rounded-xl text-xs transition shrink-0"
                                >
                                  <span className="p-1 rounded-lg bg-indigo-600/5 shrink-0 flex items-center justify-center">
                                    {getModuleIcon(subKey)}
                                  </span>
                                  <input
                                    type="text"
                                    value={currentLabel}
                                    onChange={(e) => updateSubtabLabel(group.id, subKey, e.target.value)}
                                    className="w-24 bg-transparent border-0 font-extrabold text-slate-700 focus:ring-0 focus:outline-none text-[11px] px-0.5"
                                    title="Нажмите для переименования"
                                  />
                                  <div className="flex items-center gap-0.5 border-l border-slate-900/10 pl-2">
                                    <button 
                                      onClick={() => moveSubtab(group.id, subIdx, 'up')} 
                                      disabled={subIdx === 0} 
                                      className="p-0.5 hover:bg-slate-900/5 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded"
                                      title="Влево"
                                    >
                                      <ChevronLeft size={12} />
                                    </button>
                                    <button 
                                      onClick={() => moveSubtab(group.id, subIdx, 'down')} 
                                      disabled={subIdx === (group.subtabKeys || []).length - 1} 
                                      className="p-0.5 hover:bg-slate-900/5 text-slate-400 hover:text-slate-700 disabled:opacity-20 rounded"
                                      title="Вправо"
                                    >
                                      <ChevronRight size={12} />
                                    </button>
                                    <button 
                                      onClick={() => deleteSubtab(group.id, subKey)} 
                                      className="p-0.5 hover:bg-rose-50 text-slate-400 hover:text-rose-500 rounded"
                                      title="Исключить"
                                    >
                                      <X size={12} />
                                    </button>
                                  </div>
                                </div>
                              );
                            })
                          )}

                          {/* Inline append dropdown */}
                          <select
                            onChange={(e) => {
                              if (e.target.value) {
                                addSubtab(group.id, e.target.value);
                                e.target.value = '';
                              }
                            }}
                            className="bg-indigo-600/10 hover:bg-indigo-600/15 text-indigo-700 border border-indigo-500/10 rounded-xl px-3 py-1.5 text-[10px] font-black outline-none cursor-pointer transition select-none"
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
                      <div className="flex flex-wrap items-center gap-3 bg-white/35 backdrop-blur-sm p-3 rounded-2xl border border-white/45">
                        <span className="text-[9px] uppercase font-black text-slate-400 tracking-widest font-mono">
                          НАПРАВЛЕНИЕ ССЫЛКИ:
                        </span>
                        
                        <div className="flex items-center gap-2">
                          <div className="p-1.5 rounded-lg bg-indigo-600/5 border border-white/40 shrink-0">
                            {getModuleIcon(group.singleModuleKey || 'dashboard')}
                          </div>
                          <select
                            value={group.singleModuleKey || 'dashboard'}
                            onChange={(e) => setStandaloneKey(group.id, e.target.value)}
                            className="bg-white/60 border border-white/45 shadow-inner rounded-xl px-3 py-1.5 text-xs font-bold text-slate-700 outline-none cursor-pointer hover:bg-white transition"
                          >
                            {AVAILABLE_MODULES.map(m => (
                              <option key={m.key} value={m.key}>{m.label}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Right Side: Quick Tools & Navigation Overview */}
        <div className="xl:col-span-4 space-y-5">
          <div className="bg-white/40 border border-white/50 backdrop-blur-sm rounded-2xl p-4 shadow-xs">
            <span className="text-[9px] font-black uppercase text-indigo-600 font-mono tracking-widest block">CONTROL DESK</span>
            <h3 className="text-xs font-black uppercase text-slate-800 mt-1 tracking-wider">
              Панель управления
            </h3>
          </div>

          {/* Quick Add Action Card */}
          <div className="p-5 rounded-[1.5rem] bg-white/55 backdrop-blur-md border border-white/45 shadow-sm space-y-4">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Sparkles size={14} className="text-indigo-600" />
              Быстрое добавление
            </h3>

            <div className="grid grid-cols-1 gap-2.5">
              <button
                onClick={addGroup}
                className="flex items-center justify-center gap-2 py-3 bg-indigo-600/10 hover:bg-indigo-600/15 text-indigo-700 rounded-xl text-xs font-black uppercase tracking-widest transition active:scale-98 cursor-pointer border border-indigo-500/10"
              >
                <FolderPlus size={15} />
                Создать Группу
              </button>
              <button
                onClick={() => addStandaloneLink('dashboard')}
                className="flex items-center justify-center gap-2 py-3 bg-indigo-600 hover:bg-indigo-700 text-white shadow-sm hover:shadow-md rounded-xl text-xs font-black uppercase tracking-widest transition active:scale-98 cursor-pointer border border-indigo-750/20"
              >
                <Plus size={15} />
                Создать Ссылку
              </button>
              
              <button
                onClick={restoreToStandardDefaults}
                className="flex items-center justify-center gap-2 py-2.5 bg-white/60 hover:bg-white border border-slate-200 text-slate-500 rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer"
                title="Полностью восстановить исходную структуру"
              >
                <RotateCcw size={12} />
                Сбросить к стандарту
              </button>
            </div>
          </div>

          {/* Page Allocation Audit / Map */}
          <div className="p-5 rounded-[1.5rem] bg-white/55 backdrop-blur-md border border-white/45 shadow-sm space-y-3.5">
            <div>
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-800">
                Карта доступности страниц
              </h3>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5 leading-normal">
                Статус привязки страниц в текущем черновике.
              </p>
            </div>

            <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
              {AVAILABLE_MODULES.map(module => {
                const util = getModuleUtilization(module.key);
                return (
                  <div key={module.key} className="p-2.5 bg-white/40 rounded-xl border border-white/50 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1 rounded-lg bg-white/70 shadow-xs shrink-0 flex items-center justify-center">
                        {getModuleIcon(module.key)}
                      </div>
                      <span className="font-extrabold text-slate-700 truncate">{module.label}</span>
                    </div>

                    <div className="shrink-0 flex items-center gap-1.5">
                      {util.state === 'unused' ? (
                        <span className="text-[8px] bg-rose-500/10 text-rose-700 border border-rose-500/10 px-2 py-0.5 rounded-full font-black uppercase tracking-widest font-mono">
                          Скрыт
                        </span>
                      ) : util.state === 'standalone' ? (
                        <span className="text-[8px] bg-sky-500/10 text-sky-800 border border-sky-500/10 px-2 py-0.5 rounded-full font-black uppercase tracking-widest font-mono">
                          В корне
                        </span>
                      ) : (
                        <span className="text-[8px] bg-indigo-500/10 text-indigo-700 border border-indigo-500/10 px-2 py-0.5 rounded-full font-black uppercase tracking-widest font-mono truncate max-w-[85px]" title={`В группе: ${util.groupLabel}`}>
                          Г: {util.groupLabel}
                        </span>
                      )}

                      {/* Quick link append options if unused */}
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
                          className="text-[9px] font-black bg-white/80 border border-white/60 hover:border-indigo-400 rounded-lg px-1.5 py-0.5 outline-none text-indigo-700 cursor-pointer"
                          defaultValue=""
                        >
                          <option value="" disabled>+</option>
                          <option value="main">В корень</option>
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

    </div>
  );
}
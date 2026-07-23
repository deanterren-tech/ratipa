import React, {useState, useEffect} from 'react'
import {
  UserProfile,
  AppSettings,
  DISPATCHER_COLORS_PRESETS,
} from "../../types";
import {dbService} from '../../api'
import {
  ShieldCheck,
  UserPlus,
  Palette,
  Trash2,
  Edit2,
  Key,
  Search,
  ChevronRight,
  User,
  Sliders,
  Shield
} from "lucide-react";
import {useToast} from '../ToastProvider'
import {useDialog} from '../DialogProvider'

interface Props {
  user: UserProfile;
}

const ROLE_LABELS: Record<string, string> = {
  root_admin: "Разработчик (Root)",
  admin: "Администратор",
  manager: "Менеджер",
  accountant: "Бухгалтер",
  dispatcher: "Диспетчер",
  mechanic: "Механик",
  viewer: "Наблюдатель",
  logist: "Логист",
};

const DEFAULT_ROLE_PERMS: Record<string, any> = {
  root_admin: { dashboard: "write", settings: "write", dohod: "write", salary: "write", planDohod: "write", planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write", disposition: "write", documents: "write", analysis: "write", admin: "write" },
  admin: { dashboard: "read", dohod: "write", salary: "write", planDohod: "write", planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write", disposition: "write", documents: "write", analysis: "write", settings: "write", admin: "write" },
  manager: { dashboard: "read", dohod: "write", salary: "write", planDohod: "write", planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write", disposition: "write", documents: "write", analysis: "write", settings: "write", admin: "none" },
  mechanic: { dashboard: "read", dohod: "read", salary: "none", planDohod: "read", planZagruzok: "none", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "write", documents: "read", analysis: "none", settings: "none", admin: "none" },
  dispatcher: { dashboard: "read", dohod: "write", salary: "write", planDohod: "read", planZagruzok: "read", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "read", documents: "write", analysis: "none", settings: "none", admin: "none" },
  accountant: { dashboard: "read", dohod: "write", salary: "write", planDohod: "read", planZagruzok: "read", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "read", documents: "write", analysis: "none", settings: "none", admin: "none" },
  viewer: { dashboard: "read", dohod: "none", salary: "none", planDohod: "none", planZagruzok: "none", baza: "read", vehicleDriverData: "none", dozvola: "none", disposition: "none", documents: "none", analysis: "none", settings: "none", admin: "none" },
  logist: { dashboard: "read", dohod: "none", salary: "none", planDohod: "read", planZagruzok: "write", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "write", documents: "none", analysis: "none", settings: "none", admin: "none" }
};

export default function UserManagementBlock({ user }: Props) {
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useDialog();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  
  const [activeMainTab, setActiveMainTab] = useState<"users" | "roles">("users");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [newUName, setNewUName] = useState("");
  const [newUPassword, setNewUPassword] = useState("");
  const [newURole, setNewURole] = useState("dispatcher");
  
  const [showZagruzokSubtabs, setShowZagruzokSubtabs] = useState(false);
  const [showPlanningSubtabs, setShowPlanningSubtabs] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const isModuleExpanded = (key: string) =>
    key === "planZagruzok" ? showZagruzokSubtabs : key === "currentPlanning" ? showPlanningSubtabs : !!expandedModules[key];
  const toggleModuleExpand = (key: string) => {
    if (key === "planZagruzok") setShowZagruzokSubtabs((v) => !v);
    else if (key === "currentPlanning") setShowPlanningSubtabs((v) => !v);
    else setExpandedModules((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    const unsubUsers = dbService.getUsers(setUsers);
    const unsubSettings = dbService.getSettings(setSettings);
    return () => {
      unsubUsers();
      unsubSettings();
    };
  }, []);

  const computeEffectivePermissions = (role: string, customOverrides: any, rolePermsBase?: any) => {
    const base = rolePermsBase?.[role] || settings?.rolePermissions?.[role] || DEFAULT_ROLE_PERMS[role] || DEFAULT_ROLE_PERMS['viewer'];
    const effective = { ...base };
    if (customOverrides) {
      Object.keys(customOverrides).forEach(k => {
        if (customOverrides[k] && customOverrides[k] !== 'inherit') {
          effective[k] = customOverrides[k];
        }
      });
    }
    return effective;
  };

  const handleRegisterUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUName.trim() || !newUPassword.trim() || !newURole) return;

    const basePerms = settings?.rolePermissions?.[newURole] || DEFAULT_ROLE_PERMS[newURole] || DEFAULT_ROLE_PERMS['viewer'];
    
    const newUser: UserProfile = {
      uid: "user_" + Date.now(),
      name: newUName.trim(),
      email: `${newUName.trim().toLowerCase()}@ratipa.com`,
      createdAt: new Date().toISOString(),
      password: newUPassword.trim(),
      role: newURole as any,
      permissions: { ...basePerms } as any,
      customPermissions: {} as any,
      lastActive: new Date().toISOString(),
    };

    dbService.saveUser(newUser);
    setNewUName("");
    setNewUPassword("");
    setIsAdding(false);
    toast(`Пользователь ${newUser.name} успешно добавлен`, "success");
  };

  const handleRolePermChange = (roleKey: string, permKey: string, val: string) => {
    const newRolePermissions = { 
      ...(settings?.rolePermissions || DEFAULT_ROLE_PERMS), 
      [roleKey]: { 
        ...(settings?.rolePermissions?.[roleKey] || DEFAULT_ROLE_PERMS[roleKey] || {}), 
        [permKey]: val 
      } 
    };
    
    // Optimistic Settings update
    if (settings) {
      setSettings({ ...settings, rolePermissions: newRolePermissions });
    }
    
    dbService.saveSettings({ ...settings, rolePermissions: newRolePermissions } as any, user.name, user.role);
    
    // Optimistic Users update
    const updates: Record<string, any> = {};
    setUsers(prev => prev.map(u => {
      if (u.role === roleKey) {
        const newEffective = computeEffectivePermissions(roleKey, u.customPermissions || {}, newRolePermissions);
        updates[`users_list/${u.uid}/permissions`] = newEffective;
        return { ...u, permissions: newEffective as any };
      }
      return u;
    }));
    if (Object.keys(updates).length > 0) {
      dbService.saveUsersBatch(updates);
    }
    
    toast(`Права роли обновлены`, "success");
  };

  const handleUserPermChange = (u: UserProfile, permKey: string, val: string) => {
    const newCustom = { ...(u.customPermissions || {}), [permKey]: val };
    const newEffective = computeEffectivePermissions(u.role, newCustom);
    
    // Optimistic UI update
    setUsers(prev => prev.map(user => 
      user.uid === u.uid 
        ? { ...user, customPermissions: newCustom as any, permissions: newEffective as any } 
        : user
    ));
    
    dbService.saveUser({ ...u, customPermissions: newCustom as any, permissions: newEffective as any });
  };

  const handleUserRoleChange = (u: UserProfile, newRole: string) => {
    const newEffective = computeEffectivePermissions(newRole, u.customPermissions || {});
    dbService.saveUser({ ...u, role: newRole as any, permissions: newEffective as any });
    toast("Роль сотрудника обновлена", "success");
  };

  const filteredUsers = users.filter(
    (u) =>
      String(u.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(ROLE_LABELS[u.role] || u.role).toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const selectedUser = users.find((u) => u.uid === selectedUid);

  const canEditUsers = user.role === "admin" || user.role === "root_admin";
  const isEditingSelf = selectedUser?.uid === user.uid;
  const isProtectedRoot = selectedUser?.role === "root_admin" && user.role !== "root_admin";
  const canEditSelectedUser = canEditUsers && (!isProtectedRoot || isEditingSelf);

  const MODULES_LIST = [
    { key: "dashboard", label: "Главная (Dashboard)" },
    { key: "dohod", label: "Калькуляция Дохода" },
    { key: "salary", label: "ЗП Водителей" },
    { key: "planDohod", label: "План Дохода" },
    {
      key: "planZagruzok",
      label: "План Загрузок",
      hasSubtabs: true,
      subtabs: settings?.planZagruzokTabs?.map((t) => ({ key: "planZagruzok_" + t.id, label: "Вкладка П.З.", name: t.name })) || [],
    },
    {
      key: "currentPlanning",
      label: "Текущее Планирование",
      hasSubtabs: true,
      subtabs: settings?.currentPlanningTabs?.map((t) => ({ key: "currentPlanning_" + t.id, label: "Вкладка Т.П.", name: t.name })) || [],
    },
    { key: "baza", label: "Учет выезда (База)" },
    { key: "vehicleDriverData", label: "Данные авто и водителей" },
    { key: "dozvola", label: "Дозволы" },
    { key: "disposition", label: "Диспозиция" },
    { key: "documents", label: "Шаблоны документов" },
    { key: "analysis", label: "Анализ" },
    { key: "settings", label: "Справочники" },
    { key: "admin", label: "Администрирование" },
  ];

  return (
    <div className="bg-white/40 backdrop-blur-xl rounded-[2.5rem] border border-white/45 shadow-sm flex flex-col md:flex-row overflow-hidden min-h-[680px] mt-6 relative">
      {/* Left Pane */}
      <div className="w-full md:w-5/12 lg:w-4/12 border-r border-slate-200/40 flex flex-col bg-white/20 select-none">
        <div className="p-6 border-b border-slate-200/40 bg-white/10">
          <div className="flex justify-between items-center mb-4">
            <div>
              <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[9px] font-black uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1 inline-block">
                Registry
              </span>
              <h2 className="text-sm font-black text-slate-800 tracking-tight">
                Доступ и Учетные записи
              </h2>
            </div>
            {canEditUsers && activeMainTab === "users" && (
              <button
                onClick={() => {
                  setIsAdding(true);
                  setSelectedUid(null);
                }}
                className="bg-[#3765F6] hover:bg-[#2555E5] active:scale-95 text-white rounded-xl p-2.5 shadow-sm transition-all cursor-pointer flex items-center justify-center border border-[#3765F6]/15"
                title="Добавить пользователя"
              >
                <UserPlus size={15} />
              </button>
            )}
          </div>
          
          <div className="flex gap-2 mb-4 bg-white/50 p-1 rounded-xl shadow-inner border border-white/60">
            <button
              onClick={() => { setActiveMainTab("users"); setIsAdding(false); }}
              className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-2 rounded-lg transition-all ${activeMainTab === 'users' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Сотрудники
            </button>
            <button
              onClick={() => { setActiveMainTab("roles"); setIsAdding(false); setSelectedRole(null); }}
              className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-2 rounded-lg transition-all ${activeMainTab === 'roles' ? 'bg-white shadow-xs text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}
            >
              Роли
            </button>
          </div>

          {activeMainTab === "users" && (
            <div className="relative">
              <Search className="absolute left-3.5 top-3.5 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                placeholder="Поиск сотрудника..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/50 border border-white/60 placeholder:text-slate-400 text-xs font-semibold py-2.5 pl-10 pr-4 outline-none focus:ring-4 focus:ring-[#3765F6]/5 focus:border-[#3765F6] rounded-xl shadow-xs transition-all text-slate-800"
              />
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-2 max-h-[500px] md:max-h-none">
          {activeMainTab === "users" && filteredUsers.map((u) => {
            const isSelected = selectedUid === u.uid;
            const roleLabel = ROLE_LABELS[u.role] || u.role;
            const initialLetter = String(u.name || "?").charAt(0).toUpperCase();

            let badgeStyles = "bg-slate-100 text-slate-700 border-slate-200";
            if (u.role === 'root_admin') badgeStyles = "bg-rose-50 text-rose-700 border-rose-100";
            else if (u.role === 'admin') badgeStyles = "bg-[#3765F6]/5 text-[#3765F6] border-[#3765F6]/10";
            else if (u.role === 'manager') badgeStyles = "bg-sky-50 text-sky-700 border-sky-100";
            else if (u.role === 'accountant') badgeStyles = "bg-purple-50 text-purple-700 border-purple-100";
            else if (u.role === 'dispatcher') badgeStyles = "bg-emerald-50 text-emerald-700 border-emerald-100";
            else if (u.role === 'mechanic') badgeStyles = "bg-amber-50 text-amber-700 border-amber-100";

            return (
              <button
                key={u.uid}
                onClick={() => { setSelectedUid(u.uid); setIsAdding(false); }}
                className={`w-full group relative flex items-center justify-between p-3 rounded-xl transition-all border cursor-pointer ${
                  isSelected ? "bg-white border-slate-200/80 shadow-xs text-slate-900 scale-[1.01]" : "border-transparent hover:bg-white/40 text-slate-750"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8.5 h-8.5 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border transition-all ${
                    isSelected ? "bg-[#3765F6] text-white border-[#3765F6]/20 shadow-sm" : badgeStyles
                  }`}>
                    {initialLetter}
                  </div>
                  <div className="flex flex-col items-start text-left min-w-0">
                    <span className="text-xs font-black text-slate-800 truncate flex items-center gap-1.5 w-full">
                      {u.name} 
                      {u.uid === user.uid && <span className="bg-[#3765F6] text-white font-mono text-[7px] px-1 py-0.5 rounded font-black uppercase tracking-wider shrink-0 scale-90">ВЫ</span>}
                    </span>
                    <span className="text-[9px] font-bold font-mono uppercase tracking-widest text-slate-400 mt-0.5">{roleLabel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {canEditUsers && u.uid !== user.uid && u.role !== "root_admin" && (
                    <div
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await showConfirm(`Удалить учетную запись ${u.name}?`)) {
                          dbService.deleteUser(u.uid, u.name);
                          if (selectedUid === u.uid) setSelectedUid(null);
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-all"
                    >
                      <Trash2 size={13} />
                    </div>
                  )}
                  <ChevronRight size={14} className={isSelected ? "text-[#3765F6] translate-x-0.5 font-bold" : "text-slate-300 group-hover:translate-x-0.5 transition-all"} />
                </div>
              </button>
            );
          })}

          {activeMainTab === "roles" && Object.entries(ROLE_LABELS).map(([rKey, rLabel]) => {
            const isSelected = selectedRole === rKey;
            const usersCount = users.filter(u => u.role === rKey).length;
            return (
              <button
                key={rKey}
                onClick={() => { setSelectedRole(rKey); setIsAdding(false); }}
                className={`w-full group relative flex items-center justify-between p-3 rounded-xl transition-all border cursor-pointer ${
                  isSelected ? "bg-white border-slate-200/80 shadow-xs text-slate-900 scale-[1.01]" : "border-transparent hover:bg-white/40 text-slate-750"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-8.5 h-8.5 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border transition-all ${
                    isSelected ? "bg-[#3765F6] text-white border-[#3765F6]/20 shadow-sm" : "bg-slate-100 text-slate-700 border-slate-200"
                  }`}>
                    <Shield size={14} />
                  </div>
                  <div className="flex flex-col items-start text-left min-w-0">
                    <span className="text-xs font-black text-slate-800 truncate flex items-center gap-1.5 w-full">
                      {rLabel}
                    </span>
                    <span className="text-[9px] font-bold font-mono uppercase tracking-widest text-slate-400 mt-0.5">Пользователей: {usersCount}</span>
                  </div>
                </div>
                <ChevronRight size={14} className={isSelected ? "text-[#3765F6] translate-x-0.5 font-bold" : "text-slate-300 group-hover:translate-x-0.5 transition-all"} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Right Pane */}
      <div className="w-full md:w-7/12 lg:w-8/12 flex flex-col bg-white/10 backdrop-blur-md">
        
        {/* ADD USER FORM */}
        {isAdding && activeMainTab === "users" && (
          <div className="p-6 lg:p-8 animate-fade-in flex flex-col h-full">
            <div className="border-b border-white/40 pb-4 mb-6">
              <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[9px] font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1.5 inline-block">
                Registration
              </span>
              <h3 className="text-sm font-semibold text-slate-900 tracking-tight flex items-center gap-2 select-none">
                <UserPlus className="text-[#3765F6] h-4.5 w-4.5" />
                Новый профиль сотрудника
              </h3>
            </div>
            <form onSubmit={handleRegisterUser} className="space-y-5 max-w-sm">
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block select-none">Имя (Логин)</label>
                <input required type="text" value={newUName} onChange={(e) => setNewUName(e.target.value)} className="w-full bg-white/50 border border-slate-200/50 rounded-xl px-4 py-2.5 text-xs font-semibold outline-none focus:ring-4 focus:ring-[#3765F6]/5 focus:border-[#3765F6]" placeholder="Иван Петров" />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block select-none">Пароль</label>
                <input required type="text" value={newUPassword} onChange={(e) => setNewUPassword(e.target.value)} className="w-full bg-white/50 border border-slate-200/50 rounded-xl px-4 py-2.5 text-xs font-semibold outline-none focus:ring-4 focus:ring-[#3765F6]/5 focus:border-[#3765F6]" placeholder="Сложный пароль..." />
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono block select-none">Группа роли</label>
                <select value={newURole} onChange={(e) => setNewURole(e.target.value)} className="w-full bg-white/50 border border-slate-200/50 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:ring-4 focus:ring-[#3765F6]/5 focus:border-[#3765F6] cursor-pointer">
                  {Object.entries(ROLE_LABELS).map(([k, v]) => (user.role !== 'root_admin' && k === 'root_admin' ? null : <option key={k} value={k}>{v}</option>))}
                </select>
              </div>
              <div className="flex gap-3 pt-4">
                <button type="submit" className="flex-1 bg-[#3765F6] hover:bg-[#2555E5] text-white shadow-xs font-semibold text-xs py-2.5 rounded-xl cursor-pointer">Зарегистрировать</button>
                <button type="button" onClick={() => setIsAdding(false)} className="px-5 bg-slate-100 hover:bg-slate-200 text-slate-600 font-semibold text-xs py-2.5 rounded-xl cursor-pointer">Отмена</button>
              </div>
            </form>
          </div>
        )}

        {/* ROLE VIEW */}
        {!isAdding && activeMainTab === "roles" && selectedRole && (
          <div className="p-6 lg:p-8 flex flex-col h-full animate-fade-in overflow-y-auto">
             <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-200/40 pb-5 select-none">
              <div>
                <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                  Шаблон роли: {ROLE_LABELS[selectedRole]}
                </h3>
                <span className="text-[10.5px] text-slate-500 font-medium mt-1 block">Эти базовые права применяются ко всем пользователям с данной ролью.</span>
              </div>
            </div>

            <div className="mt-2">
              <h4 className="text-xs font-bold tracking-wide text-slate-550 font-mono mb-3.5 flex items-center gap-1.5 select-none">
                <ShieldCheck size={13} className="text-[#3765F6]" />
                Общие права доступа роли
              </h4>
              <div className="bg-white/20 border border-slate-200/40 rounded-[1.8rem] p-4.5 space-y-3.5 max-h-[450px] overflow-y-auto custom-scrollbar shadow-inner">
                {MODULES_LIST.map((m) => {
                  const roleBase = settings?.rolePermissions?.[selectedRole] || DEFAULT_ROLE_PERMS[selectedRole] || DEFAULT_ROLE_PERMS['viewer'];
                  const currentPerm = roleBase[m.key] || "none";
                  const isExpanded = isModuleExpanded(m.key);
                  const toggleExpand = () => toggleModuleExpand(m.key);

                  return (
                    <div key={m.key} className="space-y-2.5 pb-2.5 border-b border-slate-200/30 last:border-0 last:pb-0">
                      <div className={`flex flex-col lg:flex-row lg:items-center justify-between bg-white/45 border ${m.hasSubtabs ? "border-dashed border-[#3765F6]/20/60" : "border-slate-200/40"} rounded-xl p-3 gap-3 hover:bg-white/60`}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-800 tracking-tight">{m.label}</span>
                          {m.hasSubtabs && (
                            <button type="button" onClick={toggleExpand} className={`text-[9px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer ${isExpanded ? "bg-[#3765F6] text-white" : "bg-[#3765F6]/5 hover:bg-[#3765F6]/10 text-[#3765F6]"}`}>
                              {isExpanded ? "Скрыть" : "Настроить"} ({m.subtabs.length})
                            </button>
                          )}
                        </div>
                        <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-xl border border-slate-200/60 shrink-0 self-end lg:self-auto select-none">
                          {["none", "read", "write"].map((perm) => {
                            const isActive = currentPerm === perm;
                            let activeColors = "bg-rose-50 text-rose-700 border-rose-100 font-bold shadow-xs";
                            if (perm === "read") activeColors = "bg-[#3765F6]/5 text-[#3765F6] border-[#3765F6]/10 font-bold shadow-xs";
                            else if (perm === "write") activeColors = "bg-emerald-50 text-emerald-700 border-emerald-100 font-bold shadow-xs";

                            return (
                              <button key={perm} disabled={!canEditUsers || selectedRole === 'root_admin'} onClick={() => handleRolePermChange(selectedRole, m.key, perm)}
                                className={`px-2.5 py-1 rounded-lg text-[9px] uppercase tracking-wider font-semibold border border-transparent ${isActive ? activeColors : "text-slate-500 hover:bg-white/40"} disabled:opacity-40 cursor-pointer`}
                              >
                                {perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный"}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {m.hasSubtabs && isExpanded && (
                        <div className="pl-4 border-l-2 border-[#3765F6]/20 space-y-2 mt-1.5 ml-3 pb-1">
                          {m.subtabs.length === 0 ? (
                            <div className="text-[10px] text-slate-400 font-mono py-1">Нет вкладок</div>
                          ) : m.subtabs.map((subItem) => {
                              const subPerm = roleBase[subItem.key] || "none";
                              return (
                                <div key={subItem.key} className="flex flex-col sm:flex-row sm:items-center justify-between border rounded-xl p-2.5 gap-2.5 bg-slate-50/50">
                                  <span className="text-xs font-semibold tracking-tight">{subItem.name}</span>
                                  <div className="flex gap-0.5 bg-slate-100/80 p-0.5 rounded-xl border border-slate-200/50">
                                    {["none", "read", "write"].map((perm) => {
                                      const isActive = subPerm === perm;
                                      let activeColors = "bg-rose-50 text-rose-750 border-rose-100 font-bold shadow-xs";
                                      if (perm === "read") activeColors = "bg-blue-50 text-blue-750 border-blue-100 font-bold shadow-xs";
                                      else if (perm === "write") activeColors = "bg-emerald-50 text-emerald-750 border-emerald-100 font-bold shadow-xs";
                                      return (
                                        <button key={perm} disabled={!canEditUsers || selectedRole === 'root_admin'} onClick={() => handleRolePermChange(selectedRole, subItem.key, perm)}
                                          className={`px-2.5 py-1 rounded-lg text-[9px] uppercase tracking-wider font-semibold border border-transparent ${isActive ? activeColors : "text-slate-500 hover:bg-white/40"} disabled:opacity-40 cursor-pointer`}
                                        >
                                          {perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный"}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* USER VIEW */}
        {!isAdding && activeMainTab === "users" && selectedUser && (
          <div className="p-6 lg:p-8 flex flex-col h-full animate-fade-in overflow-y-auto">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-200/40 pb-5 select-none">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-black text-slate-900 tracking-tight flex items-center gap-2">
                    {selectedUser.name}
                  </h3>
                  {canEditUsers && (
                    <button onClick={async () => {
                        const n = await showPrompt("Изменить имя сотрудника:", selectedUser.name);
                        if (n && n.trim() !== "" && n !== selectedUser.name) {
                          dbService.saveUser({ ...selectedUser, name: n.trim() });
                        }
                      }}
                      className="text-slate-400 hover:text-[#3765F6] transition-all cursor-pointer p-1 rounded-md hover:bg-white/50" title="Редактировать имя"
                    ><Edit2 size={12} /></button>
                  )}
                </div>
                <div className="text-[9px] font-mono tracking-widest mt-2 flex flex-wrap gap-2">
                  <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/20 px-2.5 py-0.5 rounded-full font-semibold">{ROLE_LABELS[selectedUser.role] || selectedUser.role}</span>
                  <span className="bg-slate-100 text-slate-500 border border-slate-200/50 px-2 py-0.5 rounded-full font-semibold">ID: {selectedUser.uid}</span>
                  <span className="bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full font-semibold flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                    Активность: {new Date(selectedUser.lastActive || new Date()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-6">
              <div className="space-y-4">
                <div className="bg-white/45 border border-white/60 rounded-2xl p-4.5 shadow-xs">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5 select-none">
                    <Key size={12} className="text-[#3765F6]" /> Пароль доступа
                  </label>
                  <div className="flex gap-2">
                    <input type="text" readOnly value={selectedUser.password || "—"} className="bg-white/70 border border-slate-200/60 rounded-xl px-3 py-2 text-xs font-mono font-bold w-full select-all outline-none focus:bg-white transition-all text-slate-800 shadow-inner" />
                    {canEditUsers && (
                      <button onClick={async () => {
                          const p = await showPrompt("Новый пароль сотрудника:", selectedUser.password);
                          if (p && p.trim() !== "") {
                            dbService.saveUser({ ...selectedUser, password: p.trim() });
                            toast("Пароль обновлен", "success");
                          }
                        }}
                        className="bg-[#3765F6] hover:bg-[#2555E5] text-white shadow-xs rounded-xl px-3.5 transition-all font-semibold text-xs cursor-pointer shrink-0 border border-[#3765F6]/10"
                      >Изменить</button>
                    )}
                  </div>
                </div>

                <div className="bg-white/45 border border-white/60 rounded-2xl p-4.5 shadow-xs">
                  <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5 select-none">
                    <ShieldCheck size={12} className="text-[#3765F6]" /> Системная роль
                  </label>
                  <select value={selectedUser.role} disabled={!canEditSelectedUser} onChange={(e) => handleUserRoleChange(selectedUser, e.target.value)}
                    className="bg-white/70 border border-slate-200/60 rounded-xl px-3 py-2.5 text-xs font-bold w-full outline-none disabled:opacity-50 cursor-pointer text-slate-800 transition-all focus:border-[#3765F6]"
                  >
                    {Object.entries(ROLE_LABELS).map(([k, v]) => (user.role !== 'root_admin' && k === 'root_admin' ? null : <option key={k} value={k}>{v}</option>))}
                  </select>
                </div>
              </div>

              <div className="bg-white/45 border border-white/60 rounded-2xl p-4.5 shadow-xs">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5 select-none">
                  <Palette size={12} className="text-[#3765F6]" /> Индивидуальный цвет
                </label>
                <div className="grid grid-cols-6 gap-2 mt-4">
                  {DISPATCHER_COLORS_PRESETS.map((p) => {
                    const isSelected = selectedUser.color === p.key;
                    return (
                      <button key={p.key} onClick={() => { if (canEditUsers) dbService.saveUser({ ...selectedUser, color: p.key }); }}
                        className={`w-7.5 h-7.5 rounded-lg border-2 transition-all flex items-center justify-center ${isSelected ? "border-[#3765F6] scale-110 shadow-sm" : "border-transparent hover:scale-105"} cursor-pointer`}
                        style={{ backgroundColor: p.colorCode }} title={p.name}
                      >
                        {isSelected && <span className="text-[10px] text-white font-black drop-shadow-md">✓</span>}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="bg-white/45 border border-white/60 rounded-2xl p-4.5 shadow-xs">
                <label className="text-[9px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5 select-none">
                  <ShieldCheck size={12} className="text-[#3765F6]" /> Права редактирования полей Учёта выезда
                </label>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                  {[
                    { key: 'dateArrival', label: 'Прибыл' },
                    { key: 'dateLoading', label: 'Готовность' },
                    { key: 'dateRepairStart', label: 'Ремонт нач.' },
                    { key: 'dateRepairEnd', label: 'Ремонт оконч.' },
                    { key: 'dateDeparture', label: 'Выезд' },
                    { key: 'comment', label: 'Комментарий' },
                    { key: 'driverName', label: 'Водитель' },
                    { key: 'carNumber', label: 'Гос. номер' },
                  ].map((f) => {
                    const checked = selectedUser.role === 'root_admin' || !!selectedUser.permissions?.[f.key];
                    return (
                      <label key={f.key} className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-[10px] font-semibold ${checked ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-rose-50 text-rose-700 border-rose-100'}`}>
                        <input disabled={selectedUser.role === 'root_admin'} type="checkbox" checked={checked} onChange={(e) => dbService.saveUser({ ...selectedUser, permissions: { ...(selectedUser.permissions || {}), [f.key]: e.target.checked } } as any)} className="accent-[#3765F6] h-3.5 w-3.5" />
                        {f.label}
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="mt-2">
              <h4 className="text-xs font-bold tracking-wide text-slate-550 font-mono mb-3.5 flex items-center gap-1.5 select-none">
                <Sliders size={13} className="text-[#3765F6]" />
                Индивидуальные права доступа (переопределения)
              </h4>
              <div className="bg-white/20 border border-slate-200/40 rounded-[1.8rem] p-4.5 space-y-3.5 max-h-[350px] overflow-y-auto custom-scrollbar shadow-inner">
                {MODULES_LIST.map((m) => {
                  const currentCustom = selectedUser.customPermissions?.[m.key] || "inherit";
                  const effectivePerm = selectedUser.permissions?.[m.key] || "none";
                  const isExpanded = isModuleExpanded(m.key);
                  const toggleExpand = () => toggleModuleExpand(m.key);

                  return (
                    <div key={m.key} className="space-y-2.5 pb-2.5 border-b border-slate-200/30 last:border-0 last:pb-0">
                      <div className={`flex flex-col lg:flex-row lg:items-center justify-between bg-white/45 border ${m.hasSubtabs ? "border-dashed border-[#3765F6]/20/60" : "border-slate-200/40"} rounded-xl p-3 gap-3 hover:bg-white/60`}>
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                          <span className="text-[11px] font-bold text-slate-800 tracking-tight">{m.label}</span>
                          {m.hasSubtabs && (
                            <button type="button" onClick={toggleExpand} className={`text-[9px] font-semibold px-2.5 py-1 rounded-lg cursor-pointer ${isExpanded ? "bg-[#3765F6] text-white" : "bg-[#3765F6]/5 hover:bg-[#3765F6]/10 text-[#3765F6]"}`}>
                              {isExpanded ? "Скрыть" : "Настроить"} ({m.subtabs.length})
                            </button>
                          )}
                        </div>

                        <div className="flex gap-0.5 bg-slate-100 p-0.5 rounded-xl border border-slate-200/60 shrink-0 self-end lg:self-auto select-none">
                          {["inherit", "none", "read", "write"].map((perm) => {
                            const isActive = currentCustom === perm;
                            let activeColors = "bg-slate-300 text-slate-800 border-slate-400 font-bold shadow-xs";
                            if (perm === "none") activeColors = "bg-rose-50 text-rose-700 border-rose-100 font-bold shadow-xs";
                            else if (perm === "read") activeColors = "bg-[#3765F6]/5 text-[#3765F6] border-[#3765F6]/10 font-bold shadow-xs";
                            else if (perm === "write") activeColors = "bg-emerald-50 text-emerald-700 border-emerald-100 font-bold shadow-xs";

                            const labels = perm === "inherit" ? "Наследует" : perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный";
                            
                            return (
                              <button key={perm} disabled={!canEditSelectedUser || selectedUser.role === 'root_admin'} onClick={() => handleUserPermChange(selectedUser, m.key, perm)}
                                className={`px-2.5 py-1 rounded-lg text-[9px] uppercase tracking-wider font-semibold border border-transparent ${isActive ? activeColors : "text-slate-500 hover:bg-white/40"} disabled:opacity-40 cursor-pointer`}
                                title={perm === 'inherit' ? `Наследует: ${effectivePerm}` : ''}
                              >
                                {labels} {perm === 'inherit' && `(${effectivePerm === 'none' ? 'Нет' : effectivePerm === 'read' ? 'Ч' : 'П'})`}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {m.hasSubtabs && isExpanded && (
                        <div className="pl-4 border-l-2 border-[#3765F6]/20 space-y-2 mt-1.5 ml-3 pb-1">
                          {m.subtabs.length === 0 ? (
                            <div className="text-[10px] text-slate-400 font-mono py-1">Нет вкладок</div>
                          ) : m.subtabs.map((subItem) => {
                              const subCustom = selectedUser.customPermissions?.[subItem.key] || "inherit";
                              const subEffective = selectedUser.permissions?.[subItem.key] || "none";
                              
                              return (
                                <div key={subItem.key} className="flex flex-col sm:flex-row sm:items-center justify-between border rounded-xl p-2.5 gap-2.5 bg-slate-50/50">
                                  <span className="text-xs font-semibold tracking-tight">{subItem.name}</span>
                                  <div className="flex gap-0.5 bg-slate-100/80 p-0.5 rounded-xl border border-slate-200/50">
                                    {["inherit", "none", "read", "write"].map((perm) => {
                                      const isActive = subCustom === perm;
                                      let activeColors = "bg-slate-300 text-slate-800 border-slate-400 font-bold shadow-xs";
                                      if (perm === "none") activeColors = "bg-rose-50 text-rose-750 border-rose-100 font-bold shadow-xs";
                                      else if (perm === "read") activeColors = "bg-blue-50 text-blue-750 border-blue-100 font-bold shadow-xs";
                                      else if (perm === "write") activeColors = "bg-emerald-50 text-emerald-750 border-emerald-100 font-bold shadow-xs";
                                      const labels = perm === "inherit" ? "Наследует" : perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный";
                                      return (
                                        <button key={perm} disabled={!canEditSelectedUser || selectedUser.role === 'root_admin'} onClick={() => handleUserPermChange(selectedUser, subItem.key, perm)}
                                          className={`px-2.5 py-1 rounded-lg text-[9px] uppercase tracking-wider font-semibold border border-transparent ${isActive ? activeColors : "text-slate-500 hover:bg-white/40"} disabled:opacity-40 cursor-pointer`}
                                          title={perm === 'inherit' ? `Наследует: ${subEffective}` : ''}
                                        >
                                          {labels} {perm === 'inherit' && `(${subEffective === 'none' ? 'Нет' : subEffective === 'read' ? 'Ч' : 'П'})`}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!isAdding && !selectedUser && !selectedRole && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-12 h-full select-none text-center">
            <div className="w-16 h-16 rounded-3xl bg-[#3765F6]/5 flex items-center justify-center mb-6 border border-[#3765F6]/10 shadow-xs relative">
              <ShieldCheck size={32} className="text-[#3765F6] relative z-10" />
            </div>
            <span className="text-xs font-semibold tracking-wide font-mono text-slate-800 block">
              Выберите элемент для настройки
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
import React, { useState, useEffect } from 'react';
import { UserProfile, UserRole, AuditLog, AppSettings, allModules, DISPATCHER_COLORS_PRESETS } from '../../types';
import { dbService } from '../../firebase';
import { pdService } from '../../firebase/planDohodService';
import { 
  ShieldAlert, 
  UserPlus, 
  Trash2, 
  Key, 
  Activity, 
  ShieldCheck, 
  Search, 
  MapPin, 
  Lock,
  ArrowUp,
  ArrowDown,
  Palette
} from 'lucide-react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';

interface AdminModuleProps {
  user: UserProfile;
}

export default function AdminModule({ user }: AdminModuleProps) {
  const { showConfirm, showPrompt } = useDialog();
  const { toast } = useToast();
  
  const [userList, setUserList] = useState<UserProfile[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [searchLogs, setSearchLogs] = useState('');
  const [settings, setSettings] = useState<AppSettings | null>(null);

  // Dispatcher colors states
  const [dispatchers, setDispatchers] = useState<string[]>([]);
  const [dispatchersOrder, setDispatchersOrder] = useState<string[]>([]);
  const [dispatchersColors, setDispatchersColors] = useState<Record<string, string>>({});

  // Creation State
  const [uName, setUName] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uRole, setURole] = useState<UserRole>('dispatcher');

  useEffect(() => {
    // Subscriptions
    const unsubscribeUsers = dbService.getUsers(setUserList);
    const unsubscribeAudit = dbService.getAuditLogs(setLogs);
    const unsubscribeSettings = dbService.getSettings(setSettings);
    const unsubscribeDispatchers = pdService.subscribeDispatchers((disp, order) => {
      setDispatchers(disp);
      setDispatchersOrder(order);
    });
    const unsubscribeColors = pdService.subscribeDispatchersColors(setDispatchersColors);

    return () => {
      unsubscribeUsers();
      unsubscribeAudit();
      unsubscribeSettings();
      unsubscribeDispatchers();
      unsubscribeColors();
    };
  }, []);

  const saveSettings = (newSettings: AppSettings) => {
    dbService.saveSettings(newSettings, user.name, user.role);
    setSettings(newSettings);
  };

  const moveModule = (key: string, direction: 'up' | 'down') => {
    if (!settings) return;
    
    // Ensure all modules are represented in order
    const currentOrder = settings.moduleOrder || [];
    const normalizedOrder = allModules.map(m => m.key).reduce((acc, k) => {
        if (!acc.includes(k)) acc.push(k);
        return acc;
    }, [...currentOrder]);

    const index = normalizedOrder.indexOf(key);
    if (index === -1) return;
    
    const newOrder = [...normalizedOrder];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    if (targetIndex >= 0 && targetIndex < newOrder.length) {
      [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];
      saveSettings({ ...settings, moduleOrder: newOrder });
    }
  };

  const handleRegisterUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!uName.trim() || !uPassword.trim()) {
      toast("Имя пользователя и пароль обязательны.", 'error');
      return;
    }

    if (userList.some(u => u.name.toLowerCase() === uName.toLowerCase())) {
      toast("Пользователь с таким именем уже существует!", 'error');
      return;
    }

    // Standard permissions template based on role
    let perms = {
      dashboard: 'read',
      dohod: 'write',
      salary: 'write',
      planDohod: 'write',
      planZagruzok: 'write',
      baza: 'write',
      dozvola: 'write',
      archives: 'read',
      settings: 'none',
      admin: 'none'
    };

    if (uRole === 'admin' || uRole === 'root_admin') {
      perms = {
        dashboard: 'read',
        dohod: 'write',
        salary: 'write',
        planDohod: 'write',
        planZagruzok: 'write',
        baza: 'write',
        dozvola: 'write',
        archives: 'write',
        settings: 'write',
        admin: 'write'
      };
    } else if (uRole === 'manager') {
      perms = {
        dashboard: 'read',
        dohod: 'write',
        salary: 'write',
        planDohod: 'write',
        planZagruzok: 'write',
        baza: 'write',
        dozvola: 'write',
        archives: 'write',
        settings: 'write',
        admin: 'none'
      };
    } else if (uRole === 'accountant') {
      perms = {
        dashboard: 'read',
        dohod: 'write',
        salary: 'write',
        planDohod: 'read',
        planZagruzok: 'read',
        baza: 'read',
        dozvola: 'read',
        archives: 'read',
        settings: 'none',
        admin: 'none'
      };
    }

    const newUser: UserProfile = {
      uid: "user_" + Date.now(),
      name: uName.trim(),
      email: `${uName.trim().toLowerCase()}@ratipa.com`,
      createdAt: new Date().toISOString(),
      password: uPassword.trim(), // Stored straightforward for legacy credentials fallback
      role: uRole as any,
      permissions: perms as any,
      lastActive: new Date().toISOString()
    };

    dbService.saveUser(newUser);
    setUName('');
    setUPassword('');
    toast(`Пользователь ${newUser.name} успешно добавлен с уровнем полномочий: ${newUser.role}`, 'success');
  };

  const handleDeleteUser = async (target: UserProfile) => {
    if (target.uid === user.uid) {
      toast("Вы не можете удалить самого себя!", 'error');
      return;
    }
    const confirmed = await showConfirm(`Вы уверены, что хотите удалить пользователя ${target.name}?`);
    if (confirmed) {
      dbService.deleteUser(target.uid, target.name);
      dbService.logAction(user.name, user.role, "Удаление пользователя", "Admin", target.uid, `Удален пользователь ${target.name}`);
      toast("Пользователь стерт из реестра.", 'success');
    }
  };

  // Switch a specific matrix permission
  const handleTogglePermission = (targetUser: UserProfile, moduleKey: string, currentVal: string) => {
    const nextVal = currentVal === 'write' ? 'read' : currentVal === 'read' ? 'none' : 'write';
    
    const updatedPerms = {
      ...targetUser.permissions,
      [moduleKey]: nextVal
    };

    const updatedUser: UserProfile = {
      ...targetUser,
      permissions: updatedPerms as any
    };

    dbService.saveUser(updatedUser);
    dbService.logAction(
      user.name, 
      user.role, 
      'Update Perms', 
      'Admin', 
      targetUser.name, 
      `Changed permission for ${moduleKey} to ${nextVal}`
    );
  };

  // Change individual user's chat message color representation
  const handleChangeUserColor = (targetUser: UserProfile, colorKey: string) => {
    const updatedUser: UserProfile = {
      ...targetUser,
      color: colorKey
    };
    dbService.saveUser(updatedUser);
    dbService.logAction(
      user.name,
      user.role,
      'Update User Color',
      'Admin',
      targetUser.name,
      `Установлен цвет сообщений для ${targetUser.name}: ${colorKey}`
    );
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
          Разграничение доступа
        </h1>
        <p className="text-xs text-slate-500 mt-1 font-semibold">
          Контроль за диспетчерским составом, тонкая настройка индивидуальных доступов и сквозное логирование изменений.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Columns: Matrix of Users and Forms */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* User creator form */}
          <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-5">
              <UserPlus className="h-4.5 w-4.5 text-slate-900" style={{ fill: '#c3fb12' }} />
              Добавить учетную запись сотрудника
            </h2>
            <form onSubmit={handleRegisterUser} className="grid grid-cols-1 sm:grid-cols-4 gap-4">
              <input
                type="text"
                placeholder="Логин (кириллица/лат)"
                required
                value={uName}
                onChange={(e) => setUName(e.target.value)}
                className="p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-slate-400"
              />
              <input
                type="password"
                placeholder="Пароль"
                required
                value={uPassword}
                onChange={(e) => setUPassword(e.target.value)}
                className="p-3 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-slate-400"
              />
              <select
                value={uRole}
                onChange={(e) => setURole(e.target.value as any)}
                className="p-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-700 focus:outline-none focus:border-slate-400 cursor-pointer"
              >
                <option value="dispatcher">Диспетчер</option>
                <option value="manager">Менеджер</option>
                <option value="accountant">Бухгалтер</option>
                <option value="admin">Администратор</option>
              </select>
              <button type="submit" className="bg-slate-950 hover:bg-slate-850 text-[#c3fb12] rounded-xl text-xs font-black uppercase tracking-wider transition cursor-pointer border border-black shadow-xs">
                Создать профиль
              </button>
            </form>
          </div>

          {/* Module order block */}
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
                <div key={item.key} className="flex justify-between items-center py-2 px-3 border border-slate-100 rounded-lg mb-2">
                  <span className="text-xs font-bold capitalize">{item.label}</span>
                  <div className="flex gap-1">
                    <button onClick={() => moveModule(item.key, 'up')} disabled={idx === 0} className="p-1 hover:bg-slate-100 rounded"><ArrowUp size={16}/></button>
                    <button onClick={() => moveModule(item.key, 'down')} disabled={idx === allModules.length - 1} className="p-1 hover:bg-slate-100 rounded"><ArrowDown size={16}/></button>
                  </div>
                </div>
             ))}
          </div>

          <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
            <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-5">
               Фразы для анимированного текста (по 1 в строке)
            </h2>
            <textarea
              className="w-full text-xs p-3 bg-slate-50 border border-slate-200 rounded-xl outline-none"
              rows={5}
              value={settings?.customPhrases?.join('\n') || ''}
              onChange={(e) => {
                if(!settings) return;
                saveSettings({...settings, customPhrases: e.target.value.split('\n')});
              }}
            />
          </div>

          {/* Dispatcher colors block */}
          <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
             <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-5">
               <Palette className="h-4.5 w-4.5 text-slate-900" style={{ fill: '#c3fb12' }} />
               Цвета диспетчеров в планах
             </h2>
             <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                {dispatchersOrder.map((dispName) => {
                   const activeColor = dispatchersColors[dispName] || '';
                   return (
                     <div key={dispName} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-50/70 border border-slate-200/25 rounded-2xl gap-3 hover:border-slate-300/50 transition">
                        <span className="text-xs font-black text-slate-800 flex items-center gap-2">
                           👤 {dispName}
                        </span>
                        <div className="flex flex-wrap gap-1.5">
                           {DISPATCHER_COLORS_PRESETS.map((p) => {
                              const isSelected = activeColor === p.key;
                              return (
                                <button
                                  key={p.key}
                                  type="button"
                                  onClick={() => pdService.updateDispatcherColor(dispName, p.key)}
                                  title={p.name}
                                  className={`w-6 h-6 rounded-full cursor-pointer transition flex items-center justify-center relative border-2 ${isSelected ? 'border-slate-800 scale-110 shadow-sm' : 'border-transparent opacity-95 hover:border-slate-400 hover:scale-105'}`}
                                  style={{ backgroundColor: p.colorCode }}
                                >
                                   {isSelected && (
                                     <span className="text-[10px] text-white font-black drop-shadow-sm select-none font-sans">✓</span>
                                   )}
                                </button>
                              );
                           })}
                        </div>
                     </div>
                   );
                })}
                {dispatchersOrder.length === 0 && (
                   <div className="text-center py-6 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">
                      Список диспетчеров пуст или не инициализирован.
                   </div>
                )}
             </div>
          </div>

          {/* Granular Permission matrix block */}
          <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgba(0,0,0,0.01)] border border-slate-200/50 overflow-hidden">
            <div className="p-6 lg:p-8 border-b border-slate-100">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <ShieldCheck className="h-4.5 w-4.5 text-slate-900" style={{ fill: '#c3fb12' }} />
                Матрица прав доступа сотрудников ({userList.length})
              </h2>

              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 mt-6">
                <Activity className="h-4.5 w-4.5 text-slate-900" />
                Активность пользователей
              </h2>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200/40 font-bold text-[10px] uppercase font-mono text-slate-400 select-none">
                    <th className="p-3.5 pl-6">Логин</th>
                    <th className="p-3.5 text-center">Активность</th>
                    <th className="p-3.5">Пароль</th>
                    <th className="p-3.5">Модуль</th>
                    <th className="p-3.5">Роль</th>
                    <th className="p-3.5">Цвет Чата</th>
                    <th className="p-3.5 text-center">Права</th>
                    <th className="p-3.5 text-right pr-6">Стереть</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-bold">
                  {userList.map((usr) => (
                    <tr key={usr.uid} className="hover:bg-slate-50/50 transition duration-100">
                      <td className="p-3.5 pl-6 text-slate-950 font-black">
                        <div 
                           className={`inline-flex items-center gap-2 ${user.role === 'root_admin' ? 'cursor-pointer hover:bg-slate-100 rounded px-1 -ml-1 transition' : ''}`}
                           onClick={async () => {
                             if (user.role !== 'root_admin') return;
                             const newName = await showPrompt('Изменить имя пользователя:', usr.name);
                             if (newName && newName.trim() !== '' && newName !== usr.name) {
                               dbService.saveUser({ ...usr, name: newName.trim() });
                               toast('Имя пользователя обновлено', 'success');
                             }
                           }}
                           title={user.role === 'root_admin' ? 'Нажмите для изменения имени' : ''}
                        >
                          {usr.name} {usr.uid === user.uid && '(Вы)'}
                        </div>
                      </td>
                      <td className="p-3.5 text-center text-slate-500 font-mono text-[10px]">
                        {new Date(usr.lastActive).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </td>
                      <td className="p-3.5 text-slate-700 font-mono text-[10px]">
                        <div className="flex items-center gap-2 group">
                          <code 
                            onClick={async () => {
                              if (!['admin', 'root_admin'].includes(user.role)) return;
                              const newPass = await showPrompt('Введите новый пароль:', usr.password);
                              if (newPass !== null && newPass !== usr.password) {
                                dbService.saveUser({ ...usr, password: newPass });
                                toast('Пароль успешно обновлен', 'success');
                              }
                            }}
                            className={`px-1.5 py-0.5 rounded font-bold tracking-wider ${['admin', 'root_admin'].includes(user.role) ? 'cursor-pointer hover:bg-slate-200 bg-slate-100 text-slate-600' : 'bg-slate-100 text-slate-600'}`}
                            title={['admin', 'root_admin'].includes(user.role) ? 'Нажмите для изменения пароля' : ''}
                          >
                            {usr.password || '—'}
                          </code>
                        </div>
                      </td>
                      <td className="p-3.5 text-slate-700 font-mono text-[10px] uppercase">
                        {usr.permissions?.currentModule || 'Dashboard'}
                      </td>
                      <td className="p-3.5">
                        <span 
                          onClick={async () => {
                             const canEdit = user.role === 'root_admin' || user.role === 'admin';
                             if (!canEdit) return;
                             if (usr.role === 'root_admin' && user.role !== 'root_admin') {
                               toast('Вы не можете редактировать root-администратора', 'error');
                               return;
                             }
                             
                             const promptText = user.role === 'root_admin' 
                               ? 'Введите роль (root_admin, admin, dispatcher, manager, accountant):'
                               : 'Введите роль (admin, dispatcher, manager, accountant):';
                             const allowedRoles = user.role === 'root_admin'
                               ? ['root_admin', 'admin', 'dispatcher', 'manager', 'accountant']
                               : ['admin', 'dispatcher', 'manager', 'accountant'];
                               
                             const newRole = await showPrompt(promptText, usr.role);
                             if (newRole && allowedRoles.includes(newRole) && newRole !== usr.role) {
                               dbService.saveUser({ ...usr, role: newRole as any });
                               toast('Роль пользователя обновлена', 'success');
                             } else if (newRole && !allowedRoles.includes(newRole)) {
                               toast('Неверная роль', 'error');
                             }
                          }}
                          title={user.role === 'root_admin' || (user.role === 'admin' && usr.role !== 'root_admin') ? 'Нажмите для изменения роли' : ''}
                          className={`text-[9px] uppercase px-2.5 py-1 rounded-lg font-mono font-black ${usr.role === 'admin' || usr.role === 'root_admin' ? 'bg-rose-50 text-rose-600 border border-rose-100/30' : 'bg-slate-100 text-slate-500'} ${user.role === 'root_admin' || (user.role === 'admin' && usr.role !== 'root_admin') ? 'cursor-pointer hover:brightness-95' : ''}`}
                        >
                          {usr.role}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <div className="flex gap-1.2 flex-wrap max-w-[140px]">
                          {DISPATCHER_COLORS_PRESETS.map((p) => {
                            const isSelected = usr.color === p.key;
                            return (
                              <button
                                key={p.key}
                                type="button"
                                onClick={() => handleChangeUserColor(usr, p.key)}
                                title={p.name}
                                className={`w-4 h-4 rounded-full cursor-pointer transition flex items-center justify-center relative border ${isSelected ? 'border-slate-800 scale-110 shadow-xs ring-1 ring-slate-850' : 'border-slate-200 opacity-60 hover:opacity-100 hover:scale-[1.12]'}`}
                                style={{ backgroundColor: p.colorCode }}
                              >
                                {isSelected && (
                                  <span className="text-[6px] text-white font-extrabold select-none">✓</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      </td>
                      
                      <td className="p-3.5">
                        <div className="flex flex-wrap gap-2">
                          {allModules.filter(m => m.permissionKey).map((mod) => {
                            const level = usr.permissions?.[mod.permissionKey as keyof typeof usr.permissions] || 'none';
                            return (
                              <button
                                key={mod.key}
                                onClick={() => handleTogglePermission(usr, mod.permissionKey, level as string)}
                                disabled={usr.role === 'root_admin'}
                                title={mod.label}
                                className={`text-[10px] font-black uppercase font-mono px-3 py-2 rounded-lg transition-all select-none cursor-pointer border ${
                                  level === 'write' 
                                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200' 
                                    : level === 'read' 
                                    ? 'bg-sky-50 text-sky-850 border-sky-200' 
                                    : 'bg-slate-100 text-slate-400 border-transparent'
                                }`}
                              >
                                {mod.label}
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      <td className="p-3.5 text-right pr-6">
                        {usr.role !== 'root_admin' && usr.uid !== user.uid && (
                          <button
                            onClick={() => handleDeleteUser(usr)}
                            className="p-2 text-rose-500 hover:bg-rose-50 hover:text-rose-700 bg-transparent rounded-lg transition cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>

        {/* Right Column: Global AuditTrail stream (Slate design structure) */}
        <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col h-[650px]">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 mb-3 border-b border-slate-100 pb-3.5">
            <Activity className="h-4.5 w-4.5 text-rose-500 animate-pulse" />
            Сквозной Аудит Действий
          </h2>

          <div className="relative mb-4">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3.5" />
            <input
              type="text"
              placeholder="Фильтр по оператору, деталям..."
              value={searchLogs}
              onChange={(e) => setSearchLogs(e.target.value)}
              className="w-full pl-10 pr-3 py-3 bg-slate-50 border border-slate-200 hover:border-slate-350 focus:border-slate-400 focus:bg-white transition duration-150 rounded-xl text-xs font-bold"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-4 pr-1 scroll-smooth">
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

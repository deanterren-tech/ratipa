import React, { useState, useEffect } from 'react';
import { UserProfile, AppSettings, DISPATCHER_COLORS_PRESETS } from '../../types';
import { dbService } from '../../firebase';
import { ShieldCheck, UserPlus, Palette, Trash2, Edit2, Key, Search, ChevronRight, X, AlertTriangle } from 'lucide-react';
import { useToast } from '../ToastProvider';
import { useDialog } from '../DialogProvider';

interface Props {
  user: UserProfile;
}

export default function UserManagementBlock({ user }: Props) {
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useDialog();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [isAdding, setIsAdding] = useState(false);
  const [newUName, setNewUName] = useState('');
  const [newUPassword, setNewUPassword] = useState('');
  const [newURole, setNewURole] = useState('dispatcher');

  useEffect(() => {
    const unsubUsers = dbService.getUsers(setUsers);
    const unsubSettings = dbService.getSettings(setSettings);
    return () => {
      unsubUsers();
      unsubSettings();
    };
  }, []);

  const handleRegisterUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUName.trim() || !newUPassword.trim() || !newURole) return;
    
    // Default permissions logic
    let perms: Record<string, string> = {
      dashboard: 'read',
      settings: 'read',
      admin: 'none'
    };
    if (newURole === 'manager' || newURole === 'admin') {
      perms = { ...perms, dohod: 'write', salary: 'write', planDohod: 'write', planZagruzok: 'write', baza: 'write', dozvola: 'write', disposition: 'write', settings: 'write', admin: newURole === 'admin' ? 'write' : 'none' };
    } else {
      perms = { ...perms, dohod: 'write', salary: 'write', planDohod: 'read', planZagruzok: 'read', baza: 'read', dozvola: 'read', disposition: 'read', settings: 'none', admin: 'none' };
    }

    const newUser: UserProfile = {
      uid: "user_" + Date.now(),
      name: newUName.trim(),
      email: `${newUName.trim().toLowerCase()}@ratipa.com`,
      createdAt: new Date().toISOString(),
      password: newUPassword.trim(),
      role: newURole as any,
      permissions: perms as any,
      lastActive: new Date().toISOString()
    };

    dbService.saveUser(newUser);
    setNewUName('');
    setNewUPassword('');
    setIsAdding(false);
    toast(`Пользователь ${newUser.name} успешно добавлен`, 'success');
  };

  const filteredUsers = users.filter(u => u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.role.toLowerCase().includes(searchQuery.toLowerCase()));
  const selectedUser = users.find(u => u.uid === selectedUid);

  const canEditUsers = user.role === 'admin' || user.role === 'root_admin';

  return (
    <div className="bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col md:flex-row overflow-hidden min-h-[600px] mt-6">
      
      {/* Left List */}
      <div className="w-full md:w-1/3 border-r border-slate-100 flex flex-col bg-slate-50/30">
        <div className="p-4 border-b border-slate-100">
           <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono mb-4 flex justify-between items-center">
             <span>Учетные записи ({users.length})</span>
             {canEditUsers && (
               <button onClick={() => { setIsAdding(true); setSelectedUid(null); }} className="bg-[#70FC8E] text-slate-900 rounded-lg p-1.5 hover:bg-[#5be277] transition cursor-pointer">
                 <UserPlus size={16}/>
               </button>
             )}
           </h2>
           <div className="relative">
             <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400"/>
             <input 
               type="text" 
               placeholder="Поиск профиля..." 
               value={searchQuery}
               onChange={e => setSearchQuery(e.target.value)}
               className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs font-bold outline-none focus:border-blue-400"
             />
           </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredUsers.map(u => (
            <button 
              key={u.uid}
              onClick={() => { setSelectedUid(u.uid); setIsAdding(false); }}
              className={`w-full flex items-center justify-between p-3 rounded-xl transition cursor-pointer border ${selectedUid === u.uid ? 'bg-white border-blue-200 shadow-sm' : 'border-transparent hover:bg-white'}`}
            >
              <div className="flex flex-col items-start text-left">
                 <span className="text-xs font-black text-slate-900">{u.name} {u.uid === user.uid && '(Вы)'}</span>
                 <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-slate-400">{u.role}</span>
              </div>
              <ChevronRight size={16} className={selectedUid === u.uid ? 'text-blue-500' : 'text-slate-300'}/>
            </button>
          ))}
        </div>
      </div>

      {/* Right Content */}
      <div className="w-full md:w-2/3 flex flex-col bg-white">
        
        {isAdding && (
          <div className="p-6 lg:p-8 animate-fade-in flex flex-col h-full">
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2 mb-6">
              <UserPlus className="text-[#c3fb12]"/>
              Новый профиль
            </h3>
            <form onSubmit={handleRegisterUser} className="space-y-4 max-w-sm">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-1.5 block">Имя (Логин)</label>
                <input required type="text" value={newUName} onChange={e => setNewUName(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-blue-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-1.5 block">Пароль</label>
                <input required type="text" value={newUPassword} onChange={e => setNewUPassword(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-blue-400"/>
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-1.5 block">Группа роли</label>
                <select value={newURole} onChange={e => setNewURole(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-blue-400">
                  <option value="dispatcher">Диспетчер</option>
                  <option value="manager">Менеджер</option>
                  <option value="accountant">Бухгалтер</option>
                  <option value="admin">Администратор</option>
                </select>
              </div>
              <button type="submit" className="w-full bg-slate-950 text-[#70FC8E] font-black uppercase tracking-widest px-4 py-3 rounded-xl hover:bg-slate-800 transition shadow-sm mt-4 cursor-pointer">
                Зарегистрировать 
              </button>
            </form>
          </div>
        )}

        {!isAdding && selectedUser && (
          <div className="p-6 lg:p-8 flex flex-col h-full animate-fade-in overflow-y-auto">
             <div className="flex justify-between items-start mb-6 border-b border-slate-100 pb-4">
                <div>
                   <h3 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                     {selectedUser.name}
                     <button onClick={async () => {
                        if (!canEditUsers) return;
                        const n = await showPrompt('Изменить имя:', selectedUser.name);
                        if (n && n.trim() !== '' && n !== selectedUser.name) {
                          dbService.saveUser({ ...selectedUser, name: n.trim() });
                        }
                     }} className="text-slate-300 hover:text-blue-500 transition cursor-pointer"><Edit2 size={14}/></button>
                   </h3>
                   <div className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase flex items-center gap-3">
                      <span>{selectedUser.role}</span>
                      <span className="text-blue-400 bg-blue-50 px-2 py-0.5 rounded-full">ID: {selectedUser.uid}</span>
                      <span>Был: {new Date(selectedUser.lastActive).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                   </div>
                </div>
                {canEditUsers && selectedUser.uid !== user.uid && selectedUser.role !== 'root_admin' && (
                  <button onClick={async () => {
                    if (await showConfirm(`Удалить профиль ${selectedUser.name}?`)) {
                      dbService.deleteUser(selectedUser.uid, selectedUser.name);
                      setSelectedUid(null);
                      toast('Профиль удален', 'success');
                    }
                  }} className="bg-rose-50 text-rose-500 rounded-lg p-2 hover:bg-rose-500 hover:text-white transition cursor-pointer">
                    <Trash2 size={16}/>
                  </button>
                )}
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
               <div className="space-y-4">
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                     <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5"><Key size={12}/> ПАРОЛЬ</label>
                     <div className="flex gap-2">
                        <input type="text" readOnly value={selectedUser.password || '—'} className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold w-full"/>
                        {canEditUsers && (
                          <button onClick={async () => {
                            const p = await showPrompt('Новый пароль:', selectedUser.password);
                            if (p && p.trim() !== '') {
                              dbService.saveUser({...selectedUser, password: p.trim()});
                              toast('Пароль обновлен', 'success');
                            }
                          }} className="bg-slate-200 text-slate-600 rounded-xl px-3 hover:bg-blue-100 hover:text-blue-600 transition font-bold text-xs cursor-pointer">Изменить</button>
                        )}
                     </div>
                  </div>
                  
                  <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                     <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5"><ShieldCheck size={12}/> ИЗМЕНИТЬ РОЛЬ</label>
                     <select 
                       value={selectedUser.role} 
                       disabled={!canEditUsers || selectedUser.role === 'root_admin' || (user.role === 'admin' && selectedUser.role === 'root_admin')}
                       onChange={e => {
                         dbService.saveUser({...selectedUser, role: e.target.value as any});
                         toast('Роль обновлена', 'success');
                       }}
                       className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold w-full outline-none disabled:opacity-50 cursor-pointer"
                     >
                       {user.role === 'root_admin' && <option value="root_admin">Root Admin</option>}
                       <option value="admin">Администратор</option>
                       <option value="manager">Менеджер</option>
                       <option value="accountant">Бухгалтер</option>
                       <option value="dispatcher">Диспетчер</option>
                     </select>
                  </div>
               </div>

               <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                 <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono mb-3 flex items-center gap-1.5"><Palette size={12}/> ЦВЕТ АССИГНАЦИИ В ПЛАНЕ ДОХОДА / ЧАТЕ</label>
                 <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                   {DISPATCHER_COLORS_PRESETS.map((p) => {
                     const isSelected = selectedUser.color === p.key;
                     return (
                       <button
                         key={p.key}
                         onClick={() => {
                           if(canEditUsers) {
                             dbService.saveUser({...selectedUser, color: p.key});
                           }
                         }}
                         className={`w-8 h-8 rounded-full border-2 transition flex items-center justify-center ${isSelected ? 'border-slate-800 scale-110 shadow-sm' : 'border-transparent hover:scale-105'} cursor-pointer`}
                         style={{ backgroundColor: p.colorCode }}
                         title={p.name}
                       >
                         {isSelected && <span className="text-[10px] text-white font-black drop-shadow-md pb-0.5">✓</span>}
                       </button>
                     );
                   })}
                 </div>
               </div>
             </div>

             <div>
               <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-3 flex items-center gap-1.5"><ShieldCheck size={12}/> МАТРИЦА ПРАВ ДОСТУПА ПО МОДУЛЯМ</h4>
               
               <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                 {/* Standard modules */}
                 {[
                    {key: 'dashboard', label: 'Главная (Dashboard)'},
                    {key: 'dohod', label: 'Калькуляция Дохода'},
                    {key: 'salary', label: 'ЗП Водителей'},
                    {key: 'planDohod', label: 'План Дохода'},
                    {key: 'planZagruzok', label: 'План Загрузок'},
                    {key: 'currentPlanning', label: 'Текущее Планирование (Сама кнопка)'},
                    {key: 'baza', label: 'Учет выезда (База)'},
                    {key: 'dozvola', label: 'Дозволы'},
                    {key: 'disposition', label: 'Диспозиция'},
                    {key: 'settings', label: 'Справочники'},
                    {key: 'admin', label: 'Администрирование'}
                 ].map(m => {
                    const currentPerm = selectedUser.permissions?.[m.key] || 'none';
                    return (
                      <div key={m.key} className="flex items-center justify-between bg-white border border-slate-200 rounded-xl p-3">
                         <span className="text-xs font-bold text-slate-800 uppercase tracking-tight">{m.label}</span>
                         <span onClick={() => {
                            if (!canEditUsers || selectedUser.role === 'root_admin') return;
                            const next = currentPerm === 'none' ? 'read' : currentPerm === 'read' ? 'write' : 'none';
                            dbService.saveUser({...selectedUser, permissions: {...selectedUser.permissions, [m.key]: next} as any});
                         }} className={`text-[9px] font-mono font-black uppercase tracking-widest px-3 py-1.5 rounded-lg w-[80px] text-center transition ${canEditUsers && selectedUser.role !== 'root_admin' ? 'cursor-pointer' : 'opacity-70'} ${currentPerm === 'write' ? 'bg-emerald-100 text-emerald-800' : currentPerm === 'read' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}>
                           {currentPerm}
                         </span>
                      </div>
                    );
                 })}
                 
                 {/* Dynamic planZagruzok tabs */}
                 {settings?.planZagruzokTabs?.map(t => {
                   const mk = `planZagruzok_${t.id}`;
                   const currentPerm = selectedUser.permissions?.[mk] || 'none';
                   return (
                      <div key={t.id} className="flex items-center justify-between bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                         <span className="text-xs font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
                           {t.name} <span className="text-[9px] bg-white px-2 py-0.5 rounded text-slate-400 font-mono shadow-sm font-black text-emerald-600">Подвкладка п.з.</span>
                         </span>
                         <span onClick={() => {
                            if (!canEditUsers || selectedUser.role === 'root_admin') return;
                            const next = currentPerm === 'none' ? 'read' : currentPerm === 'read' ? 'write' : 'none';
                            dbService.saveUser({...selectedUser, permissions: {...selectedUser.permissions, [mk]: next} as any});
                         }} className={`text-[9px] font-mono font-black uppercase tracking-widest px-3 py-1.5 rounded-lg w-[80px] text-center transition ${canEditUsers && selectedUser.role !== 'root_admin' ? 'cursor-pointer' : 'opacity-70'} ${currentPerm === 'write' ? 'bg-emerald-100 text-emerald-800' : currentPerm === 'read' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}>
                           {currentPerm}
                         </span>
                      </div>
                   );
                 })}

                 {/* Dynamic currentPlanning tabs */}
                 {settings?.currentPlanningTabs?.map(t => {
                   const mk = `currentPlanning_${t.id}`;
                   const currentPerm = selectedUser.permissions?.[mk] || 'none';
                   return (
                      <div key={t.id} className="flex items-center justify-between bg-purple-50 border border-purple-100 rounded-xl p-3">
                         <span className="text-xs font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
                           {t.name} <span className="text-[9px] bg-white px-2 py-0.5 rounded text-slate-400 font-mono shadow-sm">Подвкладка т.п.</span>
                         </span>
                         <span onClick={() => {
                            if (!canEditUsers || selectedUser.role === 'root_admin') return;
                            const next = currentPerm === 'none' ? 'read' : currentPerm === 'read' ? 'write' : 'none';
                            dbService.saveUser({...selectedUser, permissions: {...selectedUser.permissions, [mk]: next} as any});
                         }} className={`text-[9px] font-mono font-black uppercase tracking-widest px-3 py-1.5 rounded-lg w-[80px] text-center transition ${canEditUsers && selectedUser.role !== 'root_admin' ? 'cursor-pointer' : 'opacity-70'} ${currentPerm === 'write' ? 'bg-emerald-100 text-emerald-800' : currentPerm === 'read' ? 'bg-blue-100 text-blue-800' : 'bg-slate-200 text-slate-500 hover:bg-slate-300'}`}>
                           {currentPerm}
                         </span>
                      </div>
                   );
                 })}
               </div>
             </div>

          </div>
        )}

        {!isAdding && !selectedUser && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-10 h-full">
             <ShieldCheck size={48} className="mb-4 opacity-50"/>
             <span className="text-sm font-black uppercase tracking-wider font-mono">Выберите профиль слева</span>
             <span className="text-xs text-slate-400 mt-2">или добавьте новый профиль администратора/диспетчера</span>
          </div>
        )}
      </div>

    </div>
  );
}

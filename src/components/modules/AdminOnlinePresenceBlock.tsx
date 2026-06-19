import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { dbService } from '../../firebase';
import { Users, Clock, Compass, Calendar, RefreshCw, AlertCircle } from 'lucide-react';

interface Props {
  user: UserProfile;
}

interface OnlineUser {
  presenceId: string;
  uid: string;
  name: string;
  role: string;
  currentModule: string;
  lastActive: string;
  loginTime?: string;
}

const MODULE_LABELS: Record<string, string> = {
  dashboard: "Главная",
  dohod: "Калькуляция",
  salary: "Зарплата Водителей",
  planDohod: "План Дохода",
  planZagruzok: "План Загрузок",
  currentPlanning: "Текущее планирование",
  baza: "Учет выезда",
  dozvola: "Учет Дозволов",
  disposition: "Диспозиция",
  documents: "Шаблоны документов",
  settings: "Настройки",
  admin: "Администрирование",
};

export default function AdminOnlinePresenceBlock({ user }: Props) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    let unsubAll = () => {};
    let unsubOnline = () => {};

    try {
      unsubAll = dbService.getUsers((usersList) => {
        setAllUsers(usersList || []);
      });
    } catch (e) {
      console.warn("Failed to subscribe users", e);
    }

    try {
      unsubOnline = dbService.getOnlineUsers((users) => {
        const now = new Date().getTime();
        // Only keep users active in the last 5 minutes to reflect actual presence
        const activeUsers = users.filter((u: any) => {
          const t = new Date(u.lastActive).getTime();
          return (now - t) < 5 * 60 * 1000;
        });
        setOnlineUsers(activeUsers as OnlineUser[]);
        setLoading(false);
      });
    } catch (e) {
      console.warn("Failed to subscribe presence", e);
      setLoading(false);
    }

    return () => {
      if (typeof unsubOnline === 'function') unsubOnline();
      if (typeof unsubAll === 'function') unsubAll();
    };
  }, []);

  const formatDate = (isoStr?: string) => {
    if (!isoStr) return '—';
    try {
      const date = new Date(isoStr);
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return '—';
    }
  };

  const formatTime = (isoStr?: string) => {
    if (!isoStr) return '—';
    try {
      const date = new Date(isoStr);
      return date.toLocaleTimeString('ru-RU', {
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '—';
    }
  };

  const displayUsers = (() => {
    const combined = allUsers.map(profile => {
      const activeSession = onlineUsers.find(o => o.uid === profile.uid);
      return {
        profile,
        isOnline: !!activeSession,
        activeSession
      };
    });

    if (combined.length === 0) {
      return onlineUsers.map(u => ({
        profile: {
          uid: u.uid,
          name: u.name,
          role: u.role,
          email: `${u.name}@ratipa.com`,
          createdAt: u.lastActive,
          password: "",
          permissions: {
            dashboard: "read",
            calculationsHistory: "read"
          },
          lastActive: u.lastActive
        } as any as UserProfile,
        isOnline: true,
        activeSession: u
      }));
    }

    return combined.sort((a, b) => {
      if (a.isOnline && !b.isOnline) return -1;
      if (!a.isOnline && b.isOnline) return 1;
      
      const timeA = new Date(a.isOnline ? (a.activeSession?.lastActive || a.profile.lastActive || 0) : (a.profile.lastActive || 0)).getTime();
      const timeB = new Date(b.isOnline ? (b.activeSession?.lastActive || b.profile.lastActive || 0) : (b.profile.lastActive || 0)).getTime();
      return timeB - timeA;
    });
  })();

  return (
    <div id="admin-presence-block" className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] mt-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-5 select-none">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
          <Users className="h-4.5 w-4.5 text-[#000000]" style={{ fill: '#70FC8E' }} />
          Активность пользователей
        </h2>
        <div className="flex items-center gap-2">
          {onlineUsers.length > 0 && (
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          )}
          <span className="text-[10px] font-black uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1 rounded-full font-mono transition duration-150">
            {onlineUsers.length} онлайн
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-8 text-slate-400">
          <RefreshCw className="h-5 w-5 animate-spin mb-2" />
          <span className="text-[10px] font-black uppercase tracking-wider font-mono">Подключение к сессиям...</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {displayUsers.map(({ profile, isOnline, activeSession }) => {
            const isSelf = profile.uid === user.uid;

            if (isOnline && activeSession) {
              const moduleName = MODULE_LABELS[activeSession.currentModule] || activeSession.currentModule || 'Главная';
              return (
                <div 
                  key={profile.uid} 
                  className={`relative p-5 border rounded-2xl transition duration-155 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] ${
                    isSelf 
                      ? 'bg-[#70FC8E]/5 border-[#70FC8E]/30' 
                      : 'bg-slate-50 border-slate-200/65 hover:bg-white'
                  }`}
                >
                  <span className="absolute top-4 right-4 flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>

                  <div className="flex items-start justify-between gap-2 mb-3 pr-4">
                    <div className="flex flex-col">
                      <span className="font-extrabold text-[#111827] text-sm break-all leading-snug flex items-center gap-1.5 font-sans">
                        👤 {profile.name}
                        {isSelf && (
                          <span className="text-[9px] bg-indigo-600 text-white font-mono uppercase px-1.5 py-0.5 rounded font-black">
                            Вы
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-mono text-slate-405 uppercase tracking-widest mt-0.5 font-bold">
                        {profile.role === 'admin' ? 'Администратор' : profile.role === 'manager' ? 'Логист' : profile.role === 'root_admin' ? 'Разработчик / Root' : profile.role}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-2 border-t border-slate-250/25 pt-3.5 text-xs font-mono">
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                        <Calendar size={10} className="text-slate-400" /> Дата
                      </span>
                      <span className="font-extrabold text-slate-700 leading-tight">
                        {formatDate(activeSession.loginTime || activeSession.lastActive)}
                      </span>
                    </div>

                    <div className="flex flex-col col-span-1">
                      <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                        <Clock size={10} className="text-slate-400" /> Вход
                      </span>
                      <span className="font-extrabold text-slate-700 leading-tight">
                        {formatTime(activeSession.loginTime || activeSession.lastActive)}
                      </span>
                    </div>

                    <div className="flex flex-col col-span-1">
                      <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                        <Clock size={10} className="text-slate-400" /> Активность
                      </span>
                      <span className="font-extrabold text-slate-500 leading-tight">
                        {formatTime(activeSession.lastActive)}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 bg-slate-950 text-[#70FC8E] p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                    <span className="text-[8px] font-mono font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                      <Compass size={11} className="text-slate-400" /> Смотрит вкладку:
                    </span>
                    <span className="text-[10px] font-black uppercase tracking-widest font-mono text-white max-w-[50%] truncate animate-pulse font-bold">
                      {moduleName}
                    </span>
                  </div>
                </div>
              );
            } else {
              const lastActiveIso = profile.lastActive || profile.createdAt;
              const offlineDate = lastActiveIso ? formatDate(lastActiveIso) : 'Неизвестно';
              const offlineTime = lastActiveIso ? formatTime(lastActiveIso) : '—';

              return (
                <div 
                  key={profile.uid} 
                  className="relative p-5 border border-slate-200/40 rounded-2xl bg-slate-50/50 text-slate-500 transition duration-150 hover:bg-slate-100/40"
                >
                  <span className="absolute top-4 right-4 flex h-2 w-2">
                    <span className="inline-flex rounded-full h-2 w-2 bg-slate-300"></span>
                  </span>

                  <div className="flex items-start justify-between gap-2 mb-3 pr-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-700 text-sm break-all leading-snug flex items-center gap-1.5 font-sans">
                        👤 {profile.name}
                        {isSelf && (
                          <span className="text-[9px] bg-indigo-400 text-white font-mono uppercase px-1.5 py-0.5 rounded font-black">
                            Вы
                          </span>
                        )}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest mt-0.5">
                        {profile.role === 'admin' ? 'Администратор' : profile.role === 'manager' ? 'Логист' : profile.role === 'root_admin' ? 'Разработчик / Root' : profile.role}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-slate-200/40 pt-3.5 text-xs font-mono">
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                        <Calendar size={10} className="text-slate-400" /> Дата визита
                      </span>
                      <span className="font-bold text-slate-600 leading-tight">
                        {offlineDate}
                      </span>
                    </div>

                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                        <Clock size={10} className="text-slate-400" /> Время визита
                      </span>
                      <span className="font-bold text-slate-600 leading-tight">
                        {offlineTime}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 bg-slate-100/60 text-slate-500 p-2.5 rounded-xl border border-slate-250/20 flex items-center justify-between font-mono text-[9px] uppercase tracking-widest font-black">
                    <span>Был в сети:</span>
                    <span className="text-slate-600 font-bold">
                      {offlineDate} {offlineTime !== '—' ? `в ${offlineTime}` : ''}
                    </span>
                  </div>
                </div>
              );
            }
          })}

          {displayUsers.length === 0 && (
            <div className="md:col-span-2 text-center py-10 bg-slate-50 border border-slate-100 rounded-2xl">
              <AlertCircle className="h-6 w-6 text-slate-350 mx-auto mb-2" />
              <div className="text-[10px] uppercase font-mono font-black tracking-widest text-slate-400">
                Пользователи не найдены
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

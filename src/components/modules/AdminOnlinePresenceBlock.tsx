import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { dbService } from '../../firebase';
import { Users, Clock, Compass, Calendar, RefreshCw, Shield, AlertCircle } from 'lucide-react';

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
  settings: "Настройки",
  admin: "Администрирование",
};

export default function AdminOnlinePresenceBlock({ user }: Props) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const unsubscribeOnline = dbService.getOnlineUsers((users) => {
      const now = new Date().getTime();
      // Only keep users active in the last 5 minutes to reflect actual presence
      const activeUsers = users.filter((u: any) => {
        const t = new Date(u.lastActive).getTime();
        return (now - t) < 5 * 60 * 1000;
      });
      setOnlineUsers(activeUsers as OnlineUser[]);
      setLoading(false);
    });

    return () => {
      if (typeof unsubscribeOnline === 'function') {
        unsubscribeOnline();
      }
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

  return (
    <div id="admin-presence-block" className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] mt-6">
      <div className="flex items-center justify-between border-b border-slate-100 pb-3.5 mb-5 select-none">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
          <Users className="h-4.5 w-4.5 text-[#000000]" style={{ fill: '#70FC8E' }} />
          Кто сейчас онлайн
        </h2>
        <div className="flex items-center gap-2">
          {onlineUsers.length > 0 && (
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
          )}
          <span className="text-[10px] font-black uppercase tracking-wider bg-slate-100 hover:bg-slate-200 text-slate-600 px-2.5 py-1 rounded-full font-mono transition duration-150">
            {onlineUsers.length} {onlineUsers.length === 1 ? 'активен' : 'активно'}
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
          {onlineUsers.map((u) => {
            const isSelf = u.uid === user.uid;
            const moduleName = MODULE_LABELS[u.currentModule] || u.currentModule || 'Главная';
            
            return (
              <div 
                key={u.presenceId} 
                className={`relative p-5 border rounded-2xl transition duration-150 hover:shadow-[0_4px_20px_rgba(0,0,0,0.02)] ${
                  isSelf 
                    ? 'bg-[#70FC8E]/5 border-[#70FC8E]/30' 
                    : 'bg-slate-50 border-slate-200/65 hover:bg-white'
                }`}
              >
                {/* Header detail with name and role */}
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div className="flex flex-col">
                    <span className="font-extrabold text-[#111827] text-sm break-all leading-snug flex items-center gap-1.5">
                      👤 {u.name}
                      {isSelf && (
                        <span className="text-[9px] bg-indigo-600 text-white font-mono uppercase px-1.5 py-0.5 rounded font-black">
                          Вы
                        </span>
                      )}
                    </span>
                    <span className="text-[10px] font-mono text-slate-400 uppercase tracking-widest mt-0.5 font-bold">
                      {u.role === 'admin' ? 'Администратор' : u.role === 'manager' ? 'Логист / Менеджер' : u.role}
                    </span>
                  </div>
                  
                  <span className={`text-[9px] font-mono uppercase font-black px-2 py-0.5 rounded-full ${
                    u.role === 'admin' 
                      ? 'bg-rose-50 text-rose-600 border border-rose-100' 
                      : 'bg-blue-50 text-blue-600 border border-blue-100'
                  }`}>
                    {u.role}
                  </span>
                </div>

                {/* Grid analytics of activity */}
                <div className="grid grid-cols-3 gap-2 border-t border-slate-250/25 pt-3.5 text-xs">
                  <div className="flex flex-col">
                    <span className="text-[9px] font-mono uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                      <Calendar size={10} className="text-slate-400" /> Дата
                    </span>
                    <span className="font-extrabold text-slate-700 leading-tight">
                      {formatDate(u.loginTime || u.lastActive)}
                    </span>
                  </div>

                  <div className="flex flex-col col-span-1">
                    <span className="text-[9px] font-mono uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                      <Clock size={10} className="text-slate-400" /> Заход
                    </span>
                    <span className="font-extrabold text-slate-700 leading-tight">
                      {formatTime(u.loginTime || u.lastActive)}
                    </span>
                  </div>

                  <div className="flex flex-col col-span-1">
                    <span className="text-[9px] font-mono uppercase font-black text-slate-400 tracking-wider flex items-center gap-1 mb-0.5">
                      <Clock size={10} className="text-slate-400" /> Активность
                    </span>
                    <span className="font-extrabold text-slate-500 leading-tight">
                      {formatTime(u.lastActive)}
                    </span>
                  </div>
                </div>

                {/* Target view / Current location info */}
                <div className="mt-4 bg-slate-950 text-[#70FC8E] p-3 rounded-xl border border-slate-800 flex items-center justify-between">
                  <span className="text-[8px] font-mono font-black uppercase tracking-widest text-slate-400 flex items-center gap-1">
                    <Compass size={11} className="text-slate-400" /> Смотрит вкладку:
                  </span>
                  <span className="text-[10px] font-black uppercase tracking-widest font-mono text-white max-w-[50%] truncate">
                    {moduleName}
                  </span>
                </div>
              </div>
            );
          })}

          {onlineUsers.length === 0 && (
            <div className="md:col-span-2 text-center py-10 bg-slate-50 border border-slate-100 rounded-2xl">
              <AlertCircle className="h-6 w-6 text-slate-350 mx-auto mb-2" />
              <div className="text-[10px] uppercase font-mono font-black tracking-widest text-slate-400">
                Никого нет в сети
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

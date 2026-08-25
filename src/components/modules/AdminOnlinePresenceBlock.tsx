import {useState, useEffect, useRef} from 'react'
import {UserProfile} from '../../types'
import {dbService} from '../../api'
import {Clock, Compass, RefreshCw, History} from 'lucide-react'

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

export default function AdminOnlinePresenceBlock({ user }: Props) {
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [allUsers, setAllUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const prevOnlineRef = useRef<string>('');

  useEffect(() => {
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
        const activeUsers = users.filter((u: any) => {
          const t = new Date(u.lastActive).getTime();
          return (now - t) < 5 * 60 * 1000;
        }) as OnlineUser[];

        // Стабилизация: не обновляем состояние, если список не изменился
        const key = activeUsers.map(u => u.uid + ':' + u.currentModule + ':' + u.lastActive).join('|');
        if (key !== prevOnlineRef.current) {
          prevOnlineRef.current = key;
          setOnlineUsers(activeUsers);
        }
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

  const formatLastSeen = (isoStr?: string) => {
    if (!isoStr) return 'Никогда';
    try {
      const date = new Date(isoStr);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / (60 * 1000));
      
      if (diffMin < 1) return 'Только что';
      if (diffMin < 60) return `${diffMin} мин. назад`;
      
      // Сравниваем по календарной дате (день), а не по 24-часовому окну
      const isSameDay = date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      
      if (isSameDay) {
        return `Сегодня в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      }
      
      // Вчера?
      const yesterday = new Date(now);
      yesterday.setDate(now.getDate() - 1);
      const isYesterday = date.getFullYear() === yesterday.getFullYear() &&
        date.getMonth() === yesterday.getMonth() &&
        date.getDate() === yesterday.getDate();
      if (isYesterday) {
        return `Вчера в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      }
      
      return date.toLocaleString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
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

  // Divide users into online and offline
  const onlineUids = new Set(onlineUsers.map(o => o.uid));
  
  const onlineList = allUsers
    .filter(u => onlineUids.has(u.uid))
    .map(u => {
      const session = onlineUsers.find(o => o.uid === u.uid);
      return { user: u, session };
    });

  const offlineList = allUsers
    .filter(u => !onlineUids.has(u.uid))
    .sort((a, b) => {
      const timeA = new Date(a.lastActive || a.createdAt || 0).getTime();
      const timeB = new Date(b.lastActive || b.createdAt || 0).getTime();
      return timeB - timeA;
    });

  return (
    <div id="admin-presence-block" className="bg-white/40 backdrop-blur-xl rounded-[1.8rem] p-6 lg:p-8 border border-white/45 shadow-sm space-y-8 select-none">
      
      {/* Block Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-white/40 pb-5">
        <div>
          <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[9px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1.5 inline-block">
            Presence Monitor
          </span>
          <h2 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-1.5">
            <Compass className="h-4.5 w-4.5 text-[#3765F6]" />
            Активность сотрудников Ratipa
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[10px] font-bold tracking-wider font-mono bg-white/60 border border-white/50 px-3.5 py-1.5 rounded-xl text-slate-700 shadow-sm">
            {onlineUsers.length} онлайн
          </span>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-12 text-slate-400">
          <RefreshCw className="h-5 w-5 animate-spin mb-2 text-[#3765F6]" />
          <span className="text-[10px] font-semibold tracking-wider font-mono text-slate-500">Подключение к сессиям...</span>
        </div>
      ) : (
        <div className="space-y-8">
          
          {/* 1. ACTIVE SESSIONS (ONLINE) */}
          <div className="space-y-4">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 font-mono flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Активные сессии в системе ({onlineList.length})
            </h3>
            
            {onlineList.length === 0 ? (
              <div className="p-6 text-center bg-white/10 rounded-2xl border border-dashed border-white/30 text-slate-400 text-xs font-semibold leading-relaxed">
                В данный момент в системе нет других активных сотрудников.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {onlineList.map(({ user: u, session }) => {
                  const isSelf = u.uid === user.uid;
                  const currentMod = session?.currentModule || 'dashboard';
                  const moduleLabel = MODULE_LABELS[currentMod] || currentMod;
                  const initial = (u.name || "").charAt(0).toUpperCase();
                  const roleLabel = ROLE_LABELS[u.role] || u.role;
 
                  return (
                    <div 
                      key={u.uid}
                      className={`relative p-4 rounded-[1.5rem] border transition-all duration-150 flex flex-col justify-between ${
                        isSelf 
                          ? 'bg-[#3765F6]/10 border-[#3765F6]/20 shadow-sm' 
                          : 'bg-white/65 border-white/50 shadow-xs'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {/* Avatar */}
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0 border select-none ${
                          isSelf ? 'bg-[#3765F6] text-white border-[#3765F6]/30' : 'bg-slate-900/5 text-slate-700 border-slate-900/10'
                        }`}>
                          {initial}
                        </div>
                        
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-black text-slate-900 truncate">
                              {u.name}
                            </span>
                            {isSelf && (
                              <span className="bg-[#3765F6] text-white font-mono text-[7.5px] font-black px-1.5 py-0.5 rounded-md uppercase tracking-wider shrink-0 scale-95">
                                Вы
                              </span>
                            )}
                          </div>
                          <span className="text-[9px] font-bold font-mono uppercase tracking-widest text-slate-400 block mt-0.5">
                            {roleLabel}
                          </span>
                        </div>
                      </div>
 
                      {/* Clean Activity Info */}
                      <div className="mt-4 pt-3 border-t border-slate-200/40 flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[10px] font-medium text-slate-500">
                          <span className="flex items-center gap-1 text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400">
                            <Clock size={11} className="text-slate-400" /> Активен в
                          </span>
                          <span className="font-mono font-bold text-slate-700">
                            {formatTime(session?.lastActive)}
                          </span>
                        </div>
                        
                        <div className="bg-[#3765F6]/5 border border-[#3765F6]/10 p-2 rounded-xl flex items-center justify-between text-[10.5px]">
                          <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1">
                            <Compass size={11} className="text-[#3765F6]" /> Раздел:
                          </span>
                          <span className="font-extrabold text-[#1e3bb3] font-sans truncate max-w-[60%]">
                            {moduleLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
 
          {/* 2. RECENT ACTIVITY (HISTORY) */}
          <div className="space-y-4 pt-2">
            <h3 className="text-xs font-semibold tracking-wide text-slate-500 font-mono flex items-center gap-2">
              <History size={13} className="text-slate-400" />
              История активности сотрудников ({offlineList.length})
            </h3>

            <div className="bg-white/30 rounded-2xl border border-white/40 overflow-hidden shadow-xs">
              <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                {offlineList.length === 0 ? (
                  <div className="p-6 text-center text-slate-400 text-xs font-semibold">
                    Нет истории активности.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100/40">
                    {offlineList.map((u) => {
                      const lastSeenStr = formatLastSeen(u.lastActive || u.createdAt);
                      const initial = (u.name || "").charAt(0).toUpperCase();
                      const roleLabel = ROLE_LABELS[u.role] || u.role;

                      return (
                        <div 
                          key={u.uid}
                          className="flex items-center justify-between p-3.5 hover:bg-white/40 transition duration-150"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-7.5 h-7.5 rounded-lg bg-slate-100/80 border border-slate-200/50 text-slate-500 flex items-center justify-center font-black text-[11px] shrink-0">
                              {initial}
                            </div>
                            <div className="min-w-0">
                              <span className="text-xs font-extrabold text-slate-800 block truncate">
                                {u.name}
                              </span>
                              <span className="text-[8.5px] font-bold font-mono uppercase tracking-widest text-slate-400 block">
                                {roleLabel}
                              </span>
                            </div>
                          </div>
                          
                          <div className="text-right shrink-0">
                            <span className="text-[9px] font-mono font-bold uppercase tracking-wider text-slate-400 block mb-0.5">
                              Был в сети
                            </span>
                            <span className="text-xs font-bold text-slate-600 font-sans">
                              {lastSeenStr}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

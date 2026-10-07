import {useState, useEffect, useRef} from 'react'

import { getUserFullName } from '../../utils/userName';import {UserProfile, AuditLog} from '../../types'
import UserAvatar from '../UserAvatar'
import {dbService} from '../../api'
import {Clock, Compass, RefreshCw, Activity} from 'lucide-react'
import { UI } from '../../ui/kit';
import { SectionHeader, StatusText } from '../../ui/components';

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
  vehicleDriverData: "Авто и Водители",
  dozvola: "Учет Дозволов",
  disposition: "Диспозиция",
  documents: "Шаблоны документов",
  instructions: "Инструкции",
  appSettings: "Справочники",
  settings: "База данных",
  bookIssue: "Книга выдачи",
  tabel: "Табель",
  mdpJournal: "Журнал МДП",
  driverExpenses: "Расходы водителей",
  bookIssueRR: "Книга выдачи РР",
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
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const prevOnlineRef = useRef<string>('');
  const onlineDebounceRef = useRef<any>(null);

  useEffect(() => {
    let unsubOnline = () => {};
    let unsubLogs = () => {};
    let unsubUsers = () => {};

    // Подписка на список пользователей
    unsubUsers = dbService.getUsers((usersList) => {
      setAllUsers(usersList || []);
    });

    // Подписка на аудит лог (последние 100 записей)
    unsubLogs = dbService.getAuditLogs((logs) => {
      setAuditLogs(logs || []);
    });

    // Подписка на онлайн-присутствие
    try {
      unsubOnline = dbService.getOnlineUsers((users) => {
        const now = new Date().getTime();
        const activeUsers = users.filter((u: any) => {
          const t = new Date(u.lastActive).getTime();
          return (now - t) < 5 * 60 * 1000;
        }) as OnlineUser[];

        const key = activeUsers.map(u => u.uid + ':' + u.currentModule + ':' + u.lastActive).join('|');
        if (key !== prevOnlineRef.current) {
          prevOnlineRef.current = key;
          if (onlineDebounceRef.current) clearTimeout(onlineDebounceRef.current);
          onlineDebounceRef.current = setTimeout(() => {
            setOnlineUsers(activeUsers);
          }, 2000);
        }
        setLoading(false);
      });
    } catch (e) {
      console.warn("Failed to subscribe presence", e);
      setLoading(false);
    }

    return () => {
      if (typeof unsubOnline === 'function') unsubOnline();
      if (typeof unsubLogs === 'function') unsubLogs();
      if (typeof unsubUsers === 'function') unsubUsers();
      if (onlineDebounceRef.current) clearTimeout(onlineDebounceRef.current);
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
      
      const isSameDay = date.getFullYear() === now.getFullYear() &&
        date.getMonth() === now.getMonth() &&
        date.getDate() === now.getDate();
      
      if (isSameDay) {
        return `Сегодня в ${date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
      }
      
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
      }).replace(/\./g, '/').replace(/,\s*/, ' ');
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

  const formatLogDate = (dateVal: string) => {
    if (!dateVal) return '';
    try {
      const d = new Date(dateVal);
      return d.toLocaleDateString('ru-RU').replace(/\./g, '/') + ' ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateVal;
    }
  };

  const onlineUids = new Set(onlineUsers.map(o => o.uid));
  
  const onlineList = allUsers
    .filter(u => onlineUids.has(u.uid))
    .map(u => {
      const session = onlineUsers.find(o => o.uid === u.uid);
      return { user: u, session: session as any };
    });

  // Последние 30 действий из аудит-лога
  const recentActivity = auditLogs.slice(0, 30);

  return (
    <div id="admin-presence-block" className="flex flex-col gap-6">
      
      {/* Заголовок блока */}
      <SectionHeader
        icon={<Compass className="w-4 h-4" />}
        tone="graphite"
        title="Активность сотрудников"
      >
        <span className="inline-flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          <span className="text-[11px] font-medium text-[#4B5563]">
            {onlineUsers.length} онлайн
          </span>
        </span>
      </SectionHeader>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-xs text-[#6B7280]">
          <RefreshCw className="h-4 w-4 animate-spin" />
          Подключение к сессиям...
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          
          {/* 1. АКТИВНЫЕ СЕССИИ */}
          <div className="flex flex-col gap-3">
            <div className={`${UI.caption} flex items-center gap-2`}>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              Активные сессии в системе ({onlineList.length})
            </div>
            
            {onlineList.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6B7280]">
                В данный момент в системе нет других активных сотрудников.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {onlineList.map(({ user: u, session }) => {
                  const isSelf = u.uid === user.uid;
                  const currentMod = session?.currentModule || 'dashboard';
                  const moduleLabel = MODULE_LABELS[currentMod] || currentMod;
                  const roleLabel = ROLE_LABELS[u.role] || u.role;

                  return (
                    <div 
                      key={u.uid}
                      className={`bg-white border rounded-xl p-3.5 flex flex-col justify-between transition-colors ${
                        isSelf ? 'border-[var(--accent-30)]' : 'border-[#E5E7EB]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <UserAvatar
                          name={getUserFullName(u)}
                          firstName={u.firstName}
                          lastName={u.lastName}
                          color={u.color}
                          photo={u.avatarPhoto}
                          size={36}
                        />
                        
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-[#121316] truncate">
                              {getUserFullName(u)}
                            </span>
                            {isSelf && (
                              <span className="bg-[#121316] text-white font-mono text-[10px] leading-none px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                                Вы
                              </span>
                            )}
                          </div>
                          <span className="text-[10px] text-[#6B7280] block mt-0.5">
                            {roleLabel}
                          </span>
                        </div>
                      </div>

                      <div className="mt-3 pt-2.5 border-t border-[#E5E7EB] flex flex-col gap-2">
                        <div className="flex items-center justify-between text-[11px] text-[#6B7280]">
                          <span className="inline-flex items-center gap-1.5">
                            <Clock size={11} className="text-[#9CA3AF]" /> Активен в
                          </span>
                          <span className="font-mono font-semibold text-[#4B5563]">
                            {formatTime(session?.lastActive)}
                          </span>
                        </div>
                        
                        <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-lg px-2 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1.5 text-[#9CA3AF]">
                            <Compass size={11} /> Раздел:
                          </span>
                          <span className="font-medium text-[#4B5563] truncate">
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

          {/* 2. ПОСЛЕДНИЕ ДЕЙСТВИЯ */}
          <div className="flex flex-col gap-3">
            <div className={`${UI.caption} flex items-center gap-2`}>
              <Activity size={13} className="text-[#9CA3AF]" />
              Последние действия в системе ({recentActivity.length})
            </div>

            <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
              {recentActivity.length === 0 ? (
                <div className="py-8 text-center text-xs text-[#6B7280]">
                  Нет записей активности.
                </div>
              ) : (
                recentActivity.map((log, i) => {
                  const actionType = (log.actionType || '').toLowerCase();
                  const isCreate = actionType.includes('create') || actionType.includes('добав') || actionType.includes('созда');
                  const isDelete = actionType.includes('delete') || actionType.includes('удал');
                  const isEdit = actionType.includes('update') || actionType.includes('измен') || actionType.includes('сохран');
                  const actionColor = isCreate ? 'emerald' : isDelete ? 'rose' : isEdit ? 'blue' : 'grey';

                  return (
                    <div 
                      key={log.id || i}
                      className="flex items-start gap-3 px-3 py-2.5 border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-semibold text-[#121316]">
                            {log.user || 'Система'}
                          </span>
                          <StatusText color={actionColor as any}>
                            {log.actionType || '—'}
                          </StatusText>
                        </div>
                        <span className="text-[11px] text-[#6B7280] block mt-0.5 leading-relaxed">
                          {log.details || log.module || ''}
                        </span>
                        <span className="text-[11px] font-mono text-[#9CA3AF] block mt-0.5">
                          {formatLogDate(log.date)}
                        </span>
                      </div>
                      {log.module && (
                        <span className={`${UI.chip} shrink-0`}>
                          {log.module}
                        </span>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* 3. ВСЕ СОТРУДНИКИ — ПОСЛЕДНЯЯ АКТИВНОСТЬ */}
          <div className="flex flex-col gap-3">
            <div className={`${UI.caption} flex items-center gap-2`}>
              <Clock size={13} className="text-[#9CA3AF]" />
              Все сотрудники — последняя активность ({allUsers.length})
            </div>

            {allUsers.length === 0 ? (
              <div className="py-8 text-center text-xs text-[#6B7280]">
                Нет пользователей.
              </div>
            ) : (
              <div className={UI.tableWrap}>
                <table className={UI.table}>
                  <thead>
                    <tr className={UI.theadRow}>
                      <th className={UI.th}>Сотрудник</th>
                      <th className={UI.th}>Роль</th>
                      <th className={UI.th}>Состояние</th>
                      <th className={UI.th}>Последняя активность</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...allUsers]
                      .sort((a, b) => {
                        const aOnline = onlineUids.has(a.uid) ? 1 : 0;
                        const bOnline = onlineUids.has(b.uid) ? 1 : 0;
                        if (aOnline !== bOnline) return bOnline - aOnline;
                        return (b.lastActive || '').localeCompare(a.lastActive || '');
                      })
                      .map((u) => {
                        const isOnline = onlineUids.has(u.uid);
                        const isSelf = u.uid === user.uid;
                        const roleLabel = ROLE_LABELS[u.role] || u.role;

                        return (
                          <tr key={u.uid} className={UI.tr}>
                            <td className={UI.td}>
                              <div className="flex items-center gap-2.5 min-w-0">
                                <UserAvatar
                                  name={getUserFullName(u)}
                                  firstName={u.firstName}
                                  lastName={u.lastName}
                                  color={u.color}
                                  photo={u.avatarPhoto}
                                  size={28}
                                  textClassName="text-[10px]"
                                />
                                <span className="text-xs font-semibold text-[#121316] truncate">
                                  {getUserFullName(u)}
                                </span>
                                {isSelf && (
                                  <span className="bg-[#121316] text-white font-mono text-[10px] leading-none px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">
                                    Вы
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className={UI.td}>{roleLabel}</td>
                            <td className={UI.td}>
                              <StatusText color={isOnline ? 'emerald' : 'grey'}>
                                {isOnline ? 'В системе' : formatLastSeen(u.lastActive)}
                              </StatusText>
                            </td>
                            <td className={UI.tdMono}>{formatTime(u.lastActive)}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

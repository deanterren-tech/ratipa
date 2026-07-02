import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { dbService } from '../../firebase';
import { Send, Trash2, Users, BellRing, Clock, Check, UserCheck } from 'lucide-react';
import { useDialog } from '../DialogProvider';

interface Props {
  user: UserProfile;
}

export default function AdminPushNotificationsBlock({ user }: Props) {
  const { showConfirm } = useDialog();
  const [notifText, setNotifText] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [expandedNotifId, setExpandedNotifId] = useState<string | null>(null);

  useEffect(() => {
    return dbService.getBroadcastNotifications(setNotifications);
  }, []);

  const handleSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!notifText.trim()) return;

    dbService.sendBroadcastNotification(notifText.trim(), user.name, user.name, user.role);
    setNotifText('');
  };

  const handleDelete = async (id: string) => {
    const confirmed = await showConfirm('Вы уверены, что хотите удалить это уведомление?', 'Удаление');
    if (confirmed) {
      dbService.deleteBroadcastNotification(id, user.name, user.role);
    }
  };

  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) + ' ' + date.toLocaleDateString('ru-RU');
    } catch {
      return isoString;
    }
  };

  return (
    <div className="space-y-6">
      {/* Compose Notification Card */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
        <div className="flex items-center gap-2 pb-4 mb-5 border-b border-slate-100">
          <div className="p-2.5 bg-emerald-50 text-emerald-600 rounded-2xl">
            <BellRing className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-sm font-black uppercase tracking-tight text-slate-900">
              Новое Push-уведомление
            </h2>
            <p className="text-[10px] text-slate-500 font-medium">
              Оно появится справа сверху у всех пользователей в реальном времени. Закрывается пользователями вручную.
            </p>
          </div>
        </div>

        <form onSubmit={handleSend} className="space-y-4">
          <div>
            <textarea
              value={notifText}
              onChange={(e) => setNotifText(e.target.value)}
              placeholder="Введите важное объявление или распоряжение, которое увидят абсолютно все сотрудники..."
              className="w-full text-xs p-4 bg-slate-50 border border-slate-200 rounded-2xl outline-none focus:border-slate-400 focus:bg-white transition-all font-sans min-h-[100px] resize-y"
              required
            />
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!notifText.trim()}
              className="px-5 py-2.5 bg-slate-950 text-white hover:bg-slate-900 disabled:bg-slate-200 disabled:text-slate-400 font-extrabold uppercase tracking-widest text-[9.5px] rounded-xl flex items-center gap-2 shadow-xs cursor-pointer transition-all duration-150"
            >
              <Send className="h-3.5 w-3.5" />
              Отправить всем на экран
            </button>
          </div>
        </form>
      </div>

      {/* History & Read tracking */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
        <h3 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono mb-4 flex items-center gap-1.5 border-b border-slate-100 pb-3">
          <Clock className="h-4 w-4 text-slate-400" />
          История отправленных push-уведомлений
        </h3>

        {notifications.length === 0 ? (
          <div className="text-center py-10">
            <span className="text-xs text-slate-400 font-medium">Отправленных push-уведомлений пока нет</span>
          </div>
        ) : (
          <div className="space-y-4">
            {notifications.map((notif) => {
              const readUsers = Object.entries(notif.readBy || {});
              const isExpanded = expandedNotifId === notif.id;

              return (
                <div
                  key={notif.id}
                  className="bg-slate-50/50 border border-slate-200/40 rounded-2xl p-4.5 transition-all duration-150 hover:border-slate-300/60"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1.5 flex-1">
                      <p className="text-xs text-slate-900 font-medium leading-relaxed whitespace-pre-wrap">
                        {notif.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-3 text-[10px] text-slate-400 font-semibold font-mono">
                        <span className="text-slate-500">Отправитель: {notif.createdBy}</span>
                        <span>•</span>
                        <span>{formatTime(notif.createdAt)}</span>
                      </div>
                    </div>

                    <button
                      onClick={() => handleDelete(notif.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer shrink-0"
                      title="Удалить уведомление"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Read statistics */}
                  <div className="mt-3.5 pt-3.5 border-t border-slate-200/40 flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => setExpandedNotifId(isExpanded ? null : notif.id)}
                      className="flex items-center gap-2 self-start text-[10.5px] font-bold text-slate-600 hover:text-slate-900 transition-colors select-none cursor-pointer"
                    >
                      <Users className="h-3.5 w-3.5 text-slate-400" />
                      <span>Прочитано пользователей:</span>
                      <span className="px-2 py-0.5 bg-slate-200/60 text-slate-800 font-extrabold rounded-full text-[9px] font-mono">
                        {readUsers.length}
                      </span>
                      <span className="text-[9px] text-slate-400 font-medium">
                        (Нажмите для {isExpanded ? 'скрытия' : 'просмотра'})
                      </span>
                    </button>

                    {isExpanded && (
                      <div className="mt-2 pl-1 animate-in fade-in slide-in-from-top-1 duration-100">
                        {readUsers.length === 0 ? (
                          <span className="text-[10px] text-slate-400 font-medium italic block">
                            Пока никто не прочитал это уведомление.
                          </span>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-1.5 pt-1">
                            {readUsers.map(([uid, details]: [string, any]) => (
                              <div
                                key={uid}
                                className="flex items-center gap-2 bg-white border border-slate-100 rounded-xl px-2.5 py-1.5 text-[10px]"
                              >
                                <div className="p-0.5 bg-emerald-50 text-emerald-600 rounded-md">
                                  <UserCheck className="h-3 w-3" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <span className="font-extrabold text-slate-800 block truncate leading-none">
                                    {details.username}
                                  </span>
                                  <span className="text-[8.5px] text-slate-400 font-mono leading-none mt-0.5 block">
                                    {new Date(details.readAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

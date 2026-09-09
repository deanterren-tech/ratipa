import { useState, useEffect } from "react";
import { dbService } from "../../api";
import { UserProfile } from "../../types";
import { Send, Trash2, CheckCheck, Bell, BellRing, Info, AlertTriangle, AlertCircle, Check, Eye, EyeOff, X, Loader2 } from "lucide-react";

interface BroadcastItem {
  id: string;
  text: string;
  createdAt: string;
  createdBy: string;
  readBy: Record<string, { username: string; readAt: string }>;
  targetRoles?: string[];
  type?: string;
}

const ROLE_LABELS: Record<string, string> = {
  root_admin: "Root Админ",
  admin: "Админ",
  manager: "Менеджер",
  dispatcher: "Диспетчер",
  accountant: "Бухгалтер",
  mechanic: "Механик",
  viewer: "Наблюдатель",
  logist: "Логист",
};

const TYPE_CONFIG = {
  info: { icon: Info, color: "text-blue-600", bg: "bg-blue-500/10 border-blue-500/20", label: "Информация" },
  warning: { icon: AlertTriangle, color: "text-amber-600", bg: "bg-amber-500/10 border-amber-500/20", label: "Предупреждение" },
  success: { icon: Check, color: "text-emerald-600", bg: "bg-emerald-500/10 border-emerald-500/20", label: "Успех" },
  alert: { icon: AlertCircle, color: "text-rose-600", bg: "bg-rose-500/10 border-rose-500/20", label: "Срочно" },
};

export default function AdminBroadcastBlock({ user }: { user: UserProfile }) {
  const [broadcasts, setBroadcasts] = useState<BroadcastItem[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [selectedRoles, setSelectedRoles] = useState<string[]>(["dispatcher", "root_admin", "admin", "manager", "accountant", "logist"]);
  const [notifType, setNotifType] = useState<"info" | "warning" | "success" | "alert">("info");
  const [sending, setSending] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    const unsubBroadcasts = dbService.getBroadcastNotifications(setBroadcasts);
    const unsubUsers = dbService.getUsers(setUsers);
    return () => { unsubBroadcasts(); unsubUsers(); };
  }, []);

  const handleSend = async () => {
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      await dbService.sendBroadcastNotification(
        text.trim(),
        user.name,
        user.name,
        user.role,
        selectedRoles.length === Object.keys(ROLE_LABELS).length ? [] : selectedRoles,
        notifType
      );
      setText("");
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    } catch (e) {
      console.error("Send failed", e);
    }
    setSending(false);
  };

  const handleDelete = async (id: string) => {
    await dbService.deleteBroadcastNotification(id, user.name, user.role);
  };

  const toggleRole = (role: string) => {
    setSelectedRoles(prev =>
      prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]
    );
  };

  const selectAll = () => setSelectedRoles(Object.keys(ROLE_LABELS));
  const deselectAll = () => setSelectedRoles([]);

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleString("ru-RU", {
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      }).replace(",", "");
    } catch { return d; }
  };

  const TypeIcon = TYPE_CONFIG[notifType].icon;

  return (
    <div className="space-y-6">
      {/* COMPOSE */}
      <div className="bg-white rounded-2xl border border-slate-200/50 shadow-sm p-5 space-y-4">
        <div className="flex items-center gap-2">
          <BellRing className="w-4 h-4 text-slate-600" />
          <h2 className="text-sm font-bold text-slate-900">Создать всплывающее уведомление</h2>
        </div>

        {/* Type selector */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const active = notifType === key;
            return (
              <button
                key={key}
                onClick={() => setNotifType(key as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition cursor-pointer ${
                  active ? `${cfg.bg} ${cfg.color}` : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                }`}
              >
                <Icon className="w-3 h-3" />
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Text input */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Текст уведомления..."
          className="w-full text-xs bg-slate-50 border border-slate-200/60 rounded-xl px-3 py-2 outline-none focus:border-slate-300 focus:bg-white transition resize-none h-20 font-medium"
          maxLength={500}
        />

        {/* Role selection */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Получатели</span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="text-[9px] font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-lg transition cursor-pointer">Все</button>
              <button onClick={deselectAll} className="text-[9px] font-semibold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 px-2 py-0.5 rounded-lg transition cursor-pointer">Сброс</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggleRole(key)}
                className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition cursor-pointer ${
                  selectedRoles.includes(key)
                    ? "bg-slate-900 text-white border border-slate-800"
                    : "bg-slate-100 text-slate-500 hover:bg-slate-200 border border-transparent"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Send button */}
        <div className="flex items-center gap-3 pt-1">
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-semibold px-4 py-2 min-h-[44px] rounded-xl transition cursor-pointer shadow-sm"
          >
            {sending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {sending ? "Отправка..." : "Отправить уведомление"}
          </button>
          {success && (
            <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-lg flex items-center gap-1">
              <Check className="w-3 h-3" /> Отправлено!
            </span>
          )}
          <span className="text-[10px] text-slate-400 font-mono">{text.length}/500</span>
        </div>
      </div>

      {/* HISTORY */}
      <div className="bg-white rounded-2xl border border-slate-200/50 shadow-sm p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-slate-600" />
            <h2 className="text-sm font-bold text-slate-900">История уведомлений</h2>
            <span className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-lg">{broadcasts.length}</span>
          </div>
        </div>

        {broadcasts.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-xs font-medium">
            <BellRing className="w-10 h-10 mx-auto mb-2 text-slate-200" />
            Уведомлений пока нет
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {broadcasts.map((b) => {
              const TypeIcon = TYPE_CONFIG[b.type as keyof typeof TYPE_CONFIG]?.icon || Info;
              const typeColor = TYPE_CONFIG[b.type as keyof typeof TYPE_CONFIG]?.color || "text-slate-500";
              const typeBg = TYPE_CONFIG[b.type as keyof typeof TYPE_CONFIG]?.bg || "bg-slate-500/10 border-slate-500/20";
              const readCount = Object.keys(b.readBy || {}).length;
              const isExpanded = expandedId === b.id;

              return (
                <div key={b.id} className="border border-slate-200/60 rounded-xl overflow-hidden">
                  <div className="flex items-start justify-between gap-3 p-3 bg-white">
                    <div className="flex items-start gap-2.5 min-w-0 flex-1">
                      <div className={`w-7 h-7 rounded-lg ${typeBg} flex items-center justify-center shrink-0 mt-0.5`}>
                        <TypeIcon className={`w-3.5 h-3.5 ${typeColor}`} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[9px] font-bold ${typeColor} uppercase`}>
                            {TYPE_CONFIG[b.type as keyof typeof TYPE_CONFIG]?.label || "Инфо"}
                          </span>
                          <span className="text-[9px] text-slate-400 font-mono">{formatDate(b.createdAt)}</span>
                          <span className="text-[9px] text-slate-400">от {b.createdBy}</span>
                        </div>
                        <p className="text-xs font-medium text-slate-700 mt-1 leading-relaxed">{b.text}</p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[9px] text-slate-400 flex items-center gap-1">
                            <Eye className="w-3 h-3" />
                            Прочитали: {readCount}
                          </span>
                          {b.targetRoles && b.targetRoles.length > 0 && (
                            <span className="text-[9px] text-slate-400">
                              • {b.targetRoles.map(r => ROLE_LABELS[r] || r).join(", ")}
                            </span>
                          )}
                          {!b.targetRoles || b.targetRoles.length === 0 ? (
                            <span className="text-[9px] text-slate-400">• Всем</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : b.id)}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition cursor-pointer"
                        title="Кто прочитал"
                      >
                        {isExpanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(b.id)}
                        className="p-1.5 rounded-lg hover:bg-rose-50 text-slate-400 hover:text-rose-500 transition cursor-pointer"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Read receipts */}
                  {isExpanded && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <CheckCheck className="w-3 h-3 text-emerald-500" />
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                          Отметки о прочтении ({readCount})
                        </span>
                      </div>
                      {readCount === 0 ? (
                        <p className="text-[10px] text-slate-400 italic">Ещё никто не прочитал</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {Object.entries(b.readBy || {}).map(([uid, entry]) => {
                            const userInfo = users.find((u: any) => u.uid === uid || u.id === uid);
                            const name = userInfo?.name || entry.username || uid.slice(0, 8);
                            return (
                              <div key={uid} className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-[9px] font-semibold text-slate-600 flex items-center gap-1 shadow-sm">
                                <Check className="w-2.5 h-2.5 text-emerald-500" />
                                {name}
                                <span className="text-slate-400 font-normal ml-0.5">
                                  {formatDate(entry.readAt)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
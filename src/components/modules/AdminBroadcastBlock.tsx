import { useState, useEffect } from "react";
import { dbService } from "../../api";
import { UserProfile } from "../../types";
import { Send, Trash2, CheckCheck, Bell, BellRing, Info, AlertTriangle, AlertCircle, Check, Eye, EyeOff, Loader2 } from "lucide-react";
import { UI } from '../../ui/kit';
import { SectionHeader, StatusText, EmptyState } from '../../ui/components';

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
  info: { icon: Info, label: "Информация", solid: "bg-[#121316] border-transparent text-white", tile: "bg-blue-50 text-blue-600", text: "text-blue-700" },
  warning: { icon: AlertTriangle, label: "Предупреждение", solid: "bg-amber-500 border-transparent text-white", tile: "bg-amber-50 text-amber-600", text: "text-amber-700" },
  success: { icon: Check, label: "Успех", solid: "bg-emerald-600 border-transparent text-white", tile: "bg-emerald-50 text-emerald-600", text: "text-emerald-700" },
  alert: { icon: AlertCircle, label: "Срочно", solid: "bg-rose-600 border-transparent text-white", tile: "bg-rose-50 text-rose-600", text: "text-rose-700" },
} as const;

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
    return () => { unsubBroadcasts(); unsubUsers(); }
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
      }).replace(/\./g, "/").replace(/,\s*/, " ");
    } catch { return d; }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* СОЗДАНИЕ УВЕДОМЛЕНИЯ */}
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-4">
        <SectionHeader
          icon={<BellRing className="w-4 h-4" />}
          tone="graphite"
          title="Создать всплывающее уведомление"
        />

        {/* Тип уведомления */}
        <div className="flex flex-wrap gap-1.5">
          {(Object.entries(TYPE_CONFIG) as [string, typeof TYPE_CONFIG[keyof typeof TYPE_CONFIG]][]).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const active = notifType === key;
            return (
              <button
                key={key}
                onClick={() => setNotifType(key as any)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer border ${
                  active ? cfg.solid : 'bg-[#F3F4F6] text-[#4B5563] border-transparent hover:text-[#121316] hover:bg-[#E5E7EB]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {cfg.label}
              </button>
            );
          })}
        </div>

        {/* Текст */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Текст уведомления..."
          className={`${UI.textarea} h-20 resize-none`}
          maxLength={500}
        />

        {/* Получатели */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className={UI.caption}>Получатели</span>
            <div className="flex items-center gap-1.5">
              <button onClick={selectAll} className="text-[11px] font-medium text-[#4B5563] bg-[#F3F4F6] hover:bg-[#E5E7EB] px-2 py-0.5 rounded-md transition-colors cursor-pointer">Все</button>
              <button onClick={deselectAll} className="text-[11px] font-medium text-[#4B5563] bg-[#F3F4F6] hover:bg-[#E5E7EB] px-2 py-0.5 rounded-md transition-colors cursor-pointer">Сброс</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(ROLE_LABELS).map(([key, label]) => (
              <button
                key={key}
                onClick={() => toggleRole(key)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors cursor-pointer ${
                  selectedRoles.includes(key)
                    ? "bg-[#121316] text-white"
                    : "bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Отправка */}
        <div className="flex items-center gap-3 pt-1 flex-wrap">
          <button
            onClick={handleSend}
            disabled={!text.trim() || sending}
            className={UI.buttonPrimary}
          >
            {sending ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Send className="w-3.5 h-3.5" />
            )}
            {sending ? "Отправка..." : "Отправить уведомление"}
          </button>
          {success && (
            <StatusText color="emerald">Отправлено!</StatusText>
          )}
          <span className="text-[11px] font-mono text-[#9CA3AF] ml-auto">{text.length}/500</span>
        </div>
      </div>

      {/* ИСТОРИЯ УВЕДОМЛЕНИЙ */}
      <div className="flex flex-col">
        <SectionHeader
          icon={<Bell className="w-4 h-4" />}
          tone="graphite"
          title="История уведомлений"
        >
          <span className={UI.countBadge}>{broadcasts.length}</span>
        </SectionHeader>

        {broadcasts.length === 0 ? (
          <EmptyState
            title="Уведомлений пока нет"
            hint="Отправленные уведомления появятся в этом списке."
          />
        ) : (
          <div className="flex flex-col">
            {broadcasts.map((b) => {
              const cfg = TYPE_CONFIG[b.type as keyof typeof TYPE_CONFIG] || TYPE_CONFIG.info;
              const TypeIcon = cfg.icon;
              const readCount = Object.keys(b.readBy || {}).length;
              const isExpanded = expandedId === b.id;

              return (
                <div key={b.id} className="border-b border-[#E5E7EB] last:border-0">
                  <div className="flex items-start justify-between gap-3 py-3">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className={`p-2 rounded-xl shrink-0 mt-0.5 ${cfg.tile}`}>
                        <TypeIcon className="w-3.5 h-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-semibold uppercase tracking-wider ${cfg.text}`}>
                            {cfg.label}
                          </span>
                          <span className="text-[11px] font-mono text-[#9CA3AF]">{formatDate(b.createdAt)}</span>
                          <span className="text-[11px] text-[#6B7280]">от {b.createdBy}</span>
                        </div>
                        <p className="text-xs text-[#4B5563] mt-1 leading-relaxed whitespace-pre-wrap">{b.text}</p>
                        <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                          <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                            <Eye className="w-3 h-3" />
                            Прочитали: {readCount}
                          </span>
                          {b.targetRoles && b.targetRoles.length > 0 && (
                            <span className="text-[11px] text-[#6B7280]">
                              • {b.targetRoles.map(r => ROLE_LABELS[r] || r).join(", ")}
                            </span>
                          )}
                          {!b.targetRoles || b.targetRoles.length === 0 ? (
                            <span className="text-[11px] text-[#6B7280]">• Всем</span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : b.id)}
                        className={UI.buttonIcon}
                        title="Кто прочитал"
                      >
                        {isExpanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(b.id)}
                        className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                        title="Удалить"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Отметки о прочтении */}
                  {isExpanded && (
                    <div className="pb-3 pl-12">
                      <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3">
                        <div className="flex items-center gap-1.5 mb-2">
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-500" />
                          <span className={UI.caption}>
                            Отметки о прочтении ({readCount})
                          </span>
                        </div>
                        {readCount === 0 ? (
                          <p className="text-[11px] text-[#9CA3AF]">Ещё никто не прочитал</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {Object.entries(b.readBy || {}).map(([uid, entry]) => {
                              const userInfo = users.find((u: any) => u.uid === uid || u.id === uid);
                              const name = userInfo?.name || entry.username || uid.slice(0, 8);
                              return (
                                <div key={uid} className="bg-white border border-[#E5E7EB] rounded-lg px-2 py-1 text-[10px] font-medium text-[#4B5563] flex items-center gap-1.5">
                                  <Check className="w-3 h-3 text-emerald-500" />
                                  {name}
                                  <span className="text-[#9CA3AF] font-normal">
                                    {formatDate(entry.readAt)}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
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

import React, { useState, useEffect } from "react";
import {
  UserProfile,
  AppSettings,
  DISPATCHER_COLORS_PRESETS,
} from "../../types";
import { dbService } from "../../firebase";
import {
  ShieldCheck,
  UserPlus,
  Palette,
  Trash2,
  Edit2,
  Key,
  Search,
  ChevronRight,
  X,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "../ToastProvider";
import { useDialog } from "../DialogProvider";

interface Props {
  user: UserProfile;
}

export default function UserManagementBlock({ user }: Props) {
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useDialog();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [newUName, setNewUName] = useState("");
  const [newUPassword, setNewUPassword] = useState("");
  const [newURole, setNewURole] = useState("dispatcher");
  const [showZagruzokSubtabs, setShowZagruzokSubtabs] = useState(false);
  const [showPlanningSubtabs, setShowPlanningSubtabs] = useState(false);

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
      dashboard: "read",
      settings: "read",
      documents: "none",
      admin: "none",
    };
    if (newURole === "root_admin") {
      perms = {
        dashboard: "write",
        settings: "write",
        dohod: "write",
        salary: "write",
        planDohod: "write",
        planZagruzok: "write",
        baza: "write",
        vehicleDriverData: "write",
        dozvola: "write",
        disposition: "write",
        documents: "write",
        analysis: "write",
        admin: "write",
      };
    } else if (newURole === "manager" || newURole === "admin") {
      perms = {
        ...perms,
        dohod: "write",
        salary: "write",
        planDohod: "write",
        planZagruzok: "write",
        baza: "write",
        vehicleDriverData: "write",
        dozvola: "write",
        disposition: "write",
        documents: "write",
        analysis: "write",
        settings: "write",
        admin: newURole === "admin" ? "write" : "none",
      };
    } else if (newURole === "mechanic") {
      perms = {
        ...perms,
        dohod: "read",
        salary: "none",
        planDohod: "read",
        planZagruzok: "none",
        baza: "read",
        vehicleDriverData: "read",
        dozvola: "read",
        disposition: "write",
        documents: "read",
        analysis: "none",
        settings: "none",
        admin: "none",
      };
    } else {
      perms = {
        ...perms,
        dohod: "write",
        salary: "write",
        planDohod: "read",
        planZagruzok: "read",
        baza: "read",
        vehicleDriverData: "read",
        dozvola: "read",
        disposition: "read",
        documents: "write",
        analysis: "none",
        settings: "none",
        admin: "none",
      };
    }

    const newUser: UserProfile = {
      uid: "user_" + Date.now(),
      name: newUName.trim(),
      email: `${newUName.trim().toLowerCase()}@ratipa.com`,
      createdAt: new Date().toISOString(),
      password: newUPassword.trim(),
      role: newURole as any,
      permissions: perms as any,
      lastActive: new Date().toISOString(),
    };

    dbService.saveUser(newUser);
    setNewUName("");
    setNewUPassword("");
    setIsAdding(false);
    toast(`Пользователь ${newUser.name} успешно добавлен`, "success");
  };

  const filteredUsers = users.filter(
    (u) =>
      String(u.name || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()) ||
      String(u.role || "")
        .toLowerCase()
        .includes(searchQuery.toLowerCase()),
  );
  const selectedUser = users.find((u) => u.uid === selectedUid);

  const canEditUsers = user.role === "admin" || user.role === "root_admin";
  const isEditingSelf = selectedUser?.uid === user.uid;
  const isProtectedRoot =
    selectedUser?.role === "root_admin" && user.role !== "root_admin";
  const canEditSelectedUser =
    canEditUsers && (!isProtectedRoot || isEditingSelf);

  return (
    <div className="bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col md:flex-row overflow-hidden min-h-[600px] mt-6">
      {/* Left List */}
      <div className="w-full md:w-1/3 border-r border-slate-100 flex flex-col bg-slate-50/30">
        <div className="p-4 border-b border-slate-100">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono mb-4 flex justify-between items-center">
            <span>Учетные записи ({users.length})</span>
            {canEditUsers && (
              <button
                onClick={() => {
                  setIsAdding(true);
                  setSelectedUid(null);
                }}
                className="bg-[#70FC8E] text-slate-900 rounded-lg p-1.5 hover:bg-[#5be277] transition cursor-pointer"
              >
                <UserPlus size={16} />
              </button>
            )}
          </h2>
          <div className="relative">
            <Search className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Поиск профиля..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-white border border-slate-200 rounded-xl py-2 pl-9 pr-3 text-xs font-bold outline-none focus:border-blue-400"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
          {filteredUsers.map((u) => (
            <button
              key={u.uid}
              onClick={() => {
                setSelectedUid(u.uid);
                setIsAdding(false);
              }}
              className={`w-full group relative flex items-center justify-between p-3 rounded-xl transition cursor-pointer border ${selectedUid === u.uid ? "bg-white border-blue-200 shadow-sm" : "border-transparent hover:bg-white"}`}
            >
              <div className="flex flex-col items-start text-left">
                <span className="text-xs font-black text-slate-900">
                  {u.name} {u.uid === user.uid && "(Вы)"}
                </span>
                <span className="text-[9px] font-mono font-bold uppercase tracking-widest text-slate-400">
                  {u.role}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {canEditUsers &&
                  u.uid !== user.uid &&
                  u.role !== "root_admin" && (
                    <div
                      onClick={async (e) => {
                        e.stopPropagation();
                        if (await showConfirm(`Удалить профиль ${u.name}?`)) {
                          dbService.deleteUser(u.uid, u.name);
                          if (selectedUid === u.uid) {
                            setSelectedUid(null);
                          }
                        }
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1.5 text-rose-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                      title="Удалить профиль"
                    >
                      <Trash2 size={14} />
                    </div>
                  )}
                <ChevronRight
                  size={16}
                  className={
                    selectedUid === u.uid ? "text-blue-500" : "text-slate-300"
                  }
                />
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Right Content */}
      <div className="w-full md:w-2/3 flex flex-col bg-white">
        {isAdding && (
          <div className="p-6 lg:p-8 animate-fade-in flex flex-col h-full">
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2 mb-6">
              <UserPlus className="text-[#c3fb12]" />
              Новый профиль
            </h3>
            <form onSubmit={handleRegisterUser} className="space-y-4 max-w-sm">
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-1.5 block">
                  Имя (Логин)
                </label>
                <input
                  required
                  type="text"
                  value={newUName}
                  onChange={(e) => setNewUName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-1.5 block">
                  Пароль
                </label>
                <input
                  required
                  type="text"
                  value={newUPassword}
                  onChange={(e) => setNewUPassword(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-blue-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400 font-mono mb-1.5 block">
                  Группа роли
                </label>
                <select
                  value={newURole}
                  onChange={(e) => setNewURole(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold outline-none focus:border-blue-400"
                >
                  <option value="dispatcher">Диспетчер</option>
                  <option value="manager">Менеджер</option>
                  <option value="accountant">Бухгалтер</option>
                  <option value="mechanic">Механик</option>
                  <option value="admin">Администратор</option>
                  {user.role === "root_admin" && (
                    <option value="root_admin">Root Admin</option>
                  )}
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-slate-950 text-[#70FC8E] font-black uppercase tracking-widest px-4 py-3 rounded-xl hover:bg-slate-800 transition shadow-sm mt-4 cursor-pointer"
              >
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
                  <button
                    onClick={async () => {
                      if (!canEditUsers) return;
                      const n = await showPrompt(
                        "Изменить имя:",
                        selectedUser.name,
                      );
                      if (n && n.trim() !== "" && n !== selectedUser.name) {
                        dbService.saveUser({ ...selectedUser, name: n.trim() });
                      }
                    }}
                    className="text-slate-300 hover:text-blue-500 transition cursor-pointer"
                  >
                    <Edit2 size={14} />
                  </button>
                </h3>
                <div className="text-[10px] font-mono tracking-widest text-slate-400 mt-1 uppercase flex items-center gap-3">
                  <span>{selectedUser.role}</span>
                  <span className="text-blue-400 bg-blue-50 px-2 py-0.5 rounded-full">
                    ID: {selectedUser.uid}
                  </span>
                  <span>
                    Был:{" "}
                    {new Date(selectedUser.lastActive).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              </div>
              {canEditUsers &&
                selectedUser.uid !== user.uid &&
                selectedUser.role !== "root_admin" && (
                  <button
                    onClick={async () => {
                      if (
                        await showConfirm(
                          `Удалить профиль ${selectedUser.name}?`,
                        )
                      ) {
                        dbService.deleteUser(
                          selectedUser.uid,
                          selectedUser.name,
                        );
                        setSelectedUid(null);
                        toast("Профиль удален", "success");
                      }
                    }}
                    className="bg-rose-50 text-rose-500 rounded-lg p-2 hover:bg-rose-500 hover:text-white transition cursor-pointer"
                  >
                    <Trash2 size={16} />
                  </button>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="space-y-4">
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5">
                    <Key size={12} /> ПАРОЛЬ
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={selectedUser.password || "—"}
                      className="bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold w-full"
                    />
                    {canEditUsers && (
                      <button
                        onClick={async () => {
                          const p = await showPrompt(
                            "Новый пароль:",
                            selectedUser.password,
                          );
                          if (p && p.trim() !== "") {
                            dbService.saveUser({
                              ...selectedUser,
                              password: p.trim(),
                            });
                            toast("Пароль обновлен", "success");
                          }
                        }}
                        className="bg-slate-200 text-slate-600 rounded-xl px-3 hover:bg-blue-100 hover:text-blue-600 transition font-bold text-xs cursor-pointer"
                      >
                        Изменить
                      </button>
                    )}
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                  <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono mb-2 flex items-center gap-1.5">
                    <ShieldCheck size={12} /> ИЗМЕНИТЬ РОЛЬ
                  </label>
                  <select
                    value={selectedUser.role}
                    disabled={!canEditSelectedUser}
                    onChange={(e) => {
                      dbService.saveUser({
                        ...selectedUser,
                        role: e.target.value as any,
                      });
                      toast("Роль обновлена", "success");
                    }}
                    className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-bold w-full outline-none disabled:opacity-50 cursor-pointer"
                  >
                    {user.role === "root_admin" && (
                      <option value="root_admin">Root Admin</option>
                    )}
                    <option value="admin">Администратор</option>
                    <option value="manager">Менеджер</option>
                    <option value="accountant">Бухгалтер</option>
                    <option value="dispatcher">Диспетчер</option>
                    <option value="mechanic">Механик</option>
                  </select>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono mb-3 flex items-center gap-1.5">
                  <Palette size={12} /> ЦВЕТ АССИГНАЦИИ В ПЛАНЕ ДОХОДА / ЧАТЕ
                </label>
                <div className="grid grid-cols-6 sm:grid-cols-8 gap-2">
                  {DISPATCHER_COLORS_PRESETS.map((p) => {
                    const isSelected = selectedUser.color === p.key;
                    return (
                      <button
                        key={p.key}
                        onClick={() => {
                          if (canEditUsers) {
                            dbService.saveUser({
                              ...selectedUser,
                              color: p.key,
                            });
                          }
                        }}
                        className={`w-8 h-8 rounded-full border-2 transition flex items-center justify-center ${isSelected ? "border-slate-800 scale-110 shadow-sm" : "border-transparent hover:scale-105"} cursor-pointer`}
                        style={{ backgroundColor: p.colorCode }}
                        title={p.name}
                      >
                        {isSelected && (
                          <span className="text-[10px] text-white font-black drop-shadow-md pb-0.5">
                            ✓
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            <div>
              <h4 className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-3 flex items-center gap-1.5">
                <ShieldCheck size={12} /> МАТРИЦА ПРАВ ДОСТУПА ПО МОДУЛЯМ
              </h4>

              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar">
                {/* Standard modules */}
                {[
                  { key: "dashboard", label: "Главная (Dashboard)" },
                  { key: "dohod", label: "Калькуляция Дохода" },
                  { key: "salary", label: "ЗП Водителей" },
                  { key: "planDohod", label: "План Дохода" },
                  {
                    key: "planZagruzok",
                    label: "План Загрузок",
                    hasSubtabs: true,
                    subtabs:
                      settings?.planZagruzokTabs?.map((t) => ({
                        id: t.id,
                        name: t.name,
                        key: "planZagruzok_" + t.id,
                        label: "Подвкладка п.з.",
                      })) || [],
                  },
                  {
                    key: "currentPlanning",
                    label: "Текущее Планирование (Сама кнопка)",
                    hasSubtabs: true,
                    subtabs:
                      settings?.currentPlanningTabs?.map((t) => ({
                        id: t.id,
                        name: t.name,
                        key: "currentPlanning_" + t.id,
                        label: "Подвкладка т.п.",
                      })) || [],
                  },
                  { key: "baza", label: "Учет выезда (База)" },
                  {
                    key: "vehicleDriverData",
                    label: "Данные авто и водителей",
                  },
                  { key: "dozvola", label: "Дозволы" },
                  { key: "disposition", label: "Диспозиция" },
                  { key: "documents", label: "Шаблоны документов" },
                  { key: "analysis", label: "Анализ" },
                  { key: "settings", label: "Справочники" },
                  { key: "admin", label: "Администрирование" },
                ].map((m) => {
                  const currentPerm =
                    selectedUser.permissions?.[m.key] || "none";
                  const isExpanded =
                    m.key === "planZagruzok"
                      ? showZagruzokSubtabs
                      : m.key === "currentPlanning"
                        ? showPlanningSubtabs
                        : false;
                  const toggleExpand = () => {
                    if (m.key === "planZagruzok")
                      setShowZagruzokSubtabs(!showZagruzokSubtabs);
                    if (m.key === "currentPlanning")
                      setShowPlanningSubtabs(!showPlanningSubtabs);
                  };

                  return (
                    <div
                      key={m.key}
                      className="space-y-3 pb-3 border-b border-slate-100 last:border-0 last:pb-0"
                    >
                      <div
                        className={`flex flex-col sm:flex-row sm:items-center justify-between bg-white border ${m.hasSubtabs ? "border-dashed border-indigo-200 shadow-xs" : "border-slate-200"} rounded-xl p-3 gap-3 transition-all hover:bg-slate-50/50`}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-start sm:items-center gap-2">
                          <span className="text-xs font-bold text-slate-800 uppercase tracking-tight">
                            {m.label}
                          </span>
                          {m.hasSubtabs && (
                            <button
                              type="button"
                              onClick={toggleExpand}
                              className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-md transition duration-150 cursor-pointer ${isExpanded ? "bg-indigo-100 text-indigo-700 font-bold" : "bg-slate-100 hover:bg-slate-200 text-slate-500"}`}
                            >
                              {isExpanded
                                ? "Скрыть подвкладки"
                                : "Настроить подвкладки"}{" "}
                              ({m.subtabs.length})
                            </button>
                          )}
                        </div>

                        <div className="flex gap-1.5 bg-slate-100 p-1 rounded-xl">
                          {["none", "read", "write"].map((perm) => {
                            const isActive = currentPerm === perm;
                            const colors =
                              perm === "none"
                                ? "bg-white text-slate-400 shadow-sm border border-slate-200"
                                : perm === "read"
                                  ? "bg-indigo-150 text-indigo-800 shadow-sm border border-indigo-250"
                                  : "bg-[#70FC8E] text-slate-900 shadow-sm border border-emerald-350";
                            const labels =
                              perm === "none"
                                ? "НЕТ"
                                : perm === "read"
                                  ? "ЧТЕНИЕ"
                                  : "ПОЛНЫЙ";
                            return (
                              <button
                                key={perm}
                                disabled={!canEditSelectedUser}
                                onClick={() => {
                                  dbService.saveUser({
                                    ...selectedUser,
                                    permissions: {
                                      ...selectedUser.permissions,
                                      [m.key]: perm,
                                    } as any,
                                  });
                                }}
                                className={`px-2 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest font-mono transition ${isActive ? colors : "text-slate-500 hover:bg-slate-200 border border-transparent"} disabled:opacity-50 disabled:cursor-not-allowed`}
                              >
                                {labels}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Accordion children if expanded */}
                      {m.hasSubtabs && isExpanded && (
                        <div className="pl-6 border-l-2 border-indigo-100 space-y-2 mt-2 ml-4 pb-1">
                          {m.subtabs.length === 0 ? (
                            <div className="text-xs text-slate-400 font-mono py-1">
                              Нет настроенных подвкладок
                            </div>
                          ) : (
                            m.subtabs.map((subItem) => {
                              const subPerm =
                                selectedUser.permissions?.[subItem.key] ||
                                "none";
                              const parentColorTheme =
                                m.key === "planZagruzok"
                                  ? "bg-[#f0fdf4] border-emerald-100 text-emerald-800"
                                  : "bg-purple-50 border-purple-100 text-purple-800";
                              const badgeColor =
                                m.key === "planZagruzok"
                                  ? "bg-emerald-100 text-emerald-800"
                                  : "bg-purple-100 text-purple-800";
                              return (
                                <div
                                  key={subItem.key}
                                  className={`flex flex-col sm:flex-row sm:items-center justify-between border rounded-xl p-2.5 gap-2.5 ${parentColorTheme}`}
                                >
                                  <span className="text-[11px] font-bold uppercase tracking-tight flex items-center gap-2">
                                    {subItem.name}
                                    <span
                                      className={`text-[8px] px-1.5 py-0.5 rounded font-mono font-black ${badgeColor}`}
                                    >
                                      {subItem.label}
                                    </span>
                                  </span>

                                  <div className="flex gap-1.5 bg-slate-100/50 p-1 rounded-xl">
                                    {["none", "read", "write"].map((perm) => {
                                      const isActive = subPerm === perm;
                                      const colors =
                                        perm === "none"
                                          ? "bg-white text-slate-400 shadow-sm border border-slate-200"
                                          : perm === "read"
                                            ? "bg-blue-100 text-blue-800 shadow-sm border border-blue-200"
                                            : "bg-[#70FC8E] text-slate-900 shadow-sm border border-emerald-350";
                                      const labels =
                                        perm === "none"
                                          ? "НЕТ"
                                          : perm === "read"
                                            ? "ЧТЕНИЕ"
                                            : "ПОЛНЫЙ";
                                      return (
                                        <button
                                          key={perm}
                                          disabled={!canEditSelectedUser}
                                          onClick={() => {
                                            dbService.saveUser({
                                              ...selectedUser,
                                              permissions: {
                                                ...selectedUser.permissions,
                                                [subItem.key]: perm,
                                              } as any,
                                            });
                                          }}
                                          className={`px-2 py-1 rounded-lg text-[9px] font-black uppercase tracking-widest font-mono transition ${isActive ? colors : "text-slate-500 hover:bg-slate-200/80 border border-transparent"} disabled:opacity-50 disabled:cursor-not-allowed`}
                                        >
                                          {labels}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {!isAdding && !selectedUser && (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-10 h-full">
            <ShieldCheck size={48} className="mb-4 opacity-50" />
            <span className="text-sm font-black uppercase tracking-wider font-mono">
              Выберите профиль слева
            </span>
            <span className="text-xs text-slate-400 mt-2">
              или добавьте новый профиль администратора/диспетчера
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

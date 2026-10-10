import React, {useState, useEffect} from 'react'
import {
  UserProfile,
  AppSettings,
} from "../../types";
import {dbService} from '../../api'
import { getUserFullName, getUserNameParts, getUserInitials } from '../../utils/userName';
import {
  ShieldCheck,
  UserPlus,
  Trash2,
  Edit2,
  Key,
  ChevronRight,
  Sliders,
  Shield,
  Users,
  Activity,
  AlertCircle,
  UserCog,
} from "lucide-react";
import {useToast} from '../ToastProvider'
import {useDialog} from '../DialogProvider'
import { resolvePermission } from '../../utils/permissions';
import { UI } from '../../ui/kit';
import { SectionHeader, SearchField, FilterPills, StatusText, FoundCount, EmptyState } from '../../ui/components';

interface Props {
  user: UserProfile;
}

const PERM_LABELS: Record<string, string> = { none: 'Нет доступа', read: 'Только чтение', write: 'Полный доступ' };

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

const DEFAULT_ROLE_PERMS: Record<string, any> = {
  root_admin: { dashboard: "write", settings: "write", dohod: "write", salary: "write", planDohod: "write", planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write", disposition: "write", documents: "write",admin: "write", bookIssue: "write", bookIssueRR: "write", tabel: "write", mdpJournal: "write", driverExpenses: "write", instructions: "read", tripTimeline: "write", mileageComms: "write", mileageCommsEvents: "write", mileageCommsRequests: "write", mileageCommsRules: "write", mileageCommsIntegration: "write" },
  admin: { dashboard: "read", dohod: "write", salary: "write", planDohod: "write", planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write", disposition: "write", documents: "write",settings: "write", admin: "write", bookIssue: "write", bookIssueRR: "write", tabel: "write", mdpJournal: "write", driverExpenses: "write", instructions: "write", tripTimeline: "write", mileageComms: "write", mileageCommsEvents: "write", mileageCommsRequests: "write", mileageCommsRules: "write", mileageCommsIntegration: "write" },
  manager: { dashboard: "read", dohod: "write", salary: "write", planDohod: "write", planZagruzok: "write", baza: "write", vehicleDriverData: "write", dozvola: "write", disposition: "write", documents: "write",settings: "write", admin: "none", instructions: "read", tripTimeline: "write", mileageComms: "write", mileageCommsEvents: "write", mileageCommsRequests: "write", mileageCommsRules: "read", mileageCommsIntegration: "none" },
  mechanic: { dashboard: "read", dohod: "read", salary: "none", planDohod: "read", planZagruzok: "none", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "write", documents: "read",settings: "none", admin: "none", instructions: "read", mileageComms: "read", mileageCommsEvents: "read", mileageCommsRequests: "read", mileageCommsRules: "none", mileageCommsIntegration: "none" },
  dispatcher: { dashboard: "read", dohod: "write", salary: "write", planDohod: "read", planZagruzok: "read", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "read", documents: "write",settings: "none", admin: "none", instructions: "read", tripTimeline: "write", mileageComms: "read", mileageCommsEvents: "none", mileageCommsRequests: "write", mileageCommsRules: "none", mileageCommsIntegration: "none" },
  accountant: { dashboard: "read", dohod: "write", salary: "write", planDohod: "read", planZagruzok: "read", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "read", documents: "write",settings: "none", admin: "none", instructions: "read", tripTimeline: "read", mileageComms: "read", mileageCommsEvents: "none", mileageCommsRequests: "none", mileageCommsRules: "none", mileageCommsIntegration: "none" },
  viewer: { dashboard: "read", dohod: "none", salary: "none", planDohod: "none", planZagruzok: "none", baza: "read", vehicleDriverData: "none", dozvola: "none", disposition: "none", documents: "none",settings: "none", admin: "none", instructions: "read", mileageComms: "none", mileageCommsEvents: "none", mileageCommsRequests: "none", mileageCommsRules: "none", mileageCommsIntegration: "none" },
  logist: { dashboard: "read", dohod: "none", salary: "none", planDohod: "read", planZagruzok: "write", baza: "read", vehicleDriverData: "read", dozvola: "read", disposition: "write", documents: "none",settings: "none", admin: "none", instructions: "read", tripTimeline: "read", mileageComms: "read", mileageCommsEvents: "none", mileageCommsRequests: "none", mileageCommsRules: "none", mileageCommsIntegration: "none" }
};

export default function UserManagementBlock({ user }: Props) {
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useDialog();
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  
  const [activeMainTab, setActiveMainTab] = useState<"users" | "roles">("users");
  const [selectedUid, setSelectedUid] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  const [isAdding, setIsAdding] = useState(false);
  const [newUName, setNewUName] = useState("");
  // Имя и фамилия задаются отдельно; `name` = «Имя Фамилия» (логин входа и отображение)
  const [newUFirstName, setNewUFirstName] = useState("");
  const [newULastName, setNewULastName] = useState("");
  const [isEditingName, setIsEditingName] = useState(false);
  const [editFirstName, setEditFirstName] = useState("");
  const [editLastName, setEditLastName] = useState("");
  const [newUPassword, setNewUPassword] = useState("");
  const [newURole, setNewURole] = useState("dispatcher");
  // Ошибки обязательных полей формы сотрудника (подписи под полями)
  const [addErrors, setAddErrors] = useState<{ name?: string; password?: string }>({});
  const [nameErrors, setNameErrors] = useState<{ name?: string }>({});
  const [showZagruzokSubtabs, setShowZagruzokSubtabs] = useState(false);
  const [showPlanningSubtabs, setShowPlanningSubtabs] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const isModuleExpanded = (key: string) =>
    key === "planZagruzok" ? showZagruzokSubtabs : key === "currentPlanning" ? showPlanningSubtabs : !!expandedModules[key];
  const toggleModuleExpand = (key: string) => {
    if (key === "planZagruzok") setShowZagruzokSubtabs((v) => !v);
    else if (key === "currentPlanning") setShowPlanningSubtabs((v) => !v);
    else setExpandedModules((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  useEffect(() => {
    const unsubUsers = dbService.getUsers(setUsers);
    const unsubSettings = dbService.getSettings(setSettings);
    return () => {
      unsubUsers();
      unsubSettings();
    };
  }, []);

  useEffect(() => {
    const unsub = dbService.getAuditLogs(setAuditLogs, 100);
    return () => { unsub(); }
  }, []);

  /** Полное имя для отображения и входа: «Имя Фамилия», лишние пробелы убираются. */
  const composeFullName = (firstName: string, lastName: string) =>
    [firstName.trim(), lastName.trim()].filter(Boolean).join(' ');

  const handleRegisterUser = (e: React.FormEvent) => {
    e.preventDefault();
    const firstName = newUFirstName.trim();
    const lastName = newULastName.trim();
    const fullName = composeFullName(firstName, lastName);
    // Обязательные поля: имя и пароль. Ошибки показываем у самих полей.
    const errors: { name?: string; password?: string } = {};
    if (!fullName) errors.name = 'Укажите имя сотрудника — под ним он входит в систему';
    if (!newUPassword.trim()) errors.password = 'Укажите пароль для входа';
    setAddErrors(errors);
    if (Object.values(errors).length > 0 || !newURole) return;

    const newUser: UserProfile = {
      uid: "user_" + Date.now(),
      name: fullName,
      firstName,
      lastName,
      email: `${fullName.toLowerCase().replace(/\s+/g, '.')}@ratipa.com`,
      createdAt: new Date().toISOString(),
      password: newUPassword.trim(),
      role: newURole as any,
      permissions: {} as any,
      customPermissions: {} as any,
      lastActive: new Date().toISOString(),
    };

    dbService.saveUser(newUser);
    setNewUName("");
    setNewUFirstName("");
    setNewULastName("");
    setNewUPassword("");
    setAddErrors({});
    setIsAdding(false);
    toast(`Пользователь ${newUser.name} успешно добавлен`, "success");
  };

  /** Сотрудники выбранной роли — для подтверждения и понятного текста. */
  const countByRole = (roleKey: string) => users.filter((u) => u.role === roleKey).length;

  /** Копия права роли, размноженная по людям прежней версией вкладки.
   *  Индивидуальное переопределение всегда пишет customPermissions, поэтому
   *  значение в permissions без ключа в customPermissions — устаревшая копия. */
  const isInheritedCopy = (u: UserProfile, permKey: string, roleValue: string) => {
    const custom = (u.customPermissions || {}) as Record<string, string>;
    if (Object.prototype.hasOwnProperty.call(custom, permKey)) return false;
    const own = ((u.permissions || {}) as Record<string, string>)[permKey];
    return own !== undefined && own === roleValue;
  };

  /** Есть ли у сотрудника личное значение этого права (переопределение). */
  const hasOwnPerm = (u: UserProfile, permKey: string) => {
    const custom = (u.customPermissions || {}) as Record<string, string>;
    const own = (u.permissions || {}) as Record<string, string>;
    return (custom[permKey] !== undefined && custom[permKey] !== 'inherit')
      || (own[permKey] !== undefined && own[permKey] !== 'inherit');
  };

  /** Значение права по роли (без учёта личных переопределений). */
  const roleValueOf = (roleKey: string, permKey: string) => {
    const base = settings?.rolePermissions?.[roleKey] || DEFAULT_ROLE_PERMS[roleKey] || DEFAULT_ROLE_PERMS['viewer'];
    return base[permKey] || 'none';
  };

  /**
   * Изменение права роли.
   *
   * По требованию заказчика новое значение роли перезаписывает личные значения
   * этого права у ВСЕХ сотрудников роли (включая заданные индивидуально), чтобы
   * роль оставалась источником истины. Другие личные права не трогаются: снимаем
   * переопределение только по изменяемому праву. Запись идёт одним общим
   * multi-path update — при сбое не применяется ничего, и мы об этом сообщаем.
   */
  const handleRolePermChange = async (roleKey: string, permKey: string, val: string) => {
    const previous = roleValueOf(roleKey, permKey);
    if (previous === val) return;
    const roleUsers = users.filter((u) => u.role === roleKey);
    const withOwn = roleUsers.filter((u) => hasOwnPerm(u, permKey));
    const moduleLabel = MODULES_LIST.find((m) => m.key === permKey)?.label || permKey;

    const ok = await showConfirm(
      `Право «${moduleLabel}» для роли ${ROLE_LABELS[roleKey] || roleKey} станет «${PERM_LABELS[val] || val}»`
      + ` (было «${PERM_LABELS[previous] || previous}»).`
      + ` Значение получат все сотрудники роли (${roleUsers.length}).`
      + (withOwn.length
        ? ` У ${withOwn.length} из них это право задано индивидуально — личное значение будет перезаписано.`
        : ' Личных переопределений по этому праву нет.')
      + ' Другие их права не изменятся.',
      'Изменить право роли?',
    );
    if (!ok) return;

    const done = await dbService.saveRolePermissionChange(roleKey, permKey, val, roleUsers.map((u) => u.uid));
    if (!done) {
      toast('Изменение не применено — значения остались прежними', 'error');
      return;
    }

    const newRolePermissions = {
      ...(settings?.rolePermissions || DEFAULT_ROLE_PERMS),
      [roleKey]: { ...(settings?.rolePermissions?.[roleKey] || DEFAULT_ROLE_PERMS[roleKey] || {}), [permKey]: val },
    };
    if (settings) setSettings({ ...settings, rolePermissions: newRolePermissions });

    setUsers(prev => prev.map((u) => {
      if (u.role !== roleKey) return u;
      const custom = { ...(u.customPermissions || {}) };
      const own = { ...(u.permissions || {}) };
      delete custom[permKey];
      delete own[permKey];
      // permissions — намеренно частичный: снимаем один ключ, остальные сохраняем
      return { ...u, customPermissions: custom, permissions: own as UserProfile['permissions'] };
    }));

    dbService.logAction(user.name, user.role, 'Изменение прав роли', 'Admin', roleKey,
      `Роль ${roleKey}: ${permKey} → ${val}; перезаписаны личные значения у ${withOwn.length} из ${roleUsers.length} сотрудников`);
    toast(`Право роли обновлено: ${roleUsers.length} ${roleUsers.length === 1 ? 'сотрудник' : 'сотрудников'}`, 'success');
  };

  /** Вернуть право сотрудника к значению роли (снять личное переопределение). */
  const handleUserPermReset = async (u: UserProfile, permKey: string) => {
    const current = users.find((x) => x.uid === u.uid) || u;
    if (user.role !== 'root_admin' && current.role === 'root_admin') {
      toast('Права учётной записи разработчика может менять только разработчик', 'error');
      return;
    }
    const custom = { ...(current.customPermissions || {}) };
    const own = { ...(current.permissions || {}) };
    delete custom[permKey];
    delete own[permKey];
    setUsers(prev => prev.map((x) => (x.uid === u.uid ? { ...x, customPermissions: custom, permissions: own as UserProfile['permissions'] } : x)));
    dbService.saveUser({ ...current, customPermissions: custom, permissions: own as UserProfile['permissions'] });
    dbService.logAction(user.name, user.role, 'Возврат права к роли', 'Admin', current.uid,
      `${current.name}: ${permKey} → как у роли (${roleValueOf(current.role, permKey)})`);
    toast('Право вернулось к значению роли', 'success');
  };

  const handleUserPermChange = (u: UserProfile, permKey: string, val: string) => {
    // Берём АКТУАЛЬНОЕ состояние из users (а не u — старая копия),
    // иначе при быстрой смене прав разных модулей предыдущие слетают.
    const current = users.find((x) => x.uid === u.uid) || u;
    // SEC-4: у учётной записи разработчика права не правит никто, кроме разработчика.
    if (user.role !== 'root_admin' && current.role === 'root_admin') {
      toast('Права учётной записи разработчика может менять только разработчик', 'error');
      return;
    }
    // Личное значение живёт в одном месте — customPermissions (высший приоритет в
    // resolvePermission). Старую запись в permissions по этому ключу убираем, чтобы
    // не оставалось второго, «фантомного» источника значения.
    const newCustom = { ...(current.customPermissions || {}), [permKey]: val };
    const newPerms = { ...(current.permissions || {}) };
    const wasInPerms = newPerms[permKey] !== undefined;
    delete newPerms[permKey];

    setUsers(prev => prev.map(us =>
      us.uid === u.uid ? { ...us, customPermissions: newCustom, permissions: newPerms as UserProfile['permissions'] } : us
    ));
    dbService.saveUser({ ...current, customPermissions: newCustom, permissions: newPerms as UserProfile['permissions'] });

    dbService.logAction(user.name, user.role, 'Изменение права сотрудника', 'Admin', current.uid,
      `${current.name}: ${permKey} → ${val}${wasInPerms ? ' (личное значение перенесено в индивидуальные)' : ''}`);
    toast('Личное право сотрудника обновлено', 'success');
  };

  const rootUsers = users.filter((x) => x.role === 'root_admin');

  const handleUserRoleChange = async (u: UserProfile, newRole: string) => {
    const current = users.find((x) => x.uid === u.uid) || u;
    if (current.role === newRole) return;

    // SEC-1: трогать учётную запись разработчика (root) и назначать её может только root.
    if (user.role !== 'root_admin' && (current.role === 'root_admin' || newRole === 'root_admin')) {
      toast('Менять учётную запись разработчика и назначать эту роль может только разработчик', 'error');
      return;
    }
    // SEC-2: запрет самопонижения — администратор не снимает себе права администратора.
    if (current.uid === user.uid && newRole !== 'root_admin' && newRole !== 'admin') {
      toast('Вы не можете понизить собственные права администратора', 'error');
      return;
    }
    // SEC-3: нельзя оставить портал без единственной учётной записи разработчика.
    if (current.role === 'root_admin' && newRole !== 'root_admin' && rootUsers.length <= 1) {
      toast('Это единственная учётная запись разработчика — снять с неё роль нельзя', 'error');
      return;
    }

    const ok = await showConfirm(
      `Роль сотрудника ${current.name} изменится с «${ROLE_LABELS[current.role] || current.role}» на «${ROLE_LABELS[newRole] || newRole}».`
      + ' Индивидуальные права доступа при этом обнуляются — сотрудник получит права новой роли.'
      + (newRole === 'root_admin' ? ' Внимание: роль разработчика даёт полный доступ ко всему порталу.' : ''),
      'Изменить роль сотрудника?',
    );
    if (!ok) return;

    dbService.saveUser({ ...current, role: newRole as any, permissions: {} as any, customPermissions: current.customPermissions || {} } as any);
    setUsers(prev => prev.map(us => (us.uid === u.uid ? { ...us, role: newRole as any, permissions: {} as any } : us)));
    dbService.logAction(user.name, user.role, 'Изменение роли сотрудника', 'Admin', current.uid,
      `${current.name}: ${current.role} → ${newRole}`);
    toast('Роль сотрудника обновлена', 'success');
  };

  const filteredUsers = users.filter(
    (u) =>
      getUserFullName(u).toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(ROLE_LABELS[u.role] || u.role).toLowerCase().includes(searchQuery.toLowerCase()),
  );
  const selectedUser = users.find((u) => u.uid === selectedUid);

  const canEditUsers = user.role === "admin" || user.role === "root_admin";
  const isEditingSelf = selectedUser?.uid === user.uid;
  const isProtectedRoot = selectedUser?.role === "root_admin" && user.role !== "root_admin";
  const canEditSelectedUser = canEditUsers && (!isProtectedRoot || isEditingSelf);

  const MODULES_LIST = [
    { key: "dashboard", label: "Главная (Dashboard)" },
    { key: "dohod", label: "Калькуляция Дохода" },
    { key: "salary", label: "ЗП Водителей" },
    { key: "planDohod", label: "План Дохода" },
    {
      key: "planZagruzok",
      label: "План Загрузок",
      hasSubtabs: true,
      subtabs: settings?.planZagruzokTabs?.map((t) => ({ key: "planZagruzok_" + t.id, label: "Вкладка П.З.", name: t.name })) || [],
    },
    {
      key: "currentPlanning",
      label: "Текущее Планирование",
      hasSubtabs: true,
      subtabs: settings?.currentPlanningTabs?.map((t) => ({ key: "currentPlanning_" + t.id, label: "Вкладка Т.П.", name: t.name })) || [],
    },
    { key: "tripTimeline", label: "Таймлайн рейсов" },
    {
      key: "mileageComms",
      label: "Пробег и связь",
      hasSubtabs: true,
      subtabs: [
        { key: "mileageCommsEvents", name: "Обработка событий" },
        { key: "mileageCommsRequests", name: "Обращения и задачи" },
        { key: "mileageCommsRules", name: "Настройка правил" },
        { key: "mileageCommsIntegration", name: "Управление интеграцией" },
      ],
    },
    {
      key: "baza",
      label: "Учет выезда (База)",
      hasSubtabs: true,
      subtabs: [
        { key: "baza_dateArrival", name: "Прибыл" },
        { key: "baza_dateLoading", name: "Готовность" },
        { key: "baza_dateRepairStart", name: "Ремонт нач." },
        { key: "baza_dateRepairEnd", name: "Ремонт оконч." },
        { key: "baza_dateDeparture", name: "Выезд" },
        { key: "baza_comment", name: "Комментарий" },
        { key: "baza_driverName", name: "Водитель" },
        { key: "baza_carNumber", name: "Гос. номер" },
      ],
    },
    { key: "vehicleDriverData", label: "Данные авто и водителей" },
    { key: "dozvola", label: "Дозволы" },
    { key: "disposition", label: "Диспозиция" },
    { key: "documents", label: "Шаблоны документов" },
    { key: "instructions", label: "Инструкции" },
    { key: "settings", label: "Справочники" },
    { key: "bookIssue", label: "Книга выдачи" },
    { key: "bookIssueRR", label: "Книга выдачи РР" },
    { key: "tabel", label: "Табель" },
    { key: "mdpJournal", label: "Журнал МДП" },
    { key: "driverExpenses", label: "Расходы водителей" },
    { key: "admin", label: "Администрирование" },
  ];

  // Классы активного сегмента Нет / Чтение / Полный
  const permBtn = 'px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase tracking-wider border border-transparent transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';
  const permActive = (perm: string) =>
    perm === 'none' ? 'bg-rose-600 text-white' :
    perm === 'read' ? 'bg-[#121316] text-white' :
    'bg-emerald-600 text-white';
  const permIdle = 'text-[#6B7280] hover:text-[#121316] hover:bg-[#E5E7EB]';

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок блока */}
      <SectionHeader
        icon={<Users className="w-4 h-4" />}
        tone="graphite"
        title="Доступ и учётные записи"
        subtitle="Сотрудники, системные роли и права доступа к разделам"
      >
        {canEditUsers && activeMainTab === "users" && (
          <button
            onClick={() => {
              setIsAdding(true);
              setSelectedUid(null);
            }}
            className={UI.buttonPrimary}
            title="Добавить пользователя"
          >
            <UserPlus className="w-3.5 h-3.5" />
            Сотрудник
          </button>
        )}
      </SectionHeader>

      <div className="flex flex-col md:flex-row min-h-[640px] overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-xs">
        {/* Левая панель — список */}
        <div className="w-full md:w-5/12 lg:w-4/12 border-b md:border-b-0 md:border-r border-[#E5E7EB] flex flex-col">
          <div className="p-4 border-b border-[#E5E7EB] flex flex-col gap-3">
            <FilterPills
              items={[
                { key: 'users', label: 'Сотрудники' },
                { key: 'roles', label: 'Роли' },
              ]}
              active={activeMainTab}
              onChange={(key) => {
                setActiveMainTab(key as 'users' | 'roles');
                setIsAdding(false);
                if (key === 'roles') setSelectedRole(null);
              }}
              ariaLabel="Сотрудники или роли"
            />
            {activeMainTab === "users" && (
              <>
                <SearchField
                  value={searchQuery}
                  onChange={setSearchQuery}
                  placeholder="Поиск по имени, фамилии или роли…"
                  ariaLabel="Поиск сотрудника"
                />
                <FoundCount count={filteredUsers.length} onReset={searchQuery ? () => setSearchQuery('') : undefined} />
              </>
            )}
          </div>

          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1">
            {activeMainTab === "users" && filteredUsers.map((u) => {
              const isSelected = selectedUid === u.uid;
              const roleLabel = ROLE_LABELS[u.role] || u.role;
              const initialLetter = getUserInitials(u) || "?";

              return (
                <button
                  key={u.uid}
                  onClick={() => { setSelectedUid(u.uid); setIsAdding(false); }}
                  className={`w-full group flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border transition-colors cursor-pointer text-left ${
                    isSelected ? "bg-[#F3F4F6] border-[#E5E7EB]" : "border-transparent hover:bg-[#F9FAFB]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`relative w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-xs shrink-0 border transition-colors ${
                      isSelected ? "bg-[var(--accent)] text-[var(--accent-on)] border-transparent" : "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]"
                    }`}>
                      {initialLetter}
                      {(() => {
                        const last = u.lastActive ? new Date(u.lastActive) : null;
                        const fresh = !!u.isOnline || (!!last && Date.now() - last.getTime() < 3 * 60 * 1000);
                        return (
                          <span
                            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-white ${fresh ? 'bg-emerald-500' : 'bg-[#D1D5DB]'}`}
                            title={fresh ? 'В сети' : last ? `Последняя активность: ${last.toLocaleDateString('ru-RU').replace(/\./g, '/')} ${last.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Активность неизвестна'}
                            aria-label={fresh ? 'В сети' : 'Не в сети'}
                          />
                        );
                      })()}
                    </div>
                    <div className="flex flex-col items-start text-left min-w-0">
                      <span className="text-xs font-medium text-[#121316] truncate flex items-center gap-1.5 max-w-full">
                        {getUserFullName(u)}
                        {u.uid === user.uid && <span className="bg-[#121316] text-white font-mono text-[10px] leading-none px-1.5 py-0.5 rounded-full uppercase tracking-wider shrink-0">Вы</span>}
                      </span>
                      <span className="text-[10px] text-[#6B7280] mt-0.5 truncate">{roleLabel}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {canEditUsers && u.uid !== user.uid && u.role !== "root_admin" && (
                      <div
                        onClick={async (e) => {
                          e.stopPropagation();
                          // SEC-4: Запретить удаление последнего администратора
                          if (u.role === 'admin' || u.role === 'root_admin') {
                            const adminCount = users.filter(x => x.role === 'admin' || x.role === 'root_admin').length;
                            if (adminCount <= 1) {
                              toast("Нельзя удалить единственного администратора", "error");
                              return;
                            }
                          }
                          if (await showConfirm(`Удалить учетную запись ${u.name}? Действие необратимо: доступ сотрудника к порталу будет закрыт.`, 'Удалить сотрудника?')) {
                            dbService.logAction(user.name, user.role, "Удаление учётной записи", "Admin", u.uid, `${u.name} (${ROLE_LABELS[u.role] || u.role})`);
                            dbService.deleteUser(u.uid, u.name);
                            if (selectedUid === u.uid) setSelectedUid(null);
                          }
                        }}
                        className="md:opacity-0 md:group-hover:opacity-100 p-1.5 text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <Trash2 size={13} />
                      </div>
                    )}
                    <ChevronRight size={14} className={isSelected ? "text-[#121316]" : "text-[#D1D5DB]"} />
                  </div>
                </button>
              );
            })}

            {activeMainTab === "users" && filteredUsers.length === 0 && (
              users.length === 0
                ? <EmptyState kind="empty" title="Сотрудников пока нет" hint="Нажмите «Сотрудник», чтобы создать первую учётную запись." />
                : <EmptyState kind="no-results" query={searchQuery} title="Сотрудник не найден" hint="Измените запрос — ищем по имени, фамилии и названию роли." />
            )}

            {activeMainTab === "roles" && Object.entries(ROLE_LABELS).map(([rKey, rLabel]) => {
              const isSelected = selectedRole === rKey;
              const usersCount = users.filter(u => u.role === rKey).length;
              return (
                <button
                  key={rKey}
                  onClick={() => { setSelectedRole(rKey); setIsAdding(false); }}
                  className={`w-full group flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl border transition-colors cursor-pointer text-left ${
                    isSelected ? "bg-[#F3F4F6] border-[#E5E7EB]" : "border-transparent hover:bg-[#F9FAFB]"
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-semibold text-xs shrink-0 border transition-colors ${
                      isSelected ? "bg-[var(--accent)] text-[var(--accent-on)] border-transparent" : "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]"
                    }`}>
                      <Shield size={14} />
                    </div>
                    <div className="flex flex-col items-start text-left min-w-0">
                      <span className="text-xs font-medium text-[#121316] truncate">
                        {rLabel}
                      </span>
                      <span className="text-[10px] text-[#6B7280] mt-0.5 truncate">Пользователей: {usersCount}</span>
                    </div>
                  </div>
                  <ChevronRight size={14} className={isSelected ? "text-[#121316]" : "text-[#D1D5DB]"} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Правая панель — детали */}
        <div className="flex-1 min-w-0 flex flex-col overflow-y-auto custom-scrollbar">
          
          {/* ФОРМА ДОБАВЛЕНИЯ */}
          {isAdding && activeMainTab === "users" && (
            <div className="p-5 lg:p-7 flex flex-col">
              <div className="flex items-center gap-2.5 pb-3 border-b border-[#E5E7EB] mb-5">
                <div className="p-2 bg-[var(--accent-10)] text-[var(--accent-ink)] rounded-xl">
                  <UserPlus className="w-4 h-4" />
                </div>
                <h3 className="text-sm font-semibold text-[#121316]">
                  Новый профиль сотрудника
                </h3>
              </div>
              <form onSubmit={handleRegisterUser} noValidate className="flex flex-col gap-6 max-w-md">
                {/* Данные сотрудника */}
                <div className="flex flex-col gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Данные сотрудника</span>
                  <div className="space-y-1.5">
                    <label className={UI.fieldLabel}>
                      Имя <span className="text-[var(--accent-ink)]">*</span>
                    </label>
                    <input
                      type="text"
                      value={newUFirstName}
                      onChange={(e) => { setNewUFirstName(e.target.value); if (addErrors.name) setAddErrors((s) => ({ ...s, name: undefined })); }}
                      className={UI.input}
                      placeholder="Например: Сергей"
                      aria-invalid={!!addErrors.name}
                    />
                    {addErrors.name && (
                      <span className="flex items-center gap-1.5 text-[11px] text-rose-600">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {addErrors.name}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1.5">
                    <label className={UI.fieldLabel}>Фамилия</label>
                    <input type="text" value={newULastName} onChange={(e) => setNewULastName(e.target.value)} className={UI.input} placeholder="Например: Терез" />
                  </div>
                </div>

                {/* Вход в систему */}
                <div className="flex flex-col gap-3 pt-4 border-t border-[#E5E7EB]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Вход в систему</span>
                  <div className="space-y-1.5">
                    <label className={UI.fieldLabel}>
                      Пароль <span className="text-[var(--accent-ink)]">*</span>
                    </label>
                    <input
                      type="text"
                      value={newUPassword}
                      onChange={(e) => { setNewUPassword(e.target.value); if (addErrors.password) setAddErrors((s) => ({ ...s, password: undefined })); }}
                      className={UI.input}
                      placeholder="Сложный пароль…"
                      aria-invalid={!!addErrors.password}
                    />
                    {addErrors.password && (
                      <span className="flex items-center gap-1.5 text-[11px] text-rose-600">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {addErrors.password}
                      </span>
                    )}
                    <span className={UI.hint}>Логин — имя и фамилия сотрудника; пароль сообщите ему лично.</span>
                  </div>
                </div>

                {/* Доступ */}
                <div className="flex flex-col gap-3 pt-4 border-t border-[#E5E7EB]">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Доступ</span>
                  <div className="space-y-1.5">
                    <label className={UI.fieldLabel}>Группа роли</label>
                    <select value={newURole} onChange={(e) => setNewURole(e.target.value)} className={`${UI.select} w-full`}>
                      {Object.entries(ROLE_LABELS).map(([k, v]) => (user.role !== 'root_admin' && k === 'root_admin' ? null : <option key={k} value={k}>{v}</option>))}
                    </select>
                    <span className={UI.hint}>Права роли можно уточнить после создания в разделе «Роли» или в карточке сотрудника.</span>
                  </div>
                </div>

                <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
                  <button type="submit" className={`${UI.buttonPrimary} flex-1`}>Зарегистрировать</button>
                  <button type="button" onClick={() => { setAddErrors({}); setIsAdding(false); }} className={`${UI.buttonGhost} flex-1`}>Отмена</button>
                </div>
                <span className={`${UI.hint} -mt-2`}>Поля со звёздочкой обязательны.</span>
              </form>
            </div>
          )}

          {/* ПРОСМОТР РОЛИ */}
          {!isAdding && activeMainTab === "roles" && selectedRole && (
            <div className="p-5 lg:p-7 flex flex-col gap-5">
              <div className="flex flex-col gap-1 pb-4 border-b border-[#E5E7EB]">
                <h3 className="text-sm font-semibold text-[#121316]">
                  Шаблон роли: {ROLE_LABELS[selectedRole]}
                </h3>
                <span className={UI.hint}>
                  Базовые права роли. Изменение права получают все сотрудники роли, включая тех,
                  у кого это право было задано лично, — личное значение будет перезаписано.
                  Остальные их личные права не изменяются.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <ShieldCheck size={13} className="text-[#9CA3AF]" />
                <h4 className="text-sm font-semibold text-[#121316]">Общие права доступа роли</h4>
              </div>

              <div className="flex flex-col">
                {MODULES_LIST.map((m) => {
                  const roleBase = settings?.rolePermissions?.[selectedRole] || DEFAULT_ROLE_PERMS[selectedRole] || DEFAULT_ROLE_PERMS['viewer'];
                  const currentPerm = roleBase[m.key] || "none";
                  const isExpanded = isModuleExpanded(m.key);
                  const toggleExpand = () => toggleModuleExpand(m.key);

                  return (
                    <div key={m.key} className="flex flex-col gap-2 py-3 border-b border-[#E5E7EB] last:border-0">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-[#121316]">{m.label}</span>
                          {m.hasSubtabs && (
                            <button type="button" onClick={toggleExpand} className={UI.buttonLink}>
                              {isExpanded ? "Скрыть" : "Настроить"} ({m.subtabs.length})
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 bg-[#F3F4F6] p-0.5 rounded-lg border border-[#E5E7EB] shrink-0 self-end lg:self-auto select-none">
                          {["none", "read", "write"].map((perm) => {
                            const isActive = currentPerm === perm;

                            return (
                              <button key={perm} type="button" disabled={!canEditUsers || selectedRole === 'root_admin'} onClick={() => handleRolePermChange(selectedRole, m.key, perm)}
                                className={`${permBtn} ${isActive ? permActive(perm) : permIdle}`}
                              >
                                {perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный"}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {m.hasSubtabs && isExpanded && (
                        <div className="pl-4 border-l border-[#E5E7EB] flex flex-col gap-1.5 ml-1">
                          {m.subtabs.length === 0 ? (
                            <div className="text-[11px] text-[#9CA3AF] py-1">Нет вкладок</div>
                          ) : m.subtabs.map((subItem) => {
                              const subPerm = roleBase[subItem.key] || "none";
                              return (
                                <div key={subItem.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1">
                                  <span className="text-xs text-[#4B5563]">{subItem.name}</span>
                                  <div className="flex items-center gap-0.5 bg-[#F3F4F6] p-0.5 rounded-lg border border-[#E5E7EB]">
                                    {["none", "read", "write"].map((perm) => {
                                      const isActive = subPerm === perm;
                                      return (
                                        <button key={perm} type="button" disabled={!canEditUsers || selectedRole === 'root_admin'} onClick={() => handleRolePermChange(selectedRole, subItem.key, perm)}
                                          className={`${permBtn} px-2 ${isActive ? permActive(perm) : permIdle}`}
                                        >
                                          {perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный"}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ПРОСМОТР СОТРУДНИКА */}
          {!isAdding && activeMainTab === "users" && selectedUser && (
            <div className="p-5 lg:p-7 flex flex-col gap-6">
              <div className="flex flex-col gap-3 pb-4 border-b border-[#E5E7EB]">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-[#121316]">
                    {getUserFullName(selectedUser)}
                  </h3>
                  {canEditUsers && (
                    <button onClick={() => {
                        // Имя и фамилия правятся отдельными полями
                        const parts = getUserNameParts(selectedUser);
                        setEditFirstName(parts.firstName);
                        setEditLastName(parts.lastName);
                        setIsEditingName((prev) => !prev);
                      }}
                      className={UI.buttonIcon} title="Редактировать имя"
                    ><Edit2 size={13} /></button>
                  )}
                </div>

                {canEditUsers && isEditingName && (
                  <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-3">
                    <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                    <div className="flex-1 min-w-0">
                      <label className={`${UI.fieldLabel} block mb-1.5`}>Имя</label>
                      <input
                        type="text"
                        value={editFirstName}
                        onChange={(e) => setEditFirstName(e.target.value)}
                        className={UI.inputSm}
                        placeholder="Имя"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <label className={`${UI.fieldLabel} block mb-1.5`}>Фамилия</label>
                      <input
                        type="text"
                        value={editLastName}
                        onChange={(e) => setEditLastName(e.target.value)}
                        className={UI.inputSm}
                        placeholder="Фамилия"
                      />
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          const firstName = editFirstName.trim();
                          const lastName = editLastName.trim();
                          const fullName = composeFullName(firstName, lastName);
                          if (!fullName) {
                            setNameErrors({ name: 'Укажите имя или фамилию сотрудника' });
                            return;
                          }
                          setNameErrors({});
                          // Роли, права и остальные данные не меняются
                          dbService.saveUser({ ...selectedUser, firstName, lastName, name: fullName });
                          setIsEditingName(false);
                          toast('Имя сохранено', 'success');
                        }}
                        className="inline-flex items-center justify-center px-3.5 h-9 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] text-xs font-semibold transition-colors cursor-pointer"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={() => { setNameErrors({}); setIsEditingName(false); }}
                        className="inline-flex items-center justify-center px-3.5 h-9 rounded-lg bg-[#F3F4F6] hover:bg-[#E5E7EB] text-[#4B5563] text-xs font-medium transition-colors cursor-pointer"
                      >
                        Отмена
                      </button>
                      </div>
                    </div>
                    {nameErrors.name && (
                      <span className="flex items-center gap-1.5 text-[11px] text-rose-600">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {nameErrors.name}
                      </span>
                    )}
                    <span className={UI.hint}>Как минимум одно из полей — имя или фамилия — должно быть заполнено.</span>
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  <span className={`${UI.chip} text-[11px]`}>{ROLE_LABELS[selectedUser.role] || selectedUser.role}</span>
                  <span className={`${UI.chip} font-mono select-all`}>ID: {selectedUser.uid}</span>
                  {(() => {
                    const last = selectedUser.lastActive ? new Date(selectedUser.lastActive) : null;
                    const fresh = !!selectedUser.isOnline || (!!last && Date.now() - last.getTime() < 3 * 60 * 1000);
                    if (fresh) return <StatusText color="emerald">В сети</StatusText>;
                    return (
                      <StatusText color="grey">
                        {last
                          ? `Последняя активность: ${last.toLocaleDateString('ru-RU').replace(/\./g, '/')} ${last.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`
                          : 'Активность неизвестна'}
                      </StatusText>
                    );
                  })()}
                </div>
              </div>

              {/* Учётные данные */}
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2 pb-2 border-b border-[#E5E7EB]">
                  <Key size={13} className="text-[#9CA3AF]" />
                  <h4 className="text-sm font-semibold text-[#121316]">Учётные данные</h4>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <div className={`${UI.input} flex items-center gap-2 text-[#6B7280]`} aria-label="Состояние пароля сотрудника">
                    <Key size={13} className="text-[#9CA3AF]" aria-hidden="true" />
                    {selectedUser.password ? 'Пароль задан' : 'Пароль не задан'}
                  </div>
                  {canEditUsers && (user.role === 'root_admin' || selectedUser.role !== 'root_admin') && (
                    <button onClick={async () => {
                        const ok = await showConfirm(
                          `Сменить пароль сотруднику ${selectedUser.name}? Прежний пароль перестанет действовать — сотрудник войдёт только с новым.`,
                          'Сменить пароль?',
                        );
                        if (!ok) return;
                        const p = await showPrompt('Новый пароль сотрудника:', '', 'Новый пароль');
                        if (p && p.trim() !== '') {
                          dbService.saveUser({ ...selectedUser, password: p.trim() });
                          dbService.logAction(user.name, user.role, 'Смена пароля сотрудника', 'Admin', selectedUser.uid, `Пароль изменён: ${selectedUser.name}`);
                          toast('Пароль обновлён', 'success');
                        }
                      }}
                      className={`${UI.buttonPrimary} shrink-0`}
                    >Сменить пароль</button>
                  )}
                </div>
                <span className={UI.hint}>Пароль нужен для входа вместе с именем и фамилией. В самом интерфейсе пароль не показывается — так безопаснее.</span>
              </section>

              {/* Роль и доступ */}
              <section className="flex flex-col gap-3">
                <div className="flex items-center gap-2 pb-2 border-b border-[#E5E7EB]">
                  <ShieldCheck size={13} className="text-[#9CA3AF]" />
                  <h4 className="text-sm font-semibold text-[#121316]">Роль и доступ</h4>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-1.5">
                    <label className={UI.fieldLabel}>Системная роль</label>
                    <select value={selectedUser.role} disabled={!canEditSelectedUser} onChange={(e) => handleUserRoleChange(selectedUser, e.target.value)}
                      className={`${UI.select} w-full disabled:opacity-50`}
                    >
                      {Object.entries(ROLE_LABELS).map(([k, v]) => (user.role !== 'root_admin' && k === 'root_admin' ? null : <option key={k} value={k}>{v}</option>))}
                    </select>
                    <span className={UI.hint}>Роль задаёт базовые права на разделы портала.</span>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className={UI.fieldLabel}>Участие в работе</label>
                    <label className="flex min-h-[44px] items-center gap-2.5 cursor-pointer select-none rounded-xl border border-[#E5E7EB] bg-white px-3">
                      <input type="checkbox" checked={!!(selectedUser as any).isDispatcher}
                        disabled={!canEditSelectedUser}
                        onChange={(e) => {
                          dbService.saveUser({ ...selectedUser, isDispatcher: e.target.checked });
                          toast(e.target.checked ? 'Диспетчер включен' : 'Диспетчер выключен', 'success');
                        }}
                        className={UI.checkbox} />
                      <span className="text-xs text-[#4B5563] font-medium">Диспетчер — показывать в списках диспетчеров</span>
                    </label>
                  </div>
                </div>
              </section>

              <div className="flex flex-col">
                <div className="flex items-center gap-2 pb-3 border-b border-[#E5E7EB]">
                  <Sliders size={13} className="text-[#9CA3AF]" />
                  <h4 className="text-sm font-semibold text-[#121316]">Индивидуальные права доступа (переопределения)</h4>
                </div>
                {MODULES_LIST.map((m) => {
                  const currentCustom = selectedUser.customPermissions?.[m.key] || "inherit";
                  const effectivePerm = resolvePermission(selectedUser, m.key, settings?.rolePermissions);
                  const isOwn = hasOwnPerm(selectedUser, m.key);
                  const roleValue = roleValueOf(selectedUser.role, m.key);
                  const isExpanded = isModuleExpanded(m.key);
                  const toggleExpand = () => toggleModuleExpand(m.key);

                  return (
                    <div key={m.key} className="flex flex-col gap-2 py-3 border-b border-[#E5E7EB] last:border-0">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-2.5">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-medium text-[#121316]">{m.label}</span>
                          {isOwn ? (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-700"
                              title="Значение задано лично этому сотруднику и перекрывает роль"
                            >
                              <UserCog size={9} aria-hidden="true" /> индивидуально
                            </span>
                          ) : (
                            <span
                              className="inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] bg-[#F3F4F6] px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-[#6B7280]"
                              title={`Значение наследуется от роли: ${PERM_LABELS[roleValue] || roleValue}`}
                            >
                              <Users size={9} aria-hidden="true" /> от роли
                            </span>
                          )}
                          {isOwn && (
                            <button
                              type="button"
                              onClick={() => handleUserPermReset(selectedUser, m.key)}
                              disabled={!canEditSelectedUser}
                              className={`${UI.buttonLink} disabled:opacity-40`}
                            >
                              вернуть как у роли
                            </button>
                          )}
                          {m.hasSubtabs && (
                            <button type="button" onClick={toggleExpand} className={UI.buttonLink}>
                              {isExpanded ? "Скрыть" : "Настроить"} ({m.subtabs.length})
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-0.5 bg-[#F3F4F6] p-0.5 rounded-lg border border-[#E5E7EB] shrink-0 self-end lg:self-auto select-none">
                          {["inherit", "none", "read", "write"].map((perm) => {
                            const isActive = currentCustom === perm;
                            const labels = perm === "inherit" ? "Наследует" : perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный";
                            const activeCls = perm === "inherit"
                              ? 'bg-white text-[#121316] border-[#E5E7EB] shadow-xs'
                              : permActive(perm);

                            return (
                              <button key={perm} type="button" disabled={!canEditSelectedUser || selectedUser.role === 'root_admin'} onClick={() => handleUserPermChange(selectedUser, m.key, perm)}
                                className={`${permBtn} ${isActive ? activeCls : permIdle}`}
                                title={perm === 'inherit' ? `Наследует: ${effectivePerm}` : ''}
                              >
                                {labels} {perm === 'inherit' && `(${effectivePerm === 'none' ? 'Нет' : effectivePerm === 'read' ? 'Ч' : 'П'})`}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {m.hasSubtabs && isExpanded && (
                        <div className="pl-4 border-l border-[#E5E7EB] flex flex-col gap-1.5 ml-1">
                          {m.subtabs.length === 0 ? (
                            <div className="text-[11px] text-[#9CA3AF] py-1">Нет вкладок</div>
                          ) : m.subtabs.map((subItem) => {
                              const subCustom = selectedUser.customPermissions?.[subItem.key] || "inherit";
                              const subEffective = resolvePermission(selectedUser, subItem.key, settings?.rolePermissions);
                              
                              return (
                                <div key={subItem.key} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 py-1">
                                  <span className="text-xs text-[#4B5563]">{subItem.name}</span>
                                  <div className="flex items-center gap-0.5 bg-[#F3F4F6] p-0.5 rounded-lg border border-[#E5E7EB]">
                                    {["inherit", "none", "read", "write"].map((perm) => {
                                      const isActive = subCustom === perm;
                                      const labels = perm === "inherit" ? "Наследует" : perm === "none" ? "Нет" : perm === "read" ? "Чтение" : "Полный";
                                      const activeCls = perm === "inherit"
                                        ? 'bg-white text-[#121316] border-[#E5E7EB] shadow-xs'
                                        : permActive(perm);
                                      return (
                                        <button key={perm} type="button" disabled={!canEditSelectedUser || selectedUser.role === 'root_admin'} onClick={() => handleUserPermChange(selectedUser, subItem.key, perm)}
                                          className={`${permBtn} px-2 ${isActive ? activeCls : permIdle}`}
                                          title={perm === 'inherit' ? `Наследует: ${subEffective}` : ''}
                                        >
                                          {labels} {perm === 'inherit' && `(${subEffective === 'none' ? 'Нет' : subEffective === 'read' ? 'Ч' : 'П'})`}
                                        </button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* История активности сотрудника */}
              {(() => {
                const userLogs = auditLogs.filter(
                  (l: any) => l.user && selectedUser && l.user.toLowerCase() === selectedUser.name.toLowerCase()
                ).slice(0, 15);
                if (userLogs.length === 0) return null;
                return (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-2 pb-3 border-b border-[#E5E7EB]">
                      <Activity size={13} className="text-[#9CA3AF]" />
                      <h4 className="text-sm font-semibold text-[#121316]">История активности ({userLogs.length})</h4>
                    </div>
                    <div className="flex flex-col max-h-[200px] overflow-y-auto custom-scrollbar">
                      {userLogs.map((log: any, i: number) => {
                        const act = String(log.actionType || '').toLowerCase();
                        const isCreate = act.includes('create') || act.includes('добав');
                        const isDelete = act.includes('delete') || act.includes('удал');
                        return (
                          <div key={log.id || i} className="flex items-start gap-2.5 py-1.5 px-1 border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors">
                            <span className={`w-1.5 h-1.5 mt-1.5 rounded-full shrink-0 ${isCreate ? 'bg-emerald-500' : isDelete ? 'bg-rose-500' : 'bg-[#D1D5DB]'}`} />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs text-[#4B5563] font-medium block truncate">{log.details || log.actionType}</span>
                              <span className="text-[11px] font-mono text-[#9CA3AF]">
                                {log.date ? new Date(log.date).toLocaleDateString('ru-RU').replace(/\./g, '/') + ' ' + new Date(log.date).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : ''}
                              </span>
                            </div>
                            <span className={`${UI.chip} shrink-0`}>
                              {log.actionType}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

            </div>
          )}

          {!isAdding && !selectedUser && !selectedRole && (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <div className="p-3 bg-[#F3F4F6] rounded-2xl mb-3">
                <ShieldCheck size={26} className="text-[#9CA3AF]" />
              </div>
              <span className="text-xs font-medium text-[#6B7280]">
                Выберите элемент для настройки
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

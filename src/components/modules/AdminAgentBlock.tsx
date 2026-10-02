
import {useState, useEffect} from 'react'
import {UserProfile} from '../../types'
import {useDialog} from '../DialogProvider'
import { ref, push, update } from 'firebase/database'
import { database, onValue } from '../../api'
import { 
  Sparkles, 
  Key, 
  Lock, 
  Activity, 
  ShieldCheck, 
  Terminal, 
  Settings,
  Power,
  Users,
  CheckCircle,
  XCircle,
  Truck,
  Map,
  Database,
  Bell,
  Plus,
  Eye,
  EyeOff,
  Trash2,
} from 'lucide-react';
import {useToast} from '../ToastProvider'
import { UI } from '../../ui/kit';
import { SectionHeader, SearchField, StatusText, EmptyState } from '../../ui/components';

interface AdminAgentBlockProps {
  user: UserProfile;
}

export default function AdminAgentBlock({ user }: AdminAgentBlockProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'overview' | 'sessions' | 'permissions' | 'tools' | 'policies' | 'approvals' | 'logs'>('overview');

  // State
  const [agentEnabled, setAgentEnabled] = useState(false);
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [toolsState, setToolsState] = useState<Record<string, boolean>>({});
  const [sessions, setSessions] = useState<any[]>([]);
  const [approvals, setApprovals] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [policies, setPolicies] = useState<any>({
    restrictToDomains: false,
    allowedDomains: '',
    requireApproveForMassActions: true,
    requireApproveForDeletes: true,
    maxRequestsPerMinute: 60
  });

  const [logsFilter, setLogsFilter] = useState('');
  const [visibleTokens, setVisibleTokens] = useState<Record<string, boolean>>({});

  // Data Definitions
  const agentTabs = [
    { id: 'overview', label: 'Обзор', icon: Activity },
    { id: 'sessions', label: 'Сессии & Токены', icon: Key },
    { id: 'permissions', label: 'Права модулей', icon: Lock },
    { id: 'tools', label: 'Endpoints & Tools', icon: Settings },
    { id: 'policies', label: 'Ограничения', icon: ShieldCheck },
    { id: 'approvals', label: 'Approvals', icon: CheckCircle },
    { id: 'logs', label: 'Журнал', icon: Terminal },
  ] as const;

  const modules = [
    { id: 'admin', name: 'Администрирование', icon: ShieldCheck },
    { id: 'users', name: 'Сотрудники и Роли', icon: Users },
    { id: 'fleet', name: 'База автопарка', icon: Truck },
    { id: 'drivers', name: 'Водители и Диспетчеры', icon: Users },
    { id: 'baza', name: 'Учет выезда', icon: Map },
    { id: 'finance', name: 'План дохода и Финансы', icon: Activity },
    { id: 'tariffs', name: 'Тарифные группы', icon: Database },
    { id: 'notifications', name: 'Уведомления', icon: Bell },
  ];

  const permissionLevels = [
    { value: 'none', label: 'Нет доступа' },
    { value: 'read', label: 'Только чтение' },
    { value: 'write', label: 'Чтение + Изменение' },
    { value: 'admin', label: 'Расширенный (Admin)' }
  ];

  const availableTools = [
    { id: 'read:getVehicle', name: 'getVehicle', desc: 'Чтение данных об автомобиле и его статусе', type: 'read' },
    { id: 'read:getTrips', name: 'getTrips', desc: 'Получение списка рейсов и планов дохода', type: 'read' },
    { id: 'write:updateCar', name: 'updateVehicleStatus', desc: 'Изменение статуса или данных автомобиля', type: 'write' },
    { id: 'write:createTrip', name: 'createTripPlan', desc: 'Создание нового плана рейса', type: 'write' },
    { id: 'execute:massAssign', name: 'massAssignDriver', desc: 'Массовое назначение водителей на авто', type: 'execute', needsApprove: true },
    { id: 'execute:massTariff', name: 'massAssignTariff', desc: 'Массовое изменение тарифных групп', type: 'execute', needsApprove: true },
    { id: 'admin:deleteTrip', name: 'deleteTripPlan', desc: 'Удаление плана рейса', type: 'admin', needsApprove: true },
  ];

  useEffect(() => {
    // Agent Config
    const configRef = ref(database, 'agent_access_center/config');
    const unsubConfig = onValue(configRef, (snapshot) => {
      const data = snapshot.val() || {};
      setAgentEnabled(data.enabled || false);
      setPermissions(data.permissions || {});
      setToolsState(data.tools || {});
      if (data.policies) setPolicies(data.policies);
    });

    // Sessions
    const sessRef = ref(database, 'agent_access_center/sessions');
    const unsubSess = onValue(sessRef, (snapshot) => {
      const data = snapshot.val() || {};
      setSessions(Object.keys(data).map(k => ({ id: k, ...data[k] })));
    });

    // Approvals
    const appRef = ref(database, 'agent_access_center/approvals');
    const unsubApp = onValue(appRef, (snapshot) => {
      const data = snapshot.val() || {};
      setApprovals(Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => b.requestedAt - a.requestedAt));
    });

    // Logs
    const logsRef = ref(database, 'agent_access_center/logs');
    const unsubLogs = onValue(logsRef, (snapshot) => {
      const data = snapshot.val() || {};
      setLogs(Object.keys(data).map(k => ({ id: k, ...data[k] })).sort((a,b) => b.timestamp - a.timestamp).slice(0, 100)); // last 100
    });

    return () => { unsubConfig(); unsubSess(); unsubApp(); unsubLogs(); };
  }, []);

  const saveConfigField = (field: string, value: any) => {
    update(ref(database, 'agent_access_center/config'), {
      [field]: value,
      lastUpdated: Date.now(),
      updatedBy: user.name
    });
  };

  const logAction = (action: string, status: 'success' | 'error' | 'blocked', details: string) => {
    push(ref(database, 'agent_access_center/logs'), {
      timestamp: Date.now(),
      action,
      status,
      details,
      initiator: user.name
    });
  };

  const toggleAgent = async () => {
    if (!agentEnabled && await showConfirm('Включить глобальный доступ внешнего AI Agent App к API?')) {
      saveConfigField('enabled', true);
      toast('Агент API активирован', 'success');
      logAction('Глобальный доступ', 'success', 'Агент API включен администратором');
    } else if (agentEnabled && await showConfirm('Отключить агента? Все активные сессии будут приостановлены.')) {
      saveConfigField('enabled', false);
      toast('Агент API отключен', 'success');
      logAction('Глобальный доступ', 'blocked', 'Агент API выключен администратором');
    }
  };

  const createSession = () => {
    const token = 'agt_sess_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    push(ref(database, 'agent_access_center/sessions'), {
      name: `Сессия от ${new Date().toLocaleDateString('ru-RU').replace(/\./g, '/')}`,
      tokenMasked: token.substring(0, 12) + '***',
      fullToken: token, // in real life, show once, don't store plain
      issuedAt: Date.now(),
      expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000, // 7 days
      status: 'active',
      issuedBy: user.name
    });
    toast('Новая сессия агента создана', 'success');
    logAction('Создание сессии', 'success', 'Сгенерирован новый токен сессии');
  };

  const revokeSession = async (id: string) => {
    if (await showConfirm('Отозвать этот токен? Внешний агент потеряет доступ по этой сессии.')) {
      update(ref(database, `agent_access_center/sessions/${id}`), {
        status: 'revoked',
        revokedAt: Date.now(),
        revokedBy: user.name
      });
      toast('Сессия отозвана', 'success');
      logAction('Отзыв сессии', 'success', `Отозван токен ${id}`);
    }
  };

  const toggleTokenVisibility = (sessId: string) => {
    setVisibleTokens(prev => {
      if (prev[sessId]) {
        const next = { ...prev };
        delete next[sessId];
        return next;
      }
      const next = { ...prev, [sessId]: true };
      setTimeout(() => {
        setVisibleTokens(prev2 => {
          if (!prev2[sessId]) return prev2;
          const next2 = { ...prev2 };
          delete next2[sessId];
          return next2;
        });
      }, 10000);
      return next;
    });
  };

  const resolveApproval = async (id: string, decision: 'approved' | 'rejected') => {
    if (await showConfirm(`${decision === 'approved' ? 'Подтвердить' : 'Отклонить'} это действие?`)) {
      update(ref(database, `agent_access_center/approvals/${id}`), {
        status: decision,
        resolvedAt: Date.now(),
        resolvedBy: user.name
      });
      toast(`Запрос ${decision === 'approved' ? 'подтвержден' : 'отклонен'}`, 'success');
      logAction('Approve Flow', 'success', `Действие ${id} ${decision}`);
    }
  };

  const formatDateTime = (ts: any) => {
    try {
      return new Date(ts).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      }).replace(/\./g, '/').replace(/,\s*/, ' ');
    } catch {
      return String(ts);
    }
  };

  const typeChip = (t: string) =>
    t === 'read' ? 'bg-blue-50 text-blue-700 border-blue-200' :
    t === 'write' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
    t === 'execute' ? 'bg-amber-50 text-amber-700 border-amber-200' :
    'bg-rose-50 text-rose-700 border-rose-200';

  const iconBtnDanger = 'inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer';
  const pendingApprovals = approvals.filter(a => a.status === 'pending').length;

  // UI Renderers
  const renderOverview = () => (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col md:flex-row md:items-center justify-between gap-5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#121316] flex items-center gap-2">
            <Power className={`w-4 h-4 ${agentEnabled ? 'text-emerald-500' : 'text-[#9CA3AF]'}`} />
            Главный переключатель доступа
          </h3>
          <p className="text-xs text-[#6B7280] mt-1 max-w-xl leading-relaxed">
            Этот контроллер полностью разрешает или блокирует API для внешнего <strong className="font-semibold text-[#4B5563]">AI Agent App</strong>. 
            Внешний агент не запущен внутри Portal, он работает в отдельной среде. Здесь вы управляете тем, 
            к каким данным он имеет доступ и какие действия может совершать.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2 shrink-0">
          <button 
            onClick={toggleAgent}
            className={`relative w-14 h-8 rounded-full p-1 transition-colors duration-300 ease-in-out cursor-pointer ${agentEnabled ? 'bg-emerald-500' : 'bg-[#E5E7EB]'}`}
          >
            <div className="w-6 h-6 bg-white rounded-full shadow-sm transition-transform duration-300 flex items-center justify-center" style={{ transform: agentEnabled ? 'translateX(24px)' : 'translateX(0)' }}>
              <Power className={`w-3.5 h-3.5 ${agentEnabled ? 'text-emerald-500' : 'text-[#9CA3AF]'}`} />
            </div>
          </button>
          <span className={`text-[11px] font-semibold uppercase tracking-wider ${agentEnabled ? 'text-emerald-600' : 'text-[#6B7280]'}`}>
            {agentEnabled ? 'API Активен' : 'API Отключен'}
          </span>
        </div>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="flex items-start gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] shrink-0 mt-1.5" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Активные сессии</div>
            <div className="text-[11px] text-[#9CA3AF]">Короткоживущие токены доступа</div>
            <div className="mt-1 text-xl font-mono tabular-nums font-semibold text-[#121316]">
              {sessions.filter(s => s.status === 'active').length}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0 mt-1.5" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Ожидают подтверждения</div>
            <div className="text-[11px] text-[#9CA3AF]">Чувствительные действия (Approve flow)</div>
            <div className="mt-1 text-xl font-mono tabular-nums font-semibold text-[#121316]">
              {pendingApprovals}
            </div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0 mt-1.5" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Блокировки</div>
            <div className="text-[11px] text-[#9CA3AF]">Отклоненные вызовы за 24ч</div>
            <div className="mt-1 text-xl font-mono tabular-nums font-semibold text-[#121316]">
              {logs.filter(l => l.status === 'blocked').length}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSessions = () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#121316]">Управление Agent Sessions</h3>
          <p className="text-xs text-[#6B7280] mt-0.5 max-w-2xl leading-relaxed">
            Генерация и отзыв короткоживущих токенов. Не используйте постоянные ключи для внешних систем. 
            Если токен скомпрометирован или агент ведёт себя подозрительно — отзовите сессию.
          </p>
        </div>
        <button 
          onClick={createSession}
          className={`${UI.buttonPrimary} shrink-0`}
        >
          <Plus className="w-3.5 h-3.5" />
          Выпустить Token
        </button>
      </div>

      <div className={UI.tableWrap}>
        <table className={UI.table}>
          <thead>
            <tr className={UI.theadRow}>
              <th className={UI.th}>Название сессии</th>
              <th className={UI.th}>Токен</th>
              <th className={UI.th}>Выдан</th>
              <th className={UI.th}>Истекает</th>
              <th className={UI.th}>Статус</th>
              <th className={UI.th}>Действия</th>
            </tr>
          </thead>
          <tbody>
            {sessions.sort((a,b) => b.issuedAt - a.issuedAt).map(sess => (
              <tr key={sess.id} className={UI.tr}>
                <td className={UI.td}>
                  <div className="text-xs font-semibold text-[#121316]">{sess.name}</div>
                  <div className="text-[11px] text-[#9CA3AF] mt-0.5">Кем: {sess.issuedBy}</div>
                </td>
                <td className={UI.td}>
                  <div className="flex items-center gap-2">
                    <code className={`${UI.chip} font-mono`}>{sess.tokenMasked}</code>
                    {sess.fullToken && (
                      <button
                        onClick={() => toggleTokenVisibility(sess.id)}
                        className={UI.buttonIcon}
                        title={visibleTokens[sess.id] ? 'Скрыть токен' : 'Показать полный токен'}
                      >
                        {visibleTokens[sess.id]
                          ? <EyeOff className="w-3.5 h-3.5" />
                          : <Eye className="w-3.5 h-3.5" />
                        }
                      </button>
                    )}
                  </div>
                  {sess.fullToken && visibleTokens[sess.id] && (
                    <div className="text-[11px] font-mono text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1.5 mt-1.5 break-all select-all">
                      {sess.fullToken}
                      <div className="text-[10px] text-amber-600 mt-0.5 font-medium">Автоскрытие через 10 с</div>
                    </div>
                  )}
                </td>
                <td className={`${UI.tdMono} text-[#6B7280] font-normal`}>{formatDateTime(sess.issuedAt)}</td>
                <td className={`${UI.tdMono} text-[#6B7280] font-normal`}>{formatDateTime(sess.expiresAt)}</td>
                <td className={UI.td}>
                  <StatusText color={sess.status === 'active' ? 'emerald' : 'rose'}>
                    {sess.status === 'active' ? 'Активна' : 'Отозвана'}
                  </StatusText>
                </td>
                <td className={UI.td}>
                  {sess.status === 'active' && (
                    <button 
                      onClick={() => revokeSession(sess.id)}
                      className={iconBtnDanger}
                      title="Отозвать"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-xs text-[#6B7280]">Нет выпущенных сессий</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPermissions = () => (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-[#121316]">Права по модулям</h3>
        <p className="text-xs text-[#6B7280] mt-0.5 max-w-2xl leading-relaxed">
          Матрица прав определяет, какие модули Portal агент может читать или изменять. 
          Эти ограничения работают на уровне доступа к данным API.
        </p>
      </div>

      <div className={UI.tableWrap}>
        <table className={UI.table}>
          <thead>
            <tr className={UI.theadRow}>
              <th className={UI.th}>Модуль</th>
              <th className={UI.th}>Идентификатор</th>
              <th className={UI.th}>Уровень доступа</th>
            </tr>
          </thead>
          <tbody>
            {modules.map(mod => {
              const Icon = mod.icon;
              const currentPerm = permissions[mod.id] || 'none';
              return (
                <tr key={mod.id} className={UI.tr}>
                  <td className={UI.td}>
                    <div className="flex items-center gap-2.5">
                      <div className="p-1.5 bg-[#F3F4F6] text-[#4B5563] rounded-lg shrink-0">
                        <Icon className="w-3.5 h-3.5" />
                      </div>
                      <span className="text-xs font-medium text-[#121316]">{mod.name}</span>
                    </div>
                  </td>
                  <td className={`${UI.tdMono} text-[#6B7280] font-normal`}>module:{mod.id}</td>
                  <td className={UI.td}>
                    <select 
                      value={currentPerm}
                      onChange={(e) => {
                        const newPerms = {...permissions, [mod.id]: e.target.value};
                        setPermissions(newPerms);
                        saveConfigField('permissions', newPerms);
                        toast('Права обновлены', 'success');
                      }}
                      className={`${UI.select} w-full sm:w-[200px]`}
                    >
                      {permissionLevels.map(lvl => (
                        <option key={lvl.value} value={lvl.value}>{lvl.label}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTools = () => (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-[#121316]">Реестр Endpoints & Tools</h3>
        <p className="text-xs text-[#6B7280] mt-0.5 max-w-2xl leading-relaxed">
          Список реальных операций, которые выставлены во внешнее API для агента.
          Вы можете точечно отключать определенные инструменты, даже если у агента есть доступ к модулю.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {availableTools.map(tool => {
          const isActive = toolsState[tool.id] !== false; // true by default
          return (
            <div key={tool.id} className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${typeChip(tool.type)}`}>
                    {tool.type}
                  </span>
                  <h4 className="text-xs font-semibold text-[#121316] font-mono">{tool.name}</h4>
                  {tool.needsApprove && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                      <Lock className="w-3 h-3" /> Требует подтверждения
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#6B7280]">{tool.desc}</p>
                <div className="text-[11px] text-[#9CA3AF] mt-1 font-mono">ID: {tool.id}</div>
              </div>
              
              <div className="flex items-center gap-3 shrink-0">
                <StatusText color={isActive ? 'emerald' : 'grey'}>
                  {isActive ? 'Включен' : 'Отключен'}
                </StatusText>
                <button 
                  onClick={() => {
                    const newTools = {...toolsState, [tool.id]: !isActive};
                    setToolsState(newTools);
                    saveConfigField('tools', newTools);
                  }}
                  className={`w-11 h-6 rounded-full p-0.5 transition-colors duration-300 ease-in-out cursor-pointer ${isActive ? 'bg-emerald-500' : 'bg-[#E5E7EB]'}`}
                >
                  <div className="w-5 h-5 bg-white rounded-full shadow-sm transition-transform duration-300" style={{ transform: isActive ? 'translateX(20px)' : 'translateX(0)' }} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderApprovals = () => (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-[#121316]">Approve Flow для чувствительных действий</h3>
        <p className="text-xs text-[#6B7280] mt-0.5 max-w-2xl leading-relaxed">
          Действия, требующие участия человека (массовые изменения, удаление), попадают сюда со статусом Pending.
          Они не будут выполнены в Portal, пока администратор не нажмет Подтвердить.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {approvals.length === 0 && (
          <div className="py-12 text-center">
            <CheckCircle className="w-6 h-6 text-emerald-500 mx-auto mb-2" />
            <p className="text-xs font-medium text-[#4B5563]">Нет ожидающих подтверждений</p>
            <p className="text-xs text-[#6B7280] mt-1">Все запросы обработаны.</p>
          </div>
        )}

        {approvals.map(app => (
          <div key={app.id} className={`bg-white border rounded-2xl shadow-xs p-5 transition-colors ${
            app.status === 'pending' ? 'border-amber-300' : 'border-[#E5E7EB]'
          }`}>
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <StatusText color={app.status === 'pending' ? 'amber' : app.status === 'approved' ? 'emerald' : 'rose'}>
                    {app.status === 'pending' ? 'Ожидает' : app.status === 'approved' ? 'Подтверждено' : 'Отклонено'}
                  </StatusText>
                  <span className="text-[11px] font-mono text-[#9CA3AF]">{formatDateTime(app.requestedAt)}</span>
                </div>
                <h4 className="text-xs font-medium text-[#4B5563] mb-2">
                  Агент запрашивает вызов: <span className="font-mono font-semibold text-[#121316]">{app.action}</span>
                </h4>
                <div className="text-[11px] text-[#4B5563] bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 font-mono whitespace-pre-wrap break-all">
                  {JSON.stringify(app.payload, null, 2)}
                </div>
                {app.status !== 'pending' && (
                  <div className="text-[11px] text-[#9CA3AF] mt-2">
                    Разрешено/Отклонено: {app.resolvedBy} в {formatDateTime(app.resolvedAt)}
                  </div>
                )}
              </div>
              
              {app.status === 'pending' && (
                <div className="flex sm:flex-col gap-2 shrink-0 sm:min-w-[150px]">
                  <button 
                    onClick={() => resolveApproval(app.id, 'approved')}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer min-h-[44px]"
                  >
                    <CheckCircle className="w-3.5 h-3.5" /> Подтвердить
                  </button>
                  <button 
                    onClick={() => resolveApproval(app.id, 'rejected')}
                    className={`${UI.buttonGhost} w-full`}
                  >
                    <XCircle className="w-3.5 h-3.5" /> Отклонить
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderPolicies = () => (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold text-[#121316]">Ограничения и Guardrails (Policies)</h3>
        <p className="text-xs text-[#6B7280] mt-0.5 max-w-2xl leading-relaxed">
          Глобальные политики безопасности, которые применяются ко всем вызовам агента поверх прав доступа к модулям.
        </p>
      </div>

      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col">
        <div className="flex items-center justify-between gap-4 py-3.5 border-b border-[#E5E7EB] first:pt-0">
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-[#121316]">Требовать Approve для массовых изменений</h4>
            <p className="text-[11px] text-[#6B7280] mt-0.5">Любые действия, затрагивающие более 1 записи, будут отправлены в Pending</p>
          </div>
          <input 
            type="checkbox" 
            checked={policies.requireApproveForMassActions}
            onChange={(e) => {
              const p = {...policies, requireApproveForMassActions: e.target.checked};
              setPolicies(p);
              saveConfigField('policies', p);
            }}
            className={UI.checkbox}
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-3.5 border-b border-[#E5E7EB]">
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-[#121316]">Требовать Approve для удаления</h4>
            <p className="text-[11px] text-[#6B7280] mt-0.5">Блокирует автоматическое удаление данных</p>
          </div>
          <input 
            type="checkbox" 
            checked={policies.requireApproveForDeletes}
            onChange={(e) => {
              const p = {...policies, requireApproveForDeletes: e.target.checked};
              setPolicies(p);
              saveConfigField('policies', p);
            }}
            className={UI.checkbox}
          />
        </div>
        <div className="flex items-center justify-between gap-4 py-3.5 border-b border-[#E5E7EB]">
          <div className="min-w-0">
            <h4 className="text-xs font-medium text-[#121316]">Лимит запросов (Rate Limit)</h4>
            <p className="text-[11px] text-[#6B7280] mt-0.5">Максимальное количество API вызовов в минуту</p>
          </div>
          <input 
            type="number" 
            value={policies.maxRequestsPerMinute}
            onChange={(e) => {
              const p = {...policies, maxRequestsPerMinute: parseInt(e.target.value) || 60};
              setPolicies(p);
              saveConfigField('policies', p);
            }}
            className={`${UI.inputSm} w-20 text-center font-mono shrink-0`}
          />
        </div>
        <div className="py-3.5 last:pb-0">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h4 className="text-xs font-medium text-[#121316]">Ограничение по IP / Доменам агента (CORS)</h4>
              <p className="text-[11px] text-[#6B7280] mt-0.5">Оставьте пустым для доступа с любых IP (при наличии токена)</p>
            </div>
            <input 
              type="checkbox" 
              checked={policies.restrictToDomains}
              onChange={(e) => {
                const p = {...policies, restrictToDomains: e.target.checked};
                setPolicies(p);
                saveConfigField('policies', p);
              }}
              className={UI.checkbox}
            />
          </div>
          <input 
            type="text" 
            disabled={!policies.restrictToDomains}
            value={policies.allowedDomains}
            onChange={(e) => {
              const p = {...policies, allowedDomains: e.target.value};
              setPolicies(p);
              saveConfigField('policies', p);
            }}
            placeholder="https://ai-agent-app.example.com"
            className={`${UI.input} mt-3 font-mono disabled:opacity-50`}
          />
        </div>
      </div>
    </div>
  );

  const renderLogs = () => {
    const filteredLogs = logs.filter(l => !logsFilter || JSON.stringify(l).toLowerCase().includes(logsFilter.toLowerCase()));
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-[#121316]">Журнал вызовов (Audit Log)</h3>
            <p className="text-xs text-[#6B7280] mt-0.5 max-w-2xl leading-relaxed">
              История всех запросов агента, ошибок доступа, блокировок по политикам и выданных сессий.
            </p>
          </div>
          <div className="w-full sm:w-[280px] shrink-0">
            <SearchField
              value={logsFilter}
              onChange={setLogsFilter}
              placeholder="Поиск по логам..."
              ariaLabel="Поиск по журналу агента"
            />
          </div>
        </div>

        <div className="max-h-[500px] overflow-auto custom-scrollbar">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.stickyTh}>Время</th>
                <th className={UI.stickyTh}>Событие / Действие</th>
                <th className={UI.stickyTh}>Статус</th>
                <th className={UI.stickyTh}>Детали</th>
                <th className={UI.stickyTh}>Инициатор</th>
              </tr>
            </thead>
            <tbody>
              {filteredLogs.map(log => (
                <tr key={log.id} className="hover:bg-[#F9FAFB] transition-colors">
                  <td className="px-3 py-2.5 border-b border-[#E5E7EB] whitespace-nowrap text-[11px] text-[#6B7280] font-mono">
                    {formatDateTime(log.timestamp)}
                  </td>
                  <td className="px-3 py-2.5 border-b border-[#E5E7EB]">
                    <span className="text-xs font-semibold text-[#121316]">{log.action}</span>
                  </td>
                  <td className="px-3 py-2.5 border-b border-[#E5E7EB]">
                    <StatusText color={log.status === 'success' ? 'emerald' : log.status === 'blocked' ? 'amber' : 'rose'}>
                      {log.status}
                    </StatusText>
                  </td>
                  <td className="px-3 py-2.5 border-b border-[#E5E7EB] text-xs text-[#6B7280] max-w-[300px] truncate" title={log.details}>
                    {log.details}
                  </td>
                  <td className="px-3 py-2.5 border-b border-[#E5E7EB] text-[11px] text-[#9CA3AF] font-mono">
                    {log.initiator || 'Agent API'}
                  </td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-10 text-center">
                    <EmptyState
                      kind={logs.length === 0 ? 'empty' : 'no-results'}
                      title={logs.length === 0 ? 'Логи пока пусты' : undefined}
                      hint={logs.length === 0 ? 'События появятся здесь после первых вызовов агента.' : undefined}
                      query={logsFilter || undefined}
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={<Sparkles className="w-4 h-4" />}
        tone="accent"
        title="Агент API — Access Center"
        subtitle="Единая точка управления доступом внешнего AI Agent App к Portal"
      />

      {/* Навигация по вкладкам агента */}
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Разделы панели агента">
        {agentTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                isActive 
                  ? 'bg-[#121316] text-white' 
                  : 'bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === 'approvals' && pendingApprovals > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                  isActive ? 'bg-white/20 text-white' : 'bg-amber-500 text-white'
                }`}>
                  {pendingApprovals}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Содержимое вкладки */}
      <div>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'sessions' && renderSessions()}
        {activeTab === 'permissions' && renderPermissions()}
        {activeTab === 'tools' && renderTools()}
        {activeTab === 'policies' && renderPolicies()}
        {activeTab === 'approvals' && renderApprovals()}
        {activeTab === 'logs' && renderLogs()}
      </div>

    </div>
  );
}

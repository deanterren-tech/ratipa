
import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { dbService } from '../../firebase';
import { useDialog } from '../DialogProvider';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { database } from '../../firebase';
import { 
  Sparkles, 
  Key, 
  RefreshCw, 
  Copy, 
  Check, 
  AlertTriangle, 
  Activity, 
  Globe, 
  ShieldCheck, 
  Terminal, 
  Play, 
  X, 
  Clock, 
  Calendar,
  Lock,
  Database,
  Map,
  Truck,
  Settings,
  Bell,
  Power,
  Users,
  CheckCircle,
  XCircle,
  FileText,
  Trash2,
  Plus
} from 'lucide-react';
import { useToast } from '../ToastProvider';

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
      name: `Сессия от ${new Date().toLocaleDateString()}`,
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

  // UI Renderers
  const renderOverview = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5 flex flex-col md:flex-row items-center justify-between gap-6">
        <div>
          <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-2">
            <Power className={`w-6 h-6 ${agentEnabled ? 'text-emerald-500' : 'text-slate-400'}`} />
            Главный переключатель доступа
          </h3>
          <p className="text-sm text-slate-500 max-w-xl leading-relaxed">
            Этот контроллер полностью разрешает или блокирует API для внешнего <strong>AI Agent App</strong>. 
            Внешний агент не запущен внутри Portal, он работает в отдельной среде. Здесь вы управляете тем, 
            к каким данным он имеет доступ и какие действия может совершать.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2">
          <button 
            onClick={toggleAgent}
            className={`relative w-24 h-12 rounded-full p-1 transition-colors duration-300 ease-in-out cursor-pointer shadow-inner ${agentEnabled ? 'bg-emerald-500 shadow-emerald-500/20' : 'bg-slate-300'}`}
          >
            <div className={`w-10 h-10 bg-white rounded-full shadow-md transform transition-transform duration-300 flex items-center justify-center ${agentEnabled ? 'translate-x-12' : 'translate-x-0'}`}>
              <Power className={`w-5 h-5 ${agentEnabled ? 'text-emerald-500' : 'text-slate-400'}`} />
            </div>
          </button>
          <span className={`text-xs font-black uppercase tracking-widest ${agentEnabled ? 'text-emerald-600' : 'text-slate-500'}`}>
            {agentEnabled ? 'API Активен' : 'API Отключен'}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5">
          <div className="w-10 h-10 rounded-2xl bg-indigo-50 flex items-center justify-center mb-4">
            <Key className="w-5 h-5 text-indigo-500" />
          </div>
          <h4 className="font-bold text-slate-800 mb-1">Активные сессии</h4>
          <p className="text-xs text-slate-500 mb-4">Короткоживущие токены доступа для агента</p>
          <div className="text-3xl font-black text-slate-900 font-mono">
            {sessions.filter(s => s.status === 'active').length}
          </div>
        </div>
        <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5">
          <div className="w-10 h-10 rounded-2xl bg-amber-50 flex items-center justify-center mb-4">
            <CheckCircle className="w-5 h-5 text-amber-500" />
          </div>
          <h4 className="font-bold text-slate-800 mb-1">Ожидают подтверждения</h4>
          <p className="text-xs text-slate-500 mb-4">Чувствительные действия (Approve flow)</p>
          <div className="text-3xl font-black text-slate-900 font-mono">
            {approvals.filter(a => a.status === 'pending').length}
          </div>
        </div>
        <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5">
          <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center mb-4">
            <ShieldCheck className="w-5 h-5 text-rose-500" />
          </div>
          <h4 className="font-bold text-slate-800 mb-1">Блокировки</h4>
          <p className="text-xs text-slate-500 mb-4">Отклоненные вызовы за 24ч</p>
          <div className="text-3xl font-black text-slate-900 font-mono">
            {logs.filter(l => l.status === 'blocked').length}
          </div>
        </div>
      </div>
    </div>
  );

  const renderSessions = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex justify-between items-end">
        <div>
          <h3 className="text-lg font-black text-slate-900">Управление Agent Sessions</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            Генерация и отзыв короткоживущих токенов. Не используйте постоянные ключи для внешних систем. 
            Если токен скомпрометирован или агент ведет себя подозрительно — отзовите сессию.
          </p>
        </div>
        <button 
          onClick={createSession}
          className="bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 flex items-center gap-2 transition"
        >
          <Plus className="w-4 h-4" />
          Выпустить Token
        </button>
      </div>

      <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-slate-200/50 shadow-xl shadow-slate-900/5 overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-50/80 border-b border-slate-200/60">
            <tr className="text-[10px] font-black text-slate-500 uppercase tracking-wider">
              <th className="p-4">Название сессии</th>
              <th className="p-4">Токен</th>
              <th className="p-4">Выдан</th>
              <th className="p-4">Истекает</th>
              <th className="p-4">Статус</th>
              <th className="p-4 text-right">Действия</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100/80">
            {sessions.sort((a,b) => b.issuedAt - a.issuedAt).map(sess => (
              <tr key={sess.id} className="hover:bg-slate-50/50 transition">
                <td className="p-4">
                  <div className="text-sm font-bold text-slate-800">{sess.name}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">Кем: {sess.issuedBy}</div>
                </td>
                <td className="p-4">
                  <code className="text-xs font-mono text-slate-600 bg-slate-100 px-2 py-1 rounded">{sess.tokenMasked}</code>
                  {sess.fullToken && (
                    <div className="text-[10px] text-rose-500 mt-1 font-bold">Скопируйте токен сейчас: {sess.fullToken}</div>
                  )}
                </td>
                <td className="p-4 text-xs text-slate-600">{new Date(sess.issuedAt).toLocaleString('ru-RU')}</td>
                <td className="p-4 text-xs text-slate-600">{new Date(sess.expiresAt).toLocaleString('ru-RU')}</td>
                <td className="p-4">
                  <span className={`inline-flex items-center px-2 py-1 rounded-md text-[10px] font-black uppercase tracking-wider ${
                    sess.status === 'active' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
                    sess.status === 'revoked' ? 'bg-rose-50 text-rose-700 border border-rose-200' :
                    'bg-slate-50 text-slate-700 border border-slate-200'
                  }`}>
                    {sess.status === 'active' ? 'Активна' : 'Отозвана'}
                  </span>
                </td>
                <td className="p-4 text-right">
                  {sess.status === 'active' && (
                    <button 
                      onClick={() => revokeSession(sess.id)}
                      className="text-rose-500 hover:bg-rose-50 p-2 rounded-xl transition"
                      title="Отозвать"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {sessions.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">Нет выпущенных сессий</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderPermissions = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h3 className="text-lg font-black text-slate-900">Права по модулям</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Матрица прав определяет, какие модули Portal агент может читать или изменять. 
          Эти ограничения работают на уровне доступа к данным API.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {modules.map(mod => {
          const Icon = mod.icon;
          const currentPerm = permissions[mod.id] || 'none';
          return (
            <div key={mod.id} className="bg-white/60 backdrop-blur-md rounded-2xl p-5 border border-slate-200/50 shadow-sm flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center">
                  <Icon className="w-5 h-5 text-indigo-500" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">{mod.name}</h4>
                  <div className="text-[10px] text-slate-400 font-mono mt-0.5">module:{mod.id}</div>
                </div>
              </div>
              <select 
                value={currentPerm}
                onChange={(e) => {
                  const newPerms = {...permissions, [mod.id]: e.target.value};
                  setPermissions(newPerms);
                  saveConfigField('permissions', newPerms);
                  toast('Права обновлены', 'success');
                }}
                className="bg-white border border-slate-200 text-xs font-bold text-slate-700 rounded-xl px-3 py-2 outline-none focus:border-indigo-400 shadow-sm cursor-pointer w-[180px]"
              >
                {permissionLevels.map(lvl => (
                  <option key={lvl.value} value={lvl.value}>{lvl.label}</option>
                ))}
              </select>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderTools = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h3 className="text-lg font-black text-slate-900">Реестр Endpoints & Tools</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Список реальных операций, которые выставлены во внешнее API для агента.
          Вы можете точечно отключать определенные инструменты, даже если у агента есть доступ к модулю.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3">
        {availableTools.map(tool => {
          const isActive = toolsState[tool.id] !== false; // true by default
          return (
            <div key={tool.id} className="bg-white/60 backdrop-blur-md rounded-2xl p-4 border border-slate-200/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                    tool.type === 'read' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                    tool.type === 'write' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    tool.type === 'execute' ? 'bg-purple-50 text-purple-700 border-purple-200' :
                    'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {tool.type}
                  </span>
                  <h4 className="text-sm font-bold text-slate-800 font-mono">{tool.name}</h4>
                  {tool.needsApprove && (
                    <span className="flex items-center gap-1 text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                      <Lock className="w-3 h-3" /> Requires Approve
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500">{tool.desc}</p>
                <div className="text-[10px] text-slate-400 mt-1">ID: {tool.id}</div>
              </div>
              
              <div className="flex items-center gap-3">
                <span className={`text-[10px] font-black uppercase ${isActive ? 'text-emerald-500' : 'text-slate-400'}`}>
                  {isActive ? 'Active' : 'Disabled'}
                </span>
                <button 
                  onClick={() => {
                    const newTools = {...toolsState, [tool.id]: !isActive};
                    setToolsState(newTools);
                    saveConfigField('tools', newTools);
                  }}
                  className={`w-12 h-6 rounded-full p-1 transition-colors duration-300 ease-in-out cursor-pointer ${isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <div className={`w-4 h-4 bg-white rounded-full shadow-md transform transition-transform duration-300 ${isActive ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderApprovals = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h3 className="text-lg font-black text-slate-900">Approve Flow для чувствительных действий</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Действия, требующие участия человека (массовые изменения, удаление), попадают сюда со статусом Pending.
          Они не будут выполнены в Portal, пока администратор не нажмет Подтвердить.
        </p>
      </div>

      <div className="space-y-4">
        {approvals.length === 0 && (
          <div className="bg-slate-50 rounded-3xl border border-slate-200 border-dashed p-8 text-center">
            <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
            <div className="text-sm font-bold text-slate-700">Нет ожидающих подтверждений</div>
            <p className="text-xs text-slate-500">Все запросы обработаны.</p>
          </div>
        )}

        {approvals.map(app => (
          <div key={app.id} className={`bg-white/60 backdrop-blur-md rounded-2xl p-5 border shadow-sm transition ${
            app.status === 'pending' ? 'border-amber-300 shadow-amber-500/10' : 'border-slate-200/50 opacity-70'
          }`}>
            <div className="flex flex-col sm:flex-row justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                    app.status === 'pending' ? 'bg-amber-50 text-amber-700 border-amber-200' :
                    app.status === 'approved' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                    'bg-rose-50 text-rose-700 border-rose-200'
                  }`}>
                    {app.status}
                  </span>
                  <span className="text-xs text-slate-400">{new Date(app.requestedAt).toLocaleString('ru-RU')}</span>
                </div>
                <h4 className="text-sm font-bold text-slate-800 mb-1">
                  Агент запрашивает вызов: <span className="font-mono text-indigo-600">{app.action}</span>
                </h4>
                <div className="text-xs text-slate-600 bg-slate-50 p-3 rounded-xl font-mono border border-slate-100">
                  {JSON.stringify(app.payload, null, 2)}
                </div>
                {app.status !== 'pending' && (
                  <div className="text-[10px] text-slate-500 mt-2">
                    Разрешено/Отклонено: {app.resolvedBy} в {new Date(app.resolvedAt).toLocaleString('ru-RU')}
                  </div>
                )}
              </div>
              
              {app.status === 'pending' && (
                <div className="flex sm:flex-col gap-2 min-w-[120px]">
                  <button 
                    onClick={() => resolveApproval(app.id, 'approved')}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold transition flex justify-center items-center gap-2"
                  >
                    <CheckCircle className="w-4 h-4" /> Approve
                  </button>
                  <button 
                    onClick={() => resolveApproval(app.id, 'rejected')}
                    className="w-full bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 text-slate-700 hover:text-rose-600 px-4 py-2 rounded-xl text-xs font-bold transition flex justify-center items-center gap-2"
                  >
                    <XCircle className="w-4 h-4" /> Reject
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
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h3 className="text-lg font-black text-slate-900">Ограничения и Guardrails (Policies)</h3>
        <p className="text-sm text-slate-500 mt-1 max-w-2xl">
          Глобальные политики безопасности, которые применяются ко всем вызовам агента поверх прав доступа к модулям.
        </p>
      </div>

      <div className="bg-white/60 backdrop-blur-md rounded-3xl p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-800">Требовать Approve для массовых изменений</h4>
            <p className="text-[10px] text-slate-500">Любые действия, затрагивающие более 1 записи, будут отправлены в Pending</p>
          </div>
          <input 
            type="checkbox" 
            checked={policies.requireApproveForMassActions}
            onChange={(e) => {
              const p = {...policies, requireApproveForMassActions: e.target.checked};
              setPolicies(p);
              saveConfigField('policies', p);
            }}
            className="w-4 h-4 text-indigo-600 rounded border-slate-300"
          />
        </div>
        <div className="border-t border-slate-100"></div>
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-800">Требовать Approve для удаления</h4>
            <p className="text-[10px] text-slate-500">Блокирует автоматическое удаление данных</p>
          </div>
          <input 
            type="checkbox" 
            checked={policies.requireApproveForDeletes}
            onChange={(e) => {
              const p = {...policies, requireApproveForDeletes: e.target.checked};
              setPolicies(p);
              saveConfigField('policies', p);
            }}
            className="w-4 h-4 text-indigo-600 rounded border-slate-300"
          />
        </div>
        <div className="border-t border-slate-100"></div>
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <h4 className="text-sm font-bold text-slate-800">Лимит запросов (Rate Limit)</h4>
            <p className="text-[10px] text-slate-500">Максимальное количество API вызовов в минуту</p>
          </div>
          <input 
            type="number" 
            value={policies.maxRequestsPerMinute}
            onChange={(e) => {
              const p = {...policies, maxRequestsPerMinute: parseInt(e.target.value) || 60};
              setPolicies(p);
              saveConfigField('policies', p);
            }}
            className="w-20 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs font-mono text-center outline-none focus:border-indigo-400"
          />
        </div>
        <div className="border-t border-slate-100"></div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-bold text-slate-800">Ограничение по IP / Доменам агента (CORS)</h4>
            <input 
              type="checkbox" 
              checked={policies.restrictToDomains}
              onChange={(e) => {
                const p = {...policies, restrictToDomains: e.target.checked};
                setPolicies(p);
                saveConfigField('policies', p);
              }}
              className="w-4 h-4 text-indigo-600 rounded border-slate-300"
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
            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono outline-none focus:border-indigo-400 disabled:opacity-50"
          />
          <p className="text-[10px] text-slate-400 mt-1">Оставьте пустым для доступа с любых IP (при наличии токена)</p>
        </div>
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-end gap-4">
        <div>
          <h3 className="text-lg font-black text-slate-900">Журнал вызовов (Audit Log)</h3>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">
            История всех запросов агента, ошибок доступа, блокировок по политикам и выданных сессий.
          </p>
        </div>
        <div className="relative">
          <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input 
            type="text"
            placeholder="Поиск по логам..."
            value={logsFilter}
            onChange={e => setLogsFilter(e.target.value)}
            className="pl-9 pr-8 py-2.5 text-xs font-bold bg-white/80 backdrop-blur-md border border-slate-200 shadow-sm rounded-xl w-full sm:w-[250px] focus:outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 transition-all"
          />
          {logsFilter && (
            <button onClick={() => setLogsFilter('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="bg-white/60 backdrop-blur-md rounded-3xl border border-slate-200/50 shadow-xl shadow-slate-900/5 overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-slate-50/95 backdrop-blur z-10 shadow-sm">
              <tr className="text-[10px] font-black text-slate-500 uppercase tracking-wider border-b border-slate-200/60">
                <th className="p-4">Время</th>
                <th className="p-4">Событие / Действие</th>
                <th className="p-4">Статус</th>
                <th className="p-4">Детали</th>
                <th className="p-4">Инициатор</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100/80">
              {logs.filter(l => !logsFilter || JSON.stringify(l).toLowerCase().includes(logsFilter.toLowerCase())).map(log => (
                <tr key={log.id} className="hover:bg-slate-50/50 transition">
                  <td className="p-4 whitespace-nowrap text-xs text-slate-500 font-mono">
                    {new Date(log.timestamp).toLocaleString('ru-RU')}
                  </td>
                  <td className="p-4">
                    <span className="text-xs font-bold text-slate-800">{log.action}</span>
                  </td>
                  <td className="p-4">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-wider ${
                      log.status === 'success' ? 'text-emerald-700 bg-emerald-50 border border-emerald-200' : 
                      log.status === 'blocked' ? 'text-amber-700 bg-amber-50 border border-amber-200' :
                      'text-rose-700 bg-rose-50 border border-rose-200'
                    }`}>
                      {log.status}
                    </span>
                  </td>
                  <td className="p-4 text-xs text-slate-600 max-w-[300px] truncate" title={log.details}>
                    {log.details}
                  </td>
                  <td className="p-4 text-[10px] text-slate-400 font-mono">
                    {log.initiator || 'Agent API'}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-8 text-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                    Логи пока пусты
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
          <Sparkles className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-xl font-black text-slate-900 tracking-tight">Агент API <span className="text-indigo-600">Access Center</span></h2>
          <p className="text-xs text-slate-500 font-medium mt-0.5">Единая точка управления доступом внешнего AI Agent App к Portal</p>
        </div>
      </div>

      {/* TABS NAVIGATION */}
      <div className="flex overflow-x-auto gap-2 p-1 bg-slate-100/50 backdrop-blur-sm rounded-2xl border border-slate-200/50 w-full no-scrollbar">
        {agentTabs.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all duration-200 ${
                isActive 
                  ? 'bg-white text-indigo-700 shadow-sm border border-slate-200/60' 
                  : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50'
              }`}
            >
              <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-500' : 'text-slate-400'}`} />
              {tab.label}
              {tab.id === 'approvals' && approvals.filter(a => a.status === 'pending').length > 0 && (
                <span className="bg-amber-500 text-white text-[9px] px-1.5 py-0.5 rounded-full ml-1">
                  {approvals.filter(a => a.status === 'pending').length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* CONTENT AREA */}
      <div className="pt-2">
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

// simple inline icon
function SearchIcon(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"></circle>
      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
    </svg>
  );
}

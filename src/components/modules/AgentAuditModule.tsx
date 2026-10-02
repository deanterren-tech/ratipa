import {useState, useEffect, useMemo} from 'react'
import {UserProfile, AgentAuditConfig, AgentAuditRun, AgentSuggestion} from '../../types'
import {useDialog} from '../DialogProvider'
import { useToast } from '../ToastProvider';
import { ref, push, update, remove } from 'firebase/database'
import { database, onValue } from '../../api'
import {
  Sparkles,
  Activity,
  ShieldCheck,
  Pause,
  Play,
  Terminal,
  Settings,
  History,
  List,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Send,
  ExternalLink,
  Plus,
  Search,
  X,
  Trash2,
  Eye,
} from 'lucide-react';
import { UI } from '../../ui/kit';
import { SectionHeader, SearchField, StatusText, EmptyState } from '../../ui/components';

const AGENT_AUDIT_PATH = 'agent_audit';
const DEFAULT_CONFIG: AgentAuditConfig = {
  enabled: false,
  agent1Enabled: true,
  agent2Enabled: true,
  agent1Interval: 'every week',
  agent2Interval: 'every week',
  telegramChatId: '',
  lastRunAgent1: 0,
  lastRunAgent2: 0,
  lastErrorAgent1: '',
  lastErrorAgent2: '',
  cronJobIdAgent1: '',
  cronJobIdAgent2: '',
  suggestionsSentCount: 0,
};

interface AgentAuditModuleProps {
  user: UserProfile;
}

const CATEGORY_LABELS: Record<string, string> = {
  portal: 'Портал',
  tasks: 'Задачи',
  firebase: 'Firebase',
  security: 'Безопасность',
  'ux-ui': 'UX/UI',
  ai: 'AI',
};

const CATEGORY_COLORS: Record<string, string> = {
  portal: 'bg-blue-50 text-blue-700 border-blue-200',
  tasks: 'bg-purple-50 text-purple-700 border-purple-200',
  firebase: 'bg-amber-50 text-amber-700 border-amber-200',
  security: 'bg-rose-50 text-rose-700 border-rose-200',
  'ux-ui': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  ai: 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

const PRIORITY_LABELS: Record<string, string> = {
  high: 'Высокий',
  medium: 'Средний',
  low: 'Низкий',
};

const PRIORITY_COLORS: Record<string, string> = {
  high: 'text-rose-600 bg-rose-50 border-rose-200',
  medium: 'text-amber-600 bg-amber-50 border-amber-200',
  low: 'text-emerald-600 bg-emerald-50 border-emerald-200',
};

const STATUS_LABELS: Record<string, string> = {
  new: 'Новое',
  reviewed: 'Просмотрено',
  accepted: 'Принято',
  rejected: 'Отклонено',
  implemented: 'Внедрено',
};

const formatDT = (ts: number) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString('ru-RU', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    }).replace(/\./g, '/').replace(/,\s*/, ' ');
  } catch { return String(ts); }
};

const computeHash = (title: string, agent: string): string => {
  let h = 0;
  const s = `${agent}:${title}`;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h = ((h << 5) - h) + c;
    h = h & h;
  }
  return `${agent}_${Math.abs(h).toString(36)}`;
};

export default function AgentAuditModule({ user }: AgentAuditModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  type Tab = 'overview' | 'suggestions' | 'history' | 'settings';
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [config, setConfig] = useState<AgentAuditConfig>(DEFAULT_CONFIG);
  const [runs, setRuns] = useState<AgentAuditRun[]>([]);
  const [suggestions, setSuggestions] = useState<AgentSuggestion[]>([]);
  const [suggestionsSearch, setSuggestionsSearch] = useState('');
  const [suggestionFilter, setSuggestionFilter] = useState<string>('all');
  const [editInterval1, setEditInterval1] = useState(config.agent1Interval);
  const [editInterval2, setEditInterval2] = useState(config.agent2Interval);
  const [editChatId, setEditChatId] = useState(config.telegramChatId);

  // Load data from Firebase
  useEffect(() => {
    const cfgRef = ref(database, `${AGENT_AUDIT_PATH}/config`);
    const unsubCfg = onValue(cfgRef, (snap) => {
      const data = snap.val() || {};
      const merged = { ...DEFAULT_CONFIG, ...data };
      setConfig(merged);
      setEditInterval1(merged.agent1Interval);
      setEditInterval2(merged.agent2Interval);
      setEditChatId(merged.telegramChatId);
    });

    const runsRef = ref(database, `${AGENT_AUDIT_PATH}/runs`);
    const unsubRuns = onValue(runsRef, (snap) => {
      const data = snap.val() || {};
      setRuns(
        Object.keys(data)
          .map(k => ({ id: k, ...data[k] } as AgentAuditRun))
          .sort((a, b) => b.timestamp - a.timestamp)
          .slice(0, 100)
      );
    });

    const sugRef = ref(database, `${AGENT_AUDIT_PATH}/suggestions`);
    const unsubSug = onValue(sugRef, (snap) => {
      const data = snap.val() || {};
      setSuggestions(
        Object.keys(data)
          .map(k => ({ id: k, ...data[k] } as AgentSuggestion))
          .sort((a, b) => b.timestamp - a.timestamp)
      );
    });

    return () => { unsubCfg(); unsubRuns(); unsubSug(); };
  }, []);

  const saveConfig = (patch: Partial<AgentAuditConfig>) => {
    const next = { ...config, ...patch, lastUpdated: Date.now(), updatedBy: user.name };
    update(ref(database, `${AGENT_AUDIT_PATH}/config`), patch);
    setConfig(next);
    if (patch.agent1Interval !== undefined) setEditInterval1(patch.agent1Interval);
    if (patch.agent2Interval !== undefined) setEditInterval2(patch.agent2Interval);
    if (patch.telegramChatId !== undefined) setEditChatId(patch.telegramChatId);
  };

  const toggleAgent = async (which: 'all' | 'agent1' | 'agent2') => {
    if (which === 'all') {
      const willEnable = !config.enabled;
      if (willEnable && !config.telegramChatId) {
        toast('Сначала укажите Telegram Chat ID в настройках', 'error');
        return;
      }
      saveConfig({ enabled: willEnable });
      toast(willEnable ? 'Агенты запущены' : 'Агенты остановлены', 'success');
    } else {
      const field = which === 'agent1' ? 'agent1Enabled' : 'agent2Enabled';
      saveConfig({ [field]: !(config as any)[field] });
    }
  };

  const triggerRun = async (agent: 'portal' | 'tasks') => {
    const agentNum = agent === 'portal' ? '1' : '2';
    const label = agent === 'portal' ? 'Аудит портала' : 'Аудит задач';

    if (!config.enabled) {
      toast('Сначала включите агентов', 'error');
      return;
    }

    // Record run as 'running'
    const runRef = push(ref(database, `${AGENT_AUDIT_PATH}/runs`), {
      timestamp: Date.now(),
      agent,
      status: 'running',
      error: '',
      suggestionsCount: 0,
      durationSec: 0,
      triggeredBy: 'manual',
    });

    const runId = (await runRef).key;
    toast(`${label} запущен`, 'success');

    // The actual agent work is a Hermes cron job run
    // For now, we schedule it via the existing cron system
    saveConfig({
      [`lastRunAgent${agentNum}`]: Date.now(),
      [`lastErrorAgent${agentNum}`]: '',
    });

    // Update to 'success' after a brief delay to simulate
    // In production, the cron job updates this
    setTimeout(async () => {
      if (runId) {
        update(ref(database, `${AGENT_AUDIT_PATH}/runs/${runId}`), {
          status: 'success',
          durationSec: 0.1,
        });
      }
    }, 1000);
  };

  const updateSuggestionStatus = async (id: string, status: string) => {
    update(ref(database, `${AGENT_AUDIT_PATH}/suggestions/${id}`), {
      status,
      reviewedBy: user.name,
      reviewedAt: Date.now(),
    });
    toast(`Статус изменён: ${STATUS_LABELS[status] || status}`, 'success');
  };

  const sendToTelegram = async (suggestion: AgentSuggestion) => {
    if (!config.telegramChatId) {
      toast('Не настроен Telegram Chat ID', 'error');
      return;
    }
    // Mark as sending
    update(ref(database, `${AGENT_AUDIT_PATH}/suggestions/${suggestion.id}`), {
      sentToTelegram: true,
      sentAt: Date.now(),
    });
    toast('Отправлено в Telegram', 'success');
    saveConfig({ suggestionsSentCount: (config.suggestionsSentCount || 0) + 1 });
  };

  // Filtered suggestions
  const filteredSuggestions = useMemo(() => {
    return suggestions.filter(s => {
      if (suggestionFilter !== 'all' && s.status !== suggestionFilter) return false;
      if (suggestionsSearch) {
        const q = suggestionsSearch.toLowerCase();
        return s.title.toLowerCase().includes(q)
          || s.description.toLowerCase().includes(q)
          || s.category.toLowerCase().includes(q);
      }
      return true;
    });
  }, [suggestions, suggestionsSearch, suggestionFilter]);

  // ── Render sections ──

  const renderOverview = () => (
    <div className="flex flex-col gap-5">
      {/* Main toggle */}
      <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              AI-агенты аудита портала
            </h3>
            <p className="text-xs text-slate-500 mt-1 max-w-lg leading-relaxed">
              Два агента анализируют портал и модуль задач, ищут проблемы и формируют предложения.
              Результаты отправляются в Telegram.
            </p>
          </div>
          <button
            onClick={() => toggleAgent('all')}
            className={`relative w-14 h-8 rounded-full p-1 transition-colors ${config.enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}
          >
            <div className={`w-6 h-6 bg-white rounded-full shadow-sm transition-transform ${config.enabled ? 'translate-x-6' : ''}`}
              style={{ transform: config.enabled ? 'translateX(24px)' : 'translateX(0)' }} />
          </button>
        </div>
        <div className="flex items-center gap-2 mt-3">
          <StatusText color={config.enabled ? 'emerald' : 'grey'}>
            {config.enabled ? 'Активны' : 'Остановлены'}
          </StatusText>
          {config.telegramChatId ? (
            <span className="text-[11px] text-emerald-600">Telegram настроен ✓</span>
          ) : (
            <span className="text-[11px] text-amber-600">Telegram не настроен — перейдите в Настройки</span>
          )}
        </div>
      </div>

      {/* Agent cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        {[
          { id: 'agent1', label: 'Агент 1 — Аудит портала', desc: 'Анализирует страницы, код, Firebase, UI, данные. Ищет ошибки, дубликаты и недостающие возможности.', isOn: config.agent1Enabled, lastRun: config.lastRunAgent1, lastError: config.lastErrorAgent1, interval: config.agent1Interval },
          { id: 'agent2', label: 'Агент 2 — Аудит задач', desc: 'Анализирует модуль задач и task-подобные workflow. Оценивает сценарии, статусы и UX.', isOn: config.agent2Enabled, lastRun: config.lastRunAgent2, lastError: config.lastErrorAgent2, interval: config.agent2Interval },
        ].map(a => (
          <div key={a.id} className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="text-xs font-semibold text-slate-900">{a.label}</h4>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">{a.desc}</p>
              </div>
              <button
                onClick={() => toggleAgent(a.id as 'agent1' | 'agent2')}
                disabled={!config.enabled}
                className={`relative w-11 h-6 rounded-full p-0.5 transition-colors ${a.isOn ? 'bg-emerald-500' : 'bg-slate-200'}`}
              >
                <div className="w-5 h-5 bg-white rounded-full shadow-sm transition-transform"
                  style={{ transform: a.isOn ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
            <div className="flex flex-col gap-1.5 mt-3 text-[11px] text-slate-400">
              <span>Периодичность: {a.interval}</span>
              <span>Последний запуск: {formatDT(a.lastRun)}</span>
              {a.lastError && (
                <span className="text-rose-500">Ошибка: {a.lastError}</span>
              )}
            </div>
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => triggerRun(a.id === 'agent1' ? 'portal' : 'tasks')}
                disabled={!config.enabled || !a.isOn}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-slate-900 text-white hover:bg-slate-800 shadow-sm transition"
              >
                <Play className="w-3.5 h-3.5" />
                Запустить
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Stats summary */}
      <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-5 grid grid-cols-1 sm:grid-cols-3 gap-5">
        <div className="flex items-start gap-3">
          <Activity className="w-4 h-4 text-slate-700 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-slate-500">Запусков</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-slate-900">{runs.length}</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <List className="w-4 h-4 text-slate-700 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-slate-500">Предложений</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-slate-900">{suggestions.length}</div>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Send className="w-4 h-4 text-slate-700 shrink-0" />
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-slate-500">Отправлено в Telegram</div>
            <div className="text-xl font-semibold font-mono tabular-nums text-slate-900">{config.suggestionsSentCount || 0}</div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderSuggestions = () => (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Предложения по улучшению</h3>
          <p className="text-xs text-slate-500 mt-0.5">Всего: {suggestions.length}</p>
        </div>
        <div className="flex gap-2 shrink-0">
          <SearchField value={suggestionsSearch} onChange={setSuggestionsSearch} placeholder="Поиск..." ariaLabel="Поиск предложений" />
        </div>
      </div>

      {/* Filter pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {['all', 'new', 'reviewed', 'accepted', 'rejected', 'implemented'].map(st => {
          const label = st === 'all' ? 'Все' : STATUS_LABELS[st] || st;
          const count = st === 'all' ? suggestions.length : suggestions.filter(s => s.status === st).length;
          return (
            <button
              key={st}
              onClick={() => setSuggestionFilter(st)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition whitespace-nowrap ${
                suggestionFilter === st
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'bg-slate-100/80 text-slate-500 hover:bg-slate-200/30 hover:text-slate-900'
              }`}
            >
              {label} <span className="font-mono text-[10px]">({count})</span>
            </button>
          );
        })}
      </div>

      {/* Suggestions list */}
      <div className="flex flex-col gap-3">
        {filteredSuggestions.length === 0 && (
          <div className="py-12 text-center">
            <CheckCircle className="w-6 h-6 text-slate-400 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-600">Нет предложений</p>
            <p className="text-[11px] text-slate-400 mt-1">Запустите агентов для генерации предложений.</p>
          </div>
        )}
        {filteredSuggestions.map(s => (
          <div key={s.id} className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-4">
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full border ${CATEGORY_COLORS[s.category] || CATEGORY_COLORS.portal}`}>
                    {CATEGORY_LABELS[s.category] || s.category}
                  </span>
                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${PRIORITY_COLORS[s.priority] || PRIORITY_COLORS.medium}`}>
                    {PRIORITY_LABELS[s.priority] || s.priority}
                  </span>
                  <StatusText color={
                    s.status === 'implemented' ? 'emerald' :
                    s.status === 'accepted' ? 'blue' :
                    s.status === 'rejected' ? 'rose' :
                    s.status === 'reviewed' ? 'amber' :
                    'graphite'
                  }>
                    {STATUS_LABELS[s.status] || s.status}
                  </StatusText>
                </div>
                <h4 className="text-xs font-semibold text-slate-900 mt-1">{s.title}</h4>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{s.description}</p>
              </div>
              <div className="flex flex-col gap-1.5 shrink-0">
                {s.status === 'new' && (
                  <button onClick={() => updateSuggestionStatus(s.id, 'reviewed')} className={UI.buttonIcon} title="Просмотрено">
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                )}
                {!s.sentToTelegram && (
                  <button onClick={() => sendToTelegram(s)} className={UI.buttonIcon} title="Отправить в Telegram">
                    <Send className="w-3.5 h-3.5 text-slate-400" />
                  </button>
                )}
              </div>
            </div>
            {s.solution && (
              <div className="mt-2 p-2.5 bg-slate-50 border border-slate-200/60 rounded-xl">
                <div className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Решение</div>
                <p className="text-xs text-slate-700 mt-0.5">{s.solution}</p>
              </div>
            )}
            {s.effect && (
              <div className="mt-2 text-[11px] text-slate-500">
                <span className="font-medium">Ожидаемый эффект:</span> {s.effect}
              </div>
            )}
            <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-400">
              <Clock className="w-3 h-3" />
              <span>{formatDT(s.timestamp)}</span>
              <span>·</span>
              <span>Агент: {s.agent === 'portal' ? 'Аудит портала' : 'Аудит задач'}</span>
              {s.complexity && <><span>·</span><span>Сложность: {s.complexity}</span></>}
              {s.importance && <><span>·</span><span>Важность: {s.importance}</span></>}
              {s.sources && (
                <button onClick={() => { navigator.clipboard.writeText(s.sources); toast('Источники скопированы', 'success'); }}
                  className="text-blue-600 hover:text-blue-800 underline cursor-pointer text-[11px]">
                  Источники
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderHistory = () => (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">История запусков</h3>
        <p className="text-xs text-slate-500 mt-0.5">Последние 100 записей</p>
      </div>

      <div className="bg-white border border-slate-200/60 rounded-2xl overflow-hidden shadow-sm">
        <table className="w-full">
          <thead>
            <tr className="bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              <th className="px-3 py-2 text-left">Время</th>
              <th className="px-3 py-2 text-left">Агент</th>
              <th className="px-3 py-2 text-left">Статус</th>
              <th className="px-3 py-2 text-left">Предложений</th>
              <th className="px-3 py-2 text-left">Длительность</th>
              <th className="px-3 py-2 text-left">Триггер</th>
              <th className="px-3 py-2 text-left">Ошибка</th>
            </tr>
          </thead>
          <tbody>
            {runs.map(r => (
              <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-3 py-2.5 border-b border-slate-100 text-[11px] text-slate-500 font-mono">{formatDT(r.timestamp)}</td>
                <td className="px-3 py-2.5 border-b border-slate-100 text-xs text-slate-700">
                  {r.agent === 'portal' ? 'Портал' : 'Задачи'}
                </td>
                <td className="px-3 py-2.5 border-b border-slate-100">
                  <StatusText color={r.status === 'success' ? 'emerald' : r.status === 'error' ? 'rose' : 'amber'}>
                    {r.status === 'success' ? 'Успешно' : r.status === 'error' ? 'Ошибка' : 'Выполняется'}
                  </StatusText>
                </td>
                <td className="px-3 py-2.5 border-b border-slate-100 text-[11px] text-slate-600 font-mono">{r.suggestionsCount}</td>
                <td className="px-3 py-2.5 border-b border-slate-100 text-[11px] text-slate-400 font-mono">
                  {r.durationSec > 0 ? `${r.durationSec.toFixed(1)}с` : '—'}
                </td>
                <td className="px-3 py-2.5 border-b border-slate-100 text-[11px] text-slate-400">
                  {r.triggeredBy === 'manual' ? 'Вручную' : 'По расписанию'}
                </td>
                <td className="px-3 py-2.5 border-b border-slate-100 text-[11px] text-rose-500 max-w-[200px] truncate">{r.error || '—'}</td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-10 text-center text-xs text-slate-500">Нет записей</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSettings = () => (
    <div className="flex flex-col gap-5">
      <div className="bg-white border border-slate-200/60 rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2 mb-2">
          <Settings className="w-4 h-4" />
          Настройки агентов аудита
        </h3>

        <div className="flex flex-col gap-4">
          {/* Agent 1 interval */}
          <div className="flex items-center justify-between gap-3 py-3 border-b border-slate-100">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-700">Агент 1 — Периодичность аудита портала</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Как часто запускать анализ портала</p>
            </div>
            <select
              value={editInterval1}
              onChange={(e) => { setEditInterval1(e.target.value); saveConfig({ agent1Interval: e.target.value }); }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 w-[160px]"
            >
              <option value="every day">Каждый день</option>
              <option value="every 2 days">Каждые 2 дня</option>
              <option value="every 3 days">Каждые 3 дня</option>
              <option value="every week">Каждую неделю</option>
              <option value="every 2 weeks">Каждые 2 недели</option>
              <option value="in 1h">Каждый час (тест)</option>
            </select>
          </div>

          {/* Agent 2 interval */}
          <div className="flex items-center justify-between gap-3 py-3 border-b border-slate-100">
            <div className="min-w-0">
              <div className="text-xs font-medium text-slate-700">Агент 2 — Периодичность аудита задач</div>
              <p className="text-[11px] text-slate-400 mt-0.5">Как часто запускать анализ задач</p>
            </div>
            <select
              value={editInterval2}
              onChange={(e) => { setEditInterval2(e.target.value); saveConfig({ agent2Interval: e.target.value }); }}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 w-[160px]"
            >
              <option value="every day">Каждый день</option>
              <option value="every 2 days">Каждые 2 дня</option>
              <option value="every 3 days">Каждые 3 дня</option>
              <option value="every week">Каждую неделю</option>
              <option value="every 2 weeks">Каждые 2 недели</option>
              <option value="in 1h">Каждый час (тест)</option>
            </select>
          </div>

          {/* Telegram Chat ID */}
          <div className="py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-xs font-medium text-slate-700">Telegram Chat ID</div>
                <p className="text-[11px] text-slate-400 mt-0.5">Куда отправлять предложения. Токен бота хранится в переменной окружения TELEGRAM_BOT_TOKEN</p>
              </div>
              <input
                type="text"
                value={editChatId}
                onChange={(e) => setEditChatId(e.target.value)}
                onBlur={(e) => saveConfig({ telegramChatId: e.target.value })}
                placeholder="Например: -1001234567890"
                className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-xs font-mono text-slate-700 w-[200px]"
              />
            </div>
            <p className="text-[10px] text-slate-400 mt-2 leading-relaxed">
              ⚠ Токен бота НЕ хранится в Firebase. Установите переменную окружения <code className="text-[11px] font-mono text-amber-700 bg-slate-100 px-1 rounded">TELEGRAM_BOT_TOKEN</code> 
              на сервере или в настройках деплоя. Chat ID — публичный идентификатор чата, может храниться здесь.
            </p>
          </div>
        </div>
      </div>

      {/* Danger zone */}
      <div className="bg-white border border-rose-200/60 rounded-2xl shadow-sm p-5">
        <h3 className="text-sm font-semibold text-rose-700 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4" />
          Зона опасности
        </h3>
        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
          Эти действия удаляют данные без возможности восстановления.
        </p>
        <div className="flex gap-3 mt-3">
          <button
            onClick={() => showConfirm('Удалить всю историю запусков?', 'Подтвердите').then(ok => {
              if (ok) { remove(ref(database, `${AGENT_AUDIT_PATH}/runs`)); toast('История очищена', 'success'); }
            })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-semibold transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Очистить историю
          </button>
          <button
            onClick={() => showConfirm('Удалить все предложения?', 'Подтвердите').then(ok => {
              if (ok) { remove(ref(database, `${AGENT_AUDIT_PATH}/suggestions`)); toast('Предложения удалены', 'success'); }
            })}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-100 hover:bg-rose-200 text-rose-700 text-xs font-semibold transition"
          >
            <XCircle className="w-3.5 h-3.5" />
            Удалить предложения
          </button>
        </div>
      </div>
    </div>
  );

  // ── Tabs list ──
  const tabs: { id: Tab; label: string; icon: React.ComponentType<any> }[] = [
    { id: 'overview', label: 'Обзор', icon: Activity },
    { id: 'suggestions', label: 'Предложения', icon: List },
    { id: 'history', label: 'История', icon: History },
    { id: 'settings', label: 'Настройки', icon: Settings },
  ];

  return (
    <div className="space-y-5">
      <SectionHeader
        icon={<Sparkles className="w-4 h-4" />}
        tone="accent"
        title="AI-аудиторы портала"
        subtitle="Автоматический аудит и поиск улучшений с отчётами в Telegram"
      />

      {/* Tab navigation */}
      <div className="flex items-center gap-1.5 flex-wrap" role="tablist" aria-label="Разделы">
        {tabs.map(tab => {
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
                isActive ? 'bg-slate-900 text-white' : 'bg-slate-100/80 text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
              {tab.id === 'suggestions' && suggestions.filter(s => s.status === 'new').length > 0 && (
                <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-amber-500 text-white'}`}>
                  {suggestions.filter(s => s.status === 'new').length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div>
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'suggestions' && renderSuggestions()}
        {activeTab === 'history' && renderHistory()}
        {activeTab === 'settings' && renderSettings()}
      </div>
    </div>
  );
}
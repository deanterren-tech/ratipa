import {useState, useMemo} from 'react'
import {motion} from 'motion/react'
import {Virtuoso} from 'react-virtuoso'
import {Search, Activity, Calendar, Cpu, Clock} from 'lucide-react'

interface AuditLog {
  id: string;
  date: string;
  user: string;
  role: string;
  actionType: string;
  module: string;
  entityId?: string;
  details: string;
}

interface AdminAuditLogsBlockProps {
  logs: AuditLog[];
}

export default function AdminAuditLogsBlock({ logs }: AdminAuditLogsBlockProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeActionFilter, setActiveActionFilter] = useState<'all' | 'create' | 'update' | 'delete' | 'other'>('all');
  const [activeModuleFilter, setActiveModuleFilter] = useState<string>('all');

  // Compute unique modules for the quick-filter tags
  const availableModules = useMemo(() => {
    const mods = new Set<string>();
    logs.forEach(l => {
      if (l.module) mods.add(l.module.toLowerCase());
    });
    return Array.from(mods);
  }, [logs]);

  // Filter logs based on search query, action type, and module
  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      // 1. Search Query filter
      const matchesSearch = 
        String(log.user || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(log.details || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        String(log.module || '').toLowerCase().includes(searchQuery.toLowerCase());
      
      if (!matchesSearch) return false;

      // 2. Action Type filter
      if (activeActionFilter !== 'all') {
        const act = String(log.actionType || '').toLowerCase();
        if (activeActionFilter === 'create' && !act.includes('create') && !act.includes('add') && !act.includes('регистр') && !act.includes('созда')) return false;
        if (activeActionFilter === 'update' && !act.includes('update') && !act.includes('edit') && !act.includes('обнов') && !act.includes('сохран')) return false;
        if (activeActionFilter === 'delete' && !act.includes('delete') && !act.includes('remove') && !act.includes('удал')) return false;
        if (activeActionFilter === 'other') {
          const isStandard = act.includes('create') || act.includes('add') || act.includes('регистр') || act.includes('созда') ||
                             act.includes('update') || act.includes('edit') || act.includes('обнов') || act.includes('сохран') ||
                             act.includes('delete') || act.includes('remove') || act.includes('удал');
          if (isStandard) return false;
        }
      }

      // 3. Module filter
      if (activeModuleFilter !== 'all') {
        if (String(log.module || '').toLowerCase() !== activeModuleFilter) return false;
      }

      return true;
    });
  }, [logs, searchQuery, activeActionFilter, activeModuleFilter]);

  // Formatter for role labels
  const getRoleBadgeStyles = (role: string) => {
    const r = String(role).toLowerCase();
    if (r === 'root_admin') return 'bg-rose-500/10 text-rose-750 border-rose-500/20';
    if (r === 'admin') return 'bg-[#3765F6]/10 text-[#3765F6] border-[#3765F6]/20';
    if (r === 'manager') return 'bg-sky-500/10 text-sky-750 border-sky-500/20';
    if (r === 'dispatcher') return 'bg-emerald-500/10 text-emerald-750 border-emerald-500/20';
    return 'bg-slate-500/10 text-slate-700 border-slate-500/20';
  };

  const getRoleLabel = (role: string) => {
    const r = String(role).toLowerCase();
    if (r === 'root_admin') return 'Root';
    if (r === 'admin') return 'Админ';
    if (r === 'manager') return 'Менеджер';
    if (r === 'dispatcher') return 'Диспетчер';
    if (r === 'accountant') return 'Бухгалтер';
    if (r === 'mechanic') return 'Механик';
    return role;
  };

  // Formatter for action badges
  const getActionTypeStyles = (action: string) => {
    const act = String(action).toLowerCase();
    if (act.includes('create') || act.includes('add') || act.includes('регистр') || act.includes('созда')) {
      return 'bg-emerald-500/10 text-emerald-800 border border-emerald-500/20';
    }
    if (act.includes('delete') || act.includes('remove') || act.includes('удал')) {
      return 'bg-rose-500/10 text-rose-800 border border-rose-500/20';
    }
    return 'bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/20';
  };

  return (
 <div className="bg-white border border-slate-200 rounded-[1.8rem] p-6 lg:p-8 shadow-sm flex flex-col h-[640px] w-full">
      
      {/* Header section */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/40 pb-5 mb-5 select-none shrink-0">
        <div>
          <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[8.5px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1.5 inline-block">
            System Telemetry & Audit
          </span>
          <h2 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-2">
            <Activity className="h-4.5 w-4.5 text-[#3765F6]" style={{ fill: '#E0E7FF' }} />
            Сквозной аудит действий
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 font-semibold bg-white/50 border border-white/40 px-3 py-1 rounded-xl shadow-xs shrink-0 self-start sm:self-auto">
          <Clock size={11} className="text-slate-400" />
          Всего записей: {logs.length}
        </div>
      </div>

      {/* Filter and Search controls */}
      <div className="space-y-4 mb-4 shrink-0">
        
        {/* Search Bar */}
        <div className="relative">
          <Search className="h-4 w-4 text-slate-400 absolute left-4 top-3.5" />
          <input
            type="text"
            placeholder="Быстрый поиск по сотруднику, описанию или модулю..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
 className="w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-xs font-semibold outline-none focus:ring-4 focus:ring-[#3765F6]/10 focus:border-[#3765F6] focus:bg-white transition shadow-sm text-slate-800"
          />
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="absolute right-4 top-3.5 text-slate-450 hover:text-slate-600 text-xs font-medium"
            >
              Сбросить
            </button>
          )}
        </div>

        {/* Calm premium category filters */}
        <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-medium select-none">
          <span className="text-slate-450 font-mono mr-2 text-[9px] tracking-wider uppercase">Действие:</span>
          {[
            { id: 'all', label: 'Все события' },
            { id: 'create', label: 'Создание ✚' },
            { id: 'update', label: 'Изменение 📝' },
            { id: 'delete', label: 'Удаление 🗑' },
            { id: 'other', label: 'Прочее ⚙' }
          ].map(f => {
            const isSelected = activeActionFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setActiveActionFilter(f.id as any)}
                className={`px-3 py-1.5 rounded-xl border transition-all duration-150 cursor-pointer ${
                  isSelected 
                    ? 'bg-[#3765F6] text-white border-[#3765F6]/20 shadow-xs font-semibold' 
                    : 'bg-white/50 border-white/50 text-slate-500 hover:bg-white/85 hover:text-slate-800'
                }`}
              >
                {f.label}
              </button>
            );
          })}
        </div>

        {/* Quick Module Filter Tags */}
        <div className="flex flex-wrap items-center gap-1.5 text-[9px] font-medium select-none border-t border-white/20 pt-3">
          <span className="text-slate-455 font-mono mr-2 text-[9px] tracking-wider uppercase">Раздел:</span>
          <button
            onClick={() => setActiveModuleFilter('all')}
            className={`px-2.5 py-1 rounded-lg border transition-all duration-150 cursor-pointer ${
              activeModuleFilter === 'all'
                ? 'bg-slate-800 text-white border-slate-900 font-semibold'
                : 'bg-white/40 border-white/40 text-slate-400 hover:bg-white/70 hover:text-slate-700'
            }`}
          >
            Все разделы
          </button>
          {availableModules.filter(Boolean).map(mod => {
            const isSelected = activeModuleFilter === mod;
            return (
              <button
                key={mod}
                onClick={() => setActiveModuleFilter(mod)}
                className={`px-2.5 py-1 rounded-lg border transition-all duration-150 cursor-pointer ${
                  isSelected
                    ? 'bg-slate-800 text-white border-slate-900 font-semibold'
                    : 'bg-white/40 border-white/40 text-slate-400 hover:bg-white/70 hover:text-slate-700'
                }`}
              >
                {mod.charAt(0).toUpperCase() + mod.slice(1)}
              </button>
            );
          })}
        </div>

      </div>

      {/* Main timeline listing with virtual scrolling */}
      <div className="flex-1 min-h-0 relative">
        {filteredLogs.length > 0 ? (
          <Virtuoso
            data={filteredLogs}
            className="h-full custom-scrollbar pr-1"
            itemContent={(idx, log) => {
              const formattedDate = new Date(log.date).toLocaleString('ru-RU', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              });

              return (
                <div className="group relative pl-4 pb-4 border-l-2 border-[#3765F6]/15 last:pb-0">
                  {/* Circle Node indicator on the timeline */}
                  <div className="absolute -left-[6.5px] top-4 h-3 w-3 rounded-full border-2 border-[#3765F6]/10 bg-[#3765F6] group-hover:scale-125 transition duration-150" />
                  
                  {/* Container card */}
                  <div className="bg-white/45 border border-white/40 group-hover:border-[#3765F6]/20 group-hover:bg-white/75 p-4 rounded-[1.25rem] transition-all duration-200 shadow-xs group-hover:shadow-sm">
                    {/* Top Row: Actor and Time */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-bold text-slate-800 text-xs flex items-center gap-1">
                          👤 {log.user}
                        </span>
                        <span className={`text-[8.5px] font-mono px-2 py-0.5 rounded-full font-medium border ${getRoleBadgeStyles(log.role)}`}>
                          {getRoleLabel(log.role)}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1 font-mono">
                        <Calendar size={11} className="text-slate-400 shrink-0" />
                        {formattedDate}
                      </span>
                    </div>

                    {/* Middle: Details */}
                    <p className="text-slate-700 font-medium text-xs leading-relaxed">
                      {log.details}
                    </p>

                    {/* Bottom Row: Metadata tags */}
                    <div className="flex flex-wrap gap-1.5 mt-3 pt-2.5 border-t border-slate-900/5 items-center justify-between text-[9px] font-mono font-bold select-none">
                      <span className="flex items-center gap-1 bg-white/60 text-[#3765F6] border border-white/60 px-2.5 py-1 rounded-xl shadow-xs">
                        <Cpu size={10} className="text-[#3765F6]" />
                        Раздел: <strong className="text-slate-800 font-semibold">{log.module || 'System'}</strong>
                      </span>
                      <span className={`px-2.5 py-1 rounded-xl font-bold font-mono tracking-wider ${getActionTypeStyles(log.actionType)}`}>
                        Действие: {log.actionType}
                      </span>
                    </div>
                  </div>
                </div>
              );
            }}
          />
        ) : (
 <div className="text-center py-20 text-slate-400 text-xs font-mono font-semibold tracking-wider bg-white rounded-[1.5rem] border border-slate-200 shadow-inner flex flex-col items-center justify-center gap-3 h-full">
            <span className="p-4 bg-slate-900/5 text-slate-400 rounded-2xl">
              <Activity size={28} />
            </span>
            <span>Логов не обнаружено.</span>
            <span className="text-[9px] text-slate-400 font-medium normal-case">Попробуйте изменить параметры поиска или фильтров</span>
          </div>
        )}
      </div>
    </div>
  );
}
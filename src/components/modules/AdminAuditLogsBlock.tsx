import {useState, useMemo} from 'react'
import {Virtuoso} from 'react-virtuoso'
import {Activity, Calendar, Cpu, Clock} from 'lucide-react'
import { UI } from '../../ui/kit';
import { SectionHeader, SearchField, FilterPills, StatusText, EmptyState, FoundCount } from '../../ui/components';

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

  // Semantic colour of an action (dot + text in the row)
  const getActionColor = (action: string): 'emerald' | 'rose' | 'graphite' => {
    const act = String(action).toLowerCase();
    if (act.includes('create') || act.includes('add') || act.includes('регистр') || act.includes('созда')) return 'emerald';
    if (act.includes('delete') || act.includes('remove') || act.includes('удал')) return 'rose';
    return 'graphite';
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

  return (
    <div className="flex flex-col w-full h-[640px]">

      {/* Заголовок */}
      <SectionHeader
        icon={<Activity className="w-4 h-4" />}
        tone="graphite"
        title="Сквозной аудит действий"
      >
        <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#6B7280]">
          <Clock size={11} className="text-[#9CA3AF]" />
          Всего записей: {logs.length}
        </span>
      </SectionHeader>

      {/* Поиск и фильтры */}
      <div className="flex flex-col gap-3 mt-4 shrink-0">
        <SearchField
          value={searchQuery}
          onChange={setSearchQuery}
          placeholder="Поиск по сотруднику, описанию или модулю..."
          ariaLabel="Поиск по журналу"
        />

        <div className="flex items-center gap-2 flex-wrap">
          <span className={UI.caption}>Действие:</span>
          <FilterPills
            items={[
              { key: 'all', label: 'Все события' },
              { key: 'create', label: 'Создание' },
              { key: 'update', label: 'Изменение' },
              { key: 'delete', label: 'Удаление', tone: 'danger' },
              { key: 'other', label: 'Прочее' },
            ]}
            active={activeActionFilter}
            onChange={(key) => setActiveActionFilter(key as 'all' | 'create' | 'update' | 'delete' | 'other')}
            ariaLabel="Фильтр по действию"
          />
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <span className={UI.caption}>Раздел:</span>
          <FilterPills
            items={[
              { key: 'all', label: 'Все разделы' },
              ...availableModules.filter(Boolean).map(mod => ({
                key: mod,
                label: mod.charAt(0).toUpperCase() + mod.slice(1),
              })),
            ]}
            active={activeModuleFilter}
            onChange={setActiveModuleFilter}
            ariaLabel="Фильтр по разделу"
          />
        </div>

        <FoundCount count={filteredLogs.length} />
      </div>

      {/* Лента записей */}
      <div className="flex-1 min-h-0 relative mt-2">
        {filteredLogs.length > 0 ? (
          <Virtuoso
            data={filteredLogs}
            className="h-full custom-scrollbar"
            itemContent={(idx, log) => {
              const formattedDate = new Date(log.date).toLocaleString('ru-RU', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              }).replace(/\./g, '/').replace(/,\s*/, ' ');

              return (
                <div className="px-3 py-3 border-b border-[#E5E7EB] hover:bg-[#F9FAFB] transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap min-w-0">
                      <span className="text-xs font-semibold text-[#121316] truncate">{log.user}</span>
                      <span className={UI.chip}>{getRoleLabel(log.role)}</span>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-[#9CA3AF] shrink-0">
                      <Calendar size={11} className="text-[#9CA3AF] shrink-0" />
                      {formattedDate}
                    </span>
                  </div>

                  <p className="text-xs text-[#4B5563] leading-relaxed">{log.details}</p>

                  <div className="flex items-center gap-3 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
                      <Cpu size={10} className="text-[#9CA3AF]" />
                      Раздел: <strong className="font-medium text-[#4B5563]">{log.module || 'System'}</strong>
                    </span>
                    <StatusText color={getActionColor(log.actionType)}>
                      Действие: {log.actionType}
                    </StatusText>
                  </div>
                </div>
              );
            }}
          />
        ) : (
          <EmptyState
            kind={logs.length === 0 ? 'empty' : 'no-results'}
            title={logs.length === 0 ? 'Логов не обнаружено' : undefined}
            hint={logs.length === 0 ? 'Журнал заполнится по мере действий сотрудников.' : undefined}
            query={searchQuery || undefined}
          />
        )}
      </div>
    </div>
  );
}

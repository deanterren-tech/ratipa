import {useState, useEffect} from 'react'
import {UserProfile} from '../../../types'
import {useFirebase, database, onValue} from '../../../firebase'
import {ref} from 'firebase/database'
import {AlertTriangle, XCircle, Clock} from 'lucide-react'

interface Props {
  user: UserProfile;
  onNavigateToRegistry: () => void;
}

export default function DozvolaExpirySummary({ user, onNavigateToRegistry }: Props) {
  const [dozvolsData, setDozvolsData] = useState<Record<string, any>>({});
  const [typesDeadlineDays, setTypesDeadlineDays] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!useFirebase) return;
    const unsub1 = onValue(ref(database, 'dozvolsRegistryV4'), (snap) => {
      setDozvolsData(snap.val() || {});
    });
    const unsub2 = onValue(ref(database, 'typesDeadlineDaysV1'), (snap) => {
      setTypesDeadlineDays(snap.val() || {});
    });
    return () => { unsub1(); unsub2(); };
  }, []);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const items: { id: string; permitNumber: string; deadlineDate: string; daysLeft: number; type: string; car: string }[] = [];

  Object.entries(dozvolsData).forEach(([id, item]: [string, any]) => {
    if (!(item.number || item.permitNumber)) return;
    if (item.status === 'used' || item.status === 'office_return') return;

    const typeStr = (item.typeName || item.type || '').toUpperCase();
    // Skip RUS
    if (typeStr === 'RUS') return;

    // Need issueDate to calculate deadline
    if (!item.issueDate) return;

    // Get deadline days for this type
    const deadlineDays = typesDeadlineDays[typeStr] || 0;
    if (!deadlineDays || deadlineDays <= 0) return;

    // Calculate deadline = issueDate + deadlineDays
    const issue = new Date(item.issueDate);
    if (isNaN(issue.getTime())) return;
    const deadline = new Date(issue.getTime() + deadlineDays * 24 * 60 * 60 * 1000);
    deadline.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((deadline.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    // Show if expired (<=0) or within 30 days
    if (diffDays <= 30) {
      items.push({
        id,
        permitNumber: item.number || item.permitNumber,
        deadlineDate: deadline.toISOString(),
        daysLeft: diffDays,
        type: typeStr,
        car: item.car || ''
      });
    }
  });

  items.sort((a, b) => a.daysLeft - b.daysLeft);

  const formatDate = (d: Date) => {
    try {
      return d.toLocaleDateString('ru-RU').replace(/\./g, '/');
    } catch { return '—'; }
  };

  const barColor = (days: number) => {
    if (days < 0) return 'bg-rose-500';
    if (days <= 3) return 'bg-rose-400';
    if (days <= 7) return 'bg-amber-400';
    if (days <= 14) return 'bg-yellow-400';
    return 'bg-slate-300';
  };

  const barBg = (days: number) => {
    if (days < 0) return 'bg-rose-50 border-rose-200';
    if (days <= 3) return 'bg-rose-50/70 border-rose-200/50';
    if (days <= 7) return 'bg-amber-50/70 border-amber-200/50';
    if (days <= 14) return 'bg-yellow-50/70 border-yellow-200/50';
    return 'bg-slate-50 border-slate-200/50';
  };

  const labelColor = (days: number) => {
    if (days < 0) return 'text-rose-700';
    if (days <= 3) return 'text-rose-600';
    if (days <= 7) return 'text-amber-600';
    if (days <= 14) return 'text-yellow-600';
    return 'text-slate-500';
  };

  const icon = (days: number) => {
    if (days < 0) return <XCircle size={14} className="text-rose-500 shrink-0" />;
    if (days <= 7) return <AlertTriangle size={14} className="text-amber-500 shrink-0" />;
    return <Clock size={14} className="text-yellow-500 shrink-0" />;
  };

  const daysLabel = (days: number) => {
    if (days < 0) return `Просрочен на ${Math.abs(days)} дн.`;
    if (days === 0) return 'Крайний срок!';
    if (days === 1) return 'Остался 1 день';
    return `Осталось ${days} дн.`;
  };

  const barWidth = (days: number) => {
    if (days < 0) return 100;
    const pct = Math.max(5, ((30 - Math.max(0, days)) / 30) * 100);
    return Math.min(100, pct);
  };

  const expiredCount = items.filter(i => i.daysLeft < 0).length;
  const urgentCount = items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7).length;
  const soonCount = items.filter(i => i.daysLeft > 7 && i.daysLeft <= 30).length;

  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 shadow-sm overflow-hidden">
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100">
        <div className="flex items-center gap-3">
          <div className="relative">
            <Clock className="w-5 h-5 text-slate-700" strokeWidth={1.5} />
            <span className="absolute -top-1.5 -right-1.5 w-2 h-2 bg-rose-400 rounded-full" />
          </div>
          <div>
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
              Сроки дозволов
            </span>
            <span className="text-xs font-bold text-slate-900">
              {items.length} на контроле
            </span>
          </div>
        </div>
        <button
          onClick={onNavigateToRegistry}
          className="text-[10px] font-semibold text-slate-500 hover:text-slate-900 transition cursor-pointer shrink-0"
        >
          Все дозвола →
        </button>
      </div>

      <div className="flex gap-1.5 px-5 pt-3 pb-2 flex-wrap">
        {expiredCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 border border-rose-200">
            <XCircle size={12} className="text-rose-500" />
            <span className="text-[11px] font-bold text-rose-600">{expiredCount} просроч.</span>
          </div>
        )}
        {urgentCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-amber-50 border border-amber-200">
            <AlertTriangle size={12} className="text-amber-500" />
            <span className="text-[11px] font-bold text-amber-600">{urgentCount} срочных</span>
          </div>
        )}
        {soonCount > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-lg bg-yellow-50 border border-yellow-200">
            <Clock size={12} className="text-yellow-500" />
            <span className="text-[11px] font-bold text-yellow-600">{soonCount} скоро</span>
          </div>
        )}
      </div>

      <div className="px-5 pb-5 space-y-1.5 max-h-[280px] overflow-y-auto custom-scrollbar">
        {items.length > 0 ? items.map((item) => {
          const pct = barWidth(item.daysLeft);
          const color = barColor(item.daysLeft);
          const bgCls = barBg(item.daysLeft);
          const lblCls = labelColor(item.daysLeft);

          return (
            <div
              key={item.id}
              className={`rounded-xl px-3.5 py-2.5 border transition hover:shadow-sm cursor-default ${bgCls}`}
            >
              <div className="flex items-center gap-2 mb-2">
                {icon(item.daysLeft)}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[13px] font-mono text-slate-900 truncate">
                      {item.permitNumber}
                    </span>
                    <span className="text-[9px] font-bold text-slate-400 bg-white/60 px-1.5 py-0.5 rounded shrink-0">
                      {item.type}
                    </span>
                    {item.car && (
                      <span className="text-[8px] font-mono text-slate-400 truncate max-w-[100px]">
                        {item.car}
                      </span>
                    )}
                  </div>
                </div>
                <span className={`text-[11px] font-bold font-mono shrink-0 ${lblCls}`}>
                  {formatDate(new Date(item.deadlineDate))}
                </span>
              </div>

              <div className="flex items-center gap-2.5">
                <div className="flex-1 h-1.5 bg-slate-200/60 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${color}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className={`text-[10px] font-semibold font-mono shrink-0 ${lblCls}`}>
                  {daysLabel(item.daysLeft)}
                </span>
              </div>
            </div>
          );
        }) : (
          <div className="flex flex-col items-center justify-center py-6 text-slate-400">
            <div className="text-2xl mb-2">✅</div>
            <p className="text-xs font-semibold text-slate-500">Нет дозволов с истекающим сроком</p>
            <p className="text-[10px] mt-0.5">У всех активных дозволов срок сдачи ещё не подходит</p>
          </div>
        )}
      </div>
    </div>
  );
}
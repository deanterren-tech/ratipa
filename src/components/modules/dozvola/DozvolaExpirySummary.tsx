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
  const [activeFilter, setActiveFilter] = useState<'all' | 'expired' | 'urgent' | 'soon'>('all');

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
    // Если дозвол сдан по копии — срок оригинала не показываем, для копий отдельный контроль 30 дней
    if (item.isCopy) return;

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

  const labelColor = (days: number) => {
    if (days < 0) return 'text-rose-700';
    if (days <= 7) return 'text-amber-700';
    return 'text-[#6B7280]';
  };

  const daysLabel = (days: number) => {
    if (days < 0) return `Просрочен на ${Math.abs(days)} дн.`;
    if (days === 0) return 'Крайний срок!';
    if (days === 1) return 'Остался 1 день';
    return `Осталось ${days} дн.`;
  };

  const expiredCount = items.filter(i => i.daysLeft < 0).length;
  const urgentCount = items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7).length;
  const soonCount = items.filter(i => i.daysLeft > 7 && i.daysLeft <= 30).length;

  const visibleItems = activeFilter === 'all'
    ? items
    : activeFilter === 'expired'
      ? items.filter(i => i.daysLeft < 0)
      : activeFilter === 'urgent'
        ? items.filter(i => i.daysLeft >= 0 && i.daysLeft <= 7)
        : items.filter(i => i.daysLeft > 7 && i.daysLeft <= 30);

  return (
    <div className="flex flex-col gap-2.5">
      {/* Заголовок связан с таблицей: без разделителя и лишнего разрыва */}
      <div className="flex items-center gap-2.5">
        <div className="p-1.5 bg-amber-50 text-amber-600 rounded-lg shrink-0">
          <Clock className="w-3.5 h-3.5" />
        </div>
        <h3 className="text-sm font-semibold text-[#121316]">
          Сроки дозволов
        </h3>
        <span className="text-xs text-[#6B7280]">{items.length} на контроле</span>
      </div>

      {/* Segmented filter pills (new design) */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {expiredCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === 'expired' ? 'all' : 'expired')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeFilter === 'expired'
                ? 'bg-rose-600 text-white'
                : 'bg-rose-50 text-rose-700 hover:bg-rose-100'
            }`}
          >
            Просрочено ({expiredCount})
          </button>
        )}
        {urgentCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === 'urgent' ? 'all' : 'urgent')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeFilter === 'urgent'
                ? 'bg-amber-500 text-white'
                : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
            }`}
          >
            Срочно ({urgentCount})
          </button>
        )}
        {soonCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveFilter(activeFilter === 'soon' ? 'all' : 'soon')}
            className={`px-3 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
              activeFilter === 'soon'
                ? 'bg-[#121316] text-white'
                : 'bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316]'
            }`}
          >
            Скоро ({soonCount})
          </button>
        )}
      </div>

      {/* Rows — compact deadline table: fixed height, pinned header, sum row */}
      <div className="max-h-[240px] overflow-y-auto overflow-x-auto custom-scrollbar border border-[#E5E7EB] rounded-xl">
        <table className="w-full text-left border-separate border-spacing-0">
          <thead>
            <tr className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
              <th className="sticky top-0 z-10 bg-white px-3 py-2.5 font-semibold border-b border-[#E5E7EB]">Бланк</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-2.5 font-semibold border-b border-[#E5E7EB]">Срок сдачи</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-2.5 font-semibold border-b border-[#E5E7EB]">Осталось</th>
              <th className="sticky top-0 z-10 bg-white px-3 py-2.5 font-semibold border-b border-[#E5E7EB]">Авто</th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.length > 0 ? visibleItems.map((item) => (
              <tr key={item.id} className="hover:bg-[#F9FAFB] transition-colors">
                <td className="px-3 py-2.5 align-middle border-b border-[#F3F4F6]">
                  <div className="flex items-center gap-2 min-w-0">
                    {item.daysLeft < 0
                      ? <XCircle size={14} className="text-rose-500 shrink-0" />
                      : item.daysLeft <= 7
                        ? <AlertTriangle size={14} className="text-amber-500 shrink-0" />
                        : <Clock size={14} className="text-[#9CA3AF] shrink-0" />}
                    <span className="font-mono font-semibold text-xs text-[#121316] whitespace-nowrap select-all">
                      {[item.type, item.permitNumber].filter(Boolean).join(' ')}
                    </span>
                  </div>
                </td>
                <td className="px-3 py-2.5 align-middle border-b border-[#F3F4F6]">
                  <span className="text-xs font-medium font-mono text-[#4B5563] whitespace-nowrap">
                    {formatDate(new Date(item.deadlineDate))}
                  </span>
                </td>
                <td className="px-3 py-2.5 align-middle border-b border-[#F3F4F6]">
                  <span className={`text-[11px] font-semibold whitespace-nowrap ${labelColor(item.daysLeft)}`}>
                    {daysLabel(item.daysLeft)}
                  </span>
                </td>
                <td className="px-3 py-2.5 align-middle border-b border-[#F3F4F6]">
                  <span className="text-[10px] font-mono text-[#6B7280] whitespace-nowrap">
                    {item.car || '—'}
                  </span>
                </td>
              </tr>
            )) : (
              <tr>
                <td colSpan={4} className="px-3 py-12 text-center text-xs text-[#6B7280]">
                  Нет дозволов по этому фильтру
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

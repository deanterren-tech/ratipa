import React, {useState, useEffect} from 'react'
import {UserProfile} from '../../../types'
import { useFirebase, database, onValue } from '../../../firebase'
import { ref } from 'firebase/database'
import {PieChart, FileCheck, Building, Truck} from 'lucide-react'

interface DozvolaQuotasBlockProps {
  user: UserProfile;
}

interface QuotaStat {
  typeName: string;
  total: number;
  office: number;
  hand: number;
  used: number;
  expired: number;
  pctUsed: number; // % of total that is in use (hand + office_return) / total for active ones
}

const getUsageColor = (pct: number) => {
  if (pct < 70) return 'text-emerald-600 bg-emerald-50 border-emerald-200/50';
  if (pct <= 90) return 'text-amber-600 bg-amber-50 border-amber-200/50';
  return 'text-rose-600 bg-rose-50 border-rose-200/50';
};

const getUsageBarColor = (pct: number) => {
  if (pct < 70) return 'bg-emerald-500';
  if (pct <= 90) return 'bg-amber-500';
  return 'bg-rose-500';
};

export default function DozvolaQuotasBlock({ user }: DozvolaQuotasBlockProps) {
  const [dozvolsData, setDozvolsData] = useState<Record<string, any>>({});
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [customTypesOrder, setCustomTypesOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!useFirebase) return;
    const unsub1 = onValue(ref(database, 'dozvolsRegistryV4'), (snap) => setDozvolsData(snap.val() || {}));
    const unsub2 = onValue(ref(database, 'dozvolsTypesV4'), (snap) => setCustomTypes(snap.val() || {}));
    const unsub3 = onValue(ref(database, 'dozvolsTypesOrderV4'), (snap) => 
      setCustomTypesOrder(Array.isArray(snap.val()) ? snap.val() : Object.keys(snap.val() || {}))
    );
    return () => { unsub1(); unsub2(); unsub3(); };
  }, []);

  const sortedTypeIds = customTypesOrder.length > 0
    ? customTypesOrder
    : Object.keys(customTypes);

  // Compute stats per type
  const quotaStats: QuotaStat[] = sortedTypeIds.map((id) => {
    const typeName = customTypes[id]?.name || id;
    const items = Object.values(dozvolsData).filter((i: any) => i.type === typeName);
    const total = items.length;
    const office = items.filter((i: any) => i.status === 'office' || i.status === 'available').length;
    const hand = items.filter((i: any) => i.status === 'hand').length;
    const used = items.filter((i: any) => i.status === 'used' || i.status === 'expired').length;
    const expired = items.filter((i: any) => i.status === 'expired').length;

    // % usage: active items in non-office status (hand + office_return) / total active
    const activeItems = items.filter((i: any) => i.status !== 'used' && i.status !== 'expired');
    const inUseItems = activeItems.filter((i: any) => i.status === 'hand' || i.status === 'office_return');
    const pctUsed = activeItems.length > 0
      ? Math.round((inUseItems.length / activeItems.length) * 100)
      : 0;

    return { typeName, total, office, hand, used, expired, pctUsed };
  }).filter(s => s.total > 0);

  const grandTotal = quotaStats.reduce((sum, s) => sum + s.total, 0);
  const grandOffice = quotaStats.reduce((sum, s) => sum + s.office, 0);
  const grandHand = quotaStats.reduce((sum, s) => sum + s.hand, 0);

  return (
    <div className="flex flex-col gap-5">
      {/* Summary bar */}
      <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-100/50 flex items-center justify-center">
            <PieChart className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-0.5">
              Квоты дозволов
            </span>
            <h3 className="text-lg font-bold text-slate-900">
              Общий анализ использования
            </h3>
          </div>
        </div>
        <div className="flex items-center gap-6 text-xs">
          <div className="flex items-center gap-2 font-semibold text-slate-700">
            <FileCheck className="w-4 h-4 text-slate-400" />
            <span>Всего: <strong className="text-slate-900">{grandTotal}</strong></span>
          </div>
          <div className="flex items-center gap-2 font-semibold text-emerald-600">
            <Building className="w-4 h-4" />
            <span>В офисе: <strong>{grandOffice}</strong></span>
          </div>
          <div className="flex items-center gap-2 font-semibold text-blue-600">
            <Truck className="w-4 h-4" />
            <span>В рейсе: <strong>{grandHand}</strong></span>
          </div>
        </div>
      </div>

      {/* Quota cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {quotaStats.map((stat) => {
          const colorClass = getUsageColor(stat.pctUsed);
          const barColor = getUsageBarColor(stat.pctUsed);
          return (
            <div
              key={stat.typeName}
              className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3"
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-800 truncate">
                  {stat.typeName}
                </span>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-lg border ${colorClass}`}>
                  {stat.pctUsed}%
                </span>
              </div>

              {/* Progress bar */}
              <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${barColor}`}
                  style={{ width: `${Math.min(stat.pctUsed, 100)}%` }}
                />
              </div>

              {/* Stats rows */}
              <div className="flex flex-col gap-1.5 text-xs">
                <div className="flex justify-between items-center text-slate-600">
                  <span>Всего бланков</span>
                  <span className="font-bold text-slate-900">{stat.total}</span>
                </div>
                <div className="flex justify-between items-center text-emerald-600">
                  <span>В офисе / в наличии</span>
                  <span className="font-bold">{stat.office}</span>
                </div>
                <div className="flex justify-between items-center text-blue-600">
                  <span>В рейсе (на руках)</span>
                  <span className="font-bold">{stat.hand}</span>
                </div>
                <div className="flex justify-between items-center text-amber-600">
                  <span>Использовано / сдано</span>
                  <span className="font-bold">{stat.used}</span>
                </div>
                {stat.expired > 0 && (
                  <div className="flex justify-between items-center text-rose-600">
                    <span>Аннулировано</span>
                    <span className="font-bold">{stat.expired}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {quotaStats.length === 0 && (
        <div className="bg-white rounded-2xl p-12 border border-slate-200/50 shadow-sm flex flex-col items-center justify-center gap-3">
          <span className="text-4xl">📊</span>
          <p className="text-xs font-bold text-slate-500 uppercase tracking-tight">
            Нет данных по квотам
          </p>
          <p className="text-[11px] text-slate-400 text-center">
            Добавьте типы дозволов в справочнике, чтобы увидеть статистику использования квот.
          </p>
        </div>
      )}
    </div>
  );
}
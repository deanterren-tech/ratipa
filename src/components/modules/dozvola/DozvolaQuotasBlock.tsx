import React, { useState, useEffect, useMemo } from 'react';
import { UserProfile } from '../../../types';
import { useFirebase, database, onValue } from '../../../firebase';
import { ref, set, push } from 'firebase/database';
import { PieChart, Users, CalendarRange, Info, AlertTriangle, MinusCircle, Loader2, X } from 'lucide-react';
import { useToast } from '../../ToastProvider';
import { useDialog } from '../../DialogProvider';
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import {
  Quarter,
  QUARTERS,
  QUARTER_LABELS,
  QUARTER_MONTHS,
  QuotaMode,
  currentQuarter,
  getQuarterRange,
  computeQuarterStats,
  computeYearStats,
  normalizeQuotaMode,
  countConfiguredQuarters,
  countMissingReceiptDate,
  toNonNegativeInt,
  quotaPaths,
} from '../../../dozvolaQuota';

interface DozvolaQuotasBlockProps {
  user: UserProfile;
  /** Query-параметры маршрута (#dozvola/quotas?year=2026&quarter=3) */
  routeParams?: Record<string, string>;
  /** Записать выбранный период в URL */
  onPeriodChange?: (params: Record<string, string>) => void;
}

interface ReductionRecord {
  amount: number;
  reason?: string;
  author?: string;
  updatedAt?: string;
}

const fillColor = (pct: number) => {
  if (pct < 70) return 'bg-emerald-500';
  if (pct <= 90) return 'bg-amber-500';
  return 'bg-rose-500';
};

const fillText = (pct: number) => {
  if (pct < 70) return 'text-emerald-600';
  if (pct <= 90) return 'text-amber-600';
  return 'text-rose-600';
};

const fmtDate = (iso?: string | Date) => {
  if (!iso) return '—';
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU').replace(/\./g, '/');
};

const cellInput =
  'w-20 px-2 py-1 bg-white border border-[#E5E7EB] rounded-lg text-xs font-mono text-right focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition disabled:text-[#9CA3AF] disabled:bg-[#F9FAFB]';

/** Диалог сокращения квоты: значение + причина, подтверждение при изменении действующего. */
const ReductionDialog: React.FC<{
  isOpen: boolean;
  typeName: string;
  current: ReductionRecord | null;
  quota: number;
  received: number;
  canEdit: boolean;
  onClose: () => void;
  onSave: (amount: number, reason: string) => void;
}> = ({ isOpen, typeName, current, quota, received, canEdit, onClose, onSave }) => {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setAmount(current?.amount ? String(current.amount) : '');
    setReason(current?.reason || '');
    setError(null);
  }, [isOpen, current]);

  const submit = () => {
    const parsed = parseInt(amount || '0', 10);
    if (Number.isNaN(parsed) || parsed < 0) {
      setError('Сокращение не может быть отрицательным.');
      return;
    }
    onSave(toNonNegativeInt(amount), reason.trim());
  };

  useModalKeyboard({
    isOpen,
    onClose,
    onConfirm: canEdit ? submit : undefined,
    canConfirm: canEdit,
    initialFocusSelector: 'input[type="number"]',
  });

  if (!isOpen) return null;

  const value = toNonNegativeInt(amount);
  const effective = Math.max(0, quota - value);
  const clamped = value > quota;

  return (
    <div data-scroll-lock="modal" className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-rose-50 text-rose-600 rounded-lg shrink-0">
              <MinusCircle className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#121316]">Сокращение квоты</h3>
              <p className="text-xs text-[#6B7280] mt-0.5">{typeName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-6 py-5 flex flex-col gap-4">
          <div>
            <label className="text-[11px] font-medium text-[#6B7280] block mb-1">
              Сокращение, шт.
            </label>
            <input
              type="number"
              min="0"
              step="1"
              value={amount}
              onChange={(e) => { setAmount(e.target.value); setError(null); }}
              disabled={!canEdit}
              placeholder="0"
              className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs font-mono focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
            />
            {error && (
              <span className="flex items-center gap-1.5 text-[11px] text-rose-600 mt-1.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                {error}
              </span>
            )}
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#6B7280] block mb-1">
              Причина / комментарий
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={!canEdit}
              rows={2}
              placeholder="Необязательно"
              className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs resize-none focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
            />
          </div>

          <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-[#6B7280]">Установленная квота</span>
              <span className="font-mono tabular-nums text-[#121316]">{quota} шт</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#6B7280]">Сокращение</span>
              <span className="font-mono tabular-nums text-rose-600">− {value} шт</span>
            </div>
            <div className="flex justify-between gap-3 pt-1.5 border-t border-[#E5E7EB]">
              <span className="font-medium text-[#4B5563]">Эффективная квота</span>
              <span className="font-semibold font-mono tabular-nums text-[#121316]">{effective} шт</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-[#6B7280]">Получено в квартале</span>
              <span className="font-mono tabular-nums text-[#121316]">{received} шт</span>
            </div>
            {clamped && (
              <span className="flex items-center gap-1.5 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1 mt-1">
                <AlertTriangle className="w-3 h-3 shrink-0" />
                Сокращение больше квоты — эффективная квота не может быть меньше нуля.
              </span>
            )}
          </div>

          {current && (
            <p className="text-[10px] text-[#9CA3AF]">
              Действующее сокращение задал {current.author || '—'} · {fmtDate(current.updatedAt)}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[#E5E7EB] flex justify-end gap-2.5 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-[#E5E7EB] hover:bg-[#F3F4F6] rounded-lg text-xs font-medium text-[#4B5563] bg-white transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canEdit}
            className="px-5 py-2 bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] disabled:opacity-50 text-[var(--accent-on)] font-medium rounded-lg text-xs transition-colors cursor-pointer"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
};

export default function DozvolaQuotasBlock({ user, routeParams, onPeriodChange }: DozvolaQuotasBlockProps) {
  const { toast } = useToast();
  const { showConfirm } = useDialog();
  const canEdit = user?.permissions?.dozvola === 'write' || user?.role === 'root_admin';

  const now = useMemo(() => new Date(), []);
  // Период живёт в URL: обновление страницы и «Назад»/«Вперёд» его сохраняют
  const [year, setYear] = useState<number>(() => {
    const y = parseInt(routeParams?.year || '', 10);
    return Number.isFinite(y) && y > 2000 ? y : now.getFullYear();
  });
  const [quarter, setQuarter] = useState<Quarter>(() => {
    const qv = parseInt(routeParams?.quarter || '', 10);
    return qv >= 1 && qv <= 4 ? (qv as Quarter) : currentQuarter(now);
  });

  useEffect(() => {
    const y = parseInt(routeParams?.year || '', 10);
    const qv = parseInt(routeParams?.quarter || '', 10);
    if (Number.isFinite(y) && y > 2000) setYear((prev) => (prev === y ? prev : y));
    if (qv >= 1 && qv <= 4) setQuarter((prev) => (prev === qv ? prev : (qv as Quarter)));
  }, [routeParams?.year, routeParams?.quarter]);

  const pickPeriod = (nextYear: number, nextQuarter: Quarter) => {
    setYear(nextYear);
    setQuarter(nextQuarter);
    const params: Record<string, string> = {};
    if (nextYear !== now.getFullYear()) params.year = String(nextYear);
    if (nextQuarter !== currentQuarter(now)) params.quarter = String(nextQuarter);
    onPeriodChange?.(params);
  };

  const [dozvolsData, setDozvolsData] = useState<Record<string, any>>({});
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [customTypesOrder, setCustomTypesOrder] = useState<string[]>([]);
  const [globalDrivers, setGlobalDrivers] = useState(0);
  const [typePercents, setTypePercents] = useState<Record<string, any>>({});
  const [quarterLimitsYear, setQuarterLimitsYear] = useState<Record<string, any>>({});
  const [reductions, setReductions] = useState<Record<string, ReductionRecord>>({});
  const [legacyQuarterLimits, setLegacyQuarterLimits] = useState<Record<string, any>>({});
  const [legacyPercents, setLegacyPercents] = useState<Record<string, any>>({});
  const [modes, setModes] = useState<Record<string, any>>({});
  const [annualPercents, setAnnualPercents] = useState<Record<string, any>>({});
  const [annualReductions, setAnnualReductions] = useState<Record<string, any>>({});
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Настройки выбранного периода
  useEffect(() => {
    if (!useFirebase) { setLoading(false); return; }
    setLoading(true);
    setLoadError(null);
    const unsubs = [
      onValue(
        ref(database, `quotaQuarterLimitsV2/${year}`),
        (s) => { setQuarterLimitsYear(s.val() || {}); setLoading(false); },
        (err: any) => {
          setLoadError(err?.message || 'Не удалось загрузить квоты выбранного периода.');
          setLoading(false);
        },
      ),
      onValue(ref(database, quotaPaths.reductions(year, quarter)), (s) => setReductions(s.val() || {})),
      onValue(ref(database, quotaPaths.annualPercents(year)), (s) => setAnnualPercents(s.val() || {})),
      onValue(ref(database, quotaPaths.annualReductions(year)), (s) => setAnnualReductions(s.val() || {})),
    ];
    return () => unsubs.forEach((u) => u());
  }, [year, quarter]);

  // Справочники и записи — не зависят от периода
  useEffect(() => {
    if (!useFirebase) return;
    const unsubs = [
      onValue(ref(database, 'dozvolsRegistryV4'), (s) => setDozvolsData(s.val() || {})),
      onValue(ref(database, 'dozvolsTypesV4'), (s) => setCustomTypes(s.val() || {})),
      onValue(ref(database, 'dozvolsTypesOrderV4'), (s) =>
        setCustomTypesOrder(Array.isArray(s.val()) ? s.val() : Object.keys(s.val() || {})),
      ),
      onValue(ref(database, 'quotaGlobalDriversCount'), (s) => setGlobalDrivers(s.val() || 0)),
      onValue(ref(database, 'quotaTypesPercents'), (s) => setTypePercents(s.val() || {})),
      onValue(ref(database, 'quotaTypesQuarterLimits'), (s) => setLegacyQuarterLimits(s.val() || {})),
      onValue(ref(database, quotaPaths.modeAll()), (s) => setModes(s.val() || {})),
      onValue(ref(database, 'quotaTypesPercents'), (s) => setLegacyPercents(s.val() || {})),
      onValue(ref(database, quotaPaths.annualPercents(year)), (s) => setAnnualPercents(s.val() || {})),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  const sortedTypeIds = customTypesOrder.length > 0 ? customTypesOrder : Object.keys(customTypes);

  /** Квоты всех кварталов выбранного года: { '1': {тип: шт}, … } */
  const quarterLimitsByQuarter = useMemo(() => {
    const map: Record<string, Record<string, any>> = {};
    QUARTERS.forEach((q) => {
      const key = `${year}|${q}`;
      map[key] = (quarterLimitsYear[String(q)] || {}) as Record<string, any>;
    });
    return map;
  }, [quarterLimitsYear, year]);

  /** Квоты выбранного квартала (для расчёта текущей строки). */
  const quarterLimits = quarterLimitsByQuarter[`${year}|${quarter}`] || {};

  const permitsByType = useMemo(() => {
    const map: Record<string, any[]> = {};
    Object.values(dozvolsData).forEach((item: any) => {
      const t = item?.type;
      if (!t) return;
      (map[t] ||= []).push(item);
    });
    return map;
  }, [dozvolsData]);

  const rows = sortedTypeIds.map((id) => {
    const typeName = customTypes[id]?.name || id;
    const permits = permitsByType[typeName] || [];
    const mode: QuotaMode = normalizeQuotaMode(modes[typeName]);

    // Годовой режим: процент задаётся один раз на год (с fallback на прежний общий процент)
    const annualPercentRaw =
      annualPercents[typeName] !== undefined && annualPercents[typeName] !== null
        ? annualPercents[typeName]
        : legacyPercents[typeName];
    // Сокращение доступно в любом режиме: у годового — на год, у квартального — на квартал
    const annualReductionRec = annualReductions[typeName] || null;
    const yearStats = computeYearStats(
      permits,
      year,
      annualPercentRaw,
      globalDrivers,
      annualReductionRec?.amount,
    );

    // Квартальный режим: количество на квартал (с fallback на прежнюю плоскую настройку)
    const configured = quarterLimits[typeName];
    const fallback = legacyQuarterLimits[typeName];
    const quotaRaw = configured !== undefined && configured !== null ? configured : fallback;
    const reductionRec = reductions[typeName] || null;
    const quarterStats = computeQuarterStats(permits, year, quarter, quotaRaw, reductionRec?.amount);

    // Единая форма строки: единицы не смешиваются — берём данные того режима, который включён
    const stats = mode === 'annual'
      ? {
          quota: yearStats.quota,
          reduction: yearStats.reduction,
          effective: yearStats.effective,
          received: yearStats.received,
          remaining: yearStats.remaining,
          needsVerification: yearStats.needsVerification,
          notConfigured: yearStats.notConfigured,
          fillPct: yearStats.fillPct,
          reductionClamped: yearStats.reductionClamped,
        }
      : quarterStats;

    // Запись сокращения берётся из области текущего режима
    const activeReduction = mode === 'annual' ? annualReductionRec : reductionRec;

    return {
      typeName,
      permits,
      mode,
      reductionRec: activeReduction,
      annualPercent: Number(annualPercentRaw) || 0,
      quarterStats,
      yearStats,
      suggestedPercent: Number(legacyPercents[typeName]) || 0,
      stats,
      configuredQuarters: countConfiguredQuarters(
        Object.fromEntries(QUARTERS.map((q) => [String(q), quarterLimitsForRow(id, typeName, q)])),
      ),
    };
  });

  /** Количество, заданное виду на конкретный квартал (новая настройка → прежняя плоская). */
  function quarterLimitsForRow(_id: string, typeName: string, q: Quarter): number {
    const direct = (quarterLimitsByQuarter[`${year}|${q}`] || {})[typeName];
    if (direct !== undefined && direct !== null) return toNonNegativeInt(direct);
    return toNonNegativeInt(legacyQuarterLimits[typeName]);
  }

  const total = rows.reduce(
    (acc, r) => ({
      quota: acc.quota + r.stats.quota,
      reduction: acc.reduction + r.stats.reduction,
      effective: acc.effective + r.stats.effective,
      received: acc.received + r.stats.received,
      remaining: acc.remaining + (r.stats.remaining ?? 0),
      blanks: acc.blanks + r.permits.length,
    }),
    { quota: 0, reduction: 0, effective: 0, received: 0, remaining: 0, blanks: 0 },
  );

  const missingReceiptDates = countMissingReceiptDate(Object.values(dozvolsData));
  const configuredCount = rows.filter((r) => !r.stats.notConfigured).length;
  const range = getQuarterRange(year, quarter);
  const periodCaption = `${fmtDate(range.start)} — ${fmtDate(range.end)}`;

  const years = useMemo(() => {
    const set = new Set<number>();
    const y = now.getFullYear();
    for (let i = y - 2; i <= y + 1; i++) set.add(i);
    Object.values(dozvolsData).forEach((i: any) => {
      const d = i?.issueDate ? new Date(i.issueDate) : null;
      if (d && !Number.isNaN(d.getTime())) set.add(d.getFullYear());
    });
    return Array.from(set).sort((a, b) => b - a);
  }, [dozvolsData, now]);

  const logQuotaAction = (typeName: string, action: string, meta: string) => {
    if (!useFirebase) return;
    const logist = localStorage.getItem('ratipa_auth_user') || user?.name || 'Система';
    push(ref(database, 'dozvolsHistoryV4'), {
      time: new Date().toLocaleString('ru-RU'),
      logist,
      doc: `${typeName} · ${QUARTER_LABELS[quarter]} ${year}`,
      action,
      meta,
    });
  };

  const saveGlobal = (v: string) => {
    if (!useFirebase) return;
    set(ref(database, 'quotaGlobalDriversCount'), toNonNegativeInt(v));
  };

  

  // ── Режим квотирования ────────────────────────────────────────────────
  const saveMode = async (typeName: string, next: QuotaMode, currentMode: QuotaMode) => {
    if (next === currentMode || !useFirebase) return;
    const ok = await showConfirm(
      next === 'quarterly'
        ? `Переключить «${typeName}» на квартальную квоту? Годовой процент останется в данных, но перестанет учитываться.`
        : `Переключить «${typeName}» на годовую квоту (проценты)? Заданные квартальные количества останутся в данных, но перестанут учитываться.`,
      'Смена режима квотирования',
    );
    if (!ok) return;

    await set(ref(database, quotaPaths.modeForType(typeName)), next);
    logQuotaAction(
      typeName,
      'Изменён режим квотирования',
      `${currentMode === 'annual' ? 'годовая, %' : 'квартальная, шт'} → ${next === 'annual' ? 'годовая, %' : 'квартальная, шт'}`,
    );
    toast(`«${typeName}»: ${next === 'annual' ? 'годовая квота, %' : 'квартальная квота, шт'}`, 'success');
  };

  // ── Годовой процент (одно значение на год) ────────────────────────────
  const saveAnnualPercent = async (typeName: string, raw: string, current: number) => {
    const next = toNonNegativeInt(raw);
    if (next === current || !useFirebase) return;
    if (current > 0) {
      const ok = await showConfirm(
        `Изменить годовой процент «${typeName}» за ${year} год: ${current}% → ${next}%?`,
        'Изменение годовой квоты',
      );
      if (!ok) return;
    }
    await set(ref(database, quotaPaths.annualPercentForType(year, typeName)), next);
    logQuotaAction(typeName, 'Изменена годовая квота', `${year} год: [${current}] → [${next}] %`);
    toast(`«${typeName}»: ${next}% на ${year} год`, 'success');
  };

  // ── Квартальное количество ────────────────────────────────────────────
  const saveQuarterValue = async (typeName: string, q: Quarter, raw: string, current: number) => {
    const next = toNonNegativeInt(raw);
    if (next === current || !useFirebase) return;
    await set(ref(database, quotaPaths.limitForType(year, q, typeName)), next);
    logQuotaAction(
      typeName,
      'Изменена квартальная квота',
      `${QUARTER_LABELS[q]} ${year}: [${current}] → [${next}] шт`,
    );
    toast(`«${typeName}» · ${QUARTER_LABELS[q]} ${year}: ${next} шт`, 'success');
  };

  // Диалог сокращения
  const [reductionFor, setReductionFor] = useState<string | null>(null);
  const reductionRow = reductionFor ? rows.find((r) => r.typeName === reductionFor) : null;

  const openReduction = (typeName: string) => {
    if (!canEdit) return;
    setReductionFor(typeName);
  };

  const applyReduction = async (amount: number, reason: string) => {
    if (!reductionRow) return;
    const { typeName } = reductionRow;
    const existing = reductionRow.reductionRec;
    const hadReduction = !!existing && (existing.amount || 0) > 0;

    const scopeLabel = reductionRow.mode === 'annual' ? `${year} год` : `${QUARTER_LABELS[quarter]} ${year}`;

    if (hadReduction && existing!.amount !== amount) {
      const ok = await showConfirm(
        `Изменить действующее сокращение «${typeName}» (${scopeLabel}) с ${existing!.amount} на ${amount} шт?`,
        'Изменение действующего ограничения',
      );
      if (!ok) return;
    }

    if (!useFirebase) { setReductionFor(null); return; }

    const author = localStorage.getItem('ratipa_auth_user') || user?.name || 'Система';
    const path =
      reductionRow.mode === 'annual'
        ? quotaPaths.annualReductionForType(year, typeName)
        : quotaPaths.reductionForType(year, quarter, typeName);

    if (amount <= 0 && !reason) {
      await set(ref(database, path), null);
    } else {
      await set(ref(database, path), {
        amount,
        reason: reason || '',
        author,
        updatedAt: new Date().toISOString(),
      });
    }

    logQuotaAction(
      typeName,
      reductionRow.mode === 'annual'
        ? 'Изменено сокращение годовой квоты'
        : 'Изменено сокращение квартальной квоты',
      `${scopeLabel}: [${existing?.amount ?? 0}] → [${amount}] шт${reason ? `, причина: ${reason}` : ''}`,
    );
    toast(`Сокращение «${typeName}»: ${amount} шт`, 'success');
    setReductionFor(null);
  };

  const summaryChip = 'text-[11px] text-[#6B7280]';

  return (
    <div className="flex flex-col gap-4">
      {/* Заголовок + общие настройки */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="p-1.5 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg">
            <PieChart className="w-3.5 h-3.5" />
          </span>
          <h2 className="text-sm font-semibold text-[#121316]">Квоты и лимиты выдачи</h2>
          {canEdit && <span className="text-[11px] text-[#6B7280]">Значения правятся прямо в таблице</span>}
        </div>
        <label className="flex items-center gap-2">
          <Users className="w-3.5 h-3.5 text-[#9CA3AF]" />
          <span className={summaryChip}>Водителей в штате</span>
          <input
            type="number"
            key={`gdrivers-${globalDrivers}`}
            defaultValue={globalDrivers || ''}
            onBlur={(e) => saveGlobal(e.target.value)}
            disabled={!canEdit}
            placeholder="0"
            className={cellInput}
          />
        </label>
      </div>

      {/* Выбор года и квартала */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pb-3 border-b border-[#E5E7EB]">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none">
          {years.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => pickPeriod(y, quarter)}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                year === y ? 'bg-[#121316] text-white' : 'text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6]'
              }`}
            >
              {y}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1">
          {QUARTERS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => pickPeriod(year, q)}
              title={QUARTER_MONTHS[q]}
              className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer whitespace-nowrap ${
                quarter === q ? 'bg-[#121316] text-white' : 'text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6]'
              }`}
            >
              {QUARTER_LABELS[q]}
              <span className="hidden sm:inline text-[10px] opacity-70 ml-1">{QUARTER_MONTHS[q]}</span>
            </button>
          ))}
        </div>

        <span className={`flex items-center gap-1.5 ${summaryChip}`}>
          <CalendarRange className="w-3 h-3 text-[#9CA3AF]" />
          {periodCaption}
        </span>

        <span className={summaryChip}>
          Настроено: <strong className="font-mono tabular-nums text-[#121316]">{configuredCount}</strong> из {rows.length}
        </span>

        {missingReceiptDates > 0 && (
          <span
            className="inline-flex items-center gap-1.5 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full"
            title="У этих бланков нет даты фактического получения — в квартальный подсчёт они не попадают"
          >
            <AlertTriangle className="w-3 h-3 shrink-0" />
            Требуют проверки: {missingReceiptDates}
          </span>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-[#6B7280]">
          <Loader2 className="w-4 h-4 animate-spin" />
          Загрузка квот…
        </div>
      ) : loadError ? (
        <div className="flex items-center justify-center gap-2 py-12 text-xs text-rose-600">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {loadError}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-12 text-center text-xs text-[#6B7280]">
          Нет видов дозволов. Добавьте их в «Справочнике видов», чтобы настраивать квоты.
        </div>
      ) : (
        <>
          {/* Таблица (md+): режим квотирования задаёт формулу и единицы */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left border-separate border-spacing-0">
              <thead>
                <tr className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                  {[
                    ['Вид дозвола', 'text-left'],
                    ['Режим', 'text-left'],
                    ['Квота', 'text-right'],
                    ['Сокращение, шт.', 'text-right'],
                    ['Эффективная', 'text-right'],
                    ['Получено', 'text-right'],
                    ['Остаток', 'text-right'],
                    ['Заполнение', 'text-left'],
                  ].map(([label, align]) => (
                    <th
                      key={label}
                      className={`sticky top-0 z-10 bg-white px-3 py-2.5 font-semibold border-b border-[#E5E7EB] whitespace-nowrap ${align}`}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const s = r.stats;
                  const isAnnual = r.mode === 'annual';
                  const isExpanded = expandedType === r.typeName;
                  return (
                    <React.Fragment key={r.typeName}>
                      <tr className="hover:bg-[#F9FAFB] transition-colors">
                        <td className="px-3 py-2.5 border-b border-[#F3F4F6]">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[10px] font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md whitespace-nowrap">
                              {r.typeName}
                            </span>
                            {s.notConfigured && (
                              <span className="text-[10px] text-[#9CA3AF] whitespace-nowrap">квота не настроена</span>
                            )}
                            {s.needsVerification > 0 && (
                              <span
                                className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full whitespace-nowrap"
                                title="Бланки без даты фактического получения"
                              >
                                <AlertTriangle className="w-3 h-3" />
                                {s.needsVerification}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Режим квотирования — явный для каждого вида */}
                        <td className="px-3 py-2.5 border-b border-[#F3F4F6]">
                          <div className="inline-flex items-center gap-0.5 bg-[#F3F4F6] rounded-lg p-0.5">
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => saveMode(r.typeName, 'annual', r.mode)}
                              title="Годовая квота в процентах от штата"
                              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer disabled:cursor-default whitespace-nowrap ${
                                isAnnual ? 'bg-white text-[#121316] shadow-xs' : 'text-[#6B7280] hover:text-[#121316]'
                              }`}
                            >
                              Годовая %
                            </button>
                            <button
                              type="button"
                              disabled={!canEdit}
                              onClick={() => saveMode(r.typeName, 'quarterly', r.mode)}
                              title="Квартальные квоты в штуках"
                              className={`px-2 py-1 rounded-md text-[10px] font-medium transition-colors cursor-pointer disabled:cursor-default whitespace-nowrap ${
                                !isAnnual ? 'bg-white text-[#121316] shadow-xs' : 'text-[#6B7280] hover:text-[#121316]'
                              }`}
                            >
                              Квартальная шт.
                            </button>
                          </div>
                        </td>

                        {/* Квота: одна единица измерения на строку */}
                        <td className="px-3 py-2.5 border-b border-[#F3F4F6] text-right">
                          {isAnnual ? (
                            <div className="inline-flex items-center justify-end gap-2">
                              {canEdit ? (
                                <input
                                  type="number"
                                  min="0"
                                  max="100"
                                  key={`ap-${r.typeName}-${year}-${r.annualPercent}`}
                                  defaultValue={r.annualPercent || ''}
                                  onBlur={(e) => saveAnnualPercent(r.typeName, e.target.value, r.annualPercent)}
                                  placeholder="—"
                                  className={cellInput}
                                />
                              ) : (
                                <span className="font-mono tabular-nums text-xs text-[#121316]">{r.annualPercent}</span>
                              )}
                              <span className="text-[11px] text-[#6B7280] shrink-0">%</span>
                              <span className="text-[10px] text-[#9CA3AF] font-mono tabular-nums whitespace-nowrap">
                                = {s.quota} шт
                              </span>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setExpandedType(isExpanded ? null : r.typeName)}
                              title="Задать количество на каждый квартал"
                              className="inline-flex items-center justify-end gap-1.5 font-mono tabular-nums text-xs text-[#121316] hover:bg-[#F3F4F6] rounded-lg px-2 py-1 transition-colors cursor-pointer"
                            >
                              {s.quota} <span className="text-[10px] text-[#9CA3AF]">шт · {QUARTER_LABELS[quarter]}</span>
                              <span className="text-[10px] text-[#9CA3AF]">{isExpanded ? '▲' : '▼'}</span>
                            </button>
                          )}
                        </td>

                        {/* Сокращение в штуках — доступно для любого режима квотирования */}
                        <td className="px-3 py-2.5 border-b border-[#F3F4F6] text-right">
                          {(
                            <button
                              type="button"
                              onClick={() => openReduction(r.typeName)}
                              disabled={!canEdit}
                              title={r.reductionRec?.reason ? `Причина: ${r.reductionRec.reason}` : 'Задать сокращение'}
                              className="inline-flex items-center gap-1.5 justify-end w-full font-mono tabular-nums text-xs text-rose-600 hover:bg-rose-50 rounded-lg px-2 py-1 transition-colors cursor-pointer disabled:cursor-default disabled:text-[#9CA3AF]"
                            >
                              {s.reduction > 0 ? `− ${s.reduction}` : 'не задано'}
                              {canEdit && <MinusCircle className="w-3 h-3 shrink-0" />}
                            </button>
                          )}
                          {s.reductionClamped && (
                            <span
                              className="block text-[10px] text-amber-700 mt-0.5"
                              title="Сокращение больше исходной квоты — эффективная квота ограничена нулём"
                            >
                              больше квоты
                            </span>
                          )}
                        </td>

                        <td className="px-3 py-2.5 border-b border-[#F3F4F6] text-right">
                          <span className="font-semibold font-mono tabular-nums text-xs text-[#121316]">
                            {s.notConfigured ? '—' : `${s.effective} шт`}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 border-b border-[#F3F4F6] text-right">
                          <span className="inline-flex items-center justify-end gap-1.5 font-semibold font-mono tabular-nums text-xs text-[#121316]">
                            {s.received}
                            <span className="text-[10px] font-normal text-[#9CA3AF]">
                              {isAnnual ? 'за год' : QUARTER_LABELS[quarter]}
                            </span>
                          </span>
                        </td>

                        <td className="px-3 py-2.5 border-b border-[#F3F4F6] text-right">
                          <span
                            className={`font-semibold font-mono tabular-nums text-xs ${
                              s.remaining === null ? 'text-[#9CA3AF]' : s.remaining === 0 ? 'text-rose-600' : 'text-emerald-700'
                            }`}
                          >
                            {s.remaining === null ? '—' : s.remaining}
                          </span>
                        </td>

                        <td className="px-3 py-2.5 border-b border-[#F3F4F6]">
                          {s.fillPct === null ? (
                            <span className="text-[11px] text-[#9CA3AF]">—</span>
                          ) : (
                            <div className="flex items-center gap-2 min-w-[130px]">
                              <div className="flex-1 h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full transition-all ${fillColor(s.fillPct)}`}
                                  style={{ width: `${s.fillPct}%` }}
                                />
                              </div>
                              <span className={`text-[11px] font-semibold font-mono tabular-nums w-9 text-right ${fillText(s.fillPct)}`}>
                                {s.fillPct}%
                              </span>
                            </div>
                          )}
                        </td>
                      </tr>

                      {/* Квартальные количества — только у видов с квартальным режимом */}
                      {!isAnnual && isExpanded && (
                        <tr className="bg-[#F9FAFB]">
                          <td colSpan={8} className="px-3 py-3 border-b border-[#E5E7EB]">
                            <div className="flex flex-wrap items-end gap-4">
                              <span className="text-[11px] font-medium text-[#6B7280] pb-2">
                                Количество на квартал, {year} год:
                              </span>
                              {QUARTERS.map((q) => {
                                const value = quarterLimitsByQuarter[`${year}|${q}`]?.[r.typeName];
                                const num = toNonNegativeInt(value);
                                return (
                                  <label key={q} className="flex items-center gap-1.5">
                                    <span className="text-[11px] text-[#6B7280]">{QUARTER_LABELS[q]}</span>
                                    <input
                                      type="number"
                                      min="0"
                                      disabled={!canEdit}
                                      key={`q-${r.typeName}-${year}-${q}-${num}`}
                                      defaultValue={num || ''}
                                      onBlur={(e) => saveQuarterValue(r.typeName, q, e.target.value, num)}
                                      placeholder="0"
                                      className={cellInput}
                                    />
                                    <span className="text-[11px] text-[#6B7280]">шт.</span>
                                  </label>
                                );
                              })}
                              <span className="text-[10px] text-[#9CA3AF] pb-2">
                                Задано кварталов: {r.configuredQuarters} из 4
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                <tr className="bg-[#F9FAFB]">
                  <td className="px-3 py-2.5 text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                    Итого за {year} год{rows.some((r) => r.mode === 'quarterly') ? ` · ${QUARTER_LABELS[quarter]}` : ''}
                  </td>
                  <td className="px-3 py-2.5 text-[10px] text-[#9CA3AF] whitespace-nowrap">
                    {rows.filter((r) => r.mode === 'annual').length} год. / {rows.filter((r) => r.mode === 'quarterly').length} кв.
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold font-mono tabular-nums text-xs text-[#121316]">
                    {total.quota}
                    <span className="block text-[10px] font-normal text-[#9CA3AF]">шт</span>
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold font-mono tabular-nums text-xs text-rose-600">
                    {total.reduction > 0 ? `− ${total.reduction}` : '—'}
                  </td>
                  <td className="px-3 py-2.5 text-right font-semibold font-mono tabular-nums text-xs text-[#121316]">{total.effective}</td>
                  <td className="px-3 py-2.5 text-right font-semibold font-mono tabular-nums text-xs text-[#121316]">{total.received}</td>
                  <td className="px-3 py-2.5 text-right font-semibold font-mono tabular-nums text-xs text-emerald-700">{total.remaining}</td>
                  <td className="px-3 py-2.5 text-[11px] text-[#6B7280]">
                    {total.effective > 0
                      ? `занято ${Math.min(100, Math.round((total.received / total.effective) * 100))}%`
                      : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Карточки (мобильные) — без горизонтального переполнения */}
          <div className="md:hidden flex flex-col gap-2.5">
            {rows.map((r) => {
              const s = r.stats;
              return (
                <div key={r.typeName} className="border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md">
                        {r.typeName}
                      </span>
                      <span className="text-[10px] text-[#6B7280] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-full">
                        {r.mode === 'annual' ? 'годовая, %' : 'квартальная, шт.'}
                      </span>
                    </div>
                    {s.needsVerification > 0 && (
                      <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                        <AlertTriangle className="w-3 h-3" />
                        {s.needsVerification}
                      </span>
                    )}
                  </div>

                  {r.mode === 'annual' ? (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] text-[#6B7280]">Годовая квота, %</span>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          disabled={!canEdit}
                          key={`map-${r.typeName}-${year}-${r.annualPercent}`}
                          defaultValue={r.annualPercent || ''}
                          onBlur={(e) => saveAnnualPercent(r.typeName, e.target.value, r.annualPercent)}
                          placeholder="—"
                          className={cellInput}
                        />
                      </div>
                      <div className="flex justify-between gap-3">
                        <span className="text-[11px] text-[#6B7280]">Квота в штуках</span>
                        <span className="text-xs font-semibold font-mono tabular-nums text-[#121316]">
                          {s.notConfigured ? '—' : `${s.quota} шт`}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {QUARTERS.map((q) => {
                        const num = toNonNegativeInt(quarterLimitsByQuarter[`${year}|${q}`]?.[r.typeName]);
                        return (
                          <div key={q} className="flex items-center justify-between gap-3">
                            <span className="text-[11px] text-[#6B7280]">
                              Квота {QUARTER_LABELS[q]}, шт.
                              {q === quarter && <span className="text-[var(--accent-ink)] ml-1">· текущий</span>}
                            </span>
                            <input
                              type="number"
                              min="0"
                              disabled={!canEdit}
                              key={`mq-${r.typeName}-${year}-${q}-${num}`}
                              defaultValue={num || ''}
                              onBlur={(e) => saveQuarterValue(r.typeName, q, e.target.value, num)}
                              placeholder="0"
                              className={cellInput}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => openReduction(r.typeName)}
                    disabled={!canEdit}
                    className="flex items-center justify-between gap-3 text-left cursor-pointer disabled:cursor-default"
                  >
                    <span className="text-[11px] text-[#6B7280]">Сокращение</span>
                    <span className="inline-flex items-center gap-1.5 font-mono tabular-nums text-xs text-rose-600">
                      {s.reduction > 0 ? `− ${s.reduction}` : 'не задано'}
                      {canEdit && <MinusCircle className="w-3 h-3" />}
                    </span>
                  </button>

                  <div className="flex flex-col gap-1 pt-2 border-t border-[#F3F4F6]">
                    {[
                      ['Эффективная квота', s.notConfigured ? '—' : `${s.effective} шт`, 'text-[#121316]'],
                      ['Получено в квартале', `${s.received} шт`, 'text-[#121316]'],
                      [
                        'Остаток',
                        s.remaining === null ? '—' : `${s.remaining} шт`,
                        s.remaining === 0 ? 'text-rose-600' : 'text-emerald-700',
                      ],
                    ].map(([label, value, cls]) => (
                      <div key={label} className="flex justify-between gap-3">
                        <span className="text-[11px] text-[#6B7280]">{label}</span>
                        <span className={`text-xs font-semibold font-mono tabular-nums ${cls}`}>{value}</span>
                      </div>
                    ))}
                  </div>

                  {s.fillPct !== null && (
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 bg-[#F3F4F6] rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${fillColor(s.fillPct)}`} style={{ width: `${s.fillPct}%` }} />
                      </div>
                      <span className={`text-[11px] font-semibold font-mono tabular-nums ${fillText(s.fillPct)}`}>
                        {s.fillPct}%
                      </span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Прозрачный расчёт */}
          <div className="flex flex-col gap-1.5 pt-3 border-t border-[#E5E7EB] text-[11px] text-[#6B7280]">
            <span className="flex items-center gap-1.5">
              <Info className="w-3 h-3 text-[#9CA3AF] shrink-0" />
              Учёт по дате фактического получения бланка · период {QUARTER_LABELS[quarter]} {year}: {periodCaption}
            </span>
            <span className="flex items-center gap-1.5">
              <Info className="w-3 h-3 text-[#9CA3AF] shrink-0" />
              Эффективная квота = max(0, квота − сокращение) · Остаток = max(0, эффективная − получено в квартале)
            </span>
            <span className="flex items-center gap-1.5">
              <Info className="w-3 h-3 text-[#9CA3AF] shrink-0" />
              Годовая квота — в процентах от штата за год; квартальная — в штуках на каждый квартал. Единицы не смешиваются
            </span>
            <span className="flex items-center gap-1.5">
              <Info className="w-3 h-3 text-[#9CA3AF] shrink-0" />
              Копии квоту не расходуют, аннулированные бланки полученными не считаются
              {missingReceiptDates > 0 && `; ${missingReceiptDates} бланк(ов) без даты получения — вне квартального подсчёта`}
            </span>
          </div>
        </>
      )}

      <ReductionDialog
        isOpen={!!reductionFor}
        typeName={reductionFor || ''}
        current={reductionRow?.reductionRec || null}
        quota={reductionRow?.stats.quota || 0}
        received={reductionRow?.stats.received || 0}
        canEdit={canEdit}
        onClose={() => setReductionFor(null)}
        onSave={applyReduction}
      />
    </div>
  );
}

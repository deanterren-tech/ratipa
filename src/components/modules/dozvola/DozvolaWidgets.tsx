import {useToast} from '../../ToastProvider'
import React, {useState, useEffect} from 'react'
import {X, Check, Truck, RotateCcw} from 'lucide-react'
import { useFirebase, database, onValue } from '../../../firebase'
import {
  currentQuarter,
  computeQuarterStats,
  computeYearStats,
  isReceivedIn,
  normalizeQuotaMode,
  quotaPaths,
  QuotaMode,
} from '../../../dozvolaQuota'
import { ref, set, push, update, remove } from 'firebase/database'
import { getCouplingsFlat } from '../../../services/fleetService'
import CouplingPicker from '../../common/CouplingPicker'

interface DozvolaWidgetsProps {
  stats: {
    total: number;
    office: number;
    hand: number;
    usedCount: number;
    expiredCount: number;
    copies: number;
    officeReturnCount: number;
  };
  currentSelectedTab: string;
  dozvolsData: any;
  knownFleetCars: any;
  quotaGlobalDriversCount: number;
  quotaTypesPercents: any;
  quotaQuarterLimits: any;
  typesDeadlineDays: any;
  resolvedLocations?: string[];
  customTypesOrder: any;
  customTypes: any;
}

export default function DozvolaWidgets(props: DozvolaWidgetsProps) {
  const {
    stats,
    currentSelectedTab,
    dozvolsData,
    knownFleetCars,
    quotaGlobalDriversCount,
    quotaTypesPercents,
    quotaQuarterLimits,
    typesDeadlineDays,
    resolvedLocations = [],
    customTypesOrder,
    customTypes,
  } = props;

  const { toast } = useToast();

  const [todoTasks, setTodoTasks] = useState<any>({});
  // Настройки текущего квартала — читаются напрямую, чтобы панель «Лимит выдачи»
  // и вкладка «Квоты и лимиты» считали одинаково
  const [quotaLimitsPeriod, setQuotaLimitsPeriod] = useState<any>({});
  const [quotaPeriodReductions, setQuotaPeriodReductions] = useState<any>({});
  const [quotaModes, setQuotaModes] = useState<any>({});
  const [quotaAnnualPercents, setQuotaAnnualPercents] = useState<any>({});
  const [originalNotes, setOriginalNotes] = useState<Record<string, string>>(
    {},
  );
  const [calcPrice, setCalcPrice] = useState(45);
  const [plannerCar, setPlannerCar] = useState("");
  /**
   * Стабильный идентификатор выбранного автомобиля (запись из общего справочника
   * сцепок — тот же источник, что у колонки «Авто / локация» реестра).
   * В заявке хранится вместе с подписью: подпись может измениться, id — нет.
   */
  const [plannerCarId, setPlannerCarId] = useState<string | null>(null);
  /** Справочник сцепок из общего источника — для проверки доступности автомобиля. */
  const [fleetSource, setFleetSource] = useState<any[]>([]);
  const [plannerQuantities, setPlannerQuantities] = useState<
    Record<string, number>
  >({});

  /** Итог по заявке в бланках — сумма количеств по всем видам. */
  const taskQty = (t: any): number =>
    Array.isArray(t?.items) ? t.items.reduce((s: number, i: any) => s + (Number(i?.qty) || 0), 0) : 0;

  // Единый источник автомобилей: та же функция, что использует CouplingPicker
  // в колонке «Авто / локация» основной таблицы дозволов.
  useEffect(() => {
    const unsub = getCouplingsFlat((list: any[]) => setFleetSource(list || []));
    return unsub;
  }, []);

  /** Доступна ли запись автомобиля в текущем справочнике. */
  const findFleetRecord = (id?: string | null) =>
    id ? fleetSource.find((rec) => String(rec?.id) === String(id)) : undefined;

  const logTaskAction = (car: string, action: string, meta: string) => {
    if (!useFirebase) return;
    const logist = localStorage.getItem("ratipa_auth_user") || "Система";
    push(ref(database, "dozvolsHistoryV4"), {
      time: new Date().toLocaleString("ru-RU"),
      logist,
      doc: `Заявка [${car}]`,
      action,
      meta,
    });
  };

  const handleNoteFocus = (id: string, val: string) => {
    setOriginalNotes((prev) => ({ ...prev, [id]: val }));
  };

  const handleNoteBlur = (id: string, car: string, val: string) => {
    const orig = originalNotes[id] !== undefined ? originalNotes[id] : "";
    const newVal = val.trim();
    if (orig === newVal) return;
    logTaskAction(
      car,
      "Изменена заметка заявки",
      `Заметка: [${orig || "—"}] → [${newVal || "—"}]`,
    );
    setOriginalNotes((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  useEffect(() => {
    if (!useFirebase) return;
    const now = new Date();
    const y = now.getFullYear();
    const q = currentQuarter(now);
    const unsub1 = onValue(ref(database, "dozvolsTodoTasksV4"), (snap) =>
      setTodoTasks(snap.val() || {}),
    );
    const unsub2 = onValue(ref(database, quotaPaths.limits(y, q)), (snap) =>
      setQuotaLimitsPeriod(snap.val() || {}),
    );
    const unsubModes = onValue(ref(database, quotaPaths.modeAll()), (snap) =>
      setQuotaModes(snap.val() || {}),
    );
    const unsubAnnual = onValue(ref(database, quotaPaths.annualPercents(y)), (snap) =>
      setQuotaAnnualPercents(snap.val() || {}),
    );
    const unsub3 = onValue(ref(database, quotaPaths.reductions(y, q)), (snap) =>
      setQuotaPeriodReductions(snap.val() || {}),
    );
    return () => { unsub1(); unsub2(); unsub3(); unsubModes(); unsubAnnual(); };
  }, []);

  const isRusType = (typeName: string) =>
    String(typeName || "")
      .trim()
      .toUpperCase() === "RUS";

  // Единая система расчёта: квота считается по текущему кварталу
  // (см. src/dozvolaQuota.ts) — те же формулы, что и во вкладке «Квоты и лимиты».
  const getPermitQuotaInfo = (typeName: string) => {
    const now = new Date();
    const y = now.getFullYear();
    const q = currentQuarter(now);

    const permits = Object.values(dozvolsData).filter((i: any) => i.type === typeName);
    // Режим задаёт и формулу, и единицу измерения — проценты и штуки не смешиваются
    const mode: QuotaMode = normalizeQuotaMode(quotaModes[typeName]);
    const annualPercent =
      quotaAnnualPercents[typeName] !== undefined && quotaAnnualPercents[typeName] !== null
        ? Number(quotaAnnualPercents[typeName]) || 0
        : Number(quotaTypesPercents[typeName]) || 0;

    const configured = quotaLimitsPeriod[typeName];
    const fallback = quotaQuarterLimits[typeName];
    const quotaRaw = configured !== undefined && configured !== null ? configured : fallback;

    const quarterStats = computeQuarterStats(
      permits,
      y,
      q,
      quotaRaw,
      quotaPeriodReductions[typeName]?.amount,
    );
    const yearStats = computeYearStats(permits, y, annualPercent, quotaGlobalDriversCount || 0);

    const stats = mode === 'annual'
      ? {
          quota: yearStats.quota,
          reduction: 0,
          effective: yearStats.quota,
          received: yearStats.received,
          remaining: yearStats.remaining,
          notConfigured: yearStats.notConfigured,
          fillPct: yearStats.fillPct,
          needsVerification: yearStats.needsVerification,
        }
      : quarterStats;

    const usedCount = permits.filter(
      (i: any) => i.status === 'office_return' && isReceivedIn(i, y, q),
    ).length;

    const unlimited = stats.notConfigured;
    const inWork = Math.max(0, stats.received - usedCount);

    return {
      percent: Number(quotaTypesPercents[typeName]) || 0,
      quarterLabel: `Q${q} ${y}`,
      limit: stats.effective,
      received: stats.received,
      used: usedCount,
      inWork,
      remaining: unlimited ? 999999 : (stats.remaining ?? 0),
      unlimited,
      reduction: stats.reduction,
      needsVerification: stats.needsVerification,
    };
  };

  const handleSaveGlobalDrivers = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (useFirebase)
      set(
        ref(database, "quotaGlobalDriversCount"),
        parseInt(e.target.value) || 0,
      );
  };

  const handleSaveTypeQuotaPercent = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (useFirebase)
      set(
        ref(database, `quotaTypesPercents/${currentSelectedTab}`),
        parseFloat(e.target.value) || 0,
      );
  };

  const handleSaveTypeQuarterQuota = (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    if (useFirebase)
      set(
        ref(database, quotaPaths.limitForType(new Date().getFullYear(), currentQuarter(new Date()), currentSelectedTab)),
        parseInt(e.target.value) || 0,
      );
  };

  const handleSaveDeadlineDays = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (useFirebase)
      set(
        ref(database, `typesDeadlineDaysV1/${currentSelectedTab}`),
        parseInt(e.target.value) || 0,
      );
  };

  const plannerTypes = customTypesOrder
    .map((id: string) => customTypes[id]?.name)
    .filter(Boolean);

  const calcPlannerCost = () => {
    const entries = Object.entries(plannerQuantities) as [string, number][];
    const totalQty = entries.reduce((sum, [, qty]) => sum + qty, 0);
    const totalCost = totalQty * calcPrice;
    const overLimit = entries.filter(([typeName, qty]) => {
      const info = getPermitQuotaInfo(typeName);
      return !info.unlimited && qty > info.remaining;
    });
    return { totalQty, totalCost, overLimit };
  };

  const plannerSummary = calcPlannerCost();

  const handleAddTodoTask = () => {
    // Заявка планёрки привязана к машине. Поля «Локация» в планёрке нет,
    // поэтому location не пишется и не требуется для сохранения.
    const car = plannerCar.trim().toUpperCase() || "БЕЗ АВТО";
    const entries = Object.entries(plannerQuantities) as [string, number][];
    if (!entries.length)
      return toast("Укажите количество хотя бы по одному виду разрешений.", 'info');

    const items = entries.map(([typeName, qty]) => ({
      type: typeName,
      qty,
      quota: getPermitQuotaInfo(typeName),
    }));
    const text = `${car}: ${items.map((i) => `${i.type} × ${i.qty}`).join(", ")}`;

    if (useFirebase) {
      const k = push(ref(database, "dozvolsTodoTasksV4")).key;
      if (k) {
        set(ref(database, `dozvolsTodoTasksV4/${k}`), {
          id: k,
          car,
          // Стабильный идентификатор автомобиля из общего справочника
          carId: plannerCarId,
          items,
          price: calcPrice,
          totalQty: plannerSummary.totalQty,
          totalCost: Math.round(plannerSummary.totalCost),
          text,
          note: "",
          done: false,
          createdAt: new Date().toLocaleString("ru-RU"),
        });
        logTaskAction(
          car,
          "Добавлена заявка",
          `На бланки: ${items.map((i) => `${i.type} × ${i.qty}`).join(", ")}`,
        );
      }
    }
    setPlannerQuantities({});
    setPlannerCar("");
    setPlannerCarId(null);
  };

  const isGlobalTab =
    currentSelectedTab === "all" ||
    currentSelectedTab === "archive" ||
    currentSelectedTab === "office_returns" ||
    currentSelectedTab === "expiring";

  // Deadline calculation
  const configuredDays = typesDeadlineDays[currentSelectedTab] || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const criticalItems: any[] = [];
  if (!isGlobalTab && configuredDays > 0) {
    Object.values(dozvolsData)
      .filter((i: any) => i.type === currentSelectedTab && i.status === "hand" && !i.isCopy)
      .forEach((item: any) => {
        if (!item.issueDate) return;
        const issue = new Date(item.issueDate);
        if (isNaN(issue.getTime())) return;
        const deadlineDate = new Date(
          issue.getTime() + configuredDays * 24 * 60 * 60 * 1000,
        );
        deadlineDate.setHours(0, 0, 0, 0);
        const timeDiff = deadlineDate.getTime() - today.getTime();
        const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
        if (daysLeft <= 30) criticalItems.push({ ...item, daysLeft });
      });
  }

  const activeTasks = (Object.values(todoTasks) as any[]).filter(
    (t: any) => !t.done && Array.isArray(t.items),
  );
  const totalPlannerReqCost = activeTasks.reduce(
    (sum: number, t: any) => sum + (Number(t.totalCost) || 0),
    0,
  ) as number;
  const totalPlannerReqQty = activeTasks.reduce(
    (sum: number, t: any) => sum + (Number(t.totalQty) || 0),
    0,
  ) as number;
  const carsCount = new Set(activeTasks.map((t: any) => t.car).filter(Boolean))
    .size;

  return (
    <div className="space-y-4">
 <div className="flex flex-col gap-3 pb-4 border-b border-[#E5E7EB] last:border-0 last:pb-0">
        <div className="flex justify-between items-center pb-2 border-b border-[#E5E7EB]">
          <span className="text-xs font-medium text-[#4B5563]">Всего бланков</span>
          <span className="text-sm font-semibold font-mono tabular-nums text-[#121316]">{stats.total} шт</span>
        </div>
        {currentSelectedTab === "archive" ? (
          <>
            <div className="flex justify-between items-center gap-3">
              <span className="text-xs text-[#4B5563] flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="truncate">Сдано в инспекцию</span>
              </span>
              <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0">{stats.usedCount} шт</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-xs text-[#4B5563] flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                <span className="truncate">Аннулировано</span>
              </span>
              <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0">{stats.expiredCount} шт</span>
            </div>
          </>
        ) : currentSelectedTab === "office_returns" ? (
          <div className="flex justify-between items-center gap-3">
              <span className="text-xs text-[#4B5563] flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="truncate">Ожидают сдачи в инспекцию</span>
              </span>
              <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0">{stats.officeReturnCount} шт</span>
            </div>
        ) : (
          <>
            <div className="flex justify-between items-center gap-3">
              <span className="text-xs text-[#4B5563] flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                <span className="truncate">В офисе (чистые)</span>
              </span>
              <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0">{stats.office} шт</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-xs text-[#4B5563] flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 shrink-0" />
                <span className="truncate">На руках у машин (в рейсе)</span>
              </span>
              <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0">{stats.hand - stats.officeReturnCount} шт</span>
            </div>
            <div className="flex justify-between items-center gap-3">
              <span className="text-xs text-[#4B5563] flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
                <span className="truncate">Сдан в офис</span>
              </span>
              <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0">{stats.officeReturnCount} шт</span>
            </div>
            <div className="flex justify-between items-center text-sm font-semibold text-[#374151] bg-[#F9FAFB] border border-[#E5E7EB] px-2 py-1.5 rounded-xl mt-1 mb-2">
              <span>Всего полученных:</span>
              <span className="font-semibold font-mono tabular-nums">{stats.office + stats.hand} шт</span>
            </div>

            {(currentSelectedTab === "all" ||
              currentSelectedTab === "CHN 2" ||
              currentSelectedTab === "CHN 3") && (
              <div className="flex justify-between items-center gap-3">
              <span className="text-xs text-[#4B5563] flex items-center gap-2 min-w-0">
                <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] shrink-0" />
                <span className="truncate">Сдана копия (считается сданным)</span>
              </span>
              <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0">{stats.copies} шт</span>
            </div>
            )}

            {!isGlobalTab && (
              <div className="flex justify-between items-center text-sm font-semibold text-emerald-700 bg-[#F9FAFB] border border-[#E5E7EB] px-2.5 py-1.5 rounded-xl mt-1">
                <span>Можно получить еще:</span>
                <span className="font-semibold font-mono tabular-nums">
                  {getPermitQuotaInfo(currentSelectedTab).unlimited
                    ? "без лимита"
                    : getPermitQuotaInfo(currentSelectedTab).remaining + " шт"}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {!isGlobalTab && (
 <div className="flex flex-col gap-3 pb-4 border-b border-[#E5E7EB] last:border-0 last:pb-0">
          <div className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none border-b border-[#E5E7EB] pb-2 mb-1">
            Лимит выдачи: {currentSelectedTab}
            <span className="ml-2 text-[10px] font-normal normal-case text-[#6B7280]">
              {normalizeQuotaMode(quotaModes[currentSelectedTab]) === 'annual' ? 'годовая квота, % от штата' : 'квартальная квота, шт.'}
            </span>
            <span className="ml-2 text-[10px] font-mono normal-case text-[#9CA3AF]">
              {getPermitQuotaInfo(currentSelectedTab).quarterLabel}
            </span>
          </div>
          <div className="flex flex-col gap-2.5 mt-1">
            <div>
              <label className="text-[11px] font-medium text-[#6B7280] mb-1 block">
                Всего водителей в штате (общий):
              </label>
              <input
                type="number"
                value={quotaGlobalDriversCount || ""}
                onChange={handleSaveGlobalDrivers}
                className="w-full px-3.5 py-2 bg-white border border-[#E5E7EB] rounded-xl text-xs focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                placeholder="Кол-во водителей"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#6B7280] mb-1 block">
                Целевой процент выдачи (%):
              </label>
              <input
                type="number"
                value={quotaTypesPercents[currentSelectedTab] || ""}
                onChange={handleSaveTypeQuotaPercent}
                className="w-full px-3.5 py-2 bg-white border border-[#E5E7EB] rounded-xl text-xs focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                placeholder="Процент"
              />
            </div>
            <div>
              <label className="text-[11px] font-medium text-[#6B7280] mb-1 block">
                Квартальная квота (шт.):
              </label>
              <span className="text-[10px] text-[#9CA3AF] block mb-1">
                Период: {getPermitQuotaInfo(currentSelectedTab).quarterLabel} · отдельная квота на каждый квартал — во вкладке «Квоты и лимиты»
              </span>
              <input
                type="number"
                value={quotaQuarterLimits[currentSelectedTab] || ""}
                onChange={handleSaveTypeQuarterQuota}
                className="w-full px-3.5 py-2 bg-white border border-[#E5E7EB] rounded-xl text-xs focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                placeholder="Квартальная квота"
              />
            </div>
            <div className="bg-[#F9FAFB] p-3 rounded-xl border border-[#E5E7EB] text-xs font-semibold leading-relaxed mt-2">
              <div className="flex justify-between mb-1">
                <span>Лимит квоты:</span>
                <span className="font-semibold font-mono tabular-nums text-[var(--accent-ink)]">
                  {getPermitQuotaInfo(currentSelectedTab).limit} шт.
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span>Всего получено:</span>
                <span className="font-semibold font-mono tabular-nums text-[#121316]">
                  {getPermitQuotaInfo(currentSelectedTab).received} шт.
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span>Из них использовано (сдано):</span>
                <span className="font-semibold text-amber-600">
                  {getPermitQuotaInfo(currentSelectedTab).used} шт.
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span>В работе:</span>
                <span className="font-semibold text-blue-600">
                  {getPermitQuotaInfo(currentSelectedTab).inWork} шт.
                </span>
              </div>
              <div className="flex justify-between text-emerald-700 bg-emerald-50/50 px-2 py-1.5 rounded-xl font-semibold">
                <span>Можно получить еще:</span>
                <span className="font-semibold font-mono tabular-nums">
                  {getPermitQuotaInfo(currentSelectedTab).unlimited
                    ? "без лимита"
                    : getPermitQuotaInfo(currentSelectedTab).remaining + " шт"}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {!isGlobalTab && (
 <div className="flex flex-col gap-3 pb-4 border-b border-[#E5E7EB] last:border-0 last:pb-0">
          <div className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none border-b border-[#E5E7EB] pb-2 mb-1">
            Сроки сдачи: {currentSelectedTab}
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#6B7280] mb-1 block">
              Срок сдачи от даты выдачи (дней):
            </label>
            <input
              type="number"
              value={configuredDays || ""}
              onChange={handleSaveDeadlineDays}
              className="w-full px-3.5 py-2 bg-white border border-[#E5E7EB] rounded-xl text-xs focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
              placeholder="Напр. 60"
            />
          </div>
          <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 text-xs mt-1 max-h-48 overflow-y-auto custom-scrollbar">
            {!configuredDays ? (
              <div className="text-[#9CA3AF] italic text-center text-[10px]">
                Задайте нормативный срок в днях
              </div>
            ) : criticalItems.length === 0 ? (
              <div className="text-emerald-600 text-center text-[10px]">
                Все бланки в пределах нормы!
              </div>
            ) : (
              <div>
                <div className="text-[11px] font-semibold text-rose-600 tracking-wider uppercase mb-2">
                  Подходят сроки или просрочены ({criticalItems.length}):
                </div>
                {criticalItems.map((c, i) => (
                  <div
                     key={i}
                     className="flex justify-between items-center py-1.5 border-b border-[#E5E7EB] border-dashed last:border-0 text-[11px]"
                  >
                    <span className="font-mono font-semibold text-[#374151] text-[#121316]">
                      №{c.number}
                    </span>
                    <span>
                      {c.daysLeft < 0 ? (
                        <span className="text-rose-500 font-semibold">
                          просрочен на {Math.abs(c.daysLeft)} дн.
                        </span>
                      ) : c.daysLeft === 0 ? (
                        <span className="text-amber-500 font-semibold">
                          сдача СЕГОДНЯ!
                        </span>
                      ) : (
                        <span className="text-[#6B7280]">
                          осталось: {c.daysLeft} дн.
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 30 Days Copy Original tracking control */}
      {(() => {
        const todayVal = new Date();
        todayVal.setHours(0, 0, 0, 0);
        const copyTrackingItems: any[] = [];
        Object.values(dozvolsData).forEach((item: any) => {
          if (
            item.isCopy &&
            item.status !== "used" &&
            item.status !== "expired"
          ) {
            const baseDateStr =
              item.copySubmittedAt ||
              item.issueDate ||
              new Date().toISOString().split("T")[0];
            const baseDate = new Date(baseDateStr);
            const targetDate = new Date(
              baseDate.getTime() + 30 * 24 * 60 * 60 * 1000,
            );
            targetDate.setHours(0, 0, 0, 0);

            const timeDiff = targetDate.getTime() - todayVal.getTime();
            const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
            copyTrackingItems.push({ ...item, daysLeft });
          }
        });

        if (copyTrackingItems.length === 0) return null;

        // Sort so most urgent ones are first
        copyTrackingItems.sort((a, b) => a.daysLeft - b.daysLeft);

        return (
 <div className="flex flex-col gap-3 pb-4 border-b border-[#E5E7EB] last:border-0 last:pb-0">
            <div className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none border-b border-[#E5E7EB] pb-2 mb-1">
              Контроль оригиналов (30 дней)
            </div>
            <div className="text-[10px] text-[#6B7280] italic font-semibold -mt-1 leading-normal">
              По китайским дозволам разница между сдачей копии и сдачей
              оригинала не должна превышать 30 дней.
            </div>
            <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-3 text-xs max-h-56 overflow-y-auto custom-scrollbar space-y-2">
              {copyTrackingItems.map((c, idx) => (
                <div
                  key={idx}
                  className="flex flex-col py-2 border-b border-[#E5E7EB] border-dashed last:border-0 last:pb-0"
                >
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-mono font-semibold text-[#121316]">
                      № {c.number}{" "}
                      <span className="text-[10px] bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB] px-2 py-0.5 rounded-full font-medium">
                        {c.type}
                      </span>
                    </span>
                    <span>
                      {c.daysLeft < 0 ? (
                        <span className="text-rose-700 font-semibold text-[10px] bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                          просрочен на {Math.abs(c.daysLeft)} дн.!
                        </span>
                      ) : c.daysLeft === 0 ? (
                        <span className="text-amber-700 font-semibold text-[10px] bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                          Сдача сегодня!
                        </span>
                      ) : (
                        <span className="text-[#4B5563] font-semibold bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-full text-[10px]">
                          осталось: {c.daysLeft} дн.
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center gap-2 mt-1 text-[10px] text-[#6B7280]">
                    {/* Сцепка вида «AO 8807-7 / A7347A7» — обычный вспомогательный
                        текст: моно-начертание снято, полное значение в подсказке. */}
                    <span className="truncate min-w-0" title={c.car || 'не привязано'}>
                      Авто: {c.car || "не привязано"}
                    </span>
                    <span className="shrink-0 font-mono">
                      Сдана:{" "}
                      {c.copySubmittedAt
                        ? new Date(c.copySubmittedAt).toLocaleDateString("ru-RU").replace(/\./g, '/')
                        : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

 <div className="flex flex-col gap-4 pb-4 border-b border-[#E5E7EB] last:border-0 last:pb-0">
        <div className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none border-b border-[#E5E7EB] pb-2">
          Планёрка
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 w-full">
          {/* Машина — основное поле заявки планёрки: по ней считаются итоги
              и группируются заявки. Поля «Локация» в планёрке нет. */}
          <div className="xl:col-span-2">
            <label htmlFor="planner-car" className="text-[11px] font-medium text-[#6B7280] mb-1 block">
              Машина
            </label>
            {/* Тот же выбор автомобиля, что в колонке «Авто / локация» реестра:
                общий компонент и общий справочник сцепок, поэтому подписи,
                идентификаторы и правила совпадают. Локация в планёрке не выбирается. */}
            <CouplingPicker
              value={plannerCarId || plannerCar}
              mode="coupling"
              placeholder="Автомобиль из справочника"
              onSelect={(rec) => {
                if (!rec) { setPlannerCar(""); setPlannerCarId(null); return; }
                const label = String(rec.carNumber || rec.vehicleNumbers || '').toUpperCase();
                const trail = String(rec.trailerNumber || '').toUpperCase();
                setPlannerCar([label, trail].filter(Boolean).join(' / '));
                setPlannerCarId(rec.id ? String(rec.id) : null);
              }}
            />
            <span className="text-[10px] text-[#9CA3AF] mt-1 block truncate">
              {plannerCar
                ? (plannerCarId ? `Выбрано: ${plannerCar}` : `Выбрано: ${plannerCar} — запись не найдена в справочнике`)
                : 'Не выбрано'}
            </span>
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#6B7280] mb-1 block">
              Цена (BYN)
            </label>
            <input
              type="number"
              value={calcPrice || ""}
              onChange={(e) => setCalcPrice(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <span className="text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none">
            Выбор активных заявок
          </span>
          <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto custom-scrollbar pr-1">
          {plannerTypes.map((typeName) => {
            const info = getPermitQuotaInfo(typeName as string);
            const picked = (plannerQuantities[typeName as string] || 0) > 0;
            const over = !info.unlimited && picked && (plannerQuantities[typeName as string] || 0) > info.remaining;
            return (
              <div
                key={typeName}
                className={`flex items-center justify-between gap-3 border p-2.5 rounded-xl transition-colors ${
                  over
                    ? 'bg-rose-50 border-rose-200'
                    : picked
                      ? 'bg-[var(--accent-10)] border-[var(--accent-25)]'
                      : 'bg-white border-[#E5E7EB] hover:border-[#D1D5DB]'
                }`}
              >
                <div className="flex w-full min-w-0 flex-col">
                  <div className="flex items-center gap-2 flex-wrap mb-0.5">
                    <span className="font-semibold text-[#121316] text-xs">{typeName}</span>
                    {picked && (
                      <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border whitespace-nowrap ${
                        over
                          ? 'bg-rose-100 text-rose-700 border-rose-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}>
                        {over ? 'перебор квоты' : 'выбрано'}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[#6B7280] truncate">
                    {info.unlimited ? 'Квота не ограничена' : `Квота: ${info.limit}`}
                    {' · '}получено: {info.received} · в работе: {info.inWork} · использовано: {info.used}
                  </span>
                </div>
                <input
                  type="number"
                  className="w-[64px] text-center px-1 py-1 bg-white border border-[#E5E7EB] rounded-lg text-xs font-mono focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                  placeholder="0"
                  min="0"
                  value={plannerQuantities[typeName as string] || ""}
                  onChange={(e) =>
                    setPlannerQuantities({
                      ...plannerQuantities,
                      [typeName as string]: parseInt(e.target.value) || 0,
                    })
                  }
                />
              </div>
            );
          })}
          </div>
        </div>

        <div
          className={`p-3 rounded-xl border text-xs font-semibold leading-relaxed ${plannerSummary.overLimit.length ? "bg-rose-50 border-rose-200 text-rose-700" : plannerSummary.totalQty > 0 ? "bg-[var(--accent-15)] border-[var(--accent-25)] text-[var(--accent-ink)]" : "bg-[#F9FAFB] border-[#E5E7EB] text-[#6B7280]"}`}
        >
          {plannerSummary.totalQty > 0 ? (
            <>
              <div className="flex justify-between mb-1">
                <span className="font-normal">Итого бланков</span>
                <span className="font-semibold font-mono tabular-nums">{plannerSummary.totalQty} шт.</span>
              </div>
              <div className="flex justify-between">
                <span className="font-normal">Стоимость</span>
                <span className="font-semibold font-mono tabular-nums">{Math.round(plannerSummary.totalCost)} BYN</span>
              </div>
              <div className="my-2 h-px bg-current opacity-20" />
              {(Object.entries(plannerQuantities) as [string, number][]).map(
                ([t, q]) =>
                  q > 0 && (
                    <div
                      key={t}
                      className="flex justify-between text-[10px] opacity-80"
                    >
                      <span>
                        {t} × {q}
                      </span>
                      <span>
                        {getPermitQuotaInfo(t).unlimited
                          ? "без лимита"
                          : `доступно ${getPermitQuotaInfo(t).remaining}`}
                      </span>
                    </div>
                  ),
              )}
              {plannerSummary.overLimit.length > 0 && (
                <div className="mt-2 pt-2 border-t border-rose-200/50 text-[10px] font-semibold">
                  Перебор квоты:{" "}
                  {plannerSummary.overLimit
                    .map(
                      ([t, q]) =>
                        `${t} (нужно ${q}, доступно ${getPermitQuotaInfo(t).remaining})`,
                    )
                    .join("; ")}
                </div>
              )}
            </>
          ) : (
            "Выберите машину и укажите количество нужных разрешений."
          )}
        </div>

        <button
          onClick={handleAddTodoTask}
          className="w-full mt-1 px-4 py-2.5 bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] font-medium rounded-xl text-xs transition-colors shadow-xs cursor-pointer"
        >
          Добавить заявку в планерку
        </button>

        <div className="max-h-72 overflow-y-auto custom-scrollbar mt-2 border-t border-[#E5E7EB] pt-3 flex flex-col gap-2">
          {Object.values(todoTasks).length === 0 && (
            <p className="text-[11px] text-[#9CA3AF] py-2">
              Заявок пока нет. Укажите машину и количество разрешений, затем добавьте заявку.
            </p>
          )}
          {(Object.values(todoTasks) as any[]).map((t: any) => {
            const qty = taskQty(t);
            const items: any[] = Array.isArray(t.items) ? t.items : [];
            const shown = items.slice(0, 4);
            const restQty = items.slice(4).reduce((s, i) => s + (Number(i?.qty) || 0), 0);
            const toggleDone = () => {
              if (!useFirebase) return;
              const nextDone = !t.done;
              update(ref(database, `dozvolsTodoTasksV4/${t.id}`), { done: nextDone });
              logTaskAction(
                t.car,
                nextDone ? "Заявка выполнена" : "Заявка возобновлена",
                `Сумма: ${t.totalCost} BYN, примечание: ${t.note || "—"}`,
              );
            };
            return (
              <div
                key={t.id}
                className={`rounded-xl border transition-colors ${
                  t.done ? 'bg-[#F9FAFB] border-[#E5E7EB]' : 'bg-white border-[#E5E7EB] hover:border-[#D1D5DB]'
                }`}
              >
                {/* Шапка: транспорт, состояние и итог по заявке */}
                <div className="flex items-start justify-between gap-3 px-3 pt-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Truck className={`w-3.5 h-3.5 shrink-0 ${t.done ? 'text-[#9CA3AF]' : 'text-[#6B7280]'}`} aria-hidden="true" />
                      {/* Номер авто — вспомогательный текст, не крупнее статуса и заголовка карточки. */}
                      <span
                        className={`text-[11px] font-medium truncate ${t.done ? 'text-[#9CA3AF]' : 'text-[#4B5563]'}`}
                        title={t.car || 'Без машины'}
                      >
                        {t.car || 'Без машины'}
                      </span>
                      <span
                        className={`text-[10px] font-medium px-2 py-0.5 rounded-full border whitespace-nowrap shrink-0 ${
                          t.done
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : 'bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]'
                        }`}
                      >
                        {t.done ? 'Выполнена' : 'В работе'}
                      </span>
                      {/* Автомобиль из справочника мог быть удалён или переименован:
                          подпись не подменяем, но честно сообщаем об этом. */}
                      {t.carId && !findFleetRecord(t.carId) && fleetSource.length > 0 && (
                        <span
                          className="text-[10px] font-medium px-2 py-0.5 rounded-full border bg-amber-50 text-amber-700 border-amber-200 whitespace-nowrap shrink-0"
                          title="Запись этого автомобиля больше не найдена в справочнике «Авто / локация»"
                        >
                          Нет в справочнике
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="text-xs font-semibold font-mono tabular-nums text-[#121316] shrink-0 text-right">
                    {qty}
                    <span className="block text-[10px] font-normal text-[#9CA3AF]">шт</span>
                  </span>
                </div>

                {/* Планируемые виды дозволов */}
                <div className="px-3 pt-2.5">
                  {items.length === 0 ? (
                    <span className="text-[11px] text-[#9CA3AF]">Виды дозволов не указаны</span>
                  ) : (
                    <div className="flex flex-wrap items-center gap-1.5">
                      {shown.map((i: any, idx: number) => (
                        <span
                          key={idx}
                          className="inline-flex items-center gap-1 bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-lg text-[10px] font-medium text-[#4B5563] whitespace-nowrap"
                        >
                          {i.type}
                          <span className="font-mono tabular-nums text-[#121316]">{i.qty}</span>
                        </span>
                      ))}
                      {items.length > shown.length && (
                        <span
                          className="text-[10px] text-[#6B7280] whitespace-nowrap"
                          title={items.slice(4).map((i: any) => `${i.type} × ${i.qty}`).join(', ')}
                        >
                          +{items.length - shown.length} вида ({restQty} шт)
                        </span>
                      )}
                      <span className="text-[10px] text-[#9CA3AF] whitespace-nowrap">
                        всего {items.length} видов
                      </span>
                    </div>
                  )}
                </div>

                {/* Заметка к заявке */}
                <div className="px-3 pt-2.5">
                  <input
                    className="w-full h-8 bg-white border border-[#E5E7EB] rounded-lg px-2.5 text-[11px] text-[#4B5563] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition-colors"
                    value={t.note || ""}
                    title={t.note || ""}
                    placeholder="Заметка к заявке..."
                    onChange={(e) =>
                      useFirebase &&
                      update(ref(database, `dozvolsTodoTasksV4/${t.id}`), {
                        note: e.target.value,
                      })
                    }
                    onFocus={(e) => handleNoteFocus(t.id, e.target.value)}
                    onBlur={(e) => handleNoteBlur(t.id, t.car, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                  />
                </div>

                {/* Итог и действия */}
                <div className="flex items-center justify-between gap-2 px-3 py-2.5 mt-1 border-t border-[#F3F4F6]">
                  <span className="text-[10px] text-[#9CA3AF] truncate">
                    {t.createdAt || '—'}
                    <span className="mx-1.5">·</span>
                    <span className="font-mono tabular-nums text-[#4B5563]">{t.totalCost} BYN</span>
                  </span>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={toggleDone}
                      className={`h-7 px-2 inline-flex items-center gap-1 rounded-lg border text-[10px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        t.done
                          ? 'bg-white text-[#4B5563] border-[#E5E7EB] hover:bg-[#F3F4F6]'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                      }`}
                      title={t.done ? 'Вернуть заявку в работу' : 'Отметить заявку выполненной'}
                    >
                      {t.done ? <RotateCcw className="w-3 h-3" /> : <Check className="w-3 h-3" />}
                      {t.done ? 'Возобновить' : 'Готово'}
                    </button>
                    <button
                      type="button"
                      className="h-7 w-7 inline-flex items-center justify-center rounded-lg bg-white text-rose-500 border border-[#E5E7EB] hover:bg-rose-50 hover:border-rose-200 transition-colors cursor-pointer shrink-0"
                      title="Удалить заявку"
                      onClick={() => {
                        if (useFirebase) {
                          remove(ref(database, `dozvolsTodoTasksV4/${t.id}`));
                          logTaskAction(t.car, "Удалена заявка", `Снята с планерки`);
                        }
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="pt-4 border-t border-[#E5E7EB]">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <div className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none mb-1">
                Общая необходимая сумма
              </div>
              <div className={`text-2xl font-semibold font-mono tabular-nums ${activeTasks.length ? 'text-[#121316]' : 'text-[#9CA3AF]'}`}>
                {Math.round(totalPlannerReqCost as number).toLocaleString("ru-RU")}
                <span className="text-sm font-medium text-[#6B7280] ml-1.5">BYN</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
              {[
                { label: 'Бланков', value: totalPlannerReqQty, accent: false },
                { label: 'Заявок', value: activeTasks.length, accent: false },
                { label: 'Машин', value: carsCount, accent: true },
              ].map((m) => (
                <div key={m.label} className="flex items-center gap-2">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${m.accent ? 'bg-[var(--accent-ui)]' : 'bg-[#9CA3AF]'}`} />
                  <span className="text-[11px] text-[#6B7280]">{m.label}</span>
                  <span className="text-sm font-semibold font-mono tabular-nums text-[#121316]">{m.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
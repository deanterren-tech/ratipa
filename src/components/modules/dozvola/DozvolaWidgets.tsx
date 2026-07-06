import React, { useState, useEffect } from "react";
import { useFirebase, database } from "../../../firebase";
import { ref, onValue, set, push, update, remove } from "firebase/database";

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
    customTypesOrder,
    customTypes,
  } = props;

  const [todoTasks, setTodoTasks] = useState<any>({});
  const [originalNotes, setOriginalNotes] = useState<Record<string, string>>(
    {},
  );
  const [calcPrice, setCalcPrice] = useState(45);
  const [plannerCar, setPlannerCar] = useState("");
  const [plannerQuantities, setPlannerQuantities] = useState<
    Record<string, number>
  >({});

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
      `Заметка: [${orig || "—"}] ➔ [${newVal || "—"}]`,
    );
    setOriginalNotes((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  useEffect(() => {
    if (!useFirebase) return;
    const unsub = onValue(ref(database, "dozvolsTodoTasksV4"), (snap) =>
      setTodoTasks(snap.val() || {}),
    );
    return () => unsub();
  }, []);

  const isRusType = (typeName: string) =>
    String(typeName || "")
      .trim()
      .toUpperCase() === "RUS";

  const getPermitQuotaInfo = (typeName: string) => {
    const currentPercent = quotaTypesPercents[typeName] || 0;
    const percentLimit = Math.round(
      (quotaGlobalDriversCount * currentPercent) / 100,
    );
    const quarterLimit = parseInt(quotaQuarterLimits[typeName]) || 0;
    const useQuarter = quarterLimit > 0;
    const calculatedLimit = useQuarter ? quarterLimit : percentLimit;

    let receivedCount = 0;
    let inTripCount = 0;

    const now = new Date();
    const quarter = Math.floor(now.getMonth() / 3);
    const start = new Date(now.getFullYear(), quarter * 3, 1).getTime();
    const end = new Date(
      now.getFullYear(),
      quarter * 3 + 3,
      0,
      23,
      59,
      59,
      999,
    ).getTime();

    Object.values(dozvolsData).forEach((i: any) => {
      if (i.type === typeName) {
        if (!i.isCopy && (i.status === "hand" || i.status === "office_return"))
          inTripCount++;
        if (i.status !== "used" && i.status !== "expired" && !i.isCopy) {
          if (useQuarter) {
            const date = i.issueDate ? new Date(i.issueDate).getTime() : 0;
            if (date >= start && date <= end) receivedCount++;
          } else {
            receivedCount++;
          }
        }
      }
    });

    const unlimited = calculatedLimit <= 0;
    return {
      percent: currentPercent,
      quarterLabel: useQuarter
        ? `${quarter + 1} квартал ${now.getFullYear()}`
        : "",
      limit: calculatedLimit,
      received: receivedCount,
      inTrip: inTripCount,
      remaining: unlimited
        ? 999999
        : Math.max(0, calculatedLimit - receivedCount),
      unlimited,
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
        ref(database, `quotaTypesQuarterLimits/${currentSelectedTab}`),
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
    const car = plannerCar.trim().toUpperCase() || "БЕЗ АВТО";
    const entries = Object.entries(plannerQuantities) as [string, number][];
    if (!entries.length)
      return alert("Укажите количество хотя бы по одному виду разрешений.");

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
  };

  const isGlobalTab =
    currentSelectedTab === "all" ||
    currentSelectedTab === "archive" ||
    currentSelectedTab === "office_returns";

  // Deadline calculation
  const configuredDays = typesDeadlineDays[currentSelectedTab] || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const criticalItems: any[] = [];
  if (!isGlobalTab && configuredDays > 0) {
    Object.values(dozvolsData)
      .filter((i: any) => i.type === currentSelectedTab && i.status === "hand")
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

  const activeTasks = Object.values(todoTasks).filter(
    (t: any) => !t.done && Array.isArray(t.items),
  );
  const totalPlannerReqCost = activeTasks.reduce(
    (sum: number, t: any) => sum + (Number(t.totalCost) || 0),
    0,
  );
  const totalPlannerReqQty = activeTasks.reduce(
    (sum: number, t: any) => sum + (Number(t.totalQty) || 0),
    0,
  );
  const carsCount = new Set(activeTasks.map((t: any) => t.car).filter(Boolean))
    .size;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-3">
        <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest font-mono border-b border-slate-100 pb-2 mb-1">
          📊 Статистика по вкладке
        </div>
        <div className="text-[11px] uppercase text-slate-500 font-bold -mb-1">
          Раздел: {isGlobalTab ? currentSelectedTab : currentSelectedTab}
        </div>
        <div className="flex justify-between items-center text-sm font-bold text-slate-700 border-b border-slate-100 pb-1">
          <span>Всего бланков:</span>
          <span>{stats.total} шт</span>
        </div>
        {currentSelectedTab === "archive" ? (
          <>
            <div className="flex justify-between items-center text-sm font-bold text-amber-600">
              <span>Сдано в инспекцию:</span>
              <span>{stats.usedCount} шт</span>
            </div>
            <div className="flex justify-between items-center text-sm font-bold text-rose-500">
              <span>Аннулировано:</span>
              <span>{stats.expiredCount} шт</span>
            </div>
          </>
        ) : currentSelectedTab === "office_returns" ? (
          <div className="flex justify-between items-center text-sm font-bold text-amber-600">
            <span>Ожидают сдачи в инспекцию:</span>
            <span>{stats.officeReturnCount} шт</span>
          </div>
        ) : (
          <>
            <div className="flex justify-between items-center text-sm font-bold text-emerald-600">
              <span>В офисе (чистые):</span>
              <span>{stats.office} шт</span>
            </div>
            <div className="flex justify-between items-center text-sm font-bold text-blue-600">
              <span>На руках у машин (в рейсе):</span>
              <span>{stats.hand - stats.officeReturnCount} шт</span>
            </div>
            <div className="flex justify-between items-center text-sm font-bold text-amber-600">
              <span>Сдан в офис:</span>
              <span>{stats.officeReturnCount} шт</span>
            </div>
            <div className="flex justify-between items-center text-sm font-bold text-slate-700 bg-slate-100 px-2 py-1 rounded-lg mt-1 mb-2">
              <span>Всего полученных:</span>
              <span>{stats.office + stats.hand} шт</span>
            </div>

            {(currentSelectedTab === "all" ||
              currentSelectedTab === "CHN 2" ||
              currentSelectedTab === "CHN 3") && (
              <div className="flex justify-between items-center text-sm font-bold text-purple-700">
                <span>Сдана копия (считается сданным):</span>
                <span>{stats.copies} шт</span>
              </div>
            )}

            {!isGlobalTab && (
              <div className="flex justify-between items-center text-sm font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-lg mt-1">
                <span>Можно получить еще:</span>
                <span>
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
        <div className="bg-white rounded-[2rem] p-6 border-l-4 border-l-blue-500 border-y border-r border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-3">
          <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest font-mono border-b border-slate-100 pb-2 mb-1">
            📐 Лимит выдачи: {currentSelectedTab}
          </div>
          <div className="flex flex-col gap-2.5 mt-1">
            <div>
              <label className="text-[10px] font-bold text-slate-500 mb-1 block">
                Всего водителей в штате (общий):
              </label>
              <input
                type="number"
                value={quotaGlobalDriversCount || ""}
                onChange={handleSaveGlobalDrivers}
                className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black"
                placeholder="Кол-во водителей"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 mb-1 block">
                Целевой процент выдачи (%):
              </label>
              <input
                type="number"
                value={quotaTypesPercents[currentSelectedTab] || ""}
                onChange={handleSaveTypeQuotaPercent}
                className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black"
                placeholder="Процент"
              />
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 mb-1 block">
                Квартальная квота (шт.):
              </label>
              <input
                type="number"
                value={quotaQuarterLimits[currentSelectedTab] || ""}
                onChange={handleSaveTypeQuarterQuota}
                className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black"
                placeholder="Квартальная квота"
              />
            </div>
            <div className="bg-slate-50 p-3 rounded-xl border border-slate-100 text-xs font-semibold leading-relaxed mt-2">
              <div className="flex justify-between mb-1">
                <span>Лимит квоты по штату:</span>
                <span className="font-black text-blue-600">
                  {getPermitQuotaInfo(currentSelectedTab).limit} шт.
                </span>
              </div>
              <div className="flex justify-between mb-1">
                <span>Выдано / на руках (не сдано в ТИ):</span>
                <span className="font-black text-slate-800">
                  {getPermitQuotaInfo(currentSelectedTab).inTrip} шт.
                </span>
              </div>
              <div className="flex justify-between text-emerald-600 mb-1">
                <span>Можно получить еще:</span>
                <span className="font-black">
                  {getPermitQuotaInfo(currentSelectedTab).unlimited
                    ? "без лимита"
                    : getPermitQuotaInfo(currentSelectedTab).remaining}
                </span>
              </div>
              {getPermitQuotaInfo(currentSelectedTab).limit > 0 ? (
                <div className="text-[10px] text-slate-500 border-t border-slate-200/50 pt-2 mt-2 border-dashed">
                  Примечание: учтено{" "}
                  {getPermitQuotaInfo(currentSelectedTab).received} из{" "}
                  {getPermitQuotaInfo(currentSelectedTab).limit} шт.
                </div>
              ) : (
                <div className="text-[10px] text-slate-400 italic">
                  Укажите количество водителей и % лимита.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {!isGlobalTab && (
        <div className="bg-white rounded-[2rem] p-6 border-l-4 border-l-amber-500 border-y border-r border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-3">
          <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest font-mono border-b border-slate-100 pb-2 mb-1">
            ⏳ Сроки сдачи: {currentSelectedTab}
          </div>
          <div>
            <label className="text-[10px] font-bold text-slate-500 mb-1 block">
              Срок сдачи от даты выдачи (дней):
            </label>
            <input
              type="number"
              value={configuredDays || ""}
              onChange={handleSaveDeadlineDays}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black"
              placeholder="Напр. 60"
            />
          </div>
          <div className="bg-slate-50 rounded-xl p-3 text-xs font-semibold mt-1 max-h-48 overflow-y-auto custom-scrollbar">
            {!configuredDays ? (
              <div className="text-slate-400 italic text-center text-[10px]">
                Задайте нормативный срок в днях
              </div>
            ) : criticalItems.length === 0 ? (
              <div className="text-emerald-600 text-center text-[10px]">
                Все бланки в пределах нормы!
              </div>
            ) : (
              <div>
                <div className="text-[10px] text-rose-500 font-black uppercase mb-2">
                  Подходят сроки или просрочены ({criticalItems.length}):
                </div>
                {criticalItems.map((c, i) => (
                  <div
                    key={i}
                    className="flex justify-between items-center py-1.5 border-b border-slate-200/50 border-dashed last:border-0 text-[11px]"
                  >
                    <span className="font-mono font-bold text-slate-700 underline decoration-slate-300">
                      №{c.number}
                    </span>
                    <span>
                      {c.daysLeft < 0 ? (
                        <span className="text-rose-500 font-bold">
                          просрочен на {Math.abs(c.daysLeft)} дн.
                        </span>
                      ) : c.daysLeft === 0 ? (
                        <span className="text-amber-500 font-bold">
                          сдача СЕГОДНЯ!
                        </span>
                      ) : (
                        <span className="text-slate-500">
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
          <div className="bg-white rounded-[2rem] p-6 border-l-4 border-l-purple-600 border-y border-r border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-3">
            <div className="text-[10px] font-black uppercase text-purple-700 tracking-widest font-mono border-b border-purple-100 pb-2 mb-1">
              ⏳ Контроль оригиналов (30 дней)
            </div>
            <div className="text-[10px] text-slate-500 italic font-medium -mt-1 leading-normal">
              По китайским дозволам разница между сдачей копии и сдачей
              оригинала не должна превышать 30 дней.
            </div>
            <div className="bg-purple-50/40 rounded-xl p-3 text-xs font-semibold max-h-56 overflow-y-auto custom-scrollbar space-y-2">
              {copyTrackingItems.map((c, idx) => (
                <div
                  key={idx}
                  className="flex flex-col py-2 border-b border-purple-100/50 border-dashed last:border-0 last:pb-0"
                >
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-mono font-bold text-slate-800">
                      № {c.number}{" "}
                      <span className="text-[9px] bg-purple-100/70 text-purple-700 px-1.5 py-0.5 rounded font-black">
                        {c.type}
                      </span>
                    </span>
                    <span>
                      {c.daysLeft < 0 ? (
                        <span className="text-rose-600 font-black animate-pulse uppercase text-[9px] tracking-tight bg-rose-50 px-1.5 py-0.5 rounded border border-rose-100">
                          просрочен на {Math.abs(c.daysLeft)} дн.!
                        </span>
                      ) : c.daysLeft === 0 ? (
                        <span className="text-amber-600 font-extrabold animate-bounce uppercase text-[10px] tracking-tight bg-amber-50 px-1.5 py-0.5 rounded">
                          Сдача сегодня!
                        </span>
                      ) : (
                        <span className="text-purple-700 font-bold bg-purple-100/75 px-1.5 py-0.5 rounded text-[10px]">
                          осталось: {c.daysLeft} дн.
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mt-1 text-[9px] text-slate-400 font-mono">
                    <span>Авто: {c.car || "не привязано"}</span>
                    <span>
                      Сдана:{" "}
                      {c.copySubmittedAt
                        ? new Date(c.copySubmittedAt).toLocaleDateString(
                            "ru-RU",
                          )
                        : "—"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-4">
        <div className="text-[10px] font-black uppercase text-slate-400 tracking-widest font-mono border-b border-slate-100 pb-2">
          📋 Планерка: заказы дозволов
        </div>

        <div className="flex items-end gap-3 w-full">
          <div className="flex-1">
            <label className="text-[10px] font-bold text-slate-500 mb-1 block">
              Машина
            </label>
            <input
              type="text"
              value={plannerCar}
              onChange={(e) => setPlannerCar(e.target.value.toUpperCase())}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black uppercase"
              placeholder="AB 9271-7"
              list="fleet-cars-datalist-planner"
            />
            <datalist id="fleet-cars-datalist-planner">
              {Object.keys(knownFleetCars).map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
          </div>
          <div className="w-[100px]">
            <label className="text-[10px] font-bold text-slate-500 mb-1 block">
              Цена (BYN)
            </label>
            <input
              type="number"
              value={calcPrice || ""}
              onChange={(e) => setCalcPrice(parseFloat(e.target.value) || 0)}
              className="w-full px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black"
              min="0"
              step="0.01"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2 max-h-64 overflow-y-auto custom-scrollbar pr-1">
          {plannerTypes.map((typeName) => {
            const info = getPermitQuotaInfo(typeName as string);
            return (
              <div
                key={typeName}
                className="flex justify-between items-center bg-slate-50 border border-slate-200/60 p-2.5 rounded-xl"
              >
                <div className="flex w-full flex-col">
                  <span className="font-black text-slate-800 text-xs mb-1">
                    {typeName}
                  </span>
                  <span className="text-[9px] text-slate-400 font-bold">
                    {info.unlimited
                      ? "Квота не ограничена"
                      : `Квота: ${info.limit}`}{" "}
                    · получено: {info.received} · у машин / не сданы:{" "}
                    {info.inTrip}
                  </span>
                </div>
                <input
                  type="number"
                  className="w-[60px] text-center px-1 py-1 bg-white border border-slate-200 rounded-lg text-xs font-black"
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

        <div
          className={`p-3 rounded-xl border text-xs font-bold leading-relaxed ${plannerSummary.overLimit.length ? "bg-rose-50 border-rose-100 text-rose-700" : plannerSummary.totalQty > 0 ? "bg-blue-50 border-blue-100 text-blue-700" : "bg-slate-50 border-slate-100 text-slate-500"}`}
        >
          {plannerSummary.totalQty > 0 ? (
            <>
              <div className="flex justify-between mb-1">
                <span>Итого бланков:</span>
                <span>{plannerSummary.totalQty} шт.</span>
              </div>
              <div className="flex justify-between mb-2">
                <span>Стоимость:</span>
                <span>{Math.round(plannerSummary.totalCost)} BYN</span>
              </div>
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
                <div className="mt-2 pt-2 border-t border-rose-200/50 text-[10px] font-black">
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
          className="w-full mt-1 px-5 py-3 bg-[#70FC8E] hover:bg-[#5ceb7c] text-emerald-950 font-black rounded-xl text-xs uppercase tracking-wide cursor-pointer transition shadow-sm border border-emerald-400/50"
        >
          Добавить заявку в планерку
        </button>

        <div className="max-h-64 overflow-y-auto custom-scrollbar mt-2 border-t border-slate-100 pt-3 flex flex-col gap-2">
          {Object.values(todoTasks).map((t: any) => (
            <div
              key={t.id}
              className={`p-3 rounded-xl border border-slate-200 flex gap-3 ${t.done ? "bg-slate-50 opacity-60 line-through" : "bg-white shadow-xs"}`}
            >
              <div
                className="cursor-pointer font-black text-slate-800 flex-1 text-xs"
                onClick={() => {
                  if (useFirebase) {
                    const nextDone = !t.done;
                    update(ref(database, `dozvolsTodoTasksV4/${t.id}`), {
                      done: nextDone,
                    });
                    logTaskAction(
                      t.car,
                      nextDone ? "Заявка выполнена" : "Заявка возобновлена",
                      `Сумма: ${t.totalCost} BYN, примечание: ${t.note || "—"}`,
                    );
                  }
                }}
              >
                <div className="flex justify-between mb-2">
                  <span>
                    {t.done ? "✓ " : "• "}
                    {t.car || "Без машины"}
                  </span>
                  <span>{t.totalCost} BYN</span>
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {Array.isArray(t.items) &&
                    t.items.map((i: any, idx) => (
                      <span
                        key={idx}
                        className="bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap !no-underline"
                      >
                        {i.type} × {i.qty}
                      </span>
                    ))}
                </div>
                <div className="text-[10px] text-slate-400 font-medium !no-underline mb-2">
                  {t.createdAt}
                </div>
                <input
                  className="w-full bg-slate-50 border border-slate-200 rounded px-2 py-1 text-[10px] font-medium !no-underline focus:outline-none"
                  value={t.note || ""}
                  placeholder="Заметка к заявке..."
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    useFirebase &&
                    update(ref(database, `dozvolsTodoTasksV4/${t.id}`), {
                      note: e.target.value,
                    })
                  }
                  onFocus={(e) => handleNoteFocus(t.id, e.target.value)}
                  onBlur={(e) => handleNoteBlur(t.id, t.car, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    }
                  }}
                />
              </div>
              <button
                className="h-6 w-6 rounded-full bg-rose-50 text-rose-500 flex items-center justify-center cursor-pointer flex-shrink-0"
                onClick={() => {
                  if (useFirebase) {
                    remove(ref(database, `dozvolsTodoTasksV4/${t.id}`));
                    logTaskAction(t.car, "Удалена заявка", `Снята с планерки`);
                  }
                }}
              >
                ✕
              </button>
            </div>
          ))}
        </div>

        <div
          className={`p-4 rounded-xl border shadow-sm ${activeTasks.length ? "bg-slate-950 text-white border-slate-800" : "bg-slate-50 text-slate-400 border-slate-200"}`}
        >
          <div className="text-[11px] font-bold mb-1 opacity-80">
            Общая необходимая сумма
          </div>
          <div className="text-xl font-black">
            {Math.round(totalPlannerReqCost as number).toLocaleString("ru-RU")}{" "}
            BYN
          </div>
          {activeTasks.length > 0 && (
            <div className="text-[10px] font-bold opacity-60 mt-1">
              {totalPlannerReqQty} бланков · {activeTasks.length} заявки ·{" "}
              {carsCount} машин
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

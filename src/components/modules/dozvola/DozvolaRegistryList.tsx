import React, { useState, useEffect } from "react";
import { UserProfile } from "../../../types";
import { useFirebase, database } from "../../../firebase";
import { ref, onValue, set, push, update, remove } from "firebase/database";
import {
  Trash2,
  Search,
  Plus,
  Edit,
  X
} from "lucide-react";
import DozvolaWidgets from "./DozvolaWidgets";
import DozvolaAIAssistant from "./DozvolaAIAssistant";

interface DozvolaRegistryListProps {
  user: UserProfile;
}

export default function DozvolaRegistryList({
  user,
}: DozvolaRegistryListProps) {
  const [dozvolsData, setDozvolsData] = useState<Record<string, any>>({});
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [customTypesOrder, setCustomTypesOrder] = useState<string[]>([]);
  const [knownFleetCars, setKnownFleetCars] = useState<Record<string, any>>({});
  const [bazaCars, setBazaCars] = useState<any[]>([]);
  const [quotaTypesPercents, setQuotaTypesPercents] = useState<Record<string, number>>({});
  const [quotaQuarterLimits, setQuotaQuarterLimits] = useState<Record<string, number>>({});
  const [quotaGlobalDriversCount, setQuotaGlobalDriversCount] = useState(0);
  const [typesDeadlineDays, setTypesDeadlineDays] = useState<Record<string, number>>({});

  const [currentSelectedTab, setCurrentSelectedTab] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountryFilter, setSelectedCountryFilter] = useState("all");

  const [isCreatorOpen, setIsCreatorOpen] = useState(false);
  const [isBatchCreatorOpen, setIsBatchCreatorOpen] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [country, setCountry] = useState("Польша");
  const [type, setType] = useState("Транзитный двусторонний");
  const [permitNumber, setPermitNumber] = useState("");
  const [comments, setComments] = useState("");

  const [currentSortField, setCurrentSortField] = useState("issueDate");
  const [currentSortOrder, setCurrentSortOrder] = useState<"asc" | "desc">("desc");
  const [originalCars, setOriginalCars] = useState<Record<string, string>>({});
  const [originalComments, setOriginalComments] = useState<Record<string, string>>({});

  const [editingItem, setEditingItem] = useState<any>(null);
  const [editStatus, setEditStatus] = useState("available");
  const [editCar, setEditCar] = useState("");
  const [editIsCopy, setEditIsCopy] = useState(false);
  const [editCopySubmittedAt, setEditCopySubmittedAt] = useState("");

  useEffect(() => {
    if (editingItem) {
      setType(editingItem.type || "");
      setPermitNumber(editingItem.number || editingItem.permitNumber || "");
      setComments(editingItem.comment || editingItem.comments || "");
      setEditStatus(editingItem.status || "available");
      setEditCar(editingItem.car || "");
      setEditIsCopy(editingItem.isCopy || false);
      setEditCopySubmittedAt(editingItem.copySubmittedAt || "");
    } else {
      setComments("");
      setPermitNumber("");
      setEditStatus("available");
      setEditCar("");
      setEditIsCopy(false);
      setEditCopySubmittedAt("");
    }
  }, [editingItem]);

  useEffect(() => {
    if (!useFirebase) return;

    const subs: (() => void)[] = [];
    const listen = (path: string, setter: (val: any) => void) => {
      const dbRef = ref(database, path);
      const unsub = onValue(dbRef, (snap) => setter(snap.val() || {}));
      subs.push(() => unsub());
    };

    listen("dozvolsRegistryV4", setDozvolsData);
    listen("dozvolsTypesV4", setCustomTypes);
    listen("dozvolsTypesOrderV4", (val) => setCustomTypesOrder(Array.isArray(val) ? val : Object.keys(val || {})));
    listen("knownFleetCars", setKnownFleetCars);
    listen("quotaTypesPercents", setQuotaTypesPercents);
    listen("quotaTypesQuarterLimits", setQuotaQuarterLimits);
    listen("typesDeadlineDaysV1", setTypesDeadlineDays);

    const bzRef = ref(database, "baza_cars");
    const unsubBz = onValue(bzRef, (snap) => {
      const val = snap.val() || {};
      const list = Object.keys(val).map(id => ({ id, ...val[id] }));
      setBazaCars(list);
    });
    subs.push(() => unsubBz());

    const drvRef = ref(database, "quotaGlobalDriversCount");
    const unsubDrv = onValue(drvRef, (snap) => setQuotaGlobalDriversCount(snap.val() || 0));
    subs.push(() => unsubDrv());

    return () => subs.forEach(s => s());
  }, []);

  const verifyOrCreateCar = async (carNum: string) => {
    if (!carNum || carNum.trim() === "") return;
    const cleanCar = carNum.trim().toUpperCase();
    if (knownFleetCars[cleanCar]) return;
    if (useFirebase) set(ref(database, 'knownFleetCars/' + cleanCar), true);
  };

  const getStatusLabel = (status: string) => {
      const map: any = { office: 'В офисе', available: 'В наличии', hand: 'В рейсе / на руках', office_return: 'Сдан в офис', used: 'Сдан в транспортную инспекцию', expired: 'Аннулирован' };
      return map[status] || status || '—';
  };

  const logAction = (lType: string, lNum: string, action: string, meta: string) => {
      if (!useFirebase) return;
      const logist = localStorage.getItem('ratipa_auth_user') || user?.name || "Система";
      push(ref(database, 'dozvolsHistoryV4'), {
          time: new Date().toLocaleString("ru-RU"),
          logist,
          doc: `${lType} №${lNum}`,
          action,
          meta
      });
  };

  const handleCreatePermit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permitNumber.trim()) {
      alert("Пожалуйста, заполните уникальный серийный номер бланка дозвола.");
      return;
    }

    if (editingItem) {
      if (useFirebase) {
        update(ref(database, `dozvolsRegistryV4/${editingItem.id}`), {
          type,
          number: permitNumber.trim().toUpperCase(),
          status: editStatus,
          car: editCar.toUpperCase(),
          comment: comments,
          isCopy: editIsCopy,
          copySubmittedAt: editIsCopy ? (editCopySubmittedAt || new Date().toISOString().split("T")[0]) : null
        });
        
        let diffs = [];
        if (editingItem.type !== type) diffs.push(`Вид: [${editingItem.type}] ➔ [${type}]`);
        if (editingItem.number !== permitNumber) diffs.push(`Номер: [${editingItem.number}] ➔ [${permitNumber.trim().toUpperCase()}]`);
        if (editingItem.status !== editStatus) diffs.push(`Статус: [${getStatusLabel(editingItem.status)}] ➔ [${getStatusLabel(editStatus)}]`);
        if (editingItem.car !== editCar) diffs.push(`Автомобиль: [${editingItem.car || '—'}] ➔ [${editCar || '—'}]`);
        if (editingItem.comment !== comments) diffs.push(`Примечание изменено`);
        
        logAction(type, permitNumber.trim().toUpperCase(), "Изменение через форму", diffs.join(" | ") || "Изменение параметров формы");
        if (editCar) {
          await verifyOrCreateCar(editCar);
        }
      }
      setEditingItem(null);
      setIsCreatorOpen(false);
      setPermitNumber("");
      setComments("");
      alert("Изменения в бланке квоты сохранены.");
    } else {
      if (useFirebase) {
        const newKey = push(ref(database, 'dozvolsRegistryV4')).key;
        if (newKey) {
          set(ref(database, 'dozvolsRegistryV4/' + newKey), {
            id: newKey, country, type, number: permitNumber.trim().toUpperCase(),
            status: "available", issueDate: new Date().toISOString().split("T")[0],
            car: "", comment: comments, isCopy: false
          });
          logAction(type, permitNumber.trim().toUpperCase(), "Ручное внесение", `Статус: ${getStatusLabel("available")}`);
        }
      }
      
      setIsCreatorOpen(false);
      setPermitNumber("");
      setComments("");
      alert("Бланк квоты дозвола добавлен и готов к выдаче.");
    }
  };

  const handleBatchCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!batchText.trim()) return;

    const numbers = batchText.split(/[\n,;]+/).map((n) => n.trim().toUpperCase()).filter((n) => n);
    if (numbers.length === 0) return;

    let addedCount = 0;
    numbers.forEach((num) => {
      if (useFirebase) {
        const newKey = push(ref(database, 'dozvolsRegistryV4')).key;
        if (newKey) {
            set(ref(database, 'dozvolsRegistryV4/' + newKey), {
              id: newKey, country, type, number: num,
              status: "office", issueDate: new Date().toISOString().split("T")[0],
              car: "", comment: "Массовый ввод", isCopy: false
            });
            logAction(type, num, "Массовый ввод", `Статус: ${getStatusLabel("office")}`);
        }
      }
      addedCount++;
    });

    setIsBatchCreatorOpen(false);
    setBatchText("");
    alert(`Успешно добавлено дозволов: ${addedCount}`);
  };

  const handleDeletePermit = (id: string) => {
    if (confirm("Вы желаете совсем убрать этот дозвол из общего перечня?")) {
        const perm = dozvolsData[id];
        if (perm) logAction(perm.type, perm.number || perm.permitNumber, "Удаление бланка", "Бланк удален из реестра");
        if (useFirebase) remove(ref(database, `dozvolsRegistryV4/${id}`));
    }
  };

  const updateDozvolStatusInline = (id: string, newStatus: string) => {
      if (!newStatus) return;
      const old = dozvolsData[id];
      if (useFirebase && old) {
          update(ref(database, `dozvolsRegistryV4/${id}`), { status: newStatus });
          logAction(old.type, old.number, "Изменен статус", `Статус: [${getStatusLabel(old.status)}] ➔ [${getStatusLabel(newStatus)}]`);
      }
  };

  const handleInlineCarChangeOnly = (id: string, newCar: string) => {
      if (useFirebase) {
          update(ref(database, `dozvolsRegistryV4/${id}`), { car: newCar.toUpperCase() });
      }
  };

  const handleCarFocus = (id: string, currentVal: string) => {
      setOriginalCars(prev => ({ ...prev, [id]: currentVal.trim().toUpperCase() }));
  };

  const handleCarBlur = async (id: string, currentVal: string) => {
      const orig = originalCars[id] !== undefined ? originalCars[id] : '';
      const newVal = currentVal.trim().toUpperCase();

      if (orig === newVal) return;

      const old = dozvolsData[id];
      if (useFirebase && old) {
          const oldCar = orig || '—';
          const displayNewCar = newVal || '—';

          if (newVal) {
              await verifyOrCreateCar(newVal);
              logAction(old.type, old.number, "Изменена машина / локация", `Автомобиль: [${oldCar}] ➔ [${displayNewCar}]`);
          } else {
              logAction(old.type, old.number, "Удалена машина", `Автомобиль [${oldCar}] отвязан`);
          }
      }

      setOriginalCars(prev => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
      });
  };

  const updateDozvolCommentInline = (id: string, newComment: string) => {
      if (useFirebase) update(ref(database, `dozvolsRegistryV4/${id}`), { comment: newComment });
  };

  const handleCommentFocus = (id: string, currentVal: string) => {
      setOriginalComments(prev => ({ ...prev, [id]: currentVal.trim() }));
  };

  const handleCommentBlur = (id: string, currentVal: string) => {
      const orig = originalComments[id] !== undefined ? originalComments[id] : '';
      const newVal = currentVal.trim();
      if (orig === newVal) return;

      const old = dozvolsData[id];
      if (useFirebase && old) {
          logAction(old.type, old.number, "Изменено примечание", `Примечание: [${orig || '—'}] ➔ [${newVal || '—'}]`);
      }

      setOriginalComments(prev => {
          const copy = { ...prev };
          delete copy[id];
          return copy;
      });
  };

  const toggleDozvolCopyInline = (id: string, currentCopyVal: boolean) => {
      const old = dozvolsData[id];
      if (!old || (old.type !== 'CHN 2' && old.type !== 'CHN 3')) return;
      const nextVal = !currentCopyVal;
      if (useFirebase) {
          update(ref(database, `dozvolsRegistryV4/${id}`), { 
              isCopy: nextVal,
              copySubmittedAt: nextVal ? new Date().toISOString().split("T")[0] : null
          });
          logAction(old.type, old.number, "Изменена отметка копии", `Копия сдана: [${currentCopyVal ? 'Да' : 'Нет'}] ➔ [${nextVal ? 'Да' : 'Нет'}]`);
      }
  };

  let rawItems = Object.values(dozvolsData) as any[];
  if (currentSelectedTab !== 'all' && currentSelectedTab !== 'archive' && currentSelectedTab !== 'office_returns') {
      rawItems = rawItems.filter(i => i.type === currentSelectedTab);
  }
  
  const total = rawItems.length;
  const office = rawItems.filter(i=>i.status==='office' || i.status==='available').length;
  const hand = rawItems.filter(i=>i.status==='hand' || i.status==='office_return').length;
  const officeReturnCount = rawItems.filter(i=>i.status==='office_return').length;
  const usedCount = rawItems.filter(i=>i.status==='used').length;
  const expiredCount = rawItems.filter(i=>i.status==='expired').length;
  const copies = rawItems.filter(i=>i.isCopy===true).length;

  let items = rawItems;
  if (currentSelectedTab === 'archive') {
      items = items.filter(i => i.status === 'used' || i.status === 'expired');
  } else if (currentSelectedTab === 'office_returns') {
      items = items.filter(i => i.status === 'office_return');
  } else {
      items = items.filter(i => i.status !== 'used' && i.status !== 'expired' && i.status !== 'office_return');
  }

  if (selectedCountryFilter !== "all") {
    // Actually the logic from HTML filters by status filter, not country directly, but let's keep status filter.
    if(selectedCountryFilter === 'copy_yes') items = items.filter(i => i.isCopy === true);
    else if(selectedCountryFilter === 'copy_no') items = items.filter(i => i.isCopy === false);
    else items = items.filter(i => i.status === selectedCountryFilter);
  }

  if (searchQuery) {
      const s = searchQuery.toLowerCase();
      items = items.filter(i => 
          (i.number || i.permitNumber || '').toLowerCase().includes(s) || 
          (i.car || i.assignedVehicle || '').toLowerCase().includes(s) ||
          (i.comment || i.comments || '').toLowerCase().includes(s) ||
          (i.type || '').toLowerCase().includes(s)
      );
  }

  items.sort((a, b) => {
      let valA = a[currentSortField] || ''; let valB = b[currentSortField] || '';
      if (typeof valA === 'string') valA = valA.toUpperCase(); if (typeof valB === 'string') valB = valB.toUpperCase();
      if (valA < valB) return currentSortOrder === "asc" ? -1 : 1;
      if (valA > valB) return currentSortOrder === "asc" ? 1 : -1;
      return 0;
  });

  const showTypeColumn = (currentSelectedTab === 'all' || currentSelectedTab === 'archive' || currentSelectedTab === 'office_returns');

  const unifiedFleetCars = {
    ...knownFleetCars,
    ...bazaCars.reduce((acc: any, curr: any) => {
      if (curr.carNumber) {
        acc[curr.carNumber.trim().toUpperCase()] = true;
      }
      return acc;
    }, {})
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
      <div className="xl:col-span-8 space-y-6">
        <DozvolaAIAssistant 
            user={user} 
            dozvolsData={dozvolsData} 
            customTypesOrder={customTypesOrder} 
            customTypes={customTypes} 
            knownFleetCars={unifiedFleetCars} 
            onOpenEditPermit={(item, prefilledChanges) => {
                setEditingItem(item);
                if (prefilledChanges) {
                    if (prefilledChanges.type) setType(prefilledChanges.type);
                    if (prefilledChanges.number) setPermitNumber(prefilledChanges.number);
                    if (prefilledChanges.comment !== undefined) setComments(prefilledChanges.comment || "");
                    if (prefilledChanges.status) setEditStatus(prefilledChanges.status);
                    if (prefilledChanges.car !== undefined) setEditCar(prefilledChanges.car || "");
                }
                setIsCreatorOpen(true);
            }}
        />

        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="bg-[#70FC8E] text-slate-950 font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono border border-black/5">
                Транзитные дозволы ЕС
              </span>
              <span className="text-[9px] text-slate-400 font-extrabold uppercase font-mono">
                Журнал Квот
              </span>
            </div>
            <h1 className="text-2xl lg:text-3xl font-black text-slate-900 uppercase tracking-tight">
              Дозвола
            </h1>
            <p className="text-xs text-slate-500 mt-1 max-w-xl font-medium">
              Оперативное распределение квот на международные автоперевозки
            </p>
          </div>

          <div className="flex items-center gap-3">
            {user.permissions.dozvola === "write" && (
              <button
                onClick={() => setIsBatchCreatorOpen(true)}
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black px-5 py-3 rounded-2xl transition cursor-pointer shadow-sm uppercase tracking-tight"
              >
                Массовый ввод
              </button>
            )}
            {user.permissions.dozvola === "write" && (
              <button
                onClick={() => setIsCreatorOpen(true)}
                className="flex items-center gap-2 bg-slate-950 hover:bg-slate-800 text-white text-xs font-black px-5 py-3 rounded-2xl transition cursor-pointer shadow-xs uppercase tracking-tight"
              >
                <Plus className="h-4 w-4 text-[#70FC8E]" />
                Зарегистрировать
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-between items-end mt-4 flex-wrap gap-2 bg-slate-50 rounded-t-3xl border border-slate-200/50 border-b-0 pt-2 px-2">
            <div className="flex items-end gap-1 overflow-x-auto custom-scrollbar flex-1 pb-1">
                <button 
                    onClick={() => setCurrentSelectedTab("all")}
                    className={'px-4 py-3 text-[13px] font-black rounded-t-2xl transition whitespace-nowrap cursor-pointer ' + (currentSelectedTab === "all" ? 'bg-white text-slate-900 border border-slate-200/50 border-b-white -mb-[1px] relative z-10' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}
                >
                    🌐 Все виды
                </button>
                {customTypesOrder.map(id => {
                    const t = customTypes[id];
                    if (!t) return null;
                    return (
                        <button 
                            key={id}
                            onClick={() => setCurrentSelectedTab(t.name)}
                            className={'px-4 py-3 text-[13px] font-black rounded-t-2xl transition whitespace-nowrap cursor-pointer ' + (currentSelectedTab === t.name ? 'bg-white text-slate-900 border border-slate-200/50 border-b-white -mb-[1px] relative z-10' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800')}
                        >
                            {t.name}
                        </button>
                    )
                })}
                <button 
                    onClick={() => setCurrentSelectedTab("archive")}
                    className={'px-4 py-3 text-[13px] font-black rounded-t-2xl transition whitespace-nowrap cursor-pointer text-slate-400 ' + (currentSelectedTab === "archive" ? 'bg-white !text-slate-900 border border-slate-200/50 border-b-white -mb-[1px] relative z-10' : 'hover:bg-slate-100 hover:!text-slate-800')}
                >
                    📦 Архив / Инспекция
                </button>
                <button 
                    onClick={() => setCurrentSelectedTab("office_returns")}
                    className={'px-4 py-3 text-[13px] font-black rounded-t-2xl transition whitespace-nowrap cursor-pointer text-amber-500 ' + (currentSelectedTab === "office_returns" ? 'bg-white !text-slate-900 border border-slate-200/50 border-b-white -mb-[1px] relative z-10' : 'hover:bg-slate-100 hover:!text-slate-800')}
                >
                    🟡 Сданы в офис
                </button>
            </div>
        </div>

      <div className="bg-white rounded-b-[2rem] rounded-tr-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden -mt-[1px] relative z-0">
        <div className="p-5 bg-white flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="relative w-full">
            <Search className="h-4 w-4 text-slate-400 absolute left-4 top-3" />
            <input
              type="text"
              placeholder="🔍 Быстрый поиск по бланку, машине или комментарию..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
            />
          </div>

          <div className="w-full sm:w-[220px]">
            <select
               value={selectedCountryFilter}
               onChange={(e) => setSelectedCountryFilter(e.target.value)}
               className="w-full px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
            >
               <option value="all">Все статусы</option>
               <option value="office">В офисе</option>
               <option value="hand">В рейсе у машин</option>
               <option value="office_return">Сданы в офис</option>
               <option value="copy_yes">Сдана копия (CHN 2/3)</option>
               <option value="copy_no">Нет копии (CHN 2/3)</option>
            </select>
          </div>
        </div>

        {/* Swipe Help Badge for Mobile */}
        <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-center uppercase tracking-wider select-none">
           <span className="inline-block text-blue-500 mr-1.5 font-sans">↔</span> Таблица прокручивается вправо для просмотра деталей (Локация авто, Копии, Статусы)
        </div>

        <div className="overflow-x-auto custom-scrollbar">
          <table className="w-full text-left border-collapse min-w-[800px]">
            <thead>
              <tr className="bg-slate-50/60 border-y border-slate-200/55 text-[10px] uppercase font-black text-slate-400 tracking-wider">
                {showTypeColumn && <th className="p-4 pl-6 cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition" onClick={() => { setCurrentSortField("type"); setCurrentSortOrder(currentSortOrder === "asc" ? "desc" : "asc"); }}>Вид</th>}
                <th className="p-4 cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition" onClick={() => { setCurrentSortField("number"); setCurrentSortOrder(currentSortOrder === "asc" ? "desc" : "asc"); }}>Номер дозвола</th>
                <th className="p-4 cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition" onClick={() => { setCurrentSortField("issueDate"); setCurrentSortOrder(currentSortOrder === "asc" ? "desc" : "asc"); }}>Дата выдачи</th>
                <th className="p-4 cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition" onClick={() => { setCurrentSortField("status"); setCurrentSortOrder(currentSortOrder === "asc" ? "desc" : "asc"); }}>Статус оригинала</th>
                <th className="p-4 cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition" onClick={() => { setCurrentSortField("car"); setCurrentSortOrder(currentSortOrder === "asc" ? "desc" : "asc"); }}>Привязка к авто / Локация</th>
                <th className="p-4">Сдан по копии?</th>
                <th className="p-4 cursor-pointer hover:bg-slate-100 hover:text-slate-800 transition" onClick={() => { setCurrentSortField("copySubmittedAt"); setCurrentSortOrder(currentSortOrder === "asc" ? "desc" : "asc"); }}>Дата сдачи по копии</th>
                <th className="p-4">Быстрый статус</th>
                <th className="p-4 pr-6 text-right">Управление</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-[11px] font-semibold">
              {items.map((item) => (
                <tr key={item.id} className={`hover:bg-slate-50/40 transition ${item.isCopy ? 'bg-[#fff7cc]/40' : ''}`}>
                  {showTypeColumn && (
                      <td className="p-4 pl-6">
                          <span className="font-bold text-blue-600 bg-blue-50 px-2 py-1 rounded">{item.type}</span>
                      </td>
                  )}
                  <td className={`p-4 ${!showTypeColumn ? 'pl-6' : ''}`}>
                    <span className="font-black text-slate-900 font-mono text-[13px] block mb-1">
                      {item.number || item.permitNumber}
                    </span>
                    <input 
                        type="text" 
                        value={item.comment || item.comments || ''} 
                        className="w-full bg-transparent border-none text-[10px] text-slate-500 italic focus:outline-none focus:ring-1 focus:ring-slate-200 rounded px-1 -ml-1" 
                        placeholder="📝 Примечание..." 
                        onChange={(e) => updateDozvolCommentInline(item.id, e.target.value)}
                        onFocus={(e) => handleCommentFocus(item.id, e.target.value)}
                        onBlur={(e) => handleCommentBlur(item.id, e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.currentTarget.blur();
                            }
                        }}
                    />
                  </td>
                  <td className="p-4 font-medium text-slate-600">
                    {item.issueDate ? new Date(item.issueDate).toLocaleDateString("ru-RU") : '—'}
                  </td>
                  <td className="p-4">
                    {item.status === 'office' && <span className="bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight">В офисе</span>}
                    {item.status === 'hand' && <span className="bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight">В рейсе</span>}
                    {item.status === 'office_return' && <span className="bg-amber-50 text-amber-600 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight">Сдан в офис</span>}
                    {item.status === 'used' && <span className="bg-[#fef3c7] text-[#b45309] px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight">Сдан в ИТ</span>}
                    {item.status === 'expired' && <span className="bg-rose-50 text-rose-600 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight">Аннулирован</span>}
                    {item.status === 'available' && <span className="bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-tight">В наличии</span>}
                  </td>
                  <td className="p-4">
                    <input 
                        type="text" 
                        className="w-[120px] p-1.5 bg-slate-50 border border-slate-200 rounded text-xs font-black focus:outline-none focus:border-slate-400 focus:bg-white" 
                        value={item.car || item.assignedVehicle || ''} 
                        onChange={(e) => handleInlineCarChangeOnly(item.id, e.target.value)}
                        onFocus={(e) => handleCarFocus(item.id, e.target.value)}
                        onBlur={(e) => handleCarBlur(item.id, e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.currentTarget.blur();
                            }
                        }}
                        list="fleet-cars-dl"
                    />
                  </td>
                  <td className="p-4">
                    {(item.type === 'CHN 2' || item.type === 'CHN 3') ? (
                      <div className="flex flex-col gap-1">
                        {item.isCopy ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <button onClick={() => toggleDozvolCopyInline(item.id, true)} className="bg-purple-100 text-purple-700 font-black text-[10px] uppercase px-2 py-0.5 rounded-full cursor-pointer hover:bg-purple-200 transition">📋 Сдана</button>
                            {(() => {
                              if (item.status === 'used' || item.status === 'expired') return null;
                              const baseDateStr = item.copySubmittedAt || item.issueDate || new Date().toISOString().split('T')[0];
                              const baseDate = new Date(baseDateStr);
                              const targetDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
                              targetDate.setHours(0,0,0,0);
                              const today = new Date(); today.setHours(0,0,0,0);
                              const diffTime = targetDate.getTime() - today.getTime();
                              const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                              
                              if (daysLeft < 0) {
                                return <span className="text-rose-600 bg-rose-50 border border-rose-100 text-[9px] font-black uppercase px-2 py-0.5 rounded font-mono animate-pulse">🔥 Просрочено {Math.abs(daysLeft)} дн.!</span>;
                              } else if (daysLeft === 0) {
                                return <span className="text-amber-600 bg-amber-50 border border-amber-200 text-[9px] font-black uppercase px-2 py-0.5 rounded font-mono animate-bounce">⚠️ Крайний день!</span>;
                              } else if (daysLeft <= 10) {
                                return <span className="text-amber-500 bg-amber-50 border border-amber-100 text-[9px] font-black uppercase px-2 py-0.5 rounded font-mono">⌛ {daysLeft} дней</span>;
                              } else {
                                return <span className="text-purple-600 bg-purple-50 border border-purple-150 text-[9px] font-bold uppercase px-2 py-0.5 rounded font-mono">⌛ {daysLeft} дн.</span>;
                              }
                            })()}
                          </div>
                        ) : (
                          <button onClick={() => toggleDozvolCopyInline(item.id, false)} className="bg-slate-100 text-slate-500 font-bold text-[10px] uppercase px-2.5 py-1 rounded-full cursor-pointer hover:bg-slate-200 transition w-max">❌ Нет копии</button>
                        )}
                      </div>
                    ) : <span className="text-slate-300 font-medium text-[11px]">—</span>}
                  </td>
                  <td className="p-4 whitespace-nowrap">
                    {item.isCopy && item.copySubmittedAt ? (
                      <div className="font-mono text-[11px] text-slate-700 font-bold">
                        {new Date(item.copySubmittedAt).toLocaleDateString("ru-RU")}
                      </div>
                    ) : <span className="text-slate-300 font-medium text-[11px]">—</span>}
                  </td>
                  <td className="p-4">
                    <select 
                        className="w-[120px] p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] font-bold focus:outline-none cursor-pointer"
                        onChange={(e) => {
                            if (e.target.value) updateDozvolStatusInline(item.id, e.target.value);
                            e.target.value = ""; // reset after selection
                        }}
                    >
                        <option value="">Действие...</option>
                        <option value="office">В офис</option>
                        <option value="hand">Выдать в рейс</option>
                        <option value="office_return">Сдан в офис</option>
                        <option value="used">Сдан в ИТ</option>
                        <option value="expired">Аннулировать</option>
                    </select>
                  </td>
                  <td className="p-4 pr-6 text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      {user.permissions.dozvola === "write" && (
                        <button
                          onClick={() => {
                            setEditingItem(item);
                            setIsCreatorOpen(true);
                          }}
                          className="w-7 h-7 flex items-center justify-center text-blue-600 hover:bg-blue-50 rounded-lg transition cursor-pointer"
                          title="Редактировать параметры бланка"
                        >
                          <Edit className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {user.role === "root_admin" && (
                        <button
                          onClick={() => handleDeletePermit(item.id)}
                          className="w-7 h-7 flex items-center justify-center text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                          title="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {!items.length && (
                <tr>
                  <td
                    colSpan={showTypeColumn ? 8 : 7}
                    className="text-center p-16 text-slate-400 font-black text-xs uppercase tracking-wider font-mono bg-slate-50/30"
                  >
                    Бланков не найдено.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      <div className="xl:col-span-4 space-y-6">
        <DozvolaWidgets 
            stats={{total, office, hand, usedCount, expiredCount, copies, officeReturnCount}} 
            currentSelectedTab={currentSelectedTab}
            dozvolsData={dozvolsData}
            knownFleetCars={unifiedFleetCars}
            quotaGlobalDriversCount={quotaGlobalDriversCount}
            quotaTypesPercents={quotaTypesPercents}
            quotaQuarterLimits={quotaQuarterLimits}
            typesDeadlineDays={typesDeadlineDays}
            customTypesOrder={customTypesOrder}
            customTypes={customTypes}
        />
      </div>

      {isCreatorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-md flex justify-center items-center p-4">
          <div className="bg-white rounded-[2.2rem] max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200/60 overflow-hidden">
            <div className="p-6 border-b border-slate-200/55 flex items-center justify-between select-none">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  {editingItem ? "Edit Permit" : "Permit Form"}
                </span>
                <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">
                  {editingItem ? "Редактирование бланка дозвола" : "Ручной ввод бланка"}
                </h2>
              </div>
              <button
                onClick={() => {
                  setEditingItem(null);
                  setIsCreatorOpen(false);
                }}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-xs font-black flex items-center justify-center cursor-pointer transition"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreatePermit} className="p-6 space-y-5">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  Вид дозвола
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                >
                  {customTypesOrder.map(id => {
                      const t = customTypes[id];
                      if (!t) return null;
                      return <option key={id} value={t.name}>{t.name}</option>;
                  })}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  Номер бланка
                </label>
                <input
                  type="text"
                  required
                  placeholder="TR A 55432"
                  value={permitNumber}
                  onChange={(e) => setPermitNumber(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 placeholder:text-slate-350 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  Сопутствующий комментарий
                </label>
                <textarea
                  placeholder="Добавьте примечание к бланку..."
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs h-16 resize-none focus:outline-none focus:bg-white focus:border-slate-300 transition"
                />
              </div>

              {editingItem && (
                <>
                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                      Статус бланка
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => setEditStatus(e.target.value)}
                      className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                    >
                      <option value="office">В офисе</option>
                      <option value="hand">В рейсе</option>
                      <option value="office_return">Сдан в офис</option>
                      <option value="used">Сдан в ИТ</option>
                      <option value="expired">Аннулирован</option>
                      <option value="available">В наличии</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                      Автомобиль / Локация
                    </label>
                    <input
                      type="text"
                      placeholder="Например, AB 9271-7"
                      value={editCar}
                      onChange={(e) => setEditCar(e.target.value)}
                      list="fleet-cars-dl"
                      className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 placeholder:text-slate-350 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                    />
                  </div>

                  {(type === 'CHN 2' || type === 'CHN 3') && (
                    <div className="bg-purple-50/50 border border-purple-100/50 p-4 rounded-2xl space-y-3.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-purple-950 uppercase tracking-widest font-mono">
                          Сдана копия (CHN 2/3)?
                        </span>
                        <input
                          type="checkbox"
                          checked={editIsCopy}
                          onChange={(e) => {
                            setEditIsCopy(e.target.checked);
                            if (e.target.checked && !editCopySubmittedAt) {
                              setEditCopySubmittedAt(new Date().toISOString().split("T")[0]);
                            }
                          }}
                          className="w-4 h-4 rounded text-purple-600 border-slate-300 focus:ring-purple-500 cursor-pointer"
                        />
                      </div>

                      {editIsCopy && (
                        <div>
                          <label className="text-[10px] font-black text-purple-700 uppercase tracking-widest block font-mono">
                            Дата сдачи копии
                          </label>
                          <input
                            type="date"
                            value={editCopySubmittedAt}
                            onChange={(e) => setEditCopySubmittedAt(e.target.value)}
                            className="block w-full mt-1.5 px-3 py-2 bg-white border border-purple-200 rounded-xl text-xs font-black text-purple-950 focus:outline-none focus:border-purple-450 transition"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="pt-3 border-t border-slate-200/55 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(null);
                    setIsCreatorOpen(false);
                  }}
                  className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-extrabold text-slate-700 transition cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] font-black rounded-xl text-xs uppercase tracking-wide cursor-pointer transition shadow-sm"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isBatchCreatorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-md flex justify-center items-center p-4">
          <div className="bg-white rounded-[2.2rem] max-w-md w-full shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-200/60 overflow-hidden">
            <div className="p-6 border-b border-slate-200/55 flex items-center justify-between select-none">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  Bulk Upload
                </span>
                <h2 className="text-base font-black text-slate-900 uppercase tracking-tight">
                  Массовый ввод дозволов
                </h2>
              </div>
              <button
                onClick={() => setIsBatchCreatorOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-xs font-black flex items-center justify-center cursor-pointer transition"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleBatchCreate} className="p-6 space-y-5">
              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  Вид дозвола
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                >
                  {customTypesOrder.map(id => {
                      const t = customTypes[id];
                      if (!t) return null;
                      return <option key={id} value={t.name}>{t.name}</option>;
                  })}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                  Список серийных номеров (каждый с новой строки или через
                  запятую)
                </label>
                <textarea
                  required
                  placeholder="PL-001&#10;PL-002&#10;PL-003"
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs h-32 resize-none focus:outline-none focus:bg-white focus:border-slate-300 transition font-mono"
                />
              </div>

              <div className="pt-3 border-t border-slate-200/55 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsBatchCreatorOpen(false)}
                  className="px-4 py-2.5 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-extrabold text-slate-700 transition cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-5 py-2.5 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] font-black rounded-xl text-xs uppercase tracking-wide cursor-pointer transition shadow-sm"
                >
                  Загрузить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <datalist id="fleet-cars-dl">
        {Object.keys(unifiedFleetCars).map(c => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

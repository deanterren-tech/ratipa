import { useDialog } from "../../DialogProvider";
import React, { useState, useEffect, useMemo } from "react";
import { UserProfile } from "../../../types";
import { useFirebase, database } from "../../../firebase";
import { ref, onValue, set, push, update, remove } from "firebase/database";
import { Trash2, Search, Plus, Edit, X } from "lucide-react";
import DozvolaWidgets from "./DozvolaWidgets";
import DozvolaAIAssistant from "./DozvolaAIAssistant";
import CouplingPicker from "../common/CouplingPicker";

const standardLocations = [
  "Офис Минск",
  "Офис Бяла-Подляска",
  "Офис Смоленск",
  "В рейсе",
  "На границе",
  "СВХ"
];

const isLocation = (val: string) => {
  const v = val.trim();
  if (!v) return false;
  if (standardLocations.map(l => l.toLowerCase()).includes(v.toLowerCase())) return true;
  const locKeywords = ["офис", "рейс", "руках", "свх", "граница", "склад", "транзит", "локация"];
  if (locKeywords.some(keyword => v.toLowerCase().includes(keyword))) return true;
  if (!/\d/.test(v)) return true;
  return false;
};

interface DozvolaRegistryListProps {
  user: UserProfile;
}

const DozvolaRow = React.memo(({
  item,
  isChecked,
  onCheckboxChange,
  showTypeColumn,
  onCommentChange,
  onCommentFocus,
  onCommentBlur,
  onCarChange,
  onCarFocus,
  onCarBlur,
  onToggleCopy,
  onUpdateStatus,
  onEdit,
  onDelete,
  canWrite,
  isRootAdmin
}: {
  item: any;
  isChecked: boolean;
  onCheckboxChange: (checked: boolean) => void;
  showTypeColumn: boolean;
  onCommentChange: (val: string) => void;
  onCommentFocus: (val: string) => void;
  onCommentBlur: (val: string) => void;
  onCarChange: (val: string) => void;
  onCarFocus: (val: string) => void;
  onCarBlur: (val: string) => void;
  onToggleCopy: (isSubmitted: boolean) => void;
  onUpdateStatus: (status: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  canWrite: boolean;
  isRootAdmin: boolean;
}) => {
  return (
    <tr
      className={`hover:bg-slate-50/40 border-b border-slate-100 last:border-0 transition ${
        item.isCopy &&
        item.status !== "office_return" &&
        item.status !== "used" &&
        item.status !== "expired"
          ? "bg-amber-50/30"
          : ""
      }`}
    >
      <td className="p-4 pl-6">
        <input
          type="checkbox"
          className="w-4.5 h-4.5 rounded-lg border-slate-200/60 text-[#3765F6] focus:ring-[#3765F6] cursor-pointer accent-[#3765F6] transition"
          checked={isChecked}
          onChange={(e) => onCheckboxChange(e.target.checked)}
        />
      </td>
      {showTypeColumn && (
        <td className="p-4">
          <span className="font-bold text-[#3765F6] bg-blue-50/60 border border-blue-100/30 px-2.5 py-1 rounded-xl text-[11px]">
            {item.type}
          </span>
        </td>
      )}
      <td className="p-4">
        <span className="font-bold text-slate-950 font-mono text-[13px] block mb-0.5">
          {item.number || item.permitNumber}
        </span>
        <input
          type="text"
          value={item.comment || item.comments || ""}
          className="w-full bg-transparent border-none text-[10px] text-slate-400 italic focus:outline-none focus:ring-1 focus:ring-slate-100 rounded px-1 -ml-1"
          placeholder="📝 Примечание..."
          onChange={(e) => onCommentChange(e.target.value)}
          onFocus={(e) => onCommentFocus(e.target.value)}
          onBlur={(e) => onCommentBlur(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
        />
      </td>
      <td className="p-4 text-xs font-semibold text-slate-500 font-mono">
        {item.issueDate
          ? new Date(item.issueDate).toLocaleDateString("ru-RU")
          : "—"}
      </td>
      <td className="p-4">
        {item.status === "office" && (
          <span className="bg-emerald-50 text-emerald-600 border border-emerald-100/50 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">
            В офисе
          </span>
        )}
        {item.status === "hand" && (
          <span className="bg-blue-50 text-blue-600 border border-blue-100/50 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">
            В рейсе
          </span>
        )}
        {item.status === "office_return" && (
          <span className="bg-amber-50 text-amber-600 border border-amber-100/50 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">
            Сдан в офис
          </span>
        )}
        {item.status === "used" && (
          <span className="bg-[#fef3c7]/60 text-[#b45309] border border-amber-200/50 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">
            Сдан в ТИ
          </span>
        )}
        {item.status === "expired" && (
          <span className="bg-rose-50 text-rose-600 border border-rose-100/50 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">
            Аннулирован
          </span>
        )}
        {item.status === "available" && (
          <span className="bg-emerald-50 text-emerald-600 border border-emerald-100/50 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">
            В наличии
          </span>
        )}
      </td>
      <td className="p-4">
        <input
          type="text"
          className="w-[120px] px-3 py-2 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold focus:outline-none focus:border-[#3765F6] focus:bg-white transition"
          value={item.car || item.assignedVehicle || ""}
          onChange={(e) => onCarChange(e.target.value)}
          onFocus={(e) => onCarFocus(e.target.value)}
          onBlur={(e) => onCarBlur(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          list="fleet-cars-dl"
        />
      </td>
      <td className="p-4">
        {item.type === "CHN 2" || item.type === "CHN 3" ? (
          <div className="flex flex-col gap-1">
            {item.isCopy ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={() => onToggleCopy(true)}
                  className="bg-purple-50 text-purple-600 border border-purple-100/50 font-semibold text-[10px] uppercase px-2 py-0.5 rounded-lg cursor-pointer hover:bg-purple-100 transition"
                >
                  📋 Сдана
                </button>
                {(() => {
                  if (
                    item.status === "used" ||
                    item.status === "expired"
                  )
                    return null;
                  const baseDateStr =
                    item.copySubmittedAt ||
                    item.issueDate ||
                    new Date().toISOString().split("T")[0];
                  const baseDate = new Date(baseDateStr);
                  const targetDate = new Date(
                    baseDate.getTime() + 30 * 24 * 60 * 60 * 1000,
                  );
                  targetDate.setHours(0, 0, 0, 0);
                  const today = new Date();
                  today.setHours(0, 0, 0, 0);
                  const diffTime =
                    targetDate.getTime() - today.getTime();
                  const daysLeft = Math.ceil(
                    diffTime / (1000 * 60 * 60 * 24),
                  );

                  if (daysLeft < 0) {
                    return (
                      <span className="text-rose-600 bg-rose-50 border border-rose-100/55 text-[9px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono animate-pulse">
                        🔥 Просрочено {Math.abs(daysLeft)} дн.!
                      </span>
                    );
                  } else if (daysLeft === 0) {
                    return (
                      <span className="text-amber-600 bg-amber-50 border border-amber-200/55 text-[9px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono animate-bounce">
                        ⚠️ Крайний день!
                      </span>
                    );
                  } else if (daysLeft <= 10) {
                    return (
                      <span className="text-amber-500 bg-amber-50 border border-amber-100/55 text-[9px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono">
                        ⌛ {daysLeft} дней
                      </span>
                    );
                  } else {
                    return (
                      <span className="text-purple-600 bg-purple-50 border border-purple-100/55 text-[9px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono">
                        ⌛ {daysLeft} дн.
                      </span>
                    );
                  }
                })()}
              </div>
            ) : (
              <button
                onClick={() => onToggleCopy(false)}
                className="bg-slate-100 text-slate-500 font-semibold text-[10px] uppercase px-2.5 py-1 rounded-lg cursor-pointer hover:bg-slate-200 transition w-max"
              >
                ❌ Нет копии
              </button>
            )}
          </div>
        ) : (
          <span className="text-slate-300 font-medium text-[11px]">
            —
          </span>
        )}
      </td>
      <td className="p-4 whitespace-nowrap">
        {item.isCopy && item.copySubmittedAt ? (
          <div className="font-mono text-xs text-slate-500 font-semibold">
            {new Date(item.copySubmittedAt).toLocaleDateString(
              "ru-RU",
            )}
          </div>
        ) : (
          <span className="text-slate-300 font-medium text-[11px]">
            —
          </span>
        )}
      </td>
      <td className="p-4">
        <select
          className="w-[120px] px-3 py-2 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold focus:outline-none focus:border-[#3765F6] transition cursor-pointer"
          onChange={(e) => {
            if (e.target.value)
              onUpdateStatus(e.target.value);
            e.target.value = ""; // reset after selection
          }}
        >
          <option value="">Действие...</option>
          <option value="office">В офис</option>
          <option value="hand">Выдать в рейс</option>
          <option value="office_return">Сдан в офис</option>
          <option value="used">Сдан в ТИ</option>
          <option value="expired">Аннулировать</option>
        </select>
      </td>
      <td className="p-4 pr-6 text-right">
        <div className="flex items-center justify-end gap-1.5">
          {canWrite && (
            <button
              onClick={onEdit}
              className="w-8 h-8 flex items-center justify-center text-[#3765F6] hover:bg-blue-50 rounded-xl transition cursor-pointer"
              title="Редактировать параметры бланка"
            >
              <Edit className="h-4 w-4" />
            </button>
          )}
          {(isRootAdmin || canWrite) && (
            <button
              onClick={onDelete}
              className="w-8 h-8 flex items-center justify-center text-rose-500 hover:bg-rose-50 rounded-xl transition cursor-pointer"
              title="Удалить"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
});

export default function DozvolaRegistryList({
  user,
}: DozvolaRegistryListProps) {
  const { showConfirm } = useDialog();
  const [dozvolsData, setDozvolsData] = useState<Record<string, any>>({});
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [customTypesOrder, setCustomTypesOrder] = useState<string[]>([]);
  const [knownFleetCars, setKnownFleetCars] = useState<Record<string, any>>({});
  const [bazaCars, setBazaCars] = useState<any[]>([]);
  const [locationsDB, setLocationsDB] = useState<Record<string, any>>({});
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [quotaTypesPercents, setQuotaTypesPercents] = useState<
    Record<string, number>
  >({});
  const [quotaQuarterLimits, setQuotaQuarterLimits] = useState<
    Record<string, number>
  >({});
  const [quotaGlobalDriversCount, setQuotaGlobalDriversCount] = useState(0);
  const [typesDeadlineDays, setTypesDeadlineDays] = useState<
    Record<string, number>
  >({});

  const [currentSelectedTab, setCurrentSelectedTab] = useState("all");
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInputValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInputValue]);

  const [selectedCountryFilter, setSelectedCountryFilter] = useState("all");

  const [isCreatorOpen, setIsCreatorOpen] = useState(false);
  const [isBatchCreatorOpen, setIsBatchCreatorOpen] = useState(false);
  const [batchText, setBatchText] = useState("");
  const [country, setCountry] = useState("Польша");
  const [type, setType] = useState("Транзитный двусторонний");
  const [permitNumber, setPermitNumber] = useState("");
  const [comments, setComments] = useState("");

  const [currentSortField, setCurrentSortField] = useState("issueDate");
  const [currentSortOrder, setCurrentSortOrder] = useState<"asc" | "desc">(
    "desc",
  );
  const [originalCars, setOriginalCars] = useState<Record<string, string>>({});
  const [originalComments, setOriginalComments] = useState<
    Record<string, string>
  >({});

  const [editingItem, setEditingItem] = useState<any>(null);
  const [editStatus, setEditStatus] = useState("available");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [editCar, setEditCar] = useState("");
  const [editIsCopy, setEditIsCopy] = useState(false);
  const [editCopySubmittedAt, setEditCopySubmittedAt] = useState("");
  const [editIssueDate, setEditIssueDate] = useState("");

  useEffect(() => {
    if (editingItem) {
      setType(editingItem.type || "");
      setPermitNumber(editingItem.number || editingItem.permitNumber || "");
      setComments(editingItem.comment || editingItem.comments || "");
      setEditStatus(editingItem.status || "available");
      setEditCar(editingItem.car || "");
      setEditIsCopy(editingItem.isCopy || false);
      setEditCopySubmittedAt(editingItem.copySubmittedAt || "");
      setEditIssueDate(editingItem.issueDate || new Date().toISOString().split("T")[0]);
    } else {
      setComments("");
      setPermitNumber("");
      setEditStatus("available");
      setEditCar("");
      setEditIsCopy(false);
      setEditCopySubmittedAt("");
      setEditIssueDate("");
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
    listen("dozvolsTypesOrderV4", (val) =>
      setCustomTypesOrder(Array.isArray(val) ? val : Object.keys(val || {})),
    );
    listen("knownFleetCars", setKnownFleetCars);
    listen("quotaTypesPercents", setQuotaTypesPercents);
    listen("quotaTypesQuarterLimits", setQuotaQuarterLimits);
    listen("typesDeadlineDaysV1", setTypesDeadlineDays);
    listen("locationsDB", setLocationsDB);

    const bzRef = ref(database, "baza_cars");
    const unsubBz = onValue(bzRef, (snap) => {
      const val = snap.val() || {};
      const list = Object.keys(val).map((id) => ({ id, ...val[id] }));
      setBazaCars(list);
    });
    subs.push(() => unsubBz());

    const kfRef = ref(database, "known_fleet");
    const unsubKf = onValue(kfRef, (snap) => {
      const val = snap.val() || {};
      const list = Object.values(val).map((v: any) => String(v).trim().toUpperCase()).filter(Boolean);
      setKnownFleet(list);
    });
    subs.push(() => unsubKf());

    const drvRef = ref(database, "quotaGlobalDriversCount");
    const unsubDrv = onValue(drvRef, (snap) =>
      setQuotaGlobalDriversCount(snap.val() || 0),
    );
    subs.push(() => unsubDrv());

    return () => subs.forEach((s) => s());
  }, []);

  const verifyOrCreateCar = async (carNum: string) => {
    if (!carNum || carNum.trim() === "") return;
    const cleanCar = carNum.trim().toUpperCase();
    
    const isDynamicLocation = Object.values(locationsDB).some((loc: any) => loc.name && loc.name.trim().toLowerCase() === carNum.trim().toLowerCase());
    if (isDynamicLocation || isLocation(carNum)) return;

    if (!knownFleetCars[cleanCar]) {
      if (useFirebase) set(ref(database, "knownFleetCars/" + cleanCar), true);
    }
    if (!knownFleet.includes(cleanCar)) {
      if (useFirebase) push(ref(database, "known_fleet"), cleanCar);
    }
  };

  const getStatusLabel = (status: string) => {
    const map: any = {
      office: "В офисе",
      available: "В наличии",
      hand: "В рейсе / на руках",
      office_return: "Сдан в офис",
      used: "Сдан в транспортную инспекцию",
      expired: "Аннулирован",
    };
    return map[status] || status || "—";
  };

  const logAction = (
    lType: string,
    lNum: string,
    action: string,
    meta: string,
  ) => {
    if (!useFirebase) return;
    const logist =
      localStorage.getItem("ratipa_auth_user") || user?.name || "Система";
    push(ref(database, "dozvolsHistoryV4"), {
      time: new Date().toLocaleString("ru-RU"),
      logist,
      doc: `${lType} №${lNum}`,
      action,
      meta,
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
        const isDynamicLoc = Object.values(locationsDB).some((loc: any) => loc.name && loc.name.trim().toLowerCase() === editCar.trim().toLowerCase());
        update(ref(database, `dozvolsRegistryV4/${editingItem.id}`), {
          type,
          number: permitNumber.trim().toUpperCase(),
          status: editStatus,
          car: editStatus === "office" ? "Минск офис" : (isDynamicLoc || isLocation(editCar)) ? editCar : editCar.toUpperCase(),
          comment: comments,
          isCopy: editIsCopy,
          copySubmittedAt: editIsCopy
            ? editCopySubmittedAt || new Date().toISOString().split("T")[0]
            : null,
          issueDate: editIssueDate || new Date().toISOString().split("T")[0],
        });

        let diffs = [];
        if (editingItem.type !== type)
          diffs.push(`Вид: [${editingItem.type}] ➔ [${type}]`);
        if (editingItem.number !== permitNumber)
          diffs.push(
            `Номер: [${editingItem.number}] ➔ [${permitNumber.trim().toUpperCase()}]`,
          );
        if (editingItem.status !== editStatus)
          diffs.push(
            `Статус: [${getStatusLabel(editingItem.status)}] ➔ [${getStatusLabel(editStatus)}]`,
          );
        if (editingItem.car !== editCar)
          diffs.push(
            `Автомобиль: [${editingItem.car || "—"}] ➔ [${editCar || "—"}]`,
          );
        if (editingItem.comment !== comments) diffs.push(`Примечание изменено`);
        if (editingItem.issueDate !== editIssueDate)
          diffs.push(
            `Дата выдачи: [${editingItem.issueDate || "—"}] ➔ [${editIssueDate || "—"}]`,
          );

        logAction(
          type,
          permitNumber.trim().toUpperCase(),
          "Изменение через форму",
          diffs.join(" | ") || "Изменение параметров формы",
        );
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
        const newKey = push(ref(database, "dozvolsRegistryV4")).key;
        if (newKey) {
          set(ref(database, "dozvolsRegistryV4/" + newKey), {
            id: newKey,
            country,
            type,
            number: permitNumber.trim().toUpperCase(),
            status: "available",
            issueDate: new Date().toISOString().split("T")[0],
            car: "",
            comment: comments,
            isCopy: false,
          });
          logAction(
            type,
            permitNumber.trim().toUpperCase(),
            "Ручное внесение",
            `Статус: ${getStatusLabel("available")}`,
          );
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

    const numbers = batchText
      .split(/[\n,;]+/)
      .map((n) => n.trim().toUpperCase())
      .filter((n) => n);
    if (numbers.length === 0) return;

    let addedCount = 0;
    numbers.forEach((num) => {
      if (useFirebase) {
        const newKey = push(ref(database, "dozvolsRegistryV4")).key;
        if (newKey) {
          set(ref(database, "dozvolsRegistryV4/" + newKey), {
            id: newKey,
            country,
            type,
            number: num,
            status: "office",
            issueDate: new Date().toISOString().split("T")[0],
            car: "",
            comment: "Массовый ввод",
            isCopy: false,
          });
          logAction(
            type,
            num,
            "Массовый ввод",
            `Статус: ${getStatusLabel("office")}`,
          );
        }
      }
      addedCount++;
    });

    setIsBatchCreatorOpen(false);
    setBatchText("");
    alert(`Успешно добавлено дозволов: ${addedCount}`);
  };

  const handleDeletePermit = async (id: string) => {
    if (
      await showConfirm(
        "Вы желаете совсем убрать этот дозвол из общего перечня?",
      )
    ) {
      const perm = dozvolsData[id];
      if (perm)
        logAction(
          perm.type,
          perm.number || perm.permitNumber,
          "Удаление бланка",
          "Бланк удален из реестра",
        );
      if (useFirebase) remove(ref(database, `dozvolsRegistryV4/${id}`));
    }
  };

  const updateDozvolStatusInline = (id: string, newStatus: string) => {
    if (!newStatus) return;
    const old = dozvolsData[id];
    if (useFirebase && old) {
      const updates: any = { status: newStatus };
      if (newStatus === "office") {
        updates.car = "Минск офис";
      }
      update(ref(database, `dozvolsRegistryV4/${id}`), updates);
      logAction(
        old.type,
        old.number,
        "Изменен статус",
        `Статус: [${getStatusLabel(old.status)}] ➔ [${getStatusLabel(newStatus)}]${newStatus === "office" ? " (Локация: Минск офис)" : ""}`,
      );
    }
  };

  const handleBulkStatusChange = async (newStatus: string) => {
    if (!newStatus || selectedItems.size === 0) return;
    if (useFirebase) {
      const updates: Record<string, any> = {};
      selectedItems.forEach((id) => {
        const old = dozvolsData[id];
        if (old) {
          updates[`dozvolsRegistryV4/${id}/status`] = newStatus;
          if (newStatus === "office") {
            updates[`dozvolsRegistryV4/${id}/car`] = "Минск офис";
          }
          logAction(
            old.type,
            old.number || old.permitNumber,
            "Массовое изменение статуса",
            `Статус: [${getStatusLabel(old.status)}] ➔ [${getStatusLabel(newStatus)}]${newStatus === "office" ? " (Локация: Минск офис)" : ""}`,
          );
        }
      });
      await update(ref(database), updates);
    }
    setSelectedItems(new Set());
    alert(`Статус успешно изменен для ${selectedItems.size} бланков.`);
  };

  useEffect(() => {
    setSelectedItems(new Set());
  }, [currentSelectedTab, searchQuery, selectedCountryFilter]);

  const handleInlineCarChangeOnly = (id: string, newCar: string) => {
    if (useFirebase) {
      const isDynamicLoc = Object.values(locationsDB).some((loc: any) => loc.name && loc.name.trim().toLowerCase() === newCar.trim().toLowerCase());
      const val = (isDynamicLoc || isLocation(newCar)) ? newCar : newCar.toUpperCase();
      update(ref(database, `dozvolsRegistryV4/${id}`), {
        car: val,
      });
    }
  };

  const handleCarFocus = (id: string, currentVal: string) => {
    const isDynamicLoc = Object.values(locationsDB).some((loc: any) => loc.name && loc.name.trim().toLowerCase() === currentVal.trim().toLowerCase());
    const val = (isDynamicLoc || isLocation(currentVal)) ? currentVal.trim() : currentVal.trim().toUpperCase();
    setOriginalCars((prev) => ({
      ...prev,
      [id]: val,
    }));
  };

  const handleCarBlur = async (id: string, currentVal: string) => {
    const orig = originalCars[id] !== undefined ? originalCars[id] : "";
    const isDynamicLoc = Object.values(locationsDB).some((loc: any) => loc.name && loc.name.trim().toLowerCase() === currentVal.trim().toLowerCase());
    const newVal = (isDynamicLoc || isLocation(currentVal)) ? currentVal.trim() : currentVal.trim().toUpperCase();

    if (orig === newVal) return;

    const old = dozvolsData[id];
    if (useFirebase && old) {
      const oldCar = orig || "—";
      const displayNewCar = newVal || "—";

      if (newVal) {
        await verifyOrCreateCar(newVal);
        logAction(
          old.type,
          old.number,
          "Изменена машина / локация",
          `Автомобиль: [${oldCar}] ➔ [${displayNewCar}]`,
        );
      } else {
        logAction(
          old.type,
          old.number,
          "Удалена машина",
          `Автомобиль [${oldCar}] отвязан`,
        );
      }
    }

    setOriginalCars((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const updateDozvolCommentInline = (id: string, newComment: string) => {
    if (useFirebase)
      update(ref(database, `dozvolsRegistryV4/${id}`), { comment: newComment });
  };

  const handleCommentFocus = (id: string, currentVal: string) => {
    setOriginalComments((prev) => ({ ...prev, [id]: currentVal.trim() }));
  };

  const handleCommentBlur = (id: string, currentVal: string) => {
    const orig = originalComments[id] !== undefined ? originalComments[id] : "";
    const newVal = currentVal.trim();
    if (orig === newVal) return;

    const old = dozvolsData[id];
    if (useFirebase && old) {
      logAction(
        old.type,
        old.number,
        "Изменено примечание",
        `Примечание: [${orig || "—"}] ➔ [${newVal || "—"}]`,
      );
    }

    setOriginalComments((prev) => {
      const copy = { ...prev };
      delete copy[id];
      return copy;
    });
  };

  const toggleDozvolCopyInline = (id: string, currentCopyVal: boolean) => {
    const old = dozvolsData[id];
    if (!old || (old.type !== "CHN 2" && old.type !== "CHN 3")) return;
    const nextVal = !currentCopyVal;
    if (useFirebase) {
      update(ref(database, `dozvolsRegistryV4/${id}`), {
        isCopy: nextVal,
        copySubmittedAt: nextVal
          ? new Date().toISOString().split("T")[0]
          : null,
      });
      logAction(
        old.type,
        old.number,
        "Изменена отметка копии",
        `Копия сдана: [${currentCopyVal ? "Да" : "Нет"}] ➔ [${nextVal ? "Да" : "Нет"}]`,
      );
    }
  };

  const { rawItems, total, office, hand, officeReturnCount, usedCount, expiredCount, copies } = useMemo(() => {
    let raw = Object.entries(dozvolsData).map(([key, value]: [string, any]) => ({
      id: key,
      ...value
    })) as any[];
    if (
      currentSelectedTab !== "all" &&
      currentSelectedTab !== "archive" &&
      currentSelectedTab !== "office_returns"
    ) {
      raw = raw.filter((i) => i.type === currentSelectedTab);
    }

    const totalVal = raw.length;
    const officeVal = raw.filter(
      (i) => i.status === "office" || i.status === "available",
    ).length;
    const handVal = raw.filter(
      (i) => i.status === "hand" || i.status === "office_return",
    ).length;
    const officeReturnCountVal = raw.filter(
      (i) => i.status === "office_return",
    ).length;
    const usedCountVal = raw.filter(
      (i) => i.status === "used",
    ).length;
    const expiredCountVal = raw.filter(
      (i) => i.status === "expired",
    ).length;
    const copiesVal = raw.filter(
      (i) =>
        i.isCopy === true &&
        i.status !== "office_return" &&
        i.status !== "used" &&
        i.status !== "expired",
    ).length;

    return {
      rawItems: raw,
      total: totalVal,
      office: officeVal,
      hand: handVal,
      officeReturnCount: officeReturnCountVal,
      usedCount: usedCountVal,
      expiredCount: expiredCountVal,
      copies: copiesVal
    };
  }, [dozvolsData, currentSelectedTab]);

  const items = useMemo(() => {
    let list = rawItems;
    if (currentSelectedTab === "archive") {
      list = list.filter((i) => i.status === "used" || i.status === "expired");
    } else if (currentSelectedTab === "office_returns") {
      list = list.filter((i) => i.status === "office_return");
    } else {
      list = list.filter(
        (i) =>
          i.status !== "used" &&
          i.status !== "expired" &&
          i.status !== "office_return",
      );
    }

    if (selectedCountryFilter !== "all") {
      if (selectedCountryFilter === "copy_yes")
        list = list.filter(
          (i) =>
            i.isCopy === true &&
            i.status !== "office_return" &&
            i.status !== "used" &&
            i.status !== "expired",
        );
      else if (selectedCountryFilter === "copy_no")
        list = list.filter(
          (i) =>
            i.isCopy === false ||
            i.status === "office_return" ||
            i.status === "used" ||
            i.status === "expired",
        );
      else list = list.filter((i) => i.status === selectedCountryFilter);
    }

    if (searchQuery) {
      const s = searchQuery.toLowerCase();
      list = list.filter(
        (i) =>
          (i.number || i.permitNumber || "").toLowerCase().includes(s) ||
          (i.car || i.assignedVehicle || "").toLowerCase().includes(s) ||
          (i.comment || i.comments || "").toLowerCase().includes(s) ||
          (i.type || "").toLowerCase().includes(s),
      );
    }

    const sorted = [...list];
    sorted.sort((a, b) => {
      let valA = a[currentSortField] || "";
      let valB = b[currentSortField] || "";
      if (typeof valA === "string") valA = valA.toUpperCase();
      if (typeof valB === "string") valB = valB.toUpperCase();
      if (valA < valB) return currentSortOrder === "asc" ? -1 : 1;
      if (valA > valB) return currentSortOrder === "asc" ? 1 : -1;
      return 0;
    });

    return sorted;
  }, [rawItems, currentSelectedTab, selectedCountryFilter, searchQuery, currentSortField, currentSortOrder]);

  const showTypeColumn =
    currentSelectedTab === "all" ||
    currentSelectedTab === "archive" ||
    currentSelectedTab === "office_returns";

  const dynamicLocationsMap: Record<string, boolean> = Object.values(locationsDB || {}).reduce<Record<string, boolean>>((acc, curr: any) => {
    if (curr && curr.name) {
      acc[curr.name.trim()] = true;
    }
    return acc;
  }, {});

  const unifiedFleetCars = {
    ...knownFleetCars,
    ...bazaCars.reduce((acc: Record<string, boolean>, curr: any) => {
      if (curr.carNumber) {
        acc[curr.carNumber.trim().toUpperCase()] = true;
      }
      return acc;
    }, {} as Record<string, boolean>),
    ...dynamicLocationsMap
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
              if (prefilledChanges.number)
                setPermitNumber(prefilledChanges.number);
              if (prefilledChanges.comment !== undefined)
                setComments(prefilledChanges.comment || "");
              if (prefilledChanges.status)
                setEditStatus(prefilledChanges.status);
              if (prefilledChanges.car !== undefined)
                setEditCar(prefilledChanges.car || "");
            }
            setIsCreatorOpen(true);
          }}
        />

        <div className="bg-white/80 backdrop-blur-xl rounded-3xl p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col md:flex-row items-center justify-between gap-6">
          <div>
            <h2 className="text-sm font-bold text-slate-800">
              Реестр дозволов
            </h2>
          </div>

          <div className="flex items-center gap-2.5">
            {user.permissions.dozvola === "write" && (
              <button
                onClick={() => setIsBatchCreatorOpen(true)}
                className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-4 py-2.5 rounded-xl transition cursor-pointer"
              >
                Массовый ввод
              </button>
            )}
            {user.permissions.dozvola === "write" && (
              <button
                onClick={() => setIsCreatorOpen(true)}
                className="flex items-center gap-1.5 bg-[#3765F6] hover:bg-[#2555E5] text-white text-xs font-semibold px-4 py-2.5 rounded-xl transition cursor-pointer shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Зарегистрировать
              </button>
            )}
          </div>
        </div>

        <div className="flex justify-between items-end mt-4 flex-wrap gap-2 bg-slate-50/30 rounded-t-3xl border border-slate-200/40 border-b-0 pt-2 px-2">
          <div className="flex items-end gap-1 overflow-x-auto custom-scrollbar flex-1 pb-1">
            <button
              onClick={() => setCurrentSelectedTab("all")}
              className={
                "px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-t-xl transition whitespace-nowrap cursor-pointer " +
                (currentSelectedTab === "all"
                  ? "bg-white text-slate-850 border border-slate-200/50 border-b-white -mb-[1px] relative z-10"
                  : "text-slate-500 hover:bg-slate-100/50 hover:text-slate-700")
              }
            >
              🌐 Все виды
            </button>
            {customTypesOrder.map((id) => {
              const t = customTypes[id];
              if (!t) return null;
              return (
                <button
                  key={id}
                  onClick={() => setCurrentSelectedTab(t.name)}
                  className={
                    "px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-t-xl transition whitespace-nowrap cursor-pointer " +
                    (currentSelectedTab === t.name
                      ? "bg-white text-slate-850 border border-slate-200/50 border-b-white -mb-[1px] relative z-10"
                      : "text-slate-500 hover:bg-slate-100/50 hover:text-slate-700")
                  }
                >
                  {t.name}
                </button>
              );
            })}
            <button
              onClick={() => setCurrentSelectedTab("archive")}
              className={
                "px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-t-xl transition whitespace-nowrap cursor-pointer text-slate-400 " +
                (currentSelectedTab === "archive"
                  ? "bg-white !text-slate-850 border border-slate-200/50 border-b-white -mb-[1px] relative z-10"
                  : "hover:bg-slate-100/50 hover:!text-slate-650")
              }
            >
              📦 Архив / Инспекция
            </button>
            <button
              onClick={() => setCurrentSelectedTab("office_returns")}
              className={
                "px-4 py-2.5 text-xs font-semibold uppercase tracking-wider rounded-t-xl transition whitespace-nowrap cursor-pointer text-amber-600 " +
                (currentSelectedTab === "office_returns"
                  ? "bg-white !text-slate-850 border border-slate-200/50 border-b-white -mb-[1px] relative z-10"
                  : "hover:bg-slate-100/50 hover:!text-slate-750")
              }
            >
              🟡 Сданы в офис
            </button>
          </div>
        </div>

        <div className="bg-white/80 backdrop-blur-xl rounded-b-3xl rounded-tr-3xl border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden -mt-[1px] relative z-0">
          <div className="p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full flex-1">
              <Search className="h-4 w-4 text-slate-400 absolute left-4 top-3.5" />
              <input
                type="text"
                placeholder="Быстрый поиск по бланку, машине или комментарию..."
                value={searchInputValue}
                onChange={(e) => setSearchInputValue(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-850 focus:outline-none focus:bg-white focus:border-[#3765F6] transition"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              {selectedItems.size > 0 &&
                (user.permissions.dozvola === "write" ||
                  user.role === "root_admin") && (
                  <div className="w-full sm:w-[220px]">
                    <select
                      value=""
                      onChange={(e) => {
                        if (e.target.value) handleBulkStatusChange(e.target.value);
                      }}
                      className="w-full px-3.5 py-2.5 bg-amber-50 border border-amber-200 text-amber-700 rounded-xl text-xs font-semibold uppercase tracking-wider focus:outline-none transition cursor-pointer"
                    >
                      <option value="">Действие ({selectedItems.size} шт)</option>
                      <option value="office">В офис</option>
                      <option value="hand">Выдать в рейс</option>
                      <option value="office_return">Сдан в офис</option>
                      <option value="used">Сдан в ТИ</option>
                      <option value="expired">Аннулировать</option>
                    </select>
                  </div>
                )}

              <div className="w-full sm:w-[220px]">
                <select
                  value={selectedCountryFilter}
                  onChange={(e) => setSelectedCountryFilter(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] transition cursor-pointer"
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
          </div>

          {/* Swipe Help Badge for Mobile */}
          

          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-slate-50/50 border-y border-slate-200/50 text-[10px] uppercase font-semibold text-slate-400 tracking-wider">
                  <th className="p-4 pl-6 w-10">
                    <input
                      type="checkbox"
                      className="w-4.5 h-4.5 rounded-lg border-slate-200/60 text-[#3765F6] focus:ring-[#3765F6] cursor-pointer accent-[#3765F6] transition"
                      checked={
                        items.length > 0 &&
                        items.every((i) => selectedItems.has(i.id))
                      }
                      onChange={(e) => {
                        const newSet = new Set(selectedItems);
                        if (e.target.checked) {
                          items.forEach((i) => newSet.add(i.id));
                        } else {
                          items.forEach((i) => newSet.delete(i.id));
                        }
                        setSelectedItems(newSet);
                      }}
                    />
                  </th>
                  {showTypeColumn && (
                    <th
                      className="p-4 cursor-pointer hover:bg-slate-100/50 transition"
                      onClick={() => {
                        setCurrentSortField("type");
                        setCurrentSortOrder(
                          currentSortOrder === "asc" ? "desc" : "asc",
                        );
                      }}
                    >
                      Вид
                    </th>
                  )}
                  <th
                    className="p-4 cursor-pointer hover:bg-slate-100/50 transition"
                    onClick={() => {
                      setCurrentSortField("number");
                      setCurrentSortOrder(
                        currentSortOrder === "asc" ? "desc" : "asc",
                      );
                    }}
                  >
                    Номер дозвола
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:bg-slate-100/50 transition"
                    onClick={() => {
                      setCurrentSortField("issueDate");
                      setCurrentSortOrder(
                        currentSortOrder === "asc" ? "desc" : "asc",
                      );
                    }}
                  >
                    Дата выдачи
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:bg-slate-100/50 transition"
                    onClick={() => {
                      setCurrentSortField("status");
                      setCurrentSortOrder(
                        currentSortOrder === "asc" ? "desc" : "asc",
                      );
                    }}
                  >
                    Статус оригинала
                  </th>
                  <th
                    className="p-4 cursor-pointer hover:bg-slate-100/50 transition"
                    onClick={() => {
                      setCurrentSortField("car");
                      setCurrentSortOrder(
                        currentSortOrder === "asc" ? "desc" : "asc",
                      );
                    }}
                  >
                    Привязка к авто / Локация
                  </th>
                  <th className="p-4">Сдан по копии?</th>
                  <th
                    className="p-4 cursor-pointer hover:bg-slate-100/50 transition"
                    onClick={() => {
                      setCurrentSortField("copySubmittedAt");
                      setCurrentSortOrder(
                        currentSortOrder === "asc" ? "desc" : "asc",
                      );
                    }}
                  >
                    Дата сдачи по копии
                  </th>
                  <th className="p-4">Быстрый статус</th>
                  <th className="p-4 pr-6 text-right">Управление</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-[11px] font-semibold">
                {items.map((item) => (
                  <DozvolaRow
                    key={item.id}
                    item={item}
                    isChecked={selectedItems.has(item.id)}
                    onCheckboxChange={(checked) => {
                      const newSet = new Set(selectedItems);
                      if (checked) newSet.add(item.id);
                      else newSet.delete(item.id);
                      setSelectedItems(newSet);
                    }}
                    showTypeColumn={showTypeColumn}
                    onCommentChange={(val) => updateDozvolCommentInline(item.id, val)}
                    onCommentFocus={(val) => handleCommentFocus(item.id, val)}
                    onCommentBlur={(val) => handleCommentBlur(item.id, val)}
                    onCarChange={(val) => handleInlineCarChangeOnly(item.id, val)}
                    onCarFocus={(val) => handleCarFocus(item.id, val)}
                    onCarBlur={(val) => handleCarBlur(item.id, val)}
                    onToggleCopy={(isSubmitted) => toggleDozvolCopyInline(item.id, isSubmitted)}
                    onUpdateStatus={(status) => updateDozvolStatusInline(item.id, status)}
                    onEdit={() => {
                      setEditingItem(item);
                      setIsCreatorOpen(true);
                    }}
                    onDelete={() => handleDeletePermit(item.id)}
                    canWrite={user.permissions.dozvola === "write"}
                    isRootAdmin={user.role === "root_admin" || user.permissions?.dozvola === "write"}
                  />
                ))}
                {!items.length && (
                  <tr key="empty-row">
                    <td
                      colSpan={showTypeColumn ? 11 : 10}
                      className="text-center p-12 text-slate-400 bg-slate-50/10"
                    >
                      <div className="flex flex-col items-center justify-center gap-2">
                        <span className="text-3xl">📂</span>
                        <p className="text-xs uppercase font-black text-slate-500 tracking-tight">Нет данных</p>
                        <p className="text-[11px] text-slate-400 font-normal normal-case">Не найдено ни одного бланка дозвола по выбранным критериям</p>
                      </div>
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
          stats={{
            total,
            office,
            hand,
            usedCount,
            expiredCount,
            copies,
            officeReturnCount,
          }}
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
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-md flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200/50 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between select-none">
              <div>
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest block">
                  {editingItem ? "Edit Permit" : "Permit Form"}
                </span>
                <h2 className="text-sm font-bold text-slate-850">
                  {editingItem
                    ? "Редактирование бланка"
                    : "Ручной ввод бланка"}
                </h2>
              </div>
              <button
                onClick={() => {
                  setEditingItem(null);
                  setIsCreatorOpen(false);
                }}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center cursor-pointer transition"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleCreatePermit} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Вид дозвола
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] transition"
                >
                  {customTypesOrder.map((id) => {
                    const t = customTypes[id];
                    if (!t) return null;
                    return (
                      <option key={id} value={t.name}>
                        {t.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Номер бланка
                </label>
                <input
                  type="text"
                  required
                  placeholder="TR A 55432"
                  value={permitNumber}
                  onChange={(e) => setPermitNumber(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-450 focus:outline-none focus:bg-white focus:border-[#3765F6] transition"
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Сопутствующий комментарий
                </label>
                <textarea
                  placeholder="Добавьте примечание к бланку..."
                  value={comments}
                  onChange={(e) => setComments(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold h-16 resize-none focus:outline-none focus:bg-white focus:border-[#3765F6] transition"
                />
              </div>

              {editingItem && (
                <>
                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Статус бланка
                    </label>
                    <select
                      value={editStatus}
                      onChange={(e) => {
                        const val = e.target.value;
                        setEditStatus(val);
                        if (val === 'office') {
                          setEditCar('Минск офис');
                        }
                      }}
                      className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] transition"
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
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Автомобиль / Локация
                    </label>
                    <CouplingPicker
                      mode="combined"
                      locations={[...standardLocations, ...Object.values(locationsDB || {}).map((l: any) => l.name).filter(Boolean)]}
                      onSelect={(rec) => {
                        if (rec) setEditCar((rec.carNumber || rec.vehicleNumbers || rec)?.toUpperCase?.() || String(rec));
                      }}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                      Дата выдачи
                    </label>
                    <input
                      type="date"
                      value={editIssueDate}
                      onChange={(e) => setEditIssueDate(e.target.value)}
                      className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] transition"
                    />
                  </div>

                  {(type === "CHN 2" || type === "CHN 3") && (
                    <div className="bg-purple-50/20 border border-purple-100/40 p-4 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-purple-950 uppercase tracking-wider">
                          Сдана копия (CHN 2/3)?
                        </span>
                        <input
                          type="checkbox"
                          checked={editIsCopy}
                          onChange={(e) => {
                            setEditIsCopy(e.target.checked);
                            if (e.target.checked && !editCopySubmittedAt) {
                              setEditCopySubmittedAt(
                                new Date().toISOString().split("T")[0],
                              );
                            }
                          }}
                          className="w-4 h-4 rounded text-purple-600 border-slate-300 focus:ring-purple-500 cursor-pointer"
                        />
                      </div>

                      {editIsCopy && (
                        <div>
                          <label className="text-[10px] font-semibold text-purple-700 uppercase tracking-wider block">
                            Дата сдачи копии
                          </label>
                          <input
                            type="date"
                            value={editCopySubmittedAt}
                            onChange={(e) =>
                              setEditCopySubmittedAt(e.target.value)
                            }
                            className="block w-full mt-1.5 px-3 py-2 bg-white border border-purple-100 rounded-xl text-xs font-semibold text-purple-950 focus:outline-none focus:border-purple-400 transition"
                          />
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setEditingItem(null);
                    setIsCreatorOpen(false);
                  }}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-600 bg-white transition cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#3765F6] hover:bg-[#2555E5] text-white font-semibold rounded-xl text-xs transition shadow-sm cursor-pointer"
                >
                  Сохранить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isBatchCreatorOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/45 backdrop-blur-md flex justify-center items-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-slate-200/50 overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between select-none">
              <div>
                <span className="text-[9px] font-semibold text-slate-400 uppercase tracking-widest block">
                  Bulk Upload
                </span>
                <h2 className="text-sm font-bold text-slate-850">
                  Массовый ввод дозволов
                </h2>
              </div>
              <button
                onClick={() => setIsBatchCreatorOpen(false)}
                className="w-8 h-8 rounded-full bg-slate-50 hover:bg-slate-100 text-slate-500 text-xs font-semibold flex items-center justify-center cursor-pointer transition"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleBatchCreate} className="p-6 space-y-4">
              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Вид дозвола
                </label>
                <select
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] transition"
                >
                  {customTypesOrder.map((id) => {
                    const t = customTypes[id];
                    if (!t) return null;
                    return (
                      <option key={id} value={t.name}>
                        {t.name}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block leading-normal">
                  Список серийных номеров (каждый с новой строки или через
                  запятую)
                </label>
                <textarea
                  required
                  placeholder="PL-001&#10;PL-002&#10;PL-003"
                  value={batchText}
                  onChange={(e) => setBatchText(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs h-32 resize-none focus:outline-none focus:bg-white focus:border-[#3765F6] transition font-mono font-semibold"
                />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setIsBatchCreatorOpen(false)}
                  className="px-4 py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-600 bg-white transition cursor-pointer"
                >
                  Отмена
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#3765F6] hover:bg-[#2555E5] text-white font-semibold rounded-xl text-xs transition shadow-sm cursor-pointer"
                >
                  Загрузить
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <datalist id="fleet-cars-dl">
        {Object.keys(unifiedFleetCars).map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
    </div>
  );
}

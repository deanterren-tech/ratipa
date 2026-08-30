import React, { useState, useEffect } from 'react'
import { useToast } from '../../ToastProvider'
import CouplingPicker from '../../common/CouplingPicker'

interface DozvolaPermitModalProps {
  isOpen: boolean;
  onClose: () => void;
  editingItem: any | null;
  customTypes: Record<string, any>;
  customTypesOrder: string[];
  resolvedLocations: string[];
  dozvolsHistory?: Record<string, any>;
  onSave: (data: {
    type: string;
    permitNumber: string;
    comments: string;
    editStatus: string;
    editCar: string;
    editCouplingId: string;
    editDriverName: string;
    editIsCopy: boolean;
    editCopySubmittedAt: string;
    editIssueDate: string;
    editExpiryDate: string;
  }) => Promise<void>;
}

export default function DozvolaPermitModal({
  isOpen,
  onClose,
  editingItem,
  customTypes,
  customTypesOrder,
  resolvedLocations,
  dozvolsHistory = {},
  onSave,
}: DozvolaPermitModalProps) {
  const { toast } = useToast();

  const [type, setType] = useState("Транзитный двусторонний");
  const [permitNumber, setPermitNumber] = useState("");
  const [comments, setComments] = useState("");
  const [editStatus, setEditStatus] = useState("available");
  const [editCar, setEditCar] = useState("");
  const [editCouplingId, setEditCouplingId] = useState("");
  const [editDriverName, setEditDriverName] = useState("");
  const [editIsCopy, setEditIsCopy] = useState(false);
  const [editCopySubmittedAt, setEditCopySubmittedAt] = useState("");
  const [editIssueDate, setEditIssueDate] = useState("");
  const [editExpiryDate, setEditExpiryDate] = useState("");

  useEffect(() => {
    if (editingItem) {
      setType(editingItem.type || "");
      setPermitNumber(editingItem.number || editingItem.permitNumber || "");
      setComments(editingItem.comment || editingItem.comments || "");
      setEditStatus(editingItem.status || "available");
      setEditCar(editingItem.car || "");
      setEditCouplingId(editingItem.couplingId || "");
      setEditDriverName(editingItem.driverName || "");
      setEditIsCopy(editingItem.isCopy || false);
      setEditCopySubmittedAt(editingItem.copySubmittedAt || "");
      setEditIssueDate(editingItem.issueDate || new Date().toISOString().split("T")[0]);
      setEditExpiryDate(editingItem.expiryDate || "");
    } else {
      setComments("");
      setPermitNumber("");
      setEditStatus("available");
      setEditCar("");
      setEditCouplingId("");
      setEditDriverName("");
      setEditIsCopy(false);
      setEditCopySubmittedAt("");
      setEditIssueDate("");
      setEditExpiryDate("");
    }
  }, [editingItem]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permitNumber.trim()) {
      toast("Пожалуйста, заполните уникальный серийный номер бланка дозвола.", 'info');
      return;
    }
    await onSave({
      type,
      permitNumber: permitNumber.trim().toUpperCase(),
      comments,
      editStatus,
      editCar,
      editCouplingId,
      editDriverName,
      editIsCopy,
      editCopySubmittedAt,
      editIssueDate,
      editExpiryDate,
    });
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/45 flex justify-center items-center p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-sm border border-slate-200/50 my-4">
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
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition cursor-pointer"
          >
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
              Вид дозвола
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition"
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
              className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 placeholder:text-slate-450 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition"
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
              className="block w-full mt-1.5 px-3.5 py-2.5 bg-slate-50/50 border border-slate-200/60 rounded-xl text-xs font-semibold h-16 resize-none focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition"
            />
          </div>

          <div>
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
              Автомобиль / Локация
            </label>
            <CouplingPicker
              mode="combined"
              value={editingItem?.car || ""}
              locations={resolvedLocations}
              onSelect={(rec) => {
                if (!rec) {
                  setEditCar("");
                  setEditCouplingId("");
                  setEditDriverName("");
                  return;
                }
                if (rec.isLocation) {
                  setEditCar(String(rec.carNumber || rec).trim());
                  setEditCouplingId("");
                  setEditDriverName("");
                } else if (rec.carNumber || rec.vehicleNumbers) {
                  const coupling = [
                    (rec.carNumber || rec.vehicleNumbers || '').toUpperCase(),
                    rec.trailerNumber ? rec.trailerNumber.toUpperCase() : '',
                  ].filter(Boolean).join(' / ');
                  setEditCar(coupling);
                  setEditCouplingId(rec.couplingId || rec.id || "");
                  setEditDriverName(rec.driverName || rec.driverNameRu || "");
                } else {
                  setEditCar(String(rec).trim());
                  setEditCouplingId("");
                  setEditDriverName("");
                }
              }}
            />
          </div>

          {editingItem && editDriverName && (
            <div>
              <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                Водитель (авто-заполнение)
              </label>
              <div className="mt-1.5 px-3.5 py-2.5 bg-slate-100/50 border border-slate-200/40 rounded-xl text-xs font-semibold text-emerald-700 font-mono">
                {editDriverName}
              </div>
            </div>
          )}

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
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition"
                >
                  <option value="office">В офисе</option>
                  <option value="hand">В рейсе</option>
                  <option value="office_return">Использован</option>
                  <option value="used">Сдан в ИТ</option>
                  <option value="expired">Аннулирован</option>
                  <option value="available">В наличии</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Дата выдачи
                </label>
                <input
                  type="date"
                  value={editIssueDate}
                  onChange={(e) => setEditIssueDate(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition"
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                  Срок действия
                </label>
                <input
                  type="date"
                  value={editExpiryDate}
                  onChange={(e) => setEditExpiryDate(e.target.value)}
                  className="block w-full mt-1.5 px-3.5 py-2.5 bg-white/45 border border-slate-200/60 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:bg-white focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 transition"
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

              {/* HISTORY TIMELINE */}
              <div className="border-t border-slate-100 pt-3 mt-3">
                <h3 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block mb-2">
                  📜 История дозвола
                </h3>
                <div className="max-h-48 overflow-y-auto space-y-1.5">
                  {(() => {
                    const permitNum = permitNumber.trim().toUpperCase();
                    const entries = Object.entries(dozvolsHistory)
                      .filter(([, entry]: [string, any]) =>
                        entry.doc && entry.doc.toUpperCase().includes(permitNum)
                      )
                      .sort(([, a]: [string, any], [, b]: [string, any]) => {
                        const aTime = a.time || a.timestamp || '';
                        const bTime = b.time || b.timestamp || '';
                        return aTime > bTime ? -1 : aTime < bTime ? 1 : 0;
                      })
                      .slice(0, 20);
                    if (entries.length === 0) {
                      return <p className="text-[11px] text-slate-400 italic">Нет записей истории для этого бланка</p>;
                    }
                    return entries.map(([key, entry]: [string, any]) => (
                      <div key={key} className="flex items-start gap-2 text-[11px]">
                        <div className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-slate-500 font-mono font-semibold whitespace-nowrap">
                              {entry.time || entry.date || '—'}
                            </span>
                            <span className="text-slate-400 font-medium">
                              {entry.logist || entry.user || '—'}
                            </span>
                          </div>
                          <div className="text-slate-700 font-semibold">
                            {entry.action || '—'}
                          </div>
                          {entry.meta && (
                            <div className="text-slate-400 italic truncate">
                              {entry.meta}
                            </div>
                          )}
                        </div>
                      </div>
                    ));
                  })()}
                </div>
              </div>
            </>
          )}

          <div className="pt-3 border-t border-slate-100 flex justify-end gap-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 min-h-[44px] py-2 border border-slate-200 hover:bg-slate-50 rounded-xl text-xs font-semibold text-slate-600 bg-white transition cursor-pointer"
            >
              Отмена
            </button>
            <button
              type="submit"
              className="px-5 min-h-[44px] py-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-xl text-xs transition shadow-sm cursor-pointer"
            >
              Сохранить
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
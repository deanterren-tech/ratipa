import React, { useState, useEffect } from 'react'
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import { createPortal } from 'react-dom'
import { X, FilePlus2, History } from 'lucide-react'
import { useToast } from '../../ToastProvider'
import CouplingPicker from '../../common/CouplingPicker'
import { BackButton } from '../../../ui/components'

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

// Prevent body scroll when modal is open
function useLockBodyScroll(open: boolean) {
  React.useEffect(() => {
    const main = document.querySelector('main');
    if (open) {
      document.body.style.overflow = 'hidden';
      if (main) main.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
      if (main) main.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
      if (main) main.style.overflow = '';
    };
  }, [open]);
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
  useLockBodyScroll(isOpen);
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

  const modalFormRef = React.useRef<HTMLFormElement>(null);
  useModalKeyboard({
    isOpen,
    onClose,
    onConfirm: () => modalFormRef.current?.requestSubmit(),
    canConfirm: true,
  });
  if (!isOpen) return null;

  return createPortal(
    <div data-scroll-lock="modal" data-mobile-fullscreen className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
      <div className="relative z-10 w-full max-w-2xl bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[90vh] overflow-hidden" role="dialog" aria-modal="true">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-1 min-w-0">
            <BackButton onClose={onClose} />
            <div className="flex items-center gap-2.5">
              <div className="p-2 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg shrink-0">
                <FilePlus2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-[#121316]">
                  {editingItem ? "Редактирование бланка" : "Регистрация бланка"}
                </h3>
                <p className="text-xs text-[#6B7280] mt-0.5">
                  {editingItem
                    ? <>Бланк <span className="font-mono text-[#121316]">{editingItem.number || editingItem.permitNumber || '—'}</span></>
                    : 'Ручной ввод бланка в реестр'}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="hidden md:inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form ref={modalFormRef} onSubmit={handleSubmit} className="flex flex-col min-h-0 flex-1">
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 py-5 space-y-4">
          <div>
            <label className="text-[11px] font-medium text-[#6B7280] block">
              Вид дозвола
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="block w-full mt-1.5 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs text-[#121316] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
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
            <label className="text-[11px] font-medium text-[#6B7280] block">
              Номер бланка
            </label>
            <input
              type="text"
              required
              placeholder="TR A 55432"
              value={permitNumber}
              onChange={(e) => setPermitNumber(e.target.value)}
              className="block w-full mt-1.5 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs font-semibold text-[#121316] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#6B7280] block">
              Сопутствующий комментарий
            </label>
            <textarea
              placeholder="Добавьте примечание к бланку..."
              value={comments}
              onChange={(e) => setComments(e.target.value)}
              className="block w-full mt-1.5 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs font-semibold h-16 resize-none focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
            />
          </div>

          <div>
            <label className="text-[11px] font-medium text-[#6B7280] block">
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
              <label className="text-[11px] font-medium text-[#6B7280] block">
                Водитель (авто-заполнение)
              </label>
              <div className="mt-1.5 px-3.5 py-2.5 bg-[#F3F4F6]/50 border border-[#E5E7EB] rounded-xl text-xs font-semibold text-emerald-700 font-mono">
                {editDriverName}
              </div>
            </div>
          )}

          {editingItem && (
            <>
              <div>
                <label className="text-[11px] font-medium text-[#6B7280] block">
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
                  className="block w-full mt-1.5 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs text-[#121316] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
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
                <label className="text-[11px] font-medium text-[#6B7280] block">
                  Дата выдачи
                </label>
                <input
                  type="date"
                  value={editIssueDate}
                  onChange={(e) => setEditIssueDate(e.target.value)}
                  className="block w-full mt-1.5 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs text-[#121316] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                />
              </div>

              <div>
                <label className="text-[11px] font-medium text-[#6B7280] block">
                  Срок действия
                </label>
                <input
                  type="date"
                  value={editExpiryDate}
                  onChange={(e) => setEditExpiryDate(e.target.value)}
                  className="block w-full mt-1.5 px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs text-[#121316] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition"
                />
              </div>

              {(type === "CHN 2" || type === "CHN 3") && (
                <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-[#6B7280]">
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
                      className="w-4 h-4 rounded text-[#4B5563] border-[#E5E7EB] focus:ring-[var(--accent-ui)] cursor-pointer"
                    />
                  </div>

                  {editIsCopy && (
                    <div>
                      <label className="text-[11px] font-medium text-[#6B7280] block">
                        Дата сдачи копии
                      </label>
                      <input
                        type="date"
                        value={editCopySubmittedAt}
                        onChange={(e) =>
                          setEditCopySubmittedAt(e.target.value)
                        }
                        className="block w-full mt-1.5 px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold text-[#4B5563] focus:outline-none focus:border-[#E5E7EB] transition"
                      />
                    </div>
                  )}
                </div>
              )}

              
              {/* HISTORY TIMELINE */}
              <div className="border-t border-[#E5E7EB] pt-3 mt-3">
                <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none mb-2">
                  <History className="w-3.5 h-3.5" />История дозвола
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
                      return <p className="text-[11px] text-[#9CA3AF] italic">Нет записей истории для этого бланка</p>;
                    }
                    return entries.map(([key, entry]: [string, any]) => (
                      <div key={key} className="flex items-start gap-2 text-[11px]">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#D1D5DB] mt-1.5 shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[#6B7280] font-mono font-semibold whitespace-nowrap">
                              {entry.time || entry.date || '—'}
                            </span>
                            <span className="text-[#9CA3AF] font-medium">
                              {entry.logist || entry.user || '—'}
                            </span>
                          </div>
                          <div className="text-[#374151] font-semibold">
                            {entry.action || '—'}
                          </div>
                          {entry.meta && (
                            <div className="text-[#9CA3AF] italic truncate">
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

        </div>
        <div className="px-6 py-4 border-t border-[#E5E7EB] flex justify-end gap-2.5 shrink-0 bg-white">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 border border-[#E5E7EB] hover:bg-[#F3F4F6] rounded-lg text-xs font-medium text-[#4B5563] bg-white transition-colors cursor-pointer"
          >
            Отмена
          </button>
          <button
            type="submit"
            className="px-5 py-2 bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] font-medium rounded-lg text-xs transition-colors cursor-pointer"
          >
            {editingItem ? 'Сохранить изменения' : 'Зарегистрировать'}
          </button>
        </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
import {useToast} from '../../ToastProvider'
import {useDialog} from '../../DialogProvider'
import { useModalKeyboard } from '../../../hooks/useModalKeyboard';
import React, {useState, useEffect, useMemo} from 'react'
import {UserProfile} from '../../../types'
import { useFirebase, database, dbService, onValue } from '../../../firebase'
import { ref, set, push, update, remove } from 'firebase/database'
import {Trash2, Search, Plus, Edit, FileDown, X, FolderOpen, FileCheck2, XCircle, Flame, AlertTriangle, Copy, Check, FileText, PanelRightClose, PanelRightOpen, MapPin, Truck, Loader2} from 'lucide-react'
import DozvolaWidgets from "./DozvolaWidgets";
import DozvolaAIAssistant from "./DozvolaAIAssistant";
import DozvolaPermitModal from "./DozvolaPermitModal";
import CouplingPicker from "../../common/CouplingPicker";
import DozvolaExpirySummary from "./DozvolaExpirySummary";

const canWriteRTDB = () => useFirebase;

const standardLocations = [
  "Офис Минск",
  "Офис Бяла-Подляска",
  "Офис Смоленск",
  "В рейсе",
  "На границе",
  "СВХ",
  "В офис"
];

/** Вариант возврата в офис: статус «В офисе», транспорт очищается. */
const OFFICE_PICK = 'в офис';
const OFFICE_LOCATION_LABEL = 'Минск, офис';
const isOfficePick = (v: string) => {
  const t = (v || '').trim().toLowerCase();
  return t === OFFICE_PICK || t.startsWith('офис');
};

/** Склонение по числу: plural(3, 'запись', 'записи', 'записей'). */
const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};

/**
 * Массовые операции панели выделения.
 *
 * В список попадают только те переходы, которые действительно поддерживаются
 * одиночной сменой статуса. Массовой операции с копией нет намеренно: у копии
 * есть дата сдачи, и проставлять её сразу многим бланкам нельзя, не зная даты.
 */
const BULK_STATUS_ACTIONS: { value: string; label: string; hint: string; irreversible?: boolean }[] = [
  { value: 'office', label: 'В офис', hint: 'Статус «В офисе», местонахождение «Минск, офис»' },
  { value: 'hand', label: 'Выдать в рейс', hint: 'Статус «В рейсе»; авто и сцепка сохраняются' },
  { value: 'office_return', label: 'Использован', hint: 'Статус «Использован»' },
  {
    value: 'used',
    label: 'Сдан в ТИ',
    hint: 'Статус «Сдан в транспортную инспекцию»',
    irreversible: true,
  },
  {
    value: 'expired',
    label: 'Аннулировать',
    hint: 'Статус «Аннулирован»',
    irreversible: true,
  },
  { value: 'lost', label: 'Утерян', hint: 'Статус «Утерян»', irreversible: true },
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
  /** Query-параметры маршрута вкладки (#dozvola/registry?type=…&status=…) */
  routeParams?: Record<string, string>;
  /** Записать текущие фильтры в URL, чтобы они пережили обновление страницы */
  onFiltersChange?: (params: Record<string, string>) => void;
}

// Вид + номер одной строкой («CHN 2 11214») с копированием в один клик.
const CopyablePermitLabel: React.FC<{ type?: string; number?: string }> = ({ type, number }) => {
  const [copied, setCopied] = React.useState(false);
  const value = [type, number].filter(Boolean).join(' ').trim() || '—';

  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    const write = navigator.clipboard?.writeText(value);
    if (write && typeof write.then === 'function') {
      write.then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      }).catch(() => {});
    }
  };

  return (
    <span className="group/copy inline-flex items-center gap-1.5 min-w-0">
      <span className="font-mono font-semibold text-[#121316] text-[13px] whitespace-nowrap select-all" title="Клик — выделить, кнопка — скопировать">
        {value}
      </span>
      <button
        type="button"
        onClick={copy}
        title={copied ? 'Скопировано' : 'Скопировать'}
        className="p-1 rounded-md text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] opacity-0 group-hover/copy:opacity-100 focus:opacity-100 transition-colors cursor-pointer shrink-0"
      >
        {copied ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
      </button>
    </span>
  );
};

/**
 * Отметка «Заявление внесено в транспортную инспекцию».
 * Относится к аннулированным и утерянным бланкам. Дату задаёт пользователь —
 * текущая дата не подставляется автоматически.
 */
const TiApplicationModal: React.FC<{
  isOpen: boolean;
  permit: any | null;
  canEdit: boolean;
  onClose: () => void;
  onSave: (isoDate: string, note: string) => void;
}> = ({ isOpen, permit, canEdit, onClose, onSave }) => {
  const existing = permit?.tiApplication || null;
  const [date, setDate] = React.useState('');
  const [note, setNote] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    setDate(existing?.submittedAt ? String(existing.submittedAt).slice(0, 10) : '');
    setNote(existing?.note || '');
    setError(null);
  }, [isOpen, existing]);

  const submit = () => {
    if (!date) {
      setError('Укажите дату подачи заявления — автоматически она не подставляется.');
      return;
    }
    onSave(new Date(`${date}T00:00:00`).toISOString(), note.trim());
  };

  useModalKeyboard({
    isOpen,
    onClose,
    onConfirm: canEdit ? submit : undefined,
    canConfirm: canEdit,
    initialFocusSelector: 'input[type="date"]',
  });

  if (!isOpen || !permit) return null;

  const statusLabel = permit.status === 'lost' ? 'Утерян' : 'Аннулирован';

  return (
    <div data-scroll-lock="modal" data-mobile-fullscreen className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        className="relative z-10 w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg shrink-0">
              <FileText className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#121316]">Заявление в транспортную инспекцию</h3>
              <p className="text-xs text-[#6B7280] mt-0.5">
                {[permit.type, permit.number || permit.permitNumber].filter(Boolean).join(' ')} · {statusLabel}
              </p>
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
            <label className="text-[11px] font-medium text-[#6B7280] block mb-1">Дата подачи / внесения</label>
            <input
              type="date"
              value={date}
              onChange={(e) => { setDate(e.target.value); setError(null); }}
              disabled={!canEdit}
              className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
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
              Текст заявления / примечание
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={!canEdit}
              rows={3}
              placeholder="Необязательно"
              className="w-full px-3 py-2 bg-white border border-[#E5E7EB] rounded-lg text-xs resize-none focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition disabled:bg-[#F9FAFB] disabled:text-[#9CA3AF]"
            />
          </div>

          {existing && (
            <p className="text-[10px] text-[#9CA3AF]">
              Отметку внёс {existing.author || '—'} · {fmtShort(existing.updatedAt)}
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

const fmtShort = (iso?: string) => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('ru-RU').replace(/\./g, '/');
};

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
  isRootAdmin,
  variant = 'table',
  locationsDB = {},
  onTiApplication,
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
  variant?: string;
  locationsDB?: Record<string, any>;
  onTiApplication?: () => void;
}) => {
  const [pickedFleetId, setPickedFleetId] = useState<string | null>(null);
  const resolvedLocations = useMemo(() => [...standardLocations, ...Object.values(locationsDB || {}).map((l: any) => l.name).filter(Boolean)], [locationsDB]);
  if (variant === 'table') {
    const statusLabel: Record<string, string> = {
      office: 'В офисе', hand: 'В рейсе', office_return: 'Использован',
      used: 'Сдан в ТИ', expired: 'Аннулирован', lost: 'Утерян'
    };
    return (
      <tr data-nav-item
        onClick={(e) => {
          const target = e.target as HTMLElement;
          if (target.closest('input, button, select, .coupling-picker')) return;
          onEdit();
        }}
        className={`border-b border-[#F3F4F6] hover:bg-[#F9FAFB] transition-colors cursor-pointer ${isChecked ? 'bg-[var(--accent-5)]' : ''} ${item.isCopy && item.status !== 'office_return' && item.status !== 'used' && item.status !== 'expired'
          ? 'bg-amber-50/30' : ''}`}>
        <td className="px-0 py-0 align-middle w-[44px]">
          {/* Область нажатия 44×44: клик по ней не открывает окно дозвола */}
          <label
            className="flex items-center justify-center w-11 h-11 cursor-pointer"
            onClick={(e) => e.stopPropagation()}
            title="Выбрать бланк"
          >
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-[#E5E7EB] text-[var(--accent-ink)] accent-[var(--accent-ui)] cursor-pointer"
              checked={isChecked}
              onChange={(e) => onCheckboxChange(e.target.checked)}
            />
          </label>
        </td>
        <td className="px-3 py-2 align-middle">
          <CopyablePermitLabel type={item.type} number={item.number || item.permitNumber} />
        </td>
        <td className="px-3 py-2 align-middle">
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ${
            item.status === 'office' ? 'text-emerald-700' :
            item.status === 'hand' ? 'text-blue-700' :
            item.status === 'office_return' ? 'text-amber-700' :
            item.status === 'used' ? 'text-[#6B7280]' :
            item.status === 'expired' ? 'text-rose-700' :
            item.status === 'lost' ? 'text-stone-600' :
            'text-emerald-700'}`}>
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
            item.status === 'office' ? 'bg-emerald-500' :
            item.status === 'hand' ? 'bg-blue-500' :
            item.status === 'office_return' ? 'bg-amber-500' :
            item.status === 'used' ? 'bg-[#9CA3AF]' :
            item.status === 'expired' ? 'bg-rose-500' :
            item.status === 'lost' ? 'bg-stone-400' :
            'bg-emerald-500'}`} />{statusLabel[item.status] || '—'}{item.status === 'office_return' && item.submissionBatch === 1 ? <span className="ml-1">(Сдача 1)</span> : ''}{item.status === 'office_return' && item.submissionBatch === 2 ? <span className="ml-1">(Сдача 2)</span> : ''}</span>
          {item.expiryDate && (() => {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(item.expiryDate); expiry.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) return <span className="ml-1.5 inline-block px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-200/60 whitespace-nowrap">Просрочен</span>;
            if (diffDays <= 30) return <span className="ml-1.5 inline-block px-2 py-0.5 rounded-lg text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200/60 whitespace-nowrap">Скоро ({diffDays} дн.)</span>;
            return null;
          })()}
          {/* Отметка о заявлении в транспортную инспекцию */}
          {item.tiApplication?.submittedAt && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTiApplication?.(); }}
              title={item.tiApplication.note ? `Заявление: ${item.tiApplication.note}` : 'Заявление внесено в ТИ'}
              className="ml-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--accent-15)] text-[var(--accent-ink)] border border-[var(--accent-25)] whitespace-nowrap hover:bg-[var(--accent-15)] transition-colors cursor-pointer"
            >
              <FileText className="w-3 h-3" />
              ТИ {fmtShort(item.tiApplication.submittedAt)}
            </button>
          )}
        </td>
        <td className="px-3 py-2 align-middle w-[220px] max-w-[220px]">
          {/* Ввод не тянет строку: длинное примечание остаётся в одну строку, полный текст — в подсказке */}
          <input
            type="text"
            value={item.comment || item.comments || ''}
            title={item.comment || item.comments || ''}
            className="w-full min-w-0 h-8 bg-white border border-[#E5E7EB] rounded-lg px-2.5 text-[11px] text-[#6B7280] italic focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition-colors"
            placeholder="Примечание..."
            onChange={(e) => onCommentChange(e.target.value)}
            onFocus={(e) => onCommentFocus(e.target.value)}
            onBlur={(e) => onCommentBlur(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          />
        </td>
        <td className="px-3 py-2 align-middle w-[104px] font-mono text-xs font-semibold text-[#6B7280] whitespace-nowrap tabular-nums">{item.issueDate ? new Date(item.issueDate).toLocaleDateString('ru-RU').replace(/\./g, '/') : '—'}</td>
        <td className="px-3 py-2 align-middle w-[240px] max-w-[240px]">
          {/* Авто в рейсе или местонахождение в офисе — одно значение, понятное без открытия записи */}
          <div className="flex items-center gap-1.5 min-w-0" title={item.car || ''}>
            {(item.status === 'hand') && (
              <Truck className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
            )}
            {(item.status === 'office' || /офис/i.test(String(item.car || ''))) && (
              <MapPin className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
          <CouplingPicker
            mode="combined"
            compact
            value={item.car || ""}
            locations={resolvedLocations}
            onSelect={(rec) => {
              if (!rec) return;
              if (rec.isLocation) {
                onCarChange(String(rec.carNumber || rec).trim());
              } else if (rec.carNumber || rec.vehicleNumbers) {
                const coupling = [
                  (rec.carNumber || rec.vehicleNumbers || '').toUpperCase(),
                  rec.trailerNumber ? rec.trailerNumber.toUpperCase() : '',
                ].filter(Boolean).join(' / ');
                onCarChange(coupling);
              } else {
                onCarChange(String(rec).trim());
              }
            }}
          />
            </div>
          </div>
        </td>
        <td className="px-3 py-2 align-middle whitespace-nowrap">
          {item.type === 'CHN 2' || item.type === 'CHN 3' ? (
            item.isCopy ? (
              <button onClick={() => onToggleCopy(true)} className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium text-[10px] px-2 py-0.5 rounded-full cursor-pointer hover:bg-emerald-100 transition-colors"><FileCheck2 className="w-3 h-3" />Сдана</button>
            ) : (
              <button onClick={() => onToggleCopy(false)} className="inline-flex items-center gap-1 bg-[#F3F4F6] text-[#6B7280] border border-[#E5E7EB] font-medium text-[10px] px-2 py-0.5 rounded-full cursor-pointer hover:bg-[#E5E7EB] transition-colors"><XCircle className="w-3 h-3" />Нет копии</button>
            )
          ) : '—'}
        </td>
        <td className="px-3 py-2 align-middle w-[1%]">
          <div className="flex items-center gap-1 justify-end">
            <select className="h-7 max-w-[112px] px-2 bg-white border border-[#E5E7EB] rounded-lg text-[11px] font-medium text-[#4B5563] focus:outline-none focus:border-[var(--accent-ui)] transition-colors cursor-pointer" onChange={(e) => { if (e.target.value) onUpdateStatus(e.target.value); e.target.value = ''; }}>
              <option value="">Действие...</option>
              <option value="office">В офис</option>
              <option value="hand">Выдать в рейс</option>
              <option value="office_return">Использован</option>
              <option value="used">Сдан в ТИ</option>
              <option value="expired">Аннулировать</option>
              <option value="lost">Утерян</option>
            </select>
            {(item.status === 'lost' || item.status === 'expired') && (
              <button
                onClick={onTiApplication}
                title={item.tiApplication ? 'Изменить отметку о заявлении в ТИ' : 'Заявление внесено в транспортную инспекцию'}
                className={`h-7 px-2 shrink-0 flex items-center gap-1 rounded-lg transition-colors cursor-pointer text-[10px] font-medium whitespace-nowrap ${
                  item.tiApplication
                    ? 'bg-[var(--accent-15)] text-[var(--accent-ink)] border border-[var(--accent-25)]'
                    : 'border border-[#E5E7EB] text-[#6B7280] hover:bg-[#F3F4F6]'
                }`}
              >
                <FileText className="h-3.5 w-3.5" />
                ТИ
              </button>
            )}
            {canWrite && (<button onClick={onEdit} className="w-7 h-7 shrink-0 flex items-center justify-center text-[var(--accent-ink)] hover:bg-[var(--accent-10)] rounded-lg transition cursor-pointer" title="Редактировать"><Edit className="h-3.5 w-3.5" /></button>)}
            {(isRootAdmin || canWrite) && (<button onClick={onDelete} className="w-7 h-7 shrink-0 flex items-center justify-center text-rose-500 hover:bg-rose-50 rounded-lg transition cursor-pointer" title="Удалить"><Trash2 className="h-3.5 w-3.5" /></button>)}
          </div>
        </td>
      </tr>
    );
  }
  return (
        <div
      onClick={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('input, button, select, .coupling-picker')) return;
        onEdit();
      }}
      className={`rounded-2xl border border-[#E5E7EB] bg-white p-4 flex flex-col gap-3 transition hover:shadow-sm cursor-pointer ${
        item.isCopy &&
        item.status !== "office_return" &&
        item.status !== "used" &&
        item.status !== "expired"
          ? "bg-amber-50/30 border-amber-200/40"
          : ""
      }`}
    >
      {/* Header: number + type + status */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <input
            type="checkbox"
            className="mt-0.5 w-4.5 h-4.5 rounded-lg border-[#E5E7EB] text-[var(--accent-ink)] focus:ring-[var(--accent-ui)] cursor-pointer accent-[var(--accent-ui)] transition"
            checked={isChecked}
            onChange={(e) => onCheckboxChange(e.target.checked)}
          />
          <div className="min-w-0">
            <span className="font-semibold text-[#121316] font-mono text-[14px] block leading-tight">
              {item.number || item.permitNumber}
            </span>
            {showTypeColumn && (
              <span className="inline-block mt-1 font-semibold text-[var(--accent-ink)] bg-[var(--accent-10)] border border-[var(--accent-15)] px-2.5 py-1 rounded-xl text-[11px]">
                {item.type}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {item.status === "office" && (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />В офисе</span>
          )}
          {item.status === "hand" && (
            <span className="bg-blue-500/10 text-blue-800 border border-blue-500/20 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">В рейсе</span>
          )}
          {item.status === "office_return" && (
            <span className="bg-amber-500/10 text-amber-800 border border-amber-500/20 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">Использован{item.submissionBatch === 1 ? ' (Сдача 1)' : ''}{item.submissionBatch === 2 ? ' (Сдача 2)' : ''}</span>
          )}
          {item.status === "used" && (
                      <span className="bg-[#6B7280]/10 text-[#374151] border border-[#6B7280]/20 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">Сдан в ТИ</span>
                    )}
                    {item.status === "expired" && (
                      <span className="bg-rose-500/10 text-rose-800 border border-rose-500/20 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">Аннулирован</span>
                    )}
                    {item.status === "lost" && (
                      <span className="bg-stone-500/10 text-stone-800 border border-stone-500/20 px-2.5 py-1 rounded-xl text-[10px] font-semibold uppercase tracking-tight">Утерян</span>
                    )}
          {item.expiryDate && (() => {
            const today = new Date(); today.setHours(0, 0, 0, 0);
            const expiry = new Date(item.expiryDate); expiry.setHours(0, 0, 0, 0);
            const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
            if (diffDays < 0) return <span className="mt-1 px-2.5 py-1 rounded-xl text-[10px] font-semibold bg-rose-50 text-rose-600 border border-rose-200/60">Просрочен</span>;
            if (diffDays <= 30) return <span className="mt-1 px-2.5 py-1 rounded-xl text-[10px] font-semibold bg-amber-50 text-amber-600 border border-amber-200/60">Скоро ({diffDays} дн.)</span>;
            return null;
          })()}
        </div>
      </div>

      {/* Comment */}
      <input
        type="text"
        value={item.comment || item.comments || ""}
        className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-[11px] text-[#6B7280] italic focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)] transition"
        placeholder="Примечание..."
        onChange={(e) => onCommentChange(e.target.value)}
        onFocus={(e) => onCommentFocus(e.target.value)}
        onBlur={(e) => onCommentBlur(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      />

      {/* Issue date + car */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-[#9CA3AF]">Дата выдачи</span>
          <span className="text-xs font-semibold text-[#6B7280] font-mono">
            {item.issueDate ? new Date(item.issueDate).toLocaleDateString("ru-RU").replace(/\./g, '/') : "—"}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] uppercase font-semibold text-[#9CA3AF]">Привязка к авто</span>
          <CouplingPicker
            mode="combined"
            compact
            value={item.car || ""}
            locations={resolvedLocations}
            onSelect={(rec) => {
              if (!rec) return;
              if (rec.isLocation) {
                onCarChange(String(rec.carNumber || rec).trim());
              } else if (rec.carNumber || rec.vehicleNumbers) {
                const coupling = [
                  (rec.carNumber || rec.vehicleNumbers || '').toUpperCase(),
                  rec.trailerNumber ? rec.trailerNumber.toUpperCase() : '',
                ].filter(Boolean).join(' / ');
                onCarChange(coupling);
              } else {
                onCarChange(String(rec).trim());
              }
            }}
          />
        </div>
      </div>

      {/* Copy status (CHN 2/3) */}
      {item.type === "CHN 2" || item.type === "CHN 3" ? (
        <div className="flex flex-col gap-1.5 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-semibold text-[#9CA3AF]">Сдан по копии?</span>
            {item.isCopy ? (
              <button onClick={() => onToggleCopy(true)} className="bg-[#F3F4F6] text-[#4B5563] border border-[#E5E7EB] font-semibold text-[10px] uppercase px-2 py-0.5 rounded-lg cursor-pointer hover:bg-[#F3F4F6] transition">
                <><FileCheck2 className="w-3 h-3" />Сдана</>
              </button>
            ) : (
              <button onClick={() => onToggleCopy(false)} className="bg-[#F3F4F6] text-[#6B7280] font-semibold text-[10px] uppercase px-2.5 py-1 rounded-lg cursor-pointer hover:bg-[#E5E7EB] transition w-max">
                <><XCircle className="w-3 h-3" />Нет копии</>
              </button>
            )}
          </div>
          {item.isCopy && (() => {
            if (item.status === "used" || item.status === "expired") return null;
            const baseDateStr = item.copySubmittedAt || item.issueDate || new Date().toISOString().split("T")[0];
            const baseDate = new Date(baseDateStr);
            const targetDate = new Date(baseDate.getTime() + 30 * 24 * 60 * 60 * 1000);
            targetDate.setHours(0,0,0,0);
            const today = new Date();
            today.setHours(0,0,0,0);
            const diffTime = targetDate.getTime() - today.getTime();
            const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            if (daysLeft < 0) return (<span className="text-rose-600 bg-rose-50 border border-rose-100/55 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono"><Flame className="w-3 h-3 inline-block mr-0.5 -mt-0.5" />Просрочено {Math.abs(daysLeft)} дн.!</span>);
            else if (daysLeft === 0) return (<span className="text-amber-600 bg-amber-50 border border-amber-200/55 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono animate-bounce"><AlertTriangle className="w-3 h-3 inline-block mr-0.5 -mt-0.5" />Крайний день!</span>);
            else if (daysLeft <= 10) return (<span className="text-amber-500 bg-amber-50 border border-amber-100/55 text-[10px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono">⌛ {daysLeft} дней</span>);
            else return (<span className="text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] text-[10px] font-semibold uppercase px-2 py-0.5 rounded-lg font-mono">⌛ {daysLeft} дн.</span>);
          })()}
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase font-semibold text-[#9CA3AF]">Дата сдачи по копии</span>
            {item.isCopy && item.copySubmittedAt ? (
              <span className="font-mono text-xs text-[#6B7280] font-semibold">{new Date(item.copySubmittedAt).toLocaleDateString("ru-RU").replace(/\./g, '/')}</span>
            ) : (
              <span className="text-[#D1D5DB] font-medium text-[11px]">—</span>
            )}
          </div>
        </div>
      ) : null}

      {/* Quick status + actions */}
      <div className="flex items-center justify-between gap-2 pt-2 border-t border-[#E5E7EB]">
        <select
          className="w-[140px] px-3 py-2 bg-white border border-[#E5E7EB] rounded-xl text-xs font-semibold focus:outline-none focus:border-[var(--accent-ui)] transition cursor-pointer"
          onChange={(e) => { if (e.target.value) onUpdateStatus(e.target.value); e.target.value = ""; }}
        >
          <option value="">Действие...</option>
          <option value="office">В офис</option>
          <option value="hand">Выдать в рейс</option>
          <option value="office_return">Использован</option>
          <option value="used">Сдан в ТИ</option>
          <option value="expired">Аннулировать</option>
        </select>
        <div className="flex items-center gap-1.5">
          {canWrite && (
            <button onClick={onEdit} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-[var(--accent-ink)] hover:bg-[var(--accent-10)] rounded-xl transition cursor-pointer" title="Редактировать параметры бланка">
              <Edit className="h-4 w-4" />
            </button>
          )}
          {(isRootAdmin || canWrite) && (
            <button onClick={onDelete} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-rose-500 hover:bg-rose-50 rounded-xl transition cursor-pointer" title="Удалить">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
});

export default function DozvolaRegistryList({
  user,
  routeParams,
  onFiltersChange,
}: DozvolaRegistryListProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [dozvolsData, setDozvolsData] = useState<Record<string, any>>({});
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [customTypesOrder, setCustomTypesOrder] = useState<string[]>([]);
  const [knownFleetCars, setKnownFleetCars] = useState<Record<string, any>>({});
  const [bazaCars, setBazaCars] = useState<any[]>([]);
  const [locationsDB, setLocationsDB] = useState<Record<string, any>>({});
  const resolvedLocations = useMemo(() => [...standardLocations, ...Object.values(locationsDB || {}).map((l: any) => l.name).filter(Boolean)], [locationsDB]);
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

  // Два независимых уровня фильтрации: вид дозвола и статус.
// Результат = вид И статус; переключение одного не сбрасывает другой.
const [selectedType, setSelectedType] = useState<string>('all');
const [selectedStatus, setSelectedStatus] = useState<string>('all');
// Уточнение внутри общей вкладки «Утерянные / аннулированные»
const [lostExpiredFilter, setLostExpiredFilter] = useState<'all' | 'expired' | 'lost'>('all');

// Фильтры приходят из URL — обновление страницы и «Назад»/«Вперёд» их сохраняют
useEffect(() => {
  const t = routeParams?.type || 'all';
  const s = routeParams?.status || 'all';
  setSelectedType((prev) => (prev === t ? prev : t));
  setSelectedStatus((prev) => (prev === s ? prev : s));
}, [routeParams?.type, routeParams?.status]);

// До первого действия пользователя URL не переписываем: иначе служебный рендер
// может записать неполный набор фильтров и потерять параметры маршрута.
const filtersTouchedRef = React.useRef(false);

const pushFilters = (type: string, status: string) => {
  filtersTouchedRef.current = true;
  const params: Record<string, string> = {};
  if (type && type !== 'all') params.type = type;
  if (status && status !== 'all') params.status = status;
  onFiltersChange?.(params);
};

const pickType = (type: string) => {
  const next = selectedType === type ? 'all' : type;
  setSelectedType(next);
  pushFilters(next, selectedStatus);
};

const pickStatus = (status: string) => {
  const next = selectedStatus === status ? 'all' : status;
  setSelectedStatus(next);
  pushFilters(selectedType, next);
};

/** Совместимость: панель управления и виджеты ожидают выбранный вид. */
const currentSelectedTab = selectedType;
const setCurrentSelectedTab = (type: string) => {
  setSelectedType(type);
  pushFilters(type, selectedStatus);
};
  const [searchInputValue, setSearchInputValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchInputValue);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInputValue]);

  const [selectedCountryFilter, setSelectedCountryFilter] = useState("all");
  const [selectedStatusFilter, setSelectedStatusFilter] = useState("all");

  const [isCreatorOpen, setIsCreatorOpen] = useState(false);
  const [tiFor, setTiFor] = useState<any | null>(null);
  // Правая панель: узкая по умолчанию. Кнопка сворачивания — в заголовке панели,
  // кнопка раскрытия — у правого края рабочей области. Состояние общее для всех вкладок.
  const [isPanelOpen, setIsPanelOpen] = useState<boolean>(() => {
    try { return localStorage.getItem('ratipa_dozvola_panel') !== 'closed'; } catch { return true; }
  });
  const togglePanel = () => {
    setIsPanelOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem('ratipa_dozvola_panel', next ? 'open' : 'closed'); } catch {}
      return next;
    });
  };
  const [country, setCountry] = useState("Польша");
  const [type, setType] = useState("Транзитный двусторонний");

  const [currentSortField, setCurrentSortField] = useState("issueDate");
  const [currentSortOrder, setCurrentSortOrder] = useState<"asc" | "desc">(
    "desc",
  );
  const [originalCars, setOriginalCars] = useState<Record<string, string>>({});
  const [originalComments, setOriginalComments] = useState<
    Record<string, string>
  >({});

  // --- Диалог выбора сдачи ---
  const [batchDialog, setBatchDialog] = useState<{ id: string; updates: any } | null>(null);

  // Escape закрывает диалог очереди сдачи (Enter не назначен — это выбор, а не подтверждение).
  useModalKeyboard({
    isOpen: !!batchDialog,
    onClose: () => setBatchDialog(null),
    skipInitialFocus: true,
  });

  // --- Панель массовых действий ---
  const [isBulkApplying, setIsBulkApplying] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const [editingItem, setEditingItem] = useState<any>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [dozvolsHistory, setDozvolsHistory] = useState<Record<string, any>>({});

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
    listen("dozvolsHistoryV4", setDozvolsHistory);

    const unsubBz = dbService.getVehicleFleet((list) => {
      setBazaCars(list || []);
    });
    subs.push(unsubBz);

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
      hand: "В рейсе / на руках",
      office_return: "Использован",
      used: "Сдан в транспортную инспекцию",
      expired: "Аннулирован",
      lost: "Утерян",
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

  // Отметка «Заявление внесено в ТИ» — только для утерянных и аннулированных
  const handleTiSave = async (isoDate: string, note: string) => {
    const item = tiFor;
    if (!item || !canWriteRTDB()) { setTiFor(null); return; }
    const existing = item.tiApplication || null;

    if (existing) {
      const ok = await showConfirm(
        `Изменить отметку о заявлении для ${item.type} №${item.number || item.permitNumber}?`,
        'Изменение отметки о заявлении',
      );
      if (!ok) return;
    }

    const author = localStorage.getItem('ratipa_auth_user') || user?.name || 'Система';
    const payload = {
      submittedAt: isoDate,
      note,
      author,
      updatedAt: new Date().toISOString(),
    };

    await update(ref(database, `dozvolsRegistryV4/${item.id}`), { tiApplication: payload });
    logAction(
      item.type,
      item.number || item.permitNumber,
      existing ? 'Изменена отметка о заявлении в ТИ' : 'Заявление внесено в ТИ',
      `Дата: ${new Date(isoDate).toLocaleDateString('ru-RU').replace(/\./g, '/')}${
        note ? `, примечание: ${note}` : ''
      }`,
    );
    toast('Отметка о заявлении сохранена', 'success');
    setTiFor(null);
  };

  const handlePermitSave = async (data: {
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
  }) => {
    if (!data.permitNumber.trim()) {
      toast("Пожалуйста, заполните уникальный серийный номер бланка дозвола.", 'info');
      return;
    }

    if (editingItem) {
      if (canWriteRTDB()) {
        const isDynamicLoc = Object.values(locationsDB).some((loc: any) => loc.name && loc.name.trim().toLowerCase() === data.editCar.trim().toLowerCase());
        update(ref(database, `dozvolsRegistryV4/${editingItem.id}`), {
          type: data.type,
          number: data.permitNumber,
          status: data.editStatus,
          car: data.editStatus === "office" ? "Минск офис" : (isDynamicLoc || isLocation(data.editCar)) ? data.editCar : data.editCar.toUpperCase(),
          couplingId: data.editCouplingId,
          driverName: data.editDriverName,
          comment: data.comments,
          isCopy: data.editIsCopy,
          copySubmittedAt: data.editIsCopy
            ? data.editCopySubmittedAt || new Date().toISOString().split("T")[0]
            : null,
          issueDate: data.editIssueDate || new Date().toISOString().split("T")[0],
          expiryDate: data.editExpiryDate || null,
        });

        let diffs = [];
        if (editingItem.type !== data.type)
          diffs.push(`Вид: [${editingItem.type}] → [${data.type}]`);
        if (editingItem.number !== data.permitNumber)
          diffs.push(`Номер: [${editingItem.number}] → [${data.permitNumber}]`);
        if (editingItem.status !== data.editStatus)
          diffs.push(`Статус: [${getStatusLabel(editingItem.status)}] → [${getStatusLabel(data.editStatus)}]`);
        if (editingItem.car !== data.editCar)
          diffs.push(`Автомобиль: [${editingItem.car || "—"}] → [${data.editCar || "—"}]`);
        if (editingItem.comment !== data.comments) diffs.push(`Примечание изменено`);
        if (editingItem.issueDate !== data.editIssueDate)
          diffs.push(`Дата выдачи: [${editingItem.issueDate || "—"}] → [${data.editIssueDate || "—"}]`);

        logAction(
          data.type,
          data.permitNumber,
          "Изменение через форму",
          diffs.join(" | ") || "Изменение параметров формы",
        );
        if (data.editCar) {
          await verifyOrCreateCar(data.editCar);
        }
      }
      setEditingItem(null);
      toast("Изменения в бланке квоты сохранены.", 'success');
    } else {
      if (canWriteRTDB()) {
        const newKey = push(ref(database, "dozvolsRegistryV4")).key;
        if (newKey) {
          set(ref(database, "dozvolsRegistryV4/" + newKey), {
            id: newKey,
            country,
            type: data.type,
            number: data.permitNumber,
            status: "office",
            issueDate: new Date().toISOString().split("T")[0],
            car: "",
            comment: data.comments,
            isCopy: false,
          });
          logAction(
            data.type,
            data.permitNumber,
            "Ручное внесение",
            `Статус: ${getStatusLabel("office")}`,
          );
        }
      }

      toast("Бланк квоты дозвола добавлен и готов к выдаче.", 'success');
    }
  };

  const handleExport = () => {
    if (items.length === 0) {
      toast("Нет данных для экспорта.", 'info');
      return;
    }
    const shortStatusLabel: Record<string, string> = {
          office: 'В офисе', hand: 'В рейсе', office_return: 'Использован',
          used: 'Сдан в ТИ', expired: 'Аннулирован', lost: 'Утерян'
        };
    const rows = items.map((item: any, idx: number) => `<tr>
      <td style="padding:6px 10px;border:1px solid #ddd;text-align:center;font-size:12px">${idx + 1}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;font-size:13px;font-weight:bold;font-family:monospace">${item.number || item.permitNumber || '—'}</td>
      ${showTypeColumn ? `<td style="padding:6px 10px;border:1px solid #ddd;font-size:12px"><span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-weight:bold">${item.type || '—'}</span></td>` : ''}
      <td style="padding:6px 10px;border:1px solid #ddd;font-size:12px;font-weight:bold">${shortStatusLabel[item.status] || item.status || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;font-size:11px;color:#666">${item.comment || item.comments || ''}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;font-size:12px;font-family:monospace">${item.issueDate ? new Date(item.issueDate).toLocaleDateString('ru-RU') : '—'}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;font-size:12px;font-family:monospace">${item.car || '—'}</td>
      <td style="padding:6px 10px;border:1px solid #ddd;font-size:12px;text-align:center">${item.type === 'CHN 2' || item.type === 'CHN 3' ? (item.isCopy ? 'Сдана' : 'Нет') : '—'}</td>
    </tr>`).join('');

    const html = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><title>Реестр дозволов</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  body { font-family: -apple-system, 'Segoe UI', Arial, sans-serif; color: #1e293b; padding: 10px; }
  h2 { font-size: 16px; margin-bottom: 8px; color: #0f172a; }
  .info { font-size: 11px; color: #64748b; margin-bottom: 16px; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f1f5f9; padding: 8px 10px; border: 1px solid #cbd5e1; text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; }
  td { padding: 6px 10px; border: 1px solid #e2e8f0; }
  tr:nth-child(even) { background: #f8fafc; }
  @media print { body { padding: 0; } }
</style></head>
<body>
  <h2>Реестр дозволов</h2>
  <div class="info">Всего записей: ${items.length} | Фильтр: ${currentSelectedTab === 'all' ? 'Все виды' : currentSelectedTab === 'archive' ? 'Архив' : currentSelectedTab === 'office_returns' ? 'Использован' : currentSelectedTab}</div>
  <table>
    <thead><tr>
      <th>№</th>
      <th>Бланк</th>
      ${showTypeColumn ? '<th>Вид</th>' : ''}
      <th>Статус</th>
      <th>Примечание</th>
      <th>Дата выдачи</th>
      <th>Авто</th>
      <th>Копия (CHN 2/3)</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="info" style="margin-top:12px;text-align:center;">Сформировано ${new Date().toLocaleString('ru-RU')}</div>
</body></html>`;

    const w = window.open('', '_blank');
    if (w) {
      w.document.write(html);
      w.document.close();
      w.focus();
      setTimeout(() => w.print(), 400);
    }
  };

  
  const handleDeletePermit = async (id: string) => {
    if (
      await showConfirm(
        'Бланк будет полностью убран из реестра. Восстановить его из интерфейса нельзя — '
        + 'останется только запись в журнале операций.',
        'Удалить дозвол из реестра',
        { variant: 'danger', confirmLabel: 'Удалить дозвол' },
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
      if (canWriteRTDB()) remove(ref(database, `dozvolsRegistryV4/${id}`));
    }
  };

  const updateDozvolStatusInline = async (id: string, newStatus: string) => {
    if (!newStatus) return;
    const statusLabels: Record<string, string> = {office: 'В офисе', hand: 'В рейсе', office_return: 'Использован', used: 'Сдан в ТИ', expired: 'Аннулирован', lost: 'Утерян'};
    const statusName = statusLabels[newStatus] || newStatus;
    const isIrreversible = newStatus === 'expired' || newStatus === 'lost' || newStatus === 'used';
    const okStatus = await showConfirm(
      isIrreversible
        ? `Бланк перейдёт в статус «${statusName}». Вернуть его в работу обычным действием не получится.`
        : `Бланк перейдёт в статус «${statusName}».`,
      `Статус: ${statusName}`,
      isIrreversible ? { variant: 'danger', confirmLabel: `Перевести в «${statusName}»` } : undefined,
    );
    if (!okStatus) return;
    const old = dozvolsData[id];
    if (canWriteRTDB() && old) {
      const updates: any = { status: newStatus };
      if (newStatus === "office") {
        updates.car = "Минск офис";
      }
      // «Использован» — сначала спрашиваем очередь сдачи (Сдача 1 / Сдача 2):
      // выбор определяет, попадёт ли бланк в реестр возврата, и пишется в submissionBatch.
      if (newStatus === "office_return") {
        setBatchDialog({ id, updates });
        return;
      }
      update(ref(database, `dozvolsRegistryV4/${id}`), updates);
      logAction(
        old.type,
        old.number,
        "Изменен статус",
        `Статус: [${getStatusLabel(old.status)}] → [${getStatusLabel(newStatus)}]${newStatus === "office" ? " (Локация: Минск офис)" : ""}`,
      );
    }
  };

  /**
   * Применяет выбранную очередь сдачи: статус «Использован» + submissionBatch.
   * Автопереход «Сдача 2 → Сдача 1» происходит позже — при списании в архив ТИ.
   */
  const applySubmissionBatch = (batch: 1 | 2) => {
    if (!batchDialog) return;
    const { id, updates } = batchDialog;
    const old = dozvolsData[id];
    if (canWriteRTDB()) {
      update(ref(database, `dozvolsRegistryV4/${id}`), { ...updates, submissionBatch: batch });
      if (old) {
        logAction(
          old.type,
          old.number,
          "Изменен статус",
          `Статус: [${getStatusLabel(old.status)}] → [${getStatusLabel('office_return')} (Сдача ${batch})]`,
        );
      }
    }
    setBatchDialog(null);
  };

  /**
   * Массовая смена статуса.
   *
   * Отличия от прежней версии:
   *  — подтверждение с количеством записей и названием операции перед необратимыми
   *    переходами (раньше писалось сразу, без вопроса);
   *  — записи, уже находящиеся в целевом статусе, пропускаются, а не перезаписываются
   *    вслепую; если таких оказалось большинство, переход не выполняется и это объясняется;
   *  — результат сообщает, сколько изменено и сколько пропущено;
   *  — запись в журнал идёт только для фактически изменённых бланков;
   *  — ошибка записи возвращается пользователю, а не теряется.
   */
  const handleBulkStatusChange = async (newStatus: string) => {
    if (!newStatus || selectedItems.size === 0 || isBulkApplying) return;

    const action = BULK_STATUS_ACTIONS.find((a) => a.value === newStatus);
    const statusName = action?.label || getStatusLabel(newStatus);

    const selected = Array.from(selectedItems)
      .map((id) => ({ id, item: dozvolsData[id] }))
      .filter((x) => !!x.item);

    const applicable = selected.filter((x) => x.item.status !== newStatus);
    const skipped = selected.length - applicable.length;
    const missing = selectedItems.size - selected.length;

    // Все выбранные уже в этом статусе — переход бессмысленный, ничего не пишем
    if (applicable.length === 0) {
      setBulkResult(
        `Все выбранные записи уже в статусе «${getStatusLabel(newStatus)}» — менять нечего.`,
      );
      return;
    }

    const ok = await showConfirm(
      `Статус «${getStatusLabel(newStatus)}» будет установлен для ${applicable.length} ${plural(applicable.length, 'записи', 'записей', 'записей')}.`
      + (skipped > 0 ? ` Ещё ${skipped} уже в этом статусе — они не изменятся.` : '')
      + (missing > 0 ? ` ${missing} записей не найдены в реестре и будут пропущены.` : '')
      + (action?.irreversible ? ' Вернуть их в работу обычным действием не получится.' : ''),
      `Смена статуса: ${statusName}`,
      action?.irreversible
        ? { variant: 'danger', confirmLabel: `Перевести в «${statusName}»` }
        : { confirmLabel: `Перевести в «${statusName}»` },
    );
    if (!ok) return;

    if (!canWriteRTDB()) {
      setBulkResult('Изменения не сохранены: запись в базу сейчас недоступна.');
      return;
    }

    setIsBulkApplying(true);
    setBulkResult(null);
    try {
      const updates: Record<string, any> = {};
      applicable.forEach(({ id, item }) => {
        updates[`dozvolsRegistryV4/${id}/status`] = newStatus;
        if (newStatus === 'office') {
          updates[`dozvolsRegistryV4/${id}/car`] = 'Минск офис';
        }
        logAction(
          item.type,
          item.number || item.permitNumber,
          'Массовое изменение статуса',
          `Статус: [${getStatusLabel(item.status)}] → [${getStatusLabel(newStatus)}]${newStatus === 'office' ? ' (Локация: Минск офис)' : ''}`,
        );
      });
      await update(ref(database), updates);

      const parts = [`Изменено записей: ${applicable.length}`];
      if (skipped > 0) parts.push(`уже были в этом статусе: ${skipped}`);
      if (missing > 0) parts.push(`не найдено: ${missing}`);
      const summary = `${parts.join(' · ')}. Статус «${getStatusLabel(newStatus)}».`;

      setSelectedItems(new Set());
      setBulkResult(summary);
      toast(summary, 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBulkResult(`Не удалось изменить статус: ни одна запись не изменена (${msg}).`);
      toast('Массовое изменение не выполнено', 'error');
    } finally {
      setIsBulkApplying(false);
    }
  };

  /** Массовые операции разрешены той же ролью, что и одиночные изменения. */
  const canBulk = user.permissions?.dozvola === 'write' || user.role === 'root_admin';

  /** Сколько выбранных записей уже находятся в указанном статусе. */
  const selectedInStatus = (status: string) =>
    Array.from(selectedItems).filter((id) => dozvolsData[id]?.status === status).length;

  /**
   * Состав выборки по статусам. Показывает, что выделены разнородные записи,
   * поэтому часть операций для них может быть неприменима.
   */
  const statusBreakdown = useMemo(() => {
    if (selectedItems.size === 0) return '';
    const counts: Record<string, number> = {};
    selectedItems.forEach((id) => {
      const s = dozvolsData[id]?.status || 'unknown';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([s, n]) => `${getStatusLabel(s)}: ${n}`)
      .join(' · ');
  }, [selectedItems, dozvolsData]);

  useEffect(() => {
    setSelectedItems(new Set());
    setBulkResult(null);
  }, [currentSelectedTab, selectedStatus, lostExpiredFilter, searchQuery, selectedCountryFilter]);

  // Местонахождение и статус всегда меняются согласованно, одной операцией:
  //  - выбран автомобиль/сцепка → «В рейсе», транспорт сохраняется;
  //  - выбран офис → «В офисе», местонахождение «Минск, офис», транспорт очищается.

  const handleInlineCarChangeOnly = (id: string, newCar: string) => {
    if (canWriteRTDB()) {
      const old = dozvolsData[id];
      const raw = (newCar || '').trim();
      const updateData: any = {};

      if (isOfficePick(raw)) {
        updateData.status = 'office';
        updateData.car = OFFICE_LOCATION_LABEL;
        updateData.couplingId = null;
        updateData.driverName = null;
      } else if (raw) {
        const isDynamicLoc = Object.values(locationsDB).some(
          (loc: any) => loc.name && loc.name.trim().toLowerCase() === raw.toLowerCase(),
        );
        updateData.car = (isDynamicLoc || isLocation(raw)) ? raw : raw.toUpperCase();
        updateData.status = 'hand';
      } else {
        updateData.car = '';
        updateData.couplingId = null;
      }

      update(ref(database, `dozvolsRegistryV4/${id}`), updateData);

      if (old) {
        const label = updateData.status === 'office' ? 'В офисе' : updateData.status === 'hand' ? 'В рейсе' : '—';
        logAction(
          old.type,
          old.number || old.permitNumber,
          'Изменено местонахождение',
          `${old.car || '—'} → ${updateData.car || '—'}, статус: ${label}`,
        );
      }
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
    if (canWriteRTDB() && old) {
      const oldCar = orig || "—";
      const displayNewCar = newVal || "—";

      if (newVal) {
        await verifyOrCreateCar(newVal);
        logAction(
          old.type,
          old.number,
          "Изменена машина / локация",
          `Автомобиль: [${oldCar}] → [${displayNewCar}]`,
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
    if (canWriteRTDB())
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
    if (canWriteRTDB() && old) {
      logAction(
        old.type,
        old.number,
        "Изменено примечание",
        `Примечание: [${orig || "—"}] → [${newVal || "—"}]`,
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
    if (canWriteRTDB()) {
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
        `Копия сдана: [${currentCopyVal ? "Да" : "Нет"}] → [${nextVal ? "Да" : "Нет"}]`,
      );
    }
  };

  const { rawItems, total, office, hand, officeReturnCount, usedCount, expiredCount, copies, lostCount } = useMemo(() => {
    let raw = Object.entries(dozvolsData).map(([key, value]: [string, any]) => ({
      id: key,
      ...value
    })) as any[];
    // Область фильтрации — выбранный ВИД (счётчики статусов считаются внутри него)
    if (selectedType !== 'all') {
      raw = raw.filter((i) => i.type === selectedType);
    }

    const totalVal = raw.length;
    const officeVal = raw.filter(
      (i) => i.status === "office",
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
    const lostCountVal = raw.filter(
      (i) => i.status === "lost",
    ).length;

    return {
      rawItems: raw,
      total: totalVal,
      office: officeVal,
      hand: handVal,
      officeReturnCount: officeReturnCountVal,
      usedCount: usedCountVal,
      expiredCount: expiredCountVal,
      copies: copiesVal,
      lostCount: lostCountVal
    };
  }, [dozvolsData, selectedType]);

  const items = useMemo(() => {
    let list = rawItems;
    if (selectedStatus === "archive") {
      list = list.filter((i) => i.status === "used");
    } else if (selectedStatus === "office_returns") {
      list = list.filter((i) => i.status === "office_return");
    } else if (selectedStatus === "lost_expired") {
      // Одна вкладка на два разных статуса — сами статусы в данных сохраняются
      list = list.filter((i) => i.status === "lost" || i.status === "expired");
      if (lostExpiredFilter !== 'all') {
        list = list.filter((i) => i.status === lostExpiredFilter);
      }
    } else if (selectedStatus === "expiring") {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      list = list.filter((i) => {
        if (!i.expiryDate) return false;
        const expiry = new Date(i.expiryDate);
        if (isNaN(expiry.getTime())) return false;
        expiry.setHours(0, 0, 0, 0);
        const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        return diffDays <= 30;
      });
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

    if (selectedStatusFilter !== "all") {
      list = list.filter((i) => i.status === selectedStatusFilter);
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
  }, [rawItems, currentSelectedTab, selectedCountryFilter, selectedStatusFilter, searchQuery, currentSortField, currentSortOrder]);

  // Выбор всех записей, соответствующих текущим фильтрам и поиску
  const visibleIds = useMemo(() => items.map((i: any) => i.id), [items]);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: string) => selectedItems.has(id));
  const someVisibleSelected = visibleIds.some((id: string) => selectedItems.has(id));

  const toggleAllVisible = () => {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        visibleIds.forEach((id: string) => next.delete(id));
      } else {
        visibleIds.forEach((id: string) => next.add(id));
      }
      return next;
    });
  };

  // Ленивая подгрузка: показываем порцию, кнопка «Показать ещё» догружает следующую.
  const PAGE_SIZE = 50;
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  // Сбрасываем видимое количество при смене фильтра/поиска/сортировки
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [currentSelectedTab, selectedCountryFilter, searchQuery, currentSortField, currentSortOrder]);
  const visibleItems = items.slice(0, visibleCount);
  const hasMore = visibleCount < items.length;

  const showTypeColumn =
    currentSelectedTab === "all" ||
    currentSelectedTab === "archive" ||
    currentSelectedTab === "office_returns" ||
    currentSelectedTab === "expiring" ||
    currentSelectedTab === "lost";

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
    <div className="flex flex-col xl:flex-row gap-6 items-start">
      {/* Основная таблица: при свёрнутой панели занимает всю ширину */}
      <div className="w-full min-w-0 flex-1 flex flex-col">
        {/* Expiry Widget above quick input */}
        <DozvolaExpirySummary user={user} onNavigateToRegistry={() => { setCurrentSelectedTab('all'); }} />

        <div className="mt-5 pt-5 border-t border-[#E5E7EB]">
        <DozvolaAIAssistant
          user={user}
          dozvolsData={dozvolsData}
          customTypesOrder={customTypesOrder}
          customTypes={customTypes}
          knownFleetCars={unifiedFleetCars}
          onOpenEditPermit={(item, prefilledChanges) => {
            setEditingItem({
              ...(item || {}),
              ...(prefilledChanges || {}),
            });
            setIsCreatorOpen(true);
          }}
        />
        </div>

        {/* Инструменты: два независимых уровня фильтрации — вид, затем статус */}
        <div className="mt-5 pt-5 border-t border-[#E5E7EB] flex flex-col gap-4">

          {/* Уровень 1 — вид дозвола */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none">
              Вид дозвола
            </span>
            <div className="flex flex-wrap items-center gap-2 overflow-x-auto scrollbar-none">
              {[
                { key: "all", label: "Все виды" },
                ...customTypesOrder.map((id) => {
                  const t = customTypes[id];
                  return t ? { key: t.name, label: t.name } : null;
                }).filter(Boolean),
              ].filter(Boolean).map((tab: any) => (
                <button
                  key={tab.key}
                  onClick={() => pickType(tab.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    selectedType === tab.key
                      ? 'bg-[#121316] text-white'
                      : 'bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* Разделитель между группами фильтров */}
          <div className="h-px bg-[#E5E7EB]" />

          {/* Уровень 2 — статус внутри выбранного вида */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none">
              Статус{selectedType !== 'all' ? ` · ${selectedType}` : ' · все виды'}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { key: 'all', label: 'Все статусы', count: total },
                { key: 'archive', label: 'Архив', count: usedCount },
                { key: 'office_returns', label: 'Использован', count: officeReturnCount },
                { key: 'lost_expired', label: 'Утерянные / аннулированные', count: lostCount + expiredCount },
              ].map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => pickStatus(tab.key)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                    selectedStatus === tab.key
                      ? 'bg-[#121316] text-white'
                      : 'bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]'
                  }`}
                >
                  {tab.label}
                  <span
                    className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                      selectedStatus === tab.key ? 'bg-white/20 text-white' : 'bg-[#E5E7EB] text-[#4B5563]'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Уточнение внутри общей вкладки: статусы в данных остаются разными */}
            {selectedStatus === 'lost_expired' && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {[
                  { key: 'all', label: 'Оба статуса', count: lostCount + expiredCount },
                  { key: 'expired', label: 'Аннулирован', count: expiredCount },
                  { key: 'lost', label: 'Утерян', count: lostCount },
                ].map((f) => (
                  <button
                    key={f.key}
                    onClick={() => setLostExpiredFilter(f.key as any)}
                    className={`px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap ${
                      lostExpiredFilter === f.key
                        ? 'bg-[var(--accent-15)] text-[var(--accent-ink)] border border-[var(--accent-25)]'
                        : 'text-[#6B7280] hover:text-[#121316] border border-transparent hover:bg-[#F3F4F6]'
                    }`}
                  >
                    {f.label} · {f.count}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Реестр: поиск + действия + таблица */}
        <div className="mt-5 pt-5 border-t border-[#E5E7EB]">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pb-3 border-b border-[#E5E7EB]">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Быстрый поиск по бланку, машине или комментарию..."
                value={searchInputValue}
                onChange={(e) => setSearchInputValue(e.target.value)}
                className="w-full pl-9 pr-8 py-2 text-xs text-[#121316] bg-white border border-[#E5E7EB] rounded-xl focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)] focus:border-[var(--accent-ui)] placeholder:text-[#9CA3AF] transition-colors shadow-xs"
              />
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-3 w-full sm:w-auto">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {user.permissions.dozvola === "write" && (
                  <button
                    onClick={() => setIsCreatorOpen(true)}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] text-xs font-medium px-3.5 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Зарегистрировать
                  </button>
                )}
                <button
                  onClick={handleExport}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] text-xs font-medium px-3.5 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  Экспорт
                </button>
              </div>

              <div className="w-full sm:w-[220px]">
                <select
                  value={selectedCountryFilter}
                  onChange={(e) => setSelectedCountryFilter(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-[#E5E7EB] rounded-xl text-xs text-[#121316] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition cursor-pointer"
                >
                  <option value="all">Все статусы</option>
                  <option value="office">В офисе</option>
                  <option value="hand">В рейсе у машин</option>
                  <option value="office_return">Использованы</option>
                  <option value="copy_yes">Сдана копия (CHN 2/3)</option>
                  <option value="copy_no">Нет копии (CHN 2/3)</option>
                </select>
              </div>
            </div>
          </div>

          {/* ─── Панель массовых действий ───────────────────────────────────────
              Отдельный блок в потоке под инструментами, поэтому не перекрывает
              заголовки, фильтры и таблицу. На узком экране складывается в колонку.
              Показываются только те операции, которые действительно поддержаны. */}
          {canBulk && selectedItems.size > 0 && (
            <div
              role="region"
              aria-label="Массовые действия над выбранными дозволами"
              className="mt-3 rounded-xl border border-[#E5E7EB] bg-white px-3 py-3 sm:px-4 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3"
            >
              {/* Сколько выбрано и из чего состоит выбор */}
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="inline-flex items-center justify-center min-w-[26px] h-[26px] px-1.5 rounded-lg bg-[var(--accent-solid)] text-[var(--accent-on)] text-[11px] font-semibold tabular-nums shrink-0">
                  {selectedItems.size}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-medium text-[#121316]">
                    Выбрано {selectedItems.size}{' '}
                    {plural(selectedItems.size, 'дозвол', 'дозвола', 'дозволов')}
                    {selectedItems.size !== visibleIds.length && (
                      <span className="text-[#9CA3AF] font-normal"> из {visibleIds.length} видимых</span>
                    )}
                  </p>
                  {statusBreakdown && (
                    <p className="text-[11px] text-[#6B7280] mt-0.5" title={statusBreakdown}>
                      {statusBreakdown}
                    </p>
                  )}
                </div>
              </div>

              {/* Действия: конкретные результаты вместо «Применить» */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 min-w-0">
                <span className="text-[10px] font-semibold text-[#9CA3AF] tracking-wider uppercase select-none shrink-0">
                  Сменить статус
                </span>
                <div className="flex flex-wrap gap-1.5 min-w-0">
                  {BULK_STATUS_ACTIONS.map((action) => {
                    const already = selectedInStatus(action.value);
                    const nothingToDo = already === selectedItems.size;
                    return (
                      <button
                        key={action.value}
                        type="button"
                        disabled={isBulkApplying || nothingToDo}
                        onClick={() => handleBulkStatusChange(action.value)}
                        title={
                          nothingToDo
                            ? `Все выбранные уже в статусе «${getStatusLabel(action.value)}»`
                            : action.hint + (already > 0 ? ` · уже в этом статусе: ${already}` : '')
                        }
                        aria-label={`Сменить статус: ${action.label} для ${selectedItems.size} ${plural(selectedItems.size, 'записи', 'записей', 'записей')}`}
                        className={`inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] disabled:opacity-40 disabled:cursor-default ${
                          action.irreversible
                            ? 'border-rose-200 text-rose-700 bg-white hover:bg-rose-50'
                            : 'border-[#E5E7EB] text-[#4B5563] bg-white hover:bg-[#F3F4F6] hover:text-[#121316]'
                        }`}
                      >
                        {isBulkApplying && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                        {action.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => { setSelectedItems(new Set()); setBulkResult(null); }}
                  className="inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-lg bg-[#F3F4F6] border border-[#E5E7EB] text-[#4B5563] hover:bg-[#E5E7EB] hover:text-[#121316] text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                  aria-label="Снять выделение со всех выбранных записей"
                >
                  <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Снять выделение
                </button>
              </div>
            </div>
          )}

          {/* Результат последней массовой операции: живёт вне панели, поэтому
              остаётся видимым и после сброса выделения. */}
          {bulkResult && (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 flex items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 sm:px-4"
            >
              <FileCheck2 className="h-3.5 w-3.5 text-[#6B7280] shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-[11px] text-[#4B5563] flex-1 min-w-0">{bulkResult}</p>
              <button
                type="button"
                onClick={() => setBulkResult(null)}
                aria-label="Скрыть результат"
                title="Скрыть"
                className="shrink-0 p-0.5 -m-0.5 text-[#9CA3AF] hover:text-[#121316] rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          )}

          {/* Swipe Help Badge for Mobile */}
          

          {/* TABLE view for desktop (ПК) */}
          <div className="hidden md:block w-full overflow-x-auto custom-scrollbar">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E5E7EB] text-left text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none select-none border-b border-[#E5E7EB]">
                  <th className="px-0 py-2.5 font-semibold w-[44px]">
                    <label
                      className="flex items-center justify-center w-11 h-11 cursor-pointer"
                      title={allVisibleSelected ? 'Снять выбор со всех видимых' : 'Выбрать все видимые записи'}
                    >
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-[#E5E7EB] text-[var(--accent-ink)] accent-[var(--accent-ui)] cursor-pointer"
                        checked={allVisibleSelected}
                        ref={(el) => { if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected; }}
                        onChange={toggleAllVisible}
                        aria-label="Выбрать все видимые записи"
                      />
                    </label>
                  </th>
                  <th className="px-3 py-2.5 font-semibold">Бланк</th>
                  <th className="px-3 py-2.5 font-semibold">Статус</th>
                  <th className="px-3 py-2.5 font-semibold">Примечание</th>
                  <th className="px-3 py-2.5 font-semibold">Дата выдачи</th>
                  <th className="px-3 py-2.5 font-semibold">Авто / локация</th>
                  <th className="px-3 py-2.5 font-semibold">Копия (CHN 2/3)</th>
                  <th className="px-3 py-2.5 font-semibold">Действия</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => (
                  <DozvolaRow
                    key={item.id}
                    item={item}
                    variant="table"
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
                    onTiApplication={() => setTiFor(item)}
                    canWrite={user.permissions.dozvola === "write"}
                    isRootAdmin={user.role === "root_admin" || user.permissions?.dozvola === "write"}
                    locationsDB={locationsDB}
                  />
                ))}
                {!items.length && (
                  <tr>
                    <td colSpan={8} className="px-3 py-12 text-center text-[#9CA3AF]">
                      <div className="flex flex-col items-center gap-2">
                        <FolderOpen className="w-7 h-7 text-[#D1D5DB]" />
                        <p className="text-xs uppercase font-semibold text-[#6B7280] tracking-tight">Нет данных</p>
                        <p className="text-[11px] text-[#9CA3AF] font-normal normal-case">Не найдено ни одного бланка дозвола по выбранным критериям</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* CARD view for mobile */}
          <div className="md:hidden grid grid-cols-1 sm:grid-cols-2 gap-4">
            {visibleItems.map((item) => (
              <DozvolaRow
                key={item.id}
                item={item}
                variant="card"
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
              <div className="col-span-full flex flex-col items-center justify-center gap-2 py-12 text-[#6B7280]">
                <FolderOpen className="w-7 h-7 text-[#D1D5DB]" />
                <p className="text-xs uppercase font-semibold text-[#6B7280] tracking-tight">Нет данных</p>
                <p className="text-[11px] text-[#9CA3AF] font-normal normal-case">Не найдено ни одного бланка дозвола по выбранным критериям</p>
              </div>
            )}
          </div>
          {hasMore && (
            <div className="flex justify-center mt-4">
              <button
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                className="px-5 py-2.5 rounded-xl bg-[#121316] hover:bg-black text-white text-xs font-semibold shadow-sm transition-colors"
              >
                Показать ещё {Math.min(PAGE_SIZE, items.length - visibleCount)} (осталось {items.length - visibleCount})
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Правая панель: узкая фиксированная колонка, сворачивается без наложений */}
      <div
        id="dozvola-side-panel"
        className={`w-full xl:w-[320px] xl:shrink-0 flex-col ${isPanelOpen ? 'flex' : 'hidden xl:hidden'}`}
      >
        {/* Заголовок панели: название + кнопка сворачивания у верхнего края.
            Кнопка стоит рядом с названием, поэтому принадлежность очевидна. */}
        <div className="flex items-center justify-between gap-2 h-10 px-1 shrink-0 border-b border-[#E5E7EB]">
          <span className="text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none px-2">
            Панель управления
          </span>
          <button
            type="button"
            onClick={togglePanel}
            aria-label="Свернуть боковую панель"
            aria-expanded={true}
            aria-controls="dozvola-side-panel"
            title="Свернуть боковую панель — таблица займёт всю ширину"
            className="inline-flex items-center gap-1.5 h-7 px-2 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[11px] font-medium text-[#4B5563] transition-colors cursor-pointer shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:border-[var(--accent-ui)]"
          >
            <PanelRightClose className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">Свернуть панель</span>
          </button>
        </div>

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
              resolvedLocations={resolvedLocations}
              customTypesOrder={customTypesOrder}
              customTypes={customTypes}
            />
      </div>

      {/* Свёрнутое состояние: элемент раскрытия у правого края рабочей области.
          На широком экране — узкий рейл (40px) с вертикальной подписью, поэтому он не
          накладывается на таблицу; на узком — обычная кнопка во всю ширину под таблицей.
          Кнопка НЕ прячется внутрь скрытой панели. */}
      {!isPanelOpen && (
        <div className="w-full xl:w-10 xl:shrink-0 flex xl:flex-col items-stretch xl:items-center xl:pt-1">
          <button
            type="button"
            onClick={togglePanel}
            aria-label="Развернуть боковую панель"
            aria-expanded={false}
            aria-controls="dozvola-side-panel"
            title="Развернуть боковую панель"
            className="group flex xl:flex-col items-center justify-center gap-2 w-full xl:w-9 min-h-[44px] xl:min-h-0 xl:py-3 px-3 xl:px-0 rounded-xl border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#4B5563] transition-colors cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:border-[var(--accent-ui)]"
          >
            <PanelRightOpen className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="text-[11px] font-medium whitespace-nowrap xl:[writing-mode:vertical-rl]">
              Развернуть панель
            </span>
          </button>
        </div>
      )}

      <TiApplicationModal
        isOpen={!!tiFor}
        permit={tiFor}
        canEdit={user.permissions.dozvola === 'write' || user.role === 'root_admin'}
        onClose={() => setTiFor(null)}
        onSave={handleTiSave}
      />

      <DozvolaPermitModal
        isOpen={isCreatorOpen}
        onClose={() => {
          setEditingItem(null);
          setIsCreatorOpen(false);
        }}
        editingItem={editingItem}
        customTypes={customTypes}
        customTypesOrder={customTypesOrder}
        resolvedLocations={resolvedLocations}
        dozvolsHistory={dozvolsHistory}
        onSave={handlePermitSave}
      />

      {/* Диалог выбора очереди сдачи: открывается при переводе бланка в «Использован» */}
      {batchDialog && (
        <div
          data-scroll-lock="modal" data-mobile-fullscreen
          className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6"
          onClick={() => setBatchDialog(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Какая это сдача?"
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full max-w-sm bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] p-5"
          >
            <span className="block text-[9px] font-semibold uppercase tracking-widest text-[#9CA3AF]">Очередь сдачи</span>
            <h3 className="mt-1 text-sm font-semibold text-[#121316]">Какая это сдача?</h3>
            <p className="mt-1.5 text-xs leading-relaxed text-[#6B7280]">
              Бланк перейдёт в статус «Использован». Очередь влияет на реестр возврата разрешений.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                onClick={() => applySubmissionBatch(1)}
                className="flex-1 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--accent-solid)] px-5 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
              >
                Сдача 1
              </button>
              <button
                type="button"
                onClick={() => applySubmissionBatch(2)}
                className="flex-1 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--accent-solid)] px-5 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
              >
                Сдача 2
              </button>
            </div>
            <button
              type="button"
              onClick={() => setBatchDialog(null)}
              className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center rounded-xl px-5 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
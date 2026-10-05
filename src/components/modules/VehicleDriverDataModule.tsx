import {useDialog} from '../DialogProvider'
import { buildDispatcherDirectory, dispatcherFieldsFor } from '../../utils/dispatcher';
import React, {useState, useEffect} from 'react'
import { 
  FileText, 
  Plus, 
  Trash2, 
  Edit2, 
  Copy, 
  AlertTriangle, 
  User, 
  Phone, 
  X,
  ClipboardCheck,
  Folder,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  HardDrive,
  Truck,
  Star,
  LayoutGrid,
  Columns2,
  List
} from 'lucide-react';
import {dbService, database} from '../../api'
import {pdService} from '../../api'
import {getCouplingsFlat, getDriversFlat, getFleetUnitsOnce} from '../../services/fleetService'
import { ref, update } from 'firebase/database';
import {UserProfile, AppSettings, PhoneNumber, Driver, CarRateGroup} from '../../types'
import {formatDriverShortName} from '../../utils/driverSync'
import {normalizePlate, formatPlate, formatCoupling} from '../../utils/salaryAutofill'
import CouplingPicker from '../common/CouplingPicker';
import { useToast } from '../ToastProvider';
import {UI} from '../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ErrorRow, BackButton} from '../../ui/components'

interface VehicleDriverDataModuleProps {
  user: UserProfile;
}

const VehicleDriverCard = React.memo(({
  rec,
  copiedId,
  copyToClipboard,
  openEdit,
  handleDelete,
  showVerificationIndicator,
  brandModel,
  trailerMake,
  matchedTariff,
  dispatchersList,
  onUpdateDispatcher,
  bazaCars
}: {
  rec: VehicleDriverRecord;
  copiedId: string | null;
  copyToClipboard: (rec: VehicleDriverRecord) => void;
  openEdit: (rec: VehicleDriverRecord) => void;
  handleDelete: (rec: VehicleDriverRecord) => void;
  showVerificationIndicator: boolean;
  brandModel: string;
  trailerMake: string;
  matchedTariff: CarRateGroup | null;
  dispatchersList: string[];
  onUpdateDispatcher: (rec: VehicleDriverRecord, dispatcher: string) => void;
  bazaCars: string[];
}) => {
  const brandsText = brandModel ? `${brandModel}${trailerMake ? ' / ' + trailerMake : ''}` : (rec.brandsLat || '');
  const plate = normalizePlate(rec.carNumber || rec.vehicleNumbers || '');
  const onBase = plate ? bazaCars.includes(plate) : false;
  return (
    <div
      id={`vehicle-driver-card-${rec.id}`}
      className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs flex flex-col overflow-hidden relative"
    >
      {showVerificationIndicator && (
        <div className="absolute top-2 right-2 z-10 inline-flex items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
          <AlertTriangle className="w-3 h-3" aria-hidden="true" />
          <span>Верификация</span>
        </div>
      )}

      {/* 1. Авто: номер и марка */}
      <div className="px-3.5 py-2.5 border-b border-[#E5E7EB] flex flex-col gap-1">
        <div
          className={`text-xs font-semibold font-mono text-[#121316] truncate ${showVerificationIndicator ? 'pr-24' : ''}`}
          title={formatCoupling(rec.coupling || `${rec.vehicleNumbers || ''}${rec.trailerNumber ? ' / ' + rec.trailerNumber : ''}`)}
        >
          {formatCoupling(rec.coupling || `${rec.vehicleNumbers || ''}${rec.trailerNumber ? ' / ' + rec.trailerNumber : ''}`)}
        </div>
        <div className="flex items-baseline gap-1.5 min-w-0">
          <span className="text-[11px] font-medium text-[#6B7280] shrink-0">Марка</span>
          <span className="text-[11px] font-mono text-[#4B5563] truncate" title={brandsText}>
            {brandsText || '—'}
          </span>
        </div>
      </div>

      {/* 2. Экипаж: водитель и контакты */}
      <div className="px-3.5 py-2.5 border-b border-[#E5E7EB] grid grid-cols-2 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <User className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />
            <span className="text-[11px] font-medium text-[#6B7280]">Водитель</span>
          </div>
          <div className="text-xs font-semibold text-[#121316] truncate" title={rec.driverNameRu}>
            {formatDriverShortName(rec.driverNameRu || (rec as any).driverName)}
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-1 mb-0.5">
            <Phone className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />
            <span className="text-[11px] font-medium text-[#6B7280]">Контакты</span>
          </div>
          <div className="text-[11px] font-mono text-[#4B5563] leading-snug space-y-0.5">
            {(rec.phones || []).slice(0, 2).map((p) => (
              <div key={p.id} className={p.isPrimary ? "inline-flex items-center gap-1 text-[#121316] font-semibold" : ""}>
                {p.number}
                {p.isPrimary && <Star className="w-3 h-3 text-[var(--accent)]" aria-hidden="true" />}
              </div>
            ))}
            {(rec.phones || []).length === 0 && (
              <span className="text-[#9CA3AF] italic text-[11px]">Нет телефонов</span>
            )}
          </div>
        </div>
      </div>

      {/* 3. Диспетчер */}
      <div className="px-3.5 py-2 border-b border-[#E5E7EB] flex items-center justify-between gap-3">
        <span className="text-[11px] font-medium text-[#6B7280] shrink-0">Диспетчер</span>
        <select
          value={rec.dispatcher || ""}
          onChange={(e) => onUpdateDispatcher(rec, e.target.value)}
          aria-label="Диспетчер"
          className="bg-white border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F3F4F6] px-2 py-1 rounded-lg text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] cursor-pointer min-h-[44px] max-w-[68%]"
        >
          <option value="">Без дисп.</option>
          {dispatchersList.map((dispName) => (
            <option key={dispName} value={dispName}>{dispName}</option>
          ))}
        </select>
      </div>

      {/* 4. Тариф */}
      <div className="px-3.5 py-2 border-b border-[#E5E7EB] flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[11px] font-medium text-[#6B7280] shrink-0">Тариф</span>
        {matchedTariff ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[#4B5563] min-w-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
            <span className="truncate" title={matchedTariff.name}>{matchedTariff.name}</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] text-[#9CA3AF] italic">
            <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF] shrink-0" aria-hidden="true" />
            Не установлен
          </span>
        )}
      </div>

      {/* 5. Ставка */}
      <div className="px-3.5 py-2 border-b border-[#E5E7EB] flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium text-[#6B7280] shrink-0">Ставка</span>
        {matchedTariff ? (
          <span className="text-xs font-mono font-semibold text-[#121316]">{matchedTariff.rate} €</span>
        ) : (rec as any).rate != null && (rec as any).rate !== '' ? (
          <span className="text-xs font-mono font-semibold text-[#121316]">{(rec as any).rate} €/км</span>
        ) : (
          <span className="text-xs font-mono text-[#9CA3AF]">—</span>
        )}
      </div>

      {/* 6. Статус (На базе / В рейсе) — по «Учёту выезда» */}
      <div className="px-3.5 py-2 border-b border-[#E5E7EB] flex items-center justify-between gap-2 text-[11px]">
        <span className="text-[11px] font-medium text-[#6B7280] shrink-0">Статус</span>
        {onBase ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
            На базе
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
            В рейсе
          </span>
        )}
      </div>

      {/* 7. Документы водителя — структурировано: подписи 11px, значения моно/полужирным */}
      <div className="px-3.5 py-2.5 border-b border-[#E5E7EB] flex flex-col gap-2">
        <div className={`${UI.caption} flex items-center gap-1.5`}>
          <FileText className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Документы водителя</span>
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-2">
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Паспорт</div>
            <div className="text-xs font-mono font-semibold text-[#121316] truncate" title={rec.passportNumber}>{rec.passportNumber || '—'}</div>
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Дата рождения</div>
            <div className="text-xs font-mono font-semibold text-[#121316] truncate">{rec.birthDate || '—'}</div>
          </div>
          <div className="col-span-2 min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Личный №</div>
            <div className="text-xs font-mono font-semibold text-[#121316] truncate" title={rec.personalId}>{rec.personalId || '—'}</div>
          </div>
          <div className="col-span-2 min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Срок действия</div>
            <div className="text-xs font-mono font-semibold text-[#121316] truncate">{rec.passportStart || '—'} — {rec.passportEnd || '—'}</div>
          </div>
          <div className="col-span-2 min-w-0">
            <div className="text-[11px] font-medium text-[#6B7280]">Кем выдан</div>
            <div className="text-xs font-mono text-[#4B5563] leading-snug" title={rec.passportIssuedBy}>{rec.passportIssuedBy || '—'}</div>
          </div>
        </div>
      </div>

      {/* 8. Копируемый блок данных */}
      <div className="px-3.5 py-2.5 flex-1 flex flex-col justify-end">
        <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl p-2.5 font-mono text-[10px] text-[#4B5563] leading-relaxed">
          <div className="flex items-center justify-between gap-2 pb-1.5 mb-1.5 border-b border-[#E5E7EB]">
            <span className="text-[10px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">Для буфера обмена</span>
            <button
              type="button"
              onClick={() => copyToClipboard(rec)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] text-[10px] font-medium transition-colors cursor-pointer min-h-[44px]"
              title="Скопировать весь блок"
            >
              {copiedId === rec.id ? <ClipboardCheck className="w-3 h-3 text-emerald-500" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
              <span>{copiedId === rec.id ? 'Готово!' : 'Коп.'}</span>
            </button>
          </div>
          <div className="select-all font-semibold text-[#121316] mb-0.5">{formatCoupling(rec.coupling || `${(rec.carNumber || rec.vehicleNumbers || '')} / ${(rec as any).trailerNumber || ''}`)}</div>
          <div className="select-all truncate">Марки: {brandsText || '—'}</div>
          <div className="select-all truncate">Водитель: {(() => {
            const ru = rec.driverNameRu || (rec as any).driverName || '';
            const lat = rec.driverNameLat || (rec as any).driverNameLat || '';
            return lat ? `${ru} (${lat})` : ru;
          })()}</div>
          <div className="select-all">Дата рождения: {rec.birthDate || '—'}</div>
          <div className="select-all">Паспорт: {rec.passportNumber || '—'}</div>
          <div className="select-all truncate">Идентификационный номер: {rec.personalId || '—'}</div>
          <div className="select-all">Срок: {rec.passportStart || '—'} - {rec.passportEnd || '—'}</div>
          <div className="select-all truncate">Выдан: {rec.passportIssuedBy || '—'}</div>
          <div className="select-all">ВУ: —</div>
        </div>
      </div>

      {/* 9. Действия */}
      <div className="px-3.5 py-2 border-t border-[#E5E7EB] flex items-center gap-2">
        <button
          type="button"
          onClick={() => openEdit(rec)}
          className={`${UI.buttonGhost} flex-1`}
        >
          <Edit2 className="w-3 h-3" aria-hidden="true" />
          <span>Редактировать</span>
        </button>
        <button
          type="button"
          onClick={() => handleDelete(rec)}
          aria-label="Удалить"
          title="Удалить"
          className="inline-flex items-center justify-center p-2 rounded-xl text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 border border-[#E5E7EB] hover:border-rose-200 transition-colors cursor-pointer min-h-[44px] min-w-[44px]"
        >
          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
});

/**
 * Компактная строка реестра для режима «Список»: та же информация об автомобиле
 * и водителе и те же действия (диспетчер, копирование, редактирование, удаление),
 * но в одну-две строки — чтобы одновременно было видно больше записей.
 */
const VehicleDriverRow = React.memo(({
  rec,
  copiedId,
  copyToClipboard,
  openEdit,
  handleDelete,
  showVerificationIndicator,
  brandModel,
  trailerMake,
  matchedTariff,
  dispatchersList,
  onUpdateDispatcher,
  bazaCars
}: {
  rec: VehicleDriverRecord;
  copiedId: string | null;
  copyToClipboard: (rec: VehicleDriverRecord) => void;
  openEdit: (rec: VehicleDriverRecord) => void;
  handleDelete: (rec: VehicleDriverRecord) => void;
  showVerificationIndicator: boolean;
  brandModel: string;
  trailerMake: string;
  matchedTariff: CarRateGroup | null;
  dispatchersList: string[];
  onUpdateDispatcher: (rec: VehicleDriverRecord, dispatcher: string) => void;
  bazaCars: string[];
}) => {
  const brandsText = brandModel ? `${brandModel}${trailerMake ? ' / ' + trailerMake : ''}` : (rec.brandsLat || '');
  const plate = normalizePlate(rec.carNumber || rec.vehicleNumbers || '');
  const onBase = plate ? bazaCars.includes(plate) : false;
  const couplingText = formatCoupling(rec.coupling || `${rec.vehicleNumbers || ''}${rec.trailerNumber ? ' / ' + rec.trailerNumber : ''}`);
  const phonesText = (rec.phones || []).slice(0, 2).map((p) => p.number).join(', ');
  const rateText = matchedTariff
    ? `${matchedTariff.rate} €`
    : (rec as any).rate != null && (rec as any).rate !== '' ? `${(rec as any).rate} €/км` : '—';

  return (
    <div
      id={`vehicle-driver-row-${rec.id}`}
      className="bg-white border border-[#E5E7EB] rounded-xl px-3 py-2.5 flex flex-col gap-2 lg:flex-row lg:items-center lg:gap-4"
    >
      <div className="min-w-0 flex-1 flex flex-col gap-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-mono text-xs font-semibold text-[#121316] truncate" title={couplingText}>{couplingText}</span>
          <span className="hidden sm:inline text-[11px] text-[#6B7280] truncate" title={brandsText}>{brandsText || '—'}</span>
          {showVerificationIndicator && (
            <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
              <AlertTriangle className="w-3 h-3" aria-hidden="true" />
              <span>Верификация</span>
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[#6B7280]">
          <span className="text-xs font-medium text-[#121316] truncate max-w-full" title={rec.driverNameRu}>
            {formatDriverShortName(rec.driverNameRu || (rec as any).driverName) || '—'}
          </span>
          {phonesText
            ? <span className="font-mono">{phonesText}</span>
            : <span className="italic text-[#9CA3AF]">Нет телефонов</span>}
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${matchedTariff ? 'bg-emerald-500' : 'bg-[#9CA3AF]'}`} aria-hidden="true" />
            <span className="truncate" title={matchedTariff ? matchedTariff.name : undefined}>
              {matchedTariff ? matchedTariff.name : 'Тариф не установлен'}
            </span>
          </span>
          <span className="font-mono text-[#4B5563]">{rateText}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 lg:gap-3 shrink-0">
        <select
          value={rec.dispatcher || ""}
          onChange={(e) => onUpdateDispatcher(rec, e.target.value)}
          aria-label="Диспетчер"
          className="bg-white border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F3F4F6] px-2 py-1 rounded-lg text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] cursor-pointer min-h-[44px] w-full sm:w-auto sm:max-w-[200px]"
        >
          <option value="">Без дисп.</option>
          {dispatchersList.map((dispName) => (
            <option key={dispName} value={dispName}>{dispName}</option>
          ))}
        </select>

        {onBase ? (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" aria-hidden="true" />
            На базе
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-600 shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" aria-hidden="true" />
            В рейсе
          </span>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => copyToClipboard(rec)}
            title="Скопировать данные"
            aria-label="Скопировать данные"
            className="inline-flex items-center justify-center p-2 rounded-xl text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] border border-[#E5E7EB] transition-colors cursor-pointer min-h-[44px] min-w-[44px]"
          >
            {copiedId === rec.id
              ? <ClipboardCheck className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
              : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={() => openEdit(rec)}
            title="Редактировать"
            className="inline-flex items-center justify-center gap-1.5 px-3 rounded-xl bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] text-xs font-medium transition-colors cursor-pointer min-h-[44px]"
          >
            <Edit2 className="w-3 h-3" aria-hidden="true" />
            <span className="hidden xl:inline">Редактировать</span>
          </button>
          <button
            type="button"
            onClick={() => handleDelete(rec)}
            aria-label="Удалить"
            title="Удалить"
            className="inline-flex items-center justify-center p-2 rounded-xl text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 border border-[#E5E7EB] hover:border-rose-200 transition-colors cursor-pointer min-h-[44px] min-w-[44px]"
          >
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
});

export interface VehicleDriverRecord {
  id: string;
  vehicleNumbers: string;
  brandsRu: string;
  brandsLat: string;
  brandModel?: string;
  trailerMake?: string;
  driverNameRu: string;
  driverNameLat: string;
  birthDate: string;
  passportNumber: string;
  personalId: string;
  passportStart: string;
  passportEnd: string;
  passportIssuedBy: string;
  phones: PhoneNumber[];
  dimensions?: string;
  weight?: string;
  vehicleType?: string;
  year?: string;
  trailerNumber?: string;
  driverPhone?: string;
  rate?: number;
  coupling?: string;
  carNumber?: string;
  dispatcherName?: string;
  dispatcher: string;
  lastPassportVerificationYear?: number;
}

export default function VehicleDriverDataModule({ user }: VehicleDriverDataModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  
  const [records, setRecords] = useState<VehicleDriverRecord[]>([]);
  const [fleetVehicles, setFleetVehicles] = useState<any[]>([]);
  const [carRateGroups, setCarRateGroups] = useState<CarRateGroup[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [systemUsers, setSystemUsers] = useState<UserProfile[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  // «Учёт выезда» (baza) — источник статуса «На базе / В рейсе» в базе сцепок
  const [bazaCars, setBazaCars] = useState<string[]>([]);
  // Маппинг авто→диспетчер из Плана дохода / Диспозиции
  const [carDispatcherMapping, setCarDispatcherMapping] = useState<Record<string, string>>({});
  
  // Google Drive Iframe states
  const [isDriveOpen, setIsDriveOpen] = useState(() => {
    return localStorage.getItem('ratipa_driver_drive_visible') === 'true';
  });
  const [isDriveFocusMode, setIsDriveFocusMode] = useState(false);
  const [isDriveLoading, setIsDriveLoading] = useState(true);
  const [driveIframeKey, setDriveIframeKey] = useState(0);

  const [carSearchQuery, setCarSearchQuery] = useState('');
  const [selectedDispatcherFilter, setSelectedDispatcherFilter] = useState('all');
  const [selectedTariffFilter, setSelectedTariffFilter] = useState('all');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('all');
  /**
   * Режим отображения реестра: сетка 4 колонки, широкие карточки (2 колонки)
   * или компактный список строками. Выбор сохраняется в профиле пользователя
   * (users_list/{uid}.viewModes.vehicles), как масштаб Google-таблиц.
   */
  const [viewMode, setViewMode] = useState<'grid4' | 'grid2' | 'list'>(
    () => (user.viewModes?.vehicles as 'grid4' | 'grid2' | 'list') || 'grid4'
  );
  // Профиль мог прийти позже — подхватываем сохранённый режим, пока пользователь не переключил вручную
  const viewModeTouched = React.useRef(false);
  useEffect(() => {
    if (viewModeTouched.current) return;
    const saved = user.viewModes?.vehicles;
    if (saved === 'grid4' || saved === 'grid2' || saved === 'list') setViewMode(saved);
  }, [user.viewModes?.vehicles]);
  const changeViewMode = (mode: 'grid4' | 'grid2' | 'list') => {
    viewModeTouched.current = true;
    setViewMode(mode);
    if (user.uid) dbService.saveUserViewMode(user.uid, 'vehicles', mode);
  };
  
  // Form/Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Закрытие модалки редактирования по ESC (capture-фаза, как в PlanDohodModule)
  useEffect(() => {
    if (!modalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setModalOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [modalOpen]);
  
  // Form fields state
  const [vehicleNumbers, setVehicleNumbers] = useState('');
  const [brandsRu, setBrandsRu] = useState('');
  const [brandsLat, setBrandsLat] = useState('');
  const [formBrandModel, setFormBrandModel] = useState('');
  const [formTrailerMake, setFormTrailerMake] = useState('');
  const [existingVehicleBrands, setExistingVehicleBrands] = useState<string[]>([]);
  const [existingTrailerBrands, setExistingTrailerBrands] = useState<string[]>([]);
  const [lastLookedUpNumber, setLastLookedUpNumber] = useState('');
  const [driverNameRu, setDriverNameRu] = useState('');
  const [driverNameLat, setDriverNameLat] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [passportStart, setPassportStart] = useState('');
  const [passportEnd, setPassportEnd] = useState('');
  const [passportIssuedBy, setPassportIssuedBy] = useState('');
  const [phones, setPhones] = useState<PhoneNumber[]>([]);
  const [dispatcher, setDispatcher] = useState('');
  const [dimensions, setDimensions] = useState('');
  const [weight, setWeight] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [year, setYear] = useState('');
  const [trailerNumber, setTrailerNumber] = useState('');
  const [driverPhone, setDriverPhone] = useState('');
  const [rate, setRate] = useState('');

  // Save / CRUD feedback states
  const [saveError, setSaveError] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // UI pagination limits
  const [carsLimit, setCarsLimit] = useState(20);
  const [driversLimit, setDriversLimit] = useState(20);

  // Clipboard copies
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Passport Verification Modal queue state
  const [verificationQueue, setVerificationQueue] = useState<VehicleDriverRecord[]>([]);
  const [currentVerification, setCurrentVerification] = useState<VehicleDriverRecord | null>(null);
  const [skippedVerificationIds, setSkippedVerificationIds] = useState<Set<string>>(new Set());
  const [verifyFleet, setVerifyFleet] = useState<any[]>([]);
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  useEffect(() => {
    // Fetch live vehicles data — getVehicleDriverData now reads the unified
    // base (vehicleFleet). Both `records` and `fleetVehicles` come from it,
    // and verifyFleet is just an alias of fleetVehicles (single source of truth).
    // Однократное чтение — данные показываются сразу, без ожидания onValue
    getFleetUnitsOnce((units) => {
      // units уже в плоском формате (через _mapUnitToFlat) — все поля на месте
      setRecords(units as any);
      setFleetVehicles(units);
      setVerifyFleet(units);
      setIsDataLoaded(true);
    });

    // Подписка на изменения в реальном времени
        const unsubData = getCouplingsFlat((list) => {
          setRecords(list);
          setFleetVehicles(list);
          setVerifyFleet(list);
        });

    // Fetch rate groups
    const unsubCarRateGroups = dbService.getCarRateGroups ? dbService.getCarRateGroups(setCarRateGroups) : () => {};

    // Fetch reference catalogs once on component mount with our built-in cache to improve speed
    const unsubDrivers = getDriversFlat((list: any[]) => {
      setDrivers(list);
    });

    const unsubUsers = (dbService as any).getUsersOnce ? (dbService as any).getUsersOnce((users: any[]) => {
      setSystemUsers(users);
    }) : dbService.getUsers((users) => {
      setSystemUsers(users);
    });

    const unsubSettings = (dbService as any).getSettingsOnce ? (dbService as any).getSettingsOnce((s: any) => {
      setSettings(s);
    }) : dbService.getSettings((s) => {
      setSettings(s);
    });

    const unsubVBrands = (dbService as any).getVehicleBrands ? (dbService as any).getVehicleBrands((brandsList: string[]) => {
      setExistingVehicleBrands(prev => Array.from(new Set([...prev, ...brandsList])));
    }) : () => {};

    const unsubTBrands = (dbService as any).getTrailerBrands ? (dbService as any).getTrailerBrands((brandsList: string[]) => {
      setExistingTrailerBrands(prev => Array.from(new Set([...prev, ...brandsList])));
    }) : () => {};

    // Подписка на «Учёт выезда» (baza) для статуса «На базе / В рейсе»
    const unsubBaza = (dbService as any).getBazaRecords
      ? (dbService as any).getBazaRecords((list: any[]) => {
          const plates = (list || [])
            .map((c: any) => normalizePlate(c.carNumber || c.vehicleNumbers || ''))
            .filter(Boolean);
          setBazaCars(plates);
        })
      : () => {};

    // Подписка на маппинг авто→диспетчер из Плана дохода
    const unsubDispMapping = (pdService as any).subscribeDispatchersCarMapping
      ? (pdService as any).subscribeDispatchersCarMapping(setCarDispatcherMapping)
      : () => {};

    return () => {
      unsubData();
      unsubCarRateGroups();
      if (typeof unsubDrivers === 'function') unsubDrivers();
      if (typeof unsubUsers === 'function') unsubUsers();
      if (typeof unsubSettings === 'function') unsubSettings();
      if (typeof unsubVBrands === 'function') unsubVBrands();
      if (typeof unsubTBrands === 'function') unsubTBrands();
      if (typeof unsubBaza === 'function') unsubBaza();
      if (typeof unsubDispMapping === 'function') unsubDispMapping();
    };
  }, []);

  // Self-heal/populate unique brand suggestions from existing local data records
  useEffect(() => {
    if (fleetVehicles && fleetVehicles.length > 0) {
      const vBrands = fleetVehicles.map(v => v.brandModel || v.brands || '').filter(Boolean);
      const tBrands = fleetVehicles.map(v => v.trailerMake || '').filter(Boolean);
      setExistingVehicleBrands(prev => {
        const next = Array.from(new Set([...prev, ...vBrands]));
        return next.length === prev.length ? prev : next;
      });
      setExistingTrailerBrands(prev => {
        const next = Array.from(new Set([...prev, ...tBrands]));
        return next.length === prev.length ? prev : next;
      });
    }
  }, [fleetVehicles]);

  // Autocomplete brand model and trailer make when license plates change
  useEffect(() => {
    const normNumbers = vehicleNumbers.trim().toUpperCase().replace(/\s+/g, '');
    if (normNumbers && normNumbers !== lastLookedUpNumber) {
      setLastLookedUpNumber(normNumbers);
      const matched = resolveBrandsForRecord({ vehicleNumbers });
      if (matched.brandModel && !formBrandModel) {
        setFormBrandModel(matched.brandModel);
      }
      if (matched.trailerMake && !formTrailerMake) {
        setFormTrailerMake(matched.trailerMake);
      }
    }
  }, [vehicleNumbers, lastLookedUpNumber, fleetVehicles]);

  // Auto-fill driver from vehicle fleet when adding a new record in the database
  useEffect(() => {
    if (editingId || !vehicleNumbers) return;
    // Split to get the truck license plate (the first part before "/")
    const parts = vehicleNumbers.split('/');
    const truckNumber = parts[0].trim().toUpperCase().replace(/\s+/g, '');
    if (!truckNumber) return;

    const matchedVehicle = fleetVehicles.find(v => {
      const vNum = (v.carNumber || v.vehicleNumbers || '').trim().toUpperCase().replace(/\s+/g, '');
      return vNum && (vNum === truckNumber || truckNumber.includes(vNum) || vNum.includes(truckNumber));
    });

    if (matchedVehicle && matchedVehicle.driverId) {
      const matchedDriver = drivers.find(d => d.id === matchedVehicle.driverId);
      if (matchedDriver) {
        if (!driverNameRu) {
          setDriverNameRu(matchedDriver.name || '');
        }
        if (!driverNameLat) {
          const latName = [matchedDriver.lastNameLat, matchedDriver.firstNameLat, matchedDriver.middleNameLat].filter(Boolean).join(' ');
          setDriverNameLat(latName || matchedDriver.lastNameLat || '');
        }
        if (phones.length === 0 && matchedDriver.phone) {
          setPhones([{ id: 'p_' + Date.now(), number: matchedDriver.phone, isPrimary: true }]);
        }
      }
    }
  }, [vehicleNumbers, fleetVehicles, drivers, editingId, driverNameRu, driverNameLat, phones.length]);


  // Process passport verification queue from the unified base (vehicleFleet)
  useEffect(() => {
    if (verifyFleet.length === 0) return;

    const today = new Date();
    const currentYear = today.getFullYear();

    const pendingVerifications = verifyFleet.filter(rec => {
      if (!rec.passportStart) return false;
      const parts = rec.passportStart.split('.');
      if (parts.length !== 3) return false;

      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);

      if (currentYear <= year) return false;

      const anniversaryDate = new Date(currentYear, month, day);
      const isAnniversaryPassed = today >= anniversaryDate;
      const needsVerification = rec.lastPassportVerificationYear !== currentYear;

      // Уже пропущено в этой сессии
      if (skippedVerificationIds.has(rec.id)) return false;

      // Показываем только диспетчеру этого авто
      if (rec.dispatcher && rec.dispatcher !== user.name) return false;

      return isAnniversaryPassed && needsVerification;
    });

    // Recompute the queue from the freshest data. Keep already-shown records
    // (currentVerification) at the front so the popup does not flicker/reset.
    if (pendingVerifications.length > 0) {
      setVerificationQueue(prev => {
        const existingIds = new Set(prev.map(q => q.id));
        const added = pendingVerifications.filter(q => !existingIds.has(q.id));
        if (added.length === 0) return prev; // no change → avoid needless re-render
        return [...prev, ...added];
      });
      setCurrentVerification(prev => prev || (pendingVerifications[0] || null));
    }
  }, [verifyFleet, skippedVerificationIds]);

  const handleVerifySuccess = async (rec: VehicleDriverRecord) => {
    const currentYear = new Date().getFullYear();
    const updated = {
      ...rec,
      lastPassportVerificationYear: currentYear
    };
    // Persist to writable branch (vehicleFleet) via dbService, which updates verifyFleet source.
    // Also best-effort update to vehicle_driver_data (in case rules allow writes there).
    try {
      try {
        await dbService.saveVehicleDriverRecord(updated, user.name, user.role);
      } catch (e) {
        console.error('[PassportVerify] saveVehicleDriverRecord failed', e);
      }
      if (database) {
        // Write to the unified base (vehicleFleet) keyed by the record id (same key the card renders from).
        if (rec.id) {
          await update(ref(database, `vehicleFleet/${rec.id}`), { lastPassportVerificationYear: currentYear }).catch(() => {});
        }
      }
      toast('Паспортные данные подтверждены', 'success');
    } catch (e: unknown) {
      console.error('[PassportVerify] save failed', e);
      toast('Ошибка подтверждения: ' + ((e as any)?.message || e), 'error');
    } finally {
      // Always remove from queue + close modal, regardless of write outcome
      const remaining = verificationQueue.filter(q => q.id !== rec.id);
      setVerificationQueue(remaining);
      setCurrentVerification(remaining.length > 0 ? remaining[0] : null);
    }
  };

  const handleVerifyEdit = (rec: VehicleDriverRecord) => {
    // Open edit modal directly for this record
    openEdit(rec);
    // Remove from verification queue so it doesn't block
    const remaining = verificationQueue.filter(q => q.id !== rec.id);
    setVerificationQueue(remaining);
    if (remaining.length > 0) {
      setCurrentVerification(remaining[0]);
    } else {
      setCurrentVerification(null);
    }
  };

  const handleVerifySkip = (rec: VehicleDriverRecord) => {
    // Just skip for this session
    const remaining = verificationQueue.filter(q => q.id !== rec.id);
    setVerificationQueue(remaining);
    setSkippedVerificationIds(prev => new Set(prev).add(rec.id));
    if (remaining.length > 0) {
      setCurrentVerification(remaining[0]);
    } else {
      setCurrentVerification(null);
    }
  };

  const addPhoneField = () => {
    const newPhone: PhoneNumber = {
      id: "phone_" + Date.now() + "_" + Math.random().toString(36).substring(2, 6),
      number: '',
      isPrimary: phones.length === 0
    };
    setPhones([...phones, newPhone]);
  };

  const updatePhoneField = (id: string, number: string) => {
    setPhones(phones.map(p => p.id === id ? { ...p, number } : p));
  };

  const setPrimaryPhone = (id: string) => {
    setPhones(phones.map(p => ({
      ...p,
      isPrimary: p.id === id
    })));
  };

  const removePhoneField = (id: string) => {
    const filtered = phones.filter(p => p.id !== id);
    if (filtered.length > 0 && !filtered.some(p => p.isPrimary)) {
      filtered[0].isPrimary = true;
    }
    setPhones(filtered);
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setVehicleNumbers('');
    setBrandsRu('');
    setBrandsLat('');
    setFormBrandModel('');
    setFormTrailerMake('');
    setLastLookedUpNumber('');
    setDriverNameRu('');
    setDriverNameLat('');
    setBirthDate('');
    setPassportNumber('');
    setPersonalId('');
    setPassportStart('');
    setPassportEnd('');
    setPassportIssuedBy('');
    setPhones([{ id: "phone_1", number: '', isPrimary: true }]);
    setDispatcher('');
    setSaveError('');
    setIsSaving(false);
    setModalOpen(true);
  };

  const openEdit = (rec: VehicleDriverRecord) => {
    setEditingId(rec.id);
    setVehicleNumbers(rec.vehicleNumbers || '');
    setBrandsRu(rec.brandsRu || '');
    setBrandsLat(rec.brandsLat || '');
    
    // Pre-populate with resolved brands or fallbacks
    const matched = resolveBrandsForRecord(rec);
    setFormBrandModel(matched.brandModel || rec.brandsRu || '');
    setFormTrailerMake(matched.trailerMake || rec.brandsLat || '');
    setLastLookedUpNumber((rec.vehicleNumbers || '').trim().toUpperCase().replace(/\s+/g, ''));

    setDriverNameRu(rec.driverNameRu || '');
    setDriverNameLat(rec.driverNameLat || '');
    setBirthDate(rec.birthDate || '');
    setPassportNumber(rec.passportNumber || '');
    setPersonalId(rec.personalId || '');
    setPassportStart(rec.passportStart || '');
    setPassportEnd(rec.passportEnd || '');
    setPassportIssuedBy(rec.passportIssuedBy || '');
    setPhones(rec.phones && rec.phones.length > 0 ? rec.phones : [{ id: "phone_1", number: '', isPrimary: true }]);
    // Предзаполняем диспетчера из маппинга (Диспозиция / План дохода), если есть
    const recPlate = normalizePlate(rec.carNumber || rec.vehicleNumbers || '');
    const mappedDisp = Object.entries(carDispatcherMapping).find(([k]) => normalizePlate(k) === recPlate)?.[1] || '';
    setDispatcher(mappedDisp || rec.dispatcher || '');
    setDimensions((rec as any).dimensions || '');
    setWeight((rec as any).weight || '');
    setVehicleType((rec as any).vehicleType || '');
    setYear((rec as any).year || '');
    setTrailerNumber((rec as any).trailerNumber || '');
    setDriverPhone((rec as any).driverPhone || '');
    setRate((rec as any).rate != null ? String((rec as any).rate) : '');
    setSaveError('');
    setIsSaving(false);
    setModalOpen(true);
  };

  const handleSave = async () => {
    setSaveError('');
    
    const missingFields: string[] = [];
    if (!vehicleNumbers.trim()) missingFields.push('Гос. номера');
    if (!driverNameRu.trim()) missingFields.push('ФИО Водителя (Русский)');
    if (!birthDate.trim()) missingFields.push('Дата рождения');
    if (!passportNumber.trim()) missingFields.push('Серия и номер Паспорта');
    if (!personalId.trim()) missingFields.push('Идентификационный номер');
    if (!passportStart.trim()) missingFields.push('Дата выдачи паспорта');
    if (!passportEnd.trim()) missingFields.push('Срок действия паспорта');
    if (!passportIssuedBy.trim()) missingFields.push('Кем выдан паспорт');
    if (!dispatcher.trim()) missingFields.push('Закрепленный диспетчер');

    if (missingFields.length > 0) {
      setSaveError(`Пожалуйста, заполните обязательные поля: ${missingFields.join(', ')}.`);
      return;
    }

    const cleanedPhones = phones.filter(p => p.number && p.number.trim() !== '');
    if (cleanedPhones.length === 0) {
      setSaveError('Пожалуйста, добавьте и заполните хотя бы один номер телефона!');
      return;
    }

    if (!cleanedPhones.some(p => p.isPrimary)) {
      cleanedPhones[0].isPrimary = true;
    }

    const recordId = editingId || "rec_" + Date.now();
    const existingRec = records.find(r => r.id === recordId);

    const record: VehicleDriverRecord = {
      id: recordId,
      vehicleNumbers: vehicleNumbers.trim(),
      brandsRu: formBrandModel.trim() || brandsRu.trim() || '',
      brandsLat: formTrailerMake.trim() || brandsLat.trim() || '',
      brandModel: formBrandModel.trim(),
      trailerMake: formTrailerMake.trim(),
      driverNameRu: driverNameRu.trim(),
      driverNameLat: driverNameLat.trim(),
      birthDate: birthDate.trim(),
      passportNumber: passportNumber.trim(),
      personalId: personalId.trim(),
      passportStart: passportStart.trim(),
      passportEnd: passportEnd.trim(),
      passportIssuedBy: passportIssuedBy.trim(),
      phones: cleanedPhones,
      dispatcher: dispatcher.trim(),
      dimensions: dimensions.trim() || undefined,
      weight: weight.trim() || undefined,
      vehicleType: vehicleType.trim() || undefined,
      year: year.trim() || undefined,
      trailerNumber: trailerNumber.trim() || undefined,
      driverPhone: driverPhone.trim() || undefined,
      rate: rate.trim() ? Number(rate.trim()) : undefined,
      lastPassportVerificationYear: existingRec?.lastPassportVerificationYear || 0
    };

    setIsSaving(true);
    try {
      await dbService.saveVehicleDriverRecord(record, user.name, user.role);
      setIsSaving(false);
      setModalOpen(false);
    } catch (err: unknown) {
      console.error("Save error:", err);
      setSaveError(`Ошибка при сохранении: ${(err as any).message || String(err)}`);
      setIsSaving(false);
    }
  };

  const handleDelete = async (rec: VehicleDriverRecord) => {
    if (await showConfirm(`Вы уверены, что хотите удалить запись для автомобиля ${rec.vehicleNumbers} (водитель: ${formatDriverShortName(rec.driverNameRu || (rec as any).driverName)})? Это действие нельзя отменить.`)) {
      dbService.deleteVehicleDriverRecord(rec.id, user.name, user.role);
    }
  };


  const resolveBrandsForRecord = (rec: VehicleDriverRecord | { vehicleNumbers: string; brandsRu?: string; brandsLat?: string }) => {
    if (!rec.vehicleNumbers) return { brandModel: '', trailerMake: '' };
    
    // Prioritize direct properties if available on the record itself
    const directModel = ('brandModel' in rec ? rec.brandModel : '') || ('brandsRu' in rec ? rec.brandsRu : '') || '';
    const directTrailer = ('trailerMake' in rec ? rec.trailerMake : '') || ('brandsLat' in rec ? rec.brandsLat : '') || '';
    
    // Split to get the truck license plate (the first part before "/")
    const parts = rec.vehicleNumbers.split('/');
    const truckNumber = parts[0].trim().toUpperCase().replace(/\s+/g, '');
    
    // Find matching vehicle in central fleetVehicles list
    const matched = fleetVehicles.find(v => {
      const vNum = (v.carNumber || v.vehicleNumbers || '').trim().toUpperCase().replace(/\s+/g, '');
      return vNum && (vNum === truckNumber || truckNumber.includes(vNum) || vNum.includes(truckNumber));
    });
    
    const resolvedModel = matched?.brandModel || directModel || '';
    const resolvedTrailer = matched?.trailerMake || directTrailer || '';

    return {
      brandModel: resolvedModel,
      trailerMake: resolvedTrailer
    };
  };

  const resolveTariffForRecord = (rec: VehicleDriverRecord) => {
    if (!rec.vehicleNumbers) return null;
    const parts = rec.vehicleNumbers.split('/');
    const truckNumber = parts[0].trim().toUpperCase().replace(/\s+/g, '');
    const trailerNumber = parts[1] ? parts[1].trim().toUpperCase().replace(/\s+/g, '') : '';

    const matched = carRateGroups.find(g => 
      (g.vehicles || []).some(v => {
        const normV = v.trim().toUpperCase().replace(/\s+/g, '');
        return normV === truckNumber || normV === trailerNumber;
      })
    );
    return matched || null;
  };

  const copyToClipboard = (rec: VehicleDriverRecord) => {
    const { brandModel, trailerMake } = resolveBrandsForRecord(rec);
    const brandsText = brandModel ? `${brandModel}${trailerMake ? ' / ' + trailerMake : ''}` : '';
    const driverNameText = rec.driverNameRu || (rec as any).driverName || '';
    const driverLatText = rec.driverNameLat || (rec as any).driverNameLat || '';
    const couplingText = formatCoupling(rec.coupling || `${(rec.carNumber || rec.vehicleNumbers || '')} / ${(rec as any).trailerNumber || ''}`);
    const driverLine = driverLatText
      ? `${driverNameText} (${driverLatText})`
      : driverNameText;

    const text = `${couplingText}
Марки: ${brandsText}
Водитель: ${driverLine}
Дата рождения: ${rec.birthDate}
Паспорт: ${rec.passportNumber}
Идентификационный номер: ${rec.personalId}
Срок: ${rec.passportStart} - ${rec.passportEnd}
Выдан: ${rec.passportIssuedBy}
ВУ: —`;

    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(rec.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const handleUpdateDispatcherDirectly = async (rec: VehicleDriverRecord, nextDispatcher: string) => {
    // Диспетчер выбирается из списка учётных записей: сохраняем её идентификатор
    // и имя с фамилией, чтобы запись была надёжно связана с пользователем.
    const dispDirectory = buildDispatcherDirectory(
      (systemUsers || []).map((u: any) => ({ id: String(u.uid || u.id || ''), name: String(u.name || '') })),
    );
    const dispFields = dispatcherFieldsFor(nextDispatcher, dispDirectory);
    const updatedRecord = { ...rec, ...dispFields };
    try {
      await dbService.saveVehicleDriverRecord(updatedRecord, user.name, user.role);
    } catch (err: unknown) {
      toast("Ошибка изменения диспетчера: " + ((err as any).message || String(err)), 'error');
    }
  };

  const dispatchersList = systemUsers
    .filter(u => u.role === 'dispatcher' || u.role === 'root_admin' || (u.role as string) === 'Диспетчер')
    .map(u => u.name)
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  // Fallback default dispatchers if list is empty
  const defaultDispatchers = dispatchersList.length > 0 ? dispatchersList : ['Юрий', 'Алексей', 'Татьяна', 'Сергей'];

  const filteredRecords = records.filter(rec => {
    // 1. Dispatcher filter
    const recDispatcher = rec.dispatcher || 'Без диспетчера';
    if (selectedDispatcherFilter !== 'all') {
      if (selectedDispatcherFilter === 'none') {
        if (rec.dispatcher && rec.dispatcher !== '') return false;
      } else if (recDispatcher !== selectedDispatcherFilter) {
        return false;
      }
    }

    // 2. Tariff filter
    const matchedTariff = resolveTariffForRecord(rec);
    if (selectedTariffFilter !== 'all') {
      if (selectedTariffFilter === 'none') {
        if (matchedTariff) return false;
      } else if (!matchedTariff || matchedTariff.id !== selectedTariffFilter) {
        return false;
      }
    }

    // 3. Status/Verification filter
    const isAnniversaryPassed = rec.passportStart ? (() => {
      const parts = rec.passportStart.split('.');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const anniversary = new Date(new Date().getFullYear(), month, day);
        return new Date() >= anniversary && new Date().getFullYear() > year;
      }
      return false;
    })() : false;
    const needsVerificationThisYear = rec.lastPassportVerificationYear !== new Date().getFullYear();
    const isVerificationRequired = isAnniversaryPassed && needsVerificationThisYear;
    
    // Статус «На базе / В рейсе»: есть номер авто в «Учёте выезда» (baza) → На базе, иначе → В рейсе
    const recPlate = normalizePlate(rec.carNumber || rec.vehicleNumbers || '');
    const isOnBase = recPlate ? bazaCars.includes(recPlate) : false;
    const couplingStatus = isOnBase ? 'on_base' : 'in_trip'; // На базе / В рейсе

    if (selectedStatusFilter === 'verification' && !isVerificationRequired) {
      return false;
    }
    if (selectedStatusFilter === 'on_base' && couplingStatus !== 'on_base') {
      return false;
    }
    if (selectedStatusFilter === 'in_trip' && couplingStatus !== 'in_trip') {
      return false;
    }

    // 4. Search query matching
    if (!carSearchQuery.trim()) return true;

    const query = carSearchQuery.toLowerCase();
    const { brandModel, trailerMake } = resolveBrandsForRecord(rec);
    const brandsText = `${brandModel} ${trailerMake}`.toLowerCase();
    const legacyBrands = `${rec.brandsRu || ''} ${rec.brandsLat || ''} ${(rec as any).brands || ''}`.toLowerCase();
    const driverNameText = `${rec.driverNameRu || ''} ${rec.driverNameLat || ''} ${(rec as any).driverName || ''}`.toLowerCase();
    const dispatcherText = recDispatcher.toLowerCase();
    const tariffText = matchedTariff ? matchedTariff.name.toLowerCase() : 'не установлен';
    const platesText = (rec.vehicleNumbers || '').toLowerCase();
    const passportText = (rec.passportNumber || '').toLowerCase();
    const personalIdText = (rec.personalId || '').toLowerCase();
    const phonesText = (rec.phones || []).map(p => p.number).join(' ').toLowerCase();

    return (
      platesText.includes(query) ||
      brandsText.includes(query) ||
      legacyBrands.includes(query) ||
      driverNameText.includes(query) ||
      dispatcherText.includes(query) ||
      tariffText.includes(query) ||
      passportText.includes(query) ||
      personalIdText.includes(query) ||
      phonesText.includes(query)
    );
  });

  const renderCard = (rec: VehicleDriverRecord) => {
    const isAnniversaryPassed = rec.passportStart ? (() => {
      const parts = rec.passportStart.split('.');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const anniversary = new Date(new Date().getFullYear(), month, day);
        return new Date() >= anniversary && new Date().getFullYear() > year;
      }
      return false;
    })() : false;
    const needsVerificationThisYear = rec.lastPassportVerificationYear !== new Date().getFullYear();
    const showVerificationIndicator = isAnniversaryPassed && needsVerificationThisYear && (!rec.dispatcher || rec.dispatcher === user.name);

    const { brandModel, trailerMake } = resolveBrandsForRecord(rec);
    const matchedTariff = resolveTariffForRecord(rec);

    return (
      <VehicleDriverCard
        key={rec.id}
        rec={rec}
        copiedId={copiedId}
        copyToClipboard={copyToClipboard}
        openEdit={openEdit}
        handleDelete={handleDelete}
        showVerificationIndicator={showVerificationIndicator}
        brandModel={brandModel}
        trailerMake={trailerMake}
        matchedTariff={matchedTariff}
        dispatchersList={defaultDispatchers}
        onUpdateDispatcher={handleUpdateDispatcherDirectly}
        bazaCars={bazaCars}
      />
    );
  };

  const renderRow = (rec: VehicleDriverRecord) => {
    const isAnniversaryPassed = rec.passportStart ? (() => {
      const parts = rec.passportStart.split('.');
      if (parts.length === 3) {
        const day = parseInt(parts[0], 10);
        const month = parseInt(parts[1], 10) - 1;
        const year = parseInt(parts[2], 10);
        const anniversary = new Date(new Date().getFullYear(), month, day);
        return new Date() >= anniversary && new Date().getFullYear() > year;
      }
      return false;
    })() : false;
    const needsVerificationThisYear = rec.lastPassportVerificationYear !== new Date().getFullYear();
    const showVerificationIndicator = isAnniversaryPassed && needsVerificationThisYear && (!rec.dispatcher || rec.dispatcher === user.name);
    const { brandModel, trailerMake } = resolveBrandsForRecord(rec);
    const matchedTariff = resolveTariffForRecord(rec);

    return (
      <VehicleDriverRow
        key={rec.id}
        rec={rec}
        copiedId={copiedId}
        copyToClipboard={copyToClipboard}
        openEdit={openEdit}
        handleDelete={handleDelete}
        showVerificationIndicator={showVerificationIndicator}
        brandModel={brandModel}
        trailerMake={trailerMake}
        matchedTariff={matchedTariff}
        dispatchersList={defaultDispatchers}
        onUpdateDispatcher={handleUpdateDispatcherDirectly}
        bazaCars={bazaCars}
      />
    );
  };

  const rawDriveUrl = settings?.googleDriveUrl || "https://drive.google.com/drive/folders/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM";
  
  const getEmbeddableDriveUrl = (url: string) => {
    if (!url) return '';
    if (url.includes('embeddedfolderview')) return url;
    
    // Extract folder ID
    const folderMatch = url.match(/\/folders\/([a-zA-Z0-9-_]+)/);
    if (folderMatch && folderMatch[1]) {
      return `https://drive.google.com/embeddedfolderview?id=${folderMatch[1]}#grid`;
    }
    
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9-_]+)/);
    if (idMatch && idMatch[1]) {
      return `https://drive.google.com/embeddedfolderview?id=${idMatch[1]}#grid`;
    }

    return url;
  };

  const driveEmbedUrl = getEmbeddableDriveUrl(rawDriveUrl);

  return (
    <div className={UI.shell}>
      {/* Шапка раздела */}
      <div className={UI.shellHeader}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div className="min-w-0">
            <h1 className={UI.title}>Данные по авто и водителям</h1>
            <p className={UI.sectionSubtitle + ' mt-1'}>
              База данных паспортных реквизитов, телефонной связи и закрепленных диспетчеров RATIPA
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              id="btn-google-drive-toggle"
              type="button"
              onClick={() => {
                const nextState = !isDriveOpen;
                setIsDriveOpen(nextState);
                localStorage.setItem('ratipa_driver_drive_visible', nextState.toString());
              }}
              className={isDriveOpen ? UI.buttonDark : UI.buttonGhost}
            >
              <Folder className="w-4 h-4" aria-hidden="true" />
              <span>Google Диск</span>
            </button>

            <button
              id="btn-add-driver-record"
              type="button"
              onClick={handleOpenAdd}
              className={UI.buttonPrimary}
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              <span>Добавить данные</span>
            </button>
          </div>
        </div>
      </div>

      <div className={`${UI.content} flex-1`}>
        <div className={isDriveOpen ? "grid grid-cols-1 xl:grid-cols-12 gap-6" : "flex flex-col gap-6"}>

          {/* Основная колонка */}
          <div className={isDriveOpen ? "xl:col-span-7 flex flex-col gap-6" : "flex flex-col gap-6"}>

            {/* Реестр автопарка и экипажей */}
            <div className="flex flex-col gap-4">
              <SectionHeader
                icon={<Truck className="w-4 h-4" />}
                tone="graphite"
                title={`Реестр автопарка и экипажей (${filteredRecords.length})`}
              >
                {/* Вид списка: 4 колонки / широкие карточки / компактные строки */}
                <div
                  role="group"
                  aria-label="Вид списка"
                  className="inline-flex items-center gap-0.5 rounded-xl border border-[#E5E7EB] bg-[#F3F4F6] p-0.5 select-none"
                >
                  {([
                    { key: 'grid4', label: 'Сетка из четырёх колонок', Icon: LayoutGrid },
                    { key: 'grid2', label: 'Широкие карточки', Icon: Columns2 },
                    { key: 'list', label: 'Компактный список', Icon: List },
                  ] as const).map(({ key, label, Icon }) => {
                    const active = viewMode === key;
                    return (
                      <button
                        key={key}
                        type="button"
                        onClick={() => changeViewMode(key)}
                        title={label}
                        aria-label={label}
                        aria-pressed={active}
                        className={`inline-flex h-8 w-9 items-center justify-center rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] ${
                          active
                            ? 'bg-[#121316] text-white'
                            : 'text-[#4B5563] hover:text-[#121316] hover:bg-[#E5E7EB]'
                        }`}
                      >
                        <Icon className="h-4 w-4" aria-hidden="true" />
                      </button>
                    );
                  })}
                </div>
              </SectionHeader>

              {/* Фильтры */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <SearchField
                  value={carSearchQuery}
                  onChange={setCarSearchQuery}
                  placeholder="Поиск по номерам, ФИО…"
                  ariaLabel="Поиск по автопарку"
                  className="col-span-1 sm:col-span-2 lg:col-span-1 max-w-none"
                />
                <select
                  value={selectedDispatcherFilter}
                  onChange={e => setSelectedDispatcherFilter(e.target.value)}
                  aria-label="Фильтр по диспетчеру"
                  className={`${UI.select} w-full`}
                >
                  <option value="all">Все диспетчеры</option>
                  <option value="none">Без диспетчера</option>
                  {defaultDispatchers.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>
                <select
                  value={selectedTariffFilter}
                  onChange={e => setSelectedTariffFilter(e.target.value)}
                  aria-label="Фильтр по тарифной группе"
                  className={`${UI.select} w-full`}
                >
                  <option value="all">Все тарифные группы</option>
                  <option value="none">Без тарифа</option>
                  {carRateGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <select
                  value={selectedStatusFilter}
                  onChange={e => setSelectedStatusFilter(e.target.value)}
                  aria-label="Фильтр по статусу"
                  className={`${UI.select} w-full`}
                >
                  <option value="all">Все статусы</option>
                  <option value="verification">Требует верификации</option>
                  <option value="on_base">На базе</option>
                  <option value="in_trip">В рейсе</option>
                </select>
              </div>

              {/* Список карточек */}
              {!isDataLoaded ? (
                <div className={UI.loading} role="status">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#9CA3AF]" aria-hidden="true" />
                  <span>Загрузка данных автопарка...</span>
                </div>
              ) : filteredRecords.length === 0 ? (
                <EmptyState
                  kind="no-results"
                  title="Записи автопарка не найдены с выбранными фильтрами"
                  hint="Измените фильтры или поисковый запрос."
                />
              ) : (
                <div className="flex flex-col gap-6">
                  {viewMode === 'list' ? (
                    /* Компактный список строками: одновременно видно больше записей */
                    <div className="flex flex-col gap-2 pr-1">
                      {filteredRecords.slice(0, carsLimit).map(renderRow)}
                    </div>
                  ) : (
                    /* Сетка: 4 колонки или более широкие карточки в 2 колонки.
                       На узких экранах — одна колонка, карточки не сжимаются. */
                    <div className={`grid grid-cols-1 gap-6 pr-1 ${
                      viewMode === 'grid2'
                        ? (isDriveOpen ? 'lg:grid-cols-2' : 'lg:grid-cols-2')
                        : `sm:grid-cols-2 ${isDriveOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-3 xl:grid-cols-4'}`
                    }`}>
                      {filteredRecords.slice(0, carsLimit).map(renderCard)}
                    </div>
                  )}

                  {filteredRecords.length > carsLimit && (
                    <button
                      id="load-more-records"
                      type="button"
                      onClick={() => setCarsLimit(prev => prev + 30)}
                      className={`${UI.buttonGhost} w-full`}
                    >
                      Показать еще (+30)
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Правая колонка — Google Диск */}
          {isDriveOpen && (
            <>
              {/* Desktop: встроенная панель */}
              <div className="hidden md:flex xl:col-span-5 flex-col bg-white border border-[#E5E7EB] rounded-2xl shadow-xs overflow-hidden">
                {/* Заголовок панели */}
                <div className="p-4 bg-white border-b border-[#E5E7EB] flex items-center justify-between gap-4 shrink-0 select-none rounded-t-2xl">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2 py-0.5 rounded-md uppercase">
                      <HardDrive className="w-3 h-3" aria-hidden="true" />
                      <span>Drive</span>
                    </span>
                    <h3 className="text-xs font-semibold text-[#121316] tracking-tight hidden sm:block">Google Диск</h3>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" onClick={() => { setIsDriveLoading(true); setDriveIframeKey(k => k + 1); }} aria-label="Обновить Диск" title="Обновить Диск" className={UI.buttonIcon}>
                      <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <a href={rawDriveUrl} target="_blank" rel="noopener noreferrer" title="Открыть во вкладке" className={UI.buttonGhost}>
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                      <span className="hidden md:inline">Вкладка</span>
                    </a>
                    <button
                      type="button"
                      onClick={() => setIsDriveFocusMode(!isDriveFocusMode)}
                      aria-label={isDriveFocusMode ? "Свернуть" : "Развернуть на весь экран"}
                      title={isDriveFocusMode ? "Свернуть" : "Развернуть на весь экран"}
                      className={isDriveFocusMode ? UI.buttonDark : UI.buttonGhost}
                    >
                      {isDriveFocusMode ? <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" /> : <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />}
                    </button>
                    <button type="button" onClick={() => { setIsDriveOpen(false); localStorage.setItem('ratipa_driver_drive_visible', 'false'); }} aria-label="Закрыть панель" title="Закрыть панель" className={UI.buttonIcon}>
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {/* iframe */}
                <div className="flex-1 bg-white p-2 relative overflow-hidden" style={{ minHeight: '600px' }}>
                  {isDriveLoading && (
                    <div className="absolute inset-2 bg-white rounded-xl flex flex-col items-center justify-center p-6 gap-3 z-10">
                      <Folder className="w-8 h-8 text-[#D1D5DB]" aria-hidden="true" />
                      <span className="text-[11px] font-medium text-[#6B7280]">Подключение к Google Диск...</span>
                      <span className="text-[11px] text-[#9CA3AF]">Загрузка защищенного хранилища сканов</span>
                    </div>
                  )}
                  <iframe key={driveIframeKey} src={driveEmbedUrl} onLoad={() => setIsDriveLoading(false)} className="w-full h-full border-0 rounded-xl bg-white" allow="clipboard-write" title="Google Диск - Документы Водителей" />
                </div>
              </div>

              {/* Mobile: полноэкранный режим (поверх шапки и навигации — как все ссылки/материалы) */}
              <div data-scroll-lock="modal" className="fixed inset-0 z-[4100] bg-black/40 backdrop-blur-[2px] flex md:hidden" onClick={() => { setIsDriveOpen(false); localStorage.setItem('ratipa_driver_drive_visible', 'false'); }}>
                <div className="bg-white flex flex-col w-full h-full pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
                  <div className="p-4 border-b border-[#E5E7EB] flex items-center justify-between shrink-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <BackButton onClose={() => { setIsDriveOpen(false); localStorage.setItem('ratipa_driver_drive_visible', 'false'); }} />
                      <HardDrive className="w-4 h-4 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                      <span className="text-xs font-semibold text-[#121316]">Google Диск</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => { setIsDriveLoading(true); setDriveIframeKey(k => k + 1); }} aria-label="Обновить Диск" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-white border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F3F4F6] transition-colors cursor-pointer">
                        <RefreshCw className="w-4 h-4" aria-hidden="true" />
                      </button>
                      <a href={rawDriveUrl} target="_blank" rel="noopener noreferrer" aria-label="Открыть во вкладке" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-white border border-[#E5E7EB] text-[#4B5563] hover:bg-[#F3F4F6] transition-colors">
                        <ExternalLink className="w-4 h-4" aria-hidden="true" />
                      </a>
                    </div>
                  </div>
                  <div className="flex-1 relative overflow-hidden bg-[#F9FAFB]">
                    {isDriveLoading && (
                      <div className="absolute inset-0 bg-white flex flex-col items-center justify-center p-6 gap-3 z-10">
                        <Folder className="w-8 h-8 text-[#D1D5DB]" aria-hidden="true" />
                        <span className="text-[11px] font-medium text-[#6B7280]">Загрузка...</span>
                      </div>
                    )}
                    <iframe key={driveIframeKey + '-mobile'} src={driveEmbedUrl} onLoad={() => setIsDriveLoading(false)} className="w-full h-full border-0 bg-white" allow="clipboard-write" title="Google Диск - Документы Водителей" />
                  </div>
                </div>
              </div>
            </>
          )}

        </div>
      </div>

      {/* Ежегодная проверка паспортных данных */}
      {currentVerification && (
        <div data-scroll-lock="modal" data-mobile-fullscreen className="fixed inset-0 z-[300] flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4 sm:p-6 overflow-y-auto">
          <div className="relative z-10 w-full max-w-md bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] p-6 flex flex-col gap-5 text-center my-4">
            <div className="mx-auto p-2.5 bg-amber-50 text-amber-600 rounded-xl w-max">
              <AlertTriangle className="w-6 h-6" aria-hidden="true" />
            </div>

            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-[#121316]">Ежегодная проверка актуальности</h3>
              <div className="text-[11px] font-medium text-amber-600">Требуется подтверждение данных паспорта</div>
            </div>

            <p className="text-xs text-[#6B7280] leading-relaxed">
              Уважаемый диспетчер! Сегодня наступила дата ежегодной сверки паспортных реквизитов для водителя:
              <br />
              <strong className="text-[#121316] text-sm block my-2 underline">
                {formatDriverShortName(currentVerification.driverNameRu || (currentVerification as any).driverName)}
              </strong>
              Паспорт серии <span className="font-mono font-semibold text-[#121316]">{currentVerification.passportNumber}</span>, дата выдачи: <span className="font-mono font-semibold text-[#121316]">{currentVerification.passportStart}</span>.
              <br />
              Данные паспорта по-прежнему актуальны?
            </p>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                onClick={() => handleVerifySuccess(currentVerification)}
                className={`${UI.buttonPrimary} w-full`}
              >
                Да, данные актуальны
              </button>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleVerifyEdit(currentVerification)}
                  className={`${UI.buttonGhost} flex-1`}
                >
                  Нет, редактировать
                </button>
                <button
                  type="button"
                  onClick={() => handleVerifySkip(currentVerification)}
                  className={`${UI.buttonGhost} flex-1`}
                >
                  Пропустить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Форма добавления / редактирования */}
      {modalOpen && (
        <div data-scroll-lock="modal" className={UI.modalBackdrop} role="presentation">
          <div className={`${UI.modalSurface} max-w-2xl`} role="dialog" aria-modal="true" aria-label={editingId ? 'Редактировать запись' : 'Добавить новые данные авто и водителя'}>
            {/* Заголовок */}
            <div className={UI.modalHeader}>
              <div className="flex items-start gap-1 min-w-0 flex-1">
                <BackButton onClose={() => setModalOpen(false)} className="mt-0.5" />
                <div className="flex items-start gap-3 min-w-0">
                  <div className={UI.modalIconTile}>
                    <FileText className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <h2 className={UI.modalTitle}>
                      {editingId ? 'Редактировать запись' : 'Добавить новые данные авто и водителя'}
                    </h2>
                  </div>
                </div>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Закрыть" className={UI.modalClose}>
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Поля */}
            <div className={UI.modalBody}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Номера ТС */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Гос. номера Тягач / Полуприцеп <span className="text-rose-500">*</span>
                  </label>
                  <CouplingPicker
                    onSelect={(rec) => {
                      if (!rec) return;
                      setVehicleNumbers(formatCoupling((rec.carNumber || rec.vehicleNumbers || '').toUpperCase()));
                      // Подставляем марки, водителя, паспорт и телефоны из выбранного авто
                      if (rec.brandModel) setFormBrandModel(rec.brandModel);
                      if (rec.trailerMake) setFormTrailerMake(rec.trailerMake);
                      if (rec.driverNameRu) setDriverNameRu(rec.driverNameRu);
                      if (rec.driverNameLat) setDriverNameLat(rec.driverNameLat);
                      if (rec.birthDate) setBirthDate(rec.birthDate);
                      if (rec.passportNumber) setPassportNumber(rec.passportNumber);
                      if (rec.personalId) setPersonalId(rec.personalId);
                      if (rec.passportStart) setPassportStart(rec.passportStart);
                      if (rec.passportEnd) setPassportEnd(rec.passportEnd);
                      if (rec.passportIssuedBy) setPassportIssuedBy(rec.passportIssuedBy);
                      if (rec.phones && rec.phones.length > 0) setPhones(rec.phones);
                      if (rec.dispatcher) setDispatcher(rec.dispatcher);
                      if (rec.trailerNumber) setTrailerNumber(rec.trailerNumber);
                      // Сброс ошибки после выбора
                      setSaveError('');
                    }}
                  />
                </div>

                {/* 2. Марка тягача */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Марка тягача <span className="text-[#9CA3AF] font-normal">(латиница)</span>
                  </label>
                  <input
                    type="text"
                    list="vehicle-brands-datalist"
                    value={formBrandModel}
                    onChange={e => {
                      const val = e.target.value.replace(/[\u0400-\u04FF]/g, '').toUpperCase();
                      setFormBrandModel(val);
                    }}
                    placeholder="Например, SCANIA, VOLVO"
                    className={UI.input}
                  />
                  <datalist id="vehicle-brands-datalist">
                    {existingVehicleBrands.map(brand => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </div>

                {/* 3. Марка прицепа */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Марка прицепа <span className="text-[#9CA3AF] font-normal">(латиница)</span>
                  </label>
                  <input
                    type="text"
                    list="trailer-brands-datalist"
                    value={formTrailerMake}
                    onChange={e => {
                      const val = e.target.value.replace(/[\u0400-\u04FF]/g, '').toUpperCase();
                      setFormTrailerMake(val);
                    }}
                    placeholder="Например, SCHMITZ, KRONA"
                    className={UI.input}
                  />
                  <datalist id="trailer-brands-datalist">
                    {existingTrailerBrands.map(brand => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </div>

                {/* 4. Водитель (рус) */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    ФИО Водителя (Русский) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={driverNameRu}
                    onChange={e => setDriverNameRu(e.target.value)}
                    placeholder="Устинов Олег Леонидович"
                    className={UI.input}
                  />
                </div>

                {/* 5. Водитель (лат) */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    ФИО Водителя (Латиница)
                  </label>
                  <input
                    type="text"
                    value={driverNameLat}
                    onChange={e => setDriverNameLat(e.target.value)}
                    placeholder="USTSINAU ALEH"
                    className={UI.input}
                  />
                </div>

                {/* 6. Дата рождения */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Дата рождения <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={birthDate}
                    onChange={e => setBirthDate(e.target.value)}
                    placeholder="08.02.1973"
                    className={UI.input}
                  />
                </div>

                {/* 7. Паспорт */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Серия и номер Паспорта <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportNumber}
                    onChange={e => setPassportNumber(e.target.value)}
                    placeholder="МР 5065058"
                    className={UI.input}
                  />
                </div>

                {/* 8. Идентификационный номер */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Идентификационный номер <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={personalId}
                    onChange={e => setPersonalId(e.target.value)}
                    placeholder="3080273A018PB6"
                    className={UI.input}
                  />
                </div>

                {/* 9. Дата выдачи */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Дата выдачи паспорта (Срок от) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportStart}
                    onChange={e => setPassportStart(e.target.value)}
                    placeholder="09.01.2024"
                    className={UI.input}
                  />
                </div>

                {/* 10. Дата окончания */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Дата окончания паспорта (Срок до) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportEnd}
                    onChange={e => setPassportEnd(e.target.value)}
                    placeholder="09.01.2034"
                    className={UI.input}
                  />
                </div>

                {/* 11. Кем выдан */}
                <div className="flex flex-col gap-2 md:col-span-2">
                  <label className={UI.fieldLabel}>
                    Кем выдан паспорт <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportIssuedBy}
                    onChange={e => setPassportIssuedBy(e.target.value)}
                    placeholder="Фрунзенским РУВД г. Минска"
                    className={UI.input}
                  />
                </div>

                {/* 12. Телефоны */}
                <div className="md:col-span-2 flex flex-col gap-3 bg-white border border-[#E5E7EB] rounded-xl p-4">
                  <div className="flex items-center justify-between gap-2 pb-2 border-b border-[#E5E7EB]">
                    <label className={UI.fieldLabel}>
                      Телефоны связи <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={addPhoneField}
                      className={UI.buttonGhost}
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Добавить телефон</span>
                    </button>
                  </div>

                  {phones.length === 0 ? (
                    <div className="text-xs text-[#6B7280] italic py-3 text-center border border-dashed border-[#E5E7EB] rounded-xl">
                      Нет добавленных телефонов. Нажмите "Добавить телефон" выше.
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      {phones.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 bg-[#F9FAFB] p-2 border border-[#E5E7EB] rounded-xl">
                          <input
                            type="text"
                            value={p.number}
                            onChange={e => updatePhoneField(p.id, e.target.value)}
                            placeholder="+375 (29) 123-45-67"
                            aria-label="Номер телефона"
                            className={`${UI.input} flex-1 font-mono`}
                          />
                          <button
                            type="button"
                            onClick={() => setPrimaryPhone(p.id)}
                            className={
                              p.isPrimary
                                ? "inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[var(--accent-10)] text-[var(--accent-ink)] border border-[var(--accent-30)] transition-colors cursor-pointer shrink-0 min-h-[44px]"
                                : "inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-white text-[#4B5563] border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0 min-h-[44px]"
                            }
                          >
                            {p.isPrimary
                              ? <><Star className="w-3 h-3" aria-hidden="true" /> Основной</>
                              : "Сделать основным"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removePhoneField(p.id)}
                            aria-label="Удалить телефон"
                            title="Удалить телефон"
                            className="inline-flex items-center justify-center p-2 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors shrink-0 cursor-pointer min-h-[44px] min-w-[44px]"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 13. Диспетчер */}
                <div className="flex flex-col gap-2">
                  <label className={UI.fieldLabel}>
                    Закрепленный диспетчер <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={dispatcher}
                    onChange={e => setDispatcher(e.target.value)}
                    className={`${UI.select} w-full`}
                  >
                    <option value="">Выберите диспетчера...</option>
                    {defaultDispatchers.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* 14. Доп. параметры авто */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    <label className={UI.fieldLabel}>Год выпуска</label>
                    <input type="text" value={year} onChange={e => setYear(e.target.value)}
                      className={UI.input} placeholder="2018" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className={UI.fieldLabel}>Тип ТС</label>
                    <input type="text" value={vehicleType} onChange={e => setVehicleType(e.target.value)}
                      className={UI.input} placeholder="Тягач / Прицеп / Фургон" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className={UI.fieldLabel}>Габариты (Д×Ш×В, м)</label>
                    <input type="text" value={dimensions} onChange={e => setDimensions(e.target.value)}
                      className={UI.input} placeholder="13.6 × 2.45 × 2.7" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className={UI.fieldLabel}>Грузоподъёмность (т)</label>
                    <input type="text" value={weight} onChange={e => setWeight(e.target.value)}
                      className={UI.input} placeholder="24" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className={UI.fieldLabel}>Номер прицепа</label>
                    <input type="text" value={trailerNumber} onChange={e => setTrailerNumber(e.target.value)}
                      className={UI.input} placeholder="А 1635 Е-7" />
                  </div>
                  <div className="flex flex-col gap-2 sm:col-span-2">
                    <label className={UI.fieldLabel}>Ставка (€/км, опц.)</label>
                    <input type="text" value={rate} onChange={e => setRate(e.target.value)}
                      className={UI.input} placeholder="2.10" />
                  </div>
                </div>
              </div>

              {/* Ошибка сохранения */}
              {saveError && (
                <div className="mt-4">
                  <ErrorRow text={saveError} />
                </div>
              )}
            </div>

            {/* Подвал */}
            <div className={UI.modalFooter}>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                disabled={isSaving}
                className={UI.buttonGhost}
              >
                Отмена
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={isSaving}
                className={UI.buttonPrimary}
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    <span>Сохранение...</span>
                  </>
                ) : (
                  editingId ? 'Сохранить изменения' : 'Создать запись'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

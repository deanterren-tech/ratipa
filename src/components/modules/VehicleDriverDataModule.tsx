import {useDialog} from '../DialogProvider'
import React, {useState, useEffect} from 'react'
import { 
  FileText, 
  Plus, 
  Search, 
  Trash2, 
  Edit2, 
  Copy, 
  Check, 
  AlertTriangle, 
  User, 
  Phone, 
  Calendar, 
  X,
  ClipboardCheck,
  Folder,
  ExternalLink,
  RefreshCw,
  Maximize2,
  Minimize2,
  HardDrive,
  Truck,
  Users
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
  return (
    <div 
            id={`vehicle-driver-card-${rec.id}`}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-md hover:border-slate-300 transition-all duration-300 flex flex-col overflow-hidden relative font-sans"
        >
      {showVerificationIndicator && (
        <div className="absolute top-2 right-2 bg-amber-50 text-amber-600 border border-amber-200/60 text-[9px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 z-10 font-sans shadow-2xs">
          <AlertTriangle className="w-3 h-3" />
          <span>Верификация</span>
        </div>
      )}

      {/* 1. Блок Авто (Vehicle Header) - Compact & dense */}
      <div className="px-3.5 py-2.5 border-b border-slate-100/60 bg-slate-50/30 flex items-start justify-between gap-3">
        <div className="space-y-0.5 min-w-0 flex-1">
          <div className="text-xs font-bold text-[#3765F6] tracking-wide font-mono bg-[#3765F6]/5 border border-[#3765F6]/10 px-2 py-0.5 rounded-lg w-fit truncate">
            {formatCoupling(rec.coupling || `${rec.vehicleNumbers || ''}${rec.trailerNumber ? ' / ' + rec.trailerNumber : ''}`)}
          </div>
        </div>
        
        {/* Quick Dispatcher Select Dropdown - Compacted */}
        <div className="flex flex-col items-end gap-0.5 shrink-0 select-none font-sans">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Диспетчер</span>
          <select
            value={rec.dispatcher || ""}
            onChange={(e) => onUpdateDispatcher(rec, e.target.value)}
            className="bg-[#3765F6]/5 text-[#3765F6] hover:bg-[#3765F6]/10 border border-[#3765F6]/10 px-1.5 py-0.5 rounded-md text-[9.5px] font-extrabold outline-none focus:border-slate-300 cursor-pointer shadow-2xs transition-all"
          >
            <option value="" className="text-slate-800 bg-white">Без дисп.</option>
            {dispatchersList.map((dispName) => (
              <option key={dispName} value={dispName} className="text-slate-800 bg-white">{dispName}</option>
            ))}
          </select>
        </div>
      </div>

      {/* 2. Блок Водителя и Телефона (Driver Profile & Phones in parallel columns) */}
      <div className="px-3.5 py-2 flex flex-col gap-1.5 border-b border-slate-100/40">
        <div className="grid grid-cols-2 gap-3">
          {/* Driver Name Column */}
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-0.5 text-slate-400">
              <User className="w-3 h-3 text-[#3765F6]" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Водитель</span>
            </div>
            <div className="text-[11px] font-bold text-slate-800" title={rec.driverNameRu}>
              {formatDriverShortName(rec.driverNameRu || (rec as any).driverName)}
            </div>
          </div>

          {/* Phones Column */}
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-0.5 text-slate-400">
              <Phone className="w-3 h-3 text-[#3765F6]" />
              <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Связь</span>
            </div>
            <div className="text-[10px] font-bold text-slate-700 font-mono leading-none space-y-0.5">
              {(rec.phones || []).slice(0, 2).map((p) => (
                <div key={p.id} className={p.isPrimary ? "text-[#3765F6]" : ""}>
                  {p.number} {p.isPrimary && "★"}
                </div>
              ))}
              {(rec.phones || []).length === 0 && (
                <span className="text-slate-300 font-normal italic text-[9px]">Нет телефонов</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* 3. Блок Документов (Documents Info) - Tight multi-column grid */}
      <div className="px-3.5 py-2 bg-slate-50/15 border-b border-slate-100/40 font-sans space-y-1">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
          <div>
            <span className="text-slate-400 font-medium mr-1">Паспорт:</span>
            <span className="font-bold text-slate-700 font-mono">{rec.passportNumber || '—'}</span>
          </div>
          <div>
            <span className="text-slate-400 font-medium mr-1">Д.Рожд:</span>
            <span className="font-bold text-slate-700 font-mono">{rec.birthDate || '—'}</span>
          </div>
          <div className="col-span-2" title={rec.personalId}>
            <span className="text-slate-400 font-medium mr-1">Личный №:</span>
            <span className="font-bold text-slate-700 font-mono tracking-tight text-[9.5px]">{rec.personalId || '—'}</span>
          </div>
          <div className="col-span-2">
            <span className="text-slate-400 font-medium mr-1">Срок действия:</span>
            <span className="font-bold text-slate-700 font-mono text-[9.5px]">{rec.passportStart || '—'} — {rec.passportEnd || '—'}</span>
          </div>
          <div className="col-span-2" title={rec.passportIssuedBy}>
            <span className="text-slate-400 font-medium mr-1">Выдан:</span>
            <span className="font-semibold text-slate-600 text-[9.5px]">{rec.passportIssuedBy || '—'}</span>
          </div>
        </div>
      </div>

      {/* 3.5 Блок Тарифа (Tariff Block) - Embedded inside as tiny line */}
      <div className="px-3.5 py-1.5 bg-blue-50/10 border-b border-slate-100/40 flex items-center justify-between gap-2 font-sans text-[10px]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Тариф</span>
        {matchedTariff ? (
          <div className="flex items-center gap-1 font-bold text-emerald-600 bg-emerald-50 border border-emerald-200/40 px-2 py-0.5 rounded-lg shadow-3xs font-sans text-[9.5px]">
            <span>{matchedTariff.name}</span>
            <span className="text-[8.5px] text-emerald-500 font-mono">({matchedTariff.rate} €)</span>
          </div>
        ) : (rec as any).rate != null && (rec as any).rate !== '' ? (
          <div className="flex items-center gap-1 font-bold text-[#3765F6] bg-[#3765F6]/5 border border-[#3765F6]/10 px-2 py-0.5 rounded-lg shadow-3xs font-sans text-[9.5px]">
            <span>Ставка</span>
            <span className="text-[8.5px] text-[#3765F6] font-mono">{(rec as any).rate} €/км</span>
          </div>
        ) : (
          <span className="text-slate-400 italic font-medium text-[9.5px]">Не установлен</span>
        )}
      </div>

      {/* 3.6 Блок Статуса (На базе / В рейса) — по «Учёту выезда» */}
      <div className="px-3.5 py-1.5 bg-slate-50/30 border-b border-slate-100/40 flex items-center justify-between gap-2 font-sans text-[10px]">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">Статус</span>
        {(() => {
          const plate = normalizePlate(rec.carNumber || rec.vehicleNumbers || '');
          const onBase = plate ? bazaCars.includes(plate) : false;
          return onBase ? (
            <div className="flex items-center gap-1 font-bold text-emerald-700 bg-emerald-50 border border-emerald-200/50 px-2 py-0.5 rounded-lg shadow-3xs font-sans text-[9.5px]">
              <span>На базе</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 font-bold text-slate-700 bg-slate-100 border border-slate-200/60 px-2 py-0.5 rounded-lg shadow-3xs font-sans text-[9.5px]">
              <span>В рейсе</span>
            </div>
          );
        })()}
      </div>

      {/* 4. Копируемый блок данных (Formatted Plain Copy Area) - Compressed to save space */}
      <div className="px-3.5 py-2 flex-1 flex flex-col justify-end bg-slate-50/5">
        <div className="bg-slate-50 rounded-2xl p-2 font-mono text-[9.5px] text-slate-600 leading-tight relative group">
          <div className="text-slate-400 border-b border-slate-200/40 pb-1 mb-1 flex items-center justify-between text-[8px] font-bold tracking-wider font-sans select-none">
            <span className="text-[#3765F6] font-extrabold">ДЛЯ БУФЕРА ОБМЕНА</span>
            <button
              onClick={() => copyToClipboard(rec)}
              className="text-[#3765F6] hover:text-white hover:bg-[#3765F6] transition-all flex items-center gap-1 py-0.5 px-2 cursor-pointer bg-white rounded-md border border-slate-200 shadow-sm font-sans text-[8.5px] font-bold active:scale-95 min-h-[44px]"
              title="Скопировать весь блок"
            >
              {copiedId === rec.id ? <ClipboardCheck className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copiedId === rec.id ? 'Готово!' : 'Коп.'}</span>
            </button>
          </div>
          <div className="select-all font-bold text-slate-800 leading-none mb-0.5">{formatCoupling(rec.coupling || `${(rec.carNumber || rec.vehicleNumbers || '')} / ${(rec as any).trailerNumber || ''}`)}</div>
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

      {/* 5. Действия (Card Action Bar) - Minimal height */}
      <div className="px-3.5 py-2 border-t border-slate-100 bg-white flex justify-between gap-2 font-sans">
        <button
          onClick={() => openEdit(rec)}
          className="flex-1 py-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 font-bold text-[10px] rounded-lg transition duration-150 flex items-center justify-center gap-1 cursor-pointer font-sans active:scale-95 shadow-sm min-h-[44px]"
        >
          <Edit2 className="w-3 h-3 text-slate-400" />
          <span>Редактировать</span>
        </button>
        <button
          onClick={() => handleDelete(rec)}
          className="py-1.5 px-2 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition duration-150 flex items-center justify-center cursor-pointer active:scale-95 shadow-sm min-h-[44px] min-w-[44px]"
          title="Удалить"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
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
  // «Учёт выезда» (baza) — источник статуса «На базе / В рейса» в базе сцепок
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

    // Подписка на «Учёт выезда» (baza) для статуса «На базе / В рейса»
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
    const updatedRecord = { ...rec, dispatcher: nextDispatcher };
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
    
    // Статус «На базе / В рейса»: есть номер авто в «Учёте выезда» (baza) → На базе, иначе → В рейса
    const recPlate = normalizePlate(rec.carNumber || rec.vehicleNumbers || '');
    const isOnBase = recPlate ? bazaCars.includes(recPlate) : false;
    const couplingStatus = isOnBase ? 'on_base' : 'in_trip'; // На базе / В рейса

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
    <div className="space-y-6 font-sans">
      {/* Header card styled like Ratipa Welcome Scene glass container */}
      <div className="bg-white border border-slate-200/60 rounded-3xl p-6 lg:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">Модуль ТС и Водители</span>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <Truck className="w-7 h-7 text-slate-800" />
              <span>Данные по авто и водителям</span>
            </h1>
            <p className="text-xs text-slate-400 font-medium tracking-normal font-sans">
              База данных паспортных реквизитов, телефонной связи и закрепленных диспетчеров RATIPA
            </p>
          </div>
          
          <div className="flex items-center gap-3 flex-wrap w-full md:w-auto">
            <button
              id="btn-google-drive-toggle"
              onClick={() => {
                const nextState = !isDriveOpen;
                setIsDriveOpen(nextState);
                localStorage.setItem('ratipa_driver_drive_visible', nextState.toString());
              }}
              className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all duration-150 border flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 min-h-[44px] ${
                isDriveOpen
                  ? 'bg-[#3765F6]/10 text-[#3765F6] border-[#3765F6]/20'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200/60'
              }`}
            >
              <Folder className="w-4 h-4 text-[#3765F6]" />
              <span>Google Диск</span>
            </button>

            <button
              id="btn-add-driver-record"
              onClick={handleOpenAdd}
              className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all duration-150 border border-transparent flex items-center gap-2 cursor-pointer shadow-sm active:scale-95 min-h-[44px]"
            >
              <Plus className="w-4 h-4" />
              <span>Добавить данные</span>
            </button>
          </div>
        </div>

      </div>

      <div className={isDriveOpen ? "grid grid-cols-1 xl:grid-cols-12 gap-6" : "space-y-6"}>
        
        {/* Left Column (Main Drivers Database) */}
        <div className={isDriveOpen ? "xl:col-span-7 space-y-6" : "space-y-6"}>
          
          {/* Unified Fleet & Crew Registry Block */}
          <div className="bg-white border border-slate-200/60 rounded-3xl p-6 shadow-sm space-y-6">
            <div className="flex flex-col gap-4 border-b border-slate-100 pb-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Truck className="w-5.5 h-5.5 text-[#3765F6]" />
                  <h3 className="text-sm font-bold text-slate-800 uppercase tracking-tight font-sans">
                    Реестр автопарка и экипажей ({filteredRecords.length})
                  </h3>
                </div>
              </div>

              {/* Dynamic Filters Bar */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-sans">
                {/* 1. Main Search Input */}
                <div className="relative col-span-1 sm:col-span-2 lg:col-span-1">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-3.5 h-3.5" />
                  </span>
                  <input
                    type="text"
                    value={carSearchQuery}
                    onChange={e => setCarSearchQuery(e.target.value)}
                    placeholder="Поиск по номерам, ФИО..."
                    className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold pl-9 pr-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition placeholder-slate-400"
                  />
                </div>

                {/* 2. Dispatcher Filter */}
                <select
                  value={selectedDispatcherFilter}
                  onChange={e => setSelectedDispatcherFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition cursor-pointer"
                >
                  <option value="all">Все диспетчеры</option>
                  <option value="none">Без диспетчера</option>
                  {defaultDispatchers.map(d => (
                    <option key={d} value={d}>{d}</option>
                  ))}
                </select>

                {/* 3. Tariff Filter */}
                <select
                  value={selectedTariffFilter}
                  onChange={e => setSelectedTariffFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition cursor-pointer"
                >
                  <option value="all">Все тарифные группы</option>
                  <option value="none">Без тарифа</option>
                  {carRateGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>

                {/* 4. Status Filter */}
                <select
                  value={selectedStatusFilter}
                  onChange={e => setSelectedStatusFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition cursor-pointer"
                >
                  <option value="all">Все статусы</option>
                  <option value="verification">Требует верификации</option>
                  <option value="on_base">На базе</option>
                  <option value="in_trip">В рейсе</option>
                </select>
              </div>
            </div>

            {/* List of Unified Cards */}
            {!isDataLoaded ? (
              <div className="bg-slate-50 rounded-2xl p-12 text-center border border-slate-200/60 text-slate-500 font-semibold text-xs italic flex flex-col items-center justify-center gap-2">
                <div className="w-8 h-8 border-2 border-slate-300 border-t-[#3765F6] rounded-full animate-spin" />
                <span>Загрузка данных автопарка...</span>
              </div>
            ) : filteredRecords.length === 0 ? (
              <div className="bg-slate-50 rounded-2xl p-12 text-center border border-slate-200/60 text-slate-500 font-semibold text-xs italic flex flex-col items-center justify-center gap-2">
                <Truck className="w-8 h-8 text-slate-300 stroke-1" />
                <span>Записи автопарка не найдены с выбранными фильтрами</span>
              </div>
            ) : (
              <div className="space-y-6">
                <div className={`grid grid-cols-1 sm:grid-cols-2 ${isDriveOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-6 pr-1 custom-scrollbar`}>
                  {filteredRecords.slice(0, carsLimit).map(renderCard)}
                </div>

                {filteredRecords.length > carsLimit && (
                  <button
                    id="load-more-records"
                    onClick={() => setCarsLimit(prev => prev + 30)}
                    className="w-full py-3 border border-dashed border-slate-200 hover:border-slate-400 text-slate-500 hover:text-slate-700 font-bold text-xs rounded-2xl transition bg-white hover:bg-slate-50 cursor-pointer text-center font-sans shadow-sm block min-h-[44px]"
                  >
                    Показать еще (+30)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Google Drive Iframe) — inline on desktop, modal on mobile */}
        {isDriveOpen && (
          <>
            {/* Desktop: inline panel */}
            <div className="hidden md:flex xl:col-span-5 flex-col bg-white border border-slate-200/60 rounded-2xl shadow-sm overflow-hidden transition-all duration-300">
              {/* Drive Panel Header */}
              <div className="p-4 bg-white border-b border-slate-200/60 flex items-center justify-between gap-4 shrink-0 select-none rounded-t-2xl font-sans">
                <div className="flex items-center gap-2">
                  <div className="p-1 px-2.5 bg-[#3765F6]/10 text-[#3765F6] font-bold text-[9px] rounded-full uppercase tracking-wider font-mono flex items-center gap-1 border border-[#3765F6]/10">
                    <HardDrive className="w-3 h-3" />
                    <span>DRIVE</span>
                  </div>
                  <h3 className="text-xs font-bold text-slate-800 tracking-tight hidden sm:block">Google Диск</h3>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setIsDriveLoading(true); setDriveIframeKey(k => k + 1); }} className="p-1.5 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200/60 transition cursor-pointer" title="Обновить Диск">
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                  <a href={rawDriveUrl} target="_blank" rel="noopener noreferrer" className="p-1.5 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200/60 transition cursor-pointer flex items-center gap-1.5 text-[10px] font-bold px-2.5" title="Открыть во вкладке">
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span className="hidden md:inline uppercase tracking-wider text-[9px]">Вкладка</span>
                  </a>
                  <button
                    onClick={() => setIsDriveFocusMode(!isDriveFocusMode)}
                    className={`p-1.5 rounded-lg border transition cursor-pointer ${isDriveFocusMode ? 'bg-[#3765F6] border-[#3765F6] text-white shadow-xs' : 'bg-white border-slate-200 hover:bg-slate-50 text-slate-600'}`}
                    title={isDriveFocusMode ? "Свернуть" : "Развернуть на весь экран"}
                  >
                    {isDriveFocusMode ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={() => { setIsDriveOpen(false); localStorage.setItem('ratipa_driver_drive_visible', 'false'); }} className="p-1.5 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-600 rounded-lg border border-slate-200/60 transition cursor-pointer" title="Закрыть панель">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              {/* Drive Panel Iframe Container */}
              <div className="flex-1 bg-white p-2 relative overflow-hidden" style={{ minHeight: '600px' }}>
                {isDriveLoading && (
                  <div className="absolute inset-2 bg-white rounded-xl flex flex-col items-center justify-center p-6 gap-3 z-10 transition duration-300 shadow-inner">
                    <Folder className="w-10 h-10 text-slate-300 animate-bounce" />
                    <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Подключение к Google Диск...</span>
                    <span className="text-[9px] text-slate-300">Загрузка защищенного хранилища сканов</span>
                  </div>
                )}
                <iframe key={driveIframeKey} src={driveEmbedUrl} onLoad={() => setIsDriveLoading(false)} className="w-full h-full border-0 rounded-xl bg-white shadow-inner" allow="clipboard-write" title="Google Диск - Документы Водителей" />
              </div>
            </div>

            {/* Mobile: full-screen modal */}
            <div className="fixed inset-0 z-[500] bg-slate-900/60 flex md:hidden" onClick={() => { setIsDriveOpen(false); localStorage.setItem('ratipa_driver_drive_visible', 'false'); }}>
              <div className="bg-white flex flex-col w-full h-full" onClick={(e) => e.stopPropagation()}>
                <div className="p-4 border-b border-slate-200 flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <HardDrive className="w-4 h-4 text-[#3765F6]" />
                    <span className="text-xs font-bold text-slate-800">Google Диск</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={() => { setIsDriveLoading(true); setDriveIframeKey(k => k + 1); }} className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition cursor-pointer">
                      <RefreshCw className="w-4 h-4" />
                    </button>
                    <a href={rawDriveUrl} target="_blank" rel="noopener noreferrer" className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 transition">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                    <button onClick={() => { setIsDriveOpen(false); localStorage.setItem('ratipa_driver_drive_visible', 'false'); }} className="min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-400 hover:text-slate-700 transition cursor-pointer">
                      <X className="w-5 h-5" strokeWidth={2.5} />
                    </button>
                  </div>
                </div>
                <div className="flex-1 relative overflow-hidden bg-slate-50">
                  {isDriveLoading && (
                    <div className="absolute inset-0 bg-white flex flex-col items-center justify-center p-6 gap-3 z-10">
                      <Folder className="w-10 h-10 text-slate-300 animate-bounce" />
                      <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Загрузка...</span>
                    </div>
                  )}
                  <iframe key={driveIframeKey + '-mobile'} src={driveEmbedUrl} onLoad={() => setIsDriveLoading(false)} className="w-full h-full border-0 bg-white" allow="clipboard-write" title="Google Диск - Документы Водителей" />
                </div>
              </div>
            </div>
          </>
        )}

      </div>

      {/* Annual Passport Verification Pop-up Prompt */}
      {currentVerification && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/50 animate-fade-in overflow-y-auto">
          <div className="bg-white rounded-3xl w-full max-w-full md:max-w-md mx-4 shadow-2xl p-6 border border-slate-200 flex flex-col gap-5 text-center font-sans my-4">
            <div className="mx-auto bg-amber-50 text-amber-500 p-3.5 rounded-full shadow-2xs w-max">
              <AlertTriangle className="w-8 h-8 animate-bounce" />
            </div>
            
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-slate-800 uppercase tracking-tight">Ежегодная проверка актуальности</h3>
              <div className="text-[10px] font-bold uppercase text-amber-600 tracking-wider">Требуется подтверждение данных паспорта</div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed">
              Уважаемый диспетчер! Сегодня наступила дата ежегодной сверки паспортных реквизитов для водителя:
              <br />
              <strong className="text-slate-900 text-sm block my-2 underline">
                {formatDriverShortName(currentVerification.driverNameRu || (currentVerification as any).driverName)}
              </strong>
              Паспорт серии <span className="font-mono font-bold text-slate-800">{currentVerification.passportNumber}</span>, дата выдачи: <span className="font-mono font-bold text-slate-800">{currentVerification.passportStart}</span>.
              <br />
              Данные паспорта по-прежнему актуальны?
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => handleVerifySuccess(currentVerification)}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition border border-transparent cursor-pointer shadow-sm min-h-[44px]"
              >
                Да, данные актуальны
              </button>
              
              <div className="flex gap-2">
                <button
                  onClick={() => handleVerifyEdit(currentVerification)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-xl transition cursor-pointer border border-slate-200/60 shadow-sm min-h-[44px]"
                >
                  Нет, редактировать
                </button>
                <button
                  onClick={() => handleVerifySkip(currentVerification)}
                  className="flex-1 py-2.5 bg-white hover:bg-slate-50 text-slate-500 font-bold text-[11px] rounded-xl transition cursor-pointer border border-slate-200 shadow-sm min-h-[44px]"
                >
                  Пропустить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Add Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/50 overflow-y-auto animate-fade-in font-sans">
          <div className="bg-white rounded-3xl w-full max-w-full md:max-w-2xl mx-4 shadow-2xl flex flex-col pt-1 my-4 border border-slate-200/60">
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between bg-white">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#3765F6]" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-tight font-sans">
                  {editingId ? 'Редактировать запись' : 'Добавить новые данные авто и водителя'}
                </h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 md:w-8 md:h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center transition text-slate-500 font-bold text-lg cursor-pointer active:scale-95 shadow-sm min-h-[44px] min-w-[44px]"
              >
                ×
              </button>
            </div>


            {/* Form Fields */}
            <div className="p-6 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Номера ТС */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
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

                {/* 2. Марка тягача и прицепа */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Марка тягача <span className="text-slate-400 font-normal">(латиница)</span>
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                  <datalist id="vehicle-brands-datalist">
                    {existingVehicleBrands.map(brand => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Марка прицепа <span className="text-slate-400 font-normal">(латиница)</span>
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
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                  <datalist id="trailer-brands-datalist">
                    {existingTrailerBrands.map(brand => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </div>

                {/* 3. Водитель */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    ФИО Водителя (Русский) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={driverNameRu}
                    onChange={e => setDriverNameRu(e.target.value)}
                    placeholder="Устинов Олег Леонидович"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    ФИО Водителя (Латиница)
                  </label>
                  <input
                    type="text"
                    value={driverNameLat}
                    onChange={e => setDriverNameLat(e.target.value)}
                    placeholder="USTSINAU ALEH"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>

                {/* 4. Дата рождения */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Дата рождения <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={birthDate}
                    onChange={e => setBirthDate(e.target.value)}
                    placeholder="08.02.1973"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>

                {/* 5. Паспорт */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Серия и номер Паспорта <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportNumber}
                    onChange={e => setPassportNumber(e.target.value)}
                    placeholder="МР 5065058"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>

                {/* 6. Идентификационный номер */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Идентификационный номер <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={personalId}
                    onChange={e => setPersonalId(e.target.value)}
                    placeholder="3080273A018PB6"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-slate-300 focus:bg-white transition font-mono uppercase"
                  />
                </div>

                {/* 7. Срок начала */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Дата выдачи паспорта (Срок от) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportStart}
                    onChange={e => setPassportStart(e.target.value)}
                    placeholder="09.01.2024"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>

                {/* 8. Срок конца */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Дата окончания паспорта (Срок до) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportEnd}
                    onChange={e => setPassportEnd(e.target.value)}
                    placeholder="09.01.2034"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>

                {/* 9. Выдан */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Кем выдан паспорт <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportIssuedBy}
                    onChange={e => setPassportIssuedBy(e.target.value)}
                    placeholder="Фрунзенским РУВД г. Минска"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition"
                  />
                </div>

                {/* 10. Телефоны */}
                <div className="md:col-span-2 space-y-2 bg-white border border-slate-200/60 p-4.5 rounded-xl">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                                      <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                                        Телефоны связи <span className="text-rose-500">*</span>
                                      </label>
                    <button
                      type="button"
                      onClick={addPhoneField}
                      className="text-[10px] font-bold text-white bg-slate-900 hover:bg-slate-800 px-2.5 py-1 rounded-lg flex items-center gap-1 transition shadow-sm cursor-pointer active:scale-95 min-h-[44px]"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Добавить телефон</span>
                    </button>
                  </div>
                  
                  {phones.length === 0 ? (
                    <div className="text-xs text-slate-400 italic py-3 text-center bg-white border border-dashed border-slate-200 rounded-xl font-sans">
                      Нет добавленных телефонов. Нажмите "Добавить телефон" выше.
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {phones.map((p) => (
                        <div key={p.id} className="flex items-center gap-2 bg-white p-2 border border-slate-200/60 rounded-xl shadow-2xs">
                          <input
                            type="text"
                            value={p.number}
                            onChange={e => updatePhoneField(p.id, e.target.value)}
                            placeholder="+375 (29) 123-45-67"
                            className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setPrimaryPhone(p.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer shrink-0 min-h-[44px] ${
                              p.isPrimary 
                                ? "bg-[#3765F6]/15 text-[#3765F6] border border-[#3765F6]/25" 
                                : "bg-slate-100 text-slate-500 border border-slate-200/60 hover:bg-slate-200/80"
                            }`}
                          >
                            {p.isPrimary ? "★ Основной" : "Сделать основным"}
                          </button>
                          <button
                            type="button"
                            onClick={() => removePhoneField(p.id)}
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0 cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
                            title="Удалить телефон"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* 11. Диспетчер */}
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">
                    Закрепленный диспетчер <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={dispatcher}
                    onChange={e => setDispatcher(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition cursor-pointer"
                  >
                    <option value="">Выберите диспетчера...</option>
                    {defaultDispatchers.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                {/* 12. Доп. параметры авто */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Год выпуска</label>
                    <input type="text" value={year} onChange={e => setYear(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition" placeholder="2018" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Тип ТС</label>
                    <input type="text" value={vehicleType} onChange={e => setVehicleType(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition" placeholder="Тягач / Прицеп / Фургон" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Габариты (Д×Ш×В, м)</label>
                    <input type="text" value={dimensions} onChange={e => setDimensions(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition" placeholder="13.6 × 2.45 × 2.7" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Грузоподъёмность (т)</label>
                    <input type="text" value={weight} onChange={e => setWeight(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition" placeholder="24" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Номер прицепа</label>
                    <input type="text" value={trailerNumber} onChange={e => setTrailerNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition" placeholder="А 1635 Е-7" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1.5 block">Ставка (€/км, опц.)</label>
                    <input type="text" value={rate} onChange={e => setRate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition" placeholder="2.10" />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Error Banner */}
            {saveError && (
              <div className="mx-6 mt-4 p-4.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-start gap-2.5 text-xs font-sans shadow-sm animate-fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="font-semibold leading-normal">{saveError}</div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-white">
              <button
                onClick={() => setModalOpen(false)}
                disabled={isSaving}
                className="px-6 py-2.5 rounded-xl font-bold text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition text-xs font-sans cursor-pointer shadow-sm disabled:opacity-50 min-h-[44px]"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-2.5 rounded-xl font-bold text-white bg-slate-900 hover:bg-slate-800 transition shadow-sm text-xs font-sans cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 min-w-[150px] disabled:bg-slate-400 disabled:cursor-not-allowed min-h-[44px]"
              >
                {isSaving ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
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
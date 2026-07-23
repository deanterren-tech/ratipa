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
  Sparkles, 
  X,
  ClipboardCheck,
  Shield,
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
import {getCouplings, getDriversFlat} from '../../services/fleetService'
import { ref, update } from 'firebase/database';
import {UserProfile, AppSettings, PhoneNumber, Driver, CarRateGroup} from '../../types'
import {formatDriverShortName} from '../../utils/driverSync'
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
  onUpdateDispatcher
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
}) => {
  const brandsText = brandModel ? `${brandModel}${trailerMake ? ' / ' + trailerMake : ''}` : (rec.brandsLat || '');
  return (
    <div 
      id={`vehicle-driver-card-${rec.id}`}
      className="bg-white/80 backdrop-blur-xl rounded-2xl border border-slate-200/40 shadow-2xs hover:shadow-md hover:border-slate-300/50 hover:bg-white/95 transition-all duration-300 flex flex-col overflow-hidden relative font-sans"
    >
      {showVerificationIndicator && (
        <div className="absolute top-2 right-2 bg-amber-50 text-amber-600 border border-amber-200/60 text-[9px] font-bold px-2 py-0.5 rounded-md flex items-center gap-1 animate-pulse z-10 font-sans shadow-2xs">
          <AlertTriangle className="w-3 h-3" />
          <span>Верификация</span>
        </div>
      )}

      {/* 1. Блок Авто (Vehicle Header) - Compact & dense */}
      <div className="px-3.5 py-2.5 border-b border-slate-100/60 bg-slate-50/30 flex items-start justify-between gap-3">
        <div className="space-y-0.5 min-w-0 flex-1">
          <div className="text-xs font-bold text-[#3765F6] tracking-wide font-mono bg-[#3765F6]/5 border border-[#3765F6]/10 px-2 py-0.5 rounded-lg w-fit truncate">
            {rec.vehicleNumbers}
          </div>
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-wide font-sans truncate" title={brandsText}>
            {brandModel ? (
              <span>Сцепка: <span className="text-slate-700">{rec.coupling || (rec.carNumber || rec.vehicleNumbers || '')}</span></span>
            ) : rec.brandsLat ? (
              <span>Тягач: <span className="text-slate-700">{rec.brandsLat}</span></span>
            ) : (
              <span className="text-slate-300 italic font-normal text-[9px]">Марка не указана</span>
            )}
          </div>
        </div>
        
        {/* Quick Dispatcher Select Dropdown - Compacted */}
        <div className="flex flex-col items-end gap-0.5 shrink-0 select-none font-sans">
          <span className="text-[8px] font-extrabold text-slate-400 uppercase tracking-wider">Диспетчер</span>
          <select
            value={rec.dispatcher || ""}
            onChange={(e) => onUpdateDispatcher(rec, e.target.value)}
            className="bg-[#3765F6]/5 text-[#3765F6] hover:bg-[#3765F6]/10 border border-[#3765F6]/10 px-1.5 py-0.5 rounded-md text-[9.5px] font-extrabold outline-none focus:border-[#3765F6] cursor-pointer shadow-2xs transition-all"
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
              <span className="text-[9px] uppercase font-bold tracking-wider">Водитель</span>
            </div>
            <div className="text-[11px] font-bold text-slate-800 truncate" title={rec.driverNameRu}>
              {formatDriverShortName(rec.driverNameRu || (rec as any).driverName)}
            </div>
          </div>

          {/* Phones Column */}
          <div className="min-w-0">
            <div className="flex items-center gap-1 mb-0.5 text-slate-400">
              <Phone className="w-3 h-3 text-[#3765F6]" />
              <span className="text-[9px] uppercase font-bold tracking-wider">Связь</span>
            </div>
            <div className="text-[10px] font-bold text-slate-700 font-mono leading-none space-y-0.5">
              {(rec.phones || []).slice(0, 2).map((p) => (
                <div key={p.id} className={p.isPrimary ? "text-[#3765F6] truncate" : "truncate"}>
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
          <div className="col-span-2 truncate" title={rec.personalId}>
            <span className="text-slate-400 font-medium mr-1">Личный №:</span>
            <span className="font-bold text-slate-700 font-mono tracking-tight text-[9.5px]">{rec.personalId || '—'}</span>
          </div>
          <div className="col-span-2">
            <span className="text-slate-400 font-medium mr-1">Срок действия:</span>
            <span className="font-bold text-slate-700 font-mono text-[9.5px]">{rec.passportStart || '—'} — {rec.passportEnd || '—'}</span>
          </div>
          <div className="col-span-2 truncate" title={rec.passportIssuedBy}>
            <span className="text-slate-400 font-medium mr-1">Выдан:</span>
            <span className="font-semibold text-slate-600 text-[9.5px]">{rec.passportIssuedBy || '—'}</span>
          </div>
        </div>
      </div>

      {/* 3.5 Блок Тарифа (Tariff Block) - Embedded inside as tiny line */}
      <div className="px-3.5 py-1.5 bg-blue-50/10 border-b border-slate-100/40 flex items-center justify-between gap-2 font-sans text-[10px]">
        <span className="text-[9px] uppercase font-bold tracking-wider text-slate-400">Тариф</span>
        {matchedTariff ? (
          <div className="flex items-center gap-1 font-bold text-emerald-600 bg-emerald-50 border border-emerald-200/40 px-2 py-0.5 rounded-lg shadow-3xs font-sans text-[9.5px]">
            <span>{matchedTariff.name}</span>
            <span className="text-[8.5px] text-emerald-500 font-mono">({matchedTariff.rate} €)</span>
          </div>
        ) : (
          <span className="text-slate-400 italic font-medium text-[9.5px]">Не установлен</span>
        )}
      </div>

      {/* 4. Копируемый блок данных (Formatted Plain Copy Area) - Compressed to save space */}
      <div className="px-3.5 py-2 flex-1 flex flex-col justify-end bg-slate-50/5">
        <div className="bg-[#3765F6]/5 border border-[#3765F6]/10 rounded-xl p-2 font-mono text-[9.5px] text-slate-600 leading-tight relative group">
          <div className="text-slate-400 border-b border-slate-200/40 pb-1 mb-1 flex items-center justify-between text-[8px] font-bold tracking-wider font-sans select-none">
            <span className="text-[#3765F6] font-extrabold">ДЛЯ БУФЕРА ОБМЕНА</span>
            <button
              onClick={() => copyToClipboard(rec)}
              className="text-[#3765F6] hover:text-white hover:bg-[#3765F6] transition-all flex items-center gap-1 py-0.5 px-2 cursor-pointer bg-white rounded-md border border-[#3765F6]/10 shadow-3xs font-sans text-[8.5px] font-bold active:scale-95"
              title="Скопировать весь блок"
            >
              {copiedId === rec.id ? <ClipboardCheck className="w-2.5 h-2.5 text-emerald-500" /> : <Copy className="w-2.5 h-2.5" />}
              <span>{copiedId === rec.id ? 'Готово!' : 'Коп.'}</span>
            </button>
          </div>
          <div className="select-all font-bold text-slate-800 leading-none mb-0.5">{rec.coupling || `${(rec.carNumber || rec.vehicleNumbers || '')} / ${(rec as any).trailerNumber || ''}`}</div>
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
      <div className="px-3.5 py-2 border-t border-slate-100 bg-slate-50/50 flex justify-between gap-2 font-sans">
        <button
          onClick={() => openEdit(rec)}
          className="flex-1 py-1.5 px-2.5 bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 font-bold text-[10px] rounded-lg transition duration-150 flex items-center justify-center gap-1 cursor-pointer font-sans active:scale-95 shadow-3xs"
        >
          <Edit2 className="w-3 h-3 text-slate-400" />
          <span>Редактировать</span>
        </button>
        <button
          onClick={() => handleDelete(rec)}
          className="py-1.5 px-2 bg-white text-slate-400 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg transition duration-150 flex items-center justify-center cursor-pointer active:scale-95 shadow-3xs"
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
  
  // AI assistant state
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

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
  const [verifyFleet, setVerifyFleet] = useState<any[]>([]);

  useEffect(() => {
    // Fetch live vehicles data — getVehicleDriverData now reads the unified
    // base (vehicleFleet). Both `records` and `fleetVehicles` come from it,
    // and verifyFleet is just an alias of fleetVehicles (single source of truth).
    const unsubData = getCouplings((list) => {
      setRecords(list);
      setFleetVehicles(list); // Combined: records and fleetVehicles are identical, eliminating duplicate listeners!
      setVerifyFleet(list);   // verification queue reads the same unified base
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

    return () => {
      unsubData();
      unsubCarRateGroups();
      if (typeof unsubDrivers === 'function') unsubDrivers();
      if (typeof unsubUsers === 'function') unsubUsers();
      if (typeof unsubSettings === 'function') unsubSettings();
      if (typeof unsubVBrands === 'function') unsubVBrands();
      if (typeof unsubTBrands === 'function') unsubTBrands();
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
  }, [verifyFleet]);

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
      toast('Ошибка подтверждения: ' + (e?.message || e), 'error');
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
    setAiText('');
    setAiError('');
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
    setDispatcher(rec.dispatcher || '');
    setDimensions((rec as any).dimensions || '');
    setWeight((rec as any).weight || '');
    setVehicleType((rec as any).vehicleType || '');
    setYear((rec as any).year || '');
    setTrailerNumber((rec as any).trailerNumber || '');
    setDriverPhone((rec as any).driverPhone || '');
    setRate((rec as any).rate != null ? String((rec as any).rate) : '');
    setAiText('');
    setAiError('');
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
      setSaveError(`Ошибка при сохранении: ${err.message || String(err)}`);
      setIsSaving(false);
    }
  };

  const handleDelete = async (rec: VehicleDriverRecord) => {
    if (await showConfirm(`Вы уверены, что хотите удалить запись для автомобиля ${rec.vehicleNumbers} (водитель: ${formatDriverShortName(rec.driverNameRu || (rec as any).driverName)})? Это действие нельзя отменить.`)) {
      dbService.deleteVehicleDriverRecord(rec.id, user.name, user.role);
    }
  };

  const handleAiParse = async () => {
    if (!aiText.trim()) {
      setAiError('Введите текст для распознавания');
      return;
    }

    setAiLoading(true);
    setAiError('');

    try {
      const res = await fetch('/api/parse-driver-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText })
      });

      if (!res.ok) {
        let serverError = 'Ошибка связи с сервером парсинга';
        try {
          const errData = await res.json();
          if (errData && errData.error) {
            serverError = errData.error;
          }
        } catch (_) {}
        throw new Error(serverError);
      }

      const data = await res.json();
      if (data.results) {
        const r = data.results;
        const warnings: string[] = [];

        // 1. Vehicle Numbers & Trailer Plates Validation
        if (r.vehicleNumbers) {
          const parts = r.vehicleNumbers.split('/');
          const validParts = parts
            .map((p: string) => p.trim())
            .filter((p: string) => {
              const cleaned = p.toUpperCase().replace(/\s+/g, '');
              const isValid = /^[A-Z0-9А-ЯЁ-]{4,15}$/i.test(cleaned);
              return isValid;
            });

          if (validParts.length > 0) {
            setVehicleNumbers(validParts.join(' / '));
            if (validParts.length < parts.length) {
              warnings.push('Некоторые некорректные госномера были отфильтрованы.');
            }
          } else {
            setVehicleNumbers('');
            warnings.push('Не найден валидный формат госномера авто/прицепа.');
          }
        }

        // 2. Russian Name Validation (must be Cyrillic only)
        const rawDriverNameRu = r.driverNameRu || r.driverName || '';
        if (rawDriverNameRu) {
          const trimmed = rawDriverNameRu.trim();
          if (/^[А-ЯЁа-яё\s.-]+$/i.test(trimmed)) {
            setDriverNameRu(trimmed);
          } else {
            setDriverNameRu('');
            warnings.push('ФИО на русском должно содержать только кириллицу.');
          }
        }

        // 3. Latin Name Validation (must be Latin only)
        if (r.driverNameLat) {
          const trimmed = r.driverNameLat.trim();
          if (/^[A-Z\s.-]+$/i.test(trimmed)) {
            setDriverNameLat(trimmed);
          } else {
            setDriverNameLat('');
            warnings.push('ФИО на латинице должно содержать только латинские буквы.');
          }
        }

        // 4. Phone Numbers Validation & Deduplication
        const parsedPhones: PhoneNumber[] = [];
        if (r.phones && Array.isArray(r.phones)) {
          r.phones.forEach((p: any, idx: number) => {
            const rawNum = p.number || p.phone || '';
            const cleanedDigits = rawNum.replace(/[\s().+-]/g, '');
            if (cleanedDigits.length >= 7 && cleanedDigits.length <= 15 && /^\d+$/.test(cleanedDigits)) {
              parsedPhones.push({
                id: `phone_ai_${Date.now()}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
                number: rawNum.trim(),
                isPrimary: p.isPrimary !== undefined ? p.isPrimary : idx === 0
              });
            }
          });
        } else if (r.phone) {
          const rawNum = r.phone;
          const cleanedDigits = rawNum.replace(/[\s().+-]/g, '');
          if (cleanedDigits.length >= 7 && cleanedDigits.length <= 15 && /^\d+$/.test(cleanedDigits)) {
            parsedPhones.push({
              id: `phone_ai_${Date.now()}`,
              number: rawNum.trim(),
              isPrimary: true
            });
          }
        }

        if (parsedPhones.length > 0) {
          if (!parsedPhones.some(p => p.isPrimary)) {
            parsedPhones[0].isPrimary = true;
          }
          setPhones(parsedPhones);
        } else {
          setPhones([{ id: `phone_1`, number: '', isPrimary: true }]);
          warnings.push('Не удалось распознать корректные телефонные номера.');
        }

        // 5. Basic dates validation (BirthDate, passport start/end)
        const dateRegex = /^\d{2}\.\d{2}\.\d{4}$/;
        if (r.birthDate && dateRegex.test(r.birthDate.trim())) {
          setBirthDate(r.birthDate.trim());
        } else if (r.birthDate) {
          setBirthDate('');
          warnings.push('Неверный формат даты рождения (ожидается ДД.ММ.ГГГГ).');
        }

        if (r.passportStart && dateRegex.test(r.passportStart.trim())) {
          setPassportStart(r.passportStart.trim());
        } else if (r.passportStart) {
          setPassportStart('');
          warnings.push('Неверный формат даты выдачи паспорта (ожидается ДД.ММ.ГГГГ).');
        }

        if (r.passportEnd && dateRegex.test(r.passportEnd.trim())) {
          setPassportEnd(r.passportEnd.trim());
        } else if (r.passportEnd) {
          setPassportEnd('');
          warnings.push('Неверный формат срока действия паспорта (ожидается ДД.ММ.ГГГГ).');
        }

        // 6. Other passport fields (simply assign if non-empty, otherwise clear or keep empty to avoid bad guesses)
        if (r.passportNumber) {
          setPassportNumber(r.passportNumber.toUpperCase().replace(/\s+/g, ''));
        }
        if (r.personalId) {
          const pid = r.personalId.toUpperCase().replace(/\s+/g, '');
          if (pid.length === 14) {
            setPersonalId(pid);
          } else {
            setPersonalId('');
            warnings.push('Идентификационный номер должен состоять ровно из 14 символов.');
          }
        }
        if (r.passportIssuedBy) setPassportIssuedBy(r.passportIssuedBy);
        if (r.dispatcher) setDispatcher(r.dispatcher);

        if (r.brandModel) {
          setFormBrandModel(r.brandModel.toUpperCase().trim());
        } else {
          setFormBrandModel('');
        }
        if (r.trailerMake) {
          setFormTrailerMake(r.trailerMake.toUpperCase().trim());
        } else {
          setFormTrailerMake('');
        }

        // Display results or warnings to the user
        if (warnings.length > 0) {
          setAiError(`Данные успешно распознаны частично:\n${warnings.join('\n')}`);
        } else {
          setAiError('');
        }
      } else {
        setAiError('Не удалось корректно распознать данные. Попробуйте еще раз.');
      }
    } catch (err: unknown) {
      console.error(err);
      setAiError(err.message || 'Ошибка распознавания');
    } finally {
      setAiLoading(false);
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
    const couplingText = rec.coupling || `${(rec.carNumber || rec.vehicleNumbers || '')} / ${(rec as any).trailerNumber || ''}`;
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
      alert("Ошибка изменения диспетчера: " + (err.message || String(err)));
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
    
    if (selectedStatusFilter === 'verification' && !isVerificationRequired) {
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
    const showVerificationIndicator = isAnniversaryPassed && needsVerificationThisYear;

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
      <div className="bg-white/80 backdrop-blur-xl border border-slate-200/40 rounded-3xl p-6 lg:p-8 shadow-xs">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-1">
            <h1 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2.5 font-sans">
              <FileText className="w-5.5 h-5.5 text-[#3765F6]" />
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
              className={`px-4 py-2.5 rounded-xl font-bold text-xs transition-all duration-150 border flex items-center gap-2 cursor-pointer shadow-2xs active:scale-95 ${
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
              className="px-4 py-2.5 bg-[#3765F6] hover:bg-[#2555E5] text-white font-bold text-xs rounded-xl transition-all duration-150 border border-transparent flex items-center gap-2 cursor-pointer shadow-xs active:scale-95"
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
          <div className="bg-white/80 backdrop-blur-xl border border-slate-200/40 rounded-3xl p-6 shadow-xs space-y-6">
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
                    className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-semibold pl-9 pr-3 py-2.5 rounded-xl outline-none focus:border-[#3765F6] focus:bg-white transition placeholder-slate-400 shadow-2xs"
                  />
                </div>

                {/* 2. Dispatcher Filter */}
                <select
                  value={selectedDispatcherFilter}
                  onChange={e => setSelectedDispatcherFilter(e.target.value)}
                  className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl outline-none focus:border-[#3765F6] focus:bg-white transition cursor-pointer shadow-2xs"
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
                  className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl outline-none focus:border-[#3765F6] focus:bg-white transition cursor-pointer shadow-2xs"
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
                  className="bg-slate-50 border border-slate-200 text-slate-700 text-xs font-bold px-3 py-2.5 rounded-xl outline-none focus:border-[#3765F6] focus:bg-white transition cursor-pointer shadow-2xs"
                >
                  <option value="all">Все статусы паспорта</option>
                  <option value="verification">Требует верификации</option>
                </select>
              </div>
            </div>

            {/* List of Unified Cards */}
            {filteredRecords.length === 0 ? (
              <div className="bg-slate-50/40 rounded-2xl p-12 text-center border border-slate-200/20 text-slate-400 font-semibold text-xs italic flex flex-col items-center justify-center gap-2">
                <Truck className="w-8 h-8 text-slate-300 stroke-1" />
                <span>Записи автопарка не найдены с выбранными фильтрами</span>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 pr-1 custom-scrollbar">
                  {filteredRecords.slice(0, carsLimit).map(renderCard)}
                </div>

                {filteredRecords.length > carsLimit && (
                  <button
                    id="load-more-records"
                    onClick={() => setCarsLimit(prev => prev + 30)}
                    className="w-full py-3 border border-dashed border-slate-200 hover:border-[#3765F6] text-slate-500 hover:text-[#3765F6] font-bold text-xs rounded-2xl transition bg-slate-50 hover:bg-blue-50/30 cursor-pointer text-center font-sans shadow-2xs block"
                  >
                    Показать еще (+30)
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right Column (Google Drive Iframe) */}
        {isDriveOpen && (
          <div className={`xl:col-span-5 flex flex-col bg-white/70 backdrop-blur-xl border border-slate-200/40 rounded-2xl shadow-xs overflow-hidden transition-all duration-300 ${
            isDriveFocusMode ? 'fixed inset-4 z-50 p-4 bg-white shadow-2xl' : 'h-[820px]'
          }`}>
            
            {/* Drive Panel Header */}
            <div className="p-4 bg-slate-50/60 border-b border-slate-200/40 backdrop-blur-xl flex items-center justify-between gap-4 shrink-0 select-none rounded-t-2xl font-sans">
              <div className="flex items-center gap-2">
                <div className="p-1 px-2.5 bg-[#3765F6]/10 text-[#3765F6] font-bold text-[9px] rounded-full uppercase tracking-wider font-mono flex items-center gap-1 border border-[#3765F6]/10">
                  <HardDrive className="w-3 h-3" />
                  <span>DRIVE</span>
                </div>
                <h3 className="text-xs font-bold text-slate-800 tracking-tight hidden sm:block">
                  Google Диск
                </h3>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setIsDriveLoading(true);
                    setDriveIframeKey(k => k + 1);
                  }}
                  className="p-1.5 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200/60 transition cursor-pointer"
                  title="Обновить Диск"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                </button>
                
                <a
                  href={rawDriveUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 bg-white hover:bg-slate-50 text-slate-600 rounded-lg border border-slate-200/60 transition cursor-pointer flex items-center gap-1.5 text-[10px] font-bold px-2.5"
                  title="Открыть во вкладке"
                >
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

                <button
                  onClick={() => {
                    setIsDriveOpen(false);
                    localStorage.setItem('ratipa_driver_drive_visible', 'false');
                  }}
                  className="p-1.5 bg-white hover:bg-slate-50 text-slate-400 hover:text-slate-600 rounded-lg border border-slate-200/60 transition cursor-pointer"
                  title="Закрыть панель"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Drive Panel Iframe Container */}
            <div className="flex-1 bg-slate-50 p-2 relative overflow-hidden min-h-0">
              {isDriveLoading && (
                <div className="absolute inset-2 bg-white rounded-xl flex flex-col items-center justify-center p-6 gap-3 z-10 transition duration-300 shadow-inner">
                  <Folder className="w-10 h-10 text-slate-300 animate-bounce" />
                  <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Подключение к Google Диск...</span>
                  <span className="text-[9px] text-slate-300">Загрузка защищенного хранилища сканов</span>
                </div>
              )}
              <iframe
                key={driveIframeKey}
                src={driveEmbedUrl}
                onLoad={() => setIsDriveLoading(false)}
                className="w-full h-full border-0 rounded-xl bg-white shadow-inner"
                allow="clipboard-write"
                title="Google Диск - Документы Водителей"
              />
            </div>
          </div>
        )}

      </div>

      {/* Annual Passport Verification Pop-up Prompt */}
      {currentVerification && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md animate-fade-in">
          <div className="bg-white/95 backdrop-blur-2xl rounded-3xl w-full max-w-md shadow-2xl p-6 border border-slate-200/50 flex flex-col gap-5 text-center font-sans">
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
                className="w-full py-3 bg-[#3765F6] hover:bg-[#2555E5] text-white font-bold text-xs rounded-xl transition border border-transparent cursor-pointer shadow-xs"
              >
                Да, данные актуальны
              </button>
              
              <div className="flex gap-2">
                <button
                  onClick={() => handleVerifyEdit(currentVerification)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-[11px] rounded-xl transition cursor-pointer border border-slate-200/60"
                >
                  Нет, редактировать
                </button>
                <button
                  onClick={() => handleVerifySkip(currentVerification)}
                  className="flex-1 py-2.5 bg-white hover:bg-slate-50 text-slate-400 font-bold text-[11px] rounded-xl transition cursor-pointer border border-slate-200"
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
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-md overflow-y-auto animate-fade-in font-sans">
          <div className="bg-white/95 backdrop-blur-2xl rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col pt-1 my-8 border border-slate-200/50">
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-slate-100/60 flex items-center justify-between bg-slate-50/60">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-[#3765F6]" />
                <h3 className="text-xs font-bold text-slate-800 uppercase tracking-tight font-sans">
                  {editingId ? 'Редактировать запись' : 'Добавить новые данные авто и водителя'}
                </h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center transition text-slate-500 font-bold text-lg cursor-pointer active:scale-95 shadow-2xs"
              >
                ×
              </button>
            </div>

            {/* AI Input Assistant block */}
            <div className="mx-6 my-4 p-4.5 bg-[#3765F6]/5 border border-[#3765F6]/10 rounded-2xl space-y-3 shadow-2xs">
              <div className="flex items-center gap-1.5 text-[10px] font-bold text-[#3765F6] uppercase tracking-widest font-sans">
                <Sparkles className="w-4 h-4 text-[#3765F6] animate-pulse" />
                <span>ИИ ПОМОЩНИК (ПАРСЕР)</span>
              </div>
              
              <div className="text-[10px] text-slate-500 font-medium leading-relaxed font-sans">
                Вы можете вставить сырой скопированный текст (из мессенджера или файла), и алгоритм автоматически разложит все данные по нужным графам!
              </div>

              <div className="flex gap-2">
                <textarea
                  value={aiText}
                  onChange={e => setAiText(e.target.value)}
                  placeholder="Вставьте сюда любой текст с данными..."
                  className="flex-1 bg-white border border-slate-200/80 rounded-xl px-4 py-2.5 text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none focus:border-[#3765F6] focus:ring-1 focus:ring-[#3765F6]/20 transition resize-none h-[58px] font-mono shadow-2xs"
                />
                <button
                  type="button"
                  onClick={handleAiParse}
                  disabled={aiLoading}
                  className="px-4 bg-[#3765F6] hover:bg-[#2555E5] disabled:bg-slate-100 text-white disabled:text-slate-400 font-bold text-xs rounded-xl transition flex items-center justify-center gap-1.5 border border-[#3765F6]/10 shadow-xs shrink-0 cursor-pointer active:scale-95"
                >
                  {aiLoading ? 'Анализ...' : 'Распознать данные'}
                </button>
              </div>

              {aiError && (
                <div className="text-rose-600 text-[10px] font-bold font-mono pl-1 whitespace-pre-line leading-relaxed">
                  ⚠ {aiError}
                </div>
              )}
            </div>

            {/* Form Fields */}
            <div className="p-6 overflow-y-auto max-h-[50vh] space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Номера ТС */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Гос. номера Тягач / Полуприцеп <span className="text-rose-500">*</span>
                  </label>
                  <CouplingPicker
                    onSelect={(rec) => {
                      if (rec) setVehicleNumbers((rec.carNumber || rec.vehicleNumbers || '').toUpperCase());
                    }}
                  />
                </div>

                {/* 2. Марка тягача и прицепа */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
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
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                  <datalist id="vehicle-brands-datalist">
                    {existingVehicleBrands.map(brand => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
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
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                  <datalist id="trailer-brands-datalist">
                    {existingTrailerBrands.map(brand => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </div>

                {/* 3. Водитель */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    ФИО Водителя (Русский) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={driverNameRu}
                    onChange={e => setDriverNameRu(e.target.value)}
                    placeholder="Устинов Олег Леонидович"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    ФИО Водителя (Латиница)
                  </label>
                  <input
                    type="text"
                    value={driverNameLat}
                    onChange={e => setDriverNameLat(e.target.value)}
                    placeholder="USTSINAU ALEH"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                </div>

                {/* 4. Дата рождения */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Дата рождения <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={birthDate}
                    onChange={e => setBirthDate(e.target.value)}
                    placeholder="08.02.1973"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                </div>

                {/* 5. Паспорт */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Серия и номер Паспорта <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportNumber}
                    onChange={e => setPassportNumber(e.target.value)}
                    placeholder="МР 5065058"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                </div>

                {/* 6. Идентификационный номер */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Идентификационный номер <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={personalId}
                    onChange={e => setPersonalId(e.target.value)}
                    placeholder="3080273A018PB6"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition font-mono uppercase"
                  />
                </div>

                {/* 7. Срок начала */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Дата выдачи паспорта (Срок от) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportStart}
                    onChange={e => setPassportStart(e.target.value)}
                    placeholder="09.01.2024"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                </div>

                {/* 8. Срок конца */}
                <div className="space-y-1">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Дата окончания паспорта (Срок до) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportEnd}
                    onChange={e => setPassportEnd(e.target.value)}
                    placeholder="09.01.2034"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                </div>

                {/* 9. Выдан */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Кем выдан паспорт <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportIssuedBy}
                    onChange={e => setPassportIssuedBy(e.target.value)}
                    placeholder="Фрунзенским РУВД г. Минска"
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition"
                  />
                </div>

                {/* 10. Телефоны */}
                <div className="md:col-span-2 space-y-2 bg-[#3765F6]/5 border border-[#3765F6]/10 p-4.5 rounded-xl">
                  <div className="flex items-center justify-between border-b border-[#3765F6]/10 pb-2">
                    <label className="text-[11px] font-extrabold text-[#3765F6] uppercase tracking-wider font-sans">
                      Телефоны связи <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={addPhoneField}
                      className="text-[10px] font-bold text-white bg-[#3765F6] hover:bg-[#2555E5] px-2.5 py-1 rounded-lg flex items-center gap-1 transition shadow-2xs cursor-pointer active:scale-95"
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
                            className="flex-1 bg-slate-50/30 border border-slate-200/80 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition font-mono"
                          />
                          <button
                            type="button"
                            onClick={() => setPrimaryPhone(p.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-[10px] font-extrabold transition cursor-pointer shrink-0 ${
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
                            className="p-1.5 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition shrink-0 cursor-pointer"
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
                  <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">
                    Закрепленный диспетчер <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={dispatcher}
                    onChange={e => setDispatcher(e.target.value)}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition cursor-pointer"
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
                    <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">Год выпуска</label>
                    <input type="text" value={year} onChange={e => setYear(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition" placeholder="2018" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">Тип ТС</label>
                    <input type="text" value={vehicleType} onChange={e => setVehicleType(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition" placeholder="Тягач / Прицеп / Фургон" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">Габариты (Д×Ш×В, м)</label>
                    <input type="text" value={dimensions} onChange={e => setDimensions(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition" placeholder="13.6 × 2.45 × 2.7" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">Грузоподъёмность (т)</label>
                    <input type="text" value={weight} onChange={e => setWeight(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition" placeholder="24" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">Номер прицепа</label>
                    <input type="text" value={trailerNumber} onChange={e => setTrailerNumber(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition" placeholder="А 1635 Е-7" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">Телефон водителя</label>
                    <input type="text" value={driverPhone} onChange={e => setDriverPhone(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition" placeholder="+375 (29) 123-45-67" />
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <label className="text-[11px] font-semibold text-slate-500 font-sans tracking-wide">Ставка (€/км, опц.)</label>
                    <input type="text" value={rate} onChange={e => setRate(e.target.value)}
                      className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-[#3765F6] focus:bg-white transition" placeholder="2.10" />
                  </div>
                </div>
              </div>
            </div>

            {/* Modal Error Banner */}
            {saveError && (
              <div className="mx-6 mt-4 p-4.5 bg-rose-50 border border-rose-200 text-rose-700 rounded-xl flex items-start gap-2.5 text-xs font-sans shadow-2xs animate-fade-in">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="font-semibold leading-normal">{saveError}</div>
              </div>
            )}

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100/60 flex justify-end gap-3 bg-slate-50/60">
              <button
                onClick={() => setModalOpen(false)}
                disabled={isSaving}
                className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition text-xs font-sans cursor-pointer shadow-2xs disabled:opacity-50"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-6 py-3 rounded-xl font-bold text-white bg-[#3765F6] hover:bg-[#2555E5] transition shadow-xs text-xs font-sans cursor-pointer active:scale-95 flex items-center justify-center gap-1.5 min-w-[150px] disabled:bg-slate-400 disabled:cursor-not-allowed"
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
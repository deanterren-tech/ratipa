import {useState, useEffect, useMemo} from 'react'
import {UserProfile, SalaryLog, CarRateGroup, AppSettings, Driver, Vehicle} from '../../types'
import { dbService, database, onValue } from '../../api'
import {pdService} from '../../api'
import { ref } from 'firebase/database'
import {Wallet, Calculator, Trash2, Edit, Copy, Calendar, TrendingUp, History, ChevronDown, CheckCircle2, Loader2} from 'lucide-react'
import {UI} from '../../ui/kit'
import {ModuleShell, SectionHeader, SearchField, FilterPills, StatusText, EmptyState, FoundCount, ModalShell, ErrorRow} from '../../ui/components'
import CalendarDaysCalculator from './CalendarDaysCalculator';
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {useModalKeyboard} from '../../hooks/useModalKeyboard'
import {normalizePlate, findCarByPlate, getDriverById, getDriverIdForCar, formatCoupling} from '../../utils/salaryAutofill'
import {formatDriverShortName} from '../../utils/driverSync'
import {CarConflictModal} from '../common/CarConflictModal'
import {CarConflict} from '../../utils/carConflictHandler'
import CouplingPicker from '../common/CouplingPicker';

interface SalaryModuleProps {
  user: UserProfile;
}

/** Ключи вкладок журнала: текущий месяц, архив выбранного месяца, группировка по логисту. */
type JournalTab = 'current' | 'archive' | 'dispatcher';

/** Вкладки журнала — подпись и счётчик записей берутся из живой подписки. */
const JOURNAL_TABS: Array<{ key: JournalTab; label: string }> = [
  { key: 'current', label: 'Текущий месяц' },
  { key: 'archive', label: 'Архив месяцев' },
  { key: 'dispatcher', label: 'По диспетчерам' },
];

interface ScopeState {
  logs: SalaryLog[];
  loaded: boolean;
  error: string | null;
}

/** Новые сверху: по числовой части ключа (timestamp), затем по строке ключа. */
const sortByNewest = (list: SalaryLog[]): SalaryLog[] => {
  list.sort((a, b) => {
    const aTime = parseInt(String(a.id || '').replace(/\D/g, '')) || 0;
    const bTime = parseInt(String(b.id || '').replace(/\D/g, '')) || 0;
    return bTime - aTime;
  });
  return list;
};


export default function SalaryModule({ user }: SalaryModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [carsPool, setCarsPool] = useState<CarRateGroup[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversMap, setDriversMap] = useState<Record<string, string>>({});
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Tab control states for Recent Logs
  const [activeTab, setActiveTab] = useState<JournalTab>('current');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedDispatcher, setSelectedDispatcher] = useState<string>('');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [availableDispatchers, setAvailableDispatchers] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);
  // Повторная подписка на журнал после ошибки загрузки («Повторить»).
  const [journalReloadKey, setJournalReloadKey] = useState(0);

  // Данные журнала по каждой вкладке: подписки живут параллельно, поэтому
  // переключение мгновенное, а на вкладках видны честные счётчики записей.
  const [scopeState, setScopeState] = useState<Record<JournalTab, ScopeState>>({
    current: { logs: [], loaded: false, error: null },
    archive: { logs: [], loaded: false, error: null },
    dispatcher: { logs: [], loaded: false, error: null },
  });

  const setScope = (key: JournalTab, patch: Partial<ScopeState>) => {
    setScopeState(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  };

  // Form State
  const [carNumber, setCarNumber] = useState('');
  const [ratePerKm, setRatePerKm] = useState(0.125);
  const [ratePerDiem, setRatePerDiem] = useState<number | undefined>(undefined);
  const [totalKm, setTotalKm] = useState<number | ''>('');
  const [tripMark, setTripMark] = useState('Турция');
  const [tripDirection, setTripDirection] = useState('Турция');
  const [tripCircles, setTripCircles] = useState('');
  const [idleDays, setIdleDays] = useState(0);
  const [totalDays, setTotalDays] = useState(1);
  const [bonus, setBonus] = useState(0);
  const [comment, setComment] = useState('');
  const [driverName, setDriverName] = useState('');

  // Auto-association & Database linking states
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [carId, setCarId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [autofillStatus, setAutofillStatus] = useState<{
    type: 'success' | 'warning' | 'multiple' | 'none';
    message: string;
    matchedCars?: Vehicle[];
  }>({ type: 'none', message: '' });

  const [conflict, setConflict] = useState<{ isOpen: boolean; conflicts: CarConflict[]; oldCar: Vehicle; newCarData: Partial<Vehicle> } | null>(null);

  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  const [editingSalaryData, setEditingSalaryData] = useState<Partial<SalaryLog>>({});
  const [editDirection, setEditDirection] = useState<string>("");
  const [editCircles, setEditCircles] = useState<string>("");
  const [logsLimit, setLogsLimit] = useState(10);

  // handlers модалки редактирования выплаты (восстановлены: ранее были удалены,
  // но вызовы остались в JSX → ReferenceError при клике "Править"/"Дублировать")
  const openEditModal = (rec: SalaryLog) => {
    setEditingSalaryId(rec.id || null);
    setEditingSalaryData(rec);
    // Парсим mark "Направление, N круга" → отдельно направление и круги
    const mark = rec.mark || "";
    const circMatch = mark.match(/(\d+)\s*круг[а-я]*/i);
    const circles = circMatch ? `${circMatch[1]} круга` : "";
    const direction = mark.replace(circMatch ? circMatch[0] : "", "").replace(/[,，]/g, "").trim();
    setEditDirection(direction || "");
    setEditCircles(circles);
  };
  const closeEditModal = () => {
    setEditingSalaryId(null);
    setEditingSalaryData({});
    setEditDirection("");
    setEditCircles("");
  };
  const saveEditModal = () => {
    if (editingSalaryData && editingSalaryData.id) {
      const mark = [editDirection, editCircles].filter(Boolean).join(", ");
      try {
        dbService.updateSalary(editingSalaryData.id, { ...editingSalaryData, mark }, user.name, user.role);
        toast('Изменения выплаты сохранены', 'success');
      } catch (err) {
        console.error('Не удалось сохранить изменения выплаты:', err);
        toast('Не удалось сохранить изменения. Повторите попытку.', 'error');
      }
    }
    closeEditModal();
  };
  const copyHistoryToForm = (rec: SalaryLog) => {
    // дублируем запись в форму редактирования (переиспользуем тот же state)
    setEditingSalaryId(rec.id || null);
    setEditingSalaryData(rec);
  };

  // Клавиатура модального окна: Escape закрывает, фокус встаёт на первое поле
  // и возвращается на кнопку-источник при закрытии.
  useModalKeyboard({
    isOpen: !!editingSalaryId,
    onClose: closeEditModal,
    onConfirm: saveEditModal,
    initialFocusSelector: '#salary-edit-driver',
  });

  const getYearMonth = (item: SalaryLog): string => {
    if (item.datetime) {
      const parts = item.datetime.split('.');
      if (parts.length === 3) {
        return `${parts[2]}-${parts[1]}`;
      }
    }
    const timestamp = parseInt(item.id || "");
    if (!isNaN(timestamp)) {
      const d = new Date(timestamp);
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      return `${d.getFullYear()}-${mm}`;
    }
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`;
  };

  const sanitizeKey = (key: string) => {
    return String(key || "").trim().replace(/[.#$[\]\/]/g, "_");
  };

  // 1. Run legacy flat data migration on mount
  useEffect(() => {
    const migrateLegacySalaries = async () => {
      try {
        setIsMigrating(true);
        const { get: rtdbGet, update: rtdbUpdate } = await import('firebase/database');
        const snap = await rtdbGet(ref(database, 'salaryHistory'));
        if (!snap.exists()) {
          setIsMigrating(false);
          return;
        }
        const data = snap.val();
        
        // If it's already migrated (has flat/months/byDispatcher) or is empty
        if (data && (data.flat || data.months || data.byDispatcher)) {
          setIsMigrating(false);
          return;
        }
        
        const updates: Record<string, any> = {};
        for (const key of Object.keys(data)) {
          const log = data[key];
          if (!log || typeof log !== 'object') continue;
          
          const logId = log.id || key;
          log.id = logId;
          const ym = getYearMonth(log);
          const dispatcher = sanitizeKey(log.logist || 'System');
          
          updates[`salaryHistory/flat/${logId}`] = log;
          updates[`salaryHistory/months/${ym}/${logId}`] = log;
          updates[`salaryHistory/byDispatcher/${dispatcher}/${logId}`] = log;
          updates[`salaryHistory/${key}`] = null; // remove legacy root key
        }
        
        if (Object.keys(updates).length > 0) {
          await rtdbUpdate(ref(database), updates);
        }
      } catch (err) {
        console.error("Failed to migrate legacy salary history:", err);
      } finally {
        setIsMigrating(false);
      }
    };
    
    migrateLegacySalaries();
  }, []);

  // 2. Fetch months and dispatchers to populate available values
  useEffect(() => {
    const unsubMonths = onValue(ref(database, 'salaryHistory/months'), (snap) => {
      const data = snap.val();
      if (data) {
        setAvailableMonths(Object.keys(data).sort().reverse());
      } else {
        const d = new Date();
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        setAvailableMonths([`${d.getFullYear()}-${mm}`]);
      }
    });

    const unsubDispatchers = onValue(ref(database, 'salaryHistory/byDispatcher'), (snap) => {
      const data = snap.val();
      if (data) {
        setAvailableDispatchers(Object.keys(data).sort());
      } else {
        setAvailableDispatchers([]);
      }
    });

    return () => {
      unsubMonths();
      unsubDispatchers();
    };
  }, []);

  // 3. Set fallback initial values
  useEffect(() => {
    if (availableMonths.length > 0 && !selectedMonth) {
      setSelectedMonth(availableMonths[0]);
    }
  }, [availableMonths, selectedMonth]);

  useEffect(() => {
    if (availableDispatchers.length > 0 && !selectedDispatcher) {
      setSelectedDispatcher(availableDispatchers[0]);
    }
  }, [availableDispatchers, selectedDispatcher]);

  // 4. Scoped reactive subscriptions: все три вкладки подписаны параллельно.
  //    «Текущий месяц» — месяц самого расчёта; «Архив» — выбранный месяц;
  //    «По диспетчерам» — выбранный логист.
  const currentYearMonth = useMemo(() => {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${d.getFullYear()}-${mm}`;
  }, []);

  useEffect(() => {
    const unsub = onValue(ref(database, `salaryHistory/months/${currentYearMonth}`), (snap) => {
      const data = snap.val();
      const list: SalaryLog[] = data
        ? sortByNewest(Object.keys(data).map((key) => ({ id: key, ...data[key] } as SalaryLog)))
        : [];
      setScope('current', { logs: list, loaded: true, error: null });
    }, (err) => {
      console.warn(`Failed to subscribe to salaryHistory/months/${currentYearMonth}:`, err);
      setScope('current', { logs: [], loaded: true, error: 'Не удалось загрузить выплаты текущего месяца. Проверьте соединение и повторите.' });
    });
    return () => { unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentYearMonth, journalReloadKey]);

  useEffect(() => {
    if (!selectedMonth) {
      setScope('archive', { logs: [], loaded: true, error: null });
      return;
    }
    const unsub = onValue(ref(database, `salaryHistory/months/${selectedMonth}`), (snap) => {
      const data = snap.val();
      const list: SalaryLog[] = data
        ? sortByNewest(Object.keys(data).map((key) => ({ id: key, ...data[key] } as SalaryLog)))
        : [];
      setScope('archive', { logs: list, loaded: true, error: null });
    }, (err) => {
      console.warn(`Failed to subscribe to salaryHistory/months/${selectedMonth}:`, err);
      setScope('archive', { logs: [], loaded: true, error: 'Не удалось загрузить архив выплат. Проверьте соединение и повторите.' });
    });
    return () => { unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth, journalReloadKey]);

  useEffect(() => {
    if (!selectedDispatcher) {
      setScope('dispatcher', { logs: [], loaded: true, error: null });
      return;
    }
    const unsub = onValue(ref(database, `salaryHistory/byDispatcher/${selectedDispatcher}`), (snap) => {
      const data = snap.val();
      const list: SalaryLog[] = data
        ? sortByNewest(Object.keys(data).map((key) => ({ id: key, ...data[key] } as SalaryLog)))
        : [];
      setScope('dispatcher', { logs: list, loaded: true, error: null });
    }, (err) => {
      console.warn(`Failed to subscribe to salaryHistory/byDispatcher/${selectedDispatcher}:`, err);
      setScope('dispatcher', { logs: [], loaded: true, error: 'Не удалось загрузить выплаты логиста. Проверьте соединение и повторите.' });
    });
    return () => { unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDispatcher, journalReloadKey]);

  // 5. General metadata subscriptions
  useEffect(() => {
    const unsubCars = dbService.getCarRateGroups((data) => setCarsPool(data));
    const unsubDrivers = dbService.getDrivers((data) => setDrivers(data));
    const unsubDriversMap = pdService.subscribeDriversCarMapping((m) => setDriversMap(m));
    const unsubSettings = dbService.getSettings((data) => setSettings(data));
    const unsubVehicles = dbService.getVehicles((data) => setVehicles(data));
    const unsubKnownFleet = onValue(ref(database, 'known_fleet'), (snap) => {
      const data = snap.val() || {};
      setKnownFleet(Object.values(data).map((v: any) => String(v).trim().toUpperCase()).filter(Boolean));
    });

    return () => {
        unsubCars();
        unsubDrivers(); 
        unsubDriversMap();
        unsubSettings();
        unsubVehicles();
        unsubKnownFleet();
    };
  }, []);

  const clearCarDriverAutofill = () => {
    setCarId('');
    setDriverId('');
    setDriverName('');
    setAutofillStatus({ type: 'none', message: '' });
  };

  const applyCarAndDriverToForm = (car: Vehicle, drv: Driver | undefined) => {
    const plate = car.carNumber || car.vehicleNumbers || '';
    setCarNumber(plate);
    setCarId(car.id);

    // Update rate from cars pool if matches
    const normalizedCarPlate = normalizePlate(plate);
    const group = carsPool.find(g => 
        (g.vehicles || []).some(v => normalizePlate(v) === normalizedCarPlate)
    );
    if (group) {
        setRatePerKm(group.rate);
        setRatePerDiem(group.perDiemRate);
    }

    if (drv) {
      setDriverId(drv.id);
      setDriverName(drv.shortNameRu || formatDriverShortName(drv));
      setAutofillStatus({
        type: 'success',
        message: `Машина и водитель успешно сопоставлены: ${drv.shortNameRu || formatDriverShortName(drv)}`
      });
    } else {
      setDriverId('');
      setDriverName('');
      setAutofillStatus({
        type: 'warning',
        message: 'Для машины не назначен водитель'
      });
    }
  };

  // Резолвинг водителя для машины: проверяем маппинг drivers_car_mapping,
  // прямой driverId машины и привязку по driverName (актуально для tractors,
  // где водитель задан через поле driverName, а не driverId).
  const resolveDriverForCar = (car: Vehicle): Driver | undefined => {
    // 1. маппинг drivers_car_mapping
    const mappedId = getDriverIdForCar(car, driversMap);
    if (mappedId) {
      const d = getDriverById(mappedId, drivers);
      if (d) return d;
    }
    // 2. прямой driverId у машины
    if (car.driverId) {
      const d = getDriverById(car.driverId, drivers);
      if (d) return d;
    }
    // 3. по driverName (в tractors поле driverNameRu)
    const driverName = car.driverName || (car as any).driverNameRu || '';
    if (driverName) {
      const nm = driverName.trim().toLowerCase();
      const d = drivers.find((x) => {
        const sn = (x.shortNameRu || '').trim().toLowerCase();
        const full = `${x.lastNameRu || ''} ${x.firstNameRu || ''} ${x.middleNameRu || ''}`.trim().toLowerCase();
        const full2 = (x.name || '').trim().toLowerCase();
        return sn === nm || full === nm || full2 === nm;
      });
      if (d) return d;
    }
    return undefined;
  };

  // Из нескольких совпавших машин выбираем ту, у которой есть валидный водитель
  // (отсекаем мусорные дубли вида ___XXXX_X без водителя).
  const pickBestCar = (cars: Vehicle[]): Vehicle | undefined => {
    if (cars.length === 1) return cars[0];
    const withDriver = cars.filter((c) => resolveDriverForCar(c));
    if (withDriver.length === 1) return withDriver[0];
    return undefined;
  };

  const handleCarNumberChange = (val: string) => {
    setCarNumber(val);

    if (!val.trim()) {
      clearCarDriverAutofill();
      return;
    }

    const { matchType, matchedCars } = findCarByPlate(val, vehicles);

    if (matchType === 'exact' || matchType === 'partial') {
      const matchedCar = matchedCars[0];
      const matchedDriver = resolveDriverForCar(matchedCar);
      applyCarAndDriverToForm(matchedCar, matchedDriver);
    } else if (matchType === 'multiple') {
      const best = pickBestCar(matchedCars);
      if (best) {
        const matchedDriver = resolveDriverForCar(best);
        applyCarAndDriverToForm(best, matchedDriver);
      } else {
        setCarId('');
        setDriverId('');
        setDriverName('');
        setAutofillStatus({
          type: 'multiple',
          message: 'Найдено несколько похожих машин, выберите одну:',
          matchedCars
        });
      }
    } else {
      setCarId('');
      setDriverId('');
      setAutofillStatus({
        type: 'none',
        message: 'Машина не найдена в базе автопарка'
      });

      // Still check if rate group has this vehicle plate
      const normalizedTyped = normalizePlate(val);
      const group = carsPool.find(g => 
          (g.vehicles || []).some(v => normalizePlate(v) === normalizedTyped)
      );
      if (group) {
          setRatePerKm(group.rate);
          setRatePerDiem(group.perDiemRate);
      } else {
          setRatePerKm(0.125);
          setRatePerDiem(undefined);
      }
    }
  };

  const handleDriverNameChange = (val: string) => {
    setDriverName(val);
    
    // Find driver in drivers pool
    const foundDriver = drivers.find(d => 
      String(d.name || '').trim().toLowerCase() === val.trim().toLowerCase() ||
      (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === val.trim().toLowerCase())
    );
    if (foundDriver) {
      setDriverId(foundDriver.id);
      if (foundDriver.rateGroupId) {
        const group = carsPool.find(g => g.id === foundDriver.rateGroupId);
        if (group) {
          setRatePerKm(group.rate);
          setRatePerDiem(group.perDiemRate);
        }
      }
    } else {
      setDriverId('');
    }
  };

  const currentIdleRate = settings?.idleRate ?? 30;
  const currentPerDiem = ratePerDiem ?? settings?.perDiemRate ?? 7;

  const kmMoney = (Number(totalKm) || 0) * ratePerKm;
  const idleMoney = idleDays * currentIdleRate;
  const daysMoney = totalDays * currentPerDiem;
  const totalSalary = kmMoney + idleMoney + daysMoney + bonus;
  const salaryPerDay = totalSalary / Math.max(totalDays, 1);

  const clearForm = () => {
    setCarNumber('');
    setRatePerKm(0.125);
    setRatePerDiem(undefined);
    setTotalKm('');
    setTripDirection('Турция');
    setTripCircles('');
    setIdleDays(0);
    setTotalDays(1);
    setBonus(0);
    setComment('');
    clearCarDriverAutofill();
  };

  const saveToHistory = async () => {
    if (!user.name) {
        toast("Ошибка: Имя пользователя не определено.", 'error');
        return;
    }

    const trimmedDriver = driverName.trim();
    if (trimmedDriver && trimmedDriver !== 'НЕ УКАЗАНО') {
      const exists = drivers.some(d => 
        String(d.name || '').trim().toLowerCase() === trimmedDriver.toLowerCase() ||
        (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === trimmedDriver.toLowerCase())
      );
      if (!exists) {
        const confirmAdd = await showConfirm(`Водитель "${trimmedDriver}" отсутствует в справочнике. Занести его в справочник?`);
        if (confirmAdd) {
          const parts = trimmedDriver.split(/\s+/);
          const last = parts[0] || '';
          const first = parts[1] || '';
          const middle = parts[2] || '';
          const computedShort = formatDriverShortName(last, first, middle);

          const newDriver: Driver = {
            id: "dr_" + Date.now(),
            name: trimmedDriver,
            lastNameRu: last,
            firstNameRu: first,
            middleNameRu: middle,
            shortNameRu: computedShort || trimmedDriver,
          };
          dbService.saveDriver(newDriver, user.name, user.role);
          toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
        }
      }
    }

    const newLog: SalaryLog = {
        id: Date.now().toString(),
        datetime: new Date().toLocaleDateString('ru-RU').replace(/\./g, '/'),
        logist: user.name,
        car: carNumber.trim().toUpperCase() || 'НЕ УКАЗАНО',
        rate: ratePerKm,
        km: Number(totalKm) || 0,
        mark: [tripDirection, tripCircles].filter(Boolean).join(', '),
        idleDays,
        totalDays: Math.max(totalDays, 1),
        bonus,
        kmMoney,
        idleMoney,
        daysMoney,
        comment: comment.trim(),
        driver: trimmedDriver || 'НЕ УКАЗАНО',
        totalSalary,
        salaryPerDay,
        carId: carId || undefined,
        driverId: driverId || undefined
    };

    try {
      dbService.saveSalary(newLog, user.name, user.role);
      toast('Выплата зафиксирована — запись добавлена в журнал', 'success');
      clearForm();
    } catch (err) {
      console.error('Не удалось сохранить выплату:', err);
      toast('Не удалось сохранить выплату. Проверьте соединение и повторите.', 'error');
    }
  };


  const logs = scopeState[activeTab].logs;
  const logsLoading = !scopeState[activeTab].loaded;
  const logsError = scopeState[activeTab].error;

  const filteredHistory = useMemo(() => {
    return logs.filter(rec => {
        const haystack = `${rec.datetime || ''} ${rec.logist || ''} ${rec.driver || ''} ${rec.car || ''} ${rec.mark || ''} ${rec.km || ''} ${rec.rate || ''} ${rec.bonus || ''} ${rec.totalSalary || ''}`.toLowerCase();
        return !searchQuery || haystack.includes(searchQuery.toLowerCase());
    }).sort((a, b) => {
    // Parse date strings formatted as "DD.MM.YYYY" or standard ISO strings
    const parseDate = (dStr: string) => {
      if (!dStr) return 0;
      const parts = dStr.split('.');
      if (parts.length === 3) {
        const d = parseInt(parts[0], 10);
        const m = parseInt(parts[1], 10) - 1;
        const y = parseInt(parts[2], 10);
        return new Date(y, m, d).getTime();
      }
      return new Date(dStr).getTime() || 0;
    };
    
    const dateA = parseDate(a.datetime);
    const dateB = parseDate(b.datetime);
    
    if (dateA !== dateB) {
      return dateB - dateA; // Descending by date
    }
    
    // Within the same day, compare IDs descending
    return (b.id || "").localeCompare(a.id || "");
  });
  }, [logs, searchQuery]);

  const totalPaid = logs.reduce((s, r) => s + (r.totalSalary || 0), 0);
  const avgPaid = logs.length > 0 ? totalPaid / logs.length : 0;
  const maxPaid = logs.length > 0 ? Math.max(...logs.map(r => r.totalSalary || 0)) : 0;
  const uniqueDrivers = new Set(logs.map(r => r.driver || '').filter(Boolean)).size;

  return (
    <ModuleShell title="Зарплата водителей">
      <div className="flex flex-col gap-6">

        {/* Форма расчёта: шаги 1–3 и фиксация. Enter в любом поле сохраняет расчёт. */}
        <div
          className="flex flex-col gap-6"
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.defaultPrevented) return;
            const target = e.target as HTMLElement | null;
            if (target && target.tagName === 'INPUT') {
              e.preventDefault();
              void saveToHistory();
            }
          }}
        >

        {/* ===== Шаг 1. Период и исходные данные ===== */}
        <section className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-5">
          <SectionHeader
            icon={<Calendar className="w-4 h-4" aria-hidden="true" />}
            title="Период и исходные данные"
            subtitle="Шаг 1: даты рейса, автомобиль, водитель и направление"
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className={UI.fieldLabel}>Автомобиль</label>
                  <CouplingPicker
                    value={carNumber}
                    onSelect={(rec) => {
                      if (!rec) {
                        // Очистка выбора: убираем машину и авто-заполненные из сцепки поля
                        setCarNumber('');
                        handleCarNumberChange('');
                        return;
                      }
                      const cNum = (rec.carNumber || rec.vehicleNumbers || '').toUpperCase();
                      setCarNumber(cNum);
                      if (rec.driverName) {
                        setDriverName(rec.driverName);
                      }
                      handleCarNumberChange(cNum);
                    }}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={UI.fieldLabel} htmlFor="salary-driver-name">ФИО Водителя</label>
                  <input
                    id="salary-driver-name"
                    type="text"
                    value={driverName}
                    onChange={e => setDriverName(e.target.value)}
                    placeholder="—"
                    className={UI.input}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={UI.fieldLabel} htmlFor="salary-trip-direction">Направление</label>
                  <select
                    id="salary-trip-direction"
                    value={tripDirection}
                    onChange={e => setTripDirection(e.target.value)}
                    className={UI.select}
                  >
                    <option value="Турция">Турция</option>
                    <option value="Китай">Китай</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className={UI.fieldLabel} htmlFor="salary-trip-circles">Круги</label>
                  <select
                    id="salary-trip-circles"
                    value={tripCircles}
                    onChange={e => setTripCircles(e.target.value)}
                    className={UI.select}
                  >
                    <option value="">—</option>
                    <option value="2 круга">2 круга</option>
                    <option value="3 круга">3 круга</option>
                  </select>
                </div>
              </div>
              {autofillStatus.message ? (
                <div className="flex flex-wrap items-center gap-2" role="status" aria-live="polite">
                  <StatusText color={autofillStatus.type === 'success' ? 'emerald' : autofillStatus.type === 'warning' ? 'amber' : 'grey'}>
                    {autofillStatus.message}
                  </StatusText>
                  {autofillStatus.type === 'multiple' && (autofillStatus.matchedCars || []).slice(0, 6).map((c) => (
                    <span key={c.id || c.carNumber} className={`${UI.chip} font-mono`}>{c.carNumber || c.vehicleNumbers}</span>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="lg:col-span-1">
              <CalendarDaysCalculator onDaysCalculated={(days) => setTotalDays(days)} />
            </div>
          </div>
        </section>

        {/* ===== Шаг 2. Параметры расчёта ===== */}
        <section className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-5">
          <SectionHeader
            icon={<Calculator className="w-4 h-4" aria-hidden="true" />}
            title="Параметры расчёта"
            subtitle="Шаг 2: пробег, ставка, дни в рейсе, простой и премия"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel} htmlFor="salary-total-km">Общий пробег (км)</label>
              <input
                id="salary-total-km"
                type="number"
                value={totalKm}
                onChange={e => setTotalKm(Number(e.target.value))}
                placeholder="5500"
                className={UI.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel} htmlFor="salary-rate-per-km">Ставка за км (€)</label>
              <input
                id="salary-rate-per-km"
                type="number"
                step="0.001"
                value={ratePerKm}
                onChange={e => setRatePerKm(Number(e.target.value))}
                className={UI.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel} htmlFor="salary-idle-days">Дней простоя ({currentIdleRate} €/д)</label>
              <input
                id="salary-idle-days"
                type="number"
                value={idleDays}
                onChange={e => setIdleDays(Number(e.target.value))}
                min="0"
                className={UI.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel} htmlFor="salary-total-days">Дней в рейсе ({currentPerDiem} €/д)</label>
              <input
                id="salary-total-days"
                type="number"
                value={totalDays}
                onChange={e => setTotalDays(Number(e.target.value))}
                min="1"
                className={UI.input}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel} htmlFor="salary-bonus">Премия (€)</label>
              <input
                id="salary-bonus"
                type="number"
                value={bonus}
                onChange={e => setBonus(Number(e.target.value))}
                min="0"
                placeholder="0"
                className={UI.input}
              />
            </div>
            <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-3">
              <label className={UI.fieldLabel} htmlFor="salary-comment">Комментарий к выплате</label>
              <input
                id="salary-comment"
                type="text"
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="Опционально (штрафы, детали, премии...)"
                className={UI.input}
              />
            </div>
          </div>
        </section>

        {conflict && (
            <CarConflictModal
                isOpen={conflict.isOpen}
                conflicts={conflict.conflicts}
                onResolve={(resolution) => {
                    // handle resolution...
                    setConflict(null);
                }}
                onClose={() => setConflict(null)}
            />
        )}

        {/* ===== Шаг 3. Результат расчёта ===== */}
        <section className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-5">
          <SectionHeader
            icon={<TrendingUp className="w-4 h-4" aria-hidden="true" />}
            title="Результат расчёта"
            subtitle="Шаг 3: итог к выплате, З/П за сутки и разбивка начислений"
          />

          {/* Крупный блок итогов: сумма к выплате и суточная ставка — «без скролла» на мобильном */}
          <div className="rounded-2xl border border-[#E5E7EB] bg-[#F8F9FA] p-5">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] block select-none">
                  Итого водителю
                </span>
                <span
                  className="mt-1 flex items-baseline gap-1.5 font-mono tabular-nums text-3xl sm:text-4xl font-bold tracking-tight text-[#121316]"
                  data-testid="salary-total"
                >
                  {Math.round(totalSalary).toLocaleString('ru-RU')}
                  <span className="text-base font-semibold text-[#6B7280]">€</span>
                </span>
              </div>
              <div className="flex flex-col items-start sm:items-end gap-1">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280] select-none">
                  З/П за сутки
                </span>
                <span
                  className="font-mono tabular-nums text-xl font-bold text-[#121316]"
                  data-testid="salary-perday"
                >
                  {Math.round(salaryPerDay).toLocaleString('ru-RU')}
                  <span className="text-sm font-semibold text-[#6B7280]"> €</span>
                </span>
                <span className={UI.hint}>При {Math.max(totalDays, 1)} дн. в рейсе</span>
              </div>
            </div>
          </div>

          {/* Разбивка начислений строками — как «Статьи расходов» в «Калькуляции» */}
          <div>
            <div className={`${UI.caption} mb-2`}>Разбивка начислений</div>
            <div className="flex flex-col divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white">
                <span className="text-xs text-[#4B5563]">
                  За километраж
                  <span className="text-[#9CA3AF]"> · {Math.round(Number(totalKm) || 0).toLocaleString('ru-RU')} км × {ratePerKm} €/км</span>
                </span>
                <span className="text-xs font-mono font-semibold text-[#121316] whitespace-nowrap" data-testid="salary-km-money">
                  {Math.round(kmMoney).toLocaleString('ru-RU')} €
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white">
                <span className="text-xs text-[#4B5563]">
                  Простой
                  <span className="text-[#9CA3AF]"> · {idleDays} дн. × {currentIdleRate} €/д</span>
                </span>
                <span className="text-xs font-mono font-semibold text-[#121316] whitespace-nowrap" data-testid="salary-idle-money">
                  {Math.round(idleMoney).toLocaleString('ru-RU')} €
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white">
                <span className="text-xs text-[#4B5563]">
                  Суточные
                  <span className="text-[#9CA3AF]"> · {Math.max(totalDays, 1)} дн. × {currentPerDiem} €/д</span>
                </span>
                <span className="text-xs font-mono font-semibold text-[#121316] whitespace-nowrap" data-testid="salary-days-money">
                  {Math.round(daysMoney).toLocaleString('ru-RU')} €
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-white">
                <span className="text-xs text-[#4B5563]">Премия</span>
                <span className="text-xs font-mono font-semibold text-[#121316] whitespace-nowrap" data-testid="salary-bonus-money">
                  {Math.round(bonus).toLocaleString('ru-RU')} €
                </span>
              </div>
              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 bg-[#F8F9FA]">
                <span className="text-xs font-semibold text-[#121316]">Итого к выплате</span>
                <span className="text-sm font-mono font-bold text-[#121316] whitespace-nowrap">
                  {Math.round(totalSalary).toLocaleString('ru-RU')} €
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* ===== Фиксация выплаты ===== */}
        <section className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-5">
          <SectionHeader
            icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
            title="Фиксация выплаты"
            subtitle="Сохранение расчёта в журнал выплат"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={clearForm} className={UI.buttonGhost}>Очистить</button>
            <button type="button" onClick={saveToHistory} className={UI.buttonPrimary}>
              <Wallet className="w-4 h-4" aria-hidden="true" />
              Фиксировать выплату
            </button>
            <span className={`${UI.hint} ml-1`}>
              Запись появится в журнале ниже. Enter в любом поле сохраняет расчёт.
            </span>
          </div>
        </section>

        </div>

        {/* ===== Журнал выплат ===== */}
        <section className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-4">
          <SectionHeader
            icon={<History className="w-4 h-4" aria-hidden="true" />}
            title="Журнал выплат"
            subtitle="Поиск по водителю, логисту и транспорту; архив и группировка по диспетчерам"
          />

          <div className={UI.tabsBar}>
            <nav className={UI.tabsNav} role="tablist" aria-label="Разделы журнала выплат">
              {JOURNAL_TABS.map((t) => {
                const isActive = activeTab === t.key;
                const scope = scopeState[t.key];
                const count = scope.loaded ? scope.logs.length : undefined;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setActiveTab(t.key)}
                    onKeyDown={(e) => {
                      // Стрелки / Home / End — как в стандартном списке вкладок.
                      const keys = JOURNAL_TABS.map((x) => x.key);
                      const at = keys.indexOf(t.key);
                      let next = -1;
                      if (e.key === 'ArrowRight') next = (at + 1) % keys.length;
                      else if (e.key === 'ArrowLeft') next = (at - 1 + keys.length) % keys.length;
                      else if (e.key === 'Home') next = 0;
                      else if (e.key === 'End') next = keys.length - 1;
                      if (next < 0) return;
                      e.preventDefault();
                      setActiveTab(keys[next]);
                      const nav = e.currentTarget.parentElement;
                      const buttons = nav ? nav.querySelectorAll<HTMLButtonElement>('[role="tab"]') : null;
                      buttons?.[next]?.focus();
                    }}
                    className={`${UI.tab} min-h-[44px] lg:min-h-0 ${isActive ? UI.tabActive : UI.tabIdle}`}
                  >
                    {t.label}
                    {typeof count === 'number' ? (
                      <span className={`${UI.tabBadge} ${isActive ? UI.tabBadgeActive : UI.tabBadgeIdle}`}>{count}</span>
                    ) : null}
                    {isActive ? <span className={UI.tabUnderline} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </nav>
          </div>

          <div className="flex flex-col gap-3 pt-1">
            <SearchField
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Поиск по водителю, логисту, транспортному средству..."
              className="lg:max-w-xl"
            />

            {activeTab === 'archive' && availableMonths.length > 0 && (
              <FilterPills
                items={availableMonths.map((m) => {
                  const [year, month] = m.split('-');
                  const monthsNamesRu = [
                    'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                    'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
                  ];
                  const mIndex = parseInt(month, 10) - 1;
                  const humanLabel = mIndex >= 0 && mIndex < 12 ? `${monthsNamesRu[mIndex]} ${year}` : m;
                  return { key: m, label: humanLabel };
                })}
                active={selectedMonth}
                onChange={setSelectedMonth}
                ariaLabel="Месяц архива"
              />
            )}

            {activeTab === 'dispatcher' && availableDispatchers.length > 0 && (
              <FilterPills
                items={availableDispatchers.map((d) => ({ key: d, label: d }))}
                active={selectedDispatcher}
                onChange={setSelectedDispatcher}
                ariaLabel="Логист"
              />
            )}
          </div>

          {logsLoading ? (
            <div className={UI.loading} role="status">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Загрузка выплат…
            </div>
          ) : logsError ? (
            <ErrorRow text={logsError} onRetry={() => setJournalReloadKey((k) => k + 1)} />
          ) : (
            <>
              <div className="flex flex-col gap-3 pt-1">
                <span className={UI.caption}>
                  Статистика выплат ({activeTab === 'current' ? 'Текущий месяц' : activeTab === 'archive' ? 'За выбранный месяц' : 'По выбранному логисту'})
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <StatusText color="grey">Выплат всего</StatusText>
                    <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0" data-testid="salary-stat-count">{logs.length}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <StatusText color="accent">Сумма всех выплат</StatusText>
                    <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0" data-testid="salary-stat-sum">{Math.round(totalPaid).toLocaleString('ru-RU')} €</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <StatusText color="grey">Средняя выплата</StatusText>
                    <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0" data-testid="salary-stat-avg">{Math.round(avgPaid).toLocaleString('ru-RU')} €</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <StatusText color="grey">Максимальная</StatusText>
                    <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0" data-testid="salary-stat-max">{Math.round(maxPaid).toLocaleString('ru-RU')} €</span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <StatusText color="grey">Уникальных водителей</StatusText>
                    <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{uniqueDrivers}</span>
                  </div>
                </div>
              </div>

              <FoundCount count={filteredHistory.length} onReset={searchQuery ? () => setSearchQuery('') : undefined} />

              {filteredHistory.length === 0 ? (
                <EmptyState
                  kind={searchQuery ? 'no-results' : 'empty'}
                  title={searchQuery ? undefined : 'Выплат пока нет — сохраните первый расчёт'}
                  hint={searchQuery ? undefined : 'Заполните шаги 1–3 и нажмите «Фиксировать выплату» — расчёт появится здесь.'}
                  query={searchQuery || undefined}
                />
              ) : (
                <>
                  {/* Таблица — широкий экран (от 900 px) */}
                  <div className={`${UI.tableWrap} hidden min-[900px]:block`}>
                    <table className={UI.table}>
                      <thead>
                        <tr className={UI.theadRow}>
                          <th className={`${UI.th} whitespace-nowrap`}>Дата</th>
                          <th className={UI.th}>Водитель и ТС</th>
                          <th className={UI.th}>Рейс</th>
                          <th className={`${UI.th} whitespace-nowrap`}>Пробег и дни</th>
                          <th className={UI.th}>Начислено</th>
                          <th className={`${UI.th} text-right whitespace-nowrap`}>Итого</th>
                          <th className={UI.th}>Комментарий</th>
                          <th className={`${UI.th} text-right`}>
                            <span className="sr-only">Действия</span>
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistory.slice(0, logsLimit).map((rec) => (
                          <tr key={rec.id} className={UI.tr} data-salary-row={rec.id}>
                            <td className={UI.td}>
                              <span className="block text-[11px] font-mono tabular-nums text-[#6B7280]">{rec.datetime || '—'}</span>
                              <span className="block text-[10px] text-[#9CA3AF] mt-0.5">Логист: {rec.logist || 'Система'}</span>
                            </td>
                            <td className={UI.td}>
                              <span className="block text-xs font-semibold text-[#121316]">{formatDriverShortName(rec.driver)}</span>
                              <span className={`${UI.chip} inline-block mt-1 font-mono`}>{rec.car}</span>
                            </td>
                            <td className={UI.td}>
                              {(() => {
                                const mark = rec.mark || '';
                                const circMatch = mark.match(/\d+\s*круг[а-я]*/i);
                                const circles = circMatch ? circMatch[0] : '';
                                const direction = mark.replace(circMatch ? circMatch[0] : '', '').replace(/[,，]/g, ' ').trim();
                                if (!circles && direction === 'Отлично') {
                                  return (
                                    <span className="inline-flex text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                      {mark}
                                    </span>
                                  );
                                }
                                if (!direction && !circles) {
                                  return <span className="text-xs text-[#4B5563] whitespace-nowrap">{mark || '—'}</span>;
                                }
                                return (
                                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                                    {direction ? <span className="text-xs text-[#4B5563] whitespace-nowrap">{direction}</span> : null}
                                    {circles ? <span className={UI.chip}>{circles}</span> : null}
                                  </span>
                                );
                              })()}
                            </td>
                            <td className={UI.td}>
                              <span className="block text-xs font-mono tabular-nums text-[#121316] whitespace-nowrap">
                                {Math.round(rec.km || 0).toLocaleString('ru-RU')} км · {rec.rate || 0} €/км
                              </span>
                              <span className="block text-[11px] text-[#6B7280] mt-0.5 whitespace-nowrap">
                                В рейсе {rec.totalDays || 0} дн. · Простой {rec.idleDays || 0} дн.
                              </span>
                            </td>
                            <td className={UI.td}>
                              <span className="flex flex-col gap-0.5">
                                <span className="text-[11px] text-[#6B7280]">
                                  З/П за км <span className="font-mono tabular-nums text-[#4B5563]">{Math.round(rec.kmMoney || 0).toLocaleString('ru-RU')} €</span>
                                </span>
                                <span className="text-[11px] text-[#6B7280]">
                                  Суточные <span className="font-mono tabular-nums text-[#4B5563]">{Math.round(rec.daysMoney || 0).toLocaleString('ru-RU')} €</span>
                                </span>
                                {(rec.idleMoney || 0) > 0 && (
                                  <span className="text-[11px] text-[#6B7280]">
                                    Простой <span className="font-mono tabular-nums text-[#4B5563]">{Math.round(rec.idleMoney || 0).toLocaleString('ru-RU')} €</span>
                                  </span>
                                )}
                                {(rec.bonus || 0) > 0 && (
                                  <span className="text-[11px] text-[#6B7280]">
                                    Премия <span className="font-mono tabular-nums text-[#4B5563]">+{Math.round(rec.bonus || 0)} €</span>
                                  </span>
                                )}
                              </span>
                            </td>
                            <td className="px-3 py-2.5 align-middle text-right whitespace-nowrap">
                              <span className="block text-sm font-semibold font-mono tabular-nums text-[#121316]">
                                {Math.round(rec.totalSalary || 0).toLocaleString('ru-RU')} €
                              </span>
                              {(rec.totalDays || 0) > 0 && (
                                <span className="block text-[10px] text-[#9CA3AF] mt-0.5">
                                  З/П в день {Math.round((rec.totalSalary || 0) / rec.totalDays).toLocaleString('ru-RU')} €
                                </span>
                              )}
                            </td>
                            <td className={UI.td}>
                              {rec.comment ? (
                                <span className="block text-[11px] text-[#6B7280] max-w-[220px] truncate" title={rec.comment}>{rec.comment}</span>
                              ) : (
                                <span className="text-[11px] text-[#9CA3AF]">—</span>
                              )}
                            </td>
                            <td className={UI.td}>
                              <div className="flex items-center justify-end gap-1">
                                <button
                                  type="button"
                                  onClick={() => copyHistoryToForm(rec)}
                                  title="Дублировать в форму"
                                  aria-label="Дублировать расчёт в форму"
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                                >
                                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditModal(rec)}
                                  title="Редактировать"
                                  aria-label="Редактировать расчёт"
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-[#6B7280] hover:text-[var(--accent-ink)] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                                >
                                  <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                                <button
                                  type="button"
                                  onClick={async () => {
                                    if (await showConfirm('Удалить эту выплату?')) {
                                      try {
                                        dbService.deleteSalary(rec, user.name, user.role);
                                        toast('Запись удалена из журнала', 'success');
                                      } catch (err) {
                                        console.error('Не удалось удалить выплату:', err);
                                        toast('Не удалось удалить запись. Повторите попытку.', 'error');
                                      }
                                    }
                                  }}
                                  title="Удалить"
                                  aria-label="Удалить расчёт"
                                  className="w-8 h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Карточки — узкий экран (до 900 px): суммы и действия видны без таблицы */}
                  <div className="min-[900px]:hidden flex flex-col gap-3">
                    {filteredHistory.slice(0, logsLimit).map((rec) => {
                      const mark = rec.mark || '';
                      const circMatch = mark.match(/\d+\s*круг[а-я]*/i);
                      const circles = circMatch ? circMatch[0] : '';
                      const direction = mark.replace(circMatch ? circMatch[0] : '', '').replace(/[,，]/g, ' ').trim();
                      return (
                        <article
                          key={rec.id}
                          data-salary-row={rec.id}
                          className="bg-white border border-[#E5E7EB] rounded-2xl p-4 flex flex-col gap-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-[#121316] truncate">{formatDriverShortName(rec.driver)}</div>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <span className={`${UI.chip} font-mono`}>{rec.car}</span>
                                <span className="text-[11px] text-[#6B7280]">
                                  {rec.datetime || '—'} · Логист: {rec.logist || 'Система'}
                                </span>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <div className="text-base font-semibold font-mono tabular-nums text-[#121316]">
                                {Math.round(rec.totalSalary || 0).toLocaleString('ru-RU')} €
                              </div>
                              {(rec.totalDays || 0) > 0 && (
                                <div className="text-[10px] text-[#9CA3AF]">
                                  З/П в день {Math.round((rec.totalSalary || 0) / rec.totalDays).toLocaleString('ru-RU')} €
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6B7280]">
                            {(direction || circles) ? (
                              <span className="inline-flex items-center gap-1.5">
                                {direction ? <span>{direction}</span> : null}
                                {circles ? <span className={UI.chip}>{circles}</span> : null}
                              </span>
                            ) : null}
                            <span className="font-mono tabular-nums text-[#4B5563]">
                              {Math.round(rec.km || 0).toLocaleString('ru-RU')} км · {rec.rate || 0} €/км
                            </span>
                            <span>В рейсе {rec.totalDays || 0} дн. · Простой {rec.idleDays || 0} дн.</span>
                          </div>

                          <div className="rounded-xl bg-[#F8F9FA] border border-[#E5E7EB] px-3 py-2 flex flex-col gap-0.5">
                            <span className="text-[11px] text-[#6B7280]">
                              З/П за км <span className="font-mono tabular-nums text-[#4B5563]">{Math.round(rec.kmMoney || 0).toLocaleString('ru-RU')} €</span>
                            </span>
                            <span className="text-[11px] text-[#6B7280]">
                              Суточные <span className="font-mono tabular-nums text-[#4B5563]">{Math.round(rec.daysMoney || 0).toLocaleString('ru-RU')} €</span>
                            </span>
                            {(rec.idleMoney || 0) > 0 && (
                              <span className="text-[11px] text-[#6B7280]">
                                Простой <span className="font-mono tabular-nums text-[#4B5563]">{Math.round(rec.idleMoney || 0).toLocaleString('ru-RU')} €</span>
                              </span>
                            )}
                            {(rec.bonus || 0) > 0 && (
                              <span className="text-[11px] text-[#6B7280]">
                                Премия <span className="font-mono tabular-nums text-[#4B5563]">+{Math.round(rec.bonus || 0)} €</span>
                              </span>
                            )}
                          </div>

                          {rec.comment ? (
                            <p className="text-[11px] text-[#6B7280]">{rec.comment}</p>
                          ) : null}

                          <div className="flex items-center gap-2 pt-2 border-t border-[#F3F4F6]">
                            <button
                              type="button"
                              onClick={() => copyHistoryToForm(rec)}
                              className={`${UI.buttonGhost} flex-1 min-h-[44px]`}
                            >
                              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                              Дублировать
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditModal(rec)}
                              className={`${UI.buttonGhost} flex-1 min-h-[44px]`}
                            >
                              <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                              Изменить
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (await showConfirm('Удалить эту выплату?')) {
                                  try {
                                    dbService.deleteSalary(rec, user.name, user.role);
                                    toast('Запись удалена из журнала', 'success');
                                  } catch (err) {
                                    console.error('Не удалось удалить выплату:', err);
                                    toast('Не удалось удалить запись. Повторите попытку.', 'error');
                                  }
                                }
                              }}
                              className={`${UI.buttonDanger} flex-1 min-h-[44px]`}
                            >
                              <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                              Удалить
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>

                  {filteredHistory.length > logsLimit && (
                    <div className="flex justify-center pt-1">
                      <button
                        type="button"
                        onClick={() => setLogsLimit(prev => prev + 10)}
                        className={UI.buttonGhost}
                      >
                        <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                        Показать ещё (+10)
                      </button>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </section>

        {editingSalaryId && (
          <ModalShell
            isOpen={!!editingSalaryId}
            onClose={closeEditModal}
            title="Редактирование выплаты"
            subtitle={[editingSalaryData.car, editingSalaryData.datetime].filter(Boolean).join(' · ') || 'Сохранённая запись журнала'}
            icon={<Edit className="w-4 h-4" aria-hidden="true" />}
            maxWidth="max-w-2xl"
            footer={
              <>
                <button type="button" onClick={closeEditModal} className={UI.buttonGhost}>Отмена</button>
                <button type="button" onClick={saveEditModal} className={UI.buttonPrimary}>Сохранить изменения</button>
              </>
            }
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className={UI.fieldLabel} htmlFor="salary-edit-driver">ФИО Водителя</label>
                <input id="salary-edit-driver" type="text" list="salary-drivers-dl" value={editingSalaryData.driver || ''} onChange={e => {
                     const val = e.target.value;
                     const foundDriver = drivers.find(d =>
                        String(d.name || '').trim().toLowerCase() === val.trim().toLowerCase() ||
                        (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === val.trim().toLowerCase())
                     );
                     let updatedData: Partial<SalaryLog> = { ...editingSalaryData, driver: val };

                     if (foundDriver) {
                         updatedData.driverId = foundDriver.id;
                         if (foundDriver.rateGroupId) {
                             const group = carsPool.find(g => g.id === foundDriver.rateGroupId);
                             if (group) {
                                 updatedData.rate = group.rate;
                             }
                         }
                     } else {
                         updatedData.driverId = '';
                     }
                     setEditingSalaryData(updatedData);
                }} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-car">Транспорт</label>
                <input id="salary-edit-car" type="text" value={editingSalaryData.car || ''} onChange={e => {
                      const val = e.target.value;
                      const { matchType, matchedCars } = findCarByPlate(val, vehicles);
                      let updatedData: Partial<SalaryLog> = { ...editingSalaryData, car: val };

                      if (matchType === 'exact' || matchType === 'partial') {
                          const matchedCar = matchedCars[0];
                          updatedData.carId = matchedCar.id;
                          updatedData.car = matchedCar.carNumber || matchedCar.vehicleNumbers || val;

                          // Find associated driver
                          const matchedDriver = resolveDriverForCar(matchedCar);
                          if (matchedDriver) {
                              updatedData.driverId = matchedDriver.id;
                              updatedData.driver = matchedDriver.name;

                              // Try updating rate
                              const normalizedCarPlate = normalizePlate(matchedCar.carNumber || matchedCar.vehicleNumbers || '');
                              const group = carsPool.find(g =>
                                  (g.vehicles || []).some(v => normalizePlate(v) === normalizedCarPlate)
                              );
                              if (group) {
                                  updatedData.rate = group.rate;
                              }
                          } else {
                              updatedData.driverId = '';
                              updatedData.driver = '';
                          }
                      } else {
                          updatedData.carId = '';
                          updatedData.driverId = '';
                      }
                      setEditingSalaryData(updatedData);
                }} className={`${UI.input} uppercase`} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-direction">Направление</label>
                <select id="salary-edit-direction" value={editDirection} onChange={e => setEditDirection(e.target.value)} className={UI.select}>
                    <option value="">—</option>
                    <option value="Турция">Турция</option>
                    <option value="Китай">Китай</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-circles">Круги</label>
                <select id="salary-edit-circles" value={editCircles} onChange={e => setEditCircles(e.target.value)} className={UI.select}>
                    <option value="">—</option>
                    <option value="2 круга">2 круга</option>
                    <option value="3 круга">3 круга</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-rate">Ставка (€/км)</label>
                <input id="salary-edit-rate" type="number" step="0.001" value={editingSalaryData.rate || 0} onChange={e => setEditingSalaryData({...editingSalaryData, rate: Number(e.target.value)})} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-km">Пробег (км)</label>
                <input id="salary-edit-km" type="number" value={editingSalaryData.km || 0} onChange={e => setEditingSalaryData({...editingSalaryData, km: Number(e.target.value)})} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-idle">Простой (дней)</label>
                <input id="salary-edit-idle" type="number" value={editingSalaryData.idleDays || 0} onChange={e => setEditingSalaryData({...editingSalaryData, idleDays: Number(e.target.value)})} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-days">Дней в рейсе</label>
                <input id="salary-edit-days" type="number" value={editingSalaryData.totalDays || 1} onChange={e => setEditingSalaryData({...editingSalaryData, totalDays: Number(e.target.value)})} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className={UI.fieldLabel} htmlFor="salary-edit-bonus">Премия (€)</label>
                <input id="salary-edit-bonus" type="number" value={editingSalaryData.bonus || 0} onChange={e => setEditingSalaryData({...editingSalaryData, bonus: Number(e.target.value)})} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className={UI.fieldLabel} htmlFor="salary-edit-comment">Комментарий</label>
                <input id="salary-edit-comment" type="text" value={editingSalaryData.comment || ''} onChange={e => setEditingSalaryData({...editingSalaryData, comment: e.target.value})} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className={UI.fieldLabel} htmlFor="salary-edit-logist">Логист / Кто внёс</label>
                <input id="salary-edit-logist" type="text" value={editingSalaryData.logist || ''} onChange={e => setEditingSalaryData({...editingSalaryData, logist: e.target.value})} className={UI.input} />
              </div>
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className={UI.fieldLabel} htmlFor="salary-edit-date">Дата</label>
                <input
                    id="salary-edit-date"
                    type="date"
                    value={editingSalaryData.datetime ? (() => {
                        const p = (editingSalaryData.datetime || '').split('.');
                        return p.length === 3 ? `${p[2]}-${p[1]}-${p[0]}` : '';
                    })() : ''}
                    onChange={e => {
                        const v = e.target.value; // YYYY-MM-DD
                        const parts = v.split('-');
                        const ru = parts.length === 3 ? `${parts[2]}.${parts[1]}.${parts[0]}` : v;
                        setEditingSalaryData({...editingSalaryData, datetime: ru});
                    }}
                    className={UI.input} />
              </div>
            </div>
          </ModalShell>
        )}

        <datalist id="salary-drivers-dl">
            {drivers.map(drv => (
                <option key={drv.id} value={drv.shortNameRu || formatDriverShortName(drv)} />
            ))}
        </datalist>

      </div>
    </ModuleShell>
  );
}

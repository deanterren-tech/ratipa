import {useState, useEffect} from 'react'
import {UserProfile, SalaryLog, CarRateGroup, AppSettings, Driver, Vehicle} from '../../types'
import { dbService, database, onValue } from '../../api'
import {pdService} from '../../api'
import { ref } from 'firebase/database'
import {Wallet, Calculator, Trash2, Edit, Copy} from 'lucide-react'
import CalendarDaysCalculator from './CalendarDaysCalculator';
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {normalizePlate, findCarByPlate, getDriverById, getDriverIdForCar, formatCoupling} from '../../utils/salaryAutofill'
import {formatDriverShortName} from '../../utils/driverSync'
import {CarConflictModal} from '../common/CarConflictModal'
import {CarConflict} from '../../utils/carConflictHandler'
import CouplingPicker from '../common/CouplingPicker';

interface SalaryModuleProps {
  user: UserProfile;
}


export default function SalaryModule({ user }: SalaryModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [logs, setLogs] = useState<SalaryLog[]>([]);
  const [carsPool, setCarsPool] = useState<CarRateGroup[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [driversMap, setDriversMap] = useState<Record<string, string>>({});
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Tab control states for Recent Logs
  const [activeTab, setActiveTab] = useState<'current' | 'archive' | 'dispatcher'>('current');
  const [selectedMonth, setSelectedMonth] = useState<string>('');
  const [selectedDispatcher, setSelectedDispatcher] = useState<string>('');
  const [availableMonths, setAvailableMonths] = useState<string[]>([]);
  const [availableDispatchers, setAvailableDispatchers] = useState<string[]>([]);
  const [isMigrating, setIsMigrating] = useState(false);


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
      dbService.updateSalary(editingSalaryData.id, { ...editingSalaryData, mark }, user.name, user.role);
    }
    closeEditModal();
  };
  const copyHistoryToForm = (rec: SalaryLog) => {
    // дублируем запись в форму редактирования (переиспользуем тот же state)
    setEditingSalaryId(rec.id || null);
    setEditingSalaryData(rec);
  };

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

  // 4. Scoped reactive subscription for active tab
  useEffect(() => {
    let dbPath = '';
    
    if (activeTab === 'current') {
      const d = new Date();
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const currentYM = `${d.getFullYear()}-${mm}`;
      dbPath = `salaryHistory/months/${currentYM}`;
    } else if (activeTab === 'archive') {
      if (selectedMonth) {
        dbPath = `salaryHistory/months/${selectedMonth}`;
      }
    } else if (activeTab === 'dispatcher') {
      if (selectedDispatcher) {
        dbPath = `salaryHistory/byDispatcher/${selectedDispatcher}`;
      }
    }
    
    if (!dbPath) {
      setLogs([]);
      return;
    }
    
    const unsub = onValue(ref(database, dbPath), (snap) => {
      const data = snap.val();
      if (data) {
        const list: SalaryLog[] = Object.keys(data).map((key) => ({
          id: key,
          ...data[key],
        }));
        list.sort((a, b) => {
          const aTime = parseInt(a.id.replace(/\D/g, "")) || 0;
          const bTime = parseInt(b.id.replace(/\D/g, "")) || 0;
          return bTime - aTime;
        });
        setLogs(list);
      } else {
        setLogs([]);
      }
    }, (err) => {
      console.warn(`Failed to subscribe to ${dbPath}:`, err);
      setLogs([]);
    });
    
    return () => {
      unsub();
    };
  }, [activeTab, selectedMonth, selectedDispatcher]);

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

    dbService.saveSalary(newLog, user.name, user.role);
    clearForm();
  };


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
    <div className="w-full space-y-6">
        {/* Header Block */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col space-y-5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                    <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
                      Модуль Зарплата
                    </span>
                    <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
                      <Wallet className="w-7 h-7 text-slate-800" /> Зарплата водителей
                    </h1>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                </div>
            </div>
        </div>

        <div className="flex flex-col gap-6">


                {/* Calculator Form */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="lg:col-span-3 bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col gap-5">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-slate-200 pb-4">
                            <h2 className="text-sm font-bold text-slate-900 tracking-tight">Калькулятор рейса водителя</h2>
                            <div className="flex gap-2">
                                 <button onClick={clearForm} className="bg-white border border-slate-200/60 hover:bg-slate-50 text-slate-700 font-bold px-4 min-h-[44px] py-2 rounded-xl text-xs transition active:scale-95 cursor-pointer shadow-sm">Очистить</button>
                                 <button onClick={saveToHistory} className="bg-slate-900 text-white hover:bg-slate-800 shadow-sm border border-slate-800 font-bold px-4 min-h-[44px] py-2 rounded-xl text-xs uppercase tracking-wide flex items-center gap-2 transition active:scale-95 cursor-pointer">
                                     Фиксировать выплату <Wallet className="h-4 w-4" />
                                 </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Автомобиль</label>
                                <CouplingPicker
                                  value={carNumber}
                                  onSelect={(rec) => {
                                    if (rec) {
                                      const cNum = (rec.carNumber || rec.vehicleNumbers || '').toUpperCase();
                                      setCarNumber(cNum);
                                      if (rec.driverName) {
                                        setDriverName(rec.driverName);
                                      }
                                      handleCarNumberChange(cNum);
                                    }
                                  }}
                                />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ФИО Водителя</label>
                                <input type="text" value={driverName} onChange={e => setDriverName(e.target.value)} placeholder="—" className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Направление</label>
                                <select value={tripDirection} onChange={e => setTripDirection(e.target.value)} className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs cursor-pointer appearance-none">
                                    <option value="Турция">Турция</option>
                                    <option value="Китай">Китай</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Круги</label>
                                <select value={tripCircles} onChange={e => setTripCircles(e.target.value)} className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs cursor-pointer appearance-none">
                                    <option value="">—</option>
                                    <option value="2 круга">2 круга</option>
                                    <option value="3 круга">3 круга</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Общий пробег (км)</label>
                                <input type="number" value={totalKm} onChange={e => setTotalKm(Number(e.target.value))} placeholder="5500" className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ставка за км (€)</label>
                                <input type="number" step="0.001" value={ratePerKm} onChange={e => setRatePerKm(Number(e.target.value))} className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Дней простоя ({currentIdleRate} €/д)</label>
                                <input type="number" value={idleDays} onChange={e => setIdleDays(Number(e.target.value))} min="0" className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Дней в рейсе ({currentPerDiem} €/д)</label>
                                <input type="number" value={totalDays} onChange={e => setTotalDays(Number(e.target.value))} min="1" className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Премия (€)</label>
                                <input type="number" value={bonus} onChange={e => setBonus(Number(e.target.value))} min="0" placeholder="0" className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs" />
                            </div>
                            <div className="flex flex-col gap-1.5 sm:col-span-2 lg:col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Комментарий к выплате</label>
                                <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Опционально (штрафы, детали, премии...)" className="w-full bg-white/45 border border-slate-200/50 rounded-xl text-xs font-semibold text-slate-800 outline-none px-3 py-2 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/50 transition shadow-2xs" />
                            </div>
                        </div>
                    </div>
                    <div className="lg:col-span-1">
                        <CalendarDaysCalculator onDaysCalculated={(days) => setTotalDays(days)} />
                    </div>
                </div>

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

                {/* Totals Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-center">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">За километраж</div>
                        <div className="text-xl font-bold text-slate-800 tracking-tight font-mono">{Math.round(kmMoney).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-center">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Простой + Суточные</div>
                        <div className="text-xl font-bold text-slate-800 tracking-tight font-mono">{Math.round(idleMoney + daysMoney).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-center">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">Премия</div>
                        <div className="text-xl font-bold text-slate-800 tracking-tight font-mono">{Math.round(bonus).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-center">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1">З/П за сутки</div>
                        <div className="text-xl font-bold text-slate-800 tracking-tight font-mono">{Math.round(salaryPerDay).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex flex-col justify-center">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-1 font-sans">Итого водителю</div>
                        <div className="text-2xl font-bold text-slate-800 tracking-tight font-mono">{Math.round(totalSalary).toLocaleString('ru-RU')} €</div>
                    </div>
                </div>

            </div>

        {/* Global Statistics Grid (Full Width) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm">
                    <h2 className="text-sm font-bold text-slate-900 tracking-tight mb-4 flex items-center gap-2 select-none">
                        <Calculator className="h-4 w-4 text-[#3765F6]" /> 
                        Статистика выплат ({activeTab === 'current' ? 'Текущий месяц' : activeTab === 'archive' ? 'За выбранный месяц' : 'По выбранному логисту'})
                    </h2>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
                         <div className="bg-slate-50/50 rounded-lg px-2.5 py-1.5 flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Выплат всего</span>
                            <span className="text-xs font-bold font-mono tabular-nums text-slate-800">{logs.length}</span>
                        </div>
                        <div className="bg-slate-50/50 rounded-lg px-2.5 py-1.5 flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Сумма всех выплат</span>
                            <span className="text-xs font-bold font-mono tabular-nums text-slate-800">{Math.round(totalPaid).toLocaleString('ru-RU')} €</span>
                        </div>
                        <div className="bg-slate-50/50 rounded-lg px-2.5 py-1.5 flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Средняя выплата</span>
                            <span className="text-xs font-bold font-mono tabular-nums text-slate-800">{Math.round(avgPaid).toLocaleString('ru-RU')} €</span>
                        </div>
                        <div className="bg-slate-50/50 rounded-lg px-2.5 py-1.5 flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Максимальная</span>
                            <span className="text-xs font-bold font-mono tabular-nums text-slate-800">{Math.round(maxPaid).toLocaleString('ru-RU')} €</span>
                        </div>
                        <div className="bg-slate-50/50 rounded-lg px-2.5 py-1.5 flex flex-col">
                            <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Уникальных водителей</span>
                            <span className="text-xs font-bold font-mono tabular-nums text-slate-800">{uniqueDrivers}</span>
                        </div>
                    </div>
                </div>

        {/* History Cards / Recent Logs (Full Width) */}
        <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <h2 className="text-sm font-bold text-slate-900 tracking-tight">Журнал последних выплат</h2>
                
                {/* Available Months or Dispatchers dropdown inside header */}
                <div className="flex flex-wrap items-center gap-3">
                    {activeTab === 'dispatcher' && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Логист:</span>
                            <select
                                value={selectedDispatcher}
                                onChange={(e) => setSelectedDispatcher(e.target.value)}
                                className="bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-bold px-3 py-1.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all cursor-pointer shadow-sm"
                            >
                                {availableDispatchers.length === 0 ? (
                                    <option value="">Нет данных</option>
                                ) : (
                                    availableDispatchers.map((d) => (
                                        <option key={d} value={d}>
                                            {d}
                                        </option>
                                    ))
                                )}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* Interactive Tabs Menu */}
            <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 w-full sm:w-fit mb-6">
                <button
                    onClick={() => setActiveTab('current')}
                    className={`flex-1 sm:flex-none px-4 min-h-[44px] py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                        activeTab === 'current'
                            ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
                    }`}
                >
                    Текущий месяц
                </button>
                <button
                    onClick={() => setActiveTab('archive')}
                    className={`flex-1 sm:flex-none px-4 min-h-[44px] py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                        activeTab === 'archive'
                            ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
                    }`}
                >
                    Архив месяцев
                </button>
                <button
                    onClick={() => setActiveTab('dispatcher')}
                    className={`flex-1 sm:flex-none px-4 min-h-[44px] py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                        activeTab === 'dispatcher'
                            ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
                    }`}
                >
                    По диспетчерам
                </button>
            </div>
            
            <div className="mb-6">
                <input 
                    type="text" 
                    value={searchQuery} 
                    onChange={e => setSearchQuery(e.target.value)} 
                    placeholder="Поиск по водителю, логисту, транспортному средству..." 
                    className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                />
            </div>

            {/* Подвкладки месяцев (Архив) / логистов (По диспетчерам) */}
            {activeTab === 'archive' && availableMonths.length > 0 && (
                <div className="flex flex-wrap gap-1 p-1 bg-slate-100/80 rounded-xl mb-6 border border-slate-200/50">
                    {availableMonths.map((m) => {
                        const [year, month] = m.split('-');
                        const monthsNamesRu = [
                            'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
                            'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
                        ];
                        const mIndex = parseInt(month, 10) - 1;
                        const humanLabel = mIndex >= 0 && mIndex < 12 ? `${monthsNamesRu[mIndex]} ${year}` : m;
                        const isActive = selectedMonth === m;
                        return (
                            <button
                                key={m}
                                onClick={() => setSelectedMonth(m)}
                                className={`flex-1 min-w-[120px] px-3 min-h-[44px] py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                                    isActive
                                        ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
                                }`}
                            >
                                {humanLabel}
                            </button>
                        );
                    })}
                </div>
            )}

            {activeTab === 'dispatcher' && availableDispatchers.length > 0 && (
                <div className="flex flex-wrap gap-1 p-1 bg-slate-100/80 rounded-xl mb-6 border border-slate-200/50">
                    {availableDispatchers.map((d) => {
                        const isActive = selectedDispatcher === d;
                        return (
                            <button
                                key={d}
                                onClick={() => setSelectedDispatcher(d)}
                                className={`flex-1 min-w-[120px] px-3 min-h-[44px] py-2 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                                    isActive
                                        ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                                        : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
                                }`}
                            >
                                {d}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="space-y-4">
                {filteredHistory.length === 0 ? (
                    <div className="text-center py-12 text-slate-400 font-medium text-xs bg-slate-50 rounded-xl border border-slate-200">История пустая</div>
                ) : (
                    filteredHistory.slice(0, logsLimit).map((rec) => (
                        <div key={rec.id} className={`bg-white border rounded-2xl p-5 flex flex-col group hover:shadow-[0_8px_30px_rgba(0,0,0,0.01)] transition-all duration-300 ${
                          (rec.mark || '').includes('2 круга') ? 'border-blue-300 bg-blue-50/30 hover:border-blue-400' :
                          (rec.mark || '').includes('3 круга') ? 'border-purple-300 bg-purple-50/30 hover:border-purple-400' :
                          'border-slate-200 hover:border-slate-300'
                        }`}>
                            
                            {/* Header Row */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-200">
                                <div className="flex flex-wrap items-center gap-3">
                                    <div className="bg-slate-900 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold uppercase tracking-wider">{formatDriverShortName(rec.driver)}</div>
                                    <div className="text-xs font-bold text-slate-500 flex items-center gap-2">
                                       <span className="text-slate-400 uppercase tracking-wider text-[10px]">ТС:</span> 
                                       <span className="text-slate-800 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200 font-mono text-[11px]">{rec.car}</span>
                                    </div>
                                    <span className="text-slate-300 hidden sm:inline">|</span>
                                    <div className="text-xs text-slate-400 font-medium">
                                       {rec.datetime} · <span className="text-slate-500 font-semibold">Логист: {rec.logist || 'Система'}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 self-end sm:self-auto">
                                     <button 
                                         onClick={() => copyHistoryToForm(rec)} 
                                         title="Дублировать в форму" 
                                         className="flex items-center gap-1.5 px-3 min-h-[44px] py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition border border-slate-200/50 cursor-pointer"
                                     >
                                         <Copy className="w-3.5 h-3.5" />
                                         <span className="hidden md:inline">Дублировать</span>
                                     </button>
                                     <button 
                                         onClick={() => openEditModal(rec)} 
                                         title="Редактировать" 
                                         className="flex items-center gap-1.5 px-3 min-h-[44px] py-2 rounded-lg text-xs font-bold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition border border-slate-200/50 cursor-pointer"
                                     >
                                         <Edit className="w-3.5 h-3.5" />
                                         <span className="hidden md:inline">Править</span>
                                     </button>
                                     <button 
                                         onClick={async () => { if(await showConfirm('Удалить эту выплату?')) dbService.deleteSalary(rec, user.name, user.role); }} 
                                         title="Удалить" 
                                         className="flex items-center gap-1.5 px-3 min-h-[44px] py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition border border-transparent hover:border-rose-100 cursor-pointer"
                                     >
                                         <Trash2 className="w-3.5 h-3.5" />
                                         <span className="hidden md:inline">Удалить</span>
                                     </button>
                                </div>
                            </div>

                            {/* Details Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4 bg-slate-50 p-4 rounded-xl border border-slate-200">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Пробег</span>
                                    <span className="text-xs font-bold text-slate-800 font-mono">{Math.round(rec.km || 0).toLocaleString('ru-RU')} км</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Ставка за км</span>
                                    <span className="text-xs font-bold text-slate-800 font-mono">{rec.rate || 0} €</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">В рейсе</span>
                                    <span className="text-xs font-bold text-slate-800 font-mono">{rec.totalDays || 0} дн.</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Простой</span>
                                    <span className="text-xs font-bold text-slate-800 font-mono">{rec.idleDays || 0} дн.</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Оценка</span>
                                    <div>
                                        {rec.mark === 'Отлично' ? 
                                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 border border-emerald-200 px-2 py-0.5 rounded-md shadow-sm">Отлично</span> 
                                            : 
                                            <span className="text-[10px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md shadow-sm">{rec.mark || 'Не оценено'}</span>
                                        }
                                    </div>
                                </div>
                                {/круг/.test(rec.mark || '') && (
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-1">Круги</span>
                                    <div>
                                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md shadow-sm ${
                                            (rec.mark || '').includes('2 круга')
                                                ? 'text-blue-700 bg-blue-100 border border-blue-200'
                                                : (rec.mark || '').includes('3 круга')
                                                ? 'text-purple-700 bg-purple-100 border border-purple-200'
                                                : 'text-slate-600 bg-slate-100 border border-slate-200'
                                        }`}>
                                            {(rec.mark || '').match(/\d+\s*круг[а-я]*/i)?.[0] || '—'}
                                        </span>
                                    </div>
                                </div>
                                )}
                            </div>

                            {/* Second Row: Detailed Breakdown & Total Payment */}
                            <div className="pt-4 border-t border-slate-200 flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                                <div className="flex flex-wrap gap-x-6 gap-y-2">
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">З/П за км</span>
                                        <span className="text-sm font-bold text-slate-700 font-mono">{Math.round(rec.kmMoney || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Суточные</span>
                                        <span className="text-sm font-bold text-slate-700 font-mono">{Math.round(rec.daysMoney || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                    {(rec.idleMoney || 0) > 0 && (
                                    <div className="flex flex-col">
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Простой</span>
                                        <span className="text-sm font-bold text-slate-700 font-mono">{Math.round(rec.idleMoney || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                    )}
                                    {(rec.bonus || 0) > 0 && (
                                    <div className="flex flex-col px-2.5 py-0.5 bg-slate-50 rounded-lg border border-slate-200">
                                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">Премия</span>
                                        <span className="text-sm font-bold text-slate-700 font-mono">+{Math.round(rec.bonus || 0)} €</span>
                                    </div>
                                    )}
                                </div>
                                <div className="flex gap-3 w-full md:w-auto self-end md:self-auto justify-end">
                                    {(rec.totalDays || 0) > 0 && (
                                        <div className="flex flex-col bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl items-end min-w-[110px]">
                                            <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5 font-sans">З/П в день</span>
                                            <span className="text-lg font-bold text-slate-800 font-mono tracking-tight">{Math.round((rec.totalSalary || 0) / rec.totalDays).toLocaleString('ru-RU')} €</span>
                                        </div>
                                    )}
                                    <div className="flex flex-col bg-slate-50 border border-slate-200 px-4 py-2 rounded-xl items-end min-w-[120px]">
                                        <span className="text-[9px] font-semibold uppercase tracking-wider text-slate-400 mb-0.5 font-sans">Итого к выплате</span>
                                        <span className="text-lg font-bold text-slate-800 font-mono tracking-tight">{Math.round(rec.totalSalary || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                </div>
                            </div>

                            {rec.comment && (
                                <div className="mt-4 pt-3 border-t border-slate-200 text-xs text-slate-600 flex gap-2 items-start bg-slate-50 -mx-6 -mb-6 p-4 rounded-b-[2rem]">
                                    <span className="text-slate-400 font-bold uppercase tracking-wider text-[9px] mt-0.5">Комментарий:</span>
                                    <span className="text-slate-700 font-mono text-[11px] leading-normal">{rec.comment}</span>
                                </div>
                            )}
                        </div>
                    ))
                )}
                {filteredHistory.length > logsLimit && (
                  <button onClick={() => setLogsLimit(prev => prev + 10)}
                    className="w-full py-3 border border-dashed border-slate-200 hover:border-slate-400 text-slate-500 hover:text-slate-700 font-semibold text-xs rounded-xl transition bg-slate-50 hover:bg-slate-100 cursor-pointer text-center block mt-4">
                    Показать еще (+10)
                  </button>
                )}
            </div>
        </div>

        {editingSalaryId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 animate-fade-in overflow-y-auto">
                <div className="bg-white rounded-2xl w-full max-w-2xl shadow-sm border border-slate-200 my-4">
                    <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-[2rem]">
                        <h3 className="text-sm font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                           <Edit className="w-5 h-5 text-slate-400" /> Редактирование выплаты
                        </h3>
                        <button onClick={closeEditModal} className="min-h-[44px] min-w-[44px] text-slate-400 hover:text-slate-600 bg-white shadow-sm border border-slate-200 rounded-full flex items-center justify-center font-bold transition active:scale-90 cursor-pointer">×</button>
                    </div>
                    
                    <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">ФИО Водителя</label>
                                <input type="text" list="salary-drivers-dl" value={editingSalaryData.driver || ''} onChange={e => {
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
                                 }} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Транспорт</label>
                                <input type="text" value={editingSalaryData.car || ''} onChange={e => {
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
                                 }} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all uppercase" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Направление</label>
                                <select value={editDirection} onChange={e => setEditDirection(e.target.value)} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all cursor-pointer appearance-none">
                                    <option value="">—</option>
                                    <option value="Турция">Турция</option>
                                    <option value="Китай">Китай</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Круги</label>
                                <select value={editCircles} onChange={e => setEditCircles(e.target.value)} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all cursor-pointer appearance-none">
                                    <option value="">—</option>
                                    <option value="2 круга">2 круга</option>
                                    <option value="3 круга">3 круга</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Ставка (€/км)</label>
                                <input type="number" step="0.001" value={editingSalaryData.rate || 0} onChange={e => setEditingSalaryData({...editingSalaryData, rate: Number(e.target.value)})} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Пробег (км)</label>
                                <input type="number" value={editingSalaryData.km || 0} onChange={e => setEditingSalaryData({...editingSalaryData, km: Number(e.target.value)})} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Простой (дней)</label>
                                <input type="number" value={editingSalaryData.idleDays || 0} onChange={e => setEditingSalaryData({...editingSalaryData, idleDays: Number(e.target.value)})} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Дней в рейсе</label>
                                <input type="number" value={editingSalaryData.totalDays || 1} onChange={e => setEditingSalaryData({...editingSalaryData, totalDays: Number(e.target.value)})} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Премия (€)</label>
                                <input type="number" value={editingSalaryData.bonus || 0} onChange={e => setEditingSalaryData({...editingSalaryData, bonus: Number(e.target.value)})} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Комментарий</label>
                                <input type="text" value={editingSalaryData.comment || ''} onChange={e => setEditingSalaryData({...editingSalaryData, comment: e.target.value})} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Логист / Кто внёс</label>
                                <input type="text" value={editingSalaryData.logist || ''} onChange={e => setEditingSalaryData({...editingSalaryData, logist: e.target.value})} className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Дата</label>
                                <input
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
                                    className="w-full bg-slate-50 hover:bg-slate-100/50 border border-slate-200 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all" />
                            </div>
                        </div>
                    </div>
                    
                    <div className="p-6 border-t border-slate-200 flex justify-end gap-3 bg-slate-50 rounded-b-[2rem]">
                        <button onClick={closeEditModal} className="px-5 min-h-[44px] py-2.5 rounded-xl font-bold text-slate-500 bg-slate-100 hover:bg-slate-200 transition cursor-pointer text-xs uppercase tracking-wider shadow-sm border border-slate-200">Отмена</button>
                        <button onClick={saveEditModal} className="px-5 min-h-[44px] py-2.5 rounded-xl font-bold text-white bg-slate-900 hover:bg-slate-800 shadow-sm border border-slate-800 transition flex items-center justify-center gap-2 text-xs uppercase tracking-wider cursor-pointer">
                            Сохранить изменения
                        </button>
                    </div>
                </div>
            </div>
        )}

        <datalist id="salary-drivers-dl">
            {drivers.map(drv => (
                <option key={drv.id} value={drv.shortNameRu || formatDriverShortName(drv)} />
            ))}
        </datalist>

    </div>
  );
}
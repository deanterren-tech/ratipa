import {useState, useEffect, useMemo} from 'react'
import {UserProfile, SalaryLog, CarRateGroup, AppSettings, Driver, Vehicle} from '../../types'
import { dbService, database, onValue } from '../../api'
import {pdService} from '../../api'
import { ref } from 'firebase/database'
import {Wallet, Calculator, Trash2, Edit, Copy, Calendar, TrendingUp, History, ChevronDown, CheckCircle2} from 'lucide-react'
import {UI} from '../../ui/kit'
import {ModuleShell, SectionHeader, SearchField, FilterPills, StatusText, EmptyState, FoundCount, ModalShell} from '../../ui/components'
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
    <ModuleShell title="Зарплата водителей">
      <div className="flex flex-col gap-6">

        {/* 1. Период и исходные данные */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            icon={<Calendar className="w-4 h-4" aria-hidden="true" />}
            title="Период и исходные данные"
            subtitle="Даты рейса, автомобиль, водитель и направление"
          />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
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
            <div className="lg:col-span-1">
              <CalendarDaysCalculator onDaysCalculated={(days) => setTotalDays(days)} />
            </div>
          </div>
        </section>

        {/* 2. Параметры расчёта */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            icon={<Calculator className="w-4 h-4" aria-hidden="true" />}
            title="Параметры расчёта"
            subtitle="Пробег, ставки, дни и премия"
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

        {/* 3. Показатели */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            icon={<TrendingUp className="w-4 h-4" aria-hidden="true" />}
            title="Показатели"
            subtitle="Начисления, из которых складывается выплата"
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-3">
            <div className="flex items-center justify-between gap-3">
              <StatusText color="accent">За километраж</StatusText>
              <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{Math.round(kmMoney).toLocaleString('ru-RU')} €</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <StatusText color="grey">Простой + Суточные</StatusText>
              <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{Math.round(idleMoney + daysMoney).toLocaleString('ru-RU')} €</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <StatusText color="grey">Премия</StatusText>
              <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{Math.round(bonus).toLocaleString('ru-RU')} €</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <StatusText color="grey">З/П за сутки</StatusText>
              <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{Math.round(salaryPerDay).toLocaleString('ru-RU')} €</span>
            </div>
          </div>
        </section>

        {/* 4. Итоговая сумма */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            icon={<Wallet className="w-4 h-4" aria-hidden="true" />}
            title="Итоговая сумма"
            subtitle="Итого к выплате за текущий расчёт"
          />
          <div className="flex flex-col gap-1">
            <span className={UI.caption}>Итого водителю</span>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl sm:text-4xl font-mono font-semibold tabular-nums text-[#121316]">
                {Math.round(totalSalary).toLocaleString('ru-RU')}
              </span>
              <span className="text-sm text-[#6B7280]">€</span>
            </div>
            <p className="text-[11px] text-[#6B7280]">
              Складывается из показателей выше: километраж, простой с суточными и премия.
            </p>
          </div>
        </section>

        {/* 5. Фиксация выплаты */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            icon={<CheckCircle2 className="w-4 h-4" aria-hidden="true" />}
            title="Фиксация выплаты"
            subtitle="Сохранение расчёта в журнал выплат"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={clearForm} className={UI.buttonGhost}>Очистить</button>
            <button onClick={saveToHistory} className={UI.buttonPrimary}>
              <Wallet className="w-4 h-4" aria-hidden="true" />
              Фиксировать выплату
            </button>
            <span className={`${UI.hint} ml-1`}>Запись появится в журнале выплат ниже.</span>
          </div>
        </section>

        {/* 6. Журнал выплат */}
        <section className="flex flex-col gap-4">
          <SectionHeader
            icon={<History className="w-4 h-4" aria-hidden="true" />}
            title="Журнал выплат"
            subtitle="Поиск по водителю, логисту и транспорту; архив и группировка по диспетчерам"
          />

          <div className="flex flex-col gap-3">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <FilterPills
                items={[
                  { key: 'current', label: 'Текущий месяц' },
                  { key: 'archive', label: 'Архив месяцев' },
                  { key: 'dispatcher', label: 'По диспетчерам' },
                ]}
                active={activeTab}
                onChange={(key) => setActiveTab(key)}
                ariaLabel="Период журнала выплат"
              />
              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Поиск по водителю, логисту, транспортному средству..."
                className="lg:flex-1 lg:max-w-none"
              />
              {activeTab === 'dispatcher' && (
                <div className="flex items-center gap-2 shrink-0">
                  <span className={UI.fieldLabel}>Логист:</span>
                  <select
                    value={selectedDispatcher}
                    onChange={(e) => setSelectedDispatcher(e.target.value)}
                    className={`${UI.select} lg:min-w-[200px]`}
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

          <div className="flex flex-col gap-3 pt-1">
            <span className={UI.caption}>
              Статистика выплат ({activeTab === 'current' ? 'Текущий месяц' : activeTab === 'archive' ? 'За выбранный месяц' : 'По выбранному логисту'})
            </span>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-x-6 gap-y-3">
              <div className="flex items-center justify-between gap-3">
                <StatusText color="grey">Выплат всего</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{logs.length}</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <StatusText color="accent">Сумма всех выплат</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{Math.round(totalPaid).toLocaleString('ru-RU')} €</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <StatusText color="grey">Средняя выплата</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{Math.round(avgPaid).toLocaleString('ru-RU')} €</span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <StatusText color="grey">Максимальная</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-[#121316] shrink-0">{Math.round(maxPaid).toLocaleString('ru-RU')} €</span>
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
              title={searchQuery ? undefined : 'Выплат пока нет'}
              hint={searchQuery ? undefined : 'Заполните расчёт и нажмите «Фиксировать выплату» — запись появится здесь.'}
              query={searchQuery || undefined}
            />
          ) : (
            <div className={UI.tableWrap}>
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
                    <tr key={rec.id} className={UI.tr}>
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
                            onClick={() => copyHistoryToForm(rec)}
                            title="Дублировать в форму"
                            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                          >
                            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            onClick={() => openEditModal(rec)}
                            title="Редактировать"
                            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-[#6B7280] hover:text-[var(--accent-ink)] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                          >
                            <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            onClick={async () => { if(await showConfirm('Удалить эту выплату?')) dbService.deleteSalary(rec, user.name, user.role); }}
                            title="Удалить"
                            className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer"
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
          )}

          {filteredHistory.length > logsLimit && (
            <div className="flex justify-center pt-1">
              <button
                onClick={() => setLogsLimit(prev => prev + 10)}
                className={UI.buttonGhost}
              >
                <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                Показать ещё (+10)
              </button>
            </div>
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
                <button onClick={closeEditModal} className={UI.buttonGhost}>Отмена</button>
                <button onClick={saveEditModal} className={UI.buttonPrimary}>Сохранить изменения</button>
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

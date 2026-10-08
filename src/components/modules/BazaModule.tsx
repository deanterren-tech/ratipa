import React, {useState, useEffect, useMemo} from 'react'
import {UserProfile, AppSettings} from '../../types'
import {dbService, onValue} from '../../api'
import {pdService} from '../../api'
import {getDatabase, ref, set, push, remove, update, query, limitToLast} from 'firebase/database'
import {getApp} from 'firebase/app'
import {
  Archive,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Calendar,
  ChevronDown,
  Edit,
  History,
  Plus,
  Trash2,
  Truck,
  AlertCircle,
  Lock,
} from 'lucide-react';
import {UI} from '../../ui/kit'
import {openDatePicker} from '../../utils/openDatePicker'
import {
  ModuleShell,
  SectionHeader,
  SearchField,
  FilterPills,
  StatusText,
  EmptyState,
  FoundCount,
  ModalShell,
} from '../../ui/components'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {formatDriverShortName} from '../../utils/driverSync'
import {applySharedCarToBazaRecord, applySharedDriverToBazaRecord, normalizePlate} from '../../utils/bazaSync'
import CouplingPicker from '../common/CouplingPicker';
import { resolvePermission } from '../../utils/permissions';

interface BazaModuleProps {
  user: UserProfile;
  settings?: AppSettings | null;
}

const allFields = ['carNumber', 'driverName', 'dateArrival', 'dateLoading', 'dateRepairStart', 'dateRepairEnd', 'dateDeparture', 'comment'] as const;
type FieldType = typeof allFields[number];

const fieldLabels: Record<FieldType, string> = {
  carNumber: "Госномер",
  driverName: "Водитель",
  dateArrival: "Прибыл на базу",
  dateLoading: "Срок готовности",
  dateRepairStart: "Заявка на ремонт",
  dateRepairEnd: "Завершение ремонта",
  dateDeparture: "Фактический выезд",
  comment: "Примечание"
};

const getNormalizedFieldLabel = (field: string) => {
  if (field === "К какому числу должна быть готова машина" || field === "Срок готовности") return "Срок готовности";
  if (field === "Дата подачи заявки на ремонт" || field === "Заявка на ремонт") return "Заявка на ремонт";
  if (field === "Дата окончания ремонта" || field === "Завершение ремонта") return "Завершение ремонта";
  return field;
};



/**
 * Поле даты в форме: пользователь видит текст «ДД/ММ/ГГГГ», а рядом есть значок
 * календаря. Логика прежняя: текстовое поле только для показа, значение хранит
 * скрытый нативный input[type=date] (он же открывает системный календарь),
 * поэтому формат и сохранённое значение не меняются. Открытие — через общий
 * openDatePicker (фолбэк для браузеров без showPicker); на мобильном тап ловит
 * сам нативный input (md:pointer-events-none), календарь открывается напрямую.
 */
function BazaDateField({
  id,
  label,
  value,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  disabled?: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  const openPicker = () => {
    openDatePicker(`picker-${id}`);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label className={UI.fieldLabel} htmlFor={`form-date-${id}`}>{label}</label>
      <div className="relative">
        <input
          id={`form-date-${id}`}
          type="text"
          readOnly
          disabled={disabled}
          value={value ? value.split('-').reverse().join('/') : ''}
          placeholder="ДД/ММ/ГГГГ"
          onClick={openPicker}
          className={`${UI.input} cursor-pointer pr-11`}
        />
        <input
          type="date"
          id={`picker-${id}`}
          disabled={disabled}
          value={value || ''}
          onChange={onChange}
          className="absolute inset-0 opacity-0 md:pointer-events-none"
          aria-hidden="true"
          tabIndex={-1}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={openPicker}
          title={`Открыть календарь: ${label}`}
          aria-label={`Открыть календарь: ${label}`}
          className="absolute right-1 top-1/2 flex min-h-[36px] min-w-[36px] -translate-y-1/2 items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] disabled:opacity-30 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] pointer-events-none md:pointer-events-auto"
        >
          <Calendar className="w-4 h-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

export default function BazaModule({ user: ratipaUser, settings }: BazaModuleProps) {
  const { showConfirm } = useDialog();

  // Переход из таймлайна: «Открыть учёт выезда» помечает запись — подсвечиваем
  // и прокручиваем к ней, когда список загрузился (данные приходят асинхронно).
  useEffect(() => {
    let focusId = '';
    try {
      focusId = sessionStorage.getItem('ratipa_focus_baza_record') || '';
      if (focusId) sessionStorage.removeItem('ratipa_focus_baza_record');
    } catch {
      /* не критично */
    }
    if (!focusId) return;
    let tries = 0;
    const clickTab = (re: RegExp) => {
      const btn = Array.from(document.querySelectorAll('button, [role="tab"]')).find((b) =>
        re.test((b.textContent || '').trim()),
      );
      if (btn) {
        (btn as HTMLElement).click();
        return true;
      }
      return false;
    };
    const timer = window.setInterval(() => {
      tries += 1;
      const el = document.querySelector(`[data-baza-id="${focusId}"]`);
      if (el) {
        window.clearInterval(timer);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('ring-2', 'ring-[var(--accent-30)]');
        window.setTimeout(() => el.classList.remove('ring-2', 'ring-[var(--accent-30)]'), 3000);
        return;
      }
      // Запись может лежать в другой вкладке или ниже по списку (пагинация) —
      // переключаемся/догружаем, не теряя намерение показать именно эту запись.
      if (tries === 2) clickTab(/^Архив\b/);
      if (tries === 4 || tries === 6 || tries === 8) clickTab(/^Показать ещё\b/);
      if (tries === 10) clickTab(/^На базе\b/);
      if (tries > 14) window.clearInterval(timer);
    }, 600);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { toast } = useToast();
  const [currentTab, setCurrentTab] = useState<'base' | 'archive' | 'history'>('base');
  
  // Data State
  const [fleetVehicles, setFleetVehicles] = useState<any[]>([]);
  const [bazaLegacy, setBazaLegacy] = useState<any[]>([]);
  const [bazaCarsLegacy, setBazaCarsLegacy] = useState<any[]>([]);
  const [vehicleDriverLegacy, setVehicleDriverLegacy] = useState<any[]>([]);
  const [archiveLegacy, setArchiveLegacy] = useState<any[]>([]);
  const bazaVehicles = useMemo(() => {
      // Учёт выезда = РУЧНОЙ журнал (baza + baza_cars) + archive + центр (vehicle_driver_data, для архива).
      const all = [...bazaLegacy, ...bazaCarsLegacy, ...archiveLegacy, ...vehicleDriverLegacy];
      const unique: any[] = [];
      const seen = new Set<string>();
      all.forEach(car => {
          const plate = normalizePlate(car.carNumber || car.vehicleNumbers || '');
          if (!seen.has(plate)) {
              seen.add(plate);
              unique.push(car);
          }
      });
      return unique;
  }, [bazaLegacy, bazaCarsLegacy, archiveLegacy, vehicleDriverLegacy]);

  const [globalHistory, setGlobalHistory] = useState<any[]>([]);
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);
  const [driversMap, setDriversMap] = useState<Record<string, string>>({});

  // РУЧНОЙ журнал (для "На базе"): baza + baza_cars (без archive/trip)
  const manualVehicles = useMemo(() => {
    const all = [...bazaLegacy, ...bazaCarsLegacy];
    // Дедупликация по госномеру: активная запись (не архив) имеет приоритет над архивной,
    // чтобы авто, добавленное в контроль, показывалось независимо от наличия его в архиве.
    const byPlate = new Map<string, any>();
    all.forEach(car => {
      const plate = normalizePlate(car.carNumber || car.vehicleNumbers || '');
      const isArchived = car.status === 'archive' || car.isArchived === true;
      const existing = byPlate.get(plate);
      if (!existing) {
        byPlate.set(plate, car);
      } else {
        const existingArchived = existing.status === 'archive' || existing.isArchived === true;
        // Заменяем только если текущая запись активная, а сохранённая — архивная
        if (existingArchived && !isArchived) byPlate.set(plate, car);
      }
    });
    return Array.from(byPlate.values());
  }, [bazaLegacy, bazaCarsLegacy]);

  const cars = useMemo(() => {
    const active = manualVehicles.filter(v => v.status !== 'archive');
    return active.map(rec => applySharedDriverToBazaRecord(applySharedCarToBazaRecord(rec, fleetVehicles), drivers));
  }, [manualVehicles, fleetVehicles, drivers]);

  // АРХИВ (выехавшие): ТОЛЬКО ручной журнал (baza archive + ветка archive).
  // Центр (vehicleFleet/vehicle_driver_data) не имеет дат журнала → не показываем (пустые).
  // НЕЗАВИСИМО от активных записей: авто может быть одновременно в архиве и на контроле.
  // ОДНА машина может иметь несколько id (разные добавления в контроль + зеркало archive/).
  // Дедуплицируем ПО ГОСНОМЕРУ, сохраняя самую свежую запись (по дате выезда/создания).
  const archiveCars = useMemo(() => {
    const all = [...bazaLegacy, ...bazaCarsLegacy, ...archiveLegacy, ...vehicleDriverLegacy];
    const archived = all.filter(v =>
      v.status === 'archive' ||
      v.sourcePath === 'archive' ||
      v.isArchived === true
    );
    // Дедупликация архивных записей по госномеру (baza-архив и ветка archive дублируют друг друга)
    const byPlate = new Map<string, any>();
    archived.forEach(car => {
      const plate = normalizePlate(car.carNumber || car.vehicleNumbers || '');
      if (!plate) { byPlate.set('__' + (car.id || Math.random()), car); return; }
      const existing = byPlate.get(plate);
      if (!existing) {
        byPlate.set(plate, car);
      } else {
        // При равенстве id (одна и та же машина) — выбираем активную (status !== 'archive')
        const existingArchived = existing.status === 'archive' || existing.isArchived === true;
        const curArchived = car.status === 'archive' || car.isArchived === true;
        if (existingArchived && !curArchived) byPlate.set(plate, car);
        else if (existingArchived === curArchived) {
          // обе архивные (или обе активные) — берём ту, у которой свежее dateDeparture или id (больше = новее)
          const dExisting = existing.dateDeparture || '';
          const dCur = car.dateDeparture || '';
          if (dCur > dExisting || (dCur === dExisting && String(car.id || '') > String(existing.id || ''))) {
            byPlate.set(plate, car);
          }
        }
      }
    });
    return Array.from(byPlate.values()).map(rec => applySharedDriverToBazaRecord(applySharedCarToBazaRecord(rec, fleetVehicles), drivers));
  }, [bazaLegacy, bazaCarsLegacy, archiveLegacy, vehicleDriverLegacy, fleetVehicles, drivers]);

  // Право на «Учёт выезда» нужно знать ДО подписок на данные: если права нет,
  // блок не читает защищённые данные (страховка к маршрутному гейту AppShell).
  // Механик — специальное правило портала: «Учёт выезда» доступен ему всегда.
  const earlyIsRoot = ratipaUser?.role === 'root_admin';
  const earlyIsMechanic = ratipaUser?.role === 'mechanic';
  const earlyBazaPerm = earlyIsRoot ? 'write' : resolvePermission(ratipaUser as any, 'baza', settings?.rolePermissions);
  const mayReadBaza = earlyIsRoot || earlyBazaPerm !== 'none' || earlyIsMechanic;

  // Local state
  const [selectedDispatcher, setSelectedDispatcher] = useState<string>("Все автомобили");
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; dir: "asc" | "desc" } | null>(null);
  const [isCarModalOpen, setIsCarModalOpen] = useState(false);
  const [archiveMonth, setArchiveMonth] = useState<string | null>(null);
  const [historyLimit, setHistoryLimit] = useState(100);
  
  // Form State
  const [formData, setFormData] = useState<Record<string, string>>({
    carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: ''
  });

  // Modal State
  const [modalData, setModalData] = useState<any>({});
  // Tracks which fields the user actually edited in the modal. Only touched fields
  // are written to the DB on save — this guarantees untouched dates/comment can NEVER
  // be wiped (e.g. when the car coupling is changed).
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const [bazaUndoStack, setBazaUndoStack] = useState<{ id: string; field: string; oldValue: any; rootBranch?: string }[]>([]);

  // Keyboard Navigation & Actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCarModalOpen(false);
      }

      // Ctrl + Z : Revert last change in the modal database updates
      if (e.ctrlKey && (e.key === 'z' || e.key === 'я' || e.key === 'Z')) {
        if (bazaUndoStack.length > 0) {
          e.preventDefault();
          const lastChange = bazaUndoStack[bazaUndoStack.length - 1];
          // Отмена — такая же запись в базу: без права на поле она не проходит.
          if (!canEditField(lastChange.field)) {
            toast('Нет права изменить это поле', 'error');
            return;
          }
          setBazaUndoStack(prev => prev.slice(0, -1));

          const rootBranch = lastChange.rootBranch || "vehicleFleet";
          const db = getDatabase(getApp());
          update(ref(db, `${rootBranch}/${lastChange.id}`), { [lastChange.field]: lastChange.oldValue }).then(() => {
            logHistory(lastChange.id, rootBranch, `${fieldLabels[lastChange.field as FieldType] || lastChange.field} (Отмена)`, "[Измененное]", lastChange.oldValue || "[Пусто]", modalData.carNumber || "Неизвестно");
            if (modalData && modalData.id === lastChange.id) {
              setModalData((prev: any) => ({ ...prev, [lastChange.field]: lastChange.oldValue }));
            }
          });
        }
      }
    };

    // Capture-фаза (true) — чтобы ESC срабатывал даже когда фокус в input/select внутри модалки
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isCarModalOpen, bazaUndoStack, currentTab, modalData, ratipaUser, settings]);

  // DB Sync for active fleet data, catalog & user listings
  useEffect(() => {
    if (!mayReadBaza) return;
    try {
      const db = getDatabase(getApp());
      const unsubs: any[] = [];
      
      // Load legacy "baza" records
      unsubs.push(onValue(ref(db, 'baza'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          isLegacyBaza: true,
          sourcePath: 'baza',
          status: data[key].status || 'base'
        }));
        setBazaLegacy(list);
      }));

      // Load legacy "baza_cars" records
      unsubs.push(onValue(ref(db, 'baza_cars'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          isLegacyBaza: true,
          sourcePath: 'baza_cars',
          status: data[key].status || 'base'
        }));
        setBazaCarsLegacy(list);
      }));

      // Load legacy "vehicle_driver_data" records
      unsubs.push(onValue(ref(db, 'vehicle_driver_data'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          isLegacyBaza: true,
          sourcePath: 'vehicle_driver_data',
          status: data[key].status || 'base'
        }));
        setVehicleDriverLegacy(list);
      }));

      // Load legacy "archive" records
      unsubs.push(onValue(ref(db, 'archive'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          sourcePath: 'archive',
          status: 'archive'
        }));
        setArchiveLegacy(prev => [...prev.filter(i => i.sourcePath !== 'archive'), ...list]);
      }));

      // Load legacy "archivecars" records
      unsubs.push(onValue(ref(db, 'archivecars'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(key => ({
          id: key,
          ...data[key],
          sourcePath: 'archivecars',
          status: 'archive'
        }));
        setArchiveLegacy(prev => [...prev.filter(i => i.sourcePath !== 'archivecars'), ...list]);
      }));

      unsubs.push(dbService.getVehicles(list => {
        setFleetVehicles(list.map(l => ({...l, sourcePath: 'vehicleFleet'})));
      }));

      unsubs.push(onValue(ref(db, 'known_fleet'), snap => {
        const data = snap.val() || {};
        setKnownFleet(Object.values(data));
      }));

      // Highly-optimized pooled drivers catalog loading
      unsubs.push(dbService.getDrivers(setDrivers));
    unsubs.push(pdService.subscribeDriversCarMapping((m) => setDriversMap(m)));

      unsubs.push(onValue(ref(db, 'users_list'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setSystemUsers(list);
      }));

      return () => {
        unsubs.forEach(u => u());
      };
    } catch(e) {
      console.warn("DB Error", e);
    }
  }, []);

  // Lazy-load extremely heavy history branch only when the user selects the 'history' tab
  useEffect(() => {
    if (currentTab !== 'history') {
      return;
    }
    try {
      const db = getDatabase(getApp());
      const unsub = onValue(query(ref(db, 'global_history'), limitToLast(100)), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setGlobalHistory(list);
      });
      return unsub;
    } catch (e) {
      console.warn("DB Error", e);
    }
  }, [currentTab]);

  // Auth mapping: figure out our internal role & perms based on users_list mapped to ratipaUser.name
  const matchedUser = systemUsers.find(u => String(u.name || '').toLowerCase() === String(ratipaUser?.name || '').toLowerCase() || u.uid === ratipaUser?.uid || u.id === ratipaUser?.uid) || {
    name: ratipaUser.name,
    role: ratipaUser.role === 'root_admin' ? 'Диспетчер' : 'Механик',
    permissions: {},
    isRootAdmin: ratipaUser.role === 'root_admin'
  };

  // Root — только по роли. Имя в проверке было обходом (появлялось у любого «Сергея»);
  // запись справочника может не нести флаг isRootAdmin, поэтому роль читаем из профиля.
  const isRootAdmin = ratipaUser.role === 'root_admin' || matchedUser.isRootAdmin === true;
  // Используем resolvePermission для проверки доступа к модулю baza
  const bazaPerm = resolvePermission(ratipaUser, 'baza', settings?.rolePermissions);
  const canWriteBaza = isRootAdmin || bazaPerm === 'write';
  const canReadBaza = isRootAdmin || bazaPerm !== 'none';

  const currentUserRole = matchedUser.role;
  const currentUserPermissions = matchedUser.permissions || {};

  // Маппинг fieldName → permissionKey для полей БД
  const FIELD_TO_PERM_KEY: Record<string, string> = {
    carNumber: 'baza_carNumber',
    driverName: 'baza_driverName',
    dateArrival: 'baza_dateArrival',
    dateLoading: 'baza_dateLoading',
    dateRepairStart: 'baza_dateRepairStart',
    dateRepairEnd: 'baza_dateRepairEnd',
    dateDeparture: 'baza_dateDeparture',
    comment: 'baza_comment',
  };

  const canEditField = (fieldName: string) => {
     if (isRootAdmin) return true;
     const permKey = FIELD_TO_PERM_KEY[fieldName];
     // 1. Явное переопределение поля (permissions > customPermissions).
     //    none/read → поле НЕ редактируемо, даже если модуль baza: write
     if (permKey) {
       const own = ratipaUser.permissions?.[permKey];
       const ownCustom = ratipaUser.customPermissions?.[permKey];
       const direct = ownCustom !== undefined && ownCustom !== 'inherit' ? ownCustom : (own !== undefined && own !== 'inherit' ? own : null);
       if (direct) return direct === 'write';
     }
     // 2. Право на весь модуль baza (роль)
     if (canWriteBaza) return true;
     // 3. Fallback: старая система per-field permissions (boolean true)
     return currentUserPermissions[fieldName] === true;
  };

  const isMechanic = currentUserRole === 'Механик';

  // --- Logic Helpers ---
  const calculateCarStatus = (car: any) => {
      const todayStr = new Date().toISOString().split('T')[0];
      if (car.dateDeparture && car.dateDeparture <= todayStr) {
          return { code: 'transit', text: 'В рейсе' };
      }
      if (car.dateRepairStart) {
          if (!car.dateRepairEnd || todayStr < car.dateRepairEnd) {
              if (todayStr >= car.dateRepairStart) {
                  return { code: 'repair', text: 'В ремонте' };
              }
          }
      }
      if (car.dateRepairEnd && todayStr >= car.dateRepairEnd) {
          if (!car.dateDeparture || car.dateDeparture > todayStr) {
              return { code: 'ready', text: 'Готов к рейсу' };
          }
      }
      return { code: 'base', text: 'На базе' };
  };

  const getDaysBetween = (date1: string, date2: string) => {
      if (!date1 || !date2) return "—";
      const d1 = new Date(date1).getTime();
      const d2 = new Date(date2).getTime();
      if (isNaN(d1) || isNaN(d2)) return "—";
      const diffDays = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
      return diffDays >= 0 ? `${diffDays} дн.` : "—";
  };

  const logHistory = async (carId: string, rootBranch: string, fieldLabel: string, was: string, became: string, carNum: string) => {
      const db = getDatabase(getApp());
      const now = new Date();
      const timestampStr = now.toLocaleDateString("ru-RU").replace(/\./g, '/') + " " + now.toLocaleTimeString("ru-RU", {hour: '2-digit', minute:'2-digit'});
      
      const eventData = {
          date: timestampStr, 
          user: `${matchedUser.name} (${matchedUser.role})`, 
          field: fieldLabel, 
          old: was || "[Пусто]", 
          new: became || "[Пусто]"
      };
      
      push(ref(db, `${rootBranch}/${carId}/history`), eventData);
      push(ref(db, `global_history`), {
          ...eventData,
          carNumber: carNum || "Неизвестно",
          actionType: fieldLabel === "Запись создана" ? "create" : (became === "[Запись стерта]" ? "delete" : "update")
      });
  };

  // --- Actions ---
  // Ошибки полей формы добавления: показываются рядом с полем, ввод не очищается
  const [formErrors, setFormErrors] = useState<{ carNumber?: string }>({});

  const handleFormChange = (e: any, field: string) => {
    const val = e.target.value;
    const updates: any = { [field]: val };
    
    // Учёт выезда = ручной ввод. Автоматически из базы НИЧЕГО не подцепляется
    // при наборе текста. Машина выбирается вручную через CouplingPicker (выпадающий
    // список базы) — это сознательный выбор, не авто-подстановка.
    if (field === 'carNumber') {
      updates[field] = val.toUpperCase();
    }
    setFormData({...formData, ...updates});
  };

  const handleAddNewCar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canEditField('carNumber')) {
      toast("У вас нет прав на добавление автомобилей!", 'error'); return;
    }
    const db = getDatabase(getApp());
    const cNum = formData.carNumber.trim().toUpperCase();
    if (!cNum) {
      // Раньше отправка прерывалась молча — теперь причина видна у самого поля,
      // введённые данные сохраняются.
      setFormErrors({ carNumber: 'Укажите автомобиль: выберите его из справочника' });
      return;
    }
    setFormErrors({});

    if (!knownFleet.includes(cNum)) {
      push(ref(db, 'known_fleet'), cNum);
    }

    const trimmedDriver = formData.driverName.trim();
    let driverId = '';
    let driverShortNameRu = '';
    let migrationStatus = 'unmatched';

    if (trimmedDriver) {
      const existingDriver = drivers.find(d => 
        d.name.trim().toLowerCase() === trimmedDriver.toLowerCase() ||
        (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === trimmedDriver.toLowerCase())
      );
      if (!existingDriver) {
        const parts = trimmedDriver.split(/\s+/);
          const last = parts[0] || '';
          const first = parts[1] || '';
          const middle = parts[2] || '';
          const computedShort = formatDriverShortName(last, first, middle);

          const newDriverId = "dr_" + Date.now();
          const newDriver = {
            id: newDriverId,
            name: trimmedDriver,
            lastNameRu: last,
            firstNameRu: first,
            middleNameRu: middle,
            shortNameRu: computedShort || trimmedDriver,
          };
          dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
          toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
          
          driverId = newDriverId;
          driverShortNameRu = newDriver.shortNameRu;
          migrationStatus = 'matched';
      } else {
        driverId = existingDriver.id;
        driverShortNameRu = existingDriver.shortNameRu || formatDriverShortName(existingDriver);
        migrationStatus = 'matched';
      }
    }

    // Write to 'baza' (manual Учёт выезда journal). Center (vehicleFleet) is NOT
    // modified — it's the reference base, selected via CouplingPicker. If the car was
    // picked from the center, keep its center id as couplingId for traceability.
    const newRef = push(ref(db, 'baza'));
    // carNumber may be a full coupling "TRACTOR / TRAILER" — use only tractor part for center match
    const tractorPlate = cNum.split(' / ')[0].trim();
    const normPlate = tractorPlate.replace(/[^А-ЯA-Z0-9]/g, '');
    const masterCar = fleetVehicles.find(c => (c.carNumber || c.vehicleNumbers || '').replace(/[^А-ЯA-Z0-9]/g, '') === normPlate);
    const couplingId = masterCar ? masterCar.id : null;

    // Пишем только разрешённые поля: если право на поле отозвано в открытой сессии,
    // уже введённое значение не уедет в базу (проверка на записи, не только в форме).
    const allowedForm: Record<string, string> = {};
    for (const f of ['dateArrival', 'dateLoading', 'dateRepairStart', 'dateRepairEnd', 'dateDeparture', 'comment']) {
      if (canEditField(f)) allowedForm[f] = formData[f] || '';
    }
    if (canEditField('driverName')) allowedForm.driverName = formData.driverName || '';

    const carData = {
      carId: newRef.key,
      couplingId: couplingId,
      ...allowedForm,
      carNumber: cNum,
      driverName: driverShortNameRu || trimmedDriver,
      driverId: driverId || null,
      driverRaw: trimmedDriver,
      driverShortNameRu: driverShortNameRu || null,
      migrationStatus,
      status: 'base'
    };
    set(newRef, carData).then(() => {
       logHistory(newRef.key as string, "baza", "Запись создана", "", `Госномер: ${cNum}`, cNum);
       // Auto-status: car now appears in Учёт выезда → it's on base.
       if (couplingId) {
         dbService.setVehicleStatus(couplingId, 'base');
         set(ref(db, `vehicleFleet/${couplingId}/status`), 'base').catch((err) => {
              console.warn('[Baza] set vehicleFleet status=base failed:', err);
            });
       }
       setFormData({ carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: '' });
    });
  };

  const openCarModal = (car: any) => {
    // Подтянуть ПОЛНУЮ сцепку (тягач / прицеп) именно из единой базы сцепок (vehicleFleet / fleetVehicles).
    const tractor = normalizePlate(car.carNumber);
    const findIn = (src: any[]) => (src || []).find(c =>
      normalizePlate(c.vehicleNumbers || c.carNumber) === tractor ||
      normalizePlate(c.carNumber) === tractor
    );
    const coupling = findIn(fleetVehicles || []) || findIn(vehicleDriverLegacy);
    const fullCoupling = coupling
      ? [coupling.vehicleNumbers || coupling.carNumber, coupling.trailerNumber || coupling.trailerPlate]
          .filter(Boolean).join(' / ')
      : car.carNumber;
    const fullNameRu = resolveDriverName(car) || car.driverName || car.driverNameRu || '';
    setModalData({ ...car, carNumber: fullCoupling, driverName: fullNameRu, driverNameRu: car.driverNameRu || (coupling && coupling.driverNameRu) || '' });
    setTouchedFields({});
    setIsCarModalOpen(true);
  };

  const updateCarField = async (id: string, field: string, newValue: string) => {
      // Та же проверка, что и у формы (canEditField): модуль, переопределения полей
      // и старая per-field модель — единый порядок, без второго списка разрешений.
      if (!canEditField(field)) {
          toast("Действие отклонено: У вас нет прав на редактирование этого поля!", 'error');
          return;
      }
      
      const sourceList = [...cars, ...archiveCars];
      const targetCar = sourceList.find(c => c.id === id);
      
      if (!targetCar) return;
      const rootBranch = targetCar.isLegacyBaza ? "baza" : "vehicleFleet";
      
      let oldValue = targetCar[field] || "";
      let val = newValue;
      if (field === 'carNumber') val = val.toUpperCase();
      if (oldValue === val) return;

      let extraUpdates: any = {};
      if (field === 'driverName' && val.trim() !== '') {
        const trimmedDriver = val.trim();
        let driverId = '';
        let driverShortNameRu = '';
        let migrationStatus = 'unmatched';

        const existingDriver = drivers.find(d => 
          d.name.trim().toLowerCase() === trimmedDriver.toLowerCase() ||
          (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === trimmedDriver.toLowerCase())
        );

        if (!existingDriver) {
          const parts = trimmedDriver.split(/\s+/);
            const last = parts[0] || '';
            const first = parts[1] || '';
            const middle = parts[2] || '';
            const computedShort = formatDriverShortName(last, first, middle);

            const newDriverId = "dr_" + Date.now();
            const newDriver = {
              id: newDriverId,
              name: trimmedDriver,
              lastNameRu: last,
              firstNameRu: first,
              middleNameRu: middle,
              shortNameRu: computedShort || trimmedDriver,
            };
            dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
            toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');

            driverId = newDriverId;
            driverShortNameRu = newDriver.shortNameRu;
            migrationStatus = 'matched';
        } else {
          driverId = existingDriver.id;
          driverShortNameRu = existingDriver.shortNameRu || formatDriverShortName(existingDriver);
          migrationStatus = 'matched';
        }

        extraUpdates = {
          driverId: driverId || null,
          driverRaw: trimmedDriver,
          driverShortNameRu: driverShortNameRu || null,
          migrationStatus
        };
        // Keep the displayed driver name as typed/picked (preserve full initials); pool link is stored in driverShortNameRu below
      }

      // Track change for Undo logic
      setBazaUndoStack(prev => [...prev, { id, field, oldValue, rootBranch }]);

      const db = getDatabase(getApp());
      const updates: any = { [field]: val, ...extraUpdates };
      
      update(ref(db, `${rootBranch}/${id}`), updates).then(() => {
         logHistory(id, rootBranch, fieldLabels[field as FieldType] || field, oldValue, val, targetCar.carNumber || "Неизвестно");
         // Optimistically update modalData
         setModalData((prev: any) => {
           return { ...prev, [field]: val, ...extraUpdates };
         });
      });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const saveCarModal = async () => {
    if (!modalData) return;
    const id = modalData.id;
    if (!id) return;

    const sourceList = [...cars, ...archiveCars];
    const targetCar = sourceList.find(c => c.id === id);
    if (!targetCar) return;
    // Write back to the SAME branch the record came from (baza / baza_cars / vehicle_driver_data),
    // never to 'baza' for a record whose real id lives in another branch — that creates a stray/empty card.
    const rootBranch = targetCar.sourcePath || 'baza';
    const db = getDatabase(getApp());

    const fields: string[] = ['carNumber', 'driverName', 'dateArrival', 'dateLoading', 'dateRepairStart', 'dateRepairEnd', 'dateDeparture', 'comment'];
    const updates: any = {};
    const historyEntries: { field: string; old: string; val: string }[] = [];

    for (const field of fields) {
      // Only write fields the user actually edited. Untouched date/comment fields are NEVER
      // written, so changing the car coupling can never wipe existing dates.
      if (!touchedFields[field]) continue;
      if (!canEditField(field)) continue;
      let oldValue = targetCar[field] || '';
      let val = modalData[field] || '';
      if (field === 'carNumber') val = val.toUpperCase();
      if (oldValue === val) continue;

      if (field === 'driverName' && val.trim() !== '') {
        const trimmedDriver = val.trim();
        let driverId = '';
        let driverShortNameRu = '';
        let migrationStatus = 'unmatched';
        const existingDriver = drivers.find(d =>
          d.name.trim().toLowerCase() === trimmedDriver.toLowerCase() ||
          (d.shortNameRu && d.shortNameRu.trim().toLowerCase() === trimmedDriver.toLowerCase())
        );
        if (!existingDriver) {
          const parts = trimmedDriver.split(/\s+/);
            const last = parts[0] || '';
            const first = parts[1] || '';
            const middle = parts[2] || '';
            const computedShort = formatDriverShortName(last, first, middle);
            const newDriverId = 'dr_' + Date.now();
            const newDriver = {
              id: newDriverId,
              name: trimmedDriver,
              lastNameRu: last,
              firstNameRu: first,
              middleNameRu: middle,
              shortNameRu: computedShort || trimmedDriver,
            };
            dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
            toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
            driverId = newDriverId;
            driverShortNameRu = newDriver.shortNameRu;
            migrationStatus = 'matched';
        } else {
          driverId = existingDriver.id;
          driverShortNameRu = existingDriver.shortNameRu || formatDriverShortName(existingDriver);
          migrationStatus = 'matched';
        }
        updates.driverId = driverId || null;
        updates.driverRaw = trimmedDriver;
        updates.driverShortNameRu = driverShortNameRu || null;
        updates.migrationStatus = migrationStatus;
        // Keep the displayed driver name as typed/picked (preserve full initials); pool link is stored in driverShortNameRu above
      }

      updates[field] = val;
      historyEntries.push({ field, old: oldValue, val });
      setBazaUndoStack(prev => [...prev, { id, field, oldValue, rootBranch }]);
    }

    // Full driver name from CouplingPicker (kept separate so it isn't truncated to initials)
    if (modalData.driverNameRu && modalData.driverNameRu !== (targetCar.driverNameRu || '')) {
      updates.driverNameRu = modalData.driverNameRu;
    }

    if (Object.keys(updates).length === 0) {
      toast('Нет изменений для сохранения', 'info');
      return;
    }

    await update(ref(db, `${rootBranch}/${id}`), updates);
    const carNum = modalData.carNumber || targetCar.carNumber || 'Неизвестно';
    for (const h of historyEntries) {
      await logHistory(id, rootBranch, fieldLabels[h.field as FieldType] || h.field, h.old, h.val, carNum);
    }
    toast('Изменения сохранены', 'success');
    setIsCarModalOpen(false);
  };

  const moveCarToArchive = async () => {
      if (isMechanic || !canWriteBaza || !modalData) return;
      if (!(await showConfirm(`Отправить автомобиль [${modalData.carNumber}] в рейс?\nЗапись переместится во вкладку Архив.`))) return;

      const db = getDatabase(getApp());
      const nowStr = new Date().toISOString().split('T')[0];
      const updatedDeparture = modalData.dateDeparture || nowStr;

      // Use the RAW record from the manual journal (bazaLegacy) — NOT the display-merged `cars`,
      // whose carNumber is overwritten by the coupling's vehicleNumbers. Writing back the merged
      // number would corrupt the plate and make dates/counters "drift".
      const rec = (bazaLegacy || []).find(c => c.id === modalData.id)
        || (bazaCarsLegacy || []).find(c => c.id === modalData.id)
        || (cars.find(c => c.id === modalData.id) || modalData) as any;

      const archiveCarData = {
          ...rec,
          dateDeparture: updatedDeparture,
          status: 'archive',
          isArchived: true
      };

      // Manual journal branch where the record actually lives
      const srcPath = (rec.sourcePath === 'baza_cars' || rec.sourcePath === 'baza') ? rec.sourcePath : 'baza';

      const writes: Record<string, any> = {};
      // 1) Mark the original manual-journal record as archived in place
      writes[`${srcPath}/${rec.id}`] = archiveCarData;
      // 2) Mirror into the dedicated 'archive' branch so the Archive tab always sees it
      writes[`archive/${rec.id}`] = { ...archiveCarData, sourcePath: 'archive' };

      // 3) Remove any STALE archive copies of the SAME plate (created by previous transfers with a different id)
      //    — предотвращаем дубликаты в архиве при повторном переносе.
      const normPlate = normalizePlate(archiveCarData.carNumber || '');
      if (normPlate) {
        const drops: any[] = [];
        // baza-archive copies (status archive, другой id)
        (bazaLegacy || []).forEach(c => {
          if (c.id !== rec.id && normalizePlate(c.carNumber || '') === normPlate && (c.status === 'archive' || c.isArchived)) {
            drops.push(`${srcPath}/${c.id}`);
            drops.push(`archive/${c.id}`);
          }
        });
        (archiveLegacy || []).forEach(c => {
          if (c.id !== rec.id && normalizePlate(c.carNumber || '') === normPlate) {
            drops.push(`archive/${c.id}`);
          }
        });
        drops.forEach(p => { writes[p] = null; });
      }

      update(ref(db), writes).then(() => {
          logHistory(rec.id, srcPath, "Статус", "На базе", "Выехал в рейс (Перенесено в архив)", rec.carNumber);
          setIsCarModalOpen(false);
          toast("Автомобиль перемещён в Архив", 'success');
      }).catch(err => {
          console.error('[Archive] moveCarToArchive FAILED', err);
          toast("Ошибка при перемещении в архив: " + (err?.message || err), 'error');
      });
  };

  const deleteCarRecord = async (id: string, carNumber: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (currentTab === "archive" && !isRootAdmin) {
          toast("Удаление записей из архива разрешено только администратору!", 'error');
          return;
      }
      if (isMechanic) return;
      // Удаление — операция записи: без права записи в раздел она недоступна,
      // даже если кнопка как-то активирована в обход интерфейса.
      if (!canWriteBaza) {
          toast("Действие отклонено: у вас нет прав на удаление записей", 'error');
          return;
      }

      if (await showConfirm(`Вы уверены, что хотите окончательно удалить запись автомобиля ${carNumber}?`)) {
          const db = getDatabase(getApp());
          const sourceList = [...cars, ...archiveCars];
          const targetCar = sourceList.find(c => c.id === id);
          const branch = targetCar?.sourcePath || 'baza';
          // Архивная запись живёт сразу в нескольких ветках (baza archive + archive/ + baza_cars).
          // Удаляем ВСЕ копии по id и по госномеру, иначе запись «возвращается» из зеркала.
          const pathsToRemove: string[] = [];
          const normPlate = normalizePlate(carNumber || '');
          const consider = [...bazaLegacy, ...bazaCarsLegacy, ...archiveLegacy, ...vehicleDriverLegacy];
          const addByPlate = (src: string) => consider.forEach(c => {
            if (c.id === id || (normPlate && normalizePlate(c.carNumber || '') === normPlate && (c.status === 'archive' || c.isArchived || c.sourcePath === 'archive'))) {
              pathsToRemove.push(`${src}/${c.id}`);
            }
          });
          addByPlate(branch);
          addByPlate('archive');
          addByPlate('baza');
          addByPlate('baza_cars');
          // Убираем дубли путей
          const uniquePaths = Array.from(new Set(pathsToRemove));
          const removeUpdates: Record<string, any> = {};
          uniquePaths.forEach(p => { removeUpdates[p] = null; });
          await update(ref(db), removeUpdates);

          // Auto-status: if this car is no longer in Учёт выезда → it's in trip.
          const cid = targetCar?.couplingId
            || (fleetVehicles.find(c => (c.carNumber || c.vehicleNumbers || '').replace(/[^А-ЯA-Z0-9]/g, '') === (carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '')) || {}).id;
          if (cid) {
            const stillInBaza = cars.some(c => c.id !== id && (c.couplingId === cid || (c.carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '') === (carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '')));
            if (!stillInBaza) {
              dbService.setVehicleStatus(cid, 'trip');
              set(ref(db, `vehicleFleet/${cid}/status`), 'trip').catch((err) => {
                    console.warn('[Baza] set vehicleFleet status=trip failed:', err);
                  });
            }
          }

          const timestampStr = new Date().toLocaleDateString("ru-RU").replace(/\./g, '/') + " " + new Date().toLocaleTimeString("ru-RU", {hour: '2-digit', minute:'2-digit'});
          push(ref(db, `global_history`), {
              date: timestampStr,
              user: `${matchedUser.name} (${matchedUser.role})`,
              field: "Удаление карточки ТС",
              old: `Удалена запись из раздела: ${currentTab === 'base' ? 'На базе' : 'Архив'}`,
              new: "[Запись стерта]",
              carNumber: carNumber || "Неизвестно",
              actionType: "delete"
          });
      }
  };

  const couplingByPlate = useMemo(() => {
    const m = new Map<string, any>();
    const add = (src: any[]) => (src || []).forEach(c => {
      const keys = [c.vehicleNumbers || c.carNumber, c.carNumber].filter(Boolean).map(normalizePlate);
      keys.forEach(k => { if (k && !m.has(k)) m.set(k, c); });
    });
    add(fleetVehicles);
    add(vehicleDriverLegacy);
    return m;
  }, [fleetVehicles, vehicleDriverLegacy]);

  const resolveDriverName = (car: any) => {
    const tractor = normalizePlate((car.carNumber || '').split('/')[0]);
    const coupling = couplingByPlate.get(tractor);
    // Водитель берётся из сцепки, но если там его нет — откат к данным самой записи,
    // иначе ячейка «Водитель» оставалась пустой (напр. «Суша»).
    const fromCoupling = coupling ? (coupling.driverNameRu || coupling.driverName) : '';
    const full = fromCoupling || car.driverNameRu || car.driverName || car.driverShortNameRu || '';
    return formatDriverShortName(full || '');
  };

  const filteredList = useMemo(() => {
     return (currentTab === 'base' ? cars : archiveCars).filter(c => {
        // Dispatcher filtering
        if (selectedDispatcher !== "Все автомобили") {
          const disp = (c.dispatcherName || c.dispatcher || "").trim().toLowerCase();
          if (disp !== selectedDispatcher.toLowerCase()) return false;
        }

        const q = searchQuery.toLowerCase();
        if (q && !(String(c.carNumber||'').toLowerCase().includes(q) || String(c.driverName||'').toLowerCase().includes(q) || String(c.comment||'').toLowerCase().includes(q))) return false;
        // Archive month filter
        if (currentTab === 'archive' && archiveMonth !== null) {
          const m = c.dateDeparture ? c.dateDeparture.substring(0, 7) : 'Без даты';
          if (m !== archiveMonth) return false;
        }
        return true;
     }).map(c => ({...c, _status: calculateCarStatus(c), displayDriver: resolveDriverName(c)})).sort((a,b) => {
        if (sortConfig) {
          const { key, dir } = sortConfig;
          let valA: string, valB: string;
          if (key === 'carNumber') { valA = a.carNumber||''; valB = b.carNumber||''; }
          else if (key === 'driverName') { valA = a.displayDriver||''; valB = b.displayDriver||''; }
          else if (key === 'dateArrival') { valA = a.dateArrival||''; valB = b.dateArrival||''; }
          else if (key === 'dateLoading') { valA = a.dateLoading||''; valB = b.dateLoading||''; }
          else if (key === 'dateRepairStart') { valA = a.dateRepairStart||''; valB = b.dateRepairStart||''; }
          else if (key === 'dateRepairEnd') { valA = a.dateRepairEnd||''; valB = b.dateRepairEnd||''; }
          else if (key === 'dateDeparture') { valA = a.dateDeparture||''; valB = b.dateDeparture||''; }
          else { valA = a.carNumber||''; valB = b.carNumber||''; }
          const cmp = valA.localeCompare(valB);
          return dir === 'asc' ? cmp : -cmp;
        }
        // default smart sort
        if (currentTab === 'archive') {
            return (b.dateDeparture||'0000').localeCompare(a.dateDeparture||'0000');
        }
        return (b.dateArrival||'0000').localeCompare(a.dateArrival||'0000');
     });
  }, [currentTab, cars, archiveCars, searchQuery, sortConfig, archiveMonth]);

  // Ленивая подгрузка списка (Учёт выезда): порция + «Показать ещё»,
  // чтобы не рендерить сразу все записи (тормоза при большом объёме).
  const BAZA_PAGE_SIZE = 50;
  const [visibleBazaCount, setVisibleBazaCount] = useState(BAZA_PAGE_SIZE);
  useEffect(() => {
    setVisibleBazaCount(BAZA_PAGE_SIZE);
    if (currentTab !== 'archive') setArchiveMonth(null);
  }, [currentTab, searchQuery, sortConfig]);
  const visibleList = filteredList.slice(0, visibleBazaCount);
  const hasMoreBaza = visibleBazaCount < filteredList.length;

  const dispatcherList = useMemo(() => {
     const set = new Set<string>();
     systemUsers.forEach(u => {
        if (u.role === 'Диспетчер' && u.name) {
           set.add(u.name);
        }
     });
     cars.forEach(c => {
        const d = (c.dispatcherName || c.dispatcher || "").trim();
        if (d) set.add(d);
     });
     archiveCars.forEach(c => {
        const d = (c.dispatcherName || c.dispatcher || "").trim();
        if (d) set.add(d);
     });
     return Array.from(set).filter(Boolean).sort();
  }, [systemUsers, cars, archiveCars]);

  const handleSort = (key: string) => {
    setSortConfig(prev => {
      if (!prev || prev.key !== key) return { key, dir: "asc" };
      if (prev.dir === "asc") return { key, dir: "desc" };
      return null; // 3rd click → default (no sort)
    });
  };

  const renderSortIndicator = (sortKey: string) => {
    if (sortConfig?.key !== sortKey) return null;
    return sortConfig.dir === 'asc'
      ? <ArrowUp className="w-3 h-3 inline-block ml-0.5 -mt-px text-[#6B7280]" aria-hidden="true" />
      : <ArrowDown className="w-3 h-3 inline-block ml-0.5 -mt-px text-[#6B7280]" aria-hidden="true" />;
  };

  const wTotal = useMemo(() => {
     return cars.filter(c => ['base','repair','ready'].includes(calculateCarStatus(c).code)).length;
  }, [cars]);

  const wRepair = useMemo(() => {
     return cars.filter(c => calculateCarStatus(c).code === 'repair').length;
  }, [cars]);

  const wReady = useMemo(() => {
     return cars.filter(c => calculateCarStatus(c).code === 'ready').length;
  }, [cars]);

  // Статус — точка + текст; цвета состояний собраны в одной таблице.
  const STATUS_DOT_COLOR: Record<string, 'accent' | 'amber' | 'emerald' | 'grey'> = {
    transit: 'accent',
    repair: 'amber',
    ready: 'emerald',
    base: 'grey',
  };

  const getStatusBadge = (code: string, text: string) => (
    <StatusText color={STATUS_DOT_COLOR[code] || 'grey'}>{text}</StatusText>
  );

  const tabsList: { key: 'base' | 'archive' | 'history'; label: string; count?: number }[] = [
    { key: 'base', label: 'На базе', count: cars.length > 0 ? cars.length : undefined },
    { key: 'archive', label: 'Архив', count: archiveCars.length > 0 ? archiveCars.length : undefined },
    { key: 'history', label: 'История', count: globalHistory.length > 0 ? globalHistory.length : undefined },
  ];

  // Права нет вовсе: показываем аккуратный экран вместо содержимого блока.
  // Данные не читаются (подписки выше не запускаются), уйти можно в доступный раздел.
  if (!mayReadBaza) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center px-4">
        <div className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 text-center shadow-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[#F3F4F6]">
            <Lock size={20} className="text-[#6B7280]" aria-hidden="true" />
          </div>
          <h2 className="text-lg font-bold text-[#121316]">Нет доступа</h2>
          <p className="mt-1 text-sm text-[#6B7280]">
            Раздел «Учёт выезда» недоступен для вашей роли. Если доступ нужен — обратитесь к администратору.
          </p>
          <button
            onClick={() => { window.location.hash = '#dashboard'; }}
            className={`${UI.buttonPrimary} mt-5 w-full`}
          >
            Перейти на главную
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <ModuleShell
        title="Учёт выезда"
        tabs={tabsList}
        activeTab={currentTab}
        onTabChange={(key) => setCurrentTab(key as 'base' | 'archive' | 'history')}
        tabsAriaLabel="Вкладки модуля учёта выезда"
      >
        {/* Сводные показатели — строкой: точка, подпись, моно-значение */}
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pb-4 border-b border-[#E5E7EB]">
          <span className="inline-flex items-center gap-2">
            <StatusText color="grey">Всего на базе ТС</StatusText>
            <span className="text-sm font-semibold font-mono tabular-nums text-[#121316]">{wTotal}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <StatusText color="amber">В ремонте ТС</StatusText>
            <span className="text-sm font-semibold font-mono tabular-nums text-[#121316]">{wRepair}</span>
          </span>
          <span className="inline-flex items-center gap-2">
            <StatusText color="emerald">Готовы к рейсу ТС</StatusText>
            <span className="text-sm font-semibold font-mono tabular-nums text-[#121316]">{wReady}</span>
          </span>
        </div>

        {/* Вкладка «На базе»: добавление автомобиля */}
        <div className={currentTab === 'base' ? '' : 'hidden'}>
          <div className="pt-5">
            <SectionHeader
              icon={<Plus className="w-4 h-4" aria-hidden="true" />}
              title="Добавить новый автомобиль"
            />
            <form onSubmit={handleAddNewCar} noValidate className="flex flex-col gap-6 pt-4">
              {/* Автомобиль и водитель */}
              <section className="flex flex-col gap-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Автомобиль и водитель</h4>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <label className={UI.fieldLabel} htmlFor="form-car-picker">
                      Автомобиль <span className="text-[var(--accent-ink)]">*</span>
                    </label>
                    <div id="form-car-picker">
                      <CouplingPicker
                        mode="combined"
                        value={formData.carNumber}
                        onSelect={(rec) => {
                          if (!rec) {
                            // Очистка выбора: машина и заполненные из сцепки поля
                            setFormData((f) => ({ ...f, carNumber: '', driverName: '', driverPhone: '' }));
                            return;
                          }
                          const cNum = [(rec.carNumber || rec.vehicleNumbers || '').toUpperCase(), (rec.trailerNumber || '').toUpperCase()]
                            .filter(Boolean).join(' / ');
                          const updates: any = { carNumber: cNum };
                          if (rec.driverName) updates.driverName = rec.driverName;
                          if (rec.driverPhone) updates.driverPhone = rec.driverPhone;
                          setFormData((f) => ({ ...f, ...updates }));
                          if (formErrors.carNumber) setFormErrors({});
                        }}
                      />
                    </div>
                    {formErrors.carNumber && (
                      <span className="flex items-center gap-1.5 text-[11px] text-rose-600">
                        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {formErrors.carNumber}
                      </span>
                    )}
                    <span className={UI.hint}>Выбор из справочника сцепок: тягач и прицеп подставятся вместе с водителем.</span>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <label className={UI.fieldLabel} htmlFor="form-add-driver">ФИО водителя</label>
                    <input
                      id="form-add-driver"
                      type="text"
                      value={formData.driverName || ''}
                      onChange={(e) => setFormData((f) => ({ ...f, driverName: e.target.value }))}
                      className={UI.input}
                      placeholder="Фамилия Имя Отчество"
                    />
                    <span className={UI.hint}>Заполняется из сцепки. Если поправить — запись появится в базе водителей.</span>
                  </div>
                </div>
              </section>

              {/* Даты: порядок — от прибытия к выезду, как идёт работа машины */}
              <section className="flex flex-col gap-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Даты</h4>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  <BazaDateField
                    id="dateArrival"
                    label="Прибыл на базу"
                    value={formData.dateArrival}
                    disabled={!canEditField('dateArrival')}
                    onChange={(e) => handleFormChange(e, 'dateArrival')}
                  />
                  <BazaDateField
                    id="dateLoading"
                    label="Срок готовности"
                    value={formData.dateLoading}
                    disabled={!canEditField('dateLoading')}
                    onChange={(e) => handleFormChange(e, 'dateLoading')}
                  />
                  <BazaDateField
                    id="dateRepairStart"
                    label="Заявка на ремонт"
                    value={formData.dateRepairStart}
                    disabled={!canEditField('dateRepairStart')}
                    onChange={(e) => handleFormChange(e, 'dateRepairStart')}
                  />
                  <BazaDateField
                    id="dateRepairEnd"
                    label="Завершение ремонта"
                    value={formData.dateRepairEnd}
                    disabled={!canEditField('dateRepairEnd')}
                    onChange={(e) => handleFormChange(e, 'dateRepairEnd')}
                  />
                  <BazaDateField
                    id="dateDeparture"
                    label="Фактический выезд"
                    value={formData.dateDeparture}
                    disabled={!canEditField('dateDeparture')}
                    onChange={(e) => handleFormChange(e, 'dateDeparture')}
                  />
                </div>
                <span className={UI.hint}>
                  Даты в формате ДД/ММ/ГГГГ. Календарь открывается нажатием на поле или по значку справа.
                </span>
              </section>

              {/* Примечание */}
              <section className="flex flex-col gap-3">
                <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">Примечание</h4>
                <input
                  id="form-add-comment"
                  disabled={!canEditField('comment')}
                  value={formData.comment}
                  onChange={e => handleFormChange(e, 'comment')}
                  className={UI.input}
                  placeholder="Что важно знать по машине — необязательно"
                  aria-label="Примечание"
                />
              </section>

              {/* Действие */}
              <div className="flex flex-col gap-2 border-t border-[#E5E7EB] pt-4 sm:flex-row sm:items-center sm:justify-between">
                <span className={UI.hint}>Поля со звёздочкой обязательны. Машина добавляется в контроль сразу после отправки.</span>
                <button
                  type="submit"
                  disabled={!allFields.some(f => canEditField(f))}
                  className={`${UI.buttonPrimary} w-full shrink-0 sm:w-auto`}
                >
                  Добавить в контроль
                </button>
              </div>
              <datalist id="known-fleet-dl">
                {Array.from(new Set(knownFleet)).map((k, oi) => <option key={`${k}-${oi}`} value={k} />)}
              </datalist>
            </form>
          </div>
        </div>

        {/* Вкладки «На базе» и «Архив»: список автомобилей */}
        <div className={currentTab !== 'history' ? '' : 'hidden'}>
          <div className="pt-5 flex flex-col gap-4">
            <SectionHeader
              icon={currentTab === 'base'
                ? <Truck className="w-4 h-4" aria-hidden="true" />
                : <Archive className="w-4 h-4" aria-hidden="true" />}
              title={currentTab === 'base' ? 'Автомобили на базе' : 'Архив выехавших автомобилей'}
            />
            <div className="flex flex-col lg:flex-row lg:items-center gap-3">
              <SearchField
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Быстрый поиск..."
                ariaLabel="Быстрый поиск по автомобилям"
              />
              <FoundCount
                count={filteredList.length}
                onReset={(searchQuery || archiveMonth !== null) ? () => { setSearchQuery(''); setArchiveMonth(null); } : undefined}
              />
            </div>

            {currentTab === 'archive' && (
              (() => {
                const monthNames = ['','Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
                const groups: Record<string, number> = {};
                archiveCars.forEach(v => {
                  const m = v.dateDeparture ? v.dateDeparture.substring(0, 7) : 'Без даты';
                  groups[m] = (groups[m] || 0) + 1;
                });
                const months = Object.keys(groups).sort((a, b) => b.localeCompare(a));
                return (
                  <FilterPills
                    items={[
                      { key: 'all', label: `Все (${archiveCars.length})` },
                      ...months.map(m => {
                        const [y, mo] = m.split('-');
                        const label = m === 'Без даты' ? `Без даты (${groups[m]})` : `${monthNames[parseInt(mo)]} ${y} (${groups[m]})`;
                        return { key: m, label };
                      }),
                    ]}
                    active={archiveMonth ?? 'all'}
                    onChange={(k) => setArchiveMonth(k === 'all' ? null : k)}
                    ariaLabel="Месяц архива"
                  />
                );
              })()
            )}

            {filteredList.length === 0 ? (
              <EmptyState
                kind={(searchQuery || archiveMonth !== null) ? 'no-results' : 'empty'}
                title={(searchQuery || archiveMonth !== null) ? undefined : 'Записей пока нет'}
                hint={(searchQuery || archiveMonth !== null) ? undefined : (currentTab === 'archive' ? 'Автомобиль появится здесь после выезда в рейс.' : 'Добавьте автомобиль через форму — запись появится здесь.')}
                query={searchQuery || undefined}
              />
            ) : (
              <>
                {/* Таблица — прямо на холсте */}
                <div className={`hidden lg:block ${UI.tableWrap}`}>
                  <table className={UI.table}>
                    <thead>
                      <tr className={UI.theadRow}>
                        <th className={UI.thSortable} onClick={() => handleSort('carNumber')}>Госномер{renderSortIndicator('carNumber')}</th>
                        <th className={UI.thSortable} onClick={() => handleSort('driverName')}>Водитель{renderSortIndicator('driverName')}</th>
                        <th className={UI.thSortable} onClick={() => handleSort('dateArrival')}>Прибыл на базу{renderSortIndicator('dateArrival')}</th>
                        <th className={UI.thSortable} onClick={() => handleSort('dateLoading')}>Срок готовности{renderSortIndicator('dateLoading')}</th>
                        <th className={UI.thSortable} onClick={() => handleSort('dateRepairStart')}>Заявка на ремонт{renderSortIndicator('dateRepairStart')}</th>
                        <th className={UI.thSortable} onClick={() => handleSort('dateRepairEnd')}>Завершение ремонта{renderSortIndicator('dateRepairEnd')}</th>
                        <th className={UI.thSortable} onClick={() => handleSort('dateDeparture')}>Фактический выезд{renderSortIndicator('dateDeparture')}</th>
                        <th className={UI.th}>Примечание</th>
                        <th className={`${UI.th} text-right`}>Действия</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleList.map((v, rowIndex) => (
                        <tr key={`${v.id}-${normalizePlate(v.carNumber)}-${rowIndex}`} data-nav-item data-baza-id={v.id} className={`${UI.tr} cursor-pointer`}>
                          <td onClick={() => openCarModal(v)} className={UI.tdMono}><span className="select-all">{v.carNumber}</span></td>
                          <td onClick={() => openCarModal(v)} className={UI.tdStrong}>{v.displayDriver || '—'}</td>
                          <td onClick={() => openCarModal(v)} className={UI.td}><span className="whitespace-nowrap">{v.dateArrival ? v.dateArrival.split('-').reverse().join('/') : '—'}</span></td>
                          <td onClick={() => openCarModal(v)} className={UI.td}><span className="whitespace-nowrap">{v.dateLoading ? v.dateLoading.split('-').reverse().join('/') : '—'}</span></td>
                          <td onClick={() => openCarModal(v)} className={UI.td}><span className="whitespace-nowrap">{v.dateRepairStart ? v.dateRepairStart.split('-').reverse().join('/') : '—'}</span></td>
                          <td onClick={() => openCarModal(v)} className={UI.td}><span className="whitespace-nowrap">{v.dateRepairEnd ? v.dateRepairEnd.split('-').reverse().join('/') : '—'}</span></td>
                          <td onClick={() => openCarModal(v)} className={UI.td}>
                            <span className={`whitespace-nowrap ${v.dateDeparture ? 'font-semibold text-emerald-600' : ''}`}>{v.dateDeparture ? v.dateDeparture.split('-').reverse().join('/') : '—'}</span>
                          </td>
                          <td onClick={() => openCarModal(v)} className={UI.td}>
                            {(v.comment || v.notes) ? (
                              <span className="block max-w-[180px] truncate text-[#6B7280]" title={v.comment || v.notes}>{v.comment || v.notes}</span>
                            ) : (
                              <span className="text-[#9CA3AF]">—</span>
                            )}
                          </td>
                          <td className={UI.td}>
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={(e) => { e.stopPropagation(); openCarModal(v); }}
                                className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-[#6B7280] hover:text-[var(--accent-ink)] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                                title="Редактировать"
                              >
                                <Edit className="w-3.5 h-3.5" aria-hidden="true" />
                              </button>
                              <button
                                disabled={isMechanic || !canWriteBaza}
                                onClick={(e) => { e.stopPropagation(); deleteCarRecord(v.id, v.carNumber, e); }}
                                className="w-11 h-11 sm:w-8 sm:h-8 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 transition-colors disabled:opacity-30 cursor-pointer"
                                title="Удалить"
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

                {/* Карточки на мобильных */}
                <div className="lg:hidden flex flex-col gap-3">
                  {visibleList.map((v, rowIndex) => (
                    <div
                      key={`${v.id}-${normalizePlate(v.carNumber)}-${rowIndex}`}
                      onClick={() => openCarModal(v)}
                      className="bg-white border border-[#E5E7EB] rounded-2xl p-4 flex flex-col gap-3 cursor-pointer hover:bg-[#F9FAFB] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <span className="font-mono font-semibold text-xs text-[#121316] select-all">{v.carNumber}</span>
                          <span className="text-xs font-medium text-[#4B5563] truncate">{v.displayDriver || '—'}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {getStatusBadge(v._status.code, v._status.text)}
                          <button
                            disabled={(currentTab === 'archive' && !isRootAdmin) || isMechanic || !canWriteBaza}
                            onClick={(e) => { e.stopPropagation(); deleteCarRecord(v.id, v.carNumber, e); }}
                            className="w-11 h-11 flex items-center justify-center rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-30 transition-colors cursor-pointer shrink-0"
                            title="Удалить"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                        {[
                          { label: 'Прибыл на базу', value: v.dateArrival },
                          { label: 'Срок готовности', value: v.dateLoading },
                          { label: 'Заявка на ремонт', value: v.dateRepairStart },
                          { label: 'Завершение ремонта', value: v.dateRepairEnd },
                        ].map((f) => (
                          <div key={f.label} className="flex flex-col gap-1">
                            <span className="text-[10px] font-medium uppercase tracking-wider text-[#9CA3AF]">{f.label}</span>
                            <span className="text-xs font-mono tabular-nums text-[#4B5563]">{f.value ? f.value.split('-').reverse().join('/') : '—'}</span>
                          </div>
                        ))}
                      </div>

                      <div className="flex items-start justify-between gap-3 pt-3 border-t border-[#E5E7EB]">
                        <div className="flex flex-col gap-1">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-[#9CA3AF]">Фактический выезд</span>
                          <span className={`text-xs font-mono tabular-nums ${v.dateDeparture ? 'font-semibold text-emerald-600' : 'text-[#4B5563]'}`}>{v.dateDeparture ? v.dateDeparture.split('-').reverse().join('/') : '—'}</span>
                        </div>
                        <div className="flex flex-col gap-1 min-w-0 items-end text-right">
                          <span className="text-[10px] font-medium uppercase tracking-wider text-[#9CA3AF]">Примечание</span>
                          <span className="text-xs text-[#6B7280] truncate max-w-[160px]" title={v.comment || v.notes || undefined}>{v.comment || v.notes || '—'}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {hasMoreBaza && (
              <div className="flex justify-center pt-1">
                <button
                  onClick={() => setVisibleBazaCount((c) => c + BAZA_PAGE_SIZE)}
                  className={UI.buttonGhost}
                >
                  <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  Показать ещё {Math.min(BAZA_PAGE_SIZE, filteredList.length - visibleBazaCount)} (осталось {filteredList.length - visibleBazaCount})
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Вкладка «История» */}
        <div className={currentTab === 'history' ? '' : 'hidden'}>
          <div className="pt-5 flex flex-col gap-4">
            <SectionHeader
              icon={<History className="w-4 h-4" aria-hidden="true" />}
              title="История всех действий в системе"
            />

            {globalHistory.length === 0 ? (
              <EmptyState
                kind="empty"
                title="История пуста"
                hint="Действия по записям автомобилей появятся здесь."
              />
            ) : (
              <>
                <div className="flex flex-col max-h-[700px] overflow-y-auto custom-scrollbar pr-1">
                  {[...globalHistory].reverse().slice(0, historyLimit).map(h => (
                    <div key={h.id} className="flex flex-col gap-1.5 py-3.5 border-b border-[#E5E7EB] last:border-0">
                      <div className="flex items-center flex-wrap gap-x-3 gap-y-1.5">
                        <span className="text-[11px] font-mono tabular-nums text-[#6B7280]">{h.date}</span>
                        <span className={`${UI.chip} font-mono text-[#121316]`}>{h.carNumber}</span>
                        <span className="text-[11px] font-medium text-[var(--accent-ink)]">{h.user}</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-[#4B5563]">
                        <span className="font-semibold text-[#121316]">{getNormalizedFieldLabel(h.field)}:</span>
                        <span className="text-rose-600">{h.old}</span>
                        {h.actionType !== 'delete' && (
                          <>
                            <ArrowRight className="w-3.5 h-3.5 text-[#D1D5DB]" aria-hidden="true" />
                            <span className="font-medium text-emerald-600">{h.new}</span>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                {globalHistory.length > historyLimit && (
                  <button
                    onClick={() => setHistoryLimit(prev => prev + 100)}
                    className={`${UI.buttonGhost} w-full`}
                  >
                    Загрузить еще (Показано {historyLimit} из {globalHistory.length})
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </ModuleShell>

      {/* Модальное окно редактирования автомобиля */}
      <ModalShell
        isOpen={isCarModalOpen}
        onClose={() => setIsCarModalOpen(false)}
        title="Карточка автомобиля"
        subtitle={modalData.carNumber || undefined}
        icon={<Truck className="w-4 h-4" aria-hidden="true" />}
        iconTone="graphite"
        maxWidth="max-w-6xl"
        footer={
          <div className="flex flex-wrap items-center justify-end gap-2 w-full">
            {currentTab === 'base' && !isMechanic && canWriteBaza && (
              <button onClick={moveCarToArchive} className={`${UI.buttonGhost} mr-auto`}>
                Выехал в рейс
              </button>
            )}
            <button onClick={() => setIsCarModalOpen(false)} className={UI.buttonGhost}>Отмена</button>
            <button
              onClick={saveCarModal}
              disabled={!['carNumber', 'driverName', 'dateArrival', 'dateLoading', 'dateRepairStart', 'dateRepairEnd', 'dateDeparture', 'comment'].some(f => canEditField(f))}
              className={UI.buttonPrimary}
            >Сохранить</button>
          </div>
        }
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-wrap items-center gap-3 pb-4 border-b border-[#E5E7EB]">
            {getStatusBadge(calculateCarStatus(modalData).code, calculateCarStatus(modalData).text)}
          </div>

          {/* Аналитика простоя */}
          <div className="flex flex-col gap-3">
            <span className={UI.caption}>Аналитика простоя по записи</span>
            <div className="flex flex-wrap items-center gap-x-10 gap-y-4">
              <span className="inline-flex items-center gap-2">
                <StatusText color="grey">Дни отдыха водит.</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-[#121316]">{getDaysBetween(modalData.dateArrival, modalData.dateLoading)}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusText color="rose">Ожидание ремонта</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-rose-600">{getDaysBetween(modalData.dateArrival, modalData.dateRepairStart)}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusText color="amber">Дни ремонта</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-[var(--accent-ink)]">{getDaysBetween(modalData.dateRepairStart, modalData.dateRepairEnd)}</span>
              </span>
              <span className="inline-flex items-center gap-2">
                <StatusText color="accent">Общий простой</StatusText>
                <span className="text-sm font-semibold font-mono tabular-nums text-[var(--accent-ink)]">{getDaysBetween(modalData.dateArrival, modalData.dateDeparture)}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel}>Госномер автомобиля</label>
              <CouplingPicker
                mode="combined"
                value={modalData.carNumber}
                onSelect={(rec) => {
                  if (!rec) return;
                  const coupling = [
                    (rec.carNumber || rec.vehicleNumbers || '').toUpperCase(),
                    rec.trailerNumber ? rec.trailerNumber.toUpperCase() : ''
                  ].filter(Boolean).join(' / ');
                  const fullName = rec.driverNameRu || rec.driverName || rec.driverShortNameRu || '';
                  const driverName = fullName;
                  // Changing the car edits carNumber + driverName; mark them touched so they save,
                  // but NEVER touch the date/comment fields (they must survive the change).
                  setTouchedFields(prev => ({ ...prev, carNumber: true, driverName: true, driverNameRu: true }));
                  setModalData((m) => ({ ...m, carNumber: coupling, driverName, driverNameRu: fullName || '' }));
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel}>ФИО Водителя</label>
              <div className="flex items-center min-h-[44px] py-2 text-sm font-medium text-[#121316]">
                {modalData.driverName || <span className="text-[#9CA3AF]">—</span>}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-5">
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel} title="Прибыл на базу">Прибыл на базу</label>
              <div className="relative">
                <input type="text" readOnly disabled={!canEditField('dateArrival')} value={modalData.dateArrival ? modalData.dateArrival.split('-').reverse().join('/') : ''} placeholder="ДД/ММ/ГГГГ" className={`${UI.input} cursor-pointer pr-10`} onClick={() => openDatePicker('modal-picker-dateArrival')} />
                <input type="date" id="modal-picker-dateArrival" disabled={!canEditField('dateArrival')} value={modalData.dateArrival || ''} onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateArrival: true})); setModalData((mm) => ({...mm, dateArrival: e.target.value})); } } className="absolute inset-0 opacity-0 md:pointer-events-none" />
                <button type="button" disabled={!canEditField('dateArrival')} onClick={() => openDatePicker('modal-picker-dateArrival')} className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#9CA3AF] hover:text-[#121316] disabled:opacity-30 cursor-pointer pointer-events-none md:pointer-events-auto">
                  <Calendar className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel} title="К какому числу должна быть готова машина">Срок готовности</label>
              <div className="relative">
                <input type="text" readOnly disabled={!canEditField('dateLoading')} value={modalData.dateLoading ? modalData.dateLoading.split('-').reverse().join('/') : ''} placeholder="ДД/ММ/ГГГГ" className={`${UI.input} cursor-pointer pr-10`} onClick={() => openDatePicker('modal-picker-dateLoading')} />
                <input type="date" id="modal-picker-dateLoading" disabled={!canEditField('dateLoading')} value={modalData.dateLoading || ''} onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateLoading: true})); setModalData((mm) => ({...mm, dateLoading: e.target.value})); } } className="absolute inset-0 opacity-0 md:pointer-events-none" />
                <button type="button" disabled={!canEditField('dateLoading')} onClick={() => openDatePicker('modal-picker-dateLoading')} className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#9CA3AF] hover:text-[#121316] disabled:opacity-30 cursor-pointer pointer-events-none md:pointer-events-auto">
                  <Calendar className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel} title="Дата подачи заявки на ремонт">Заявка на ремонт</label>
              <input type="date" disabled={!canEditField('dateRepairStart')} value={modalData.dateRepairStart || ''} onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateRepairStart: true})); setModalData((mm) => ({...mm, dateRepairStart: e.target.value})); }} className={UI.input} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel} title="Дата окончания ремонта">Завершение ремонта</label>
              <input type="date" disabled={!canEditField('dateRepairEnd')} value={modalData.dateRepairEnd || ''} onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateRepairEnd: true})); setModalData((mm) => ({...mm, dateRepairEnd: e.target.value})); }} className={UI.input} />
            </div>
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel} title="Фактический выезд">Фактический выезд</label>
              <div className="relative">
                <input type="text" readOnly disabled={!canEditField('dateDeparture')} value={modalData.dateDeparture ? modalData.dateDeparture.split('-').reverse().join('/') : ''} placeholder="ДД/ММ/ГГГГ" className={`${UI.input} cursor-pointer pr-10`} onClick={() => openDatePicker('modal-picker-dateDeparture')} />
                <input type="date" id="modal-picker-dateDeparture" disabled={!canEditField('dateDeparture')} value={modalData.dateDeparture || ''} onChange={(e)=>{ setTouchedFields(prev => ({...prev, dateDeparture: true})); setModalData((mm) => ({...mm, dateDeparture: e.target.value})); } } className="absolute inset-0 opacity-0 md:pointer-events-none" />
                <button type="button" disabled={!canEditField('dateDeparture')} onClick={() => openDatePicker('modal-picker-dateDeparture')} className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center text-[#9CA3AF] hover:text-[#121316] disabled:opacity-30 cursor-pointer pointer-events-none md:pointer-events-auto">
                  <Calendar className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className={UI.fieldLabel}>Примечание</label>
            <input
              disabled={!canEditField('comment')}
              value={modalData.comment||''}
              onChange={(e)=>{ setTouchedFields(prev => ({...prev, comment: true})); setModalData((mm) => ({...mm, comment: e.target.value})); }}
              onKeyDown={handleInputKeyDown}
              className={UI.input}
            />
          </div>

          <div className="flex flex-col gap-3">
            <span className={UI.caption}>Журнал изменений записи</span>
            <div className="flex flex-col max-h-72 overflow-y-auto custom-scrollbar pr-1">
              {modalData.history && Object.keys(modalData.history).reverse().map(hk => {
                const h = modalData.history[hk];
                return (
                  <div key={hk} className="flex flex-col gap-1.5 py-3 border-b border-[#E5E7EB] last:border-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-[#6B7280]">
                      <span className="font-mono tabular-nums">{h.date}</span>
                      <span aria-hidden="true">·</span>
                      <span className="text-[var(--accent-ink)]">{h.user}</span>
                    </div>
                    <div className="text-[13px] text-[#4B5563] leading-relaxed">
                      «{getNormalizedFieldLabel(h.field)}»: <span className="line-through text-[#9CA3AF] mx-1">{h.old}</span>
                      <ArrowRight className="w-3.5 h-3.5 inline-block align-middle text-[#D1D5DB]" aria-hidden="true" />
                      <span className="text-[#121316] font-medium mx-1">{h.new}</span>
                    </div>
                  </div>
                );
              })}
              {(!modalData.history || Object.keys(modalData.history).length === 0) && <p className={UI.hint}>Изменений еще нет</p>}
            </div>
          </div>
        </div>
      </ModalShell>

      <datalist id="baza-drivers-dl">
        {drivers.map((drv: any) => (
          <option key={drv.id} value={drv.shortNameRu || formatDriverShortName(drv)} />
        ))}
      </datalist>
    </>
  );
}
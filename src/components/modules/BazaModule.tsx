import React, { useState, useEffect, useMemo, useRef } from 'react';
import { UserProfile } from '../../types';
import { dbService, onValue } from '../../firebase';
import { getDatabase, ref, set, push, remove, update, serverTimestamp, onDisconnect } from 'firebase/database';
import { getApp } from 'firebase/app';
import { 
  Trash2, 
  Search, 
  Archive, 
  History, 
  Clock, 
  Settings, 
  CheckCircle2, 
  Wrench, 
  Truck,
  FileSpreadsheet,
  X,
  Users
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';

interface BazaModuleProps {
  user: UserProfile;
}

const allFields = ['carNumber', 'driverName', 'dateArrival', 'dateLoading', 'dateRepairStart', 'dateRepairEnd', 'dateDeparture', 'comment'] as const;
type FieldType = typeof allFields[number];

const fieldLabels: Record<FieldType, string> = {
  carNumber: "Госномер",
  driverName: "Водитель",
  dateArrival: "Прибыл на базу",
  dateLoading: "К какому числу должна быть готова машина",
  dateRepairStart: "Дата подачи заявки на ремонт",
  dateRepairEnd: "Дата окончания ремонта",
  dateDeparture: "Фактический выезд",
  comment: "Примечание"
};

export default function BazaModule({ user: ratipaUser }: BazaModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [currentTab, setCurrentTab] = useState<'base' | 'archive' | 'history'>('base');
  
  // Data State
  const [cars, setCars] = useState<any[]>([]);
  const [archiveCars, setArchiveCars] = useState<any[]>([]);
  const [globalHistory, setGlobalHistory] = useState<any[]>([]);
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [systemUsers, setSystemUsers] = useState<any[]>([]);
  const [drivers, setDrivers] = useState<any[]>([]);

  // Local state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortMode, setSortMode] = useState<string>('default');
  const [isCarModalOpen, setIsCarModalOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  
  // Form State
  const [formData, setFormData] = useState<Record<string, string>>({
    carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: ''
  });

  // Modal State
  const [modalData, setModalData] = useState<any>({});
  const [bazaUndoStack, setBazaUndoStack] = useState<{ id: string; field: string; oldValue: any }[]>([]);

  // Keyboard Navigation & Actions
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsCarModalOpen(false);
        setIsAdminModalOpen(false);
      }
      
      // Ctrl + Z : Revert last change in the modal database updates
      if (e.ctrlKey && (e.key === 'z' || e.key === 'я' || e.key === 'Z')) {
        if (bazaUndoStack.length > 0) {
          e.preventDefault();
          const lastChange = bazaUndoStack[bazaUndoStack.length - 1];
          setBazaUndoStack(prev => prev.slice(0, -1));

          const rootBranch = currentTab === "base" ? "baza_cars" : "archive_cars";
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

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCarModalOpen, isAdminModalOpen, bazaUndoStack, currentTab, modalData]);

  // DB Sync
  useEffect(() => {
    try {
      const db = getDatabase(getApp());
      
      const unsubs: any[] = [];
      
      unsubs.push(onValue(ref(db, 'baza_cars'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setCars(list);
      }));

      unsubs.push(onValue(ref(db, 'archive_cars'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setArchiveCars(list);
      }));

      unsubs.push(onValue(ref(db, 'global_history'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setGlobalHistory(list);
      }));

      unsubs.push(onValue(ref(db, 'known_fleet'), snap => {
        const data = snap.val() || {};
        setKnownFleet(Object.values(data));
      }));

      unsubs.push(onValue(ref(db, 'driversPool'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setDrivers(list);
      }));

      unsubs.push(onValue(ref(db, 'users_list'), snap => {
        const data = snap.val() || {};
        const list = Object.keys(data).map(id => ({ id, ...data[id] }));
        setSystemUsers(list);
        
        // Ensure root admin exists (re-create Сергей if missing)
        const hasRoot = list.some(u => u.isRootAdmin || u.name === 'Сергей');
        if (!hasRoot && Object.keys(data).length > 0) {
           let fullPerms: any = {}; allFields.forEach(f => fullPerms[f] = true);
           push(ref(db, 'users_list'), { name: "Сергей", role: "Диспетчер", password: "ratipa2026", permissions: fullPerms, isRootAdmin: true });
        }
      }));

      return () => {
        unsubs.forEach(u => u());
      };
    } catch(e) {
      console.warn("DB Error", e);
    }
  }, []);

  // Auth mapping: figure out our internal role & perms based on users_list mapped to ratipaUser.name
  const matchedUser = systemUsers.find(u => u.name.toLowerCase() === ratipaUser.name.toLowerCase() || u.id === ratipaUser.uid) || {
    name: ratipaUser.name,
    role: ratipaUser.role === 'root_admin' ? 'Диспетчер' : 'Механик',
    permissions: {},
    isRootAdmin: ratipaUser.role === 'root_admin'
  };

  const isRootAdmin = matchedUser.isRootAdmin || matchedUser.name === 'Сергей';
  const currentUserRole = matchedUser.role; // "Диспетчер" | "Механик"
  const currentUserPermissions = matchedUser.permissions || {};

  const canEditField = (fieldName: string) => {
     if (isRootAdmin) return true;
     return currentUserPermissions[fieldName] === true;
  };

  const isMechanic = currentUserRole === 'Механик';

  // --- Logic Helpers ---
  const calculateCarStatus = (car: any) => {
      const todayStr = new Date().toISOString().split('T')[0];
      if (car.dateDeparture && car.dateDeparture <= todayStr) {
          return { code: 'transit', text: 'В рейсе', class: 'bg-slate-900 text-slate-100', icon: <Truck className="h-3 w-3 animate-bounce"/> };
      }
      if (car.dateRepairStart) {
          if (!car.dateRepairEnd || todayStr < car.dateRepairEnd) {
              if (todayStr >= car.dateRepairStart) {
                  return { code: 'repair', text: 'В ремонте', class: 'bg-amber-50 text-amber-700 border-amber-100', icon: <Wrench className="h-3 w-3"/> };
              }
          }
      }
      if (car.dateRepairEnd && todayStr >= car.dateRepairEnd) {
          if (!car.dateDeparture || car.dateDeparture > todayStr) {
              return { code: 'ready', text: 'Готов к рейсу', class: 'bg-emerald-50 text-emerald-700 border-emerald-100', icon: <CheckCircle2 className="h-3 w-3"/> };
          }
      }
      return { code: 'base', text: 'На базе', class: 'bg-[#c3fb12]/20 text-[#2f4201] border-[#c3fb12]/40', icon: <CheckCircle2 className="h-3 w-3 opacity-60"/> };
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
      const timestampStr = now.toLocaleDateString("ru-RU") + " " + now.toLocaleTimeString("ru-RU", {hour: '2-digit', minute:'2-digit'});
      
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
          carNumber: carNum,
          actionType: fieldLabel === "Запись создана" ? "create" : (became === "[Запись стерта]" ? "delete" : "update")
      });
  };

  // --- Actions ---
  const handleFormChange = (e: any, field: string) => {
    setFormData({...formData, [field]: e.target.value});
  };

  const handleAddNewCar = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRootAdmin && !currentUserPermissions['carNumber']) {
      toast("У вас нет прав на добавление автомобилей!", 'error'); return;
    }
    const db = getDatabase(getApp());
    const cNum = formData.carNumber.trim().toUpperCase();
    if (!cNum) return;

    if (!knownFleet.includes(cNum)) {
      if (await showConfirm(`Обнаружен новый автомобиль [${cNum}].\nСохранить в постоянную базу автопарка?`)) {
        push(ref(db, 'known_fleet'), cNum);
      }
    }

    const trimmedDriver = formData.driverName.trim();
    if (trimmedDriver) {
      const exists = drivers.some(d => d.name.trim().toLowerCase() === trimmedDriver.toLowerCase());
      if (!exists) {
        if (await showConfirm(`Водитель "${trimmedDriver}" отсутствует в справочнике. Занести его в справочник?`)) {
          const newDriver = {
            id: "dr_" + Date.now(),
            name: trimmedDriver,
          };
          dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
          toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
        }
      }
    }

    const newRef = push(ref(db, 'baza_cars'));
    const carData = {
      ...formData,
      carNumber: cNum
    };
    set(newRef, carData).then(() => {
       logHistory(newRef.key as string, "baza_cars", "Запись создана", "", `Госномер: ${cNum}`, cNum);
       setFormData({ carNumber: '', driverName: '', dateArrival: '', dateLoading: '', dateRepairStart: '', dateRepairEnd: '', dateDeparture: '', comment: '' });
    });
  };

  const openCarModal = (car: any) => {
    setModalData(car);
    setIsCarModalOpen(true);
  };

  const updateCarField = async (id: string, field: string, newValue: string) => {
      if (!isRootAdmin && !currentUserPermissions[field]) {
          toast("Действие отклонено: У вас нет прав на редактирование этого поля!", 'error');
          return;
      }
      const rootBranch = currentTab === "base" ? "baza_cars" : "archive_cars";
      const sourceList = currentTab === "base" ? cars : archiveCars;
      const targetCar = sourceList.find(c => c.id === id);
      
      if (!targetCar) return;
      
      let oldValue = targetCar[field] || "";
      let val = newValue;
      if (field === 'carNumber') val = val.toUpperCase();
      if (oldValue === val) return;

      if (field === 'driverName' && val.trim() !== '') {
        const trimmedDriver = val.trim();
        const exists = drivers.some(d => d.name.trim().toLowerCase() === trimmedDriver.toLowerCase());
        if (!exists) {
          const confirmAdd = await showConfirm(`Водитель "${trimmedDriver}" отсутствует в справочнике. Занести его в справочник?`);
          if (confirmAdd) {
            const newDriver = {
              id: "dr_" + Date.now(),
              name: trimmedDriver,
            };
            dbService.saveDriver(newDriver, ratipaUser.name, ratipaUser.role);
            toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
          }
        }
      }

      // Track change for Undo logic
      setBazaUndoStack(prev => [...prev, { id, field, oldValue }]);

      const db = getDatabase(getApp());
      update(ref(db, `${rootBranch}/${id}`), { [field]: val }).then(() => {
         logHistory(id, rootBranch, fieldLabels[field as FieldType] || field, oldValue, val, targetCar.carNumber || "Неизвестно");
         // Optimistically update modalData
         setModalData((prev: any) => ({ ...prev, [field]: val }));
      });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.currentTarget.blur();
    }
  };

  const moveCarToArchive = async () => {
      if (isMechanic || !modalData) return;
      if (!(await showConfirm(`Отправить автомобиль [${modalData.carNumber}] в рейс?\nЗапись переместится во вкладку Архив.`))) return;

      const db = getDatabase(getApp());
      const nowStr = new Date().toISOString().split('T')[0];
      
      const updatedDeparture = modalData.dateDeparture || nowStr;
      
      const archiveCarData = {
          carNumber: modalData.carNumber || "",
          driverName: modalData.driverName || "",
          dateArrival: modalData.dateArrival || "",
          dateLoading: modalData.dateLoading || "",
          dateRepairStart: modalData.dateRepairStart || "",
          dateRepairEnd: modalData.dateRepairEnd || "",
          dateDeparture: updatedDeparture,
          comment: modalData.comment || "",
          history: modalData.history || {}
      };

      set(ref(db, `archive_cars/${modalData.id}`), archiveCarData).then(() => {
          logHistory(modalData.id, "archive_cars", "Статус", "На базе", "Выехал в рейс (Перенесено в архив)", modalData.carNumber);
          remove(ref(db, `baza_cars/${modalData.id}`));
          setIsCarModalOpen(false);
      });
  };

  const deleteCarRecord = async (id: string, carNumber: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (currentTab === "archive" && !isRootAdmin) {
          toast("Удаление записей из архива разрешено только администратору!", 'error');
          return;
      }
      if (isMechanic) return;

      if (await showConfirm(`Вы уверены, что хотите окончательно удалить запись автомобиля ${carNumber}?`)) {
          const db = getDatabase(getApp());
          const targetBranch = currentTab === "base" ? "baza_cars" : "archive_cars";
          remove(ref(db, `${targetBranch}/${id}`));
          
          const timestampStr = new Date().toLocaleDateString("ru-RU") + " " + new Date().toLocaleTimeString("ru-RU", {hour: '2-digit', minute:'2-digit'});
          push(ref(db, `global_history`), {
              date: timestampStr,
              user: `${matchedUser.name} (${matchedUser.role})`,
              field: "Удаление карточки ТС",
              old: `Удалена запись из раздела: ${currentTab === 'base' ? 'На базе' : 'Архив'}`,
              new: "[Запись стерта]",
              carNumber: carNumber,
              actionType: "delete"
          });
      }
  };

  // --- Admin ---
  const [adminForm, setAdminForm] = useState({ name: '', role: 'Диспетчер', password: '' });
  const [adminPerms, setAdminPerms] = useState<Record<string, boolean>>(() => {
     let p: any = {}; allFields.forEach(f => p[f] = true); return p;
  });

  const handleAddUser = () => {
    if(!adminForm.name || !adminForm.password) return;
    const db = getDatabase(getApp());
    push(ref(db, 'users_list'), {
       name: adminForm.name,
       role: adminForm.role,
       password: adminForm.password,
       permissions: adminPerms,
       isRootAdmin: false
    }).then(() => {
       setAdminForm({ name: '', role: 'Диспетчер', password: '' });
       let p: any = {}; allFields.forEach(f => p[f] = true); setAdminPerms(p);
    });
  };

  const deleteUser = async (id: string, name: string) => {
     if(await showConfirm(`Удалить пользователя ${name}?`)) {
       dbService.deleteUser(id, name);
     }
  };

  const toggleUserPerm = (userId: string, field: string, val: boolean) => {
     update(ref(getDatabase(getApp()), `users_list/${userId}/permissions`), { [field]: val });
  };
  
  const updateUserName = (userId: string, newName: string) => {
     update(ref(getDatabase(getApp()), `users_list/${userId}`), { name: newName });
  };

  // --- Rendering Data ---
  const filteredList = (currentTab === 'base' ? cars : archiveCars).filter(c => {
     const q = searchQuery.toLowerCase();
     if (q && !((c.carNumber||'').toLowerCase().includes(q) || (c.driverName||'').toLowerCase().includes(q) || (c.comment||'').toLowerCase().includes(q))) return false;
     return true;
  }).map(c => ({...c, _status: calculateCarStatus(c)})).sort((a,b) => {
     if (sortMode === 'car_asc') return (a.carNumber||'').localeCompare(b.carNumber||'');
     if (sortMode === 'car_desc') return (b.carNumber||'').localeCompare(a.carNumber||'');
     if (sortMode === 'arrival_desc') return (b.dateArrival||'0000').localeCompare(a.dateArrival||'0000');
     if (sortMode === 'arrival_asc') return (a.dateArrival||'9999').localeCompare(b.dateArrival||'9999');
     if (sortMode === 'departure_desc') return (b.dateDeparture||'0000').localeCompare(a.dateDeparture||'0000');
     if (sortMode === 'departure_asc') return (a.dateDeparture||'9999').localeCompare(b.dateDeparture||'9999');
     
     // default smart sort
     if (currentTab === 'archive') {
         return (b.dateDeparture||'0000').localeCompare(a.dateDeparture||'0000');
     }
     return (b.dateArrival||'0000').localeCompare(a.dateArrival||'0000');
  });

  const wTotal = cars.filter(c => ['base','repair','ready'].includes(calculateCarStatus(c).code)).length;
  const wRepair = cars.filter(c => calculateCarStatus(c).code === 'repair').length;
  const wReady = cars.filter(c => calculateCarStatus(c).code === 'ready').length;

  return (
    <div className="w-full space-y-6 flex flex-col font-sans">
      
      {/* Top Internal Tab Navigation for Baza module */}
      <div className="bg-white/80 backdrop-blur-md p-3 rounded-2xl border border-slate-200/50 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="flex items-center gap-2 self-start md:self-auto">
          <span className="bg-[#70FC8E] text-slate-950 font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono border border-black/5 animate-pulse">
            Учет выезда
          </span>
        </div>
        
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-end">
          <div className="flex items-center gap-1 bg-[#f0f2f4] p-1 rounded-full border border-slate-200/50 shadow-inner">
            <button 
              onClick={() => setCurrentTab('base')} 
              className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tight transition duration-150 whitespace-nowrap cursor-pointer ${
                currentTab === 'base' 
                  ? 'bg-slate-950 text-[#70FC8E] shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
              }`}
            >
              На базе
            </button>
            <button 
              onClick={() => setCurrentTab('archive')} 
              className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tight transition duration-150 whitespace-nowrap cursor-pointer ${
                currentTab === 'archive' 
                  ? 'bg-slate-950 text-[#70FC8E] shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
              }`}
            >
              Архив
            </button>
            <button 
              onClick={() => setCurrentTab('history')} 
              className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tight transition duration-150 whitespace-nowrap cursor-pointer ${
                currentTab === 'history' 
                  ? 'bg-slate-950 text-[#70FC8E] shadow-sm' 
                  : 'text-slate-500 hover:text-slate-900 hover:bg-white/40'
              }`}
            >
              История
            </button>
          </div>
          
          {isRootAdmin && (
            <button 
              onClick={() => setIsAdminModalOpen(true)} 
              className="px-4 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 text-slate-800 rounded-full text-[10px] font-black uppercase tracking-tight transition cursor-pointer flex items-center gap-1.5 shadow-xs shrink-0"
            >
              <Settings className="h-3.5 w-3.5 text-slate-500"/> Админка
            </button>
          )}
        </div>
      </div>

      {/* Dynamic Counter widgets on top (Full width) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
         {/* Всего на базе */}
         <div className="bg-white rounded-[2rem] p-5 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex justify-between items-center">
            <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 font-mono">Всего на базе ТС</span>
               <span className="text-xl font-black text-slate-900 mt-1">{wTotal}</span>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-slate-50 flex items-center justify-center border border-slate-100">
               <Truck className="h-5 w-5 text-slate-500" />
            </div>
         </div>
         {/* В ремонте */}
         <div className="bg-white rounded-[2rem] p-5 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex justify-between items-center">
            <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-wider text-rose-500 font-mono">В ремонте ТС</span>
               <span className="text-xl font-black text-rose-600 mt-1">{wRepair}</span>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-rose-50 flex items-center justify-center border border-rose-100">
               <Wrench className="h-5 w-5 text-rose-500" />
            </div>
         </div>
         {/* Готовы к рейсу */}
         <div className="bg-white rounded-[2rem] p-5 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex justify-between items-center">
            <div className="flex flex-col">
               <span className="text-[10px] font-black uppercase tracking-wider text-[#107c41] font-mono">Готовы к рейсу ТС</span>
               <span className="text-xl font-black text-[#107c41] mt-1">{wReady}</span>
            </div>
            <div className="w-10 h-10 rounded-2xl bg-[#e7fbe9] flex items-center justify-center border border-[#107c41]/20">
               <CheckCircle2 className="h-5 w-5 text-[#107c41]" />
            </div>
         </div>
      </div>

      <div className="space-y-6">
          
          <div className={currentTab === 'base' ? '' : 'hidden'}>
             <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
                 <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono border-b border-slate-100 pb-3 mb-6 flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center border border-slate-200"></span> 
                    Добавить новый автомобиль
                 </h2>
                 <form onSubmit={handleAddNewCar}>
                     <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Госномер авто *</label>
                            <input list="known-fleet-dl" required disabled={!canEditField('carNumber')} value={formData.carNumber} onChange={e => handleFormChange(e, 'carNumber')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold uppercase disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" placeholder="АВ 1234-5" />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">ФИО Водителя</label>
                            <input disabled={!canEditField('driverName')} list="baza-drivers-dl" value={formData.driverName} onChange={e => handleFormChange(e, 'driverName')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" placeholder="Опционально" />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Прибыл на базу</label>
                            <input type="date" disabled={!canEditField('dateArrival')} value={formData.dateArrival} onChange={e => handleFormChange(e, 'dateArrival')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono truncate" title="К какому числу должна быть готова машина">К какому числу должна быть готова машина</label>
                            <input type="date" disabled={!canEditField('dateLoading')} value={formData.dateLoading} onChange={e => handleFormChange(e, 'dateLoading')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Дата подачи заявки на ремонт</label>
                            <input type="date" disabled={!canEditField('dateRepairStart')} value={formData.dateRepairStart} onChange={e => handleFormChange(e, 'dateRepairStart')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Дата окончания ремонта</label>
                            <input type="date" disabled={!canEditField('dateRepairEnd')} value={formData.dateRepairEnd} onChange={e => handleFormChange(e, 'dateRepairEnd')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Фактический выезд</label>
                            <input type="date" disabled={!canEditField('dateDeparture')} value={formData.dateDeparture} onChange={e => handleFormChange(e, 'dateDeparture')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" />
                         </div>
                         <div className="space-y-1.5">
                            <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Примечание</label>
                            <input disabled={!canEditField('comment')} value={formData.comment} onChange={e => handleFormChange(e, 'comment')} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold disabled:opacity-50 outline-none focus:border-blue-400 focus:bg-white" placeholder="..." />
                         </div>
                     </div>
                     <button type="submit" disabled={!allFields.some(f => canEditField(f))} className="px-5 py-3 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] text-[10px] font-black uppercase rounded-xl tracking-wider transition cursor-pointer disabled:opacity-50 mt-2 shadow-sm">
                        Добавить в контроль
                     </button>
                     <datalist id="known-fleet-dl">
                        {knownFleet.map(k => <option key={k} value={k} />)}
                     </datalist>
                 </form>
             </div>
          </div>

          <div className={currentTab !== 'history' ? '' : 'hidden'}>
             <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col">
                 <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                    <h2 className="text-base font-black uppercase tracking-tight text-slate-800">
                       {currentTab === 'base' ? 'Автомобили на базе' : 'Архив выехавших автомобилей'}
                    </h2>
                    <div className="flex items-center gap-3 w-full sm:w-auto">
                       <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} type="text" className="w-full sm:w-64 bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl outline-none focus:border-blue-400" placeholder="Быстрый поиск..." />
                       <select value={sortMode} onChange={e => setSortMode(e.target.value)} className="bg-slate-50 border border-slate-200 text-xs font-bold px-3 py-2.5 rounded-xl outline-none min-w-[170px] max-w-[250px]">
                          <option value="default">Умная сортировка (По умолчанию)</option>
                          <optgroup label="По номеру авто">
                             <option value="car_asc">А–Я По номеру авто</option>
                             <option value="car_desc">Я–А По номеру авто</option>
                          </optgroup>
                          <optgroup label="Фактический выезд">
                             <option value="departure_desc">Вначале недавно выехавшие (Новые)</option>
                             <option value="departure_asc">Вначале давно выехавшие (Старые)</option>
                          </optgroup>
                          <optgroup label="Прибытие на базу">
                             <option value="arrival_desc">Вначале недавно прибывшие (Новые)</option>
                             <option value="arrival_asc">Вначале давно прибывшие (Старые)</option>
                          </optgroup>
                       </select>
                    </div>
                 </div>

                 {/* Swipe Help Badge for Mobile */}
                 <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-center uppercase tracking-wider select-none">
                    <span className="inline-block animate-pulse text-[#107c41] mr-1.5 font-sans">↔</span> Таблица прокручивается вправо для просмотра деталей (Ремонт, Сроки готовности, Выезд)
                 </div>

                 <div className="overflow-x-auto custom-scrollbar">
                    <table className="w-full text-left min-w-[1450px] border-separate border-spacing-y-2">
                       <thead>
                          <tr>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Госномер</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Водитель</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Прибыл на базу</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">К какому числу должна быть готова машина</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Дата подачи заявки на ремонт</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Дата окончания ремонта</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Фактический выезд</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Примечание</th>
                             <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3"></th>
                          </tr>
                       </thead>
                       <tbody>
                          {filteredList.map(v => (
                             <tr key={v.id} onClick={() => openCarModal(v)} className="group cursor-pointer">
                                <td className="bg-slate-50 rounded-l-2xl px-5 py-5 border-y border-l border-slate-200/50 group-hover:bg-slate-100/60 transition duration-150">
                                   <span className="font-extrabold text-slate-950 text-xs sm:text-sm bg-white px-2.5 py-1.5 rounded-xl border border-slate-300 group-hover:border-slate-400 group-hover:bg-[#70FC8E]/10 transition-all font-mono tracking-wider shadow-xs whitespace-nowrap inline-block select-all">{v.carNumber}</span>
                                </td>
                                <td className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-sm font-black text-slate-800 group-hover:bg-slate-100/60 transition">{v.driverName || '—'}</td>
                                <td className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
                                   <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateArrival ? v.dateArrival.split('-').reverse().join('.') : '—'}</span>
                                </td>
                                <td className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
                                   <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateLoading ? v.dateLoading.split('-').reverse().join('.') : '—'}</span>
                                </td>
                                <td className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
                                   <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateRepairStart ? v.dateRepairStart.split('-').reverse().join('.') : '—'}</span>
                                </td>
                                <td className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
                                   <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateRepairEnd ? v.dateRepairEnd.split('-').reverse().join('.') : '—'}</span>
                                </td>
                                <td className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
                                   <span className={`px-2.5 py-1.5 rounded-lg border whitespace-nowrap ${
                                      v.dateDeparture 
                                         ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-extrabold' 
                                         : 'bg-white/80 border-slate-200/60 text-slate-400'
                                   }`}>{v.dateDeparture ? v.dateDeparture.split('-').reverse().join('.') : '—'}</span>
                                 </td>
                                <td className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-medium text-slate-500 truncate max-w-[200px] group-hover:bg-slate-100/60 transition">{v.comment || '...'}</td>
                                <td className="bg-slate-50 rounded-r-2xl px-5 py-5 border-y border-r border-slate-200/50 text-right group-hover:bg-slate-100/60 transition">
                                   <button 
                                     disabled={(currentTab === 'archive' && !isRootAdmin) || isMechanic}
                                     onClick={(e) => deleteCarRecord(v.id, v.carNumber, e)} 
                                     className="w-9 h-9 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-full flex items-center justify-center disabled:opacity-30 disabled:hover:bg-rose-50 transition shadow-xs cursor-pointer inline-flex mx-auto"
                                    >
                                     <Trash2 className="h-4 w-4"/>
                                   </button>
                                </td>
                             </tr>
                          ))}
                          {filteredList.length === 0 && (
                            <tr><td colSpan={9} className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 rounded-xl border border-slate-200/50 italic">Записей не найдено</td></tr>
                          )}
                       </tbody>
                    </table>
                 </div>
             </div>
          </div>

          <div className={currentTab === 'history' ? '' : 'hidden'}>
             <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col">
                 <h2 className="text-base font-black uppercase tracking-tight text-slate-800 border-b border-slate-100 pb-4 mb-4">История всех действий в системе</h2>
                 <div className="space-y-3 max-h-[700px] overflow-y-auto pr-2">
                    {[...globalHistory].reverse().map(h => (
                       <div key={h.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-2">
                          <div className="flex items-center flex-wrap gap-3">
                             <span className="text-xs font-bold text-slate-500 font-mono">{h.date}</span>
                             <span className="text-xs font-black bg-white px-2 py-0.5 rounded border border-slate-200 shadow-xs">{h.carNumber}</span>
                             <span className="text-xs font-bold text-slate-700 bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{h.user}</span>
                          </div>
                          <div className="text-xs font-medium text-slate-700 bg-white p-3 rounded-lg border border-slate-100 flex flex-wrap items-center gap-2">
                             <span className="font-extrabold text-slate-900 border-r border-slate-200 pr-2">{h.field}:</span>
                             <span className={`text-rose-500 font-mono line-through ${h.actionType==='delete'?'line-through-none':''}`}>{h.old}</span>
                             {h.actionType !== 'delete' && (
                                <>
                                 <span className="text-slate-300">➔</span>
                                 <span className="text-emerald-600 font-bold font-mono">{h.new}</span>
                                </>
                             )}
                          </div>
                       </div>
                    ))}
                    {globalHistory.length === 0 && <div className="text-slate-400 italic font-bold">История пуста.</div>}
                 </div>
             </div>
          </div>

      </div>

      {/* Car Editor Modal */}
      <AnimatePresence>
        {isCarModalOpen && (
           <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div initial={{y:30, scale:0.96}} animate={{y:0, scale:1}} exit={{y:20, opacity:0, scale:0.96}} className="bg-white text-slate-900 rounded-[2rem] w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden font-sans">
                 <div className="p-6 border-b border-slate-200/60 flex justify-between items-center bg-slate-50/80 shrink-0">
                    <h2 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2 font-mono">КАРТОЧКА АВТОМОБИЛЯ</h2>
                    <div className="flex items-center gap-3">
                       {currentTab === 'base' && !isMechanic && (
                         <button onClick={moveCarToArchive} className="px-4 py-2.5 bg-[#107c41] hover:bg-[#0c6233] text-white text-[10px] font-black uppercase rounded-xl transition duration-150 shadow-sm flex items-center gap-1.5 cursor-pointer">
                            Выехал в рейс
                         </button>
                       )}
                       <button onClick={() => setIsCarModalOpen(false)} className="px-4 py-2.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 text-[10px] font-black uppercase rounded-xl transition cursor-pointer">
                          Закрыть
                       </button>
                    </div>
                 </div>

                 <div className="p-6 overflow-y-auto flex-1 bg-white space-y-6">
                    {/* Summary Widgets */}
                    <div className="bg-slate-50 border border-slate-200/60 rounded-2xl p-5 shadow-xs">
                       <h3 className="text-[10px] font-black uppercase text-slate-500 mb-3 tracking-widest font-mono">Аналитика простоя по записи</h3>
                       <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="bg-white border border-slate-200/60 rounded-xl p-3 text-center shadow-xs">
                             <div className="text-[9px] font-bold uppercase text-slate-400 mb-1 font-mono">Дни отдыха водит.</div>
                             <div className="text-lg font-black text-[#107c41]">{getDaysBetween(modalData.dateArrival, modalData.dateLoading)}</div>
                          </div>
                          <div className="bg-white border border-slate-200/60 rounded-xl p-3 text-center shadow-xs">
                             <div className="text-[9px] font-bold uppercase text-slate-400 mb-1 font-mono">Ожидание ремонта</div>
                             <div className="text-lg font-black text-rose-600">{getDaysBetween(modalData.dateArrival, modalData.dateRepairStart)}</div>
                          </div>
                          <div className="bg-white border border-slate-200/60 rounded-xl p-3 text-center shadow-xs">
                             <div className="text-[9px] font-bold uppercase text-slate-400 mb-1 font-mono">Дни ремонта</div>
                             <div className="text-lg font-black text-[#3765F6]">{getDaysBetween(modalData.dateRepairStart, modalData.dateRepairEnd)}</div>
                          </div>
                          <div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-3 text-center">
                             <div className="text-[9px] font-black uppercase text-[#107c41] mb-1 font-mono">Общий простой</div>
                             <div className="text-lg font-black text-[#107c41]">{getDaysBetween(modalData.dateArrival, modalData.dateDeparture)}</div>
                          </div>
                       </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                       <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Госномер авто</label>
                          <input disabled={!canEditField('carNumber')} value={modalData.carNumber||''} onChange={e=>setModalData({...modalData, carNumber: e.target.value.toUpperCase()})} onBlur={e=>updateCarField(modalData.id, 'carNumber', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold uppercase disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition" />
                       </div>
                       <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">ФИО Водителя</label>
                          <input disabled={!canEditField('driverName')} list="baza-drivers-dl" value={modalData.driverName||''} onChange={e=>setModalData({...modalData, driverName: e.target.value})} onBlur={e=>updateCarField(modalData.id, 'driverName', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition" />
                       </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
                       <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono truncate" title="Прибыл на базу">Прибыл на базу</label>
                          <input type="date" disabled={!canEditField('dateArrival')} value={modalData.dateArrival||''} onChange={e=>setModalData({...modalData, dateArrival: e.target.value})} onBlur={e=>updateCarField(modalData.id, 'dateArrival', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-2 py-2.5 text-xs font-bold disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition" />
                       </div>
                       <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-[#107c41] font-mono truncate" title="К какому числу должна быть готова машина">Готовность</label>
                          <input type="date" disabled={!canEditField('dateLoading')} value={modalData.dateLoading||''} onChange={e=>setModalData({...modalData, dateLoading: e.target.value})} onBlur={e=>updateCarField(modalData.id, 'dateLoading', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-2 py-2.5 text-xs font-bold disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition" />
                       </div>
                       <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono truncate" title="Дата подачи заявки на ремонт">Заявка на ремонт</label>
                          <input type="date" disabled={!canEditField('dateRepairStart')} value={modalData.dateRepairStart||''} onChange={e=>setModalData({...modalData, dateRepairStart: e.target.value})} onBlur={e=>updateCarField(modalData.id, 'dateRepairStart', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-2 py-2.5 text-xs font-bold disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition" />
                       </div>
                       <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono truncate" title="Дата окончания ремонта">Завершение ремонта</label>
                          <input type="date" disabled={!canEditField('dateRepairEnd')} value={modalData.dateRepairEnd||''} onChange={e=>setModalData({...modalData, dateRepairEnd: e.target.value})} onBlur={e=>updateCarField(modalData.id, 'dateRepairEnd', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-2 py-2.5 text-xs font-bold disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition" />
                       </div>
                       <div className="space-y-1.5">
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono truncate" title="Фактический выезд">Фактический выезд</label>
                          <input type="date" disabled={!canEditField('dateDeparture')} value={modalData.dateDeparture||''} onChange={e=>setModalData({...modalData, dateDeparture: e.target.value})} onBlur={e=>updateCarField(modalData.id, 'dateDeparture', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-2 py-2.5 text-xs font-bold disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition" />
                       </div>
                    </div>

                    <div className="space-y-1.5">
                       <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono">Примечание</label>
                       <input disabled={!canEditField('comment')} value={modalData.comment||''} onChange={e=>setModalData({...modalData, comment: e.target.value})} onBlur={e=>updateCarField(modalData.id, 'comment', e.target.value)} onKeyDown={handleInputKeyDown} className="w-full bg-slate-50 border border-slate-200 text-slate-800 rounded-xl px-3 py-2.5 text-xs font-bold disabled:opacity-50 outline-none focus:border-[#107c41] focus:bg-white transition duration-150" />
                    </div>

                    <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200/60 shadow-xs">
                       <h3 className="text-[10px] font-black uppercase tracking-widest text-[#107c41] mb-3 font-mono">ЖУРНАЛ ИЗМЕНЕНИЙ ЗАПИСИ</h3>
                       <div className="space-y-2 max-h-40 overflow-y-auto pr-2">
                           {modalData.history && Object.keys(modalData.history).reverse().map(hk => {
                              const h = modalData.history[hk];
                              return (
                                 <div key={hk} className="bg-white border border-slate-200/60 rounded-lg p-2.5 flex flex-col gap-1 shadow-xs">
                                    <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold font-mono">
                                       <span>{h.date}</span> • <span>{h.user}</span>
                                    </div>
                                    <div className="text-xs font-bold text-slate-800">
                                       «{h.field}»: <span className="line-through text-rose-500 mx-1">{h.old}</span> ➔ <span className="text-[#107c41] mx-1 font-bold">{h.new}</span>
                                    </div>
                                 </div>
                              );
                           })}
                           {(!modalData.history || Object.keys(modalData.history).length === 0) && <div className="text-[11px] text-slate-400 italic font-bold">Изменений еще нет</div>}
                       </div>
                    </div>
                 </div>
              </motion.div>
           </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Users Management Modal */}
      <AnimatePresence>
        {isAdminModalOpen && (
           <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
              <motion.div initial={{scale:0.95}} animate={{scale:1}} exit={{scale:0.95}} className="bg-white rounded-[2rem] w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 overflow-hidden">
                 <div className="p-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 shrink-0">
                    <h2 className="text-lg font-black uppercase tracking-tight text-slate-800 flex items-center gap-2">Права доступа модуля</h2>
                    <button onClick={() => setIsAdminModalOpen(false)} className="px-3 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-black uppercase rounded-xl transition cursor-pointer">Закрыть</button>
                 </div>
                 
                 <div className="p-6 overflow-y-auto flex-1 space-y-6">
                    <div className="bg-blue-50/40 border border-blue-100 rounded-2xl p-5 text-xs font-bold text-blue-800 leading-relaxed shadow-inner">
                       Администраторы Ratipa (root_admin) имеют полный доступ автоматически. <br/>Здесь вы можете заводить локальных пользователей Базы для ограничения их прав по конкретным полям. При входе в Ratipa с тем же именем, локальные права применятся к сотруднику.
                    </div>

                    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5">
                       <h3 className="text-sm font-black uppercase tracking-tight text-slate-800 mb-4">Добавить сотрудника (Локальная роль)</h3>
                       <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
                          <div className="space-y-1.5">
                             <label className="text-[10px] font-black uppercase bg-slate-100 px-2 rounded tracking-widest text-slate-600 font-mono">Имя (в Ratipa)</label>
                             <input value={adminForm.name} onChange={e=>setAdminForm({...adminForm, name: e.target.value})} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-400" placeholder="Aleksey" />
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[10px] font-black uppercase bg-slate-100 px-2 rounded tracking-widest text-slate-600 font-mono">Роль</label>
                             <select value={adminForm.role} onChange={e=>setAdminForm({...adminForm, role: e.target.value})} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-400">
                                <option value="Диспетчер">Диспетчер </option>
                                <option value="Механик">Механик</option>
                             </select>
                          </div>
                          <div className="space-y-1.5">
                             <label className="text-[10px] font-black uppercase bg-slate-100 px-2 rounded tracking-widest text-slate-600 font-mono">Пароль (legacy)</label>
                             <input value={adminForm.password} onChange={e=>setAdminForm({...adminForm, password: e.target.value})} className="w-full bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-blue-400" placeholder="12345" />
                          </div>
                       </div>
                       <div className="mb-4">
                          <label className="text-[10px] font-black uppercase tracking-widest text-[#107c41] font-mono block mb-2">Что может редактировать:</label>
                          <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
                             {allFields.map(f => (
                                <label key={f} className="flex items-center gap-2 bg-white px-3 py-2 rounded-lg border border-slate-200 cursor-pointer text-[11px] font-bold text-slate-700 hover:border-blue-400 transition">
                                   <input type="checkbox" checked={adminPerms[f]} onChange={(e) => setAdminPerms({...adminPerms, [f]: e.target.checked})} className="accent-blue-600 w-3.5 h-3.5 rounded-sm" />
                                   {fieldLabels[f]}
                                </label>
                             ))}
                          </div>
                       </div>
                       <button onClick={handleAddUser} className="px-5 py-2.5 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] text-[10px] font-black uppercase rounded-xl tracking-wider transition shadow-sm cursor-pointer">
                          Создать
                       </button>
                    </div>

                    <div className="overflow-x-auto border border-slate-200 rounded-2xl custom-scrollbar">
                       <table className="w-full text-left min-w-[900px] border-collapse bg-white">
                          <thead className="bg-slate-50 border-b border-slate-200">
                             <tr>
                                <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4 w-[20%]">Сотрудник</th>
                                <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4 w-[15%]">Роль</th>
                                <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 p-4 w-[60%]">Матрица разрешений</th>
                                <th className="p-4 w-[5%]"></th>
                             </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                             {systemUsers.map(u => {
                                const isRoot = u.isRootAdmin || u.name === 'Сергей';
                                return (
                                   <tr key={u.id}>
                                      <td className="p-4 align-top">
                                         <input value={u.name} onChange={e=>updateUserName(u.id, e.target.value)} className="bg-slate-50 border border-slate-200 px-2 py-1.5 text-xs font-bold rounded-lg w-full outline-none focus:border-blue-400" />
                                         {isRoot && <div className="text-[9px] font-black uppercase text-emerald-600 mt-1">Root Admin</div>}
                                      </td>
                                      <td className="p-4 align-top">
                                         <span className="text-xs font-black bg-slate-100 px-2 py-1 rounded text-slate-700 whitespace-nowrap">{u.role}</span>
                                      </td>
                                      <td className="p-4 align-top">
                                         {isRoot ? (
                                           <span className="text-[10px] font-black uppercase bg-[#e7fbe9] text-[#107c41] px-2 py-1 rounded border border-[#107c41]/30">Полный доступ (Безлимит)</span>
                                         ) : (
                                           <div className="grid grid-cols-2 gap-2">
                                              {allFields.map(f => {
                                                 const isChecked = (u.permissions && u.permissions[f] !== false);
                                                 return (
                                                   <label key={f} className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 cursor-pointer hover:text-blue-600">
                                                      <input type="checkbox" checked={isChecked} onChange={(e)=>toggleUserPerm(u.id, f, e.target.checked)} className="accent-blue-600" /> {fieldLabels[f]}
                                                   </label>
                                                 );
                                              })}
                                           </div>
                                         )}
                                      </td>
                                      <td className="p-4 text-right align-top">
                                         {!isRoot && (
                                           <button onClick={() => deleteUser(u.id, u.name)} className="w-6 h-6 bg-rose-50 text-rose-500 rounded flex items-center justify-center hover:bg-rose-100 transition"><Trash2 className="w-3.5 h-3.5"/></button>
                                         )}
                                      </td>
                                   </tr>
                                );
                             })}
                          </tbody>
                       </table>
                    </div>

                 </div>
              </motion.div>
           </motion.div>
        )}
      </AnimatePresence>

      <datalist id="baza-drivers-dl">
         {drivers.map((drv: any) => (
            <option key={drv.id} value={drv.name} />
         ))}
      </datalist>

    </div>
  );
}

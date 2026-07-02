import React, { useState, useEffect } from 'react';
import { UserProfile, AppSettings, FerryTemplate, DistancePreset, CurrencyPreset, Announcement, QuickLink, CarRateGroup, Driver } from '../../types';
import { dbService, database, onValue } from '../../firebase';
import { pdService } from '../../firebase/planDohodService';
import { ref, set, push, remove } from 'firebase/database';
import { 
  Settings, 
  Plus, 
  Trash2, 
  Anchor, 
  Compass, 
  Megaphone, 
  ExternalLink, 
  Lock,
  Truck,
  Wallet,
  MapPin,
  TrendingUp,
  Edit2,
  Users,
  Search,
  Check,
  X
} from 'lucide-react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';

interface SettingsModuleProps {
  user: UserProfile;
}

export default function SettingsModule({ user }: SettingsModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pdSettings, setPdSettings] = useState<any>({ useDistanceLookup: false, googleMapsApiKey: '' });
  
  // Dynamic directory builders
  const [ferries, setFerries] = useState<FerryTemplate[]>([]);
  const [distances, setDistances] = useState<DistancePreset[]>([]);
  const [currencies, setCurrencies] = useState<CurrencyPreset[]>([]);
  const [carRateGroups, setCarRateGroups] = useState<CarRateGroup[]>([]);

  // Local Form states (Tariff Group)
  const [stName, setStName] = useState('');
  const [stRate, setStRate] = useState<number>(0.125);
  const [stPerDiem, setStPerDiem] = useState<number | undefined>(undefined);
  const [stComment, setStComment] = useState('');

  // Local Form states (Ferry)
  const [fName, setFName] = useState('');
  const [fPrice, setFPrice] = useState<number>(0);

  // Local Form states (Currency)
  const [cCode, setCCode] = useState('');

  // Local Form states (Distance)
  const [dFrom, setDFrom] = useState('');
  const [dTo, setDTo] = useState('');
  const [dKm, setDKm] = useState<number>(0);

  // Local Form states (Announcement)
  const [annText, setAnnText] = useState('');
  const [annImportant, setAnnImportant] = useState(false);

  // Local Form states (Quick link)
  const [linkTitle, setLinkTitle] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [editingLinkId, setEditingLinkId] = useState<string | null>(null);
  const [editingLinkTitle, setEditingLinkTitle] = useState('');
  const [editingLinkUrl, setEditingLinkUrl] = useState('');

  // Local Form states (External website tabs)
  const [extTitle, setExtTitle] = useState('');
  const [extUrl, setExtUrl] = useState('');
  const [editingExtId, setEditingExtId] = useState<string | null>(null);
  const [editingExtTitle, setEditingExtTitle] = useState('');
  const [editingExtUrl, setEditingExtUrl] = useState('');
  
  // Modal for adding vehicle
  const [addingVehicleGroup, setAddingVehicleGroup] = useState<CarRateGroup | null>(null);
  const [newVehiclePlate, setNewVehiclePlate] = useState('');

  // Directions & coefficients list
  const [directions, setDirections] = useState<Record<string, number>>({});
  // Local Form states (Directions)
  const [dirName, setDirName] = useState('');
  const [dirCoeff, setDirCoeff] = useState<number>(1.0);
  const [editingDirKey, setEditingDirKey] = useState<string | null>(null);

  // Drivers Directory State
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [drName, setDrName] = useState('');
  const [drPhone, setDrPhone] = useState('');
  const [drLicense, setDrLicense] = useState('');
  const [drRateGroupId, setDrRateGroupId] = useState('');
  const [drComment, setDrComment] = useState('');
  
  // Driver Editing State
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editDrName, setEditDrName] = useState('');
  const [editDrPhone, setEditDrPhone] = useState('');
  const [editDrLicense, setEditDrLicense] = useState('');
  const [editDrRateGroupId, setEditDrRateGroupId] = useState('');
  const [editDrComment, setEditDrComment] = useState('');

  // Dispatcher-Car Mapping States
  const [dispatchers, setDispatchers] = useState<string[]>([]);
  const [knownFleet, setKnownFleet] = useState<string[]>([]);
  const [knownFleetObjects, setKnownFleetObjects] = useState<{ key: string; plate: string }[]>([]);
  const [savedCars, setSavedCars] = useState<string[]>([]);
  
  // Car Editing State
  const [editingCarKey, setEditingCarKey] = useState<string | null>(null);
  const [editCarPlate, setEditCarPlate] = useState('');
  const [newCarPlate, setNewCarPlate] = useState('');
  const [dispatchersMap, setDispatchersMap] = useState<Record<string, string>>({});
  const [activeDispSelect, setActiveDispSelect] = useState<string>('Без диспетчера');
  const [carSearchInMapping, setCarSearchInMapping] = useState<string>('');
  const [dragOverDisp, setDragOverDisp] = useState<string | null>(null);
  
  useEffect(() => {
    // Sync settings & categories
    const unsubSettings = dbService.getSettings(setSettings);
    const unsubPdSettings = pdService.subscribePlanDohodSettings(setPdSettings);
    const unsubFerries = dbService.getFerryTemplates(setFerries);
    const unsubDistances = dbService.getDistances(setDistances);
    const unsubCurrencies = dbService.getCurrencies(setCurrencies);
    const unsubCars = dbService.getCarRateGroups(setCarRateGroups);
    const unsubDirections = pdService.subscribeDirections(setDirections);
    const unsubDrivers = dbService.getDrivers(setDrivers);
    const unsubDisp = pdService.subscribeDispatchers((disp) => setDispatchers(disp));
    const unsubMap = pdService.subscribeDispatchersCarMapping((m) => setDispatchersMap(m));
    const unsubBazaCarsList = onValue(ref(database, 'known_fleet'), snap => {
      const data = snap.val() || {};
      const list = Object.entries(data).map(([key, val]) => ({
        key,
        plate: String(val)
      }));
      setKnownFleetObjects(list);
      setKnownFleet(list.map(x => x.plate));
    });
    const unsubSavedCarsList = pdService.subscribeCars(setSavedCars);

    return () => {
      unsubSettings();
      unsubPdSettings();
      unsubFerries();
      unsubDistances();
      unsubCurrencies();
      unsubCars();
      unsubDirections();
      unsubDrivers();
      unsubDisp();
      unsubMap();
      unsubBazaCarsList();
      unsubSavedCarsList();
    };
  }, []);

  const handleMapCarToDispatcher = (car: string, disp: string | null) => {
    const updatedMap = { ...dispatchersMap };
    if (!disp || disp === 'Без диспетчера') {
      delete updatedMap[car];
      dbService.logAction(user.name, user.role, 'Unmap Car', 'Settings', car, `Автомобиль ${car} отвязан от диспетчера`);
    } else {
      updatedMap[car] = disp;
      dbService.logAction(user.name, user.role, 'Map Car', 'Settings', car, `Автомобиль ${car} привязан к диспетчеру ${disp}`);
    }
    pdService.updateDispatchersCarMapping(updatedMap);
    toast(disp ? `Авто ${car} привязано к ${disp}` : `Авто ${car} отвязано`, 'success');
  };

  const handleDragStartCarMapping = (e: React.DragEvent, car: string) => {
    e.dataTransfer.setData('plane_cartype_or_id', car);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverDispCard = (e: React.DragEvent, dispKey: string) => {
    e.preventDefault();
    setDragOverDisp(dispKey);
  };

  const handleDragLeaveDispCard = (e: React.DragEvent) => {
    setDragOverDisp(null);
  };

  const handleDropOnDispCard = (e: React.DragEvent, dispKey: string) => {
    e.preventDefault();
    setDragOverDisp(null);
    const carPlates = e.dataTransfer.getData('plane_cartype_or_id');
    if (carPlates) {
      handleMapCarToDispatcher(carPlates, dispKey === 'Без диспетчера' ? null : dispKey);
    }
  };

  // --- Directions & Coefficients Presets handlers ---
  const handleAddDirection = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dirName.trim() || dirCoeff < 0) return;
    
    const formattedName = dirName.trim();
    const updatedDirections = { ...directions };
    
    // If name changed during edit, clean up the old entry
    if (editingDirKey && editingDirKey !== formattedName) {
      delete updatedDirections[editingDirKey];
    }
    
    updatedDirections[formattedName] = dirCoeff;
    pdService.addDirection(updatedDirections);
    dbService.logAction(user.name, user.role, editingDirKey ? 'Edit Direction' : 'Add Direction', 'Settings', formattedName, `${editingDirKey ? 'Обновлено' : 'Добавлено'} направление: ${formattedName} с коэф: ${dirCoeff}`);
    
    setDirName('');
    setDirCoeff(1.0);
    setEditingDirKey(null);
  };

  const handleDeleteDirection = async (nameToDel: string) => {
    if (!(await showConfirm(`Вы действительно хотите удалить направление "${nameToDel}"?`))) return;
    const updatedDirections = { ...directions };
    delete updatedDirections[nameToDel];
    pdService.removeDirection(updatedDirections);
    dbService.logAction(user.name, user.role, 'Delete Direction', 'Settings', nameToDel, `Удалено направление: ${nameToDel}`);
    if (editingDirKey === nameToDel) {
      setDirName('');
      setDirCoeff(1.0);
      setEditingDirKey(null);
    }
  };

  const handleEditClickDirection = (nameToEdit: string, cVal: number) => {
    setDirName(nameToEdit);
    setDirCoeff(cVal);
    setEditingDirKey(nameToEdit);
  };

  const handleCancelEditDirection = () => {
    setDirName('');
    setDirCoeff(1.0);
    setEditingDirKey(null);
  };

  // Save/Delete Tariffs
  const handleAddTariff = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stName || stRate <= 0) return;
    
    const newGroupId = "st_" + Date.now();
    const newGroup: CarRateGroup = {
      id: newGroupId,
      name: stName.trim(),
      rate: stRate,
      perDiemRate: stPerDiem,
      vehicles: [],
      comment: stComment.trim()
    };

    dbService.saveCarRateGroup(newGroup, user.name, user.role);
    setStName('');
    setStRate(0.125);
    setStPerDiem(undefined);
    setStComment('');
    toast("Тарифная группа успешно сохранена.", 'success');
  };

  const handleDeleteTariff = async (id: string) => {
    if (await showConfirm("Удалить эту тарифную группу?")) {
      dbService.deleteCarRateGroup(id, user.name, user.role);
    }
  };

  // Drivers Handlers
  const handleAddDriver = (e: React.FormEvent) => {
    e.preventDefault();
    if (!drName.trim()) return;

    const newDriver: Driver = {
      id: "dr_" + Date.now(),
      name: drName.trim(),
      phone: drPhone.trim(),
      license: drLicense.trim(),
      rateGroupId: drRateGroupId,
      comment: drComment.trim()
    };

    dbService.saveDriver(newDriver, user.name, user.role);
    setDrName('');
    setDrPhone('');
    setDrLicense('');
    setDrRateGroupId('');
    setDrComment('');
    toast("Водитель успешно добавлен в справочник.", 'success');
  };

  const handleDeleteDriver = async (id: string, name: string) => {
    if (await showConfirm(`Вы действительно хотите удалить водителя "${name}" из справочника?`)) {
      dbService.deleteDriver(id, user.name, user.role);
    }
  };

  const handleStartEditDriver = (drv: Driver) => {
    setEditingDriverId(drv.id);
    setEditDrName(drv.name || '');
    setEditDrPhone(drv.phone || '');
    setEditDrLicense(drv.license || '');
    setEditDrRateGroupId(drv.rateGroupId || '');
    setEditDrComment(drv.comment || '');
  };

  const handleSaveEditDriver = (id: string) => {
    if (!editDrName.trim()) {
      toast("ФИО водителя не может быть пустым!", 'error');
      return;
    }
    const updated: Driver = {
      id,
      name: editDrName.trim(),
      phone: editDrPhone.trim(),
      license: editDrLicense.trim(),
      rateGroupId: editDrRateGroupId,
      comment: editDrComment.trim()
    };
    dbService.saveDriver(updated, user.name, user.role);
    setEditingDriverId(null);
    toast("Данные водителя сохранены.", 'success');
  };

  // Known Cars (Fleet Directory) Handlers
  const handleAddKnownCar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCarPlate.trim()) return;
    const cPlate = newCarPlate.trim().toUpperCase();
    if (knownFleet.includes(cPlate)) {
      toast("Этот автомобиль уже есть в справочнике!", 'error');
      return;
    }
    const dbRef = ref(database, 'known_fleet');
    push(dbRef, cPlate);
    setNewCarPlate('');
    toast("Автомобиль добавлен в справочник.", 'success');
  };

  const handleDeleteKnownCar = async (key: string, plate: string) => {
    if (await showConfirm(`Вы действительно хотите удалить автомобиль "${plate}" из справочника?`)) {
      remove(ref(database, `known_fleet/${key}`));
      toast("Автомобиль удален из справочника.", 'success');
    }
  };

  const handleStartEditCar = (key: string, plate: string) => {
    setEditingCarKey(key);
    setEditCarPlate(plate);
  };

  const handleSaveEditCar = (key: string) => {
    if (!editCarPlate.trim()) {
      toast("Номер автомобиля не может быть пустым!", 'error');
      return;
    }
    const updatedPlate = editCarPlate.trim().toUpperCase();
    set(ref(database, `known_fleet/${key}`), updatedPlate);
    setEditingCarKey(null);
    toast("Номер автомобиля сохранен.", 'success');
  };

  // Save/Delete Ferries
  const handleAddFerry = (e: React.FormEvent) => {
    e.preventDefault();
    if (!fName || fPrice <= 0) return;
    
    const newFerry: FerryTemplate = {
      id: "ferry_" + Date.now(),
      name: fName.trim(),
      price: fPrice
    };

    dbService.saveFerryTemplate(newFerry, user.name, user.role);
    setFName('');
    setFPrice(0);
    toast("Паромный коэффициент сохранен.", 'success');
  };

  const handleDeleteFerry = (id: string) => {
    console.log(`SettingsModule: Deleting ferry ${id}`);
    dbService.deleteFerryTemplate(id, user.name, user.role);
  };

  // Save/Delete Distances
  const handleAddDistance = (e: React.FormEvent) => {
    e.preventDefault();
    if (!dFrom || !dTo || dKm <= 0) return;

    const newDist: DistancePreset = {
      id: "dist_" + Date.now(),
      from: dFrom.trim(),
      to: dTo.trim(),
      distance: dKm
    };

    dbService.saveDistance(newDist, user.name, user.role);
    setDFrom('');
    setDTo('');
    setDKm(0);
    toast("Ориентир маршрута внесен в базу.", 'success');
  };

  const handleDeleteDistance = async (id: string) => {
    if (await showConfirm("Удалить этот ориентир?")) {
      dbService.deleteDistance(id, user.name, user.role);
    }
  };

  // Currencies handlers
  const handleAddCurrency = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cCode.trim()) return;
    const code = cCode.trim().toUpperCase();
    if (currencies.some(c => c.code === code)) {
      toast("Такая валюта уже есть", "error");
      return;
    }
    const newC: CurrencyPreset = {
      id: "curr_" + Date.now().toString(),
      code: code
    };
    dbService.saveCurrency(newC, user.name, user.role);
    setCCode('');
    toast("Валюта добавлена", "success");
  };

  const handleDeleteCurrency = async (id: string) => {
    if (await showConfirm("Удалить эту валюту?")) {
      dbService.deleteCurrency(id, user.name, user.role);
    }
  };

  // Save settings (Announcements block / Bookmarks block)
  const handleAddAnnouncement = (e: React.FormEvent) => {
    e.preventDefault();
    if (!annText.trim() || !settings) return;

    const newAnn: Announcement = {
      id: "ann_" + Date.now(),
      text: annText.trim(),
      date: new Date().toLocaleDateString(),
      author: user.name,
      important: annImportant
    };

    const updated: AppSettings = {
      ...settings,
      announcements: [newAnn, ...(settings.announcements || [])]
    };

    dbService.saveSettings(updated, user.name, user.role);
    setAnnText('');
    setAnnImportant(false);
    toast("Объявление транслировано на Dashboard.", 'success');
  };

  const handleDeleteAnnouncement = (id: string) => {
    if (!settings) return;
    const updated: AppSettings = {
      ...settings,
      announcements: settings.announcements.filter(a => a.id !== id)
    };
    dbService.saveSettings(updated, user.name, user.role);
  };

  const handleAddQuickLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkTitle || !linkUrl || !settings) return;

    const newLink: QuickLink = {
      id: "link_" + Date.now(),
      title: linkTitle.trim(),
      url: linkUrl.trim()
    };

    const updated: AppSettings = {
      ...settings,
      quickLinks: [...(settings.quickLinks || []), newLink]
    };

    dbService.saveSettings(updated, user.name, user.role);
    setLinkTitle('');
    setLinkUrl('');
    toast("Ссылка выведена на Dashboard.", 'success');
  };

  const handleDeleteQuickLink = (id: string) => {
    if (!settings) return;
    const updated: AppSettings = {
      ...settings,
      quickLinks: settings.quickLinks.filter(l => l.id !== id)
    };
    dbService.saveSettings(updated, user.name, user.role);
  };

  const handleStartEditQuickLink = (link: QuickLink) => {
    setEditingLinkId(link.id);
    setEditingLinkTitle(link.title);
    setEditingLinkUrl(link.url);
  };

  const handleSaveEditQuickLink = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLinkId || !editingLinkTitle || !editingLinkUrl || !settings) return;

    const updatedLinks = (settings.quickLinks || []).map((l) => {
      if (l.id === editingLinkId) {
        return {
          ...l,
          title: editingLinkTitle.trim(),
          url: editingLinkUrl.trim()
        };
      }
      return l;
    });

    const updated: AppSettings = {
      ...settings,
      quickLinks: updatedLinks
    };

    dbService.saveSettings(updated, user.name, user.role);
    setEditingLinkId(null);
    setEditingLinkTitle('');
    setEditingLinkUrl('');
    toast("Ссылка успешно обновлена.", 'success');
  };

  const handleAddExternalTab = (e: React.FormEvent) => {
    e.preventDefault();
    if (!extTitle || !extUrl || !settings) return;

    const newTab = {
      id: "ext_" + Date.now(),
      title: extTitle.trim(),
      url: extUrl.trim()
    };

    const updated: AppSettings = {
      ...settings,
      externalTabs: [...(settings.externalTabs || []), newTab]
    };

    dbService.saveSettings(updated, user.name, user.role);
    setExtTitle('');
    setExtUrl('');
    toast("Вкладка выведена на панель навигации.", 'success');
  };

  const handleDeleteExternalTab = (id: string) => {
    if (!settings) return;
    const updated: AppSettings = {
      ...settings,
      externalTabs: (settings.externalTabs || []).filter(t => t.id !== id)
    };
    dbService.saveSettings(updated, user.name, user.role);
  };

  const handleStartEditExternalTab = (tab: any) => {
    setEditingExtId(tab.id);
    setEditingExtTitle(tab.title);
    setEditingExtUrl(tab.url);
  };

  const handleSaveEditExternalTab = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingExtId || !editingExtTitle || !editingExtUrl || !settings) return;

    const updatedTabs = (settings.externalTabs || []).map((t) => {
      if (t.id === editingExtId) {
        return {
          ...t,
          title: editingExtTitle.trim(),
          url: editingExtUrl.trim()
        };
      }
      return t;
    });

    const updated: AppSettings = {
      ...settings,
      externalTabs: updatedTabs
    };

    dbService.saveSettings(updated, user.name, user.role);
    setEditingExtId(null);
    setEditingExtTitle('');
    setEditingExtUrl('');
    toast("Вкладка успешно обновлена.", 'success');
  };

  // Guard view options
  if (user.permissions.settings === 'none') {
    return (
      <div className="bg-white rounded-[2rem] p-8 shadow-[0_8px_30px_rgba(0,0,0,0.01)] border border-slate-200/50 text-center flex flex-col justify-center items-center py-24 select-none">
        <Lock className="h-12 w-12 text-slate-400 mb-4" style={{ strokeWidth: 1.5 }} />
        <span className="text-sm font-black text-slate-900 uppercase font-mono tracking-wider">Раздел заблокирован</span>
        <p className="text-xs text-slate-500 max-w-xs mt-2 font-medium">
          Просмотр справочников закрыт в соответствии с политикой администратора.
        </p>
      </div>
    );
  }

  const isWritePermitted = user.permissions.settings === 'write';

  const allCars = Array.from(new Set([
    ...drivers.map(d => (typeof d === 'object' ? d?.plate || d?.carNumber || d?.number : d)),
    ...carRateGroups.flatMap(g => (g.vehicles || []).map(v => (typeof v === 'object' ? v?.plate || v?.carNumber || v?.number : v))),
    ...knownFleet.map(v => (typeof v === 'object' ? v?.plate || v?.carNumber || v?.number || v?.name : v)),
    ...savedCars.map(v => (typeof v === 'object' ? v?.plate || v?.carNumber || v?.number || v?.name : v))
  ]
    .map(p => {
      if (typeof p === 'object' && p !== null) {
        return (p.plate || p.carNumber || p.number || p.name || '').toString();
      }
      return p ? String(p) : '';
    })
    .map(p => p.trim().toUpperCase())
    .filter(Boolean)
  ));

  return (
    <div className="w-full space-y-6 font-sans">
      
      {/* GRAPHICAL VEHICLE DISPATCHER MAPPING BLOCK */}
      <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
           <div>
              <h2 className="text-xl font-black text-slate-900 uppercase tracking-tight mt-1.5 flex items-center gap-2">
                 <Users className="h-5 w-5 text-blue-500" /> Интерактивная привязка авто к диспетчерам
              </h2>
              <p className="text-xs text-slate-400 mt-1 font-mono">
                 Перетаскивайте карточки автомобилей из правой колонки во вкладки диспетчеров слева для мгновенной привязки.
              </p>
           </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-8">
           {/* LEFT COLUMN: Dispatchers Tabs */}
           <div className="lg:col-span-2 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-1 mb-2">
                 <span className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider">
                    Диспетчеры
                 </span>
                 <span className="text-[10px] text-slate-400 font-mono">
                    {dispatchers.length} активных
                 </span>
              </div>
              
              <div className="space-y-2 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                 {/* "Без диспетчера" Card */}
                 <div 
                    onDragOver={(e) => handleDragOverDispCard(e, 'Без диспетчера')}
                    onDragLeave={handleDragLeaveDispCard}
                    onDrop={(e) => handleDropOnDispCard(e, 'Без диспетчера')}
                    onClick={() => setActiveDispSelect('Без диспетчера')}
                    className={`p-4 rounded-2xl border transition cursor-pointer select-none relative ${
                       activeDispSelect === 'Без диспетчера'
                       ? 'border-red-500 bg-red-50/50 text-red-950 shadow-sm'
                       : 'border-slate-200 hover:border-slate-350 bg-slate-50 text-slate-700'
                    } ${dragOverDisp === 'Без диспетчера' ? 'ring-2 ring-red-500 ring-dashed border-red-500 scale-[1.02]' : ''}`}
                 >
                    <div className="flex justify-between items-center">
                       <div className="flex items-center gap-2">
                          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                          <strong className="text-xs font-black uppercase tracking-wider">Без диспетчера</strong>
                       </div>
                       <span className="bg-white/85 border border-slate-150 px-2.5 py-0.5 rounded-md font-mono text-[10px] font-black text-slate-600">
                          {allCars.filter(c => !dispatchersMap[c]).length} авто
                       </span>
                    </div>
                    <p className="text-[9px] text-slate-400 font-mono mt-1 uppercase tracking-wide">
                       Область сброса для отмены привязки
                    </p>
                 </div>

                 {/* Dispatchers List */}
                 {dispatchers.map((dispName) => {
                    const countAssigned = allCars.filter(c => dispatchersMap[c] === dispName).length;
                    return (
                       <div 
                          key={dispName}
                          onDragOver={(e) => handleDragOverDispCard(e, dispName)}
                          onDragLeave={handleDragLeaveDispCard}
                          onDrop={(e) => handleDropOnDispCard(e, dispName)}
                          onClick={() => setActiveDispSelect(dispName)}
                          className={`p-4 rounded-2xl border transition cursor-pointer select-none relative ${
                             activeDispSelect === dispName
                             ? 'border-blue-500 bg-blue-50/50 text-blue-950 shadow-sm'
                             : 'border-slate-200 hover:border-slate-350 bg-white text-slate-700'
                          } ${dragOverDisp === dispName ? 'ring-2 ring-blue-500 ring-dashed border-blue-500 scale-[1.02]' : ''}`}
                       >
                          <div className="flex justify-between items-center">
                             <div className="flex items-center gap-2">
                                <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                                <strong className="text-xs font-black uppercase tracking-wider">{dispName}</strong>
                             </div>
                             <span className="bg-slate-50 border border-slate-200/50 px-2.5 py-0.5 rounded-md font-mono text-[10px] font-black text-slate-600">
                                {countAssigned} авто
                             </span>
                          </div>
                          <p className="text-[9px] text-slate-400 font-mono mt-1 uppercase tracking-wide">
                             Нажмите для просмотра закрепленных авто
                          </p>
                       </div>
                    );
                 })}
              </div>

              {/* Selected Dispatcher's Cars view below */}
              <div className="bg-slate-50 border border-slate-205 rounded-2xl p-4 mt-4">
                 <h3 className="text-[10px] font-black uppercase text-slate-500 font-mono tracking-wider mb-3">
                    Закреплено за: <span className="text-blue-600 underline font-sans font-extrabold uppercase">{activeDispSelect}</span>
                 </h3>
                 <div className="space-y-1.5 max-h-[220px] overflow-y-auto custom-scrollbar">
                    {allCars.filter(c => activeDispSelect === 'Без диспетчера' ? !dispatchersMap[c] : dispatchersMap[c] === activeDispSelect).map(c => (
                       <div 
                          key={c}
                          draggable={isWritePermitted}
                          onDragStart={(e) => handleDragStartCarMapping(e, c)}
                          className="bg-white border border-slate-200 p-2.5 rounded-xl flex items-center justify-between text-xs font-bold hover:shadow-xs hover:border-slate-300 transition cursor-move group select-none"
                       >
                          <span className="font-mono text-slate-800 uppercase tracking-widest">{c}</span>
                          {isWritePermitted && activeDispSelect !== 'Без диспетчера' && (
                             <button 
                                onClick={() => handleMapCarToDispatcher(c, null)}
                                className="text-[9px] font-black text-rose-500 hover:bg-rose-50 px-2 py-1 rounded transition uppercase"
                             >
                                Отвязать
                             </button>
                          )}
                       </div>
                    ))}
                    {allCars.filter(c => activeDispSelect === 'Без диспетчера' ? !dispatchersMap[c] : dispatchersMap[c] === activeDispSelect).length === 0 && (
                       <div className="text-center py-6 text-[10px] font-black uppercase text-slate-450 tracking-widest font-mono select-none">
                          Нет закрепленных автомобилей
                       </div>
                    )}
                 </div>
              </div>
           </div>

           {/* RIGHT COLUMN: All Cars in DB base */}
           <div className="lg:col-span-3 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-1 mb-2">
                 <span className="text-[10px] font-black uppercase text-slate-400 font-mono tracking-wider block">
                    База Автомобилей ({allCars.length} шт)
                 </span>
                 <div className="relative w-full sm:w-48">
                    <input 
                       type="text" 
                       placeholder="Быстрый поиск авто..." 
                       value={carSearchInMapping}
                       onChange={(e) => setCarSearchInMapping(e.target.value)}
                       className="w-full bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wide outline-none focus:border-blue-400"
                    />
                 </div>
              </div>

              <div className="flex flex-col gap-2 max-h-[450px] overflow-y-auto pr-1 custom-scrollbar">
                 {allCars
                    .filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase()))
                    .map((carPlate) => {
                       const currentDisp = dispatchersMap[carPlate];
                       return (
                          <div 
                             key={carPlate}
                             draggable={isWritePermitted}
                             onDragStart={(e) => handleDragStartCarMapping(e, carPlate)}
                             className={`p-3 px-4 rounded-xl border transition relative select-none flex items-center justify-between cursor-move shadow-xs hover:shadow-sm ${
                                 currentDisp 
                                 ? "border-indigo-150 bg-indigo-50/30" 
                                 : "border-slate-200 bg-white hover:border-slate-350"
                              }`}
                           >
                              <div className="flex items-center gap-3">
                                 <div className="flex flex-col gap-0.5 text-slate-300">
                                    <div className="flex gap-0.5">
                                       <span className="w-1 h-1 rounded-full bg-slate-400/60" />
                                       <span className="w-1 h-1 rounded-full bg-slate-400/60" />
                                    </div>
                                    <div className="flex gap-0.5">
                                       <span className="w-1 h-1 rounded-full bg-slate-400/60" />
                                       <span className="w-1 h-1 rounded-full bg-slate-400/60" />
                                    </div>
                                 </div>
                                 <span className="text-xs font-black font-mono tracking-wider text-slate-900 uppercase">
                                    {carPlate}
                                 </span>
                              </div>
                              
                              <div className="flex items-center gap-3">
                                 <span className="text-[10px] font-mono">
                                    {currentDisp ? (
                                       <span className="text-blue-600 font-bold">Диспетчер: {currentDisp}</span>
                                    ) : (
                                       <span className="text-slate-400 font-medium">Свободен</span>
                                    )}
                                 </span>
                                 <span className={`${currentDisp ? "bg-indigo-100 text-indigo-800" : "bg-slate-100 text-slate-500"} text-[8px] font-black uppercase px-2 py-0.5 rounded font-mono tracking-wider`}>
                                    {currentDisp ? "OK" : "FREE"}
                                 </span>
                              </div>
                           </div>
                        );
                     })}
              </div>
           </div>
        </div>
      </div>
      
      {/* Global Rates Settings */}
      <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-6">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3">
          <Settings className="h-4 w-4 text-slate-900" style={{ fill: '#70FC8E' }} />
          Глобальные настройки и Таблицы
        </h2>
        {settings && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-2">Ставка простоя (€/день)</label>
                <input
                  type="number"
                  defaultValue={settings.idleRate}
                  onBlur={(e) => dbService.saveSettings({...settings, idleRate: Number(e.target.value)}, user.name, user.role)}
                  className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black focus:outline-none focus:border-slate-400"
                />
              </div>
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-2">Ставка суточных (€/день)</label>
                <input
                  type="number"
                  defaultValue={settings.perDiemRate}
                  onBlur={(e) => dbService.saveSettings({...settings, perDiemRate: Number(e.target.value)}, user.name, user.role)}
                  className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black focus:outline-none focus:border-slate-400"
                />
              </div>
            </div>

            <div className="border border-slate-200 rounded-2xl p-4 sm:p-6 bg-slate-50/50 space-y-4">
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                <ExternalLink className="w-4 h-4 text-emerald-500" />
                Ссылки на Google Таблицы (Фреймы)
              </h3>
              <p className="text-xs text-slate-500 font-medium pb-2 border-b border-slate-200">
                Вставьте прямые ссылки на Google Таблицы. Рекомендуется использовать формат <code>/edit</code> для сохранения панели инструментов.
              </p>
              
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5">План Загрузок (План)</label>
                  <input
                    type="url"
                    defaultValue={settings.planZagruzokSheetUrl || ''}
                    onBlur={(e) => dbService.saveSettings({...settings, planZagruzokSheetUrl: e.target.value}, user.name, user.role)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-400 transition"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5">План Загрузок (Черный Список)</label>
                  <input
                    type="url"
                    defaultValue={settings.planZagruzokBlacklistUrl || ''}
                    onBlur={(e) => dbService.saveSettings({...settings, planZagruzokBlacklistUrl: e.target.value}, user.name, user.role)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-red-400 transition"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                </div>
                <div>
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5">Диспозиция</label>
                  <input
                    type="url"
                    defaultValue={settings.dispositionSheetUrl || ''}
                    onBlur={(e) => dbService.saveSettings({...settings, dispositionSheetUrl: e.target.value}, user.name, user.role)}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-400 transition"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex flex-col gap-4 mt-6">
                 <h3 className="text-xs font-bold text-slate-800 tracking-tight uppercase">Ссылки на GPS провайдеров</h3>
                 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"/> Белтрансспутник</label>
                      <input
                        type="url"
                        defaultValue={settings.gpsBeltranssputnikUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsBeltranssputnikUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-400 transition"
                        placeholder="https://..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block"/> Wialon</label>
                      <input
                        type="url"
                        defaultValue={settings.gpsWialonUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsWialonUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-orange-400 transition"
                        placeholder="https://..."
                      />
                    </div>
                    <div>
                      <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5 flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block"/> ЭРА ГЛОНАСС</label>
                      <input
                        type="url"
                        defaultValue={settings.gpsEraGlonassUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsEraGlonassUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-400 transition"
                        placeholder="https://..."
                      />
                    </div>
                 </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Google Maps API Settings */}
      <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
          <MapPin className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
          Настройки интеграции карт и расчета расстояний
        </h2>
        <div className="space-y-4 text-xs font-medium text-slate-650">
          <p className="text-slate-500">
            Здесь вы можете выбрать провайдера для автоматического расчёта маршрутов и расстояний в плечах "Калькуляции" и "Планировании Доходов". Мы рекомендуем использовать бесплатный OSRM или OpenRouteService в качестве замены Google Maps Directions API.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-start">
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono">Провайдер маршрутов</label>
                <select
                  disabled={!isWritePermitted}
                  value={pdSettings?.routingProvider || 'osrm'}
                  onChange={(e) => {
                    pdService.updatePlanDohodSettings({
                      ...pdSettings,
                      routingProvider: e.target.value
                    });
                    toast(`Провайдер изменен на ${e.target.value === 'osrm' ? 'OSRM' : 'OpenRouteService'}`, "success");
                  }}
                  className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-450"
                >
                  <option value="osrm">OSRM (Без ключа, бесплатно)</option>
                  <option value="openrouteservice">OpenRouteService API (Требуется ключ)</option>
                </select>
              </div>

              <label className="flex items-center gap-3 cursor-pointer select-none bg-slate-50 border border-slate-200 p-4 rounded-xl hover:bg-slate-100 transition">
                <input
                  type="checkbox"
                  disabled={!isWritePermitted}
                  checked={pdSettings?.useDistanceLookup !== false}
                  onChange={(e) => {
                    pdService.updatePlanDohodSettings({
                      ...pdSettings,
                      useDistanceLookup: e.target.checked
                    });
                    toast(e.target.checked ? "Автоматический расчет расстояний включен" : "Автоматический расчет расстояний выключен", "success");
                  }}
                  className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                />
                <div className="flex flex-col">
                  <span className="font-black text-slate-800 text-xs">Использовать автоматический расчет расстояний</span>
                  <span className="text-[10px] text-slate-400 font-mono font-bold uppercase tracking-wider">При отсутствии расстояния в справочнике предустановок</span>
                </div>
              </label>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-2">OpenRouteService API Key</label>
                <input
                  type="password"
                  disabled={!isWritePermitted}
                  value={pdSettings?.openRouteServiceApiKey || ''}
                  onChange={(e) => {
                    pdService.updatePlanDohodSettings({
                      ...pdSettings,
                      openRouteServiceApiKey: e.target.value
                    });
                  }}
                  placeholder="5b3ce3597851110001cf6248..."
                  className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-450 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1.5 font-medium leading-normal">
                  Получите бесплатный ключ API на сайте <a href="https://openrouteservice.org" target="_blank" rel="noreferrer" className="text-blue-500 hover:underline">openrouteservice.org</a>. Ключ используется для построения маршрутов и точного расчёта км.
                </p>
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-2">Google Maps Geocoding API Key (Резервный / Для карт)</label>
                <input
                  type="password"
                  disabled={!isWritePermitted}
                  value={pdSettings?.googleMapsApiKey || ''}
                  onChange={(e) => {
                    pdService.updatePlanDohodSettings({
                      ...pdSettings,
                      googleMapsApiKey: e.target.value
                    });
                  }}
                  placeholder="AIzaSy..."
                  className="w-full px-3.5 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-450 font-mono"
                />
                <p className="text-[10px] text-slate-400 mt-1.5 font-medium leading-normal">
                  Ключ используется для геокодирования адресов в координаты. Если оставить пустым, используется системный ключ Google Maps.
                </p>
              </div>
            </div>

            <div className="bg-[#70FC8E]/5 border border-[#70FC8E]/20 p-5 rounded-2xl space-y-3 text-slate-700">
              <div className="flex items-center gap-2 font-black text-xs text-slate-900 uppercase tracking-tight">
                <span className={`w-2.5 h-2.5 rounded-full ${ (pdSettings?.openRouteServiceApiKey || pdSettings?.googleMapsApiKey || process.env.GOOGLE_MAPS_PLATFORM_KEY) ? 'bg-emerald-500' : 'bg-amber-500' } animate-pulse`} />
                Статус интеграции: { (pdSettings?.openRouteServiceApiKey || pdSettings?.googleMapsApiKey || process.env.GOOGLE_MAPS_PLATFORM_KEY) ? 'АКТИВНА' : 'ТРЕБУЕТСЯ НАСТРОЙКА' }
              </div>
              <p className="leading-relaxed text-[11px] text-slate-600 font-medium">
                Система использует карты Google Maps для отображения, но вычисления маршрутов и километража выполняются через выбранный вами сервис. При отсутствии ключа OpenRouteService система рассчитает расстояние в обход по прямой (функция Haversine).
              </p>
              <div className="text-[10px] text-slate-400 space-y-1 pt-2.5 border-t border-slate-200/50">
                <div>• Провайдер: { pdSettings?.routingProvider === 'openrouteservice' ? 'OpenRouteService API' : 'OSRM API (Без ключа)' }</div>
                <div>• Ключ OpenRouteService: { pdSettings?.openRouteServiceApiKey ? 'Установлен' : 'Не найден (используется резервный режим)' }</div>
                <div>• Ключ Google Maps (Геокодирование): { pdSettings?.googleMapsApiKey ? 'Установлен вручную (Firebase)' : (process.env.GOOGLE_MAPS_PLATFORM_KEY ? 'Установлен (AI Studio)' : 'Не найден') }</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ROW 0: TARIFF GROUPS */}
      <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
          <Truck className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
          Тарифные группы (Зарплата и Авто)
        </h2>

        {isWritePermitted && (
            <form onSubmit={handleAddTariff} className="grid grid-cols-1 sm:grid-cols-5 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="Название (Группа 0.14)"
                required
                value={stName}
                onChange={(e) => setStName(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <input
                type="number"
                step="0.001"
                placeholder="Тариф за км (€)"
                required
                value={stRate || ''}
                onChange={(e) => setStRate(Number(e.target.value))}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <input
                type="number"
                placeholder="Суточные (€/день)"
                value={stPerDiem || ''}
                onChange={(e) => setStPerDiem(e.target.value ? Number(e.target.value) : undefined)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <input
                type="text"
                placeholder="Комментарий (опционально)"
                value={stComment}
                onChange={(e) => setStComment(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 sm:col-span-1"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-xs font-black uppercase tracking-tight transition cursor-pointer">
                Создать группу
              </button>
            </form>
          )}

        <div className="space-y-4">
          {carRateGroups.map((group) => (
            <div key={group.id} className="p-4 bg-slate-50 rounded-2xl border border-slate-200">
               <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
                 <div>
                   <span className="font-black text-sm text-slate-900">{group.name || 'Без названия'}</span>
                   <span className="font-bold text-xs text-slate-500 ml-2">Тариф: {group.rate} €/км</span>
                   {group.perDiemRate !== undefined && group.perDiemRate > 0 && (
                     <span className="font-bold text-xs text-indigo-500 ml-2">Суточные: {group.perDiemRate} €/д</span>
                   )}
                   {group.comment && <div className="text-[10px] text-slate-400 mt-0.5">{group.comment}</div>}
                 </div>
                 {isWritePermitted && (
                   <button onClick={() => handleDeleteTariff(group.id)} className="text-rose-500 p-2 hover:bg-rose-50 rounded-lg transition self-start sm:self-auto"><Trash2 className="h-4 w-4"/></button>
                 )}
               </div>
               <div className="flex flex-wrap gap-2 text-[10px] font-bold text-slate-700">
                 {(group.vehicles || []).map((v, i) => (
                   <span key={`${group.id}-${i}-${v}`} className="bg-white px-2 py-1 rounded border border-slate-200 flex items-center gap-1">
                     {v}
                     {isWritePermitted && <button onClick={() => dbService.saveCarRateGroup({...group, vehicles: group.vehicles.filter(x => x !== v)}, user.name, user.role)} className="ml-1 text-slate-400">×</button>}
                   </span>
                 ))}
                 {isWritePermitted && (
                   <button 
                     onClick={() => {
                        setAddingVehicleGroup(group);

                     }}
                     className="bg-slate-200 px-2 py-1 rounded text-slate-600 shadow-sm border border-slate-300 hover:bg-slate-300 transition"
                    >+ Добавить авто</button>
                 )}
               </div>
            </div>
          ))}
          {!carRateGroups.length && (
              <div className="text-center py-6 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Группы не созданы.</div>
          )}
        </div>
        
        {/* Modal for adding vehicle */}
        {addingVehicleGroup && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white p-6 rounded-2xl w-full max-w-sm space-y-4">
              <h3 className="font-black text-sm">Добавить авто в {addingVehicleGroup.name}</h3>
              <input
                type="text"
                className="w-full p-2 border rounded-xl text-xs"
                placeholder="ГОС. НОМЕР"
                value={newVehiclePlate}
                onChange={(e) => setNewVehiclePlate(e.target.value)}
              />
              <div className="flex gap-2">
                <button onClick={() => setAddingVehicleGroup(null)} className="flex-1 bg-slate-100 p-2 rounded-xl text-xs font-bold">Отмена</button>
                <button 
                  onClick={() => {
                     const normalized = newVehiclePlate.toUpperCase().trim().replace(/\s+/g, ' ');
                     if (normalized && !addingVehicleGroup.vehicles?.includes(normalized)) {
                        dbService.saveCarRateGroup({...addingVehicleGroup, vehicles: [...(addingVehicleGroup.vehicles || []), normalized]}, user.name, user.role);
                        setAddingVehicleGroup(null);
                        setNewVehiclePlate('');
                     }
                  }} 
                  className="flex-1 bg-slate-900 text-white p-2 rounded-xl text-xs font-bold"
                >Добавить</button>
              </div>
            </div>
          </div>
        )}

      </div>

      {/* ROW 1: DRIVERS DIRECTORY */}
      <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
          <Users className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
          Справочник водителей (Активная база)
        </h2>

        {isWritePermitted && (
          <form onSubmit={handleAddDriver} className="grid grid-cols-1 md:grid-cols-5 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
            <input
              type="text"
              placeholder="ФИО Водителя"
              required
              value={drName}
              onChange={(e) => setDrName(e.target.value)}
              className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 text-slate-800"
            />
            <input
              type="text"
              placeholder="Телефон"
              value={drPhone}
              onChange={(e) => setDrPhone(e.target.value)}
              className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 text-slate-800"
            />
            <input
              type="text"
              placeholder="Удостоверение"
              value={drLicense}
              onChange={(e) => setDrLicense(e.target.value)}
              className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 text-slate-800"
            />
            <select
              value={drRateGroupId}
              onChange={(e) => setDrRateGroupId(e.target.value)}
              className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold text-slate-700"
            >
              <option value="">Тарифная группа</option>
              {carRateGroups.map(g => (
                <option key={g.id} value={g.id}>{g.name}</option>
              ))}
            </select>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Комментарий"
                value={drComment}
                onChange={(e) => setDrComment(e.target.value)}
                className="flex-1 p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 text-slate-800"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase tracking-wider px-4 transition cursor-pointer shrink-0">
                Добавить
              </button>
            </div>
          </form>
        )}

        <div className="overflow-x-auto border border-slate-200/60 rounded-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 font-mono border-b border-slate-250/30">
                <th className="px-4 py-3">ФИО водителя</th>
                <th className="px-4 py-3">Телефон</th>
                <th className="px-4 py-3">Удостоверение</th>
                <th className="px-4 py-3">Тарифная группа</th>
                <th className="px-4 py-3">Комментарий</th>
                {isWritePermitted && <th className="px-4 py-3 text-right">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {drivers.map((drv) => {
                const isEditing = editingDriverId === drv.id;
                return (
                  <tr key={drv.id} className="hover:bg-slate-50/40 transition">
                    <td className="px-4 py-3 font-black text-slate-900">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDrName}
                          onChange={(e) => setEditDrName(e.target.value)}
                          className="p-1.5 bg-white text-xs rounded-lg border border-slate-300 font-bold w-full outline-none"
                        />
                      ) : (
                        drv.name
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDrPhone}
                          onChange={(e) => setEditDrPhone(e.target.value)}
                          className="p-1.5 bg-white text-xs rounded-lg border border-slate-300 font-bold w-full outline-none"
                        />
                      ) : (
                        drv.phone || <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDrLicense}
                          onChange={(e) => setEditDrLicense(e.target.value)}
                          className="p-1.5 bg-white text-xs rounded-lg border border-slate-300 font-bold w-full outline-none"
                        />
                      ) : (
                        drv.license || <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <select
                          value={editDrRateGroupId}
                          onChange={(e) => setEditDrRateGroupId(e.target.value)}
                          className="p-1.5 bg-white text-xs rounded-lg border border-slate-300 font-bold w-full outline-none text-slate-700"
                        >
                          <option value="">Не назначена</option>
                          {carRateGroups.map(g => (
                            <option key={g.id} value={g.id}>{g.name}</option>
                          ))}
                        </select>
                      ) : (
                        carRateGroups.find(g => g.id === drv.rateGroupId)?.name || <span className="text-slate-300">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editDrComment}
                          onChange={(e) => setEditDrComment(e.target.value)}
                          className="p-1.5 bg-white text-xs rounded-lg border border-slate-300 font-bold w-full outline-none"
                        />
                      ) : (
                        drv.comment || <span className="text-slate-300">—</span>
                      )}
                    </td>
                    {isWritePermitted && (
                      <td className="px-4 py-3 text-right">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => handleSaveEditDriver(drv.id)}
                              className="text-emerald-600 p-1.5 hover:bg-emerald-50 rounded-lg transition"
                              title="Сохранить изменения"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setEditingDriverId(null)}
                              className="text-slate-400 p-1.5 hover:bg-slate-100 rounded-lg transition"
                              title="Отмена"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => handleStartEditDriver(drv)}
                              className="text-indigo-600 p-1.5 hover:bg-indigo-50 rounded-lg transition"
                              title="Редактировать водителя"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteDriver(drv.id, drv.name)}
                              className="text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition"
                              title="Удалить из базы"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {drivers.length === 0 && (
                <tr>
                  <td colSpan={isWritePermitted ? 6 : 5} className="text-center py-6 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50">
                    Водители не зарегистрированы.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

      </div>

      {/* ROW 1.5: VEHICLES DIRECTORY */}
      <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
          <Truck className="h-4.5 w-4.5 text-slate-900 font-bold" />
          Справочник автомобилей (База автопарка)
        </h2>

        {isWritePermitted && (
          <form onSubmit={handleAddKnownCar} className="flex gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
            <input
              type="text"
              placeholder="Гос. Номер автомобиля (например, 1234 AB-7)"
              required
              value={newCarPlate}
              onChange={(e) => setNewCarPlate(e.target.value)}
              className="flex-1 p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400 text-slate-800 uppercase"
            />
            <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-xs font-black uppercase tracking-tight py-2.5 px-6 transition cursor-pointer shrink-0">
              Добавить автомобиль
            </button>
          </form>
        )}

        <div className="overflow-x-auto border border-slate-200/60 rounded-2xl">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 font-mono border-b border-slate-250/30">
                <th className="px-4 py-3">Государственный Номер</th>
                {isWritePermitted && <th className="px-4 py-3 text-right w-[150px]">Действия</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
              {knownFleetObjects.map((item) => {
                const isEditing = editingCarKey === item.key;
                return (
                  <tr key={item.key} className="hover:bg-slate-50/40 transition">
                    <td className="px-4 py-3 font-black text-slate-900 font-mono tracking-wider uppercase">
                      {isEditing ? (
                        <input
                          type="text"
                          value={editCarPlate}
                          onChange={(e) => setEditCarPlate(e.target.value)}
                          className="p-1.5 bg-white text-xs rounded-lg border border-slate-300 font-bold w-full max-w-[250px] outline-none uppercase font-mono tracking-wider text-slate-800"
                        />
                      ) : (
                        item.plate
                      )}
                    </td>
                    {isWritePermitted && (
                      <td className="px-4 py-3 text-right w-[150px]">
                        {isEditing ? (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => handleSaveEditCar(item.key)}
                              className="text-emerald-600 p-1.5 hover:bg-emerald-50 rounded-lg transition"
                              title="Сохранить изменения"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setEditingCarKey(null)}
                              className="text-slate-400 p-1.5 hover:bg-slate-100 rounded-lg transition"
                              title="Отмена"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="flex gap-1 justify-end">
                            <button
                              onClick={() => handleStartEditCar(item.key, item.plate)}
                              className="text-indigo-600 p-1.5 hover:bg-indigo-50 rounded-lg transition"
                              title="Редактировать номер"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteKnownCar(item.key, item.plate)}
                              className="text-rose-500 p-1.5 hover:bg-rose-50 rounded-lg transition"
                              title="Удалить из базы"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
              {knownFleetObjects.length === 0 && (
                <tr>
                  <td colSpan={isWritePermitted ? 2 : 1} className="text-center py-6 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50">
                    Автомобили не зарегистрированы.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-12">

        {/* ROW 0: DIRECTION EXPENSE COEFFICIENTS */}
        <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <TrendingUp className="h-4.5 w-4.5 text-slate-900 font-bold" />
            Районы/направления и коэффициенты расходов
          </h2>
          <p className="text-[10px] text-slate-500 font-bold">Используется при расчете плана дохода. Задает наценку расходов на КМ по умолчанию.</p>

          {isWritePermitted && (
            <form onSubmit={handleAddDirection} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="Германия / Азия"
                required
                value={dirName}
                onChange={(e) => setDirName(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800 focus:border-slate-450"
              />
              <input
                type="number"
                step="0.01"
                placeholder="Коэф (напр. 1.2)"
                required
                value={dirCoeff}
                onChange={(e) => setDirCoeff(Number(e.target.value))}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800 focus:border-slate-450"
              />
              <div className="flex gap-1 pt-0">
                <button type="submit" className="flex-1 bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer">
                  {editingDirKey ? 'Сберечь' : 'Внести'}
                </button>
                {editingDirKey && (
                  <button 
                    type="button" 
                    onClick={handleCancelEditDirection} 
                    className="px-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-[10px] font-bold transition"
                  >
                    Отм
                  </button>
                )}
              </div>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {Object.entries(directions).map(([name, coeff]) => (
              <div key={name} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 uppercase tracking-tight flex items-center gap-1.5">
                  <MapPin size={12} className="text-slate-400" />
                  {name}
                </span>
                <div className="flex items-center gap-2">
                  <strong className="text-slate-950 font-mono font-black py-1 px-2.5 bg-slate-100 rounded-lg">x{coeff as number}</strong>
                  {isWritePermitted && (
                    <div className="flex items-center gap-1">
                      <button 
                        onClick={() => handleEditClickDirection(name, coeff as number)} 
                        className="text-blue-500 hover:text-blue-700 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-blue-200 transition cursor-pointer"
                        title="Редактировать"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button 
                        onClick={() => handleDeleteDirection(name)} 
                        className="text-rose-500 hover:text-rose-700 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {Object.keys(directions).length === 0 && (
              <div className="text-center py-10 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Направления не заполнены.</div>
            )}
          </div>
        </div>
        
        {/* ROW 1: FERRY PRICING PRESSETS */}
        <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <Anchor className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            Тарифы Паромных Линий (DFS)
          </h2>
          <p className="text-[10px] text-slate-500 font-bold">Цены указаны в EUR. Справка в другой валюте по внутреннему курсу.</p>

          {isWritePermitted && (
            <form onSubmit={handleAddFerry} className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 bg-slate-50 p-3.5 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="Откуда — Куда"
                required
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400"
              />
              <input
                type="number"
                placeholder="Цена (EUR)"
                required
                value={fPrice || ''}
                onChange={(e) => setFPrice(Number(e.target.value))}
                className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none focus:border-slate-450 font-bold placeholder:text-slate-400"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-xs font-black uppercase tracking-tight transition cursor-pointer">
                Добавить
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {ferries.map((fe) => (
              <div key={fe.id} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 uppercase tracking-tight">{fe.name}</span>
                <div className="flex items-center gap-3">
                  <strong className="text-slate-950 font-mono font-black">{fe.price} EUR</strong>
                  {isWritePermitted && (
                    <button 
                      onClick={() => handleDeleteFerry(fe.id)} 
                      className="text-rose-500 hover:text-rose-700 p-2 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!ferries.length && (
              <div className="text-center py-10 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Тарифы не внесены.</div>
            )}
          </div>
        </div>

        {/* ROW 2: DISTANCES PRESETS */}
        <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <Compass className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            База стандартных расстояний (КМ)
          </h2>

          {isWritePermitted && (
            <form onSubmit={handleAddDistance} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="От (Минск)"
                required
                value={dFrom}
                onChange={(e) => setDFrom(e.target.value)}
                className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800"
              />
              <input
                type="text"
                placeholder="До (Берлин)"
                required
                value={dTo}
                onChange={(e) => setDTo(e.target.value)}
                className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800"
              />
              <input
                type="number"
                placeholder="Расстояние"
                required
                value={dKm || ''}
                onChange={(e) => setDKm(Number(e.target.value))}
                className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer">
                Внести
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {distances.map((di) => (
              <div key={di.id} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 uppercase tracking-tight">{di.from} &rarr; {di.to}</span>
                <div className="flex items-center gap-3">
                  <strong className="text-slate-950 font-mono font-black">{di.distance} км</strong>
                  {isWritePermitted && (
                    <button 
                      onClick={() => handleDeleteDistance(di.id)} 
                      className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!distances.length && (
              <div className="text-center py-10 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Маршруты не заполнены.</div>
            )}
          </div>
        </div>

        {/* CURRENCIES PRESETS */}
        <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3 mb-4">
            <Wallet className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            Справочник Валют
          </h2>

          {isWritePermitted && (
            <form onSubmit={handleAddCurrency} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50">
              <input
                type="text"
                placeholder="Код (USD, EUR...)"
                required
                value={cCode}
                onChange={(e) => setCCode(e.target.value)}
                className="col-span-3 p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-[10px] font-bold text-slate-800"
              />
              <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase tracking-wider transition cursor-pointer">
                Внести
              </button>
            </form>
          )}

          <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
            {currencies.map((c) => (
              <div key={c.id} className="flex justify-between items-center p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-200/20 group hover:border-slate-300/60 transition duration-100">
                <span className="text-slate-800 tracking-tight font-black">{c.code}</span>
                <div className="flex items-center gap-3">
                  {isWritePermitted && (
                    <button 
                      onClick={() => handleDeleteCurrency(c.id)} 
                      className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
            {!currencies.length && (
              <div className="text-center py-10 text-slate-400 text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">Валюты не заданы.</div>
            )}
          </div>
        </div>

        {/* ROW 3: BOOKMARKS / EXTERNAL QUICK LINKS & IFRAMES */}
        <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-6">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5 border-b border-slate-100 pb-3">
            <ExternalLink className="h-4.5 w-4.5 text-slate-900 font-bold" style={{ fill: '#70FC8E' }} />
            Ссылки на Информационные Фреймы и Полезные Ссылки
          </h2>

          {/* BAMAP & ASMAP Iframe URL Customization */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-2xl border border-slate-200/50">
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block"/> Адрес фрейма БАМАП
              </label>
              <input
                type="url"
                disabled={!isWritePermitted}
                placeholder="https://bamap.org/information/news/"
                defaultValue={settings?.bamapUrl || ''}
                onBlur={(e) => {
                  if (!settings) return;
                  dbService.saveSettings({...settings, bamapUrl: e.target.value}, user.name, user.role);
                  toast("Ссылка фрейма БАМАП сохранена", "success");
                }}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-400 transition"
              />
            </div>
            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block font-mono mb-1.5 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block"/> Адрес фрейма АСМАП
              </label>
              <input
                type="url"
                disabled={!isWritePermitted}
                placeholder="https://www.asmap.ru/news/"
                defaultValue={settings?.asmapUrl || ''}
                onBlur={(e) => {
                  if (!settings) return;
                  dbService.saveSettings({...settings, asmapUrl: e.target.value}, user.name, user.role);
                  toast("Ссылка фрейма АСМАП сохранена", "success");
                }}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-400 transition"
              />
            </div>
          </div>

          <div className="pt-2 border-t border-slate-100 space-y-4">
            <h3 className="text-[11px] font-black uppercase text-slate-500 font-mono">Добавление пользовательских ссылок</h3>
            {isWritePermitted && (
              <form onSubmit={handleAddQuickLink} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50 select-none">
                <input
                  type="text"
                  placeholder="Служба/Название"
                  required
                  value={linkTitle}
                  onChange={(e) => setLinkTitle(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-slate-450 font-bold"
                />
                <input
                  type="url"
                  placeholder="https://..."
                  required
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-slate-450 font-bold"
                />
                <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase transition cursor-pointer">
                  Внедрить Ссылку
                </button>
              </form>
            )}

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {settings?.quickLinks?.map((li) => {
                const isEditing = editingLinkId === li.id;
                if (isEditing) {
                  return (
                    <form 
                      key={li.id} 
                      onSubmit={handleSaveEditQuickLink} 
                      className="flex flex-col sm:flex-row gap-2 bg-slate-100 p-3 rounded-2xl border border-slate-300"
                    >
                      <input
                        type="text"
                        value={editingLinkTitle}
                        onChange={(e) => setEditingLinkTitle(e.target.value)}
                        required
                        className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none font-bold flex-1"
                        placeholder="Название"
                      />
                      <input
                        type="url"
                        value={editingLinkUrl}
                        onChange={(e) => setEditingLinkUrl(e.target.value)}
                        required
                        className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none font-bold flex-1"
                        placeholder="https://..."
                      />
                      <div className="flex gap-1.5 justify-end">
                        <button 
                          type="submit" 
                          className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition cursor-pointer flex items-center justify-center min-w-[36px]" 
                          title="Сохранить"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setEditingLinkId(null)} 
                          className="p-2.5 bg-slate-400 hover:bg-slate-500 text-white rounded-xl transition cursor-pointer flex items-center justify-center min-w-[36px]" 
                          title="Отмена"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </form>
                  );
                }

                return (
                  <div key={li.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-250/15 group hover:border-slate-300/60 transition duration-100 gap-2">
                    <span className="text-slate-800 uppercase tracking-tight">{li.title}</span>
                    <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-mono max-w-[180px] sm:max-w-[240px] truncate">{li.url}</span>
                      {isWritePermitted && (
                        <div className="flex items-center gap-1.5">
                          <button 
                            onClick={() => handleStartEditQuickLink(li)} 
                            className="text-slate-500 hover:text-slate-800 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-slate-300 transition cursor-pointer flex items-center justify-center"
                            title="Редактировать"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button 
                            onClick={() => handleDeleteQuickLink(li.id)} 
                            className="text-rose-500 hover:text-rose-700 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer flex items-center justify-center"
                            title="Удалить"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Core dynamic external tabs section */}
          <div className="pt-4 border-t border-slate-100 space-y-4">
            <h3 className="text-[11px] font-black uppercase text-slate-500 font-mono">Добавление вкладок на сторонние сайты (Внешние Вкладки)</h3>
            <p className="text-[10px] text-slate-400 font-bold leading-normal">
              Эти вкладки будут размещены в главном меню навигации (сверху в ПК-версии и в выдвижной шторке на мобильных) рядом с системными разделами. Клик по ним откроет указанный сайт в новой вкладке браузера.
            </p>
            {isWritePermitted && (
              <form onSubmit={handleAddExternalTab} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-3 rounded-2xl border border-slate-200/50 select-none">
                <input
                  type="text"
                  placeholder="Название вкладки"
                  required
                  value={extTitle}
                  onChange={(e) => setExtTitle(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-slate-450 font-bold"
                />
                <input
                  type="url"
                  placeholder="https://..."
                  required
                  value={extUrl}
                  onChange={(e) => setExtUrl(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none placeholder:text-slate-450 font-bold"
                />
                <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-xl text-[10px] font-black uppercase transition cursor-pointer">
                  Добавить Вкладку
                </button>
              </form>
            )}

            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {(settings?.externalTabs || []).map((t) => {
                const isEditing = editingExtId === t.id;
                if (isEditing) {
                  return (
                    <form 
                      key={t.id} 
                      onSubmit={handleSaveEditExternalTab} 
                      className="flex flex-col sm:flex-row gap-2 bg-slate-100 p-3 rounded-2xl border border-slate-300"
                    >
                      <input
                        type="text"
                        value={editingExtTitle}
                        onChange={(e) => setEditingExtTitle(e.target.value)}
                        required
                        className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none font-bold flex-1"
                        placeholder="Название вкладки"
                      />
                      <input
                        type="url"
                        value={editingExtUrl}
                        onChange={(e) => setEditingExtUrl(e.target.value)}
                        required
                        className="p-2 bg-white text-xs rounded-xl border border-slate-200 focus:outline-none font-bold flex-1"
                        placeholder="https://..."
                      />
                      <div className="flex gap-1.5 justify-end">
                        <button 
                          type="submit" 
                          className="p-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl transition cursor-pointer flex items-center justify-center min-w-[36px]" 
                          title="Сохранить"
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        <button 
                          type="button" 
                          onClick={() => setEditingExtId(null)} 
                          className="p-2.5 bg-slate-400 hover:bg-slate-500 text-white rounded-xl transition cursor-pointer flex items-center justify-center min-w-[36px]" 
                          title="Отмена"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </form>
                  );
                }

                return (
                  <div key={t.id} className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-slate-50/70 rounded-2xl text-xs font-bold border border-slate-250/15 group hover:border-slate-300/60 transition duration-100 gap-2">
                    <span className="text-slate-800 uppercase tracking-tight">{t.title}</span>
                    <div className="flex items-center justify-between sm:justify-end gap-3 flex-wrap">
                      <span className="text-[10px] text-slate-400 font-mono max-w-[180px] sm:max-w-[240px] truncate">{t.url}</span>
                      {isWritePermitted && (
                        <div className="flex items-center gap-1.5">
                          <button 
                            onClick={() => handleStartEditExternalTab(t)} 
                            className="text-slate-500 hover:text-slate-800 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-slate-300 transition cursor-pointer flex items-center justify-center flex-shrink-0"
                            title="Редактировать"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button 
                            onClick={() => handleDeleteExternalTab(t.id)} 
                            className="text-rose-500 hover:text-rose-700 p-1.5 bg-white border border-slate-150 rounded-lg hover:border-rose-200 transition cursor-pointer flex items-center justify-center flex-shrink-0"
                            title="Удалить"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {!(settings?.externalTabs?.length) && (
                <div className="text-center py-6 text-slate-400 text-[10px] font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-200/10">Внешние вкладки отсутствуют.</div>
              )}
            </div>
          </div>
        </div>

      </div>

    </div>
  );
}

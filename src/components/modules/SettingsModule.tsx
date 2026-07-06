import React, { useState, useEffect } from 'react';
import { UserProfile, AppSettings, FerryTemplate, DistancePreset, CurrencyPreset, QuickLink, CarRateGroup, Driver } from '../../types';
import { dbService, database, onValue } from '../../firebase';
import { pdService } from '../../firebase/planDohodService';
import { ref, set, push, remove } from 'firebase/database';
import { 
  Settings, 
  Plus, 
  Trash2, 
  Anchor, 
  Compass, 
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
  X,
  Info,
  Globe,
  Navigation,
  FileText,
  Layers,
  Link
} from 'lucide-react';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';

interface SettingsModuleProps {
  user: UserProfile;
}

export default function SettingsModule({ user }: SettingsModuleProps) {
  const isWritePermitted = user.permissions.settings === 'write';
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [pdSettings, setPdSettings] = useState<any>({ useDistanceLookup: false, googleMapsApiKey: '' });
  
  // Navigation Tab State
  const [activeTab, setActiveTab] = useState<'fleet' | 'routes' | 'system' | 'links'>('fleet');

  // Search states for directories
  const [carSearch, setCarSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [distanceSearch, setDistanceSearch] = useState('');
  const [ferrySearch, setFerrySearch] = useState('');
  const [directionSearch, setDirectionSearch] = useState('');

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
  const [isKnownFleetLoaded, setIsKnownFleetLoaded] = useState(false);
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
      setIsKnownFleetLoaded(true);
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

  // Self-healing synchronization to align vehicle directory and tariff groups
  useEffect(() => {
    if (!isKnownFleetLoaded || carRateGroups.length === 0 || !isWritePermitted) return;

    const knownSet = new Set(knownFleet.map(v => v.trim().toUpperCase()).filter(Boolean));
    const tariffSet = new Set(
      carRateGroups.flatMap(g => (g.vehicles || []).map(v => v.trim().toUpperCase())).filter(Boolean)
    );

    // 1. Add missing vehicles to known_fleet in Firebase (so they are visible in the directory)
    const missingInKnown = Array.from(tariffSet).filter(v => !knownSet.has(v));
    if (missingInKnown.length > 0) {
      const dbRef = ref(database, 'known_fleet');
      missingInKnown.forEach(v => {
        push(dbRef, v);
      });
    }

    // 2. Remove obsolete vehicles from known_fleet in Firebase (vehicles that are in known_fleet but not in any tariff group)
    const obsoleteInKnown = knownFleetObjects.filter(item => {
      const plate = item.plate.trim().toUpperCase();
      return plate && !tariffSet.has(plate);
    });
    if (obsoleteInKnown.length > 0) {
      obsoleteInKnown.forEach(item => {
        remove(ref(database, `known_fleet/${item.key}`));
      });
    }

    // 3. Remove obsolete dispatcher mappings
    let mapChanged = false;
    const updatedMap = { ...dispatchersMap };
    Object.keys(updatedMap).forEach(plate => {
      const normPlate = plate.trim().toUpperCase();
      if (!tariffSet.has(normPlate)) {
        delete updatedMap[plate];
        mapChanged = true;
      }
    });
    if (mapChanged) {
      pdService.updateDispatchersCarMapping(updatedMap);
    }
  }, [carRateGroups, knownFleet, knownFleetObjects, dispatchersMap, isKnownFleetLoaded, isWritePermitted]);

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
    if (allCars.includes(cPlate)) {
      toast("Этот автомобиль уже есть в справочнике!", 'error');
      return;
    }

    // Automatically add to first tariff group
    if (carRateGroups.length > 0) {
      const firstGroup = carRateGroups[0];
      const updatedVehicles = Array.from(new Set([...(firstGroup.vehicles || []).map(v => v.trim().toUpperCase()), cPlate]));
      dbService.saveCarRateGroup({ ...firstGroup, vehicles: updatedVehicles }, user.name, user.role);
      toast("Автомобиль добавлен в справочник и тарифную группу.", 'success');
    } else {
      const dbRef = ref(database, 'known_fleet');
      push(dbRef, cPlate);
      toast("Автомобиль добавлен в справочник.", 'success');
    }

    setNewCarPlate('');
  };

  const handleDeleteKnownCar = async (key: string, plate: string) => {
    if (await showConfirm(`Вы действительно хотите удалить автомобиль "${plate}"? Это удалит его из тарифных групп и привязки к диспетчерам.`)) {
      // Remove from all tariff groups - the sync effect will clean up known_fleet and dispatcher mappings automatically
      carRateGroups.forEach(g => {
        if (g.vehicles && g.vehicles.includes(plate)) {
          dbService.saveCarRateGroup({
            ...g,
            vehicles: g.vehicles.filter(v => v !== plate)
          }, user.name, user.role);
        }
      });

      toast("Автомобиль удален.", 'success');
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
    const originalCar = knownFleetObjects.find(x => x.key === key);
    const originalPlate = originalCar ? originalCar.plate : '';

    set(ref(database, `known_fleet/${key}`), updatedPlate);

    if (originalPlate && originalPlate !== updatedPlate) {
      // Rename in all tariff groups
      carRateGroups.forEach(g => {
        if (g.vehicles && g.vehicles.includes(originalPlate)) {
          dbService.saveCarRateGroup({
            ...g,
            vehicles: g.vehicles.map(v => v === originalPlate ? updatedPlate : v)
          }, user.name, user.role);
        }
      });

      // Rename in dispatcher mapping
      if (dispatchersMap[originalPlate] !== undefined) {
        const updatedMap = { ...dispatchersMap };
        updatedMap[updatedPlate] = updatedMap[originalPlate];
        delete updatedMap[originalPlate];
        pdService.updateDispatchersCarMapping(updatedMap);
      }
    }

    setEditingCarKey(null);
    toast("Номер автомобиля сохранен во всех связанных разделах.", 'success');
  };

  const handleConfirmAddVehicleToGroup = (group: CarRateGroup, vehicleNum: string) => {
    if (!vehicleNum.trim()) {
      setAddingVehicleGroup(null);
      return;
    }
    const plate = vehicleNum.trim().toUpperCase();

    // 1. If it's already in this tariff group, do nothing
    if (group.vehicles && group.vehicles.includes(plate)) {
      setAddingVehicleGroup(null);
      return;
    }

    // 2. Remove this vehicle from any OTHER tariff groups (to ensure a vehicle is in exactly one group)
    carRateGroups.forEach(g => {
      if (g.id !== group.id && g.vehicles && g.vehicles.includes(plate)) {
        dbService.saveCarRateGroup({
          ...g,
          vehicles: g.vehicles.filter(v => v !== plate)
        }, user.name, user.role);
      }
    });

    // 3. Add to the target tariff group
    const updatedVehicles = Array.from(new Set([...(group.vehicles || []), plate]));
    dbService.saveCarRateGroup({
      ...group,
      vehicles: updatedVehicles
    }, user.name, user.role);

    toast(`Автомобиль ${plate} добавлен в тарифную группу.`, 'success');
    setAddingVehicleGroup(null);
  };

  const handleRemoveVehicleFromGroup = async (group: CarRateGroup, plate: string) => {
    if (await showConfirm(`Вы действительно хотите удалить автомобиль "${plate}"? Это также удалит его из автопарка и привязки к диспетчерам.`)) {
      // Remove from tariff group
      dbService.saveCarRateGroup({
        ...group,
        vehicles: (group.vehicles || []).filter(v => v !== plate)
      }, user.name, user.role);

      toast(`Автомобиль ${plate} удален.`, 'success');
    }
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

  const allCars: string[] = Array.from(new Set([
    ...knownFleet.map(v => v.trim().toUpperCase()),
    ...carRateGroups.flatMap(g => (g.vehicles || []).map(v => v.trim().toUpperCase()))
  ].filter(Boolean))) as string[];

  // Directory Search Filter Logic
  const filteredKnownFleet = knownFleetObjects.filter(item =>
    item.plate.toLowerCase().includes(carSearch.toLowerCase())
  );

  const filteredDrivers = drivers.filter(drv =>
    drv.name.toLowerCase().includes(driverSearch.toLowerCase()) ||
    (drv.phone && drv.phone.toLowerCase().includes(driverSearch.toLowerCase())) ||
    (drv.license && drv.license.toLowerCase().includes(driverSearch.toLowerCase()))
  );

  const filteredDistances = distances.filter(di =>
    di.from.toLowerCase().includes(distanceSearch.toLowerCase()) ||
    di.to.toLowerCase().includes(distanceSearch.toLowerCase())
  );

  const filteredFerries = ferries.filter(fe =>
    fe.name.toLowerCase().includes(ferrySearch.toLowerCase())
  );

  const filteredDirections = Object.entries(directions).filter(([name]) =>
    name.toLowerCase().includes(directionSearch.toLowerCase())
  );

  // Tabs structure with design details and icons
  const tabList = [
    { id: 'fleet', label: 'Автопарк и Водители', icon: Truck, count: filteredKnownFleet.length + filteredDrivers.length },
    { id: 'routes', label: 'Маршруты и Направления', icon: Compass, count: filteredDistances.length + filteredFerries.length + filteredDirections.length },
    { id: 'system', label: 'Системные Настройки', icon: Settings, count: currencies.length },
    { id: 'links', label: 'Ссылки и Порталы', icon: ExternalLink, count: (settings?.quickLinks?.length || 0) + (settings?.externalTabs?.length || 0) }
  ] as const;

  return (
    <div className="w-full space-y-6 font-sans">
      
      {/* HEADER BAR */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2.5">
              <Settings className="w-5.5 h-5.5 text-slate-900" style={{ fill: '#70FC8E' }} />
              <span>Корпоративные Справочники</span>
            </h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-wider font-mono mt-1">
              Системные реестры, тарифные сетки, коэффициенты и интеграционные ключи RATIPA
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] bg-slate-100 text-slate-500 font-bold px-3 py-1.5 rounded-full font-mono uppercase border border-slate-200">
            <Layers className="w-3.5 h-3.5 text-slate-400" />
            <span>{isWritePermitted ? 'Редактирование' : 'Только чтение'}</span>
          </div>
        </div>

        {/* MODERN SCROLLABLE TAB NAVIGATOR */}
        <div className="mt-6 flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-2xl border border-slate-200/60 max-w-max">
          {tabList.map((t) => {
            const IconComp = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-tight transition duration-150 select-none cursor-pointer ${
                  isActive 
                    ? 'bg-slate-950 text-white shadow-sm font-extrabold' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <IconComp className={`w-3.5 h-3.5 ${isActive ? 'text-[#70FC8E]' : 'text-slate-400'}`} />
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono font-black ${
                    isActive ? 'bg-[#70FC8E]/20 text-[#70FC8E]' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB CONTENT 1: FLEET & DISPATCHERS */}
      {activeTab === 'fleet' && (
        <div className="space-y-6">
          
          {/* INTERACTIVE CAR-DISPATCHER MAPPING BLOCK */}
          <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-5">
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                <Users className="h-4.5 w-4.5 text-blue-500" /> 
                <span>Интерактивная привязка авто к диспетчерам</span>
              </h2>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5 uppercase tracking-wide">
                Перетаскивайте автомобили из правой колонки во вкладки диспетчеров слева для быстрой привязки
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* LEFT COLUMN: Dispatchers Tabs */}
              <div className="lg:col-span-2 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-1 mb-1">
                  <span className="text-[9px] font-black uppercase text-slate-400 font-mono tracking-wider">
                    Диспетчеры
                  </span>
                  <span className="text-[9px] text-slate-400 font-mono font-black uppercase">
                    {dispatchers.length} активных
                  </span>
                </div>
                
                <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 custom-scrollbar">
                  {/* "Без диспетчера" Card */}
                  <div 
                    onDragOver={(e) => handleDragOverDispCard(e, 'Без диспетчера')}
                    onDragLeave={handleDragLeaveDispCard}
                    onDrop={(e) => handleDropOnDispCard(e, 'Без диспетчера')}
                    onClick={() => setActiveDispSelect('Без диспетчера')}
                    className={`p-3.5 rounded-xl border transition cursor-pointer select-none relative ${
                      activeDispSelect === 'Без диспетчера'
                        ? 'border-red-500 bg-red-50/50 text-red-950 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 bg-slate-50 text-slate-700'
                    } ${dragOverDisp === 'Без диспетчера' ? 'ring-2 ring-red-500 ring-dashed border-red-500 scale-[1.01]' : ''}`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
                        <strong className="text-xs font-black uppercase tracking-wider">Без диспетчера</strong>
                      </div>
                      <span className="bg-white border border-slate-150 px-2 py-0.5 rounded font-mono text-[9px] font-black text-slate-600">
                        {allCars.filter(c => !dispatchersMap[c]).length} авто
                      </span>
                    </div>
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
                        className={`p-3.5 rounded-xl border transition cursor-pointer select-none relative ${
                          activeDispSelect === dispName
                            ? 'border-blue-500 bg-blue-50/50 text-blue-950 shadow-sm'
                            : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700'
                        } ${dragOverDisp === dispName ? 'ring-2 ring-blue-500 ring-dashed border-blue-500 scale-[1.01]' : ''}`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                            <strong className="text-xs font-black uppercase tracking-wider">{dispName}</strong>
                          </div>
                          <span className="bg-slate-50 border border-slate-200 px-2 py-0.5 rounded font-mono text-[9px] font-black text-slate-600">
                            {countAssigned} авто
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Selected Dispatcher's Cars view below */}
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5">
                  <h3 className="text-[9px] font-black uppercase text-slate-500 font-mono tracking-wider mb-2.5">
                    Закреплено за: <span className="text-blue-600 underline font-sans font-black uppercase">{activeDispSelect}</span>
                  </h3>
                  <div className="space-y-1.5 max-h-[160px] overflow-y-auto custom-scrollbar">
                    {allCars.filter(c => activeDispSelect === 'Без диспетчера' ? !dispatchersMap[c] : dispatchersMap[c] === activeDispSelect).map(c => (
                      <div 
                        key={c}
                        draggable={isWritePermitted}
                        onDragStart={(e) => handleDragStartCarMapping(e, c)}
                        className="bg-white border border-slate-200 p-2 px-3 rounded-lg flex items-center justify-between text-xs font-bold hover:shadow-2xs hover:border-slate-300 transition cursor-move group select-none"
                      >
                        <span className="font-mono text-slate-800 uppercase tracking-widest">{c}</span>
                        {isWritePermitted && activeDispSelect !== 'Без диспетчера' && (
                          <button 
                            onClick={() => handleMapCarToDispatcher(c, null)}
                            className="text-[9px] font-black text-rose-500 hover:bg-rose-50 px-2 py-0.5 rounded transition uppercase"
                          >
                            Отвязать
                          </button>
                        )}
                      </div>
                    ))}
                    {allCars.filter(c => activeDispSelect === 'Без диспетчера' ? !dispatchersMap[c] : dispatchersMap[c] === activeDispSelect).length === 0 && (
                      <div className="text-center py-4 text-[9px] font-black uppercase text-slate-400 tracking-widest font-mono select-none">
                        Нет закрепленных автомобилей
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* RIGHT COLUMN: All Cars in DB base */}
              <div className="lg:col-span-3 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-1 mb-1">
                  <span className="text-[9px] font-black uppercase text-slate-400 font-mono tracking-wider">
                    База Автомобилей ({allCars.length} шт)
                  </span>
                  <div className="relative w-full sm:w-56">
                    <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                      <Search className="w-3.5 h-3.5" />
                    </span>
                    <input 
                      type="text" 
                      placeholder="Поиск по госномеру..." 
                      value={carSearchInMapping}
                      onChange={(e) => setCarSearchInMapping(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 pl-8 pr-3 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wide outline-none focus:border-blue-400 transition font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[460px] overflow-y-auto pr-1 custom-scrollbar">
                  {allCars
                    .filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase()))
                    .map((carPlate) => {
                      const currentDisp = dispatchersMap[carPlate];
                      return (
                        <div 
                          key={carPlate}
                          draggable={isWritePermitted}
                          onDragStart={(e) => handleDragStartCarMapping(e, carPlate)}
                          className={`p-3 rounded-xl border transition relative select-none flex items-center justify-between cursor-move shadow-2xs hover:shadow-xs ${
                            currentDisp 
                              ? "border-blue-100 bg-blue-50/20" 
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black tracking-widest text-slate-800 uppercase">
                              {carPlate}
                            </span>
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-mono font-bold uppercase">
                              {currentDisp ? (
                                <span className="text-blue-600">{currentDisp}</span>
                              ) : (
                                <span className="text-slate-400">Свободен</span>
                              )}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>

          {/* TWO PANEL ROW: VEHICLES DIRECTORY & TARIFF GROUPS */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* 1. VEHICLES DIRECTORY (5 cols) */}
            <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 lg:col-span-5 flex flex-col">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-2.5">
                <div>
                  <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5">
                    <Truck className="h-4 w-4 text-emerald-500" />
                    <span>База Автопарка</span>
                  </h3>
                  <span className="text-[10px] text-slate-400 font-mono font-bold">Активные госномера тягачей</span>
                </div>

                {/* Local search */}
                <div className="relative w-full sm:w-40">
                  <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                    <Search className="w-3 h-3" />
                  </span>
                  <input
                    type="text"
                    placeholder="Поиск..."
                    value={carSearch}
                    onChange={(e) => setCarSearch(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 pl-7 pr-2 py-1.5 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wide outline-none focus:border-emerald-400 transition"
                  />
                </div>
              </div>

              {isWritePermitted && (
                <form onSubmit={handleAddKnownCar} className="flex gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/50">
                  <input
                    type="text"
                    placeholder="1234 AB-7"
                    required
                    value={newCarPlate}
                    onChange={(e) => setNewCarPlate(e.target.value)}
                    className="flex-1 p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold placeholder:text-slate-400 text-slate-850 uppercase font-mono tracking-wider"
                  />
                  <button type="submit" className="bg-slate-950 hover:bg-slate-850 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase tracking-tight px-3 transition cursor-pointer font-mono">
                    Добавить
                  </button>
                </form>
              )}

              <div className="overflow-x-auto border border-slate-200 rounded-xl flex-1 max-h-[350px] custom-scrollbar">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 text-[9px] font-black uppercase text-slate-400 font-mono border-b border-slate-200">
                      <th className="px-3 py-2">Госномер ТС</th>
                      {isWritePermitted && <th className="px-3 py-2 text-right w-[100px]">Действие</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs text-slate-700 font-mono">
                    {filteredKnownFleet.map((item) => {
                      const isEditing = editingCarKey === item.key;
                      return (
                        <tr key={item.key} className="hover:bg-slate-50/40 transition">
                          <td className="px-3 py-2 font-black text-slate-800 uppercase tracking-widest">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editCarPlate}
                                onChange={(e) => setEditCarPlate(e.target.value)}
                                className="p-1 bg-white text-xs rounded border border-slate-300 font-black w-full outline-none uppercase font-mono tracking-widest text-slate-800"
                              />
                            ) : (
                              item.plate
                            )}
                          </td>
                          {isWritePermitted && (
                            <td className="px-3 py-2 text-right w-[100px]">
                              {isEditing ? (
                                <div className="flex gap-1 justify-end">
                                  <button
                                    onClick={() => handleSaveEditCar(item.key)}
                                    className="text-emerald-600 p-1 hover:bg-emerald-50 rounded transition"
                                    title="Сохранить"
                                  >
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => setEditingCarKey(null)}
                                    className="text-slate-400 p-1 hover:bg-slate-105 rounded transition"
                                    title="Отмена"
                                  >
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex gap-1 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 hover:opacity-100">
                                  <button
                                    onClick={() => handleStartEditCar(item.key, item.plate)}
                                    className="text-indigo-600 p-1 hover:bg-indigo-50 rounded transition"
                                    title="Изменить"
                                  >
                                    <Edit2 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    onClick={() => handleDeleteKnownCar(item.key, item.plate)}
                                    className="text-rose-500 p-1 hover:bg-rose-50 rounded transition"
                                    title="Удалить"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                    {filteredKnownFleet.length === 0 && (
                      <tr>
                        <td colSpan={2} className="text-center py-6 text-slate-400 text-[10px] uppercase font-mono font-black tracking-wider bg-slate-50">
                          Машины не найдены
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* 2. TARIFF GROUPS (7 cols) */}
            <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 lg:col-span-7 flex flex-col">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                  <Wallet className="h-4.5 w-4.5 text-blue-500" />
                  <span>Тарифные группы (Зарплата водителей)</span>
                </h3>
                <p className="text-[10px] text-slate-400 font-bold font-mono uppercase mt-1">Определяют ставку за 1 км и размер суточных</p>
              </div>

              {isWritePermitted && (
                <form onSubmit={handleAddTariff} className="grid grid-cols-1 sm:grid-cols-12 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                  <input
                    type="text"
                    placeholder="Название (0.135)"
                    required
                    value={stName}
                    onChange={(e) => setStName(e.target.value)}
                    className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-800 placeholder:text-slate-400 sm:col-span-3"
                  />
                  <input
                    type="number"
                    step="0.001"
                    placeholder="Тариф за км (€)"
                    required
                    value={stRate || ''}
                    onChange={(e) => setStRate(Number(e.target.value))}
                    className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-800 placeholder:text-slate-400 sm:col-span-3 font-mono"
                  />
                  <input
                    type="number"
                    placeholder="Суточные (€/д)"
                    value={stPerDiem || ''}
                    onChange={(e) => setStPerDiem(e.target.value ? Number(e.target.value) : undefined)}
                    className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-800 placeholder:text-slate-400 sm:col-span-3 font-mono"
                  />
                  <button type="submit" className="bg-slate-950 hover:bg-slate-850 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase tracking-tight sm:col-span-3 transition cursor-pointer">
                    Создать
                  </button>
                </form>
              )}

              <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar">
                {carRateGroups.map((group) => (
                  <div key={group.id} className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs">
                    <div className="flex justify-between items-center mb-2 font-bold text-slate-800">
                      <div>
                        <span className="font-black text-slate-900">{group.name}</span>
                        <span className="ml-2 font-mono text-[10px] py-0.5 px-1.5 bg-slate-200 rounded text-slate-600">{group.rate} €/км</span>
                        {group.perDiemRate !== undefined && (
                          <span className="ml-1.5 font-mono text-[10px] py-0.5 px-1.5 bg-indigo-100 rounded text-indigo-700">{group.perDiemRate} €/день</span>
                        )}
                      </div>
                      {isWritePermitted && (
                        <button onClick={() => handleDeleteTariff(group.id)} className="text-rose-500 hover:text-rose-700 p-1 hover:bg-rose-50 rounded transition">
                          <Trash2 className="h-3.5 w-3.5"/>
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                      {(group.vehicles || []).map((v, i) => (
                        <span key={`${group.id}-${i}-${v}`} className="bg-white px-2 py-0.5 rounded border border-slate-200 text-[9px] font-mono font-black text-slate-700 flex items-center gap-1 uppercase">
                          {v}
                          {isWritePermitted && (
                            <button 
                              onClick={() => handleRemoveVehicleFromGroup(group, v)} 
                              className="ml-1 text-slate-400 hover:text-rose-500 font-black font-sans text-xs transition-colors"
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {addingVehicleGroup?.id === group.id ? (
                        <div className="flex items-center gap-1.5 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                          <input
                            type="text"
                            placeholder="1234 AB-7"
                            className="text-[9px] font-mono uppercase font-black outline-none w-20 border-0 p-0"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleConfirmAddVehicleToGroup(group, e.currentTarget.value);
                              }
                            }}
                            onBlur={(e) => {
                              if (!e.currentTarget.value.trim()) {
                                setAddingVehicleGroup(null);
                              }
                            }}
                          />
                          <button
                            onClick={(e) => {
                              const val = e.currentTarget.previousSibling ? (e.currentTarget.previousSibling as HTMLInputElement).value : '';
                              handleConfirmAddVehicleToGroup(group, val);
                            }}
                            className="text-emerald-600 hover:text-emerald-800 font-black font-sans text-xs"
                          >
                            ✓
                          </button>
                          <button
                            onClick={() => setAddingVehicleGroup(null)}
                            className="text-slate-400 hover:text-slate-600 font-black font-sans text-xs"
                          >
                            ×
                          </button>
                        </div>
                      ) : (
                        isWritePermitted && (
                          <button 
                            onClick={() => setAddingVehicleGroup(group)}
                            className="bg-slate-200/60 px-2 py-0.5 rounded text-[9px] font-mono font-bold text-slate-600 hover:bg-slate-250 transition cursor-pointer"
                          >
                            + добавить ТС
                          </button>
                        )
                      )}
                    </div>
                  </div>
                ))}
                {!carRateGroups.length && (
                  <div className="text-center py-8 text-slate-400 text-[10px] font-mono font-black uppercase tracking-wider bg-slate-50 border border-slate-100 rounded-xl">
                    Группы не созданы
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* DRIVERS DIRECTORY - FULL WIDTH CARDS */}
          <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-2">
                  <Users className="h-4.5 w-4.5 text-slate-900" style={{ fill: '#70FC8E' }} />
                  <span>Справочник водителей RATIPA (Активная база)</span>
                </h3>
                <p className="text-[10px] text-slate-400 font-bold font-mono uppercase mt-0.5">Картотека водителей, контактные телефоны и тарифные коэффициенты</p>
              </div>

              {/* Driver search */}
              <div className="relative w-full sm:w-60">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  placeholder="Быстрый поиск водителя..."
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 pl-9 pr-3 py-1.5 rounded-xl text-xs font-bold outline-none focus:border-emerald-500 transition"
                />
              </div>
            </div>

            {isWritePermitted && (
              <form onSubmit={handleAddDriver} className="grid grid-cols-1 md:grid-cols-5 gap-2 bg-slate-50 p-3 rounded-xl border border-slate-200/50">
                <input
                  type="text"
                  placeholder="ФИО Водителя"
                  required
                  value={drName}
                  onChange={(e) => setDrName(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-800"
                />
                <input
                  type="text"
                  placeholder="Телефон водителя"
                  value={drPhone}
                  onChange={(e) => setDrPhone(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-800"
                />
                <input
                  type="text"
                  placeholder="Водительское удостоверение"
                  value={drLicense}
                  onChange={(e) => setDrLicense(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-800"
                />
                <select
                  value={drRateGroupId}
                  onChange={(e) => setDrRateGroupId(e.target.value)}
                  className="p-2.5 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-600"
                >
                  <option value="">Тарифная группа</option>
                  {carRateGroups.map(g => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Примечание"
                    value={drComment}
                    onChange={(e) => setDrComment(e.target.value)}
                    className="flex-1 p-2.5 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none focus:border-slate-400 font-bold text-slate-800"
                  />
                  <button type="submit" className="bg-slate-950 hover:bg-slate-850 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase tracking-wider px-3.5 transition cursor-pointer">
                    Добавить
                  </button>
                </div>
              </form>
            )}

            <div className="overflow-x-auto border border-slate-200/60 rounded-xl max-h-[400px] custom-scrollbar">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-[10px] font-black uppercase text-slate-500 font-mono border-b border-slate-200">
                    <th className="px-4 py-3">ФИО водителя</th>
                    <th className="px-4 py-3">Телефон</th>
                    <th className="px-4 py-3">Удостоверение</th>
                    <th className="px-4 py-3">Тарифная группа</th>
                    <th className="px-4 py-3">Комментарий</th>
                    {isWritePermitted && <th className="px-4 py-3 text-right">Действия</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                  {filteredDrivers.map((drv) => {
                    const isEditing = editingDriverId === drv.id;
                    return (
                      <tr key={drv.id} className="hover:bg-slate-50/40 transition">
                        <td className="px-4 py-3 font-black text-slate-900">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDrName}
                              onChange={(e) => setEditDrName(e.target.value)}
                              className="p-1.5 bg-white text-xs rounded border border-slate-300 font-bold w-full outline-none"
                            />
                          ) : (
                            drv.name
                          )}
                        </td>
                        <td className="px-4 py-3 font-medium">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDrPhone}
                              onChange={(e) => setEditDrPhone(e.target.value)}
                              className="p-1.5 bg-white text-xs rounded border border-slate-300 font-bold w-full outline-none"
                            />
                          ) : (
                            drv.phone || <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDrLicense}
                              onChange={(e) => setEditDrLicense(e.target.value)}
                              className="p-1.5 bg-white text-xs rounded border border-slate-300 font-bold w-full outline-none"
                            />
                          ) : (
                            drv.license || <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 font-bold">
                          {isEditing ? (
                            <select
                              value={editDrRateGroupId}
                              onChange={(e) => setEditDrRateGroupId(e.target.value)}
                              className="p-1.5 bg-white text-xs rounded border border-slate-300 font-bold w-full outline-none text-slate-650"
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
                        <td className="px-4 py-3 text-slate-500 italic">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDrComment}
                              onChange={(e) => setEditDrComment(e.target.value)}
                              className="p-1.5 bg-white text-xs rounded border border-slate-300 font-bold w-full outline-none"
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
                                  className="text-emerald-600 p-1 hover:bg-emerald-50 rounded transition"
                                >
                                  <Check className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => setEditingDriverId(null)}
                                  className="text-slate-400 p-1 hover:bg-slate-100 rounded transition"
                                >
                                  <X className="h-4 w-4" />
                                </button>
                              </div>
                            ) : (
                              <div className="flex gap-1 justify-end">
                                <button
                                  onClick={() => handleStartEditDriver(drv)}
                                  className="text-indigo-600 p-1 hover:bg-indigo-50 rounded transition"
                                  title="Редактировать"
                                >
                                  <Edit2 className="h-4 w-4" />
                                </button>
                                <button
                                  onClick={() => handleDeleteDriver(drv.id, drv.name)}
                                  className="text-rose-500 p-1 hover:bg-rose-50 rounded transition"
                                  title="Удалить"
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
                  {filteredDrivers.length === 0 && (
                    <tr>
                      <td colSpan={isWritePermitted ? 6 : 5} className="text-center py-8 text-slate-400 text-xs font-mono font-black uppercase bg-slate-50">
                        Водители не найдены
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      )}

      {/* TAB CONTENT 2: ROUTES & LOGISTICS */}
      {activeTab === 'routes' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          
          {/* A. DIRECTIONS & COEFFICIENTS (Left panel) */}
          <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5">
                  <TrendingUp className="h-4.5 w-4.5 text-blue-500" />
                  <span>Направления и Коэффициенты расходов</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">Наценка на путевой километр расхода</span>
              </div>

              {/* Local search */}
              <div className="relative w-full sm:w-40">
                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-3 h-3" />
                </span>
                <input
                  type="text"
                  placeholder="Поиск..."
                  value={directionSearch}
                  onChange={(e) => setDirectionSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 pl-7 pr-2 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wide outline-none focus:border-blue-400 transition"
                />
              </div>
            </div>

            {isWritePermitted && (
              <form onSubmit={handleAddDirection} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/50">
                <input
                  type="text"
                  placeholder="Германия / Азия"
                  required
                  value={dirName}
                  onChange={(e) => setDirName(e.target.value)}
                  className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none placeholder:text-[9px] font-bold text-slate-800"
                />
                <input
                  type="number"
                  step="0.01"
                  placeholder="Коэф (напр. 1.25)"
                  required
                  value={dirCoeff}
                  onChange={(e) => setDirCoeff(Number(e.target.value))}
                  className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none placeholder:text-[9px] font-bold text-slate-800 font-mono"
                />
                <div className="flex gap-1">
                  <button type="submit" className="flex-1 bg-slate-950 hover:bg-slate-850 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase transition cursor-pointer font-mono">
                    {editingDirKey ? 'Сохранить' : 'Добавить'}
                  </button>
                  {editingDirKey && (
                    <button 
                      type="button" 
                      onClick={handleCancelEditDirection} 
                      className="px-2 bg-slate-250 hover:bg-slate-300 text-slate-700 rounded-lg text-[10px] font-bold transition"
                    >
                      X
                    </button>
                  )}
                </div>
              </form>
            )}

            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar flex-1">
              {filteredDirections.map(([name, coeff]) => (
                <div key={name} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl text-xs font-bold border border-slate-100 group transition">
                  <span className="text-slate-800 uppercase font-mono tracking-tight flex items-center gap-2">
                    <MapPin size={13} className="text-slate-400" />
                    {name}
                  </span>
                  <div className="flex items-center gap-2">
                    <strong className="text-slate-950 font-mono font-black py-0.5 px-2 bg-slate-200 rounded">x{coeff as number}</strong>
                    {isWritePermitted && (
                      <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition duration-150">
                        <button 
                          onClick={() => handleEditClickDirection(name, coeff as number)} 
                          className="text-indigo-600 hover:text-indigo-800 p-1 bg-white border border-slate-200 rounded transition"
                          title="Изменить"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                        <button 
                          onClick={() => handleDeleteDirection(name)} 
                          className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-200 rounded transition"
                          title="Удалить"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {filteredDirections.length === 0 && (
                <div className="text-center py-10 text-slate-400 text-[10px] font-mono font-black uppercase tracking-widest bg-slate-50 rounded-xl">
                  Направления не найдены
                </div>
              )}
            </div>
          </div>

          {/* B. FERRY DFS TARIFFS (Right panel) */}
          <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5">
                  <Anchor className="h-4.5 w-4.5 text-blue-500" />
                  <span>Тарифы Паромных линий DFS</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">Базовые стоимости переправ в EUR</span>
              </div>

              {/* Local search */}
              <div className="relative w-full sm:w-40">
                <span className="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-3 h-3" />
                </span>
                <input
                  type="text"
                  placeholder="Поиск..."
                  value={ferrySearch}
                  onChange={(e) => setFerrySearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 pl-7 pr-2 py-1 rounded-lg text-[9px] font-mono font-bold uppercase tracking-wide outline-none focus:border-blue-400 transition"
                />
              </div>
            </div>

            {isWritePermitted && (
              <form onSubmit={handleAddFerry} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/50">
                <input
                  type="text"
                  placeholder="Liepaja - Travemunde"
                  required
                  value={fName}
                  onChange={(e) => setFName(e.target.value)}
                  className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none placeholder:text-[9px] font-bold text-slate-800"
                />
                <input
                  type="number"
                  placeholder="Цена (EUR)"
                  required
                  value={fPrice || ''}
                  onChange={(e) => setFPrice(Number(e.target.value))}
                  className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none placeholder:text-[9px] font-bold text-slate-800 font-mono"
                />
                <button type="submit" className="bg-slate-950 hover:bg-slate-850 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase transition cursor-pointer font-mono">
                  Добавить
                </button>
              </form>
            )}

            <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1 custom-scrollbar flex-1">
              {filteredFerries.map((fe) => (
                <div key={fe.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl text-xs font-bold border border-slate-100 group transition">
                  <span className="text-slate-800 uppercase tracking-tight font-black">{fe.name}</span>
                  <div className="flex items-center gap-3">
                    <strong className="text-slate-950 font-mono font-black py-0.5 px-2 bg-slate-200 rounded">{fe.price} EUR</strong>
                    {isWritePermitted && (
                      <button 
                        onClick={() => handleDeleteFerry(fe.id)} 
                        className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-200 rounded opacity-100 sm:opacity-0 group-hover:opacity-100 transition duration-150"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {filteredFerries.length === 0 && (
                <div className="text-center py-10 text-slate-400 text-[10px] font-mono font-black uppercase tracking-widest bg-slate-50 rounded-xl">
                  Тарифы не найдены
                </div>
              )}
            </div>
          </div>

          {/* C. STANDARD DISTANCES DATABASE (Full width bottom panel) */}
          <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 lg:col-span-2 flex flex-col">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5">
                  <Compass className="h-4.5 w-4.5 text-blue-500 animate-spin-slow" />
                  <span>База стандартных расстояний RATIPA (КМ)</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase">Предустановленный километраж ключевых логистических плеч</span>
              </div>

              {/* Local search */}
              <div className="relative w-full sm:w-60">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Search className="w-3.5 h-3.5" />
                </span>
                <input
                  type="text"
                  placeholder="Поиск по городам отправления/прибытия..."
                  value={distanceSearch}
                  onChange={(e) => setDistanceSearch(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 pl-9 pr-3 py-1.5 rounded-xl text-xs font-bold outline-none focus:border-blue-400 transition"
                />
              </div>
            </div>

            {isWritePermitted && (
              <form onSubmit={handleAddDistance} className="grid grid-cols-1 sm:grid-cols-4 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200/50">
                <input
                  type="text"
                  placeholder="От (напр., Минск)"
                  required
                  value={dFrom}
                  onChange={(e) => setDFrom(e.target.value)}
                  className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-bold text-slate-800"
                />
                <input
                  type="text"
                  placeholder="До (напр., Берлин)"
                  required
                  value={dTo}
                  onChange={(e) => setDTo(e.target.value)}
                  className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-bold text-slate-800"
                />
                <input
                  type="number"
                  placeholder="Расстояние (КМ)"
                  required
                  value={dKm || ''}
                  onChange={(e) => setDKm(Number(e.target.value))}
                  className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-bold font-mono text-slate-800"
                />
                <button type="submit" className="bg-slate-950 hover:bg-slate-850 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase transition cursor-pointer font-mono">
                  Записать в базу
                </button>
              </form>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 max-h-[400px] overflow-y-auto pr-1 custom-scrollbar">
              {filteredDistances.map((di) => (
                <div key={di.id} className="p-3 bg-slate-50 rounded-xl border border-slate-100 flex items-center justify-between text-xs font-bold hover:border-slate-300 transition group select-none">
                  <div className="flex items-center gap-2">
                    <Navigation className="w-3.5 h-3.5 text-emerald-500" />
                    <span className="text-slate-700 uppercase">{di.from} &rarr; {di.to}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-black text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded text-[10px]">
                      {di.distance} км
                    </span>
                    {isWritePermitted && (
                      <button 
                        onClick={() => handleDeleteDistance(di.id)} 
                        className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-200 rounded opacity-100 sm:opacity-0 group-hover:opacity-100 transition duration-150"
                        title="Удалить"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {filteredDistances.length === 0 && (
                <div className="col-span-full text-center py-10 text-slate-400 text-[10px] font-mono font-black uppercase tracking-wider bg-slate-50 rounded-xl">
                  Расстояния не найдены
                </div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* TAB CONTENT 3: SYSTEM SETTINGS */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          
          {/* CORE RATES & INTEGRATION ROW */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Rates setting (5 cols) */}
            <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 lg:col-span-5 flex flex-col">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                  <Wallet className="h-4.5 w-4.5 text-blue-500" />
                  <span>Глобальные нормативные ставки</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-1">Базовые величины расчетов по умолчанию</span>
              </div>

              {settings && (
                <div className="space-y-4 flex-1">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">Ставка простоя (€/день)</label>
                    <input
                      type="number"
                      disabled={!isWritePermitted}
                      defaultValue={settings.idleRate}
                      onBlur={(e) => dbService.saveSettings({...settings, idleRate: Number(e.target.value)}, user.name, user.role)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black focus:outline-none focus:border-slate-400 font-mono text-slate-800"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">Ставка суточных командировочных (€/день)</label>
                    <input
                      type="number"
                      disabled={!isWritePermitted}
                      defaultValue={settings.perDiemRate}
                      onBlur={(e) => dbService.saveSettings({...settings, perDiemRate: Number(e.target.value)}, user.name, user.role)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-black focus:outline-none focus:border-slate-400 font-mono text-slate-800"
                    />
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-[10px] text-slate-400 font-medium leading-relaxed mt-2 uppercase font-mono tracking-wide">
                    ⚠ Смена данных величин немедленно затронет новые расчеты в калькуляциях и диспетчерских планировщиках. Исторические записи останутся без изменений.
                  </div>
                </div>
              )}
            </div>

            {/* Google / OSRM Maps Integration (7 cols) */}
            <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 lg:col-span-7 flex flex-col">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                  <MapPin className="h-4.5 w-4.5 text-blue-500" />
                  <span>Интеграция карт и расчет расстояний</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-1">Параметры OSRM / OpenRouteService маршрутизации</span>
              </div>

              <div className="space-y-4 text-xs font-medium text-slate-650 flex-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">Провайдер маршрутов</label>
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
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-450 cursor-pointer"
                    >
                      <option value="osrm">OSRM (Без ключа, бесплатно)</option>
                      <option value="openrouteservice">OpenRouteService API (Требуется ключ)</option>
                    </select>
                  </div>

                  <div className="flex items-center">
                    <label className="flex items-center gap-3 cursor-pointer select-none bg-slate-50 border border-slate-200 p-3 rounded-xl hover:bg-slate-100 transition w-full">
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
                        className="w-4 h-4 text-emerald-500 border-slate-300 rounded focus:ring-emerald-400"
                      />
                      <div className="flex flex-col">
                        <span className="font-bold text-slate-800 text-xs">Авторасчет</span>
                        <span className="text-[8px] text-slate-400 font-mono uppercase">Если нет в КМ-базе</span>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">OpenRouteService API Key</label>
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
                      placeholder="Скрыто..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-450 font-mono"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">Google Maps API Key (Резервный / Геокод)</label>
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
                      placeholder="Скрыто..."
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-450 font-mono"
                    />
                  </div>
                </div>

                <div className="bg-[#70FC8E]/5 border border-[#70FC8E]/20 p-3.5 rounded-xl space-y-1.5 text-slate-600 leading-relaxed text-[10px] font-mono uppercase tracking-wide">
                  <div>• Маршруты: { pdSettings?.routingProvider === 'openrouteservice' ? 'OpenRouteService API' : 'OSRM API (Автономно)' }</div>
                  <div>• Ключ OpenRouteService: { pdSettings?.openRouteServiceApiKey ? 'АКТИВЕН' : 'ОТСУТСТВУЕТ (OSRM Режим)' }</div>
                  <div>• Ключ Google Maps: { pdSettings?.googleMapsApiKey ? 'УСТАНОВЛЕН ВРУЧНУЮ' : 'СИСТЕМНЫЙ' }</div>
                </div>
              </div>
            </div>
          </div>

          {/* CURRENCY REGISTRY (Full width bottom panel) */}
          <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4">
            <div className="border-b border-slate-100 pb-2.5">
              <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5">
                <Wallet className="h-4.5 w-4.5 text-[#70FC8E]" style={{ fill: '#000' }} />
                <span>Справочник Валют RATIPA</span>
              </h3>
              <span className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-1">Список валют для финансовых модулей и конвертаций</span>
            </div>

            {isWritePermitted && (
              <form onSubmit={handleAddCurrency} className="flex gap-2.5 bg-slate-50 p-2.5 rounded-xl border border-slate-200/50 max-w-md">
                <input
                  type="text"
                  placeholder="Код валюты (напр. USD, PLN, BYN)"
                  required
                  value={cCode}
                  onChange={(e) => setCCode(e.target.value)}
                  className="flex-1 p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-black text-slate-800 uppercase font-mono tracking-widest placeholder:normal-case placeholder:font-bold"
                />
                <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase tracking-tight px-4 transition cursor-pointer font-mono">
                  Добавить валюту
                </button>
              </form>
            )}

            <div className="flex flex-wrap gap-2.5 pt-2">
              {currencies.map((c) => (
                <div key={c.id} className="bg-slate-50 hover:bg-slate-100 border border-slate-200 p-2.5 px-4 rounded-xl flex items-center gap-3 transition">
                  <span className="text-sm font-black font-mono tracking-widest text-slate-800 uppercase">{c.code}</span>
                  {isWritePermitted && (
                    <button 
                      onClick={() => handleDeleteCurrency(c.id)} 
                      className="text-rose-400 hover:text-rose-600 transition"
                      title="Удалить"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
              {!currencies.length && (
                <div className="text-slate-400 font-mono font-black uppercase tracking-wider text-xs py-4">Валюты не заданы.</div>
              )}
            </div>
          </div>

        </div>
      )}

      {/* TAB CONTENT 4: EXTERNAL PORTALS & PORTAL LINKS */}
      {activeTab === 'links' && (
        <div className="space-y-6">
          
          {/* Iframe Tables Links & GPS Providers */}
          <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-6">
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                <Layers className="h-4.5 w-4.5 text-blue-500 animate-pulse" />
                <span>Генеральные ссылки интеграций Google Sheets & GPS</span>
              </h2>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5 uppercase tracking-wide">
                Настройки встроенных системных вкладок фреймов и спутникового позиционирования автопарка
              </p>
            </div>

            {settings && (
              <div className="space-y-6">
                
                {/* Google sheets frames links */}
                <div className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-slate-50/50 space-y-3.5">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <ExternalLink className="w-3.5 h-3.5 text-[#107c41]" />
                    <span>Google Таблицы RATIPA (Встроенные Фреймы)</span>
                  </h4>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">План Загрузок (Фрейм Таблицы)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.planZagruzokSheetUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, planZagruzokSheetUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-400 transition font-mono text-[10px]"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">План Загрузок (Черный Список)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.planZagruzokBlacklistUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, planZagruzokBlacklistUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-red-400 transition font-mono text-[10px]"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">Диспозиция (Фрейм Таблицы)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.dispositionSheetUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, dispositionSheetUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-400 transition font-mono text-[10px]"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                      />
                    </div>
                  </div>
                </div>

                {/* GPS Integrations links */}
                <div className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-slate-50/50 space-y-3.5">
                  <h4 className="text-xs font-black text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Спутниковый GPS МониторингRATIPA</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">Белтрансспутник (Ссылка)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.gpsBeltranssputnikUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsBeltranssputnikUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-400 transition font-mono text-[10px]"
                        placeholder="https://..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">Wialon (Ссылка)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.gpsWialonUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsWialonUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-orange-400 transition font-mono text-[10px]"
                        placeholder="https://..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest block font-mono">ЭРА ГЛОНАСС (Ссылка)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.gpsEraGlonassUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsEraGlonassUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-blue-400 transition font-mono text-[10px]"
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* DYNAMIC QUICK LINKS & MENU TABS SECTION */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 pb-12">
            
            {/* Custom Dashboard useful bookmarks */}
            <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 flex flex-col">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                  <Link className="h-4 w-4 text-blue-500" />
                  <span>Полезные Экспресс-ссылки на Dashboard</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-1">Виджет быстрого клика на главной панели</span>
              </div>

              {isWritePermitted && (
                <form onSubmit={handleAddQuickLink} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/50 select-none">
                  <input
                    type="text"
                    placeholder="Название службы"
                    required
                    value={linkTitle}
                    onChange={(e) => setLinkTitle(e.target.value)}
                    className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-bold text-slate-800"
                  />
                  <input
                    type="url"
                    placeholder="https://..."
                    required
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-bold text-slate-800 font-mono text-[10px]"
                  />
                  <button type="submit" className="bg-slate-950 hover:bg-slate-850 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase transition cursor-pointer font-mono">
                    Вывести
                  </button>
                </form>
              )}

              <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-1 custom-scrollbar flex-1">
                {settings?.quickLinks?.map((li) => {
                  const isEditing = editingLinkId === li.id;
                  if (isEditing) {
                    return (
                      <form 
                        key={li.id} 
                        onSubmit={handleSaveEditQuickLink} 
                        className="flex flex-col sm:flex-row gap-1.5 bg-slate-100 p-2 rounded-xl border border-slate-300"
                      >
                        <input
                          type="text"
                          value={editingLinkTitle}
                          onChange={(e) => setEditingLinkTitle(e.target.value)}
                          required
                          className="p-1.5 bg-white text-xs rounded border border-slate-200 font-bold flex-1"
                        />
                        <input
                          type="url"
                          value={editingLinkUrl}
                          onChange={(e) => setEditingLinkUrl(e.target.value)}
                          required
                          className="p-1.5 bg-white text-xs rounded border border-slate-200 font-mono text-[10px] flex-1"
                        />
                        <div className="flex gap-1 justify-end">
                          <button type="submit" className="text-emerald-600 p-1 hover:bg-emerald-50 rounded">
                            <Check className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setEditingLinkId(null)} className="text-slate-400 p-1 hover:bg-slate-50 rounded">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <div key={li.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl text-xs font-bold border border-slate-100 group transition">
                      <span className="text-slate-800 uppercase font-mono">{li.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400 font-mono truncate max-w-[150px]">{li.url}</span>
                        {isWritePermitted && (
                          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition">
                            <button onClick={() => handleStartEditQuickLink(li)} className="text-indigo-600 hover:text-indigo-800 p-1 bg-white border border-slate-200 rounded">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteQuickLink(li.id)} className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-200 rounded">
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

            {/* Custom Top Navigation Bar Menu Links */}
            <div className="bg-white rounded-[2rem] p-5 lg:p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] space-y-4 flex flex-col">
              <div>
                <h3 className="text-xs font-black uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                  <ExternalLink className="h-4 w-4 text-blue-500" />
                  <span>Кастомные меню-вкладки на внешние сайты</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-1">Отображаются в верхнем навигационном меню RATIPA</span>
              </div>

              {isWritePermitted && (
                <form onSubmit={handleAddExternalTab} className="grid grid-cols-1 sm:grid-cols-3 gap-2 bg-slate-50 p-2 rounded-xl border border-slate-200/50 select-none">
                  <input
                    type="text"
                    placeholder="Название"
                    required
                    value={extTitle}
                    onChange={(e) => setExtTitle(e.target.value)}
                    className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-bold text-slate-800"
                  />
                  <input
                    type="url"
                    placeholder="https://..."
                    required
                    value={extUrl}
                    onChange={(e) => setExtUrl(e.target.value)}
                    className="p-2 bg-white text-xs rounded-lg border border-slate-200 focus:outline-none font-bold text-slate-800 font-mono text-[10px]"
                  />
                  <button type="submit" className="bg-slate-950 hover:bg-slate-855 text-[#70FC8E] rounded-lg text-[10px] font-black uppercase transition cursor-pointer font-mono">
                    Добавить
                  </button>
                </form>
              )}

              <div className="space-y-1.5 max-h-[250px] overflow-y-auto pr-1 custom-scrollbar flex-1">
                {(settings?.externalTabs || []).map((t) => {
                  const isEditing = editingExtId === t.id;
                  if (isEditing) {
                    return (
                      <form 
                        key={t.id} 
                        onSubmit={handleSaveEditExternalTab} 
                        className="flex flex-col sm:flex-row gap-1.5 bg-slate-100 p-2 rounded-xl border border-slate-300"
                      >
                        <input
                          type="text"
                          value={editingExtTitle}
                          onChange={(e) => setEditingExtTitle(e.target.value)}
                          required
                          className="p-1.5 bg-white text-xs rounded border border-slate-200 font-bold flex-1"
                        />
                        <input
                          type="url"
                          value={editingExtUrl}
                          onChange={(e) => setEditingExtUrl(e.target.value)}
                          required
                          className="p-1.5 bg-white text-xs rounded border border-slate-200 font-mono text-[10px] flex-1"
                        />
                        <div className="flex gap-1 justify-end">
                          <button type="submit" className="text-emerald-600 p-1 hover:bg-emerald-50 rounded">
                            <Check className="h-4 w-4" />
                          </button>
                          <button type="button" onClick={() => setEditingExtId(null)} className="text-slate-400 p-1 hover:bg-slate-50 rounded">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                      </form>
                    );
                  }

                  return (
                    <div key={t.id} className="flex justify-between items-center p-3 bg-slate-50 rounded-xl text-xs font-bold border border-slate-100 group transition">
                      <span className="text-slate-800 uppercase font-mono">{t.title}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] text-slate-400 font-mono truncate max-w-[150px]">{t.url}</span>
                        {isWritePermitted && (
                          <div className="flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition">
                            <button onClick={() => handleStartEditExternalTab(t)} className="text-indigo-600 hover:text-indigo-800 p-1 bg-white border border-slate-200 rounded">
                              <Edit2 className="h-3.5 w-3.5" />
                            </button>
                            <button onClick={() => handleDeleteExternalTab(t.id)} className="text-rose-500 hover:text-rose-700 p-1 bg-white border border-slate-200 rounded">
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

          </div>

        </div>
      )}

    </div>
  );
}

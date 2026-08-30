import React from 'react';
import {useState, useEffect} from 'react'
import {UserProfile, AppSettings, FerryTemplate, DistancePreset, QuickLink, CarRateGroup, Driver} from '../../types'
import {dbService, directoryService, database, onValue} from '../../api';
import {pdService} from '../../api'
import {ref, set, push, remove} from 'firebase/database'
import CouplingDirectoryEditor from './CouplingDirectoryEditor';
import DirectoriesModule from './DirectoriesModule';
import DriverDirectoryBlock from './directories/DriverDirectoryBlock';
import CurrentPlanningSettingsBlock from './CurrentPlanningSettingsBlock';
import PlanZagruzokSettingsBlock from './PlanZagruzokSettingsBlock';
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
  Link,
  RefreshCw,
  BookOpen
} from 'lucide-react';
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {formatDriverShortName} from '../../utils/driverSync'

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
  const [activeTab, setActiveTab] = useState<'fleet' | 'drivers' | 'system' | 'integrations' | 'directories'>('fleet');

  // Search states for directories
  const [carSearch, setCarSearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [distanceSearch, setDistanceSearch] = useState('');
  const [ferrySearch, setFerrySearch] = useState('');
  const [directionSearch, setDirectionSearch] = useState('');

  // Dynamic directory builders
  const [ferries, setFerries] = useState<FerryTemplate[]>([]);
  const [distances, setDistances] = useState<DistancePreset[]>([]);
  const [carRateGroups, setCarRateGroups] = useState<CarRateGroup[]>([]);

  // Local Form states (Tariff Group)
  const [stName, setStName] = useState('');
  const [stRate, setStRate] = useState<number>(0.125);
  const [stPerDiem, setStPerDiem] = useState<number | undefined>(undefined);
  const [stComment, setStComment] = useState('');

  // Local Form states (Ferry)
  const [fName, setFName] = useState('');
  const [fPrice, setFPrice] = useState<number>(0);

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
  const [drLastNameRu, setDrLastNameRu] = useState('');
  const [drFirstNameRu, setDrFirstNameRu] = useState('');
  const [drMiddleNameRu, setDrMiddleNameRu] = useState('');
  const [drLastNameLat, setDrLastNameLat] = useState('');
  const [drFirstNameLat, setDrFirstNameLat] = useState('');
  const [drMiddleNameLat, setDrMiddleNameLat] = useState('');
  const [drPhone, setDrPhone] = useState('');
  const [drLicense, setDrLicense] = useState('');
  const [drRateGroupId, setDrRateGroupId] = useState('');
  const [drComment, setDrComment] = useState('');
  
  // Driver Editing State
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [editDrName, setEditDrName] = useState('');
  const [editDrLastNameRu, setEditDrLastNameRu] = useState('');
  const [editDrFirstNameRu, setEditDrFirstNameRu] = useState('');
  const [editDrMiddleNameRu, setEditDrMiddleNameRu] = useState('');
  const [editDrLastNameLat, setEditDrLastNameLat] = useState('');
  const [editDrFirstNameLat, setEditDrFirstNameLat] = useState('');
  const [editDrMiddleNameLat, setEditDrMiddleNameLat] = useState('');
  const [editDrPhone, setEditDrPhone] = useState('');
  const [editDrLicense, setEditDrLicense] = useState('');
  const [editDrRateGroupId, setEditDrRateGroupId] = useState('');
  const [editDrComment, setEditDrComment] = useState('');

  
  // Mass Selection States
  const [selectedCars, setSelectedCars] = useState<string[]>([]);
  const [lastSelectedCar, setLastSelectedCar] = useState<string | null>(null);

  const toggleCarSelection = (car: string, isShift: boolean) => {
    const allPlates = allCars.filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase()));
    if (isShift && lastSelectedCar) {
      const startIndex = allPlates.indexOf(lastSelectedCar);
      const endIndex = allPlates.indexOf(car);
      if (startIndex !== -1 && endIndex !== -1) {
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        const slice = allPlates.slice(start, end + 1);
        setSelectedCars(prev => [...new Set([...prev, ...slice])]);
        setLastSelectedCar(car);
        return;
      }
    }
    setSelectedCars(prev => {
      if (prev.includes(car)) {
        return prev.filter(c => c !== car);
      }
      return [...prev, car];
    });
    setLastSelectedCar(car);
  };

  const handleMassMapToDispatcher = (disp: string | null) => {
    if (!isWritePermitted || selectedCars.length === 0) return;
    const updatedMap = { ...dispatchersMap };
    selectedCars.forEach(car => {
      if (!disp || disp === 'Без диспетчера') {
        delete updatedMap[car];
      } else {
        updatedMap[car] = disp;
      }
    });
    pdService.updateDispatchersCarMapping(updatedMap);
    dbService.logAction(user.name, user.role, 'Mass Map Car', 'Settings', selectedCars.join(', '), `Массово привязано к ${disp || 'Без диспетчера'}`);
    toast(`Назначен диспетчер для ${selectedCars.length} авто`, 'success');
    setSelectedCars([]);
  };

  const handleMassMapToDriver = (driverId: string | null) => {
    if (!isWritePermitted || selectedCars.length === 0) return;
    const updatedMap = { ...driversMap };
    selectedCars.forEach(car => {
      if (!driverId || driverId === 'Без водителя') {
        delete updatedMap[car];
      } else {
        updatedMap[car] = driverId;
      }
    });
    pdService.updateDriversCarMapping(updatedMap);
    dbService.logAction(user.name, user.role, 'Mass Map Driver', 'Settings', selectedCars.join(', '), `Массово назначен водитель ${driverId || 'Без водителя'}`);
    toast(`Назначен водитель для ${selectedCars.length} авто`, 'success');
    setSelectedCars([]);
  };

  const handleMassMapToTariff = (targetGroup: CarRateGroup | null) => {
    if (!isWritePermitted || selectedCars.length === 0) return;
    
    // First remove from all existing groups
    carRateGroups.forEach(g => {
      const hasSelected = g.vehicles?.some(v => selectedCars.includes(v));
      if (hasSelected) {
        dbService.saveCarRateGroup({
          ...g,
          vehicles: (g.vehicles || []).filter(v => !selectedCars.includes(v))
        }, user.name, user.role);
      }
    });
    
    if (targetGroup) {
      // Add to new group
      dbService.saveCarRateGroup({
        ...targetGroup,
        vehicles: [...new Set([...(targetGroup.vehicles || []), ...selectedCars])]
      }, user.name, user.role);
    }
    
    dbService.logAction(user.name, user.role, 'Mass Map Tariff', 'Settings', selectedCars.join(', '), `Массово назначен тариф ${targetGroup?.name || 'Без тарифа'}`);
    toast(`Назначен тариф для ${selectedCars.length} авто`, 'success');
    setSelectedCars([]);
  };

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
  const [driversMap, setDriversMap] = useState<Record<string, string>>({});
  const [activeDispSelect, setActiveDispSelect] = useState<string>('Без диспетчера');
  const [carSearchInMapping, setCarSearchInMapping] = useState<string>('');
  const [dragOverDisp, setDragOverDisp] = useState<string | null>(null);
  
  useEffect(() => {
    // Sync settings & categories
    const unsubSettings = dbService.getSettings(setSettings);
    const unsubPdSettings = pdService.subscribePlanDohodSettings(setPdSettings);
    const unsubFerries = dbService.getFerryTemplates(setFerries);
    const unsubDistances = dbService.getDistances(setDistances);
    const unsubCars = dbService.getCarRateGroups(setCarRateGroups);
    const unsubDirs = directoryService.getDirectionsMap(setDirections);
    const unsubDrivers = dbService.getDrivers(setDrivers);
    const unsubDisp = directoryService.getDispatchersFlat(setDispatchers);
    const unsubMap = pdService.subscribeDispatchersCarMapping((m) => setDispatchersMap(m));
    const unsubDriversMap = pdService.subscribeDriversCarMapping((m) => setDriversMap(m));
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
    const unsubSavedCarsList = directoryService.getCarsList(setSavedCars);

    return () => {
      unsubSettings();
      unsubPdSettings();
      unsubFerries();
      unsubDistances();
      unsubCars();
      unsubDirs();
      unsubDrivers();
      unsubDisp();
      unsubMap();
      unsubBazaCarsList();
      unsubSavedCarsList();
    };
  }, []);

  // Self-healing synchronization to align vehicle directory and tariff groups.
  // Writes are idempotent: we compute the TARGET state and only write when it
  // actually differs from the current one (by content, not reference), so the
  // resulting onValue/subscription callbacks cannot re-trigger this effect in a loop.
  useEffect(() => {
    if (!isKnownFleetLoaded || carRateGroups.length === 0 || !isWritePermitted) return;

    const tariffSet = new Set(
      carRateGroups.flatMap((g) => (g.vehicles || []).map((v) => v.trim().toUpperCase())).filter(Boolean)
    );
    if (tariffSet.size === 0) return;

    // --- known_fleet: reconcile to exactly the tariff-set plates ---
    const currentKnown = new Set(knownFleet.map((v) => v.trim().toUpperCase()).filter(Boolean));
    const missing = Array.from(tariffSet).filter((v) => !currentKnown.has(v));
    const obsolete = knownFleetObjects.filter((item) => {
      const plate = (item.plate || "").trim().toUpperCase();
      return plate && !tariffSet.has(plate);
    });

    if (missing.length > 0 || obsolete.length > 0) {
      // Build the TARGET object (only tariff plates) and write it as a whole.
      const target: Record<string, string> = {};
      tariffSet.forEach((plate) => {
        // keep existing key when present so we don't churn firebase keys
        const existing = knownFleetObjects.find((i) => (i.plate || "").trim().toUpperCase() === plate);
        target[existing ? existing.key : plate] = plate;
      });
      const dbRef = ref(database, "known_fleet");
      set(dbRef, target);
    }

    // --- dispatcher mapping: drop plates no longer in any tariff group ---
    const currentMapKeys = Object.keys(dispatchersMap);
    const cleaned = { ...dispatchersMap };
    let mapChanged = false;
    currentMapKeys.forEach((plate) => {
      if (!tariffSet.has(plate.trim().toUpperCase())) {
        delete cleaned[plate];
        mapChanged = true;
      }
    });
    if (mapChanged) {
      const sameAsCurrent =
        Object.keys(cleaned).length === currentMapKeys.length &&
        Object.keys(cleaned).every((k) => cleaned[k] === dispatchersMap[k]);
      if (!sameAsCurrent) pdService.updateDispatchersCarMapping(cleaned);
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
    // Persist into unified directories/directions (each entry = {id, name, coeff})
    Object.entries(updatedDirections).forEach(([name, coeff]) => {
      directoryService.saveDirItem('directions', { id: name, name, coeff: Number(coeff) || 0 }, user.name, user.role);
    });
    dbService.logAction(user.name, user.role, editingDirKey ? 'Edit Direction' : 'Add Direction', 'Settings', formattedName, `${editingDirKey ? 'Обновлено' : 'Добавлено'} направление: ${formattedName} с коэф: ${dirCoeff}`);
    
    setDirName('');
    setDirCoeff(1.0);
    setEditingDirKey(null);
  };

  const handleDeleteDirection = async (nameToDel: string) => {
    if (!(await showConfirm(`Вы действительно хотите удалить направление "${nameToDel}"?`))) return;
    const updatedDirections = { ...directions };
    delete updatedDirections[nameToDel];
    directoryService.deleteDirItem('directions', nameToDel, user.name, user.role);
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
    
    let lastRu = drLastNameRu.trim();
    let firstRu = drFirstNameRu.trim();
    let midRu = drMiddleNameRu.trim();
    let nameVal = [lastRu, firstRu, midRu].filter(Boolean).join(' ');

    if (!nameVal && drName.trim()) {
      nameVal = drName.trim();
      const parts = nameVal.split(/\s+/);
      lastRu = parts[0] || '';
      firstRu = parts[1] || '';
      midRu = parts[2] || '';
    }

    if (!nameVal) {
      toast("ФИО водителя не может быть пустым!", 'error');
      return;
    }

    const shortNameRuVal = formatDriverShortName(lastRu, firstRu, midRu);
    const shortNameLatVal = formatDriverShortName(drLastNameLat.trim(), drFirstNameLat.trim(), drMiddleNameLat.trim());

    const newDriver: Driver = {
      id: "dr_" + Date.now(),
      name: nameVal,
      lastNameRu: lastRu,
      firstNameRu: firstRu,
      middleNameRu: midRu,
      lastNameLat: drLastNameLat.trim(),
      firstNameLat: drFirstNameLat.trim(),
      middleNameLat: drMiddleNameLat.trim(),
      shortNameRu: shortNameRuVal,
      shortNameLat: shortNameLatVal,
      phone: drPhone.trim(),
      license: drLicense.trim(),
      rateGroupId: drRateGroupId,
      comment: drComment.trim()
    };

    dbService.saveDriver(newDriver, user.name, user.role);
    setDrName('');
    setDrLastNameRu('');
    setDrFirstNameRu('');
    setDrMiddleNameRu('');
    setDrLastNameLat('');
    setDrFirstNameLat('');
    setDrMiddleNameLat('');
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
    setEditDrLastNameRu(drv.lastNameRu || '');
    setEditDrFirstNameRu(drv.firstNameRu || '');
    setEditDrMiddleNameRu(drv.middleNameRu || '');
    setEditDrLastNameLat(drv.lastNameLat || '');
    setEditDrFirstNameLat(drv.firstNameLat || '');
    setEditDrMiddleNameLat(drv.middleNameLat || '');
    setEditDrPhone(drv.phone || '');
    setEditDrLicense(drv.license || '');
    setEditDrRateGroupId(drv.rateGroupId || '');
    setEditDrComment(drv.comment || '');
  };

  const handleSaveEditDriver = (id: string) => {
    let lastRu = editDrLastNameRu.trim();
    let firstRu = editDrFirstNameRu.trim();
    let midRu = editDrMiddleNameRu.trim();
    let nameVal = [lastRu, firstRu, midRu].filter(Boolean).join(' ');

    if (!nameVal && editDrName.trim()) {
      nameVal = editDrName.trim();
      const parts = nameVal.split(/\s+/);
      lastRu = parts[0] || '';
      firstRu = parts[1] || '';
      midRu = parts[2] || '';
    }

    if (!nameVal) {
      toast("ФИО водителя не может быть пустым!", 'error');
      return;
    }

    const shortNameRuVal = formatDriverShortName(lastRu, firstRu, midRu);
    const shortNameLatVal = formatDriverShortName(editDrLastNameLat.trim(), editDrFirstNameLat.trim(), editDrMiddleNameLat.trim());

    const updated: Driver = {
      id,
      name: nameVal,
      lastNameRu: lastRu,
      firstNameRu: firstRu,
      middleNameRu: midRu,
      lastNameLat: editDrLastNameLat.trim(),
      firstNameLat: editDrFirstNameLat.trim(),
      middleNameLat: editDrMiddleNameLat.trim(),
      shortNameRu: shortNameRuVal,
      shortNameLat: shortNameLatVal,
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
      <div className="bg-white rounded-2xl p-8 shadow-sm border border-slate-200/50 text-center flex flex-col justify-center items-center py-24 select-none">
        <Lock className="h-12 w-12 text-slate-400 mb-4" style={{ strokeWidth: 1.5 }} />
        <span className="text-sm font-bold text-slate-900 uppercase font-mono tracking-wider">Раздел заблокирован</span>
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
    { id: 'drivers', label: 'База водителей', icon: Users, count: filteredDrivers.length },
    { id: 'directories', label: 'База данных', icon: BookOpen, count: 0 },
    { id: 'system', label: 'Системные Настройки', icon: Settings, count: 0 },
    { id: 'integrations', label: 'Интеграции', icon: ExternalLink, count: 0 }
  ] as const;

  return (
    <div className="w-full space-y-6 font-sans">
      
      {/* HEADER BAR */}
      <div className="bg-white rounded-2xl p-6 lg:p-8 border border-slate-200/50 shadow-sm">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">Модуль Справочники</span>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <Settings className="w-7 h-7 text-slate-800" />
              <span>Корпоративные справочники</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1 font-medium">
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
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold transition duration-150 select-none cursor-pointer ${
                  isActive 
                    ? 'bg-slate-900 text-white shadow-sm font-semibold' 
                    : 'text-slate-500 hover:text-slate-900 hover:bg-white/50'
                }`}
              >
                <IconComp className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                <span>{t.label}</span>
                {t.count > 0 && (
                  <span className={`text-[9px] px-1.5 py-0.5 rounded-md font-mono font-bold ${
                    isActive ? 'bg-white/20 text-white' : 'bg-slate-200 text-slate-600'
                  }`}>
                    {t.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* TAB CONTENT 1: COUPLING DIRECTORY (unified base) */}
      {activeTab === 'fleet' && (
        <CouplingDirectoryEditor user={user} isWritePermitted={isWritePermitted} />
      )}


      {/* TAB CONTENT 2: DRIVERS BASE */}
      {activeTab === 'drivers' && (
        <div className="space-y-6">
          <DriverDirectoryBlock user={user} />
        </div>
      )}

      {/* TAB CONTENT 3: SYSTEM SETTINGS */}
      {activeTab === 'system' && (
        <div className="space-y-6">
          
          {/* CORE RATES & INTEGRATION ROW */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            
            {/* Rates setting (5 cols) */}
            <div className="bg-white rounded-2xl p-5 lg:p-6 border border-slate-200/50 shadow-sm space-y-4 lg:col-span-5 flex flex-col">
              <div>
                <h3 className="text-xs font-bold uppercase text-slate-900 font-mono tracking-wider flex items-center gap-1.5 border-b border-slate-100 pb-2.5">
                  <Wallet className="h-4.5 w-4.5 text-blue-500" />
                  <span>Глобальные нормативные ставки</span>
                </h3>
                <span className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-1">Базовые величины расчетов по умолчанию</span>
              </div>

              {settings && (
                <div className="space-y-4 flex-1">
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Ставка простоя (€/день)</label>
                    <input
                      type="number"
                      disabled={!isWritePermitted}
                      defaultValue={settings.idleRate}
                      onBlur={(e) => dbService.saveSettings({...settings, idleRate: Number(e.target.value)}, user.name, user.role)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-400 font-mono text-slate-800"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Ставка суточных командировочных (€/день)</label>
                    <input
                      type="number"
                      disabled={!isWritePermitted}
                      defaultValue={settings.perDiemRate}
                      onBlur={(e) => dbService.saveSettings({...settings, perDiemRate: Number(e.target.value)}, user.name, user.role)}
                      className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-400 font-mono text-slate-800"
                    />
                  </div>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 text-[10px] text-slate-400 font-medium leading-relaxed mt-2 uppercase font-mono tracking-wide">
                    ⚠ Смена данных величин немедленно затронет новые расчеты в калькуляциях и диспетчерских планировщиках. Исторические записи останутся без изменений.
                  </div>
                </div>
              )}
            </div>

          </div>

        </div>
      )}

      {/* TAB CONTENT 4: EXTERNAL PORTALS & PORTAL LINKS */}
      {activeTab === 'integrations' && (
        <div className="space-y-6">
          
          {/* Iframe Tables Links & GPS Providers */}
          <div className="bg-white rounded-2xl p-5 lg:p-6 border border-slate-200/50 shadow-sm space-y-6">
            <div>
              <h2 className="text-sm font-bold text-slate-900 uppercase tracking-tight flex items-center gap-2">
                <Layers className="h-4.5 w-4.5 text-blue-500" />
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
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <ExternalLink className="w-3.5 h-3.5 text-[#107c41]" />
                    <span>Google Таблицы RATIPA (Встроенные Фреймы)</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">План Загрузок (Фрейм Таблицы)</label>
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
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">План Загрузок (Черный Список)</label>
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
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Диспозиция (Фрейм Таблицы)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.dispositionSheetUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, dispositionSheetUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-emerald-400 transition font-mono text-[10px]"
                        placeholder="https://docs.google.com/spreadsheets/d/..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Google Диск (Авто и Водители)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.googleDriveUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, googleDriveUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-[#3765F6] focus:ring-4 focus:ring-[#3765F6]/10 transition font-mono text-[10px]"
                        placeholder="https://drive.google.com/drive/folders/..."
                      />
                    </div>
                  </div>
                </div>

                {/* GPS Integrations links */}
                <div className="border border-slate-200 rounded-2xl p-4 sm:p-5 bg-slate-50/50 space-y-3.5">
                  <h4 className="text-xs font-bold text-slate-800 uppercase tracking-tight flex items-center gap-2">
                    <Globe className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Спутниковый GPS Мониторинг RATIPA</span>
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Белтрансспутник (Ссылка)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.gpsBeltranssputnikUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsBeltranssputnikUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-[#3765F6] focus:ring-4 focus:ring-[#3765F6]/10 transition font-mono text-[10px]"
                        placeholder="https://..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">Wialon (Ссылка)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.gpsWialonUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsWialonUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-[#3765F6] focus:ring-4 focus:ring-[#3765F6]/10 transition font-mono text-[10px]"
                        placeholder="https://..."
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block font-mono">ЭРА ГЛОНАСС (Ссылка)</label>
                      <input
                        type="url"
                        disabled={!isWritePermitted}
                        defaultValue={settings.gpsEraGlonassUrl || ''}
                        onBlur={(e) => dbService.saveSettings({...settings, gpsEraGlonassUrl: e.target.value}, user.name, user.role)}
                        className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:outline-none focus:border-[#3765F6] focus:ring-4 focus:ring-[#3765F6]/10 transition font-mono text-[10px]"
                        placeholder="https://..."
                      />
                    </div>
                  </div>
                </div>

              </div>
            )}
          </div>

          {/* Planning Blocks — из Администрирования */}
          <CurrentPlanningSettingsBlock user={user} />
          <PlanZagruzokSettingsBlock user={user} />

        </div>
      )}

      {/* TAB CONTENT 5: LEGACY DIRECTORIES */}
      {activeTab === 'directories' && (
        <DirectoriesModule user={user} />
      )}

    </div>
  );
}
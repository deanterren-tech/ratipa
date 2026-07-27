import {useDialog} from '../DialogProvider'
import React, {useState, useEffect, useRef} from 'react'
import {UserProfile} from '../../types'
import { dbService, directoryService, database, onValue } from '../../api';
import {pdService} from '../../api'
import {getCouplingsFlat} from '../../services/fleetService'
import LossDeclarationEditor from "./LossDeclarationEditor";
import { ref, set, remove, update } from 'firebase/database'
import { 
  FileText,
  Plus, 
  Trash2, 
  Edit3, 
  Copy, 
  Printer, 
  Check, 
  Info, 
  FileCheck,
  ChevronRight,
  ArrowRight,
  RefreshCw,
  FolderOpen,
  Truck,
  User,
  Calendar,
  Lock,
  DollarSign,
  Wand2,
  BookOpen,
  GripVertical,
  UploadCloud,
  X,
  Search
} from 'lucide-react';
import * as pdfjsLib from "pdfjs-dist";
// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
interface Props {
  user: UserProfile;
}
interface FerryCouple {
  id: string;
  stateNumber: string;
  model: string;
  modelRu?: string;
  vehicleType: string;
  dimensions: string;
  weight: string;
  driver1: string;
  driver2?: string;
  dispatcher?: string;
}
const DEFAULT_COUPLES: FerryCouple[] = [
  {
    id: 'couple_preset_1',
    stateNumber: '1) AX1587-7/А1063Е-7',
    model: 'МЕРСЕДЕС-БЕНЦ',
    vehicleType: 'Тенты 90м3',
    dimensions: '13,6м х 2,45м х 2,7м',
    weight: '1) 14,6т',
    driver1: 'Крупский Станислав Петрович KRUPSKI STANISLAU КВ 2830564 22.10.2024 Октябрьским РОВД г. Могилёва',
    driver2: '',
    dispatcher: 'Сергей Т.'
  },
  {
    id: 'couple_preset_2',
    stateNumber: '1) AE6052-7/А2453Е-7',
    model: 'Скания',
    vehicleType: 'Тенты 90м3',
    dimensions: '13,6м х 2,45м х 2,7м',
    weight: '1) 14,4т',
    driver1: 'Устинов Олег Леонидович USTSINAU ALEH МР 5065058 09.01.2024 Фрунзенским РУВД г. Минска',
    driver2: '',
    dispatcher: 'Мария К.'
  },
  {
    id: 'couple_preset_3',
    stateNumber: '1) BI2031-7/A1124X-7',
    model: 'Вольво FH',
    vehicleType: 'Рефрижератор 86м3',
    dimensions: '13,4м х 2,46м x 2,65м',
    weight: '1) 15,2т',
    driver1: 'Николаев Андрей Викторович NIKOLAEV ANDREI MP 3214567 15.03.2025 Октябрьским РОВД г. Гродно',
    driver2: '',
    dispatcher: 'Владимир Б.'
  },
  {
    id: 'couple_preset_4',
    stateNumber: '1) KM9871-5/P0944A-5',
    model: 'ДАФ XF',
    vehicleType: 'Тенты 92м3',
    dimensions: '13,6м x 2,48м x 2,72м',
    weight: '1) 14,1т',
    driver1: 'Козлов Сергей Александрович KOZLOV SERGEI KB 9876543 12.08.2024 Первомайским РУВД г. Витебска',
    driver2: 'Морозов Иван Иванович MOROZOV IVAN KB 1234567 22.11.2024 Центральным РУВД г. Гомеля',
    dispatcher: 'Елена В.'
  }
];
const DEFAULT_CONTACTS = [
  'Терез Сергей Евгеньевич +375445835065',
  'Бориско Владимир Владимирович +375296554522',
  'Макаров Николай Петрович +375298884433'
];
export default function DocumentsModule({ user }: Props) {
  const { showConfirm, showAlert } = useDialog();
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'ferry' | 'bamap_tir'>('ferry');
  // --- BAMAP TIR SEIZURE LETTER STATE ---
  const [tirOutboxNum, setTirOutboxNum] = useState('90');
  const [tirOutboxDate, setTirOutboxDate] = useState('');
  const [tirCarnetNumbers, setTirCarnetNumbers] = useState('XZ87832581');
  const [tirSignee, setTirSignee] = useState('В.В.Бориско');
  const [tirSavedSuccess, setTirSavedSuccess] = useState(false);
  const [tirSubTab, setTirSubTab] = useState<"letter" | "loss">("letter");
  const [tirLossCause, setTirLossCause] = useState("retained");
  const [tirLossDisappearancePlaceDate, setTirLossDisappearancePlaceDate] = useState("");
  
  // Searchable places database state
  const [savedPlaces, setSavedPlaces] = useState<string[]>([
    'на таможне назначения в РФ',
    'на таможне отправления в РБ',
    'таможенный пост Козловичи',
    'таможня Бобровники',
    'ПП Каменный Лог',
    'ПП Григоровщина',
    'ПП Урбаны',
    'ПП Котловка'
  ]);
  // --- FERRY PORT (ПОРУЧЕНИЕ НА ПАРОМ) STATE & DATABASE ---
  const [ferryCouples, setFerryCouples] = useState<FerryCouple[]>([]);
  const [selectedCoupleId, setSelectedCoupleId] = useState<string>('couple_preset_1');
  const [showCoupleEditor, setShowCoupleEditor] = useState(false);
  const [editCoupleId, setEditCoupleId] = useState<string | null>(null);
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [vehicleSearchQuery, setVehicleSearchQuery] = useState('');
  const [dispatcherFilter, setDispatcherFilter] = useState('all');
  // Main reference directory (vehicle_driver_data) — linked source for ferry orders
  const [mainBaseCouples, setMainBaseCouples] = useState<any[]>([]);
  const [baseSearchQuery, setBaseSearchQuery] = useState('');
  const [selectedBaseId, setSelectedBaseId] = useState<string | null>(null);
  
  // Ferry Couple form state for adding/editing 1-block machine configuration
  const [coupleStateNumber, setCoupleStateNumber] = useState('');
  const [coupleModel, setCoupleModel] = useState('');
  const [coupleModelRu, setCoupleModelRu] = useState('');
  const [coupleVehicleType, setCoupleVehicleType] = useState('Тенты 90м3');
  const [coupleDimensions, setCoupleDimensions] = useState('13,6м х 2,45м х 2,7м');
  const [coupleWeight, setCoupleWeight] = useState('1) 14,6т');
  const [coupleDriver1, setCoupleDriver1] = useState('');
  const [coupleDriver2, setCoupleDriver2] = useState('');
  const [coupleDispatcher, setCoupleDispatcher] = useState('');
  // Ferry Order form fields
  const [ferryOrgName, setFerryOrgName] = useState('Общество с ограниченной ответственностью «РАТИПА»');
  const [ferryLoadingDatePort, setFerryLoadingDatePort] = useState('');
  const [ferryContactPerson, setFerryContactPerson] = useState('Терез Сергей Евгеньевич +375445835065');
  
  // Non-editable fields fixed to default values as requested
  const ferryCarrierName = 'Общество с ограниченной ответственностью «РАТИПА»';
  const ferryTotalCost = '';
  const ferryClientSignee = 'Директор Бориско В.В.';
  // Bound vehicle fields (linked dynamically under selected Couple)
  const [ferryStateNumber, setFerryStateNumber] = useState('');
  const [ferryVehicleModel, setFerryVehicleModel] = useState('');
  const [ferryVehicleModelRu, setFerryVehicleModelRu] = useState('');
  const [ferryVehicleType, setFerryVehicleType] = useState('');
  const [ferryDimensions, setFerryDimensions] = useState('');
  const [ferryVehicleWeight, setFerryVehicleWeight] = useState('');
  const [ferryDriver1Details, setFerryDriver1Details] = useState('');
  const [ferryDriver2Details, setFerryDriver2Details] = useState('');
  const [ferryCargoDetails, setFerryCargoDetails] = useState('1) сборный груз до 16 т. 28 упаковочных мест');
  const [consignmentsNum, setConsignmentsNum] = useState('5'); // only quantity digit is customizable
  const ferryConsignmentsCount = `1) ${consignmentsNum} CMR`;
  // Save feedback
  const [ferrySavedSuccess, setFerrySavedSuccess] = useState(false);
  // --- FERRY CONTACTS STATE & DATABASE ---
  const [ferryContactsList, setFerryContactsList] = useState<string[]>([]);
  const [ferryDispatchers, setFerryDispatchers] = useState<string[]>([]);
  const canWrite = user.role === 'root_admin' || user.permissions.documents === 'write';
  useEffect(() => {
    return directoryService.getDispatchersFlat((disp) => {
      setFerryDispatchers(disp);
    });
  }, []);
  // 1. Load the MAIN reference directory (vehicleFleet) and mirror it into ferryCouples
  // so the ferry-order logic works from the single unified base. Old separate ferryCouples
  // branch is no longer used as a source.
  // Stabilize the vehicle-driver payload so the reactive Firebase subscription
  // does not push a brand-new `mapped` array (new reference) on every snapshot,
  // which previously caused an infinite setState/re-render loop
  // ("Maximum update depth exceeded").
  const lastFerryKeyRef = useRef<string>('');
  useEffect(() => {
    const unsub = getCouplingsFlat((list: any[]) => {
      const src = list || [];
      const mapped: FerryCouple[] = src.map((rec: any) => {
        const coupling = rec.coupling || rec.vehicleNumbers || rec.carNumber || '';
        return {
          id: rec.id,
          stateNumber: coupling ? `1) ${coupling}` : '',
          model: rec.brandModel || rec.brands || rec.brand || '',
          modelRu: rec.brandRu || '',
          vehicleType: rec.vehicleType || '',
          dimensions: rec.dimensions || '',
          weight: rec.weight || '',
          driver1: rec.driverNameRu || rec.driverName || '',
          driver2: rec.driver2 || '',
          dispatcher: rec.dispatcher || rec.dispatcherName || '',
        } as FerryCouple;
      });

      const key = JSON.stringify(mapped.map((c) => [c.id, c.stateNumber, c.model, c.driver1, c.dispatcher]));
      if (key !== lastFerryKeyRef.current) {
        lastFerryKeyRef.current = key;
        setMainBaseCouples(src);
        setFerryCouples(mapped);
      }
      // Select a default couple only once (never re-trigger on repeated snapshots)
      if (!selectedCoupleId && mapped.length) {
        setSelectedCoupleId(mapped[0].id);
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 1b. Set default loading date and load contacts on startup
  useEffect(() => {
    const todayStr = new Date().toLocaleDateString('ru-RU');
    setFerryLoadingDatePort(`${todayStr} Карасу`);
    // Fetch and seed contacts
    const contactsRef = ref(database, 'ferryContacts');
    const unsubContacts = onValue(contactsRef, (snap) => {
      const val = snap.val();
      if (val) {
        setFerryContactsList(Object.values(val));
      } else {
        setFerryContactsList(DEFAULT_CONTACTS);
        DEFAULT_CONTACTS.forEach(c => {
          const contactKey = c.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_');
          set(ref(database, `ferryContacts/${contactKey}`), c);
        });
      }
    });
    // Load last TIR letter data
    setTirOutboxDate(todayStr);
    const tirRef = ref(database, 'bamapTirLastData');
    const unsubTir = onValue(tirRef, (snap) => {
      const data = snap.val();
      if (data) {
        if (data.tirOutboxNum) setTirOutboxNum(data.tirOutboxNum);
        if (data.tirOutboxDate) setTirOutboxDate(data.tirOutboxDate);
        if (data.tirCarnetNumbers) setTirCarnetNumbers(data.tirCarnetNumbers);
        if (data.tirSignee) setTirSignee(data.tirSignee);
      }
    }, { onlyOnce: true });
    
    // Load saved seizure places
    const placesRef = ref(database, 'dozvolsLossPlacesV1');
    const unsubPlaces = onValue(placesRef, (snap) => {
      const data = snap.val();
      if (data) {
        const list = Object.values(data) as string[];
        setSavedPlaces(prev => Array.from(new Set([...prev, ...list])));
      }
    });
    return () => {
      unsubContacts();
      unsubTir();
      unsubPlaces();
    };
  }, []);
  // 2. Select Couple and update the current coupled vehicle variables (Linked blocks)
  useEffect(() => {
    if (!selectedCoupleId) return;
    const couple = ferryCouples.find(c => c.id === selectedCoupleId);
    let unsubOrder: (() => void) | undefined;
    if (couple) {
      setFerryStateNumber(couple.stateNumber);
      setFerryVehicleModel(couple.model);
      setFerryVehicleModelRu(couple.modelRu || '');
      setFerryVehicleType(couple.vehicleType);
      setFerryDimensions(couple.dimensions);
      setFerryVehicleWeight(couple.weight);
      setFerryDriver1Details(couple.driver1);
      setFerryDriver2Details(couple.driver2 || '');
      
      // Load saved ferry order dynamic values (e.g. cargo details, date/port, conctact person) from database
      unsubOrder = onValue(ref(database, `ferryOrdersData/${selectedCoupleId}`), (snap) => {
        const savedOrderObj = snap.val();
        if (savedOrderObj) {
          if (savedOrderObj.ferryOrgName) setFerryOrgName(savedOrderObj.ferryOrgName);
          if (savedOrderObj.ferryLoadingDatePort) setFerryLoadingDatePort(savedOrderObj.ferryLoadingDatePort);
          if (savedOrderObj.ferryContactPerson) setFerryContactPerson(savedOrderObj.ferryContactPerson);
          if (savedOrderObj.ferryCargoDetails) setFerryCargoDetails(savedOrderObj.ferryCargoDetails);
          if (savedOrderObj.consignmentsNum) setConsignmentsNum(savedOrderObj.consignmentsNum);
        }
      }, { onlyOnce: true });
    }
    return () => {
      if (unsubOrder) unsubOrder();
    };
  }, [selectedCoupleId, ferryCouples]);
  // Save current dynamic order fields under the selected couple
  const handleSaveFerryDataForCar = () => {
    if (!selectedCoupleId) {
      alert("Сначала выберите или добавьте автомобиль!");
      return;
    }
    const payload = {
      ferryOrgName,
      ferryLoadingDatePort,
      ferryContactPerson,
      ferryCargoDetails,
      consignmentsNum
    };
    const cleanContact = ferryContactPerson.trim();
    if (cleanContact) {
      const contactKey = cleanContact.replace(/[^a-zA-Z0-9а-яА-Я]/g, '_');
      set(ref(database, `ferryContacts/${contactKey}`), cleanContact)
        .catch(e => console.warn("Contact save key failed", e));
    }
    set(ref(database, `ferryOrdersData/${selectedCoupleId}`), payload)
      .then(() => {
        setFerrySavedSuccess(true);
        dbService.logAction(user.name, user.role, "Документы паром", "Documents", selectedCoupleId, `Сохранил параметры поручения на паром для сцепки`);
        setTimeout(() => setFerrySavedSuccess(false), 2500);
      })
      .catch(err => {
        console.error("Ferry order save failed", err);
        alert("Ошибка при сохранении параметров поручения.");
      });
  };
  const [isParsingCouple, setIsParsingCouple] = useState(false);
  const [coupleRawText, setCoupleRawText] = useState("");
  const [coupleImageBase64, setCoupleImageBase64] = useState<string | null>(null);
  const handleImageUpload = (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Пожалуйста, выберите файл изображения (скриншот или фото).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCoupleImageBase64(reader.result as string);
    };
    reader.readAsDataURL(file);
  };
  const handleCouplePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      if (items[i].type.indexOf("image") !== -1) {
        const file = items[i].getAsFile();
        if (file) {
          handleImageUpload(file);
        }
      }
    }
  };
  const handleParseCouple = async () => {
    if (!coupleRawText.trim() && !coupleImageBase64) {
      alert("Введите текст или добавьте скриншот/изображение для распознавания.");
      return;
    }
    setIsParsingCouple(true);
    try {
      const res = await fetch("/api/parse-couple-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: coupleRawText, image: coupleImageBase64 })
      });
      if (!res.ok) {
        let serverError = "Ошибка распознавания на сервере парсинга";
        try {
          const errData = await res.json();
          if (errData && errData.error) {
            serverError = errData.error;
          }
        } catch (_) {}
        throw new Error(serverError);
      }
      const data = await res.json();
      if (data.stateNumber) setCoupleStateNumber(data.stateNumber);
      if (data.model) setCoupleModel(data.model);
      if (data.vehicleType) setCoupleVehicleType(data.vehicleType);
      if (data.dimensions) setCoupleDimensions(data.dimensions);
      if (data.weight) setCoupleWeight(data.weight);
      if (data.driver1) setCoupleDriver1(data.driver1);
      if (data.driver2) setCoupleDriver2(data.driver2);
      
      setCoupleRawText("");
      setCoupleImageBase64(null);
    } catch (e: unknown) {
      alert("Ошибка при распознавании: " + (e?.message || ""));
      console.error(e);
    } finally {
      setIsParsingCouple(false);
    }
  };
  // Create or Update a Couple (1-block tractor-trailer couple) inside database
  const handleSaveCouple = () => {
    if (!coupleStateNumber.trim() || !coupleModel.trim()) {
      alert("Заполните Госномер и Модель!");
      return;
    }
    const coupleData = {
      stateNumber: coupleStateNumber.trim(),
      model: coupleModel.trim(),
      modelRu: coupleModelRu.trim(),
      vehicleType: coupleVehicleType.trim(),
      dimensions: coupleDimensions.trim(),
      weight: coupleWeight.trim(),
      driver1: coupleDriver1.trim(),
      driver2: coupleDriver2.trim(),
      dispatcher: coupleDispatcher.trim()
    };
    const id = editCoupleId || 'couple_' + Date.now();
    set(ref(database, `ferryCouples/${id}`), coupleData)
      .then(() => {
        dbService.logAction(user.name, user.role, "Документы паром", "Documents", id, editCoupleId ? `Обновил сцепку ${coupleStateNumber}` : `Добавил новую сцепку ${coupleStateNumber}`);
        setSelectedCoupleId(id);
        setShowCoupleEditor(false);
        setEditCoupleId(null);
        // Reset editor form
        setCoupleStateNumber('');
        setCoupleModel('');
        setCoupleModelRu('');
        setCoupleVehicleType('Тенты 90м3');
        setCoupleDimensions('13,6м х 2,45м х 2,7м');
        setCoupleWeight('1) 14,6т');
        setCoupleDriver1('');
        setCoupleDriver2('');
        setCoupleDispatcher('');
      })
      .catch(err => {
        console.error("Save couple failed", err);
        alert("Ошибка при сохранении автомобиля в БД.");
      });
  };
  const handleDeleteCouple = async (id: string) => {
    alert("Delete called for: " + id);
    if (!canWrite) {
      alert("У вас нет прав на удаление записей.");
      return;
    }
    if (ferryCouples.length <= 1) {
      alert("Нельзя удалить единственный автомобиль в базе.");
      return;
    }
    if (!(await showConfirm("Вы уверены, что хотите удалить этот автомобиль (сцепку) из базы?"))) return;
    
    
    remove(ref(database, `ferryCouples/${id}`))
      .then(() => {
        dbService.logAction(user.name, user.role, "Документы паром", "Documents", id, `Удалил сцепку`);
        if (selectedCoupleId === id) {
          const remaining = ferryCouples.filter(c => c.id !== id);
          if (remaining.length > 0) {
            setSelectedCoupleId(remaining[0].id);
          } else {
            setSelectedCoupleId('couple_preset_1');
          }
        }
      })
      .catch(err => {
        console.error("Delete couple failed for id:", id, "Error:", err);
        alert("Ошибка при удалении: " + err.message);
      });
  };
  const handleStartEditCouple = (coupleId?: string) => {
    const targetId = coupleId || selectedCoupleId;
    const couple = ferryCouples.find(c => c.id === targetId);
    if (!couple) return;
    setEditCoupleId(couple.id);
    setCoupleStateNumber(couple.stateNumber);
    setCoupleModel(couple.model);
    setCoupleModelRu(couple.modelRu || '');
    setCoupleVehicleType(couple.vehicleType);
    setCoupleDimensions(couple.dimensions);
    setCoupleWeight(couple.weight);
    setCoupleDriver1(couple.driver1);
    setCoupleDriver2(couple.driver2 || '');
    setCoupleDispatcher(couple.dispatcher || '');
    setShowCoupleEditor(true);
  };
  const handleStartAddCouple = () => {
    setEditCoupleId(null);
    setCoupleStateNumber('1) ');
    setCoupleModel('');
    setCoupleModelRu('');
    setCoupleVehicleType('Тенты 90м3');
    setCoupleDimensions('13,6м х 2,45м х 2,7м');
    setCoupleWeight('1) 14,6т');
    setCoupleDriver1('');
    setCoupleDriver2('');
    setCoupleDispatcher('');
    setShowCoupleEditor(true);
  };
  // Select a couple from the MAIN reference directory and autofill the ferry order
  const handleSelectBaseCouple = (rec: any) => {
    const coupling = rec.coupling || rec.vehicleNumbers || '';
    const model = rec.brands || rec.brandModel || rec.brandsRu || '';
    const modelRu = rec.brandsRu || '';
    const vehicleType = rec.vehicleType || '';
    const dimensions = rec.dimensions || '';
    const weight = rec.weight || '';
    const driver1 = [rec.driverNameRu, rec.driverNameLat, rec.passportNumber, rec.passportStart, rec.passportIssuedBy].filter(Boolean).join(' ');
    const driver2 = (rec as any).driver2 || '';
    const dispatcher = rec.dispatcher || rec.dispatcherName || '';
    const baseId = 'base_' + rec.id;

    // Sync into ferryCouples so the active preview card shows the same data
    const coupleData: FerryCouple = {
      id: baseId,
      stateNumber: coupling ? `1) ${coupling}` : '',
      model,
      modelRu,
      vehicleType,
      dimensions,
      weight,
      driver1,
      driver2,
      dispatcher
    };
    set(ref(database, `ferryCouples/${baseId}`), coupleData).catch(() => {});
    // Local update so the preview card shows the couple immediately (don't wait for onValue)
    setFerryCouples(prev => [...prev.filter(c => c.id !== baseId), coupleData]);

    // Directly autofill ferry order fields (used by the print layout)
    setFerryStateNumber(coupleData.stateNumber);
    setFerryVehicleModel(coupleData.model);
    setFerryVehicleModelRu(coupleData.modelRu);
    setFerryVehicleType(coupleData.vehicleType);
    setFerryDimensions(coupleData.dimensions);
    setFerryVehicleWeight(coupleData.weight);
    setFerryDriver1Details(coupleData.driver1);
    setFerryDriver2Details(coupleData.driver2 || '');

    setSelectedBaseId(rec.id);
    setSelectedCoupleId(baseId);
    setShowVehicleModal(false);
  };
  // 5. Print Ferry Order to exact physical paper layout
  const handlePrintFerryOrder = () => {
    const act = ferryCouples.find(c => c.id === selectedCoupleId);
    const selectedCarPlate = act ? act.stateNumber : '';
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    printWindow.document.write(`
      <html>
        <head>
          <title>Поручение экспедитору — Паром — ${selectedCarPlate || 'Печать'}</title>
          <style>
            @page {
              size: A4;
              margin: 8mm 12mm 8mm 12mm;
            }
            body {
              font-family: "Times New Roman", Times, serif;
              color: #000;
              background-color: #fff;
              margin: 0;
              padding: 0;
              font-size: 10px;
              line-height: 1.25;
            }
            .container {
              width: 100%;
              max-width: 100%;
            }
            .header-meta {
              text-align: right;
              font-size: 9px;
              line-height: 1.35;
              margin-bottom: 8px;
              font-weight: normal;
            }
            .form-title-table {
              width: 100%;
              border-collapse: collapse;
              border: 1px solid #000;
              margin-bottom: 8px;
            }
            .form-title-table td {
              text-align: center;
              font-weight: bold;
              font-size: 10.5px;
              padding: 3px;
              border: 1px solid #000;
              text-transform: uppercase;
            }
            .main-table {
              width: 100%;
              border-collapse: collapse;
              border: 1px solid #000;
              margin-bottom: 8px;
            }
            .main-table th {
              width: 33%;
              text-align: left;
              font-weight: bold;
              border: 1px solid #000;
              padding: 10.5px 8px;
              vertical-align: top;
              font-size: 9.5px;
              line-height: 1.15;
            }
            .main-table td {
              width: 67%;
              border: 1px solid #000;
              padding: 10.5px 8px;
              vertical-align: top;
              font-size: 10px;
              font-weight: bold;
              line-height: 1.15;
            }
            .yellow-bg {
              background-color: #ffff00 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header-meta">
              Приложение № 1/Appendix No. 1<br/>
              к договору транспортной экспедиции/to the freight forwarding agreement<br/>
              от/dd. «05» июля 2022г №0522
            </div>
            
            <table class="form-title-table">
              <tr>
                <td style="font-weight: normal;"><u><i>ФОРМА/ FORM</i></u></td>
              </tr>
              <tr>
                <td>ПОРУЧЕНИЕ ЭКСПЕДИТОРУ/ FORWARDER’S ORDER</td>
              </tr>
            </table>
            
            <table class="main-table">
              <tr>
                <th>
                  НАИМЕНОВАНИЕ<br/>ОРГАНИЗАЦИИ:<br/>
                  NAME OF<br/>ORGANIZATION:
                </th>
                <td>${ferryOrgName}</td>
              </tr>
              <tr>
                <th>
                  Дата<br/>предполагаемой<br/>погрузки на судно и<br/>порт погрузки/<br/>
                  Date of intended<br/>loading on vessel and<br/>port of loading:
                </th>
                <td>${ferryLoadingDatePort || ''}</td>
              </tr>
              <tr>
                <th>
                  ФИО и номер<br/>телефона<br/>контактного лица/<br/>
                  Name of contact<br/>person name and<br/>phone number:
                </th>
                <td>${ferryContactPerson}</td>
              </tr>
              <tr class="yellow-bg">
                <th class="yellow-bg" style="background-color: #ffff00 !important;">
                  Наименование<br/>организации –<br/>перевозчика<br/>(согласно CMR)<br/>
                  /Name of the<br/>organization – carrier<br/>(according to CMR):
                </th>
                <td class="yellow-bg" style="background-color: #ffff00 !important;">${ferryCarrierName}</td>
              </tr>
              <tr>
                <th>Тип ТС/Vehicle type:</th>
                <td>${ferryVehicleType}</td>
              </tr>
              <tr>
                <th>Модель/Model:</th>
                <td>${ferryVehicleModelRu || ferryVehicleModel}</td>
              </tr>
              <tr>
                <th>
                  Государственный<br/>номер/State Number:
                </th>
                <td>${ferryStateNumber}</td>
              </tr>
              <tr>
                <th>
                  Габариты (Длина х<br/>Ширина х<br/>Высота)/Dimensions<br/>
                  (Length х Width х<br/>Height):
                </th>
                <td>${ferryDimensions}</td>
              </tr>
              <tr>
                <th>
                  Вес ТС (Тягач +<br/>п/прицепом)/<br/>
                  Vehicle weight (tractor<br/>+ semi-trailer):
                </th>
                <td>${ferryVehicleWeight}</td>
              </tr>
              <tr>
                <th>
                  Водитель № 1 (ФИО,<br/>паспортные<br/>данные)/Driver<br/>
                  № 1 (full name,<br/>passport details):
                </th>
                <td>${ferryDriver1Details}</td>
              </tr>
              <tr>
                <th>
                  Водитель № 2 (ФИО,<br/>паспортные<br/>данные)/Driver<br/>
                  № 2 (full name,<br/>passport details):
                </th>
                <td>${ferryDriver2Details || ''}</td>
              </tr>
              <tr>
                <th>
                  Наименование груза,<br/>вес груза,<br/>количество<br/>упаковочных мест/<br/>
                  Name of cargo, weight<br/>of cargo, number of<br/>packing places:
                </th>
                <td>${ferryCargoDetails}</td>
              </tr>
              <tr>
                <th>
                  Необходимые услуги<br/>в соответствии с<br/>перечнем и<br/>тарифами,<br/>
                  <span class="yellow-bg" style="padding: 1px 2px; background-color: #ffff00 !important;">установленными<br/>Договором</span>/ Necessary
                </th>
                <td style="padding: 0;">
                  <table style="width: 100%; border-collapse: collapse; border: none; margin: 0; padding: 0; height: 100%;">
                    <tr>
                      <td rowspan="2" style="width: 22%; border-right: 1px solid #000; border-bottom: none; padding: 4px 6px; font-size: 8.5px; font-weight: normal; line-height: 1.15; vertical-align: top;">
                        Дополнительный<br/>водитель/<br/>Additional driver:
                      </td>
                      <td style="width: 11%; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 4px; font-size: 7.5px; font-weight: normal; text-align: center; line-height: 1.1; vertical-align: top;">
                        Да (Yes)/<br/>Нет (No)
                      </td>
                      <td rowspan="2" style="width: 22%; border-right: 1px solid #000; border-bottom: none; padding: 4px 6px; font-size: 8.5px; font-weight: normal; line-height: 1.15; vertical-align: top;">
                        Опасный груз/<br/>Dangerous<br/>goods:
                      </td>
                      <td style="width: 11%; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 2px 4px; font-size: 7.5px; font-weight: normal; text-align: center; line-height: 1.1; vertical-align: top;">
                        Да (Yes)/<br/>Нет (No)
                      </td>
                      <td rowspan="2" style="width: 22%; border-right: 1px solid #000; border-bottom: none; padding: 4px 6px; font-size: 8.5px; font-weight: normal; line-height: 1.15; vertical-align: top;">
                        Розетка на<br/>судне/ Socket on<br/>the ship:
                      </td>
                      <td style="width: 12%; border-bottom: 1px solid #000; padding: 2px 4px; font-size: 7.5px; font-weight: normal; text-align: center; line-height: 1.1; vertical-align: top;">
                        Да (Yes)/<br/>Нет (No)
                      </td>
                    </tr>
                    <tr>
                      <td style="border-right: 1px solid #000; padding: 4px 2px; font-size: 9.5px; font-weight: bold; text-align: center; vertical-align: middle;">
                        НЕТ
                      </td>
                      <td style="border-right: 1px solid #000; padding: 4px 2px; font-size: 9.5px; font-weight: bold; text-align: center; vertical-align: middle;">
                        НЕТ
                      </td>
                      <td style="padding: 4px 2px; font-size: 9.5px; font-weight: bold; text-align: center; vertical-align: middle;">
                        &nbsp;
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <div style="page-break-before: always; break-before: page;"></div>

            <table class="main-table" style="margin-top: 0;">
              <tr>
                <th>
                  services in accordance<br/>with the list and tariffs<br/>
                  <span class="yellow-bg" style="padding: 1px 2px; background-color: #ffff00 !important;">established by the<br/>Agreement</span>:
                </th>
                <td style="padding: 6px 8px; font-weight: bold; font-size: 11px; line-height: 1.35; vertical-align: middle;">
                  Количество <span class="yellow-bg" style="padding: 1px 2px; background-color: #ffff00 !important;">грузовых партий (CMR)</span> на одном TC/<br/>
                  Number of <span class="yellow-bg" style="padding: 1px 2px; background-color: #ffff00 !important;">consignments (CMR)</span> per vehicle: 1) <strong style="font-size: 12px;">${consignmentsNum}</strong><br/>
                  CMR
                </td>
              </tr>
              <tr>
                <th>
                  Итоговая стоимость<br/>с учетом<br/>вышеуказанной<br/>информации/<br/>
                  The total cost, taking<br/>into account the above<br/>information:
                </th>
                <td style="padding: 0;">
                  <table style="width: 100%; border-collapse: collapse; border: none; margin: 0; padding: 0;">
                    <tr>
                      <td style="width: 50%; border-right: 1px solid #000; padding: 6px; text-align: center; font-size: 12px; font-weight: bold; border-bottom: none;">
                        ${ferryTotalCost ? ferryTotalCost : ''}
                      </td>
                      <td style="width: 50%; padding: 6px; font-weight: bold; border-bottom: none; font-size: 11px;">Долларов США/ US dollars</td>
                    </tr>
                  </table>
                </td>
              </tr>
            <tr class="yellow-bg">
                <th class="yellow-bg" style="background-color: #ffff00 !important;">
                  Особые отметки:<br/>
                  /Particular notes:
                </th>
                <td style="padding: 0; background-color: #ffff00 !important;" class="yellow-bg">
                  <table style="width: 100%; border-collapse: collapse; border: none; margin: 0; background-color: #ffff00 !important;" class="yellow-bg">
                    <tbody>
                      <tr style="border-bottom: 1px solid #000;" class="yellow-bg">
                        <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 4px; font-size: 8.5px; background-color: #ffff00 !important;" class="yellow-bg">Х</td>
                        <td style="padding: 3px 4px; font-size: 8.5px; font-weight: bold; border-bottom: 1px solid #000; background-color: #ffff00 !important; line-height: 1.15;" class="yellow-bg">Произвести декларирование процедуры таможенного транзита/Make a declaration of the customs transit procedure</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #000;" class="yellow-bg">
                        <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 4px; font-size: 8.5px; background-color: #ffff00 !important;" class="yellow-bg">Х</td>
                        <td style="padding: 3px 4px; font-size: 8.5px; font-weight: bold; border-bottom: 1px solid #000; background-color: #ffff00 !important; line-height: 1.15;" class="yellow-bg">Предоставить услугу поручительства при таможенном транзите/ Provide a guarantee service for customs transit</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #000;" class="yellow-bg">
                        <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 4px; font-size: 8.5px; background-color: #ffff00 !important;" class="yellow-bg">Х</td>
                        <td style="padding: 3px 4px; font-size: 8.5px; font-weight: bold; border-bottom: 1px solid #000; background-color: #ffff00 !important; line-height: 1.15;" class="yellow-bg">Проконтролировать проставление таможней штампа санитарно-карантинного контроля в CMR/Control the affixing of the customs stamp of sanitary and quarantine control in the CMR</td>
                      </tr>
                      <tr style="border-bottom: 1px solid #000;" class="yellow-bg">
                        <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000; border-bottom: 1px solid #000; padding: 3px 4px; font-size: 8.5px; background-color: #ffff00 !important;" class="yellow-bg">&nbsp;</td>
                        <td style="padding: 3px 4px; font-size: 8.5px; font-weight: bold; border-bottom: 1px solid #000; background-color: #ffff00 !important; line-height: 1.15;" class="yellow-bg">Организовать помещение груза на временное хранение/Organize the placement of cargo for temporary storage</td>
                      </tr>
                      <tr class="yellow-bg">
                        <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000; padding: 3px 4px; font-size: 8.5px; background-color: #ffff00 !important;" class="yellow-bg">&nbsp;</td>
                        <td style="padding: 3px 4px; font-size: 8.5px; font-weight: bold; background-color: #ffff00 !important; line-height: 1.15;" class="yellow-bg">Иное/ Other:</td>
                      </tr>
                    </tbody>
                  </table>
                </td>
              </tr>
            </table>
            
            <div style="margin-top: 25px; width: 100%; font-size: 9.5px; line-height: 1.25; font-family: 'Times New Roman', Times, serif;">
              <div style="margin-bottom: 20px;">
                <strong>Должность, Ф.И.О., Подпись, Печать Экспедитора / Title, name and surname, Signature, Forwarder's seal</strong>
              </div>
              <div style="border-bottom: 1px solid #000; margin-top: 25px; margin-bottom: 25px; width: 100%;"></div>
              <div style="margin-top: 20px;">
                <strong>Должность, Ф.И.О., Подпись, Печать Клиента/ Title, name and surname, Signature, Client's seal</strong>
                <div style="margin-top: 40px; font-weight: bold; font-size: 10.5px; text-transform: uppercase;">${ferryClientSignee}</div>
              </div>
            </div>
          </div>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };
  const getTirParsedInfo = (rawText: string) => {
    return rawText
      .split(/[\s,;\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

















































  const handleSaveTirLastData = () => {
    const payload = {
      tirOutboxNum,
      tirOutboxDate,
      tirCarnetNumbers,
      tirSignee
    };
    set(ref(database, 'bamapTirLastData'), payload)
      .then(() => {
        setTirSavedSuccess(true);
        dbService.logAction(user.name, user.role, "Документы МДП", "Documents", "last_tir", `Сохранил параметры письма БАМАП № ${tirCarnetNumbers}`);
        setTimeout(() => setTirSavedSuccess(false), 2500);
      })
      .catch(err => {
        console.error("TIR save failed", err);
        alert("Ошибка при сохранении.");
      });
  };
  const handlePrintTirLetter = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const carnets = getTirParsedInfo(tirCarnetNumbers);
    printWindow.document.write(`
      <html>
        <head>
          <title>Письмо БАМАП по изъятию МДП — Исх. №${tirOutboxNum}</title>
          <style>
            body { font-family: "Times New Roman", Times, serif; padding: 40px; line-height: 1.5; color: #000; font-size: 14pt; }
            .header-table { width: 100%; border-collapse: collapse; margin-bottom: 50px; }
            .header-table td { vertical-align: top; }
            .letter-meta { width: 50%; font-size: 11pt; }
            .letter-recipient { width: 50%; text-align: right; font-weight: bold; font-size: 12pt; }
            .title { text-align: center; font-weight: bold; font-size: 16pt; margin-top: 40px; margin-bottom: 30px; text-transform: uppercase; }
            .content { text-align: justify; text-indent: 1.25cm; margin-bottom: 20px; }
            .signature-table { width: 100%; margin-top: 60px; }
            .signature-table td { vertical-align: bottom; }
            @media print {
              body { padding: 0; }
              @page { size: A4; margin: 20mm; }
            }
          </style>
        </head>
        <body>
          <table class="header-table">
            <tr>
              <td class="letter-meta">
                <strong>ООО «РАТИПА»</strong><br/>
                УНП 100492419<br/>
                Республика Беларусь, г. Минск<br/>
                ул. Таежная 39, к. 2<br/>
                Тел: +375 17 388-06-55<br/>
                <br/>
                Исх. №${tirOutboxNum} от ${tirOutboxDate}
              </td>
              <td class="letter-recipient">
                Директору Дирекции<br/>
                Ассоциации «БАМАП»<br/>
                г. Минск, пр-т Дзержинского, 57
              </td>
            </tr>
          </table>
          <div class="title">Уведомление об изъятии книжки МДП</div>
          <div class="content">
            Настоящим Общество с ограниченной ответственностью «РАТИПА» сообщает об изъятии (задержании) таможенными органами книжки (книжек) МДП:
          </div>
          <div style="margin-left: 1.25cm; margin-bottom: 30px; font-weight: bold; font-size: 15pt;">
            ${carnets.map(n => `<div>• TIR Carnet № ${n}</div>`).join('')}
          </div>
          <div class="content">
            Изъятие произведено таможенными органами по причине: ${tirLossCause === 'retained' ? 'Задержание / изъятие таможней на неопределенный срок' : tirLossCause === 'stolen' ? 'Кража / Хищение' : tirLossCause === 'destroyed' ? 'Уничтожение' : 'Утеря при форс-мажорных обстоятельствах'}. Место изъятия: ${tirLossDisappearancePlaceDate || 'таможня назначения в РФ'}.
          </div>
          <div class="content">
            В связи с вышеизложенным просим Вас внести соответствующие сведения в информационную систему БАМАП и Международного союза автомобильного транспорта (IRU), а также оказать содействие в урегулировании вопросов, связанных с прекращением действия данных книжек МДП.
          </div>
          <table class="signature-table">
            <tr>
              <td>
                <strong>Директор<br/>ООО «РАТИПА»</strong>
              </td>
              <td style="text-align: right; font-weight: bold; font-size: 15pt;">
                ${tirSignee}
              </td>
            </tr>
          </table>
          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };
















































































































































































































































  const [dragOverField, setDragOverField] = useState<string | null>(null);

  const uniqueDispatchers = Array.from(new Set(ferryCouples.map(c => c.dispatcher).filter(Boolean))) as string[];

  // Main reference directory filtered by search
  const filteredBaseCouples = mainBaseCouples.filter((rec: any) => {
    const q = baseSearchQuery.toLowerCase().trim();
    if (!q) return true;
    const coupling = (rec.coupling || rec.vehicleNumbers || '').toLowerCase();
    const driver = ((rec.driverNameRu || (rec as any).driverName || '') + ' ' + (rec.driverNameLat || '')).toLowerCase();
    const model = (rec.brandsRu || rec.brandModel || rec.brands || '').toLowerCase();
    return coupling.includes(q) || driver.includes(q) || model.includes(q);
  });

  const filteredCouples = ferryCouples.filter(c => {
    const query = vehicleSearchQuery.toLowerCase().trim();
    const matchesSearch = !query || 
      c.stateNumber.toLowerCase().includes(query) ||
      c.model.toLowerCase().includes(query) ||
      c.vehicleType.toLowerCase().includes(query) ||
      c.dimensions.toLowerCase().includes(query) ||
      c.weight.toLowerCase().includes(query) ||
      (c.driver1 && c.driver1.toLowerCase().includes(query)) ||
      (c.driver2 && c.driver2.toLowerCase().includes(query)) ||
      (c.dispatcher && c.dispatcher.toLowerCase().includes(query));

    let matchesDispatcher = true;
    if (dispatcherFilter !== 'all') {
      if (dispatcherFilter === 'none') {
        matchesDispatcher = !c.dispatcher;
      } else {
        matchesDispatcher = c.dispatcher === dispatcherFilter;
      }
    }

    return matchesSearch && matchesDispatcher;
  });

  return (
    <div className="space-y-6 font-sans">
      {/* MODULE HEADER */}
      <div className="bg-white rounded-[2rem] p-6 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col space-y-5">
        <div className="flex flex-col sm:flex-row items-start justify-between gap-4 select-none">
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
              Модуль документов
            </span>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <FileText className="w-7 h-7 text-slate-800" /> Центр документов
            </h1>
          </div>
        </div>
        <p className="text-[11px] text-slate-500 font-medium">
          Генерация, хранение и печать транспортных и сопроводительных документов
        </p>
      </div>
      {/* COMPONENT NAVIGATION TABS */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 overflow-x-auto max-w-full items-center">
          <button
            type="button"
            onClick={() => setActiveTab('ferry')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'ferry' 
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
            }`}
          >
            <Truck size={13} className="text-slate-400" />
            Поручение на паром
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('bamap_tir')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition-all ${
              activeTab === 'bamap_tir' 
                ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
                : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
            }`}
          >
            <BookOpen size={13} className="text-slate-400" />
            Письмо БАМАП (МДП)
          </button>
        </div>
      </div>
      {/* FERRY PORT ORDER GENERATOR */}
      {activeTab === 'ferry' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start font-sans">
          
          {/* FERRY FORM (LEFT - 5 COLS) */}
          <div className="xl:col-span-5 bg-white rounded-2xl p-5 border border-slate-200/60 shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col gap-4">
            
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
                <Truck size={15} className="text-slate-400" />
                Параметры поручения
              </h2>
              <span className="text-[10px] bg-slate-100 text-slate-500 px-2.5 py-0.5 rounded-lg font-medium">
                Паром
              </span>
            </div>
            {/* Tractor-Trailer Combinations Section (Отдельная база сцепка) */}
            <div className="flex flex-col gap-3 bg-slate-50 rounded-xl p-4 border border-slate-200/50">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-semibold tracking-tight text-slate-600 flex items-center gap-1">
                  🚛 Сцепка тягач-прицеп
                </label>
              </div>
              {/* Combo selection & Modal trigger */}
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setVehicleSearchQuery('');
                    setDispatcherFilter('all');
                    setShowVehicleModal(true);
                  }}
                  className="w-full bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-300 text-slate-900 text-xs px-3 py-2.5 rounded-xl flex items-center justify-between transition duration-150 cursor-pointer active:scale-[0.99]"
                >
                  <div className="flex items-center gap-2.5 text-left">
                    <span className="text-base">🚛</span>
                    <div>
                      <p className="text-[11px] text-slate-900 font-semibold leading-tight">
                        {ferryCouples.find(c => c.id === selectedCoupleId)?.stateNumber || "Выберите сцепку..."}
                      </p>
                      <p className="text-[10px] text-slate-400 font-medium leading-normal mt-0.5">
                        Модель: {ferryCouples.find(c => c.id === selectedCoupleId)?.model || "не указана"}
                        {ferryCouples.find(c => c.id === selectedCoupleId)?.dispatcher ? ` • Диспетчер: ${ferryCouples.find(c => c.id === selectedCoupleId)?.dispatcher}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 bg-slate-100 text-slate-600 px-2.5 py-1 rounded-lg text-[9px] font-semibold uppercase tracking-wider shrink-0 border border-slate-200/60">
                    Выбрать авто <Search size={10} />
                  </div>
                </button>
              </div>
              {/* COUPLE FORM / EDITOR */}
              {showCoupleEditor && (
                <div className="mt-2 bg-white border border-slate-200 rounded-xl p-3.5 flex flex-col gap-3">
                  <h3 className="text-[11px] font-semibold uppercase text-slate-500 tracking-wider">
                    {editCoupleId ? "📝 Редактировать сцепку" : "➕ Новая сцепка в базе"}
                  </h3>
                  
                  {/* AI Parser Block */}
                  <div className="bg-white p-3 rounded-xl border border-slate-200 flex flex-col gap-2">
                    <label className="text-[10px] font-semibold text-slate-600 flex items-center justify-between">
                      <span className="flex items-center gap-1 text-slate-500"><Wand2 size={11} /> ИИ Помощник (Парсер)</span>
                      <span className="text-[9px] text-slate-500 lowercase bg-slate-100 px-1.5 py-0.5 rounded-md font-medium">Без VPN</span>
                    </label>
                    
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleImageUpload(file);
                      }}
                      className="flex flex-col gap-2"
                    >
                      <div className="flex gap-2">
                        <textarea
                          value={coupleRawText}
                          onChange={e => setCoupleRawText(e.target.value)}
                          onPaste={handleCouplePaste}
                          placeholder="Вставьте текст или Ctrl+V скриншот..."
                          className="w-full bg-slate-50 border border-slate-200 text-xs p-2 rounded-xl outline-none focus:border-slate-400 focus:bg-white focus:ring-1 focus:ring-slate-400 resize-none h-11 transition"
                        />
                        <button
                          onClick={handleParseCouple}
                          disabled={isParsingCouple || (!coupleRawText.trim() && !coupleImageBase64)}
                          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-3.5 rounded-xl text-xs font-semibold transition shrink-0 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {isParsingCouple ? (
                            <span className="">Обработка...</span>
                          ) : (
                            "Разобрать"
                          )}
                        </button>
                      </div>
                      {/* File upload row */}
                      <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
                        <label className="flex items-center gap-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-2.5 py-1 rounded-lg cursor-pointer transition select-none text-[10px] font-medium">
                          <span>📁 Загрузить картинку</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload(file);
                            }} 
                          />
                        </label>
                        <span>Или перетащите файл / вставьте из буфера</span>
                      </div>
                      {/* Image Preview Thumbnail */}
                      {coupleImageBase64 && (
                        <div className="mt-1 flex items-center gap-2 p-1.5 bg-white border border-blue-100 rounded-lg">
                          <img 
                            src={coupleImageBase64} 
                            alt="Screenshot Preview" 
                            className="w-10 h-10 object-cover rounded border border-slate-200"
                            referrerPolicy="no-referrer"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[10px] font-bold text-slate-700 truncate font-sans">Скриншот прикреплен</p>
                            <p className="text-[8px] text-slate-400 font-sans">Готово к распознаванию</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCoupleImageBase64(null)}
                            className="text-[10px] font-bold text-rose-600 hover:underline px-2 py-1 bg-rose-50 rounded-lg cursor-pointer"
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">Госномер сцепки (Тягач+Прицеп)</label>
                    <input
                      type="text"
                      placeholder="1) AX1587-7/А1063Е-7"
                      value={coupleStateNumber}
                      onChange={e => setCoupleStateNumber(e.target.value)}
                      className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Модель автомобиля</label>
                      <input
                        type="text"
                        placeholder="МЕРСЕДЕС-БЕНЦ"
                        value={coupleModel}
                        onChange={e => setCoupleModel(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Марка/модель (рус.) — для документов</label>
                      <input
                        type="text"
                        placeholder="Мерседес Бенц"
                        value={coupleModelRu}
                        onChange={e => setCoupleModelRu(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Тип ТС</label>
                      <input
                        type="text"
                        placeholder="Тенты 90м3"
                        value={coupleVehicleType}
                        onChange={e => setCoupleVehicleType(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Габариты полуприцепа</label>
                      <input
                        type="text"
                        placeholder="13,6м х 2,45м х 2,7м"
                        value={coupleDimensions}
                        onChange={e => setCoupleDimensions(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Вес ТС (Тягач+пп)</label>
                      <input
                        type="text"
                        placeholder="1) 14,6т"
                        value={coupleWeight}
                        onChange={e => setCoupleWeight(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">Водитель № 1 (ФИО, паспортные данные)</label>
                    <textarea
                      rows={2}
                      placeholder="ФИО, серия и номер, дата выдачи, орган выдачи"
                      value={coupleDriver1}
                      onChange={e => setCoupleDriver1(e.target.value)}
                      className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">Водитель № 2 (если есть)</label>
                    <textarea
                      rows={1}
                      placeholder="Второй водитель..."
                      value={coupleDriver2}
                      onChange={e => setCoupleDriver2(e.target.value)}
                      className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all resize-none"
                    />
                  </div>
                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">Диспетчер (для фильтрации)</label>
                    <input
                      type="text"
                      placeholder="Например: Сергей Т., Мария К., Елена В."
                      value={coupleDispatcher}
                      onChange={e => setCoupleDispatcher(e.target.value)}
                      list="dispatcher-presets-dl"
                      className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3.5 py-2 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                    />
                    <datalist id="dispatcher-presets-dl">
                      {ferryDispatchers.map(d => <option key={d} value={d} />)}
                    </datalist>
                  </div>
                  <div className="flex gap-2.5 justify-end pt-1.5">
                    <button
                      onClick={() => setShowCoupleEditor(false)}
                      className="px-4 py-2 bg-slate-100/80 border border-slate-200 text-slate-700 text-[11px] font-medium rounded-xl cursor-pointer transition hover:bg-slate-200/60"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={handleSaveCouple}
                      className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-semibold rounded-xl cursor-pointer transition shadow-sm border border-slate-800"
                    >
                      Сохранить в базу
                    </button>
                  </div>
                </div>
              )}
              {/* COUPLE ACTIVE PREVIEW CARD (Связано в 1 блок) */}
              {!showCoupleEditor && ferryCouples.find(c => c.id === selectedCoupleId) && (() => {
                const act = ferryCouples.find(c => c.id === selectedCoupleId)!;
                return (
                  <div className="mt-1 bg-white border border-slate-200 rounded-xl p-3.5 text-[11px] text-slate-700 flex flex-col gap-1 w-full">
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-2 text-center border-b border-slate-100 pb-1.5">
                      Данные сцепки (Объединённый блок)
                    </p>
                    <div className="grid grid-cols-5 gap-1.5 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[11px] font-medium">Тягач & ПП:</span>
                      <span className="col-span-3 text-slate-900 font-semibold">{act.stateNumber}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[11px] font-medium">Модель тягача:</span>
                      <span className="col-span-3 text-slate-900 font-semibold">{act.model}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[11px] font-medium">Тип & Габариты:</span>
                      <span className="col-span-3 text-slate-900 font-semibold">{act.vehicleType} | {act.dimensions}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[11px] font-medium">Вес ТС (Тягач+пп):</span>
                      <span className="col-span-3 text-slate-900 font-semibold">{act.weight}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1.5 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[11px] font-medium">Водитель № 1:</span>
                      <span className="col-span-3 text-slate-800 font-medium line-clamp-1" title={act.driver1}>{act.driver1 || "—"}</span>
                    </div>
                    {act.driver2 && (
                      <div className="grid grid-cols-5 gap-1.5 py-0.5">
                        <span className="col-span-2 text-slate-400 text-[11px] font-medium">Водитель № 2:</span>
                        <span className="col-span-3 text-slate-800 font-medium line-clamp-1" title={act.driver2}>{act.driver2}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="flex flex-col gap-3.5 max-h-[500px] overflow-y-auto pr-1.5 custom-scrollbar">
              
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Номер приложения / Договор</label>
                <input 
                  type="text" 
                  value={ferryOrgName}
                  onChange={e => setFerryOrgName(e.target.value)}
                  className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-900 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">Дата & Порт погрузки</label>
                  <input 
                    type="text" 
                    placeholder="05.04.2026 Карасу"
                    value={ferryLoadingDatePort}
                    onChange={e => setFerryLoadingDatePort(e.target.value)}
                    className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-900 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-slate-600 block mb-1">👤 Контактное лицо экспедитора</label>
                  <input 
                    type="text" 
                    placeholder="Выберите из списка или введите нового..."
                    value={ferryContactPerson}
                    onChange={e => setFerryContactPerson(e.target.value)}
                    list="ferry-contacts-dl"
                    className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-900 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all"
                  />
                  <datalist id="ferry-contacts-dl">
                    {ferryContactsList.map((contact, idx) => (
                      <option key={idx} value={contact} />
                    ))}
                  </datalist>
                </div>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">🔒 Организация - перевозчик (согласно CMR)</label>
                <div className="w-full bg-slate-50 border border-slate-200/50 text-slate-500 text-xs font-medium px-3.5 py-2.5 rounded-xl select-none">
                  Общество с ограниченной ответственностью «РАТИПА»
                </div>
                <p className="text-[10px] text-slate-400 italic mt-1">Данное значение установлено по умолчанию и не редактируется</p>
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">Наименование груза, вес, упаковка</label>
                <textarea 
                  rows={2}
                  value={ferryCargoDetails}
                  onChange={e => setFerryCargoDetails(e.target.value)}
                  className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-900 text-xs font-medium px-3.5 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 transition-all resize-none"
                />
              </div>
              <div>
                <label className="text-[11px] font-medium text-slate-600 block mb-1">
                  Количество партий (CMR) — редактируется только число
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-medium text-xs whitespace-nowrap">1)</span>
                  <input 
                    type="number" 
                    min="1"
                    max="100"
                    placeholder="5"
                    value={consignmentsNum}
                    onChange={e => setConsignmentsNum(e.target.value)}
                    className="w-20 bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-slate-900 text-xs font-semibold px-3 py-1.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-center transition-all"
                  />
                  <span className="text-slate-500 font-medium text-xs">CMR</span>
                  <span className="text-[11px] text-slate-400 italic ml-2">Результат: {ferryConsignmentsCount}</span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3.5">
                <div className="text-[11px] text-slate-400 font-medium">
                  <span className="block uppercase text-[9px] tracking-wider text-slate-400 font-semibold">Стоимость (USD)</span>
                  Без изменений (Blank) 🔒
                </div>
                <div className="text-[11px] text-slate-400 font-medium">
                  <span className="block uppercase text-[9px] tracking-wider text-slate-400 font-semibold">Руководитель со стороны Клиента</span>
                  Директор Бориско В.В. 🔒
                </div>
              </div>
            </div>
            {/* Save parameters node action */}
            <div className="pt-4 border-t border-slate-200/80 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleSaveFerryDataForCar}
                className="flex-1 bg-slate-100/80 border border-slate-200 hover:bg-slate-200/60 text-slate-700 text-xs font-medium py-3 rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 cursor-pointer"
              >
                {ferrySavedSuccess ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600" />
                    Параметры сохранены!
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-4 w-4 text-slate-500" />
                    Сохранить параметры
                  </>
                )}
              </button>
              <button
                onClick={handlePrintFerryOrder}
                className="flex-1 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold py-3 rounded-xl flex items-center justify-center gap-1.5 transition active:scale-95 border border-slate-800 shadow-sm cursor-pointer"
              >
                <Printer className="h-4 w-4" />
                Распечатать поручение
              </button>
            </div>
          </div>
          {/* DRAFT PRINT PREVIEW PAPER CONTAINER (RIGHT - 7 COLS) */}
          <div className="xl:col-span-7 bg-white border border-slate-200/60 rounded-2xl p-6 max-h-[850px] overflow-y-auto shadow-[0_4px_20px_rgba(0,0,0,0.01)] flex flex-col items-center gap-6">
            
            {/* PAPER BLOCK - PAGE 1 */}
            <div className="print-preview-paper bg-white rounded border border-slate-200 p-8 shadow-[0_15px_40px_rgba(0,0,0,0.06)] w-full max-w-[650px] aspect-[1/1.414] text-[10px] text-black font-serif leading-tight">
              
              <div className="text-right text-[10px] font-serif leading-snug mb-4">
                Приложение № 1/Appendix No. 1<br/>
                к договору транспортной экспедиции/to the freight forwarding agreement<br/>
                от/dd. «05» июля 2022г №0522
              </div>
              
              <table className="w-full border-collapse border border-black mb-3 text-[11px] font-serif">
                <tbody>
                  <tr className="border-b border-black">
                    <td className="text-center p-1 uppercase"><u><i>ФОРМА/ FORM</i></u></td>
                  </tr>
                  <tr>
                    <td className="text-center font-bold p-1 uppercase">ПОРУЧЕНИЕ ЭКСПЕДИТОРУ/ FORWARDER’S ORDER</td>
                  </tr>
                </tbody>
              </table>
              {/* STYLED 1-to-1 LAYOUT GRID */}
              <table className="w-full border-collapse border border-black text-[10.5px] main-table-preview">
                <tbody>
                  <tr className="border-b border-black">
                    <td className="w-[33%] p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      НАИМЕНОВАНИЕ<br/>ОРГАНИЗАЦИИ:<br/>
                      NAME OF<br/>ORGANIZATION:
                    </td>
                    <td className="p-2 font-bold text-black align-top">{ferryOrgName || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      Дата<br/>предполагаемой<br/>погрузки на судно и<br/>порт погрузки/<br/>
                      Date of intended<br/>loading on vessel and<br/>port of loading:
                    </td>
                    <td className="p-2 font-bold text-black align-top">{ferryLoadingDatePort || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      ФИО и номер<br/>телефона<br/>контактного лица/<br/>
                      Name of contact<br/>person name and<br/>phone number:
                    </td>
                    <td className="p-2 font-bold text-black align-top">{ferryContactPerson || ''}</td>
                  </tr>
                  <tr className="border-b border-black bg-yellow-300">
                    <td className="p-2 border-r border-black font-bold align-top select-none bg-yellow-300 uppercase tracking-tight leading-snug style-title">
                      Наименование<br/>организации –<br/>перевозчика<br/>(согласно CMR)<br/>
                      /Name of the<br/>organization – carrier<br/>(according to CMR):
                    </td>
                    <td className="p-2 font-bold text-black align-top bg-yellow-300">{ferryCarrierName || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">Тип ТС/Vehicle type:</td>
                    <td className="p-2 font-bold text-black align-top">{ferryVehicleType || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">Модель/Model:</td>
                    <td className="p-2 font-bold text-black align-top">{ferryVehicleModelRu || ferryVehicleModel || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Государственный<br/>номер/State Number:
                    </td>
                    <td className="p-2 font-bold text-black select-all align-top">{ferryStateNumber || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      Габариты (Длина х<br/>Ширина х<br/>Высота)/Dimensions<br/>
                      (Length х Width х<br/>Height):
                    </td>
                    <td className="p-2 font-bold text-black align-top">{ferryDimensions || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Вес ТС (Тягач +<br/>п/прицепом)/<br/>
                      Vehicle weight (tractor<br/>+ semi-trailer):
                    </td>
                    <td className="p-2 font-bold text-black align-top">{ferryVehicleWeight || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Водитель № 1 (ФИО,<br/>паспортные<br/>данные)/Driver<br/>
                      № 1 (full name,<br/>passport details):
                    </td>
                    <td className="p-2 font-bold text-black align-top select-all">{ferryDriver1Details || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Водитель № 2 (ФИО,<br/>паспортные<br/>данные)/Driver<br/>
                      № 2 (full name,<br/>passport details):
                    </td>
                    <td className="p-2 font-bold text-black align-top">{ferryDriver2Details || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Наименование груза,<br/>вес груза,<br/>количество<br/>упаковочных мест/<br/>
                      Name of cargo, weight<br/>of cargo, number of<br/>packing places:
                    </td>
                    <td className="p-2 font-bold text-black align-top">{ferryCargoDetails || ''}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title leading-normal">
                      Необходимые услуги<br/>в соответствии с<br/>перечнем и<br/>тарифами,<br/>
                      <span className="bg-yellow-300 font-bold px-1 rounded-sm">установленными<br/>Договором</span>/ Necessary
                    </td>
                    <td className="p-0 align-top">
                      <table className="w-full border-collapse border-0 h-full">
                        <tbody>
                          <tr>
                            <td rowSpan={2} className="w-[22%] p-1.5 border-r border-black font-serif text-[9px] font-normal leading-snug align-top">
                              Дополнительный<br/>водитель/<br/>Additional driver:
                            </td>
                            <td className="w-[11%] p-1 border-r border-b border-black text-center text-[7.5px] font-normal leading-tight align-top">
                              Да (Yes)/<br/>Нет (No)
                            </td>
                            <td rowSpan={2} className="w-[22%] p-1.5 border-r border-black font-serif text-[9px] font-normal leading-snug align-top">
                              Опасный груз/<br/>Dangerous<br/>goods:
                            </td>
                            <td className="w-[11%] p-1 border-r border-b border-black text-center text-[7.5px] font-normal leading-tight align-top">
                              Да (Yes)/<br/>Нет (No)
                            </td>
                            <td rowSpan={2} className="w-[22%] p-1.5 border-r border-black font-serif text-[9px] font-normal leading-snug align-top">
                              Розетка на<br/>судне/ Socket on<br/>the ship:
                            </td>
                            <td className="w-[12%] p-1 border-b border-black text-center text-[7.5px] font-normal leading-tight align-top">
                              Да (Yes)/<br/>Нет (No)
                            </td>
                          </tr>
                          <tr>
                            <td className="p-1 border-r border-black text-center font-bold text-black text-[10.5px] align-middle">
                              НЕТ
                            </td>
                            <td className="p-1 border-r border-black text-center font-bold text-black text-[10.5px] align-middle">
                              НЕТ
                            </td>
                            <td className="p-1 text-center font-bold text-black text-[10.5px] align-middle">
                              &nbsp;
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* PAPER BLOCK - PAGE 2 */}
            <div className="print-preview-paper bg-white rounded border border-slate-200 p-8 shadow-[0_15px_40px_rgba(0,0,0,0.06)] w-full max-w-[650px] aspect-[1/1.414] text-[10px] text-black font-serif leading-tight">
              <table className="w-full border-collapse border border-black text-[10.5px] main-table-preview">
                <tbody>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title leading-normal">
                      services in accordance<br/>with the list and tariffs<br/>
                      <span className="bg-yellow-300 font-bold px-1 rounded-sm">established by the<br/>Agreement</span>:
                    </td>
                    <td className="p-2 font-bold font-serif text-[11px] leading-relaxed align-middle">
                      Количество <span className="bg-yellow-300 font-bold px-1 rounded-sm">грузовых партий (CMR)</span> на одном ТС/<br/>
                      Number of <span className="bg-yellow-300 font-bold px-1 rounded-sm">consignments (CMR)</span> per vehicle: 1) <strong className="text-[12px]">{consignmentsNum}</strong><br/>
                      CMR
                    </td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Итоговая стоимость<br/>с учетом<br/>вышеуказанной<br/>информации/<br/>
                      The total cost, taking<br/>into account the above<br/>information:
                    </td>
                    <td className="p-0 align-top">
                      <table className="w-full border-collapse text-[10px] border-0">
                        <tbody>
                          <tr>
                            <td className="w-[50%] p-2 border-r border-black text-center font-bold text-[12px] align-middle">
                              {ferryTotalCost || ''}
                            </td>
                            <td className="w-[50%] p-2 font-bold align-middle">Долларов США/ US dollars</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr className="bg-yellow-300">
                    <td className="p-2 border-r border-black font-bold align-top select-none bg-yellow-300 style-title">
                      Особые отметки:<br/>/Particular notes:
                    </td>
                    <td className="p-0 text-[9.5px] leading-relaxed font-serif bg-yellow-300 align-top">
                      <table className="w-full border-collapse border-0 text-[10px]">
                        <tbody>
                          <tr className="border-b border-black">
                            <td className="w-[8%] p-1.5 text-center font-bold border-r border-black bg-yellow-300">Х</td>
                            <td className="p-1.5 bg-yellow-300 font-bold">Произвести декларирование процедуры таможенного транзита/Make a declaration of the customs transit procedure</td>
                          </tr>
                          <tr className="border-b border-black">
                            <td className="w-[8%] p-1.5 text-center font-bold border-r border-black bg-yellow-300">Х</td>
                            <td className="p-1.5 bg-yellow-300 font-bold">Предоставить услугу поручительства при таможенном транзите/ Provide a guarantee service for customs transit</td>
                          </tr>
                          <tr className="border-b border-black">
                            <td className="w-[8%] p-1.5 text-center font-bold border-r border-black bg-yellow-300">Х</td>
                            <td className="p-1.5 bg-yellow-300 font-bold">Проконтролировать проставление таможней штампа санитарно-карантинного контроля в CMR/Control the affixing of the customs stamp of sanitary and quarantine control in the CMR</td>
                          </tr>
                          <tr className="border-b border-black">
                            <td className="w-[8%] p-1.5 text-center font-bold border-r border-black bg-yellow-300">&nbsp;</td>
                            <td className="p-1.5 bg-yellow-300 font-bold">Организовать помещение груза на временное хранение/Organize the placement of cargo for temporary storage</td>
                          </tr>
                          <tr>
                            <td className="w-[8%] p-1.5 text-center font-bold border-r border-black bg-yellow-300">&nbsp;</td>
                            <td className="p-1.5 bg-yellow-300 font-bold">Иное/ Other:</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-8 text-[11px] leading-normal font-serif">
                <div className="mb-6">
                  <strong>Должность, Ф.И.О., Подпись, Печать Экспедитора / Title, name and surname, Signature, Forwarder's seal</strong>
                </div>
                <div className="border-b border-black my-6 w-full h-[1px]"></div>
                <div>
                  <strong>Должность, Ф.И.О., Подпись, Печать Клиента/ Title, name and surname, Signature, Client's seal</strong>
                  <div className="mt-8 font-bold text-[11.5px] uppercase tracking-tight">{ferryClientSignee}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* BAMAP TIR TAB */}
      {activeTab === 'bamap_tir' && (
        <div className="w-full">
          <LossDeclarationEditor />
        </div>
      )}

      {/* VEHICLE DATABASE MODAL (Менеджер сцепок) */}
      {showVehicleModal && (
        <div className="fixed inset-0 bg-slate-900/30 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col shadow-2xl border border-slate-200/80 overflow-hidden">
            {/* Header */}
            <div className="bg-slate-50 border-b border-slate-200/40 px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-2xl">🚛</span>
                <div>
                  <h3 className="text-sm font-semibold tracking-tight text-slate-900">База авто (сцепок)</h3>
                  <p className="text-[11px] text-slate-500">Просмотр, редактирование, поиск и разделение по диспетчерам</p>
                </div>
              </div>
              <button 
                onClick={() => {
                  setShowVehicleModal(false);
                  setShowCoupleEditor(false);
                }}
                className="text-slate-400 hover:text-slate-600 transition p-1 bg-slate-100 hover:bg-slate-200 rounded-xl cursor-pointer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-5 bg-slate-50">
              
              {showCoupleEditor ? (
                /* RENDER THE EDITOR DIRECTLY INSIDE THE MODAL */
                <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                    <h4 className="text-xs font-semibold tracking-tight text-slate-900 flex items-center gap-1.5">
                      {editCoupleId ? "📝 Редактирование сцепки" : "➕ Создание новой сцепки"}
                    </h4>
                    <button
                      type="button"
                      onClick={() => setShowCoupleEditor(false)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
                    >
                      ← Назад к списку
                    </button>
                  </div>

                  {/* AI Parser Row */}
                  <div className="bg-white p-4 rounded-xl border border-slate-200 border-l-4 border-l-slate-400 flex flex-col gap-2">
                    <label className="text-[10px] font-semibold text-slate-600 flex items-center justify-between">
                      <span className="flex items-center gap-1"><Wand2 size={12} /> ИИ ПОМОЩНИК (ПАРСЕР)</span>
                      <span className="text-[9px] text-slate-500 lowercase bg-slate-100 px-1.5 py-0.5 rounded font-medium">Без VPN</span>
                    </label>
                    <div 
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        const file = e.dataTransfer.files?.[0];
                        if (file) handleImageUpload(file);
                      }}
                      className="flex flex-col gap-2"
                    >
                      <div className="flex gap-2">
                        <textarea
                          value={coupleRawText}
                          onChange={e => setCoupleRawText(e.target.value)}
                          onPaste={handleCouplePaste}
                          placeholder="Вставьте скопированный текст авто/водителя или нажмите Ctrl+V для вставки скриншота..."
                          className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium p-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 resize-none h-16 transition"
                        />
                        <button
                          onClick={handleParseCouple}
                          disabled={isParsingCouple || (!coupleRawText.trim() && !coupleImageBase64)}
                          className="bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white px-5 rounded-xl text-xs font-semibold transition shrink-0 flex items-center justify-center gap-1 cursor-pointer"
                        >
                          {isParsingCouple ? (
                            <span className="">Обработка...</span>
                          ) : (
                            "Разобрать"
                          )}
                        </button>
                      </div>
                      {/* File upload row */}
                      <div className="flex items-center justify-between gap-2 text-[9px] text-slate-500">
                        <label className="flex items-center gap-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 px-2 py-1 rounded-md cursor-pointer transition select-none">
                          <span>📁 Загрузить картинку</span>
                          <input 
                            type="file" 
                            accept="image/*" 
                            className="hidden" 
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) handleImageUpload(file);
                            }} 
                          />
                        </label>
                        <span>Или перетащите файл / вставьте из буфера</span>
                      </div>
                      {coupleImageBase64 && (
                        <div className="mt-1 flex items-center gap-2 p-1.5 bg-white border border-blue-100 rounded-lg">
                          <img 
                            src={coupleImageBase64} 
                            alt="Screenshot Preview" 
                            className="w-10 h-10 object-cover rounded border border-slate-200"
                            referrerPolicy="no-referrer"
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-[9px] font-black text-slate-700 truncate">Изображение прикреплено</p>
                            <p className="text-[8px] text-slate-400 font-mono">Готово к распознаванию</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCoupleImageBase64(null)}
                            className="text-[9px] font-black text-rose-600 hover:underline px-1.5 py-1 bg-rose-50 rounded cursor-pointer"
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Form fields */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Госномер сцепки (Тягач+Прицеп)</label>
                      <input
                        type="text"
                        placeholder="AX1587-7/А1063Е-7"
                        value={coupleStateNumber}
                        onChange={e => setCoupleStateNumber(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-semibold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Модель автомобиля</label>
                      <input
                        type="text"
                        placeholder="МЕРСЕДЕС-БЕНЦ"
                        value={coupleModel}
                        onChange={e => setCoupleModel(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-semibold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 transition-all"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Тип ТС</label>
                      <input
                        type="text"
                        placeholder="Тенты 90м3"
                        value={coupleVehicleType}
                        onChange={e => setCoupleVehicleType(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-semibold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Габариты полуприцепа</label>
                      <input
                        type="text"
                        placeholder="13,6м х 2,45м х 2,7м"
                        value={coupleDimensions}
                        onChange={e => setCoupleDimensions(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-semibold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Вес ТС (Тягач+пп)</label>
                      <input
                        type="text"
                        placeholder="14,6т"
                        value={coupleWeight}
                        onChange={e => setCoupleWeight(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-semibold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 transition-all"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[11px] font-medium text-slate-600 block mb-1">Водитель № 1 (ФИО, паспортные данные)</label>
                    <textarea
                      rows={2}
                      placeholder="ФИО, серия и номер, дата выдачи, орган выдачи"
                      value={coupleDriver1}
                      onChange={e => setCoupleDriver1(e.target.value)}
                      className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 resize-none transition-all"
                    />
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Водитель № 2 (если есть)</label>
                      <textarea
                        rows={1}
                        placeholder="Второй водитель..."
                        value={coupleDriver2}
                        onChange={e => setCoupleDriver2(e.target.value)}
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-medium px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 resize-none h-[42px] transition-all"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] font-medium text-slate-600 block mb-1">Диспетчер (для разделения/фильтрации)</label>
                      <input
                        type="text"
                        placeholder="Например: Сергей Т., Мария К."
                        value={coupleDispatcher}
                        onChange={e => setCoupleDispatcher(e.target.value)}
                        list="modal-dispatcher-presets"
                        className="w-full bg-slate-50 hover:bg-slate-50/50 border border-slate-200 text-xs font-semibold px-3 py-2.5 rounded-xl outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 transition-all"
                      />
                      <datalist id="modal-dispatcher-presets">
                        {ferryDispatchers.map(d => <option key={d} value={d} />)}
                      </datalist>
                    </div>
                  </div>

                  <div className="flex gap-2.5 justify-end pt-3 border-t border-slate-100">
                    <button
                      onClick={() => setShowCoupleEditor(false)}
                      className="px-4 py-2 bg-slate-100/80 border border-slate-200 text-slate-700 text-xs font-medium rounded-xl transition cursor-pointer hover:bg-slate-200/60"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={handleSaveCouple}
                      className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition shadow-sm border border-slate-800 cursor-pointer"
                    >
                      Сохранить в базу
                    </button>
                  </div>
                </div>
              ) : (
                /* MAIN LIST VIEW */
                <>
                  {/* Search and Add Topbar */}
                  <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between bg-white p-4 rounded-2xl border border-slate-200/60 shadow-[0_4px_20px_rgba(0,0,0,0.01)]">
                    {/* Search Field */}
                    <div className="relative flex-1">
                      <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Быстрый поиск по госномеру, модели, водителю, диспетчеру..."
                        value={vehicleSearchQuery}
                        onChange={(e) => setVehicleSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2.5 bg-slate-50 hover:bg-slate-50/50 border border-slate-200 rounded-xl text-xs font-medium outline-none focus:bg-white focus:border-slate-400 focus:ring-1 focus:ring-slate-400 text-slate-900 transition-all"
                      />
                    </div>
                    {/* Add Button */}
                    <button
                      onClick={handleStartAddCouple}
                      className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold px-4 py-3 rounded-xl flex items-center justify-center gap-1.5 transition shrink-0 active:scale-95 shadow-sm border border-slate-800 cursor-pointer"
                    >
                      <Plus size={14} /> Добавить сцепку
                    </button>
                  </div>

                  {/* Dispatcher Separation Tabs */}
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200/50 pb-2">
                    <button
                      onClick={() => setDispatcherFilter('all')}
                      className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                        dispatcherFilter === 'all'
                          ? 'bg-slate-900 text-white'
                          : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/60'
                      }`}
                    >
                      Все диспетчеры ({ferryCouples.length})
                    </button>
                    
                    {/* Unique dispatchers */}
                    {uniqueDispatchers.map(disp => (
                      <button
                        key={disp}
                        onClick={() => setDispatcherFilter(disp)}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                          dispatcherFilter === disp
                            ? 'bg-slate-900 text-white'
                            : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/60'
                        }`}
                      >
                        👤 {disp} ({ferryCouples.filter(c => c.dispatcher === disp).length})
                      </button>
                    ))}

                    {/* Without dispatcher */}
                    {ferryCouples.some(c => !c.dispatcher) && (
                      <button
                        onClick={() => setDispatcherFilter('none')}
                        className={`px-3.5 py-1.5 rounded-xl text-xs font-medium transition cursor-pointer ${
                          dispatcherFilter === 'none'
                            ? 'bg-slate-900 text-white'
                            : 'bg-white hover:bg-slate-50 text-slate-600 border border-slate-200/60'
                        }`}
                      >
                        Без диспетчера ({ferryCouples.filter(c => !c.dispatcher).length})
                      </button>
                    )}
                  </div>

                  {/* Couples List (single unified source = vehicleFleet, mirrored into ferryCouples) */}
                  <div className="flex flex-col gap-3">
                    {filteredCouples.length > 0 ? (
                      filteredCouples.map(couple => {
                        const isCurrentlySelected = selectedCoupleId === couple.id;
                        return (
                          <div 
                            key={couple.id}
                            className={`bg-white rounded-xl p-3 border transition flex items-center justify-between gap-4 ${
                              isCurrentlySelected 
                                ? 'border-slate-900 ring-1 ring-slate-900/10 bg-slate-50/30' 
                                : 'border-slate-200 hover:border-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              {/* Title Info */}
                              <div className="min-w-[120px] max-w-[150px]">
                                <span className="bg-slate-100 text-slate-700 text-[8px] font-semibold px-1.5 py-0.5 rounded font-mono uppercase truncate block">
                                  {couple.model}
                                </span>
                                <h5 className="text-[12px] text-slate-900 font-bold mt-1 truncate">
                                  {couple.stateNumber}
                                </h5>
                              </div>
                              
                              {/* Specs */}
                              <div className="text-[10px] text-slate-600 flex gap-4 overflow-hidden">
                                <div className="truncate">
                                  <span className="text-slate-400 font-medium mr-1">Тип:</span>
                                  <span className="font-semibold text-slate-800">{couple.vehicleType}</span>
                                </div>
                                <div className="truncate">
                                  <span className="text-slate-400 font-medium mr-1">Размеры:</span>
                                  <span className="font-semibold text-slate-800">{couple.dimensions}</span>
                                </div>
                                <div className="truncate">
                                  <span className="text-slate-400 font-medium mr-1">Вод.1:</span>
                                  <span className="font-medium text-slate-700">{couple.driver1?.split(',')[0] || "—"}</span>
                                </div>
                              </div>
                            </div>

                            {/* Status & Actions */}
                            <div className="flex items-center gap-3 shrink-0">
                              {couple.dispatcher ? (
                                <span className="bg-slate-100 text-slate-700 text-[9px] font-semibold px-2 py-0.5 rounded-full border border-slate-200/60">
                                  👤 {couple.dispatcher}
                                </span>
                              ) : (
                                <span className="bg-slate-50 text-slate-400 text-[9px] font-semibold px-2 py-0.5 rounded-full italic">
                                  Без диспетчера
                                </span>
                              )}

                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => handleStartEditCouple(couple.id)}
                                  className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
                                  title="Редактировать сцепку"
                                >
                                  <Edit3 size={13} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleDeleteCouple(couple.id)}
                                  className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition cursor-pointer"
                                  title="Удалить сцепку"
                                >
                                  <Trash2 size={13} />
                                </button>
                              </div>

                              <button
                                onClick={() => {
                                  setSelectedCoupleId(couple.id);
                                  setShowVehicleModal(false);
                                }}
                                className={`text-[10px] font-medium px-3.5 py-1.5 rounded-xl transition cursor-pointer ${
                                  isCurrentlySelected
                                    ? 'bg-slate-100 text-slate-600 border border-slate-200 cursor-default'
                                    : 'bg-slate-900 hover:bg-slate-800 text-white'
                                }`}
                              >
                                {isCurrentlySelected ? 'Выбрано' : 'Выбрать'}
                              </button>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="py-12 flex flex-col items-center justify-center text-slate-400 gap-2">
                        <span className="text-3xl">🔍</span>
                        <p className="text-xs font-bold">Ничего не найдено</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Modal Footer */}
            <div className="bg-slate-50 border-t border-slate-200/40 px-6 py-4 flex justify-end shrink-0">
              <button
                onClick={() => {
                  setShowVehicleModal(false);
                  setShowCoupleEditor(false);
                }}
                className="bg-slate-100/80 border border-slate-200 hover:bg-slate-200/60 text-slate-700 text-xs font-medium uppercase tracking-wider px-6 py-3 rounded-xl transition active:scale-95 cursor-pointer"
              >
                Закрыть
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
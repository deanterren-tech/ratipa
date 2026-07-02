import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { dbService, database } from '../../firebase';
import { ref, onValue, set, push, remove, update } from 'firebase/database';
import { 
  Files, 
  FileText, 
  Search, 
  Plus, 
  Trash2, 
  Edit3, 
  Copy, 
  Printer, 
  Check, 
  Info, 
  FileCheck,
  ChevronRight,
  BookOpen,
  ArrowRight,
  RefreshCw,
  FolderOpen,
  Truck,
  User,
  Calendar,
  Lock,
  DollarSign,
  Wand2
} from 'lucide-react';

interface Props {
  user: UserProfile;
}

interface DocumentTemplate {
  id: string;
  title: string;
  description: string;
  category: 'contract' | 'power_of_attorney' | 'cmr' | 'invoice' | 'custom';
  content: string;
  placeholders: string[];
  createdAt: string;
  createdBy: string;
}

interface FerryCouple {
  id: string;
  stateNumber: string;
  model: string;
  vehicleType: string;
  dimensions: string;
  weight: string;
  driver1: string;
  driver2?: string;
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
    driver2: ''
  },
  {
    id: 'couple_preset_2',
    stateNumber: '1) AE6052-7/А2453Е-7',
    model: 'Скания',
    vehicleType: 'Тенты 90м3',
    dimensions: '13,6м х 2,45м х 2,7м',
    weight: '1) 14,4т',
    driver1: 'Устинов Олег Леонидович USTSINAU ALEH МР 5065058 09.01.2024 Фрунзенским РУВД г. Минска',
    driver2: ''
  }
];

const DEFAULT_TEMPLATES: DocumentTemplate[] = [];

const DEFAULT_CONTACTS = [
  'Терез Сергей Евгеньевич +375445835065',
  'Бориско Владимир Владимирович +375296554522',
  'Макаров Николай Петрович +375298884433'
];

export default function DocumentsModule({ user }: Props) {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'ferry' | 'templates' | 'bamap_tir'>('ferry');

  // --- STANDARD TEMPLATES STATE ---
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<DocumentTemplate | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [variables, setVariables] = useState<Record<string, string>>({});
  
  // Custom template modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newCat, setNewCat] = useState<'contract' | 'power_of_attorney' | 'cmr' | 'invoice' | 'custom'>('custom');
  const [newContent, setNewContent] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  // --- FERRY PORT (ПОРУЧЕНИЕ НА ПАРОМ) STATE & DATABASE ---
  const [ferryCouples, setFerryCouples] = useState<FerryCouple[]>([]);
  const [selectedCoupleId, setSelectedCoupleId] = useState<string>('couple_preset_1');
  const [showCoupleEditor, setShowCoupleEditor] = useState(false);
  const [editCoupleId, setEditCoupleId] = useState<string | null>(null);

  // Ferry Couple form state for adding/editing 1-block machine configuration
  const [coupleStateNumber, setCoupleStateNumber] = useState('');
  const [coupleModel, setCoupleModel] = useState('');
  const [coupleVehicleType, setCoupleVehicleType] = useState('Тенты 90м3');
  const [coupleDimensions, setCoupleDimensions] = useState('13,6м х 2,45м х 2,7м');
  const [coupleWeight, setCoupleWeight] = useState('1) 14,6т');
  const [coupleDriver1, setCoupleDriver1] = useState('');
  const [coupleDriver2, setCoupleDriver2] = useState('');

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
  const [ferryVehicleType, setFerryVehicleType] = useState('');
  const [ferryDimensions, setFerryDimensions] = useState('');
  const [ferryVehicleWeight, setFerryVehicleWeight] = useState('');
  const [ferryDriver1Details, setFerryDriver1Details] = useState('');
  const [ferryDriver2Details, setFerryDriver2Details] = useState('');

  const [ferryCargoDetails, setFerryCargoDetails] = useState('1) сборный груз, до 16т, 29 упаковочных мест');
  const [consignmentsNum, setConsignmentsNum] = useState('5'); // only quantity digit is customizable
  const ferryConsignmentsCount = `1) ${consignmentsNum} CMR`;

  // Save feedback
  const [ferrySavedSuccess, setFerrySavedSuccess] = useState(false);

  // --- FERRY CONTACTS STATE & DATABASE ---
  const [ferryContactsList, setFerryContactsList] = useState<string[]>([]);

  // --- BAMAP TIR SEIZURE LETTER STATE ---
  const [tirOutboxNum, setTirOutboxNum] = useState('90');
  const [tirOutboxDate, setTirOutboxDate] = useState('');
  const [tirCarnetNumbers, setTirCarnetNumbers] = useState('XZ87832581');
  const [tirSignee, setTirSignee] = useState('В.В.Бориско');
  const [tirSavedSuccess, setTirSavedSuccess] = useState(false);

  // --- LOSS DECLARATION FORM STATE ---
  const [tirLossAssoc, setTirLossAssoc] = useState('Ассоциация Международных автомобильных перевозчиков «БАМАП»');
  const [tirLossHolder, setTirLossHolder] = useState('Общество с ограниченной ответственностью «РАТИПА» (ООО «РАТИПА»), УНП 100492419, РБ, 220137, г. Минск, ул. Таежная 39, к. 2');
  const [tirLossIssueDate, setTirLossIssueDate] = useState('15.01.2025');
  const [tirLossExpiryDate, setTirLossExpiryDate] = useState('15.01.2026');
  const [tirLossVolets, setTirLossVolets] = useState('14');
  const [tirLossDisappearancePlaceDate, setTirLossDisappearancePlaceDate] = useState('на таможне назначения в РФ');
  const [tirLossCause, setTirLossCause] = useState<'lost' | 'stolen' | 'destroyed' | 'retained'>('retained');
  const [tirLossState, setTirLossState] = useState<'used' | 'unused'>('used');
  const [tirLossGoodsState, setTirLossGoodsState] = useState<'with_goods' | 'without_goods'>('without_goods');
  const [tirLossGoodsDesc, setTirLossGoodsDesc] = useState('нет');
  const [tirLossPlace, setTirLossPlace] = useState('РФ');
  const [tirLossDate, setTirLossDate] = useState('');
  const [tirLossReport, setTirLossReport] = useState<'yes' | 'no'>('no');
  const [tirLossObservations, setTirLossObservations] = useState<'yes' | 'no'>('no');
  const [tirLossFormPlace, setTirLossFormPlace] = useState('г. Минск');
  const [tirLossFormDate, setTirLossFormDate] = useState('');

  const [tirSubTab, setTirSubTab] = useState<'letter' | 'loss'>('letter');

  const canWrite = user.role === 'root_admin' || user.permissions.documents === 'write';

  // 1. Fetch custom Couples database from Firebase and seed if empty
  useEffect(() => {
    const couplesRef = ref(database, 'ferryCouples');
    const unsub = onValue(couplesRef, (snap) => {
      const val = snap.val();
      if (val) {
        const list: FerryCouple[] = [];
        Object.keys(val).forEach(k => {
          list.push({ id: k, ...val[k] });
        });
        setFerryCouples(list);
      } else {
        // Seed default template combinations immediately
        setFerryCouples(DEFAULT_COUPLES);
        DEFAULT_COUPLES.forEach(c => {
          set(ref(database, `ferryCouples/${c.id}`), c);
        });
      }
    });
    return () => unsub();
  }, []);

  // 1b. Set default loading date and load contacts/TIR data on startup
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
    onValue(tirRef, (snap) => {
      const data = snap.val();
      if (data) {
        if (data.tirOutboxNum) setTirOutboxNum(data.tirOutboxNum);
        if (data.tirOutboxDate) setTirOutboxDate(data.tirOutboxDate);
        if (data.tirCarnetNumbers) setTirCarnetNumbers(data.tirCarnetNumbers);
        if (data.tirSignee) setTirSignee(data.tirSignee);
      }
    }, { onlyOnce: true });

    // Load last TIR Loss Declaration data
    setTirLossDate(todayStr);
    setTirLossFormDate(todayStr);
    const tirLossRef = ref(database, 'bamapTirLossLastData');
    onValue(tirLossRef, (snap) => {
      const data = snap.val();
      if (data) {
        if (data.tirLossAssoc) setTirLossAssoc(data.tirLossAssoc);
        if (data.tirLossHolder) setTirLossHolder(data.tirLossHolder);
        if (data.tirLossIssueDate) setTirLossIssueDate(data.tirLossIssueDate);
        if (data.tirLossExpiryDate) setTirLossExpiryDate(data.tirLossExpiryDate);
        if (data.tirLossVolets) setTirLossVolets(data.tirLossVolets);
        if (data.tirLossDisappearancePlaceDate) setTirLossDisappearancePlaceDate(data.tirLossDisappearancePlaceDate);
        if (data.tirLossCause) setTirLossCause(data.tirLossCause);
        if (data.tirLossState) setTirLossState(data.tirLossState);
        if (data.tirLossGoodsState) setTirLossGoodsState(data.tirLossGoodsState);
        if (data.tirLossGoodsDesc) setTirLossGoodsDesc(data.tirLossGoodsDesc);
        if (data.tirLossPlace) setTirLossPlace(data.tirLossPlace);
        if (data.tirLossDate) setTirLossDate(data.tirLossDate);
        if (data.tirLossReport) setTirLossReport(data.tirLossReport);
        if (data.tirLossObservations) setTirLossObservations(data.tirLossObservations);
        if (data.tirLossFormPlace) setTirLossFormPlace(data.tirLossFormPlace);
        if (data.tirLossFormDate) setTirLossFormDate(data.tirLossFormDate);
      }
    }, { onlyOnce: true });

    return () => unsubContacts();
  }, []);

  // 2. Select Couple and update the current coupled vehicle variables (Linked blocks)
  useEffect(() => {
    if (!selectedCoupleId) return;
    const couple = ferryCouples.find(c => c.id === selectedCoupleId);
    if (couple) {
      setFerryStateNumber(couple.stateNumber);
      setFerryVehicleModel(couple.model);
      setFerryVehicleType(couple.vehicleType);
      setFerryDimensions(couple.dimensions);
      setFerryVehicleWeight(couple.weight);
      setFerryDriver1Details(couple.driver1);
      setFerryDriver2Details(couple.driver2 || '');
      
      // Load saved ferry order dynamic values (e.g. cargo details, date/port, conctact person) from database
      onValue(ref(database, `ferryOrdersData/${selectedCoupleId}`), (snap) => {
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
        let serverError = "Ошибка распознавания на сервере AI";
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
    } catch (e: any) {
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
      vehicleType: coupleVehicleType.trim(),
      dimensions: coupleDimensions.trim(),
      weight: coupleWeight.trim(),
      driver1: coupleDriver1.trim(),
      driver2: coupleDriver2.trim()
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
        setCoupleVehicleType('Тенты 90м3');
        setCoupleDimensions('13,6м х 2,45м х 2,7м');
        setCoupleWeight('1) 14,6т');
        setCoupleDriver1('');
        setCoupleDriver2('');
      })
      .catch(err => {
        console.error("Save couple failed", err);
        alert("Ошибка при сохранении автомобиля в БД.");
      });
  };

  const handleDeleteCouple = (id: string) => {
    if (ferryCouples.length <= 1) {
      alert("Нельзя удалить единственный автомобиль в базе.");
      return;
    }
    if (!window.confirm("Вы уверены, что хотите удалить этот автомобиль (сцепку) из базы?")) return;

    remove(ref(database, `ferryCouples/${id}`))
      .then(() => {
        dbService.logAction(user.name, user.role, "Документы паром", "Documents", id, `Удалил сцепку`);
        if (selectedCoupleId === id) {
          const remaining = ferryCouples.filter(c => c.id !== id);
          if (remaining.length > 0) {
            setSelectedCoupleId(remaining[0].id);
          }
        }
      })
      .catch(err => {
        console.error("Delete couple failed", err);
      });
  };

  const handleStartEditCouple = () => {
    const couple = ferryCouples.find(c => c.id === selectedCoupleId);
    if (!couple) return;
    setEditCoupleId(couple.id);
    setCoupleStateNumber(couple.stateNumber);
    setCoupleModel(couple.model);
    setCoupleVehicleType(couple.vehicleType);
    setCoupleDimensions(couple.dimensions);
    setCoupleWeight(couple.weight);
    setCoupleDriver1(couple.driver1);
    setCoupleDriver2(couple.driver2 || '');
    setShowCoupleEditor(true);
  };

  const handleStartAddCouple = () => {
    setEditCoupleId(null);
    setCoupleStateNumber('1) ');
    setCoupleModel('');
    setCoupleVehicleType('Тенты 90м3');
    setCoupleDimensions('13,6м х 2,45м х 2,7м');
    setCoupleWeight('1) 14,6т');
    setCoupleDriver1('');
    setCoupleDriver2('');
    setShowCoupleEditor(true);
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
              margin: 15mm 15mm 15mm 15mm;
            }
            body {
              font-family: "Times New Roman", Times, serif;
              color: #000;
              background-color: #fff;
              margin: 0;
              padding: 0;
              font-size: 11px;
              line-height: 1.3;
            }
            .container {
              width: 100%;
              max-width: 100%;
            }
            .header-meta {
              text-align: right;
              font-size: 10.5px;
              line-height: 1.3;
              margin-bottom: 15px;
              font-weight: normal;
            }
            .form-title-table {
              width: 100%;
              border-collapse: collapse;
              border: 1px solid #000;
              margin-bottom: 12px;
            }
            .form-title-table td {
              text-align: center;
              font-weight: bold;
              font-size: 11.5px;
              padding: 5px;
              border: none;
              text-transform: uppercase;
            }
            .main-table {
              width: 100%;
              border-collapse: collapse;
              border: 1px solid #000;
              margin-bottom: 15px;
            }
            .main-table th {
              width: 33%;
              text-align: left;
              font-weight: bold;
              border: 1px solid #000;
              padding: 6px 8px;
              vertical-align: top;
              font-size: 10.5px;
              line-height: 1.25;
            }
            .main-table td {
              width: 67%;
              border: 1px solid #000;
              padding: 6px 8px;
              vertical-align: top;
              font-size: 11px;
              font-weight: bold;
              line-height: 1.25;
            }
            .yellow-bg {
              background-color: #ffff00 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
            }
            .sub-table {
              width: 100%;
              border-collapse: collapse;
              margin: 0;
              padding: 0;
              border: none;
            }
            .sub-table td {
              border: none;
              padding: 4px 6px;
              font-size: 10px;
              line-height: 1.2;
            }
            .sub-table tr {
              border-bottom: 1px solid #000;
            }
            .sub-table tr:last-child {
              border-bottom: none;
            }
            .particular-notes-table {
              width: 100%;
              border-collapse: collapse;
              border: none;
              margin: 0;
            }
            .particular-notes-table td {
              border: none;
              padding: 4px 6px;
              background-color: #ffff00 !important;
              -webkit-print-color-adjust: exact;
              print-color-adjust: exact;
              font-size: 10px;
              line-height: 1.35;
              font-weight: bold;
            }
            .particular-notes-table tr {
              border-bottom: 1px solid #000;
            }
            .particular-notes-table tr:last-child {
              border-bottom: none;
            }
            .footer-signals {
              margin-top: 35px;
              width: 100%;
              font-size: 11px;
              line-height: 1.4;
            }
            .footer-line {
              border-bottom: 1px solid #000;
              margin-top: 25px;
              width: 100%;
              height: 1px;
            }
            .footer-signee {
              margin-top: 8px;
              font-weight: bold;
              font-size: 11.5px;
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
                <td>ФОРМА/ FORM</td>
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
                <td>${ferryLoadingDatePort}</td>
              </tr>
              <tr>
                <th>
                  ФИО и номер<br/>телефона<br/>контактного лица/<br/>
                  Name of contact<br/>person name and<br/>phone number:
                </th>
                <td>${ferryContactPerson}</td>
              </tr>
              <tr class="yellow-bg">
                <th class="yellow-bg">
                  Наименование<br/>организации –<br/>перевозчика<br/>(согласно CMR)<br/>
                  /Name of the<br/>organization – carrier<br/>(according to CMR):
                </th>
                <td class="yellow-bg">${ferryCarrierName}</td>
              </tr>
              <tr>
                <th>Тип ТС/Vehicle type:</th>
                <td>${ferryVehicleType}</td>
              </tr>
              <tr>
                <th>Модель/Model:</th>
                <td>${ferryVehicleModel}</td>
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
                  Необходимые услуги<br/>в соответствии с<br/>перечнем и<br/>тарифами,<br/>установленными<br/>
                  <span class="yellow-bg" style="padding: 1px 2px;">Договором</span>/ Necessary
                </th>
                <td style="padding: 0;">
                  <table class="sub-table">
                    <tr>
                      <td style="width: 50%; font-weight: bold; border-right: 1px solid #000; padding: 5px;">Дополнительный водитель/ Additional driver:</td>
                      <td style="width: 25%; text-align: center; border-right: 1px solid #000; padding: 5px; font-weight: normal; font-size: 10px;">Да (Yes)/ Нет (No)</td>
                      <td style="width: 25%; text-align: center; padding: 5px; font-weight: bold;">НЕТ</td>
                    </tr>
                    <tr>
                      <td style="font-weight: bold; border-right: 1px solid #000; padding: 5px;">Опасный груз/ Dangerous goods:</td>
                      <td style="text-align: center; border-right: 1px solid #000; padding: 5px; font-weight: normal; font-size: 10px;">Да (Yes)/ Нет (No)</td>
                      <td style="text-align: center; padding: 5px; font-weight: bold;">НЕТ</td>
                    </tr>
                    <tr>
                      <td style="font-weight: bold; border-right: 1px solid #000; padding: 5px;">Розетка на судне/ Socket on the ship:</td>
                      <td style="text-align: center; border-right: 1px solid #000; padding: 5px; font-weight: normal; font-size: 10px;">Да (Yes)/ Нет (No)</td>
                      <td style="text-align: center; padding: 5px; font-weight: bold;">НЕТ</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <th>
                  services in accordance<br/>with the list and tariffs<br/>
                  <span class="yellow-bg" style="padding: 1px 2px;">established by the<br/>Agreement</span>:
                </th>
                <td style="padding: 0;">
                  <table class="sub-table">
                    <tr>
                      <td style="width: 75%; border-right: 1px solid #000; padding: 5px; font-weight: bold;">
                        Количество <span class="yellow-bg" style="padding: 1px 1px;">грузовых партий (CMR)</span> на одном TC/<br/>
                        Number of <span class="yellow-bg" style="padding: 1px 1px;">consignments (CMR)</span> per vehicle: <strong>${ferryConsignmentsCount || '1) 5 CMR'}</strong>
                      </td>
                      <td style="width: 25%; padding: 5px;"></td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr>
                <th>
                  Итоговая стоимость<br/>с учетом<br/>вышеуказанной<br/>информации/<br/>
                  The total cost, taking<br/>into account the above<br/>information:
                </th>
                <td style="padding: 0;">
                  <table class="sub-table">
                    <tr>
                      <td style="width: 50%; border-right: 1px solid #000; padding: 5px; text-align: center; font-size: 12px; font-weight: bold;">
                        ${ferryTotalCost ? ferryTotalCost : ''}
                      </td>
                      <td style="width: 50%; padding: 5px; font-weight: bold;">Долларов США/ US dollars</td>
                    </tr>
                  </table>
                </td>
              </tr>
              <tr class="yellow-bg">
                <th class="yellow-bg">
                  Особые отметки:<br/>
                  /Particular notes:
                </th>
                <td style="padding: 0;" class="yellow-bg">
                  <table class="particular-notes-table">
                    <tr>
                      <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000;">Х</td>
                      <td>Произвести декларирование процедуры таможенного транзита/Make a declaration of the customs transit procedure</td>
                    </tr>
                    <tr>
                      <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000;">Х</td>
                      <td>Предоставить услугу поручительства при таможенном транзите/ Provide a guarantee service for customs transit</td>
                    </tr>
                    <tr>
                      <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000;">Х</td>
                      <td>Проконтролировать проставление таможней штампа санитарно-карантинного контроля в CMR/Control the affixing of the customs stamp of sanitary and quarantine control in the CMR</td>
                    </tr>
                    <tr>
                      <td style="width: 8%; text-align: center; font-weight: bold; border-right: 1px solid #000;">&nbsp;</td>
                      <td>Организовать помещение груза на временное хранение/Organize the placement of cargo for temporary storage</td>
                    </tr>
                    <tr>
                      <td style="width: 8%; border-right: 1px solid #000;">&nbsp;</td>
                      <td>Иное/ Other:</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>

            <div class="footer-signals">
              <div style="margin-bottom: 25px;">
                <strong>Должность, Ф.И.О., Подпись, Печать Экспедитора / Title, name and surname, Signature, Forwarder's seal</strong>
                <div class="footer-line"></div>
              </div>
              <div style="margin-top: 25px;">
                <strong>Должность, Ф.И.О., Подпись, Печать Клиента/ Title, name and surname, Signature, Client's seal</strong>
                <div class="footer-line"></div>
                <div class="footer-signee">${ferryClientSignee}</div>
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
    const parts = rawText.split(/[\s,;]+/).map(p => p.trim()).filter(Boolean);
    const isPlural = parts.length > 1;
    const listStr = parts.join(', ');
    return {
      parts,
      isPlural,
      listStr: listStr || '[введите номер(-а)]'
    };
  };

  const handleSaveTirLastData = () => {
    const payload = {
      tirOutboxNum,
      tirOutboxDate,
      tirCarnetNumbers,
      tirSignee
    };

    const lossPayload = {
      tirLossAssoc,
      tirLossHolder,
      tirLossIssueDate,
      tirLossExpiryDate,
      tirLossVolets,
      tirLossDisappearancePlaceDate,
      tirLossCause,
      tirLossState,
      tirLossGoodsState,
      tirLossGoodsDesc,
      tirLossPlace,
      tirLossDate,
      tirLossReport,
      tirLossObservations,
      tirLossFormPlace,
      tirLossFormDate
    };

    Promise.all([
      set(ref(database, 'bamapTirLastData'), payload),
      set(ref(database, 'bamapTirLossLastData'), lossPayload)
    ])
      .then(() => {
        setTirSavedSuccess(true);
        dbService.logAction(user.name, user.role, "Документы МДП", "Documents", "last_tir", `Сохранил параметры письма БАМАП и декларации утери по МДП № ${tirCarnetNumbers}`);
        setTimeout(() => setTirSavedSuccess(false), 2500);
      })
      .catch(err => {
        console.error("TIR save failed", err);
        alert("Ошибка сохранения параметров письма и декларации.");
      });
  };

  const handlePrintTirLetter = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const parsed = getTirParsedInfo(tirCarnetNumbers);
    const bookWord = parsed.isPlural ? "книжки" : "книжка";
    const statusWord = parsed.isPlural ? "были изъяты" : "была изъята";
    const customWord = parsed.isPlural ? "таможнях" : "таможне";
    const transportWord = parsed.isPlural ? "перевозки являлись международными" : "перевозка являлась международной";
    const executeWord = parsed.isPlural ? "выполнялись" : "выполнялась";

    printWindow.document.write(`
      <html>
        <head>
          <title>Письмо БАМАП по изъятию МДП — Исх. №${tirOutboxNum}</title>
          <style>
            @page {
              size: A4;
              margin: 20mm 15mm 20mm 20mm;
            }
            body {
              font-family: "Times New Roman", Times, serif;
              color: #000;
              background-color: #fff;
              margin: 0;
              padding: 0;
              font-size: 14.5px;
              line-height: 1.45;
            }
            .header-table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 5px;
            }
            .header-table td {
              vertical-align: top;
              padding: 0;
            }
            .title-ru {
              font-size: 21px;
              font-weight: bold;
              letter-spacing: 5px;
              line-height: 1.1;
              text-align: left;
            }
            .sub-ru {
              font-size: 11px;
              line-height: 1.25;
              margin-top: 5px;
              text-align: left;
            }
            .title-by {
              font-size: 21px;
              font-weight: bold;
              letter-spacing: 5px;
              line-height: 1.1;
              text-align: right;
            }
            .sub-by {
              font-size: 11px;
              line-height: 1.25;
              margin-top: 5px;
              text-align: right;
            }
            .address-block {
              font-size: 10px;
              line-height: 1.35;
              margin-top: 15px;
              margin-bottom: 5px;
              text-align: left;
            }
            .hr-line {
              border-top: 1.5px solid #000;
              margin-bottom: 20px;
              width: 100%;
            }
            .doc-about {
              font-weight: bold;
              margin-top: 40px;
              margin-bottom: 35px;
              font-size: 14.5px;
            }
            .doc-body {
              text-align: justify;
              text-indent: 1.25cm;
              margin-bottom: 22px;
              font-size: 14.5px;
              line-height: 1.55;
            }
            .signature-table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 80px;
            }
            .signature-table td {
              padding: 0;
              font-size: 14.5px;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          <div class="header-table">
            <table style="width: 100%;">
              <tr>
                <td style="width: 48%; vertical-align: top;">
                  <div class="title-ru">Р А Т И П А</div>
                  <div class="sub-ru">
                    Общество с ограниченной<br/>ответственностью
                  </div>
                </td>
                <td style="width: 4%;"></td>
                <td style="width: 48%; vertical-align: top; text-align: right;">
                  <div class="title-by">Р А Т Ы П А</div>
                  <div class="sub-by">
                    таварыства з абмежаванай<br/>адказнасцю
                  </div>
                </td>
              </tr>
            </table>
          </div>

          <div class="address-block">
            Юридический адрес: Республика Беларусь, 220137, г.Минск, ул.Таежная 39, к.2<br/>
            Почтовый адрес: 223060 РБ, Минская обл., Минский р-н, Новодворский с/с д. Б. Стиклево, 40/2 «S-Union» к.61<br/>
            Тел. (+375 17) 338-11-03, 338-10-86.<br/>
            Факс (+375 17) 338-09-79. e-mail: <a href="mailto:ratipa@ratipa.by" style="color: #000; text-decoration: none;">ratipa@ratipa.by</a> <a href="http://www.ratipa.by" target="_blank" style="color: #000; text-decoration: none;">www.ratipa.by</a><br/>
            IBAN:BY87PJCB30120030121000000933 ОАО Приорбанк г.Минск,код 749.<br/>
            УНП 100492419 ОКПО 14612221
          </div>

          <div class="hr-line"></div>

          <table style="width: 100%; border-collapse: collapse;">
            <tr>
              <td style="vertical-align: top; font-size: 14px; width: 45%;">
                Исх. №${tirOutboxNum} от ${tirOutboxDate}
              </td>
              <td style="width: 55%; text-align: right; vertical-align: top; font-size: 14.5px; line-height: 1.35; padding-left: 20px;">
                Ассоциация<br/>
                Международных автомобильных<br/>
                перевозчиков «БАМАП»
              </td>
            </tr>
          </table>

          <div class="doc-about">Касательно изъятых книжек МДП</div>

          <div class="doc-body">
            Настоящим сообщаем, что ${bookWord} МДП <strong style="font-weight: bold;">${parsed.listStr}</strong> ${statusWord} на ${customWord} назначения в Российской Федерации в связи с оформлением не в соответствии с Конвенцией МДП.
          </div>

          <div class="doc-body">
            По данному факту изъятия можем пояснить, что ${transportWord}, т.е. ${executeWord} между различными странами, что допускается Конвенцией МДП.
          </div>

          <table class="signature-table">
            <tr>
              <td style="text-align: left;">Директор</td>
              <td style="text-align: right;">${tirSignee}</td>
            </tr>
          </table>

          <script>
            window.onload = function() {
              window.print();
              setTimeout(function() { window.close(); }, 500);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handlePrintTirLossDeclaration = () => {
    const iframe = document.getElementById('loss-declaration-iframe') as HTMLIFrameElement | null;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } else {
      window.open('/loss_declaration.html', '_blank');
    }
  };

  // --- OLD SYSTEM TEMPLATES LOGIC ---
  useEffect(() => {
    if (selectedTemplate) {
      const vars: Record<string, string> = {};
      selectedTemplate.placeholders.forEach(pl => {
        vars[pl] = variables[pl] || '';
      });
      if (selectedTemplate.placeholders.includes('Дата') && !vars['Дата']) {
        vars['Дата'] = new Date().toLocaleDateString('ru-RU');
      }
      if (selectedTemplate.placeholders.includes('Дата_Выдачи') && !vars['Дата_Выдачи']) {
        vars['Дата_Выдачи'] = new Date().toLocaleDateString('ru-RU');
      }
      if (selectedTemplate.placeholders.includes('Организация') && !vars['Организация']) {
        vars['Организация'] = 'ООО Ратипа';
      }
      if (selectedTemplate.placeholders.includes('Исполнитель') && !vars['Исполнитель']) {
        vars['Исполнитель'] = 'ООО Ратипа';
      }
      if (selectedTemplate.placeholders.includes('Перевозчик') && !vars['Перевозчик']) {
        vars['Перевозчик'] = 'ООО Ратипа';
      }
      setVariables(vars);
    }
  }, [selectedTemplate]);

  const parsePlaceholders = (text: string): string[] => {
    const rx = /\{\{([^}]+)\}\}/g;
    const matches: string[] = [];
    let match;
    while ((match = rx.exec(text)) !== null) {
      const name = match[1].trim();
      if (!matches.includes(name)) {
        matches.push(name);
      }
    }
    return matches;
  };

  const handleCreateOrUpdateTemplate = () => {
    if (!newTitle.trim() || !newContent.trim()) return;

    const parsedVars = parsePlaceholders(newContent);
    const id = editingId || 'tpl_' + Date.now();
    const tplData: Omit<DocumentTemplate, 'id'> = {
      title: newTitle.trim(),
      description: newDesc.trim(),
      category: newCat,
      content: newContent,
      placeholders: parsedVars,
      createdAt: new Date().toISOString(),
      createdBy: user.name
    };

    set(ref(database, `documentTemplates/${id}`), tplData)
      .then(() => {
        dbService.logAction(user.name, user.role, "Шаблоны документов", "Documents", id, `Сохранил шаблон "${newTitle}"`);
        setNewTitle('');
        setNewDesc('');
        setNewCat('custom');
        setNewContent('');
        setEditingId(null);
        setIsModalOpen(false);
      })
      .catch(err => {
        console.error("Failed to save template", err);
      });
  };

  const handleDeleteTemplate = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm(`Вы уверены, что хотите удалить шаблон?`)) return;

    remove(ref(database, `documentTemplates/${id}`))
      .then(() => {
        dbService.logAction(user.name, user.role, "Шаблоны документов", "Documents", id, `Удалил шаблон документов`);
        if (selectedTemplate?.id === id) {
          setSelectedTemplate(null);
        }
      })
      .catch(err => {
        console.error("Delete failed", err);
      });
  };

  const handleEditClick = (tpl: DocumentTemplate, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(tpl.id);
    setNewTitle(tpl.title);
    setNewDesc(tpl.description);
    setNewCat(tpl.category);
    setNewContent(tpl.content);
    setIsModalOpen(true);
  };

  const handleCopyText = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrintTemplate = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const bodyText = getRenderedContent().replace(/\n/g, '<br/>');
    printWindow.document.write(`
      <html>
        <head>
          <title>${selectedTemplate?.title || 'Печать документа'}</title>
          <style>
            body { 
              font-family: Arial, sans-serif; 
              padding: 40px; 
              line-height: 1.6; 
              color: #333; 
              font-size: 14px;
              white-space: pre-wrap;
            }
          </style>
        </head>
        <body>
          ${bodyText}
          <script>
            window.onload = function() { window.print(); window.close(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const getRenderedContent = (): string => {
    if (!selectedTemplate) return '';
    let rendered = selectedTemplate.content;
    Object.keys(variables).forEach(key => {
      const val = variables[key] || `[${key.replace(/_/g, ' ')}]`;
      const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g');
      rendered = rendered.replace(regex, val);
    });
    return rendered;
  };

  const filteredTemplates = templates.filter(t => 
    String(t.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(t.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    String(t.category || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* MODULE HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2 uppercase tracking-tight">
            <Files className="h-6 w-6 text-[#0f7632]" />
            Центр Документов
          </h1>
          <p className="text-xs text-slate-500 font-mono mt-1">
            Генерация, хранение и печать транспортных и сопроводительных документов
          </p>
        </div>
      </div>

      {/* COMPONENT NAVIGATION TABS */}
      <div className="flex border-b border-slate-200 select-none bg-slate-50 p-1.5 rounded-2xl w-max gap-1">
        <button
          onClick={() => setActiveTab('ferry')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition ${
            activeTab === 'ferry' 
              ? 'bg-slate-900 text-[#70FC8E] shadow-sm' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <Truck size={14} />
          Поручение на паром
        </button>
        <button
          onClick={() => setActiveTab('bamap_tir')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition ${
            activeTab === 'bamap_tir' 
              ? 'bg-slate-900 text-[#70FC8E] shadow-sm' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <BookOpen size={14} />
          Письмо БАМАП (МДП)
        </button>
        <button
          onClick={() => setActiveTab('templates')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition ${
            activeTab === 'templates' 
              ? 'bg-slate-900 text-[#70FC8E] shadow-sm' 
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileText size={14} />
          Стандартные шаблоны
        </button>
      </div>

      {/* Tab 1: FERRY PORT ORDER GENERATOR */}
      {activeTab === 'ferry' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          
          {/* FERRY FORM (LEFT - 5 COLS) */}
          <div className="xl:col-span-5 bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-4">
            
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <Truck size={15} className="text-[#0f7632]" />
                Параметры поручения
              </h2>
              <span className="text-[9px] bg-[#70FC8E]/30 text-[#0a5c25] px-2 py-0.5 rounded font-black uppercase font-mono">
                Паром (поручение)
              </span>
            </div>

            {/* Tractor-Trailer Combinations Section (Отдельная база сцепка) */}
            <div className="flex flex-col gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200/40">
              <div className="flex items-center justify-between">
                <label className="text-[10px] font-black uppercase tracking-widest text-[#0f7632] font-mono flex items-center gap-1">
                  🚛 Сцепка тягач-прицеп
                </label>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleStartAddCouple}
                    className="text-[9px] font-black text-[#0f7632] hover:underline flex items-center gap-0.5"
                    title="Создать новую сцепку в базе"
                  >
                    <Plus size={10} /> Добавить
                  </button>
                  <button
                    onClick={handleStartEditCouple}
                    className="text-[9px] font-black text-blue-600 hover:underline flex items-center gap-0.5"
                    title="Редактировать текущую сцепку"
                  >
                    <Edit3 size={10} /> Изменить
                  </button>
                  <button
                    onClick={() => handleDeleteCouple(selectedCoupleId)}
                    className="text-[9px] font-black text-rose-600 hover:underline flex items-center gap-0.5"
                    title="Удалить текущую сцепку"
                  >
                    <Trash2 size={10} /> Удалить
                  </button>
                </div>
              </div>

              {/* Combo selection */}
              <select
                value={selectedCoupleId}
                onChange={(e) => {
                  setSelectedCoupleId(e.target.value);
                  setShowCoupleEditor(false);
                }}
                className="w-full bg-white border border-slate-200 text-slate-900 text-xs font-black px-3 py-2 rounded-xl outline-none focus:border-[#0f7632] transition"
              >
                {ferryCouples.map(c => (
                  <option key={c.id} value={c.id}>{c.stateNumber} (Модель: {c.model})</option>
                ))}
              </select>

              {/* COUPLE FORM / EDITOR */}
              {showCoupleEditor && (
                <div className="mt-2 bg-emerald-50/30 border border-[#0f7632]/20 rounded-xl p-3 flex flex-col gap-3.5">
                  <h3 className="text-[10px] font-black uppercase text-[#0f7632] tracking-wider font-mono">
                    {editCoupleId ? "📝 Редактировать сцепку" : "➕ Новая сцепка в базе"}
                  </h3>
                  
                  {/* AI Parser Block */}
                  <div className="bg-blue-50/50 p-2.5 rounded-xl border border-blue-100 flex flex-col gap-2">
                    <label className="text-[8px] font-black uppercase text-blue-800 font-mono flex items-center justify-between">
                      <span className="flex items-center gap-1"><Wand2 size={10} /> AI Нейросетевой Парсер (текст / скриншот / фото)</span>
                      <span className="text-[7px] text-blue-500 lowercase bg-blue-100 px-1 py-0.5 rounded">Без VPN</span>
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
                          className="w-full bg-white border border-blue-200 text-[10px] p-2 rounded-lg outline-none focus:border-blue-400 resize-none h-11"
                        />
                        <button
                          onClick={handleParseCouple}
                          disabled={isParsingCouple || (!coupleRawText.trim() && !coupleImageBase64)}
                          className="bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-3 rounded-lg text-[9px] font-black uppercase tracking-wider transition shrink-0 flex items-center justify-center gap-1"
                        >
                          {isParsingCouple ? (
                            <span className="animate-pulse">Обработка...</span>
                          ) : (
                            "Разобрать"
                          )}
                        </button>
                      </div>

                      {/* File upload row */}
                      <div className="flex items-center justify-between gap-2 text-[8px] text-slate-500">
                        <label className="flex items-center gap-1 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-2 py-1 rounded-md cursor-pointer transition select-none">
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
                            <p className="text-[8px] font-black text-slate-700 truncate">Скриншот прикреплен</p>
                            <p className="text-[7px] text-slate-400 font-mono">Готов к отправке в ИИ</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setCoupleImageBase64(null)}
                            className="text-[8px] font-black text-rose-600 hover:underline px-1.5 py-1 bg-rose-50 rounded"
                          >
                            Удалить
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div>
                    <label className="text-[8px] font-black uppercase text-slate-500 font-mono">Госномер сцепки (Тягач+Прицеп)</label>
                    <input
                      type="text"
                      placeholder="1) AX1587-7/А1063Е-7"
                      value={coupleStateNumber}
                      onChange={e => setCoupleStateNumber(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs font-bold px-2.5 py-1.5 rounded-lg outline-none focus:border-[#0f7632]"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] font-black uppercase text-slate-500 font-mono">Модель автомобиля</label>
                      <input
                        type="text"
                        placeholder="МЕРСЕДЕС-БЕНЦ"
                        value={coupleModel}
                        onChange={e => setCoupleModel(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs font-bold px-2.5 py-1.5 rounded-lg outline-none focus:border-[#0f7632]"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black uppercase text-slate-500 font-mono">Тип ТС</label>
                      <input
                        type="text"
                        placeholder="Тенты 90м3"
                        value={coupleVehicleType}
                        onChange={e => setCoupleVehicleType(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs font-bold px-2.5 py-1.5 rounded-lg outline-none focus:border-[#0f7632]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[8px] font-black uppercase text-slate-500 font-mono">Габариты полуприцепа</label>
                      <input
                        type="text"
                        placeholder="13,6м х 2,45м х 2,7м"
                        value={coupleDimensions}
                        onChange={e => setCoupleDimensions(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs font-bold px-2.5 py-1.5 rounded-lg outline-none focus:border-[#0f7632]"
                      />
                    </div>
                    <div>
                      <label className="text-[8px] font-black uppercase text-slate-500 font-mono">Вес ТС (Тягач+пп)</label>
                      <input
                        type="text"
                        placeholder="1) 14,6т"
                        value={coupleWeight}
                        onChange={e => setCoupleWeight(e.target.value)}
                        className="w-full bg-white border border-slate-200 text-xs font-bold px-2.5 py-1.5 rounded-lg outline-none focus:border-[#0f7632]"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="text-[8px] font-black uppercase text-slate-500 font-mono">Водитель № 1 (ФИО, паспортные данные)</label>
                    <textarea
                      rows={2}
                      placeholder="ФИО, серия и номер, дата выдачи, орган выдачи"
                      value={coupleDriver1}
                      onChange={e => setCoupleDriver1(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg outline-none focus:border-[#0f7632] resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-[8px] font-black uppercase text-slate-500 font-mono">Водитель № 2 (если есть)</label>
                    <textarea
                      rows={1}
                      placeholder="Второй водитель..."
                      value={coupleDriver2}
                      onChange={e => setCoupleDriver2(e.target.value)}
                      className="w-full bg-white border border-slate-200 text-xs font-medium px-2.5 py-1.5 rounded-lg outline-none focus:border-[#0f7632] resize-none"
                    />
                  </div>

                  <div className="flex gap-2 justify-end pt-1">
                    <button
                      onClick={() => setShowCoupleEditor(false)}
                      className="px-3 py-1 bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-semibold rounded-lg"
                    >
                      Отмена
                    </button>
                    <button
                      onClick={handleSaveCouple}
                      className="px-3 py-1 bg-[#159e44] hover:bg-[#107d35] text-white text-[10px] font-bold rounded-lg"
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
                  <div className="mt-1 bg-white border border-slate-200/60 rounded-xl p-3 text-[11px] text-slate-700 flex flex-col gap-1 w-full shadow-sm">
                    <p className="text-[9px] font-black text-slate-400 uppercase font-mono tracking-wider mb-1 text-center border-b border-slate-100 pb-1">
                      Данные сцепки (Объединённый блок)
                    </p>
                    <div className="grid grid-cols-5 gap-1 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[10px] font-medium">Тягач & ПП:</span>
                      <span className="col-span-3 text-slate-900 font-bold">{act.stateNumber}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[10px] font-medium">Модель тягача:</span>
                      <span className="col-span-3 text-slate-900 font-bold">{act.model}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[10px] font-medium">Тип & Габариты:</span>
                      <span className="col-span-3 text-slate-900 font-bold">{act.vehicleType} | {act.dimensions}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[10px] font-medium">Вес ТС (Тягач+пп):</span>
                      <span className="col-span-3 text-slate-900 font-bold">{act.weight}</span>
                    </div>
                    <div className="grid grid-cols-5 gap-1 py-0.5">
                      <span className="col-span-2 text-slate-400 text-[10px] font-medium">Водитель № 1:</span>
                      <span className="col-span-3 text-slate-800 font-medium line-clamp-1" title={act.driver1}>{act.driver1 || "—"}</span>
                    </div>
                    {act.driver2 && (
                      <div className="grid grid-cols-5 gap-1 py-0.5">
                        <span className="col-span-2 text-slate-400 text-[10px] font-medium">Водитель № 2:</span>
                        <span className="col-span-3 text-slate-800 font-medium line-clamp-1" title={act.driver2}>{act.driver2}</span>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>

            <div className="flex flex-col gap-3.5 max-h-[500px] overflow-y-auto pr-1.5 custom-scrollbar">
              
              <div>
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">Номер приложения / Договор</label>
                <input 
                  type="text" 
                  value={ferryOrgName}
                  onChange={e => setFerryOrgName(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-black px-3.5 py-2 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">Дата & Порт погрузки</label>
                  <input 
                    type="text" 
                    placeholder="05.04.2026 Карасу"
                    value={ferryLoadingDatePort}
                    onChange={e => setFerryLoadingDatePort(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-black px-3.5 py-2 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                  />
                </div>
                <div>
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">👤 Контактное лицо экспедитора</label>
                  <input 
                    type="text" 
                    placeholder="Выберите из списка или введите нового..."
                    value={ferryContactPerson}
                    onChange={e => setFerryContactPerson(e.target.value)}
                    list="ferry-contacts-dl"
                    className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-black px-3.5 py-2 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                  />
                  <datalist id="ferry-contacts-dl">
                    {ferryContactsList.map((contact, idx) => (
                      <option key={idx} value={contact} />
                    ))}
                  </datalist>
                </div>
              </div>

              <div>
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1">
                  🔒 Организация - перевозчик (согласно CMR)
                </label>
                <div className="w-full bg-slate-100 border border-slate-200 text-slate-550 text-xs font-bold px-3.5 py-2.5 rounded-xl select-none">
                  Общество с ограниченной ответственностью «РАТИПА»
                </div>
                <p className="text-[8px] text-slate-400 italic mt-0.5">Данное значение установлено по умолчанию и не редактируется</p>
              </div>

              <div>
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">Наименование груза, вес, упаковка</label>
                <textarea 
                  rows={2}
                  value={ferryCargoDetails}
                  onChange={e => setFerryCargoDetails(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-bold px-3.5 py-2 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition resize-none"
                />
              </div>

              <div>
                <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">
                  Количество партий (CMR) — редактируется только число
                </label>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 font-bold text-xs whitespace-nowrap">1)</span>
                  <input 
                    type="number" 
                    min="1"
                    max="100"
                    placeholder="5"
                    value={consignmentsNum}
                    onChange={e => setConsignmentsNum(e.target.value)}
                    className="w-20 bg-slate-50 border border-slate-200 text-slate-900 text-xs font-black px-3 py-1.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white text-center"
                  />
                  <span className="text-slate-500 font-bold text-xs">CMR</span>
                  <span className="text-[10px] text-slate-400 font-mono italic ml-2">Результат: {ferryConsignmentsCount}</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <div className="text-[10px] text-slate-400 font-medium">
                  <span className="font-mono block uppercase text-[8px] tracking-wider text-slate-400">Стоимость (USD)</span>
                  Без изменений (Blank) 🔒
                </div>
                <div className="text-[10px] text-slate-400 font-medium">
                  <span className="font-mono block uppercase text-[8px] tracking-wider text-slate-400">Руководитель со стороны Клиента</span>
                  Директор Бориско В.В. 🔒
                </div>
              </div>

            </div>

            {/* Save parameters node action */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleSaveFerryDataForCar}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black uppercase py-3 rounded-full flex items-center justify-center gap-1.5 transition active:scale-95 border border-slate-250"
              >
                {ferrySavedSuccess ? (
                  <>
                    <Check className="h-4 w-4 text-[#0f7632]" />
                    Параметры сохранены!
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-4 w-4 text-slate-600" />
                    Сохранить параметры
                  </>
                )}
              </button>
              <button
                onClick={handlePrintFerryOrder}
                className="flex-1 bg-[#70FC8E] hover:bg-[#5ceb7d] text-slate-950 text-xs font-black uppercase py-3 rounded-full flex items-center justify-center gap-1.5 transition active:scale-95 border border-black/10 shadow-sm"
              >
                <Printer className="h-4 w-4" />
                Распечатать поручение
              </button>
            </div>

          </div>

          {/* DRAFT PRINT PREVIEW PAPER CONTAINER (RIGHT - 7 COLS) */}
          <div className="xl:col-span-7 bg-slate-100 border border-slate-200 rounded-[2rem] p-6 max-h-[850px] overflow-y-auto shadow-inner flex justify-center">
            
            {/* PAPER BLOCK */}
            <div className="bg-white rounded border border-slate-200 p-8 shadow-[0_15px_40px_rgba(0,0,0,0.06)] w-full max-w-[650px] aspect-[1/1.414] text-[10px] text-black font-serif leading-tight">
              
              <div className="text-right text-[10px] font-serif leading-snug mb-4">
                Приложение № 1/Appendix No. 1<br/>
                к договору транспортной экспедиции/to the freight forwarding agreement<br/>
                от/dd. «05» июля 2022г №0522
              </div>
              
              <table className="w-full border-collapse border border-black mb-3 text-[11px] font-serif">
                <tbody>
                  <tr>
                    <td className="text-center font-bold p-1 border-0 uppercase">ФОРМА/ FORM</td>
                  </tr>
                  <tr>
                    <td className="text-center font-bold p-1 border-0 uppercase">ПОРУЧЕНИЕ ЭКСПЕДИТОРУ/ FORWARDER’S ORDER</td>
                  </tr>
                </tbody>
              </table>

              {/* STYLED 1-to-1 LAYOUT GRID */}
              <table className="w-full border-collapse border border-black text-[10.5px]">
                <tbody>
                  <tr className="border-b border-black">
                    <td className="w-[33%] p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      НАИМЕНОВАНИЕ<br/>ОРГАНИЗАЦИИ:<br/>
                      NAME OF<br/>ORGANIZATION:
                    </td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryOrgName}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      Дата<br/>предполагаемой<br/>погрузки на судно и<br/>порт погрузки/<br/>
                      Date of intended<br/>loading on vessel and<br/>port of loading:
                    </td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryLoadingDatePort || '[не заполнено]'}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      ФИО и номер<br/>телефона<br/>контактного лица/<br/>
                      Name of contact<br/>person name and<br/>phone number:
                    </td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryContactPerson}</td>
                  </tr>
                  <tr className="border-b border-black bg-yellow-300">
                    <td className="p-2 border-r border-black font-bold align-top select-none bg-yellow-300 uppercase tracking-tight leading-snug style-title">
                      Наименование<br/>организации –<br/>перевозчика<br/>(согласно CMR)<br/>
                      /Name of the<br/>organization – carrier<br/>(according to CMR):
                    </td>
                    <td className="p-2 font-bold text-slate-950 align-top bg-yellow-300">{ferryCarrierName}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">Тип ТС/Vehicle type:</td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryVehicleType}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">Модель/Model:</td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryVehicleModel}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Государственный<br/>номер/State Number:
                    </td>
                    <td className="p-2 font-black text-slate-950 select-all align-top">{ferryStateNumber || '[не заполнено]'}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none uppercase tracking-tight leading-snug style-title">
                      Габариты (Длина х<br/>Ширина х<br/>Высота)/Dimensions<br/>
                      (Length х Width х<br/>Height):
                    </td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryDimensions}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Вес ТС (Тягач +<br/>п/прицепом)/<br/>
                      Vehicle weight (tractor<br/>+ semi-trailer):
                    </td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryVehicleWeight}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Водитель № 1 (ФИО,<br/>паспортные<br/>данные)/Driver<br/>
                      № 1 (full name,<br/>passport details):
                    </td>
                    <td className="p-2 font-bold text-slate-900 align-top select-all">{ferryDriver1Details || '[водитель не указан]'}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Водитель № 2 (ФИО,<br/>паспортные<br/>данные)/Driver<br/>
                      № 2 (full name,<br/>passport details):
                    </td>
                    <td className="p-2 font-bold text-slate-600 align-top">{ferryDriver2Details || '—'}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title">
                      Наименование груза,<br/>вес груза,<br/>количество<br/>упаковочных мест/<br/>
                      Name of cargo, weight<br/>of cargo, number of<br/>packing places:
                    </td>
                    <td className="p-2 font-bold text-slate-900 align-top">{ferryCargoDetails}</td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title leading-normal">
                      Необходимые услуги<br/>в соответствии с<br/>перечнем и<br/>тарифами,<br/>установленными<br/>
                      <span className="bg-yellow-300 font-bold px-1 rounded-sm">Договором</span>/ Necessary
                    </td>
                    <td className="p-0 align-top">
                      <table className="w-full border-collapse text-[10px] border-0">
                        <tbody>
                          <tr className="border-b border-black">
                            <td className="w-[50%] p-1.5 border-r border-black font-bold font-serif">Дополнительный водитель/ Additional driver:</td>
                            <td className="w-[25%] p-1.5 border-r border-black text-slate-600">Да (Yes)/ Нет (No)</td>
                            <td className="w-[25%] p-1.5 text-center font-bold text-black">НЕТ</td>
                          </tr>
                          <tr className="border-b border-black">
                            <td className="p-1.5 border-r border-black font-bold font-serif">Опасный груз/ Dangerous goods:</td>
                            <td className="p-1.5 border-r border-black text-slate-600">Да (Yes)/ Нет (No)</td>
                            <td className="p-1.5 text-center font-bold text-black">НЕТ</td>
                          </tr>
                          <tr className="border-b-0">
                            <td className="p-1.5 border-r border-black font-bold font-serif">Розетка на судне/ Socket on the ship:</td>
                            <td className="p-1.5 border-r border-black text-slate-600">Да (Yes)/ Нет (No)</td>
                            <td className="p-1.5 text-center font-bold text-black">НЕТ</td>
                          </tr>
                        </tbody>
                      </table>
                    </td>
                  </tr>
                  <tr className="border-b border-black">
                    <td className="p-2 border-r border-black font-bold align-top select-none style-title leading-normal">
                      services in accordance<br/>with the list and tariffs<br/>
                      <span className="bg-yellow-300 font-bold px-1 rounded-sm">established by the<br/>Agreement</span>:
                    </td>
                    <td className="p-0 align-top">
                      <table className="w-full border-collapse text-[10px] border-0">
                        <tbody>
                          <tr>
                            <td className="w-[75%] p-2 border-r border-black font-bold font-serif">
                              Количество <span className="bg-yellow-300 font-bold px-1 rounded-sm">грузовых партий (CMR)</span> на одном ТС/<br/>
                              Number of <span className="bg-yellow-300 font-bold px-1 rounded-sm">consignments (CMR)</span> per vehicle: <strong className="block mt-1 text-[11px] font-bold">{ferryConsignmentsCount || '1) 5 CMR'}</strong>
                            </td>
                            <td className="w-[25%] p-2"></td>
                          </tr>
                        </tbody>
                      </table>
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
                  <div className="border-b border-black mt-6 w-full h-[1px]"></div>
                </div>
                <div>
                  <strong>Должность, Ф.И.О., Подпись, Печать Клиента/ Title, name and surname, Signature, Client's seal</strong>
                  <div className="border-b border-black mt-6 w-full h-[1px]"></div>
                  <div className="mt-2 font-bold text-[11.5px] uppercase tracking-tight">{ferryClientSignee}</div>
                </div>
              </div>

            </div>

          </div>

        </div>
      )}

      {/* Tab 3: BAMAP TIR SEIZURE LETTER */}
      {activeTab === 'bamap_tir' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
          
          {/* TIR FORM (LEFT - 5 COLS) */}
          <div className="xl:col-span-5 bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-4">
            
            <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
              <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                <BookOpen size={15} className="text-[#0f7632]" />
                Документы БАМАП (МДП)
              </h2>
              <span className="text-[9px] bg-[#70FC8E]/30 text-[#0a5c25] px-2 py-0.5 rounded font-black uppercase font-mono">
                РД / МДП
              </span>
            </div>

            {/* Sub-document selection switcher */}
            <div className="flex bg-slate-100 p-1 rounded-xl">
              <button
                onClick={() => setTirSubTab('letter')}
                className={`flex-1 text-[9.5px] font-black uppercase py-2.5 rounded-lg transition-all ${
                  tirSubTab === 'letter'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Письмо об изъятии
              </button>
              <button
                onClick={() => setTirSubTab('loss')}
                className={`flex-1 text-[9.5px] font-black uppercase py-2.5 rounded-lg transition-all ${
                  tirSubTab === 'loss'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
              >
                Декларация об утере
              </button>
            </div>

            {/* Form Panels based on sub-tab */}
            {tirSubTab === 'letter' ? (
              /* Letter input panel */
              <div className="flex flex-col gap-4">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">
                      Исходящий номер №
                    </label>
                    <input 
                      type="text" 
                      value={tirOutboxNum}
                      onChange={e => setTirOutboxNum(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-black px-3.5 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                      placeholder="Например, 90"
                    />
                  </div>
                  <div>
                    <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">
                      Дата исходящего
                    </label>
                    <input 
                      type="text" 
                      value={tirOutboxDate}
                      onChange={e => setTirOutboxDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-black px-3.5 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                      placeholder="Например, 10.05.2026"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-500 font-mono">
                    Номера книжек МДП (ТШ / Carnet)
                  </label>
                  <input 
                    type="text" 
                    value={tirCarnetNumbers}
                    onChange={e => setTirCarnetNumbers(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 text-slate-900 text-xs font-black px-3.5 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                    placeholder="Например: XZ87832581 или XZ87832581, GX85997097"
                  />
                  <p className="text-[8.5px] text-slate-400 italic mt-1 font-mono leading-normal">
                    * Можно ввести несколько номеров через пробел или запятую. Система автоматически распознает число и поменяет грамматику (была изъята / были изъяты) в тексте.
                  </p>
                </div>

                <div>
                  <label className="text-[9px] font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1">
                    🔒 Руководитель (не изменяется)
                  </label>
                  <div className="w-full bg-slate-100 border border-slate-200 text-slate-500 text-xs font-bold px-3.5 py-2.5 rounded-xl select-none">
                    Директор В.В.Бориско
                  </div>
                  <p className="text-[8px] text-slate-400 italic mt-0.5">Значение заблокировано согласно требованиям шаблона</p>
                </div>
              </div>
            ) : (
              /* Loss Declaration input panel */
              <div className="flex flex-col gap-3.5 mt-8 items-center text-center pb-8">
                <FileText className="w-12 h-12 text-slate-300 mb-2" />
                <h3 className="text-slate-800 font-bold text-sm">Оригинальный бланк</h3>
                <p className="text-xs text-slate-500 max-w-xs">
                  Для декларации об утере используется оригинальный бланк формата HTML.
                  Нажмите «Распечатать» ниже, чтобы открыть его.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row gap-3">
              <button
                onClick={handleSaveTirLastData}
                className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-black uppercase py-3 rounded-full flex items-center justify-center gap-1.5 transition active:scale-95 border border-slate-250"
              >
                {tirSavedSuccess ? (
                  <>
                    <Check className="h-4 w-4 text-[#0f7632]" />
                    Сохранено!
                  </>
                ) : (
                  <>
                    <FolderOpen className="h-4 w-4 text-slate-600" />
                    Сохранить параметры
                  </>
                )}
              </button>
              <button
                onClick={tirSubTab === 'letter' ? handlePrintTirLetter : handlePrintTirLossDeclaration}
                className="flex-1 bg-[#70FC8E] hover:bg-[#5ceb7d] text-slate-950 text-xs font-black uppercase py-3 rounded-full flex items-center justify-center gap-1.5 transition active:scale-95 border border-black/10 shadow-sm"
              >
                <Printer className="h-4 w-4" />
                Распечатать
              </button>
            </div>

          </div>

          {/* DOCUMENT PREVIEW PAPER (RIGHT - 7 COLS) */}
          <div className="xl:col-span-7 bg-slate-100 border border-slate-200 rounded-[2rem] p-6 max-h-[850px] overflow-y-auto shadow-inner flex justify-center">
            
            {tirSubTab === 'letter' ? (
              /* PAPER BLOCK - TIR SEIZURE LETTER */
              <div className="bg-white rounded border border-slate-250 p-10 shadow-[0_15px_40px_rgba(0,0,0,0.06)] w-full max-w-[650px] text-[12px] text-black font-serif leading-relaxed min-h-[750px]">
                
                {/* Header Info */}
                <div className="border-b-2 border-black pb-3">
                  <div className="grid grid-cols-2">
                    <div>
                      <div className="text-[18px] font-bold tracking-[3px] uppercase font-serif">Р А Т И П А</div>
                      <div className="text-[9.5px] leading-tight font-serif text-slate-800 mt-0.5">
                        Общество с ограниченной<br/>ответственностью
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[18px] font-bold tracking-[3px] uppercase font-serif">Р А Т Ы П А</div>
                      <div className="text-[9.5px] leading-tight font-serif text-slate-800 mt-0.5">
                        таварыства з абмежаванай<br/>адказнасцю
                      </div>
                    </div>
                  </div>

                  <div className="text-[8.5px] text-slate-500 leading-normal mt-3 font-serif">
                    Юридический адрес: Республика Беларусь, 220137, г.Минск, ул.Таежная 39, к.2<br/>
                    Почтовый адрес: 223060 РБ, Минская обл., Минский р-н, Новодворский с/с д. Б. Стиклево, 40/2 «S-Union» к.61<br/>
                    Тел. (+375 17) 338-11-03, 338-10-86. Тел/Факс (+375 17) 338-09-79. e-mail: ratipa@ratipa.by www.ratipa.by<br/>
                    IBAN:BY87PJCB30120030121000000933 ОАО Приорбанк г.Минск,код 749. УНП 100492419 ОКПО 14612221
                  </div>
                </div>

                {/* References Line & Receiver */}
                <table className="w-full mt-5 text-[12px]">
                  <tbody>
                    <tr>
                      <td className="align-top w-[45%] font-serif">
                        Исх. № <span className="font-bold border-b border-black px-2">{tirOutboxNum || '___'}</span> от <span className="font-bold border-b border-black px-2">{tirOutboxDate || '__________'}</span>
                      </td>
                      <td className="text-right align-top w-[55%] font-serif leading-snug">
                        Ассоциация<br/>
                        Международных автомобильных<br/>
                        перевозчиков «БАМАП»
                      </td>
                    </tr>
                  </tbody>
                </table>

                {/* Touch on Subject */}
                <div className="font-bold mt-10 mb-6 font-serif">
                  Касательно изъятых книжек МДП
                </div>

                {/* Dynamic body paragraph 1 */}
                <div className="text-justify indent-8 mb-5 font-serif leading-relaxed text-black">
                  Настоящим сообщаем, что {getTirParsedInfo(tirCarnetNumbers).isPlural ? "книжки" : "книжка"} МДП{' '}
                  <strong className="font-bold underline">{getTirParsedInfo(tirCarnetNumbers).listStr}</strong>{' '}
                  {getTirParsedInfo(tirCarnetNumbers).isPlural ? "были изъяты" : "была изъята"} на{' '}
                  {getTirParsedInfo(tirCarnetNumbers).isPlural ? "таможнях" : "таможне"} назначения в Российской Федерации в связи с оформлением не в соответствии с Конвенцией МДП.
                </div>

                {/* Dynamic body paragraph 2 */}
                <div className="text-justify indent-8 mb-16 font-serif leading-relaxed text-black">
                  По данному факту изъятия можем пояснить, что{' '}
                  {getTirParsedInfo(tirCarnetNumbers).isPlural ? "перевозки являлись международными" : "перевозка являлась международной"}, т.е.{' '}
                  {getTirParsedInfo(tirCarnetNumbers).isPlural ? "выполнялись" : "выполнялась"} между различными странами, что допускается Конвенцией МДП.
                </div>

                {/* Signature block */}
                <table className="w-full mt-10 font-bold text-[12px]">
                  <tbody>
                    <tr>
                      <td className="text-left font-serif">Директор</td>
                      <td className="text-right font-serif">{tirSignee}</td>
                    </tr>
                  </tbody>
                </table>

              </div>
            ) : (
              /* PAPER BLOCK - LOSS DECLARATION FORM */
              <div className="bg-white rounded-[2rem] border border-slate-250 p-2 shadow-[0_15px_40px_rgba(0,0,0,0.06)] w-full max-w-[650px] min-h-[750px] flex items-center justify-center overflow-hidden">
                <iframe id="loss-declaration-iframe" src="/loss_declaration.html" className="w-full h-[750px] border-0 rounded-[1.5rem]" title="Декларация об утере" />
              </div>
            )}

          </div>

        </div>
      )}

      {/* Tab 2: STANDARD VARIABLE TEMPLATES (PRESERVED LOGIC) */}
      {activeTab === 'templates' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          
          {/* LEFT COLUMN: LIST OF TEMPLATES */}
          <div className="xl:col-span-4 space-y-4">
            <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-4">
              
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-black uppercase text-slate-400 font-mono">Доступные шаблоны</span>
                {canWrite && (
                  <button 
                    onClick={() => {
                      setEditingId(null);
                      setNewTitle('');
                      setNewDesc('');
                      setNewCat('custom');
                      setNewContent('');
                      setIsModalOpen(true);
                    }}
                    className="text-[#0f7632] hover:text-emerald-700 font-extrabold text-xs uppercase flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="h-4.5 w-4.5" />
                    Новый
                  </button>
                )}
              </div>

              <div className="relative">
                <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                <input 
                  type="text" 
                  placeholder="Поиск шаблонов..." 
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 rounded-xl py-2 pl-10 pr-4 text-xs font-bold outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>

              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                  <RefreshCw className="h-6 w-6 animate-spin mb-3 text-emerald-600" />
                  <span className="text-[10px] font-black uppercase tracking-wider font-mono">Загрузка...</span>
                </div>
              ) : filteredTemplates.length === 0 ? (
                <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                  <FolderOpen className="h-8 w-8 text-slate-350 mx-auto mb-2" />
                  <span className="text-[10px] font-black uppercase font-mono tracking-widest text-slate-400 block">Шаблоны не найдены</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto pr-1">
                  {filteredTemplates.map((tpl) => {
                    const isSelected = selectedTemplate?.id === tpl.id;
                    return (
                      <div 
                        key={tpl.id}
                        onClick={() => setSelectedTemplate(tpl)}
                        className={`group p-4 border rounded-2xl cursor-pointer transition flex items-start gap-3 relative ${
                          isSelected 
                            ? 'bg-[#70FC8E]/10 border-[#70FC8E]/40 shadow-sm' 
                            : 'bg-slate-50/70 border-slate-200/50 hover:bg-slate-50 hover:border-slate-300'
                        }`}
                      >
                        <div className={`p-2 rounded-xl flex-shrink-0 ${isSelected ? 'bg-slate-900 text-[#70FC8E]' : 'bg-slate-200/55 text-slate-500'}`}>
                          <FileText className="h-4.5 w-4.5" />
                        </div>
                        <div className="flex-1 min-w-0 pr-12">
                          <h3 className="font-extrabold text-slate-900 text-xs truncate leading-tight uppercase tracking-tight">{tpl.title}</h3>
                          <p className="text-[10px] text-slate-550 mt-0.5 line-clamp-2">{tpl.description || 'Нет описания'}</p>
                          <span className="text-[8px] font-mono font-black uppercase bg-slate-200/75 text-slate-600 px-1.5 py-0.5 rounded mt-2 inline-block">
                            Переменных: {tpl.placeholders.length}
                          </span>
                        </div>
                        
                        <div className="absolute right-3 top-3.5 flex gap-1 items-center opacity-0 group-hover:opacity-100 transition duration-150">
                          {canWrite && (
                            <>
                              <button 
                                title="Редактировать шаблон" 
                                onClick={(e) => handleEditClick(tpl, e)}
                                className="p-1.5 bg-white text-slate-500 hover:text-indigo-600 border border-slate-200 rounded-lg shadow-sm hover:border-indigo-200 transition"
                              >
                                <Edit3 className="h-3.5 w-3.5" />
                              </button>
                              <button 
                                title="Удалить шаблон" 
                                onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                                className="p-1.5 bg-white text-slate-500 hover:text-rose-600 border border-slate-200 rounded-lg shadow-sm hover:border-rose-200 transition"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </>
                          )}
                          <ChevronRight className="h-4 w-4 text-slate-400" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: CHOSEN TEMPLATE EDIT & VIEW */}
          <div className="xl:col-span-8">
            {selectedTemplate ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                
                {/* VARIABLES FORM */}
                <div className="lg:col-span-5 bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-4">
                  <div className="border-b border-slate-100 pb-3">
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                      <Edit3 className="h-4 w-4 text-[#0f7632]" />
                      Заполните данные
                    </h2>
                  </div>

                  <div className="flex flex-col gap-3.5 max-h-[550px] overflow-y-auto pr-1">
                    {selectedTemplate.placeholders.length === 0 ? (
                      <div className="text-center py-6 text-slate-450 text-xs font-mono">
                        Шаблон не содержит переменных в формате {"{{переменная}}"}
                      </div>
                    ) : (
                      selectedTemplate.placeholders.map((key) => (
                        <div key={key} className="flex flex-col gap-1.5">
                          <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 font-mono">
                            {key.replace(/_/g, ' ')}
                          </label>
                          <input 
                            type="text" 
                            placeholder={`Введите ${key.replace(/_/g, ' ').toLowerCase()}...`}
                            value={variables[key] || ''}
                            onChange={e => setVariables({ ...variables, [key]: e.target.value })}
                            className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* LIVE GENERATION PREVIEW */}
                <div className="lg:col-span-7 flex flex-col gap-4">
                  <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col h-full">
                    <div className="border-b border-slate-100 pb-4 mb-4 flex items-center justify-between select-none">
                      <div className="flex flex-col gap-0.5">
                        <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-1.5">
                          <FileCheck className="h-4.5 w-4.5 text-[#0f7632]" />
                          Готовый документ
                        </h2>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => handleCopyText(getRenderedContent())}
                          title="Скопировать готовый текст"
                          className="bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 p-2.5 rounded-xl transition duration-150 border border-slate-200/40 relative flex items-center gap-1.5 text-[10px] font-mono leading-none"
                        >
                          {copied ? <Check className="h-4 w-4 text-green-600 animate-bounce" /> : <Copy className="h-4 w-4" />}
                          {copied ? 'Скопировано!' : 'Копировать'}
                        </button>
                        
                        <button 
                          onClick={handlePrintTemplate}
                          title="Распечатать"
                          className="bg-slate-900 hover:bg-slate-800 active:scale-95 text-white p-2.5 rounded-xl transition duration-150 border border-transparent flex items-center gap-1.5 text-[10px] font-mono leading-none"
                        >
                          <Printer className="h-4 w-4" />
                          Печать
                        </button>
                      </div>
                    </div>

                    <div className="bg-slate-950 text-slate-100 rounded-2xl p-6 font-mono text-[11px] leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[500px] border border-slate-850 flex-1 relative min-h-[300px]">
                      <div className="absolute top-3 right-3 text-[8px] font-mono text-slate-500 bg-slate-800/40 px-2 py-0.5 rounded uppercase select-none">
                        Предпросмотр
                      </div>
                      {getRenderedContent()}
                    </div>
                  </div>
                </div>

              </div>
            ) : (
              <div className="bg-white rounded-[2rem] p-12 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] text-center flex flex-col items-center justify-center min-h-[400px]">
                <div className="h-16 w-16 rounded-full bg-slate-50 flex items-center justify-center mb-4 text-[#0f7632]/80 border border-dashed border-slate-200">
                  <BookOpen className="h-8 w-8" />
                </div>
                <h3 className="font-extrabold text-slate-900 text-sm uppercase tracking-tight">Выберите шаблон документа</h3>
                <p className="text-xs text-slate-550 max-w-sm mt-1 mb-6 leading-relaxed">
                  Выберите один из стандартных шаблонов в списке для редактирования и заполнения.
                </p>
              </div>
            )}
          </div>

        </div>
      )}

      {/* CREATE/EDIT TEMPLATE MODAL */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/40 backdrop-blur-xs select-none">
          <div className="bg-white rounded-[2rem] w-full max-w-2xl border border-slate-200 flex flex-col shadow-2xl overflow-hidden max-h-[90vh]">
            
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h3 className="font-black text-slate-900 text-sm uppercase tracking-wider font-mono flex items-center gap-2">
                <Files className="h-5 w-5 text-emerald-600" />
                {editingId ? "Редактировать шаблон" : "Создать новый шаблон"}
              </h3>
              <button 
                onClick={() => setIsModalOpen(false)}
                className="text-slate-450 hover:text-slate-650 p-2 rounded-xl transition font-black"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex flex-col gap-4">
              
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Название документа</label>
                <input 
                  type="text" 
                  placeholder="Например: Договор аренды..."
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Короткое описание</label>
                <input 
                  type="text" 
                  placeholder="Кому и для чего..."
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Категория</label>
                <select 
                  value={newCat}
                  onChange={e => setNewCat(e.target.value as any)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                >
                  <option value="contract">Договоры</option>
                  <option value="power_of_attorney">Доверенности</option>
                  <option value="invoice">Счета и оплаты</option>
                  <option value="custom">Другие шаблоны</option>
                </select>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Шаблон текста</label>
                  <span className="text-[9px] text-[#0f7632] font-mono font-bold tracking-tight">
                    Используйте {"{{Переменная}}"} в тексте
                  </span>
                </div>
                <textarea 
                  rows={8}
                  placeholder={`ДОГОВОР № {{Номер_Договора}}
Дата: {{Дата}}

Просим предоставить транспорт по маршруту {{Маршрут}}...`}
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-mono p-4 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition resize-none"
                />
              </div>

            </div>

            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition text-xs font-mono uppercase tracking-widest"
              >
                Отмена
              </button>
              <button 
                onClick={handleCreateOrUpdateTemplate}
                className="px-5 py-2.5 rounded-xl font-bold text-slate-950 bg-[#70FC8E] hover:bg-[#5ceb7d] transition border border-black/10 text-xs font-mono uppercase tracking-widest"
              >
                Сохранить
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

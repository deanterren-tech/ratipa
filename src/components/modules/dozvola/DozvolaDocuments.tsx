import React, { useState, useEffect } from "react";
import { UserProfile } from "../../../types";
import { FileText, Download, Printer, Plus, Trash2, CheckCircle, Search, Sparkles, RefreshCw, Sliders, Settings, Layers, Eye } from "lucide-react";
import { useFirebase, database } from "../../../firebase";
import { ref, onValue, push, update } from "firebase/database";
import JSZip from "jszip";
import * as pdfjsLib from "pdfjs-dist";
import {
  PERMIT_APPLICATION_TEMPLATE_BASE64,
  RETURN_REGISTRY_TEMPLATE_BASE64,
  CHINA_COPY_TEMPLATE_BASE64
} from "./DozvolaTemplates";

// Configure PDF.js worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

interface DozvolaDocumentsProps {
  user: UserProfile;
}

export default function DozvolaDocuments({ user }: DozvolaDocumentsProps) {
  const [docType, setDocType] = useState("Заявление на получение разрешений");
  const [dozvolsData, setDozvolsData] = useState<any>({});
  const [todoTasks, setTodoTasks] = useState<any>({});
  const [permitPrintMappings, setPermitPrintMappings] = useState<any>({});
  const [applicationDate, setApplicationDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Document row state for interactive editing
  const [permitRows, setPermitRows] = useState<any[]>([]);
  const [selectedPermitTasks, setSelectedPermitTasks] = useState<Record<string, boolean>>({});

  const [returnRows, setReturnRows] = useState<any[]>([]);
  const [selectedReturnItems, setSelectedReturnItems] = useState<Record<string, boolean>>({});
  const [showArchiveReturns, setShowArchiveReturns] = useState(false);

  const [chinaRows, setChinaRows] = useState<any[]>([]);
  const [selectedChinaItems, setSelectedChinaItems] = useState<Record<string, boolean>>({});
  const [showArchiveChina, setShowArchiveChina] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [lastAssembledStatement, setLastAssembledStatement] = useState<any>(null);

  useEffect(() => {
    if (!useFirebase) return;
    const subs: (() => void)[] = [];
    const listen = (path: string, setter: (val: any) => void) => {
      const dbRef = ref(database, path);
      const unsub = onValue(dbRef, (snap) => setter(snap.val() || {}));
      subs.push(() => unsub());
    };
    listen("dozvolsRegistryV4", setDozvolsData);
    listen("dozvolsTodoTasksV4", setTodoTasks);
    listen("dozvolsPermitPrintMappingsV1", setPermitPrintMappings);
    listen("lastAssembledStatementPermitsV1", setLastAssembledStatement);
    return () => subs.forEach((s) => s());
  }, []);

  const safeText = (value: any) => String(value || '').replace(/[&<>"']/g, s => (({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' } as any)[s]));
  
  const formatApplicationDate = (value: string) => {
    if (!value) return '';
    const [year, month, day] = String(value).split('-');
    if (year && month && day) return `${day}.${month}.${year}`;
    return value;
  };

  const getStatusLabel = (status: string) => {
    const map: any = {
      office: 'В офисе',
      available: 'В наличии',
      hand: 'В рейсе / на руках',
      office_return: 'Сдан в офис',
      used: 'Сдан в транспортную инспекцию',
      expired: 'Аннулирован'
    };
    return map[status] || status || '—';
  };

  const getPermitPrintMapping = (typeName: string) => {
      const cleanName = String(typeName || '').trim().toUpperCase();
      const year = new Date().getFullYear();
      let defaultMap: any = { country: '', category: '', year };
      if (cleanName.includes('UZ 2')) defaultMap = { country: 'Узбекистан', category: 'двухсторонн', year };
      else if (cleanName.includes('UZ 3')) defaultMap = { country: 'Узбекистан', category: 'трехсторонн', year };
      else if (cleanName.includes('UZ 4')) defaultMap = { country: 'Узбекистан', category: 'универсальн', year };
      else if (cleanName.includes('CHN 2')) defaultMap = { country: 'Китай', category: 'двухсторонн', year };
      else if (cleanName.includes('CHN 3')) defaultMap = { country: 'Китай', category: 'трехсторонн', year };
      else if (cleanName.includes('RUS')) defaultMap = { country: 'Россия', category: '', year };
      else if (cleanName.includes('TR A')) defaultMap = { country: 'Турция', category: 'двухсторонн', year };
      else if (cleanName.includes('TR B')) defaultMap = { country: 'Турция', category: 'трехсторонн', year };
      else if (cleanName.includes('GE')) defaultMap = { country: 'Грузия', category: '', year };
      else if (cleanName.includes('KZ3')) defaultMap = { country: 'Казахстан', category: 'трехсторонн', year };
      else if (cleanName.includes('AM3')) defaultMap = { country: 'Армения', category: 'трехсторонн', year };
      
      return { ...defaultMap, ...(permitPrintMappings[typeName] || {}) };
  };

  const logDocumentHistory = (documentName: string, details: string, action: string) => {
      if (!useFirebase) return;
      const logist = localStorage.getItem('ratipa_auth_user') || user?.name || "Система";
      push(ref(database, 'dozvolsDocumentsHistoryV1'), {
          time: new Date().toLocaleString("ru-RU"),
          logist,
          documentName,
          details,
          action
      });
  };

  // Get active return/China items lists
  const getReturnItems = () => Object.values(dozvolsData)
    .filter((i: any) => i.status === 'office_return' || (showArchiveReturns && i.status === 'used'))
    .sort((a: any, b: any) => (b.issueDate || '').localeCompare(a.issueDate || ''));
  
  const getChinaCopyItems = () => Object.values(dozvolsData)
    .filter((i: any) => (i.type === 'CHN 2' || i.type === 'CHN 3') && i.isCopy === true && (i.status !== 'used' || showArchiveChina) && i.status !== 'expired')
    .sort((a: any, b: any) => (b.copySubmittedAt || '').localeCompare(a.copySubmittedAt || ''));

  // Pre-select items as they load from Firebase
  useEffect(() => {
    const keys = Object.keys(todoTasks);
    setSelectedPermitTasks(prev => {
      const next = { ...prev };
      keys.forEach(k => {
        if (next[k] === undefined) next[k] = true;
      });
      return next;
    });
  }, [todoTasks]);

  useEffect(() => {
    const items = getReturnItems();
    setSelectedReturnItems(prev => {
      const next = { ...prev };
      items.forEach((item: any) => {
        if (next[item.id] === undefined) next[item.id] = item.status === 'office_return';
      });
      return next;
    });
  }, [dozvolsData, showArchiveReturns]);

  useEffect(() => {
    const items = getChinaCopyItems();
    setSelectedChinaItems(prev => {
      const next = { ...prev };
      items.forEach((item: any) => {
        if (next[item.id] === undefined) {
          next[item.id] = item.status !== 'used' && !item.chinaCopySubmitted;
        }
      });
      return next;
    });
  }, [dozvolsData, showArchiveChina]);

  // Initial rows construction
  useEffect(() => {
    if (Object.keys(todoTasks).length > 0 && permitRows.length === 0) {
      rebuildPermitRows();
    }
  }, [todoTasks]);

  useEffect(() => {
    const returnItems = getReturnItems();
    if (returnItems.length > 0 && returnRows.length === 0) {
      rebuildReturnRows();
    }
  }, [dozvolsData]);

  useEffect(() => {
    const chinaItems = getChinaCopyItems();
    if (chinaItems.length > 0 && chinaRows.length === 0) {
      rebuildChinaRows();
    }
  }, [dozvolsData]);

  // Rebuild handlers
  const rebuildPermitRows = () => {
    const totals: Record<string, number> = {};
    Object.values(todoTasks)
      .filter((task: any) => !task.done && Array.isArray(task.items) && selectedPermitTasks[task.id])
      .forEach((task: any) => {
        task.items.forEach((item: any) => {
          const typeName = item.type || '';
          const qty = parseInt(item.qty) || 0;
          if (!typeName || qty <= 0) return;
          if (!totals[typeName]) totals[typeName] = 0;
          totals[typeName] += qty;
        });
      });

    const newRows = Object.entries(totals).map(([typeName, qty]) => {
      const map = getPermitPrintMapping(typeName);
      return {
        country: map.country || typeName,
        category: map.category || '',
        year: map.year || new Date().getFullYear(),
        qty
      };
    });
    setPermitRows(newRows);
  };

  const rebuildReturnRows = () => {
    const checkedItems = getReturnItems().filter((item: any) => selectedReturnItems[item.id]);
    if (checkedItems.length > 0 && useFirebase) {
      update(ref(database), {
        lastAssembledStatementPermitsV1: {
          itemIds: checkedItems.map((i: any) => i.id),
          timestamp: new Date().toLocaleString("ru-RU")
        }
      });
    }

    const grouped: Record<string, any> = {};
    checkedItems.forEach((item: any) => {
      const map = getPermitPrintMapping(item.type);
      const key = `${map.country || item.type}|${map.category || ''}|${map.year || new Date().getFullYear()}`;
      if (!grouped[key]) {
        grouped[key] = {
          country: map.country || item.type,
          category: map.category || '',
          year: map.year || new Date().getFullYear(),
          numbers: []
        };
      }
      grouped[key].numbers.push(item.number);
    });

    const newRows = Object.values(grouped).map((r: any) => ({
      country: r.country,
      category: r.category,
      year: r.year,
      qty: r.numbers.length,
      numbers: r.numbers.join(', ')
    }));
    setReturnRows(newRows);
  };

  const loadLastAssembledStatement = () => {
    if (!lastAssembledStatement || !lastAssembledStatement.itemIds || !lastAssembledStatement.itemIds.length) {
      alert("Предыдущих заявлений не найдено.");
      return;
    }
    
    // Enable archive view to make sure used items are included in selection list
    setShowArchiveReturns(true);
    
    // Update selection state
    setSelectedReturnItems(prev => {
      const next = { ...prev };
      lastAssembledStatement.itemIds.forEach((id: string) => {
        next[id] = true;
      });
      return next;
    });
    
    // Build rows directly using the loaded itemIds from database
    const allItems = Object.values(dozvolsData);
    const targetItems = allItems.filter((i: any) => lastAssembledStatement.itemIds.includes(i.id));
    
    const grouped: Record<string, any> = {};
    targetItems.forEach((item: any) => {
      const map = getPermitPrintMapping(item.type);
      const key = `${map.country || item.type}|${map.category || ''}|${map.year || new Date().getFullYear()}`;
      if (!grouped[key]) {
        grouped[key] = {
          country: map.country || item.type,
          category: map.category || '',
          year: map.year || new Date().getFullYear(),
          numbers: []
        };
      }
      grouped[key].numbers.push(item.number);
    });

    const newRows = Object.values(grouped).map((r: any) => ({
      country: r.country,
      category: r.category,
      year: r.year,
      qty: r.numbers.length,
      numbers: r.numbers.join(', ')
    }));
    setReturnRows(newRows);
    alert(`Успешно восстановлено последнее заявление: ${targetItems.length} бланков. Нажмите "Печать" или "Списать".`);
  };

  const rebuildChinaRows = () => {
    const checkedItems = getChinaCopyItems().filter((item: any) => selectedChinaItems[item.id]);
    const numbers = checkedItems.map((i: any) => String(i.number).padStart(7, '0'));
    if (numbers.length > 0) {
      setChinaRows([{
        country: 'Китай',
        numbers: numbers.join(', ')
      }]);
    } else {
      setChinaRows([]);
    }
  };

  // Inline edit state update helpers
  const updatePermitRow = (index: number, field: string, value: any) => {
    const next = [...permitRows];
    next[index] = { ...next[index], [field]: value };
    setPermitRows(next);
  };
  const addPermitRow = () => {
    setPermitRows(prev => [...prev, { country: '', category: '', year: new Date().getFullYear(), qty: 1 }]);
  };
  const deletePermitRow = (index: number) => {
    setPermitRows(prev => prev.filter((_, i) => i !== index));
  };

  const updateReturnRow = (index: number, field: string, value: any) => {
    const next = [...returnRows];
    next[index] = { ...next[index], [field]: value };
    setReturnRows(next);
  };
  const addReturnRow = () => {
    setReturnRows(prev => [...prev, { country: '', category: '', year: new Date().getFullYear(), numbers: '', qty: 1 }]);
  };
  const deleteReturnRow = (index: number) => {
    setReturnRows(prev => prev.filter((_, i) => i !== index));
  };

  const updateChinaRow = (index: number, field: string, value: any) => {
    const next = [...chinaRows];
    next[index] = { ...next[index], [field]: value };
    setChinaRows(next);
  };
  const addChinaRow = () => {
    setChinaRows(prev => [...prev, { country: 'Китай', numbers: '' }]);
  };
  const deleteChinaRow = (index: number) => {
    setChinaRows(prev => prev.filter((_, i) => i !== index));
  };

  // Selection toggle utilities
  const setAllPermitsChecked = (checked: boolean) => {
    const keys = Object.keys(todoTasks);
    const next: Record<string, boolean> = {};
    keys.forEach(k => { next[k] = checked; });
    setSelectedPermitTasks(next);
  };

  const setAllReturnsChecked = (checked: boolean) => {
    const items = getReturnItems();
    const next: Record<string, boolean> = {};
    items.forEach((item: any) => { next[item.id] = checked; });
    setSelectedReturnItems(next);
  };

  const setAllChinaChecked = (checked: boolean) => {
    const items = getChinaCopyItems();
    const next: Record<string, boolean> = {};
    items.forEach((item: any) => { next[item.id] = checked; });
    setSelectedChinaItems(next);
  };

  // Submit collected return items to Transport Inspection
  const markCheckedOfficeReturnsAsUsed = () => {
    const checkedItems = getReturnItems().filter((item: any) => selectedReturnItems[item.id]);
    if (!checkedItems.length) {
      alert("Пожалуйста, сначала выберите хотя бы один бланк из списка возвращаемых.");
      return;
    }
    if (!confirm(`Вы действительно хотите перевести выбранные бланки в статус “Сдан в транспортную инспекцию”? Всего к списанию: ${checkedItems.length} шт.`)) {
      return;
    }

    if (useFirebase) {
      const updates: Record<string, any> = {};
      checkedItems.forEach((item: any) => {
        updates[`dozvolsRegistryV4/${item.id}/status`] = 'used';
        updates[`dozvolsRegistryV4/${item.id}/car`] = '';
        
        // Log individual item sписать action
        const logist = localStorage.getItem('ratipa_auth_user') || user?.name || "Система";
        const logRef = push(ref(database, 'dozvolsHistoryV4'));
        updates[`dozvolsHistoryV4/${logRef.key}`] = {
          time: new Date().toLocaleString("ru-RU"),
          logist,
          doc: `${item.type} №${item.number}`,
          action: "Изменен статус",
          meta: `Статус: [Сдан в офис] ➔ [Сдан в транспортную инспекцию]`
        };
      });

      update(ref(database), updates);
      logDocumentHistory('Реестр сдачи использованных разрешений', `Сданы в инспекцию: ${checkedItems.length} бланков`, 'Сданы в ТИ');
      alert(`Успешно переведено бланков в статус "Сданы в ТИ" (Архив): ${checkedItems.length} шт.`);
      setReturnRows([]);
    }
  };

  // Document content assembly based on editable row states
  const buildPermitApplicationHtml = () => {
    const bodyRows = permitRows.map((row: any) => `
        <tr>
            <td>${safeText(row.country)}</td>
            <td>${safeText(row.category)}</td>
            <td style="text-align:center;">${safeText(row.year)}</td>
            <td style="text-align:center;">${safeText(row.qty)}</td>
        </tr>
    `).join('');
    
    return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
    @page { size: A4; margin: 16mm 18mm; }
    body { font-family: "Times New Roman", serif; font-size: 12pt; color: #000; line-height: 1.14; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
    .header-table td { vertical-align: top; text-align: center; }
    .brand { font-size: 16pt; font-weight: bold; letter-spacing: 5px; margin-bottom: 14px; }
    .small { font-size: 10pt; }
    .contacts { margin-top: 8px; line-height: 1.28; }
    .line { border-top: 1px solid #000; margin: 10px 0 16px; }
    h1 { text-align: center; font-size: 14pt; margin: 12px 0 2px; letter-spacing: 2px; font-weight: bold; }
    h2 { text-align: center; font-size: 12pt; margin: 0 0 12px; font-weight: normal; }
    .center { text-align: center; }
    .statement { margin: 10px 0; }
    .permit-table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    .permit-table th, .permit-table td { border: 1px solid #000; padding: 6px 8px; vertical-align: middle; height: 26px; }
    .permit-table th { text-align: center; font-weight: bold; }
    .signature { width: 100%; margin-top: 28px; border-collapse: collapse; }
    .signature td { padding: 4px 0; vertical-align: bottom; }
    .footer { margin-top: 18px; }
</style>
</head>
<body>
    <table class="header-table">
        <tr>
            <td style="width:44%;">
                <div class="brand">РАТЫПА</div>
                <div>таварыства з абмежаванай</div>
                <div>адказнасцю</div>
            </td>
            <td style="width:12%;"></td>
            <td style="width:44%;">
                <div class="brand">РАТИПА</div>
                <div>общество с ограниченной</div>
                <div>ответственностью</div>
            </td>
        </tr>
    </table>
    <div class="contacts">
        Республика Беларусь, г.Минск, ул.Таежная 39-2.<br>
        Тел. (017) 338-11-03, 338-13-80; факс (017) 338-10-79.<br>
        ОАО “Приорбанк”, г. Минск<br>
        IBAN BY87PJCB30120030121000000933<br>
        SWIFT PJCBBY2X<br>
        УНН 100492419 ОКПО 14612221
    </div>
    <div class="line"></div>
    <h1>ЗАЯВЛЕНИЕ</h1>
    <h2>о выдаче разрешений</h2>
    <div class="center">ООО «РАТИПА» УНН100492419</div>
    <div class="center small">(наименование перевозчика, УНП)</div>
    <p class="center">Дата подачи заявления ${formatApplicationDate(applicationDate)} г.</p>
    <p class="statement">Прошу выдать разрешения на проезд транспортных средств, зарегистрированных в Республике Беларусь, по территории иностранного государства в следующем количестве:</p>
    <table class="permit-table">
        <thead>
            <tr>
                <th>Наименование<br>государства</th>
                <th>Вид (категория)<br>разрешения</th>
                <th>Год<br>бланка</th>
                <th>Количество,<br>шт.</th>
            </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
    </table>
    <table class="signature">
        <tr>
            <td style="width:34%;">Директор</td>
            <td style="width:33%; border-bottom:1px solid #000;"></td>
            <td style="width:33%; text-align:center;">В. В. Бориско</td>
        </tr>
        <tr class="small">
            <td>(должность руководителя или представителя<br>автомобильного перевозчика, действующего<br>на основании доверенности)</td>
            <td class="center">(подпись)</td>
            <td class="center">(инициалы, фамилия)</td>
        </tr>
    </table>
    <div class="footer">Исполнитель ______________________________ +375-17-338-10-86</div>
    <div class="small">(инициалы, фамилия) (тел. в полном формате)</div>
    <p>Электронная почта ratipa@ratipa.by</p>
</body>
</html>`;
  };

  const buildReturnRegistryHtml = () => {
    const total = returnRows.reduce((sum: number, r: any) => sum + (parseInt(r.qty) || 0), 0);
    const bodyRows = returnRows.map((r: any) => `<tr><td>${safeText(r.country)}</td><td>${safeText(r.category)}</td><td>${safeText(r.year)}</td><td>${safeText(r.numbers)}</td><td>${safeText(r.qty)}</td></tr>`).join('');
    
    return `<!doctype html><html><head><meta charset="utf-8"><title>Реестр возврата разрешений</title><style>
        @page { size: A4; margin: 14mm 13mm; } body { font-family:"Times New Roman",serif; color:#000; font-size:12pt; line-height:1.15; }
        h1 { text-align:center; font-size:16pt; margin:0 0 2px; letter-spacing:1px; } .center{text-align:center;} .meta{margin:14px 0;}
        table{width:100%;border-collapse:collapse;} th,td{border:1px solid #000;padding:6px 7px;vertical-align:middle;} th{text-align:center;font-weight:bold;} td:last-child{text-align:center;width:54px;}
        .sign-table td{height:26px;text-align:left!important;vertical-align:top;border:none!important;padding-top:14px;}
        .executor-gap{display:inline-block;width:360px;}
    </style></head><body>
        <h1>РЕЕСТР</h1>
        <div class="center">возврата перевозчиком использованных разрешений<br>на проезд автотранспортных средств<br>по территориям иностранных государств</div>
        <div class="meta">Дата возврата ${formatApplicationDate(applicationDate)} &nbsp;&nbsp; Место возврата г.Минск</div>
        <div class="meta">Наименование перевозчика ООО «РАТИПА»</div>
        <table><thead><tr><th>Наименование государства</th><th>Вид бланков</th><th>Год бланков</th><th>Номера бланков</th><th>Всего, шт.</th></tr></thead><tbody>${bodyRows}<tr><td><strong>Итого</strong></td><td></td><td></td><td></td><td><strong>${total}</strong></td></tr><tr class="sign-table"><td colspan="5">Исполнитель<span class="executor-gap"></span>В. В. Бориско<br><br>Лицо, возвращающее разрешения:<br><br>Уполномоченный сотрудник<br>Транспортной инспекции, принявший к возврату разрешения: (подпись, номерная печать)</td></tr></tbody></table>
    </body></html>`;
  };

  const buildChinaCopyHtml = () => {
    const bodyRows = chinaRows.map((r: any) => `<tr><td>${safeText(r.country || 'Китай')}</td><td>${safeText(r.numbers)}</td></tr>`).join('');
    
    return `<!doctype html><html><head><meta charset="utf-8"><title>Заявление на китайские разрешения</title><style>
        @page{size:A4;margin:16mm 18mm;} body{font-family:"Times New Roman",serif;color:#000;font-size:12pt;line-height:1.16;} table{width:100%;border-collapse:collapse;} td,th{border:1px solid #000;padding:7px;vertical-align:middle;} .head td{border:1px solid #000;text-align:center;height:55px;} .brand{font-size:16pt;font-weight:bold;letter-spacing:5px;} .line{border-top:1px solid #000;margin:12px 0;} h1{text-align:center;font-size:16pt;margin:16px 0;} .right{text-align:right;} .addr{margin:14px 0 18px 52%;} .signature-gap{display:inline-block;width:300px;}
    </style></head><body>
        <table class="head"><tr><td><div class="brand">РАТЫПА</div><div>таварыства з абмежаванай<br>адказнасцю</div></td><td style="width:12%;"></td><td><div class="brand">РАТИПА</div><div>общество с ограниченной<br>ответственностью</div></td></tr></table>
        <p>Республика Беларусь, г.Минск, ул.Таежная 39-2.</p><p>Тел. (017) 338-11-03, 338-13-80; факс (017) 338-10-79.</p><p>ОАО “Приорбанк”, г. Минск<br>IBAN BY87PJCB30120030121000000933<br>SWIFT PJCBBY2X<br>УНН 100492419 ОКПО 14612221</p>
        <div class="line"></div>
        <div class="addr">Управление разрешительной системы филиала Transportной инспекции по г.Минску и Минской области<br><br>Пр-т Партизанский, 6, каб. 204, г.Минск<br><br>ООО РАТИПА<br>УНП 100492419</div>
        <h1>Заявление</h1><p>Прошу принять копии использованных разрешений:</p>
        <table><thead><tr><th style="width:28%;">Страна</th><th>Номера разрешений</th></tr></thead><tbody>${bodyRows}</tbody></table>
        <p>Оригиналы обязуемся предоставить в течение 30 календарных дней с даты предоставления копии разрешения в Транспортную инспекцию</p>
        <p>${formatApplicationDate(applicationDate)}<span class="signature-gap"></span>Бориско В.В.</p>
    </body></html>`;
  };

  const getHtmlContent = () => {
    if (docType === "Заявление на получение разрешений") return buildPermitApplicationHtml();
    if (docType === "Заявление по китайским копиям") return buildChinaCopyHtml();
    if (docType === "Реестр возврата разрешений") return buildReturnRegistryHtml();
    return "";
  };

  const buildPermitApplicationDocxBlob = async () => {
    const rows = permitRows;
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const zip = await JSZip.loadAsync(base64ToUint8Array(PERMIT_APPLICATION_TEMPLATE_BASE64));
    const xmlText = await zip.file('word/document.xml')!.async('string');
    const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');

    const textNodes = [...xmlDoc.getElementsByTagNameNS(ns, 't')];
    const dateText = formatApplicationDate(applicationDate);
    const dateAnchor = textNodes.findIndex(t => t.textContent === 'заявления');
    if (dateAnchor >= 0) {
        let placed = false;
        for (let i = dateAnchor + 1; i < textNodes.length; i++) {
            if (textNodes[i].textContent === 'г.') break;
            if (!placed && textNodes[i].textContent?.trim()) {
                textNodes[i].textContent = dateText;
                placed = true;
            } else if (placed) {
                textNodes[i].textContent = '';
            }
        }
    }

    const tables = [...xmlDoc.getElementsByTagNameNS(ns, 'tbl')];
    const permitTable = tables.find(tbl => tbl.textContent?.includes('Наименование') && tbl.textContent?.includes('государства') && tbl.textContent?.includes('Количество'));
    if (permitTable) {
        const tableRows = [...permitTable.getElementsByTagNameNS(ns, 'tr')];
        const templateRow = (tableRows[1] || tableRows[0]).cloneNode(true) as Element;
        tableRows.slice(1).forEach(row => row.parentNode?.removeChild(row));
        rows.forEach(row => {
            const tr = templateRow.cloneNode(true) as Element;
            const cells = [...tr.getElementsByTagNameNS(ns, 'tc')];
            setWordCellText(cells[0], row.country);
            setWordCellText(cells[1], row.category);
            setWordCellText(cells[2], row.year);
            setWordCellText(cells[3], row.qty);
            permitTable.appendChild(tr);
        });
    }

    [...xmlDoc.getElementsByTagNameNS(ns, 'p')].forEach(p => {
        const text = p.textContent?.replace(/\s+/g, ' ').trim() || '';
        if (/^110\s+10$/.test(text) || text === '1' || text === '2' || text === '11' || text === '5') {
            p.parentNode?.removeChild(p);
        }
    });

    const allDocTextNodes = [...xmlDoc.getElementsByTagNameNS(ns, 't')];
    const phoneIndex = allDocTextNodes.findIndex(t => t.textContent?.includes('+375-17-338-10-86'));
    if (phoneIndex >= 0) {
        for (let i = Math.max(0, phoneIndex - 8); i < phoneIndex; i++) {
            if (/^_+$/.test(allDocTextNodes[i].textContent || '')) allDocTextNodes[i].textContent = '';
        }
        const spacerNode = allDocTextNodes[phoneIndex - 2] || allDocTextNodes[phoneIndex - 1];
        if (spacerNode) spacerNode.textContent = '______________________________';
    }

    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
    return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  };

  const buildReturnRegistryDocxBlob = async () => {
    const rows = returnRows;
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const zip = await JSZip.loadAsync(base64ToUint8Array(RETURN_REGISTRY_TEMPLATE_BASE64));
    const xmlText = await zip.file('word/document.xml')!.async('string');
    const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');

    const dateText = formatApplicationDate(applicationDate);
    const dateNode = [...xmlDoc.getElementsByTagNameNS(ns, 't')].find(t => /«25» мая 2026 г\./.test(t.textContent || ''));
    if (dateNode) {
        dateNode.textContent = `${dateText}`;
    }

    const table = findWordTable(xmlDoc, ns, ['Наименование', 'Номера бланков', 'Итого', 'Исполнитель']);
    if (table) {
        const originalRows = getWordChildRows(table, ns);
        const dataTemplate = originalRows[1].cloneNode(true) as Element;
        const totalTemplate = originalRows.find(r => r.textContent?.includes('Итого'))?.cloneNode(true) as Element || originalRows[1].cloneNode(true) as Element;
        const signatureRow = originalRows.find(r => r.textContent?.includes('Исполнитель'))?.cloneNode(true) as Element;
        originalRows.slice(1).forEach(row => row.parentNode?.removeChild(row));

        rows.forEach(row => {
            const tr = dataTemplate.cloneNode(true) as Element;
            const cells = [...tr.getElementsByTagNameNS(ns, 'tc')];
            setWordCellText(cells[0], row.country);
            setWordCellText(cells[1], row.category);
            setWordCellText(cells[2], row.year);
            setWordCellText(cells[3], row.numbers);
            setWordCellText(cells[4], row.qty);
            table.appendChild(tr);
        });

        const total = rows.reduce((sum, row) => sum + (parseInt(row.qty) || 0), 0);
        const totalRow = totalTemplate.cloneNode(true) as Element;
        const totalCells = [...totalRow.getElementsByTagNameNS(ns, 'tc')];
        setWordCellText(totalCells[0], 'Итого');
        for (let i = 1; i < totalCells.length - 1; i++) setWordCellText(totalCells[i], '');
        setWordCellText(totalCells[totalCells.length - 1], total);
        table.appendChild(totalRow);
        if (signatureRow) {
            const signatureCells = [...signatureRow.getElementsByTagNameNS(ns, 'tc')];
            signatureCells.forEach(cell => removeWordCellBorders(cell, ns));
            setFirstWordText(signatureRow, 'Исполнитель                                                                                                  В. В. Бориско', ns);
            table.appendChild(signatureRow);
        }
    }

    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
    return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  };

  const buildChinaCopyApplicationDocxBlob = async () => {
    const rows = chinaRows;
    const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
    const zip = await JSZip.loadAsync(base64ToUint8Array(CHINA_COPY_TEMPLATE_BASE64));
    const xmlText = await zip.file('word/document.xml')!.async('string');
    const xmlDoc = new DOMParser().parseFromString(xmlText, 'application/xml');

    const table = findWordTable(xmlDoc, ns, ['Страна', 'Номера разрешений']);
    if (table) {
        const originalRows = getWordChildRows(table, ns);
        const dataTemplate = (originalRows[2] || originalRows[1]).cloneNode(true) as Element;
        originalRows.slice(1).forEach(row => row.parentNode?.removeChild(row));
        rows.forEach(row => {
            const tr = dataTemplate.cloneNode(true) as Element;
            const cells = [...tr.getElementsByTagNameNS(ns, 'tc')];
            setWordCellText(cells[0], row.country || 'Китай');
            setWordCellText(cells[1], row.numbers);
            table.appendChild(tr);
        });
    }

    const dateText = formatApplicationDate(applicationDate);
    const paragraphs = [...xmlDoc.getElementsByTagNameNS(ns, 'p')];
    const signatureParagraph = paragraphs.find(p => p.textContent?.includes('Бориско В.В'));
    if (signatureParagraph) {
        const textNodes = [...signatureParagraph.getElementsByTagNameNS(ns, 't')];
        if (textNodes.length) {
            textNodes[0].textContent = `${dateText}                                      Бориско В.В.`;
            textNodes[0].setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
            textNodes.slice(1).forEach(t => t.textContent = '');
        }
    }

    zip.file('word/document.xml', new XMLSerializer().serializeToString(xmlDoc));
    return await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  };

  const generateDocx = async () => {
    try {
        if (docType === "Заявление на получение разрешений" && permitRows.length === 0) {
            return alert("Нет строк заявления для генерации.");
        }
        if (docType === "Заявление по китайским копиям" && chinaRows.length === 0) {
            return alert("Нет строк заявления по копиям.");
        }
        if (docType === "Реестр возврата разрешений" && returnRows.length === 0) {
            return alert("Нет строк реестра возврата.");
        }

        const timestamp = formatApplicationDate(applicationDate).replace(/\./g, '-');
        
        if (docType === "Заявление об утере") {
            const a = document.createElement("a");
            a.href = "/loss_declaration.html";
            a.download = `Заявление_об_утере_${timestamp}.html`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            logDocumentHistory(docType, 'Скачан как HTML (' + a.download + ')', 'HTML');
            return;
        }

        let blob: Blob;
        let filename = "Document";

        if (docType === "Заявление на получение разрешений") {
          blob = await buildPermitApplicationDocxBlob();
          filename = `Заявление_дозвола_${timestamp}.docx`;
        } else if (docType === "Заявление по китайским копиям") {
          blob = await buildChinaCopyApplicationDocxBlob();
          filename = `Заявление_Китай_копии_${timestamp}.docx`;
          
          if (useFirebase) {
            const checkedItems = getChinaCopyItems().filter((item: any) => selectedChinaItems[item.id]);
            if (checkedItems.length > 0) {
              const updates: Record<string, any> = {};
              const logist = localStorage.getItem('ratipa_auth_user') || user?.name || "Система";
              checkedItems.forEach((item: any) => {
                updates[`dozvolsRegistryV4/${item.id}/chinaCopySubmitted`] = true;
                
                const logRef = push(ref(database, 'dozvolsHistoryV4'));
                updates[`dozvolsHistoryV4/${logRef.key}`] = {
                  time: new Date().toLocaleString("ru-RU"),
                  logist,
                  doc: `${item.type} №${item.number}`,
                  action: "Подача китайской копии",
                  meta: `Копия помечена как поданная (Скачивание Word)`
                };
              });
              update(ref(database), updates);
            }
          }
        } else if (docType === "Реестр возврата разрешений") {
          blob = await buildReturnRegistryDocxBlob();
          filename = `Реестр_сдачи_дозволов_${timestamp}.docx`;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
        
        logDocumentHistory(docType, 'Скачан как Word (' + filename + ')', 'DOCX');
    } catch (e) {
      console.error(e);
      alert("Ошибка при генерации по шаблону. Скачивание .doc резервной копии...");
      try {
        const html = getHtmlContent();
        const blob = new Blob(['\ufeff', html], { type: 'application/msword;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const timestamp = formatApplicationDate(applicationDate).replace(/\./g, '-');
        let filename = `Document_${timestamp}.doc`;
        if (docType === "Заявление на получение разрешений") filename = `Заявление_дозвола_${timestamp}.doc`;
        if (docType === "Заявление по китайским копиям") filename = `Заявление_Китай_копии_${timestamp}.doc`;
        if (docType === "Реестр возврата разрешений") filename = `Реестр_сдачи_дозволов_${timestamp}.doc`;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        URL.revokeObjectURL(url);
        a.remove();
        logDocumentHistory(docType, 'Скачан резервный .doc (' + filename + ')', 'DOC');
      } catch (e2) {
        console.error(e2);
      }
    }
  };

  const handlePrintHTML = () => {
      try {
        if (docType === "Заявление на получение разрешений" && permitRows.length === 0) {
            return alert("Нет строк заявления для печати.");
        }
        if (docType === "Заявление по китайским копиям" && chinaRows.length === 0) {
            return alert("Нет строк заявления по копиям.");
        }
        if (docType === "Реестр возврата разрешений" && returnRows.length === 0) {
            return alert("Нет строк реестра возврата.");
        }
        
        if (docType === "Заявление об утере") {
            const printWindow = window.open("/loss_declaration.html", "_blank");
            if (printWindow) {
                printWindow.focus();
                printWindow.onload = () => {
                    setTimeout(() => printWindow.print(), 500);
                };
                logDocumentHistory(docType, 'Отправлен на печать', 'Печать');
            }
            return;
        }

        // Loss declaration has no rows to validate

        const printWindow = window.open("", "_blank");
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(getHtmlContent());
            printWindow.document.close();
            printWindow.focus();
            setTimeout(() => {
                printWindow.print();
            }, 300);
            logDocumentHistory(docType, 'Отправлен на печать', 'Печать');
            
            if (docType === "Заявление по китайским копиям" && useFirebase) {
              const checkedItems = getChinaCopyItems().filter((item: any) => selectedChinaItems[item.id]);
              if (checkedItems.length > 0) {
                const updates: Record<string, any> = {};
                const logist = localStorage.getItem('ratipa_auth_user') || user?.name || "Система";
                checkedItems.forEach((item: any) => {
                  updates[`dozvolsRegistryV4/${item.id}/chinaCopySubmitted`] = true;
                  
                  const logRef = push(ref(database, 'dozvolsHistoryV4'));
                  updates[`dozvolsHistoryV4/${logRef.key}`] = {
                    time: new Date().toLocaleString("ru-RU"),
                    logist,
                    doc: `${item.type} №${item.number}`,
                    action: "Подача китайской копии",
                    meta: `Копия помечена как поданная (Печать)`
                  };
                });
                update(ref(database), updates);
              }
            }
        }
      } catch (e) {
        alert("Ошибка при печати.");
      }
  };

  const markSelectedChinaCopiesAsSubmitted = (submitted: boolean) => {
    const checkedItems = getChinaCopyItems().filter((item: any) => selectedChinaItems[item.id]);
    if (!checkedItems.length) {
      alert("Сначала выберите хотя бы один бланк из списка китайских копий.");
      return;
    }
    const msg = submitted 
      ? `Пометить выбранные копии (${checkedItems.length} шт.) как поданные/сданные в инспекцию?\nОни больше не будут отмечаться галочками по умолчанию.`
      : `Сбросить отметку о сдаче копий для выбранных файлов (${checkedItems.length} шт.)?`;
    if (!confirm(msg)) return;

    if (useFirebase) {
      const updates: Record<string, any> = {};
      const logist = localStorage.getItem('ratipa_auth_user') || user?.name || "Система";
      checkedItems.forEach((item: any) => {
        updates[`dozvolsRegistryV4/${item.id}/chinaCopySubmitted`] = submitted;
        
        const logRef = push(ref(database, 'dozvolsHistoryV4'));
        updates[`dozvolsHistoryV4/${logRef.key}`] = {
          time: new Date().toLocaleString("ru-RU"),
          logist,
          doc: `${item.type} №${item.number}`,
          action: "Изменена отметка китайской копии",
          meta: `Китайская копия сдана: [${submitted ? 'Да' : 'Нет'}]`
        };
      });
      update(ref(database), updates);
      alert("Статусы успешно обновлены!");
    }
  };

  const activeTasks = Object.values(todoTasks).filter((task: any) => !task.done && Array.isArray(task.items));
  const activeReturns = getReturnItems();
  const activeChinaCopies = getChinaCopyItems();

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden">
        <div className="p-5 bg-slate-50 border-b border-slate-200/55">
          <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight">
            Генератор документов бланков
          </h2>
        </div>

        <div className="p-6 md:p-8 flex flex-col lg:flex-row gap-8">
          <div className="w-full lg:w-1/2 space-y-5">
            <div>
              <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono">
                Тип документа
              </label>
              <select
                value={docType}
                onChange={(e) => setDocType(e.target.value)}
                className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
              >
                <option value="Заявление на получение разрешений">
                  Заявление на выдачу разрешений
                </option>
                <option value="Реестр возврата разрешений">
                  Реестр возврата разрешений
                </option>
                <option value="Заявление по китайским копиям">
                  Заявление на китайские разрешения
                </option>
                <option value="Заявление об утере">
                  Заявление об утере (Loss declaration)
                </option>

              </select>
            </div>

            <div>
                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block font-mono mb-1.5">
                    Дата заявления / документа
                </label>
                <input 
                    type="date"
                    className="block w-full mt-1.5 px-3 py-2.5 bg-slate-50 border border-slate-100 rounded-xl text-xs font-black text-slate-800 focus:outline-none focus:bg-white focus:border-slate-300 transition"
                    value={applicationDate}
                    onChange={e => setApplicationDate(e.target.value)}
                />
            </div>

            <div className="bg-slate-50 p-4 rounded-xl border border-slate-200/50">
                <p className="text-xs text-slate-500 font-medium leading-relaxed">
                    {docType === "Заявление на получение разрешений" && "Документ формируется на основе активных заявок блока Планерки."}
                    {docType === "Реестр возврата разрешений" && "В реестр возвращаемых бланков попадают бланки со статусом 'Сдан в офис'."}
                    {docType === "Заявление по китайским копиям" && "Собирается из китайских дозволов (СHN 2, CHN 3) со сданной копией."}
                    {docType === "Заявление об утере" && "Стандартный бланк заявления об утере разрешений. Выводится статичный шаблон для печати или скачивания."}

                </p>
            </div>
          </div>

          <div className="w-full lg:w-1/2 rounded-2xl bg-slate-900 border border-slate-800 p-6 flex flex-col justify-center items-center text-center space-y-6">
            <div className="bg-slate-800 p-4 rounded-full">
              <FileText className="h-8 w-8 text-[#70FC8E]" />
            </div>
            <div>
              <h3 className="text-white font-black text-lg uppercase tracking-tight">
                Подготовка завершена
              </h3>
              <p className="text-slate-400 text-xs font-medium max-w-sm mt-1 mx-auto leading-relaxed">
                Вы можете сформировать файл Microsoft Word формата .doc для
                дальнейшего редактирования, или сразу вывести печатную версию в
                браузере.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 w-full max-w-xs mx-auto">
              <button
                onClick={handlePrintHTML}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 hover:bg-slate-700 text-white font-black rounded-xl text-xs uppercase tracking-tight transition cursor-pointer border border-slate-700"
              >
                <Printer className="h-4 w-4 text-slate-300" />
                Печать
              </button>
              <button
                onClick={generateDocx}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#70FC8E] hover:bg-[#60deb8] text-slate-950 font-black rounded-xl text-xs uppercase tracking-tight transition cursor-pointer"
              >
                <Download className="h-4 w-4" />
                WORD (DOC)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Dynamic item selectors and editable lists */}
      {docType === "Заявление на получение разрешений" && (
        <div className="bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] p-6 space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-black text-slate-900 uppercase">1. Выбор активных заявок планерки</h3>
            <div className="flex gap-2">
              <button onClick={() => setAllPermitsChecked(true)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase rounded-lg">Выбрать все</button>
              <button onClick={() => setAllPermitsChecked(false)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase rounded-lg">Снять все</button>
              <button onClick={rebuildPermitRows} className="px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-black uppercase rounded-lg">Собрать по выбранным</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-3 bg-slate-50 border border-slate-200/50 rounded-2xl">
              {activeTasks.map((task: any) => (
                <label key={task.id} className="flex items-start gap-3 p-3 bg-white border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-50/50 transition">
                  <input 
                    type="checkbox" 
                    className="mt-1 accent-emerald-500" 
                    checked={!!selectedPermitTasks[task.id]}
                    onChange={(e) => setSelectedPermitTasks(prev => ({ ...prev, [task.id]: e.target.checked }))}
                  />
                  <div>
                    <span className="font-black text-slate-900 text-xs">{task.car}</span>
                    <span className="block text-[10px] text-slate-500 font-bold">
                      {task.items.map((i: any) => `${i.type} × ${i.qty}`).join(', ')} · {task.createdAt}
                    </span>
                  </div>
                </label>
              ))}
              {!activeTasks.length && <div className="col-span-2 text-center text-slate-400 font-bold text-xs py-6">В планерке нет активных заявок</div>}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-black text-slate-900 uppercase">2. Содержимое заявления (Редактируемые строки)</h3>
              <button onClick={addPermitRow} className="flex items-center gap-1 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight">+ Добавить строку</button>
            </div>

            <div className="table-responsive select-none overflow-x-auto custom-scrollbar">
              <table className="main-table w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-150 text-[10px] font-black uppercase text-slate-400">
                    <th className="p-3">Государство</th>
                    <th className="p-3">Вид (категория) разрешения</th>
                    <th className="p-3 w-28 text-center">Год бланка</th>
                    <th className="p-3 w-28 text-center">Количество, шт.</th>
                    <th className="p-3 w-16 text-center">Убрать</th>
                  </tr>
                </thead>
                <tbody>
                  {permitRows.map((row, index) => (
                    <tr key={index} className="hover:bg-slate-50/50">
                      <td className="p-2"><input className="input-flat font-bold text-slate-800" value={row.country} onChange={e => updatePermitRow(index, 'country', e.target.value)} /></td>
                      <td className="p-2"><input className="input-flat font-bold text-slate-800" value={row.category} onChange={e => updatePermitRow(index, 'category', e.target.value)} /></td>
                      <td className="p-2 text-center"><input type="number" className="input-flat text-center font-bold text-slate-800" value={row.year} onChange={e => updatePermitRow(index, 'year', e.target.value)} /></td>
                      <td className="p-2 text-center"><input type="number" min="1" className="input-flat text-center font-bold text-slate-800" value={row.qty} onChange={e => updatePermitRow(index, 'qty', e.target.value)} /></td>
                      <td className="p-2 text-center">
                        <button onClick={() => deletePermitRow(index)} className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 transition flex items-center justify-center mx-auto cursor-pointer">✕</button>
                      </td>
                    </tr>
                  ))}
                  {!permitRows.length && (
                    <tr>
                      <td colSpan={5} className="text-center p-8 text-slate-400 font-bold uppercase">Список строк заявления пуст</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {docType === "Реестр возврата разрешений" && (
        <div className="bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] p-6 space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-black text-slate-900 uppercase">1. Выбор бланков, сданных в офис</h3>
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => setAllReturnsChecked(true)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase rounded-lg">Выбрать все</button>
              <button onClick={() => setAllReturnsChecked(false)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase rounded-lg">Снять все</button>
              <button onClick={rebuildReturnRows} className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-[10px] font-black uppercase rounded-lg">Собрать по выбранным</button>
              <button onClick={loadLastAssembledStatement} className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-black uppercase rounded-lg">Собрать по предыдущим</button>
              <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">
                <input type="checkbox" checked={showArchiveReturns} onChange={(e) => setShowArchiveReturns(e.target.checked)} className="accent-amber-500" />
                Включить уже сданные в ТИ (Архив)
              </label>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-3 bg-slate-50 border border-slate-200/50 rounded-2xl">
              {activeReturns.map((item: any) => (
                <label key={item.id} className="flex items-start gap-3 p-3 bg-white border border-slate-100 rounded-xl cursor-pointer hover:bg-slate-50/50 transition">
                  <input 
                    type="checkbox" 
                    className="mt-1 accent-amber-500" 
                    checked={!!selectedReturnItems[item.id]}
                    onChange={(e) => setSelectedReturnItems(prev => ({ ...prev, [item.id]: e.target.checked }))}
                  />
                  <div>
                    <span className="font-black text-slate-900 text-xs">{item.type} №{item.number}</span>
                    <span className="block text-[10px] text-slate-500 font-bold">
                      {getPermitPrintMapping(item.type).country || item.type} · {item.car || 'без авто'} · {item.isCopy ? 'копия сдана' : 'оригинал'}
                    </span>
                  </div>
                </label>
              ))}
              {!activeReturns.length && <div className="col-span-2 text-center text-slate-400 font-bold text-xs py-6">В реестре офиса нет сданных бланков</div>}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-black text-slate-900 uppercase">2. Содержимое реестра (Редактируемые строки)</h3>
              <div className="flex gap-2">
                {user.role === 'root_admin' && (
                  <button onClick={markCheckedOfficeReturnsAsUsed} className="flex items-center gap-1 bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight shadow-sm cursor-pointer">
                    <CheckCircle className="h-3 w-3" /> Списать (Сданы в инспекцию ТИ)
                  </button>
                )}
                <button onClick={addReturnRow} className="flex items-center gap-1 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight cursor-pointer">+ Добавить строку</button>
              </div>
            </div>

            <div className="table-responsive select-none overflow-x-auto custom-scrollbar">
              <table className="main-table w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-150 text-[10px] font-black uppercase text-slate-400">
                    <th className="p-3">Государство</th>
                    <th className="p-3">Вид бланков</th>
                    <th className="p-3 w-24 text-center">Год</th>
                    <th className="p-3">Номера бланков</th>
                    <th className="p-3 w-24 text-center">Всего, шт.</th>
                    <th className="p-3 w-16 text-center">Убрать</th>
                  </tr>
                </thead>
                <tbody>
                  {returnRows.map((row, index) => (
                    <tr key={index} className="hover:bg-slate-50/50">
                      <td className="p-2"><input className="input-flat font-bold text-slate-800" value={row.country} onChange={e => updateReturnRow(index, 'country', e.target.value)} /></td>
                      <td className="p-2"><input className="input-flat font-bold text-slate-800" value={row.category} onChange={e => updateReturnRow(index, 'category', e.target.value)} /></td>
                      <td className="p-2 text-center"><input type="number" className="input-flat text-center font-bold text-slate-800" value={row.year} onChange={e => updateReturnRow(index, 'year', e.target.value)} /></td>
                      <td className="p-2"><input className="input-flat font-mono font-bold text-slate-800" value={row.numbers} onChange={e => updateReturnRow(index, 'numbers', e.target.value)} /></td>
                      <td className="p-2 text-center"><input type="number" min="1" className="input-flat text-center font-bold text-slate-800" value={row.qty} onChange={e => updateReturnRow(index, 'qty', e.target.value)} /></td>
                      <td className="p-2 text-center">
                        <button onClick={() => deleteReturnRow(index)} className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 transition flex items-center justify-center mx-auto cursor-pointer">✕</button>
                      </td>
                    </tr>
                  ))}
                  {!returnRows.length && (
                    <tr>
                      <td colSpan={6} className="text-center p-8 text-slate-400 font-bold uppercase">Список строк реестра пуст</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {docType === "Заявление по китайским копиям" && (
        <div className="bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] p-6 space-y-6">
          <div className="space-y-2">
            <h3 className="text-sm font-black text-slate-900 uppercase">1. Выбор сданных китайских копий</h3>
            <div className="flex flex-wrap gap-2 items-center">
              <button onClick={() => setAllChinaChecked(true)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase rounded-lg">Выбрать все</button>
              <button onClick={() => setAllChinaChecked(false)} className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-black uppercase rounded-lg">Снять все</button>
              <button onClick={rebuildChinaRows} className="px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white text-[10px] font-black uppercase rounded-lg">Собрать по выбранным</button>
              <label className="flex items-center gap-2 text-[10px] font-bold text-slate-600 bg-slate-100 px-3 py-1.5 rounded-lg cursor-pointer">
                <input type="checkbox" checked={showArchiveChina} onChange={(e) => setShowArchiveChina(e.target.checked)} className="accent-purple-600" />
                Включить уже сданные в ТИ (Архив)
              </label>
              <button onClick={() => markSelectedChinaCopiesAsSubmitted(true)} className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-black uppercase rounded-lg">Пометить как отправленные в ТИ</button>
              <button onClick={() => markSelectedChinaCopiesAsSubmitted(false)} className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-black uppercase rounded-lg">Сбросить отметку сдачи</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-48 overflow-y-auto p-3 bg-slate-50 border border-slate-200/50 rounded-2xl">
              {activeChinaCopies.map((item: any) => (
                <label key={item.id} className={`flex items-start gap-3 p-3 border rounded-xl cursor-pointer hover:bg-slate-50/50 transition ${item.chinaCopySubmitted ? 'bg-purple-50/40 border-purple-100' : 'bg-white border-slate-100'}`}>
                  <input 
                    type="checkbox" 
                    className="mt-1 accent-purple-600" 
                    checked={!!selectedChinaItems[item.id]}
                    onChange={(e) => setSelectedChinaItems(prev => ({ ...prev, [item.id]: e.target.checked }))}
                  />
                  <div>
                    <span className="font-black text-slate-900 text-xs">
                      {item.type} №{item.number}
                      {item.chinaCopySubmitted && (
                        <span className="ml-2 bg-purple-100 text-purple-700 text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase tracking-tight">Копия сдана/отправлена</span>
                      )}
                    </span>
                    <span className="block text-[10px] text-slate-500 font-bold">
                      {item.car || 'без авто'} · {getStatusLabel(item.status)}
                    </span>
                  </div>
                </label>
              ))}
              {!activeChinaCopies.length && <div className="col-span-2 text-center text-slate-400 font-bold text-xs py-6 font-mono">Нет китайских дозволов с отметкой 'копия сдана'</div>}
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <h3 className="text-sm font-black text-slate-900 uppercase">2. Содержимое заявления по копиям (Редактируемые строки)</h3>
              <button onClick={addChinaRow} className="flex items-center gap-1 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight cursor-pointer">+ Добавить строку</button>
            </div>

            <div className="table-responsive select-none overflow-x-auto custom-scrollbar">
              <table className="main-table w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-150 text-[10px] font-black uppercase text-slate-400">
                    <th className="p-3 w-48">Страна</th>
                    <th className="p-3">Номера разрешений</th>
                    <th className="p-3 w-16 text-center">Убрать</th>
                  </tr>
                </thead>
                <tbody>
                  {chinaRows.map((row, index) => (
                    <tr key={index} className="hover:bg-slate-50/50">
                      <td className="p-2"><input className="input-flat font-bold text-slate-800" value={row.country} onChange={e => updateChinaRow(index, 'country', e.target.value)} /></td>
                      <td className="p-2"><input className="input-flat font-mono font-bold text-slate-800" value={row.numbers} onChange={e => updateChinaRow(index, 'numbers', e.target.value)} /></td>
                      <td className="p-2 text-center">
                        <button onClick={() => deleteChinaRow(index)} className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 transition flex items-center justify-center mx-auto cursor-pointer">✕</button>
                      </td>
                    </tr>
                  ))}
                  {!chinaRows.length && (
                    <tr>
                      <td colSpan={3} className="text-center p-8 text-slate-400 font-bold uppercase">Список строк заявления пуст</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}


    </div>
  );
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function setWordCellText(cell: Element, value: any) {
  const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
  const texts = [...cell.getElementsByTagNameNS(ns, 't')];
  if (texts.length) {
    texts[0].textContent = String(value || '');
    texts[0].setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
    texts.slice(1).forEach(t => t.textContent = '');
  }
}

function getWordChildRows(tableNode: Element, ns: string): Element[] {
  return [...tableNode.childNodes].filter(n => n.nodeType === 1 && (n as Element).localName === 'tr' && (n as Element).namespaceURI === ns) as Element[];
}

function findWordTable(xmlDoc: Document, ns: string, fragments: string[]): Element | undefined {
  return [...xmlDoc.getElementsByTagNameNS(ns, 'tbl')].find(tbl => fragments.every(fragment => tbl.textContent?.includes(fragment)));
}

function removeWordCellBorders(cell: Element, ns: string) {
  if (!cell) return;
  const tcPr = cell.getElementsByTagNameNS(ns, 'tcPr')[0] || cell.insertBefore(cell.ownerDocument.createElementNS(ns, 'w:tcPr'), cell.firstChild);
  [...tcPr.getElementsByTagNameNS(ns, 'tcBorders')].forEach(node => node.parentNode?.removeChild(node));
  const borders = cell.ownerDocument.createElementNS(ns, 'w:tcBorders');
  ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].forEach(side => {
    const border = cell.ownerDocument.createElementNS(ns, `w:${side}`);
    border.setAttributeNS(ns, 'w:val', 'nil');
    borders.appendChild(border);
  });
  tcPr.appendChild(borders);
}

function setFirstWordText(node: Element, value: string, ns: string) {
  const text = node?.getElementsByTagNameNS(ns, 't')?.[0];
  if (!text) return;
  text.textContent = String(value || '');
  text.setAttributeNS('http://www.w3.org/XML/1998/namespace', 'xml:space', 'preserve');
  [...node.getElementsByTagNameNS(ns, 't')].slice(1).forEach(t => t.textContent = '');
}

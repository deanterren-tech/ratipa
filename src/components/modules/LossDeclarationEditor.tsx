import React, { useState, useEffect, useRef } from 'react';
import { database } from '../../firebase';
import { ref, onValue, push } from 'firebase/database';
import { Save, Plus, Printer, Download, Upload, X } from 'lucide-react';

const lostDeclImg = '/lost_decl.png';

// Draggable component
const DraggableItem = ({ id, x, y, onMove, children, isSelected, onClick, onRemove }: any) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragContext = useRef({ startX: 0, startY: 0, initialElemX: 0, initialElemY: 0 });

  const handleMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDragging(true);
    dragContext.current = { startX: e.clientX, startY: e.clientY, initialElemX: x, initialElemY: y };
    if (onClick) onClick(id);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const parent = document.getElementById('loss-canvas-container');
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dxPercent = (e.clientX - dragContext.current.startX) / rect.width * 100;
      const dyPercent = (e.clientY - dragContext.current.startY) / rect.height * 100;
      onMove(id, dragContext.current.initialElemX + dxPercent, dragContext.current.initialElemY + dyPercent);
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, id, onMove]);

  return (
    <div 
      onMouseDown={handleMouseDown}
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick(id);
      }}
      className={`absolute cursor-move select-none pointer-events-auto ${isSelected ? 'ring-2 ring-blue-500 bg-blue-50/50' : 'hover:ring-1 hover:ring-slate-300'}`}
      style={{ left: `${x}%`, top: `${y}%`, padding: '4px', zIndex: isDragging ? 50 : 10 }}
    >
      {children}
      {isSelected && onRemove && (
        <button 
          type="button"
          onMouseDown={(e) => {
            e.stopPropagation();
            onRemove(id);
          }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(id);
          }}
          className="absolute -top-3 -right-3 bg-red-600 hover:bg-red-700 text-white rounded-full w-5 h-5 flex items-center justify-center shadow-md cursor-pointer z-[100] text-[10px] font-bold select-none leading-none transition-colors"
          title="Удалить"
        >
          ✕
        </button>
      )}
    </div>
  );
};

export default function LossDeclarationEditor() {
  // Input states
  const [formValues, setFormValues] = useState({
    assoc: 'БАМАП',
    holder: '',
    carnet: '',
    issueDate: '15.01.2025',
    expiryDate: '15.01.2026',
    volets: '14',
    disPlaceDate: '',
    place: '',
    date: ''
  } );

  const [activeTab, setActiveTab] = useState<'step1' | 'step2'>('step1');

  const [letterValues, setLetterValues] = useState({
    docNum: '73',
    docDate: '07.04.2026',
    recipient: 'Ассоциация\nМеждународных автомобильных\nперевозчиков «БАМАП»',
    subject: 'Касательно изъятых книжек МДП',
    companyRuName: 'РАТИПА',
    companyRuType: 'Общество с ограниченной ответственностью',
    companyByName: 'РАТЫПА',
    companyByType: 'таварыства з абмежаванай адказнасцю',
    companyAddress: 'Республика Беларусь, 220137, г.Минск, ул.Таежная 39, к.2',
    companyPostAddress: '223060 РБ, Минская обл., Минский р-н, Новодворский с/с д. Б. Стиклево, 40/2 «S-Union» к.61',
    companyPhone: '(+375 17) 338-11-03, 338-10-86',
    companyFax: '(+375 17) 338-09-79',
    companyEmail: 'ratipa@ratipa.by',
    companyWebsite: 'www.ratipa.by',
    companyIban: 'BY87PJCB30120030121000000933 ОАО Приорбанк г.Минск, код 749',
    companyUnp: '100492419',
    companyOkpo: '14612221',
    signeeTitle: 'Директор',
    signeeName: 'В.В.Бориско'
  });

  const [customLetterBody, setCustomLetterBody] = useState('');

  const generateDefaultLetterBody = (carnetStr: string) => {
    const carnets = carnetStr.split(/[\s,;]+/).filter(Boolean);
    if (carnets.length === 0) {
      return {
        p1: 'Настоящим сообщаем, что книжка МДП [номер] была изъята на таможне назначения в Российской Федерации в связи с оформлением не в соответствии с Конвенцией МДП.',
        p2: 'По данному факту изъятия можем пояснить, что перевозка являлась международной, т.е. выполнялась между различными странами, что допускается Конвенцией МДП.'
      };
    }

    if (carnets.length > 1) {
      const numbersList = carnets.join(', ');
      return {
        p1: `Настоящим сообщаем, что книжки МДП ${numbersList} были изъяты на таможнях назначения в Российской Федерации в связи с оформлением не в соответствии с Конвенцией МДП.`,
        p2: 'По данному факту изъятия можем пояснить, что перевозки являлись международными, т.е. выполнялись между различными странами, что допускается Конвенцией МДП.'
      };
    } else {
      return {
        p1: `Настоящим сообщаем, что книжка МДП ${carnets[0]} была изъята на таможне назначения в Российской Федерации в связи с оформлением не в соответствии с Конвенцией МДП.`,
        p2: 'По данному факту изъятия можем пояснить, что перевозка являлась международной, т.е. выполнялась между различными странами, что допускается Конвенцией МДП.'
      };
    }
  };

  const defaultBody = generateDefaultLetterBody(formValues.carnet);
  const bodyParagraphs = customLetterBody 
    ? customLetterBody.split('\n\n').filter(Boolean) 
    : [defaultBody.p1, defaultBody.p2];

  const fieldLabels: Record<keyof typeof formValues, string> = {
    assoc: '1. Гарантийное объединение',
    holder: '2. Держатель книжки',
    carnet: '3. Номера книжек МДП',
    issueDate: '4. Дата выдачи',
    expiryDate: 'Срок действия',
    volets: '5. Количество листов',
    disPlaceDate: '6. Место и дата происшествия',
    place: '11.1 Место изъятия в полицию',
    date: '11.2 Дата изъятия'
  } ;

  const handleInputChange = (field: string, val: string) => {
    setFormValues(prev => ({ ...prev, [field]: val }));
  };

  // Layout states
  const [fieldsLayout, setFieldsLayout] = useState<Record<string, { x: number, y: number }>>({
    assoc: { x: 10, y: 10 },
    holder: { x: 50, y: 10 },
    carnet: { x: 10, y: 15 },
    issueDate: { x: 50, y: 15 },
    expiryDate: { x: 70, y: 15 },
    volets: { x: 10, y: 20 },
    disPlaceDate: { x: 10, y: 25 },
    place: { x: 10, y: 60 },
    date: { x: 10, y: 65 }
  } );

  const [checkmarks, setCheckmarks] = useState<{ id: string, x: number, y: number }[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // Places database
  const [savedPlaces, setSavedPlaces] = useState<string[]>([]);
  const [placeSearchQuery, setPlaceSearchQuery] = useState('');
  
  useEffect(() => {
    const placesRef = ref(database, 'dozvolsLossPlacesV1');
    const unsubscribe = onValue(placesRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const placesList = Object.values(data) as string[];
        setSavedPlaces([...new Set(placesList)]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleSaveNewPlace = (val: string) => {
    if (!val || savedPlaces.includes(val)) return;
    push(ref(database, 'dozvolsLossPlacesV1'), val).catch(err => console.error(err));
  };

  // Layout handlers
  const handleMoveField = (id: string, x: number, y: number) => {
    setFieldsLayout(prev => ({ ...prev, [id]: { x, y } }));
  };

  const handleMoveCheckmark = (id: string, x: number, y: number) => {
    setCheckmarks(prev => prev.map(c => c.id === id ? { ...c, x, y } : c));
  };

  const addCheckmark = () => {
    const id = `chk_${Date.now()}`;
    setCheckmarks(prev => [...prev, { id, x: 50, y: 50 }]);
    setSelectedItemId(id);
  };

  const removeCheckmark = (id: string) => {
    setCheckmarks(prev => prev.filter(c => c.id !== id));
    if (selectedItemId === id) setSelectedItemId(null);
  };

  // Template saving
  const saveTemplate = () => {
    const template = { fields: fieldsLayout, checkmarks, formValues, letterValues, customLetterBody };
    localStorage.setItem('tirLossTemplateV2', JSON.stringify(template));
    alert('Шаблон успешно сохранен!');
  };

  const loadTemplate = () => {
    const data = localStorage.getItem('tirLossTemplateV2');
    if (data) {
      try {
        const parsed = JSON.parse(data);
        if (parsed.fields) setFieldsLayout(parsed.fields);
        if (parsed.checkmarks) setCheckmarks(parsed.checkmarks);
        if (parsed.formValues) setFormValues(prev => ({ ...prev, ...parsed.formValues }));
        if (parsed.letterValues) setLetterValues(prev => ({ ...prev, ...parsed.letterValues }));
        if (parsed.customLetterBody !== undefined) setCustomLetterBody(parsed.customLetterBody);
      } catch (e) {
        console.error("Failed to load template", e);
      }
    }
  };

  useEffect(() => {
    loadTemplate(); // Load default on mount
  }, []);

  // Print Declaration (Step 1)
  const handlePrintDeclaration = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    let fieldsHtml = '';
    Object.keys(fieldsLayout).forEach(key => {
      const val = formValues[key as keyof typeof formValues];
      const pos = fieldsLayout[key];
      if (val) {
        fieldsHtml += `<div style="position:absolute; left:${pos.x}%; top:${pos.y}%; padding: 4px; font-family: Arial, Helvetica, sans-serif; font-size: 14px; font-weight: bold; color: #0f172a; white-space: pre-wrap; line-height: 1.25; max-width: 400px; box-sizing: border-box;">${val.replace(/\n/g, '<br/>')}</div>`;
      }
    });

    let checkmarksHtml = '';
    checkmarks.forEach(chk => {
      checkmarksHtml += `<div style="position:absolute; left:${chk.x}%; top:${chk.y}%; padding: 4px; font-family: Arial, Helvetica, sans-serif; font-size: 24px; font-weight: 900; color: #dc2626; line-height: 1; box-sizing: border-box; user-select: none;">✓</div>`;
    });

    printWindow.document.write(`
      <html>
        <head>
          <title>Печать декларации</title>
          <style>
            @media print {
              @page { margin: 0; size: A4; }
              body { margin: 0; -webkit-print-color-adjust: exact; }
            }
            body { margin: 0; padding: 0; }
            .print-container { position: relative; width: 210mm; height: 297mm; overflow: hidden; box-sizing: border-box; }
            .bg-img { position: absolute; top: 0; left: 0; width: 210mm; height: 297mm; border: none; opacity: 1; pointer-events: none; z-index: 1; object-fit: fill; }
            .overlay { position: absolute; top: 0; left: 0; width: 210mm; height: 297mm; z-index: 2; pointer-events: none; }
          </style>
        </head>
        <body>
          <div class="print-container">
            <img class="bg-img" id="bg-image" src="${lostDeclImg.startsWith('data:') ? lostDeclImg : new URL(lostDeclImg, window.location.href).href}" referrerpolicy="no-referrer" />
            <div class="overlay">
              ${fieldsHtml}
              ${checkmarksHtml}
            </div>
          </div>
          <script>
            const img = document.getElementById('bg-image');
            const doPrint = () => {
              setTimeout(() => {
                window.print();
                window.close();
              }, 500);
            };
            if (img.complete) {
              doPrint();
            } else {
              img.onload = doPrint;
              img.onerror = doPrint;
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Print Letter (Step 2)
  const handlePrintLetter = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const parasHtml = bodyParagraphs.map(para => `<p style="text-indent: 12.5mm; margin: 0 0 6mm 0; text-align: justify; line-height: 1.5; font-size: 11pt;">${para}</p>`).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Печать письма об изъятии</title>
          <style>
            @media print {
              @page { margin: 0; size: A4; }
              body { margin: 0; -webkit-print-color-adjust: exact; }
            }
            body { 
              margin: 0; 
              padding: 0; 
              font-family: 'Times New Roman', Times, serif; 
              color: #000;
              background-color: #fff;
            }
            .print-container { 
              position: relative; 
              width: 210mm; 
              height: 297mm; 
              padding: 20mm 15mm 20mm 15mm; 
              box-sizing: border-box; 
              display: flex;
              flex-direction: column;
              overflow: hidden;
            }
            .header-table {
              width: 100%;
              border-collapse: collapse;
              font-family: 'Times New Roman', Times, serif;
            }
            .header-title {
              font-size: 18pt;
              font-weight: bold;
              letter-spacing: 0.20em;
              line-height: 1.1;
            }
            .header-subtitle {
              font-size: 9.5pt;
              margin-top: 3mm;
              line-height: 1.25;
            }
            .address-block {
              margin-top: 4mm;
              font-size: 10pt;
              line-height: 1.35;
              font-family: 'Times New Roman', Times, serif;
              text-align: center;
            }
            .divider-line {
              border-bottom: 1.5px solid #000;
              margin-top: 3mm;
              margin-bottom: 5mm;
              width: 100%;
            }
            .ref-line {
              font-size: 11pt;
              font-family: 'Times New Roman', Times, serif;
              text-align: left;
              margin-bottom: 5mm;
            }
            .recipient-block {
              margin-left: auto;
              width: 95mm;
              text-align: right;
              font-family: 'Times New Roman', Times, serif;
              font-size: 11pt;
              font-weight: bold;
              line-height: 1.3;
              margin-bottom: 12mm;
            }
            .subject-line {
              font-family: 'Times New Roman', Times, serif;
              font-size: 11pt;
              text-align: left;
              margin-bottom: 10mm;
            }
            .body-text {
              font-family: 'Times New Roman', Times, serif;
              font-size: 11pt;
              line-height: 1.5;
              color: #000;
              text-align: justify;
            }
            .signature-block {
              margin-top: 15mm;
              display: flex;
              justify-content: space-between;
              font-family: 'Times New Roman', Times, serif;
              font-size: 11pt;
              font-weight: bold;
              color: #000;
            }
          </style>
        </head>
        <body>
          <div class="print-container">
            <table class="header-table">
              <tr>
                <td style="width: 50%; text-align: center; vertical-align: top; padding: 0;">
                  <div class="header-title">Р А Т И П А</div>
                  <div class="header-subtitle">Общество с ограниченной<br>ответственностью</div>
                </td>
                <td style="width: 50%; text-align: center; vertical-align: top; padding: 0;">
                  <div class="header-title">Р А Т Ы П А</div>
                  <div class="header-subtitle">таварыства з абмежаванай<br>адказнасцю</div>
                </td>
              </tr>
            </table>

            <div class="address-block">
              <div>Юридический адрес: Республика Беларусь, 220137, г.Минск, ул.Таежная 39, к.2</div>
              <div>Почтовый адрес: 223060 РБ, Минская обл., Минский р-н, Новодворский с/с д. Б. Стиклево, 40/2 «S-Union» к.61</div>
              <div>Тел. (+375 17) 338-11-03, 338-10-86.</div>
              <div>Факс (+375 17) 338-09-79. e-mail: ratipa@ratipa.by www.ratipa.by</div>
              <div>IBAN: BY87PJCB30120030121000000933 ОАО Приорбанк г.Минск, код 749.</div>
              <div>УНП 100492419 ОКПО 14612221</div>
            </div>

            <div class="divider-line"></div>

            <div class="ref-line">
              Исх. №${letterValues.docNum} от ${letterValues.docDate}
            </div>

            <div class="recipient-block">
              Ассоциация<br>
              Международных автомобильных<br>
              перевозчиков «БАМАП»
            </div>

            <div class="subject-line">
              Касательно изъятых книжек МДП
            </div>

            <div class="body-text">
              ${parasHtml}
            </div>

            <div class="signature-block">
              <span>Директор</span>
              <span>В.В.Бориско</span>
            </div>
          </div>
          <script>
            window.onload = () => {
              setTimeout(() => {
                window.print();
                window.close();
              }, 300);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handlePrint = () => {
    if (activeTab === 'step1') {
      handlePrintDeclaration();
    } else {
      handlePrintLetter();
    }
  };

  return (
    <div className="flex flex-col h-full bg-transparent">
      
      {/* STEP NAVIGATION HEADER */}
      <div className="flex p-1.5 bg-slate-100/85 backdrop-blur-md rounded-2xl border border-slate-200/40 mb-5 gap-1.5 font-sans">
        <button 
          onClick={() => setActiveTab('step1')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-center font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'step1' ? 'bg-[#3765F6] text-white shadow-xs' : 'text-slate-600 hover:bg-white/50'}`}
        >
          <span className={`flex items-center justify-center w-5 h-5 rounded-lg text-[10px] font-bold ${activeTab === 'step1' ? 'bg-white/20 text-white' : 'bg-slate-250 text-slate-700'}`}>1</span>
          Этап 1: Декларация об утере
        </button>
        <button 
          onClick={() => setActiveTab('step2')}
          className={`flex-1 py-2.5 px-4 rounded-xl text-center font-bold text-xs transition flex items-center justify-center gap-2 cursor-pointer ${activeTab === 'step2' ? 'bg-[#3765F6] text-white shadow-xs' : 'text-slate-600 hover:bg-white/50'}`}
        >
          <span className={`flex items-center justify-center w-5 h-5 rounded-lg text-[10px] font-bold ${activeTab === 'step2' ? 'bg-white/20 text-white' : 'bg-slate-250 text-slate-700'}`}>2</span>
          Этап 2: Сопроводительное письмо об изъятии
        </button>
      </div>

      <div className="flex flex-1 overflow-hidden gap-5">
        {/* LEFT PANEL - FORMS */}
        <div className="w-1/3 min-w-[320px] max-w-[420px] bg-white/70 backdrop-blur-xl border border-slate-200/40 rounded-2xl flex flex-col h-full shadow-xs">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50 rounded-t-2xl">
            <h3 className="font-bold text-slate-800 text-xs font-sans">
              {activeTab === 'step1' ? 'Поля декларации' : 'Параметры письма'}
            </h3>
            <div className="flex gap-2">
              <button onClick={saveTemplate} title="Сохранить шаблон" className="p-2 bg-slate-100 hover:bg-slate-200 rounded-xl text-slate-700 flex items-center gap-1 text-[11px] font-bold transition border border-slate-200 cursor-pointer">
                <Save size={14} /> Сохр.
              </button>
              <button onClick={handlePrint} title="Печать" className="p-2 bg-[#3765F6] hover:bg-[#2555E5] rounded-xl text-white flex items-center gap-1 text-[11px] font-bold transition cursor-pointer">
                <Printer size={14} /> Печать
              </button>
            </div>
          </div>

          {activeTab === 'step1' ? (
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              <div className="mb-4 pb-4 border-b border-slate-100">
                <button 
                  onClick={addCheckmark}
                  className="w-full flex items-center justify-center gap-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 py-2.5 rounded-xl font-bold text-xs transition border border-emerald-200/50 cursor-pointer"
                >
                  <Plus size={16} /> Добавить галочку
                </button>
                <p className="text-[10px] text-slate-400 text-center mt-2 font-sans">
                  Галочка появится на документе. Перетащите её в нужный чекбокс.
                </p>
              </div>

              {(Object.keys(formValues) as Array<keyof typeof formValues>).map((key) => {
                const isPlaceField = key === 'place' || key === 'disPlaceDate';

                return (
                  <div key={key} className="flex flex-col gap-1.5 font-sans">
                    <label className="text-[11px] font-semibold text-slate-600 font-sans">{fieldLabels[key]}</label>
                    
                    {isPlaceField ? (
                      <div className="flex flex-col gap-2">
                        <input
                          type="text"
                          value={formValues[key]}
                          onChange={(e) => {
                            handleInputChange(key as string, e.target.value);
                            setPlaceSearchQuery(e.target.value);
                          }}
                          className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:border-[#3765F6] focus:bg-white outline-none transition"
                        />
                        {/* Suggestions dropdown */}
                        {placeSearchQuery && (
                          <div className="max-h-32 overflow-y-auto bg-white border border-slate-200/60 rounded-xl p-1.5 text-xs shadow-xs">
                            {savedPlaces
                              .filter(p => p.toLowerCase().includes(placeSearchQuery.toLowerCase()))
                              .map((p, i) => (
                                <div 
                                  key={i} 
                                  className="cursor-pointer p-2 hover:bg-slate-50 rounded-lg font-semibold"
                                  onClick={() => {
                                    handleInputChange(key, p);
                                    setPlaceSearchQuery('');
                                  }}
                                >
                                  {p}
                                </div>
                              ))}
                          </div>
                        )}
                        <button 
                          onClick={() => handleSaveNewPlace(formValues[key])}
                          className="text-[10px] bg-slate-100 hover:bg-slate-200 py-1.5 rounded-lg text-slate-700 font-bold border border-slate-200 cursor-pointer"
                        >
                          Сохранить это место
                        </button>
                      </div>
                    ) : key === 'holder' ? (
                      <textarea
                        value={formValues[key]}
                        onChange={(e) => handleInputChange(key as string, e.target.value)}
                        rows={2}
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:border-[#3765F6] focus:bg-white outline-none transition resize-none"
                      />
                    ) : (
                      <input
                        type="text"
                        value={formValues[key]}
                        onChange={(e) => handleInputChange(key as string, e.target.value)}
                        className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:border-[#3765F6] focus:bg-white outline-none transition"
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-sans">
              <div className="bg-blue-50/80 border border-blue-150/40 p-3.5 rounded-xl text-[11px] text-blue-800 leading-relaxed font-medium">
                <strong>Режим сопроводительного письма</strong><br />
                В соответствии с требованиями, изменять можно только <strong>номер книжки МДП</strong>, <strong>дату</strong> и <strong>номер исходящего</strong>. Остальные данные остаются неизменными и соответствуют официальному бланку 1 в 1.
              </div>

              {/* Исходящий номер и дата */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1.5 font-sans">
                  <label className="text-[11px] font-semibold text-slate-600 font-sans">Исходящий №</label>
                  <input
                    type="text"
                    value={letterValues.docNum}
                    onChange={(e) => setLetterValues(prev => ({ ...prev, docNum: e.target.value }))}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:border-[#3765F6] focus:bg-white outline-none transition"
                  />
                </div>
                <div className="flex flex-col gap-1.5 font-sans">
                  <label className="text-[11px] font-semibold text-slate-600 font-sans">Дата исх.</label>
                  <input
                    type="text"
                    value={letterValues.docDate}
                    onChange={(e) => setLetterValues(prev => ({ ...prev, docDate: e.target.value }))}
                    className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:border-[#3765F6] focus:bg-white outline-none transition"
                  />
                </div>
              </div>

              {/* Номер книжки МДП */}
              <div className="flex flex-col gap-1.5 font-sans">
                <label className="text-[11px] font-semibold text-slate-600 font-sans">Номер книжки (книжек) МДП</label>
                <input
                  type="text"
                  value={formValues.carnet}
                  onChange={(e) => handleInputChange('carnet', e.target.value)}
                  className="w-full bg-slate-50/50 border border-slate-200 rounded-xl px-3.5 py-2.5 text-xs font-semibold focus:border-[#3765F6] focus:bg-white outline-none transition"
                  placeholder="Например, SX87832639"
                />
                <p className="text-[10px] text-slate-400 leading-normal mt-1 font-sans">
                  Синхронизировано с Этапом 1. Если ввести несколько номеров через запятую или пробел, письмо автоматически переключится в режим множественного числа ("книжки МДП... были изъяты...").
                </p>
              </div>
            </div>
          )}
        </div>

        {/* RIGHT PANEL - CANVAS */}
        <div 
          className="flex-1 bg-slate-50/40 backdrop-blur-md border border-slate-200/30 rounded-2xl p-6 overflow-auto flex items-start justify-center shadow-xs max-h-[850px]"
          onClick={() => setSelectedItemId(null)}
        >
          {activeTab === 'step1' ? (
            /* A4 Proportion Container - Declaration */
            <div 
              id="loss-canvas-container"
              className="relative bg-white shadow-xl flex-shrink-0"
              style={{ width: '794px', height: '1123px', margin: '0 auto' }} // A4 standard at 96 DPI
            >
              {/* Background template with 100% opacity in preview */}
              <img 
                src={lostDeclImg} 
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full pointer-events-none select-none"
                style={{ opacity: 1.0, border: 'none', objectFit: 'fill' }}
                alt="Declaration Template"
              />

              {/* Draggable Fields Overlay */}
              <div className="absolute inset-0 z-10 text-sm font-bold text-slate-900 pointer-events-none" style={{ fontFamily: 'Arial, sans-serif' }}>
                <div className="pointer-events-none absolute inset-0 w-full h-full">
                  {Object.keys(fieldsLayout).map(key => {
                    const val = formValues[key as keyof typeof formValues];
                    if (!val) return null;
                    const pos = fieldsLayout[key];
                    return (
                      <DraggableItem 
                        key={key} 
                        id={key} 
                        x={pos.x} 
                        y={pos.y} 
                        onMove={handleMoveField}
                        isSelected={selectedItemId === key}
                        onClick={setSelectedItemId}
                      >
                        <div className="whitespace-pre-wrap max-w-[400px] leading-tight text-sm font-bold text-slate-900" style={{ fontFamily: 'Arial, sans-serif' }}>
                          {val}
                        </div>
                      </DraggableItem>
                    );
                  })}

                  {checkmarks.map(chk => (
                    <DraggableItem 
                      key={chk.id} 
                      id={chk.id} 
                      x={chk.x} 
                      y={chk.y} 
                      onMove={handleMoveCheckmark}
                      isSelected={selectedItemId === chk.id}
                      onClick={setSelectedItemId}
                      onRemove={removeCheckmark}
                    >
                      <div className="text-2xl font-black text-red-600 leading-none select-none" style={{ fontFamily: 'Arial, sans-serif' }}>
                        ✓
                      </div>
                    </DraggableItem>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* A4 Proportion Container - Letter */
            <div 
              id="letter-canvas-container"
              className="relative bg-white shadow-xl flex-shrink-0 p-[20mm] flex flex-col text-black text-justify"
              style={{ width: '794px', height: '1123px', margin: '0 auto', boxSizing: 'border-box', fontFamily: "'Times New Roman', Times, serif" }}
            >
              {/* Header Section */}
              <div className="grid grid-cols-2 gap-4 text-center leading-normal">
                {/* Russian Header */}
                <div>
                  <div className="text-[18pt] font-bold tracking-[0.2em] mb-1 leading-none">Р А Т И П А</div>
                  <div className="text-[9.5pt] leading-tight">
                    Общество с ограниченной<br />ответственностью
                  </div>
                </div>
                {/* Belarusian Header */}
                <div>
                  <div className="text-[18pt] font-bold tracking-[0.2em] mb-1 leading-none">Р А Т Ы П А</div>
                  <div className="text-[9.5pt] leading-tight">
                    таварыства з абмежаванай<br />адказнасцю
                  </div>
                </div>
              </div>

              {/* Address & Details Block */}
              <div className="mt-4 text-[10pt] text-black space-y-0.5 border-b border-black pb-2 leading-snug text-center">
                <div>Юридический адрес: Республика Беларусь, 220137, г.Минск, ул.Таежная 39, к.2</div>
                <div>Почтовый адрес: 223060 РБ, Минская обл., Минский р-н, Новодворский с/с д. Б. Стиклево, 40/2 «S-Union» к.61</div>
                <div>Тел. (+375 17) 338-11-03, 338-10-86.</div>
                <div>Факс (+375 17) 338-09-79. e-mail: ratipa@ratipa.by www.ratipa.by</div>
                <div>IBAN: BY87PJCB30120030121000000933 ОАО Приорбанк г.Минск, код 749.</div>
                <div>УНП 100492419 ОКПО 14612221</div>
              </div>

              {/* Outgoing Reference */}
              <div className="mt-4 text-[11pt] text-left">
                Исх. №{letterValues.docNum} от {letterValues.docDate}
              </div>

              {/* Recipient Block (Right aligned) */}
              <div className="mt-8 self-end w-[55%] text-[11pt] font-bold leading-normal text-right">
                Ассоциация<br />
                Международных автомобильных<br />
                перевозчиков «БАМАП»
              </div>

              {/* Subject line */}
              <div className="mt-10 text-[11pt] text-left">
                Касательно изъятых книжек МДП
              </div>

              {/* Body Paragraphs */}
              <div className="mt-6 text-[11pt] leading-relaxed space-y-4 text-justify font-serif">
                {bodyParagraphs.map((para, i) => (
                  <p key={i} style={{ textIndent: '12.5mm', margin: '0' }}>{para}</p>
                ))}
              </div>

              {/* Signature Section */}
              <div className="mt-12 pt-6 flex justify-between items-end text-[11pt] font-bold">
                <span>Директор</span>
                <span>В.В.Бориско</span>
              </div>
            </div>
          )}
        </div>
      </div>

    </div>
  );
}

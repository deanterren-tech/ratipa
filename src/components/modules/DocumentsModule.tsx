import React, { useState, useEffect } from 'react';
import { UserProfile } from '../../types';
import { dbService, database } from '../../firebase';
import { ref, onValue, set, push, remove } from 'firebase/database';
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
  FolderOpen
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
  placeholders: string[]; // parsed automatically or stored
  createdAt: string;
  createdBy: string;
}

const DEFAULT_TEMPLATES: DocumentTemplate[] = [];

export default function DocumentsModule({ user }: Props) {
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

  const canWrite = user.role === 'root_admin' || user.permissions.documents === 'write';

  // Load custom templates combined with defaults
  useEffect(() => {
    setLoading(true);
    const dbRef = ref(database, 'documentTemplates');
    const unsubscribe = onValue(dbRef, (snapshot) => {
      const data = snapshot.val();
      const loaded: DocumentTemplate[] = [];
      if (data) {
        Object.keys(data).forEach((key) => {
          loaded.push({
            id: key,
            ...data[key]
          });
        });
      }
      // Combine with defaults
      const combined = [...DEFAULT_TEMPLATES];
      loaded.forEach(tpl => {
        // If overriding system template or adding new custom
        const existingIdx = combined.findIndex(d => d.id === tpl.id);
        if (existingIdx !== -1) {
          combined[existingIdx] = tpl;
        } else {
          combined.push(tpl);
        }
      });
      setTemplates(combined);
      setLoading(false);
    }, (error) => {
      console.error("Database read error", error);
      setTemplates(DEFAULT_TEMPLATES);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  // Set initial variables when a template is selected
  useEffect(() => {
    if (selectedTemplate) {
      const vars: Record<string, string> = {};
      selectedTemplate.placeholders.forEach(pl => {
        vars[pl] = variables[pl] || '';
      });
      setVariables(vars);
    }
  }, [selectedTemplate]);

  // Dynamically parse placeholders when content changes
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
        // Reset states
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

  const handlePrint = () => {
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
            .header {
              text-align: center;
              border-bottom: 2px solid #33平;
              padding-bottom: 20px;
              margin-bottom: 30px;
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
      // global regex replace
      const escapedKey = key.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const regex = new RegExp(`\\{\\{\\s*${escapedKey}\\s*\\}\\}`, 'g');
      rendered = rendered.replace(regex, val);
    });
    return rendered;
  };

  // Filter templates based on search query
  const filterTerm = (typeof searchQuery === 'string' ? searchQuery : '').toLowerCase();
  const filteredTemplates = Array.isArray(templates) ? templates.filter(t => {
    if (!t) return false;
    const title = (typeof t.title === 'string' ? t.title : '').toLowerCase();
    const desc = (typeof t.description === 'string' ? t.description : '').toLowerCase();
    const cat = (typeof t.category === 'string' ? t.category : '').toLowerCase();
    return title.includes(filterTerm) || desc.includes(filterTerm) || cat.includes(filterTerm);
  }) : [];

  return (
    <div className="space-y-6">
      {/* HEADER SECTION */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2 uppercase tracking-tight">
            <Files className="h-6 w-6 text-[#0f7632]" />
            Шаблоны документов
          </h1>
          <p className="text-xs text-slate-500 font-mono mt-1">
            Быстрое заполнение и генерация транспортных документов по готовым шаблонам
          </p>
        </div>
        {canWrite && (
          <button 
            id="btn-create-template"
            onClick={() => {
              setEditingId(null);
              setNewTitle('');
              setNewDesc('');
              setNewCat('custom');
              setNewContent('');
              setIsModalOpen(true);
            }}
            className="bg-[#70FC8E] hover:bg-[#5be277] active:scale-[0.98] text-slate-900 text-xs font-black uppercase tracking-wider py-3 px-5 rounded-full flex items-center justify-center gap-2 border border-black/10 transition shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Создать шаблон
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        
        {/* LEFT COLUMN: LIST OF TEMPLATES (4 cols or 12 if none selected) */}
        <div className={`xl:col-span-4 space-y-4`}>
          <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <input 
                type="text" 
                placeholder="Поиск шаблонов..." 
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200/60 rounded-xl py-2.5 pl-10 pr-4 text-xs font-bold outline-none focus:border-[#0f7632] focus:bg-white transition"
              />
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <RefreshCw className="h-6 w-6 animate-spin mb-3 text-emerald-600" />
                <span className="text-[10px] font-black uppercase tracking-wider font-mono">Загрузка шаблонов...</span>
              </div>
            ) : filteredTemplates.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-slate-200 rounded-2xl bg-slate-50/50">
                <FolderOpen className="h-8 w-8 text-slate-350 mx-auto mb-2" />
                <span className="text-[10px] font-black uppercase font-mono tracking-widest text-slate-400 block">Раздел пуст</span>
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
                        <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{tpl.description || 'Нет описания'}</p>
                        <span className="text-[8px] font-mono font-black uppercase bg-slate-200/70 text-slate-600 px-1.5 py-0.5 rounded mt-2 inline-block">
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

        {/* RIGHT COLUMN: CHOSEN TEMPLATE PANEL (8 cols) */}
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
                      Шаблон не содержит переменных в формате {"{{имя_переменной}}"}
                    </div>
                  ) : (
                    selectedTemplate.placeholders.map((key) => (
                      <div key={key} className="flex flex-col gap-1.5">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-500 font-mono">
                          {key.replace(/_/g, ' ')}
                        </label>
                        <input 
                          type="text" 
                          placeholder={`Введите ${(typeof key === 'string' ? key.replace(/_/g, ' ').toLowerCase() : '')}...`}
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
                        Просмотр готового документа
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
                        onClick={handlePrint}
                        title="Распечатать или сохранить в PDF"
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
                Выберите один из стандартных шаблонов в списке слева или создайте свой собственный шаблон с умной заменой переменных.
              </p>
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase bg-slate-105 text-slate-500 px-3 py-1.5 rounded-lg border border-slate-150">
                <Info size={12} />
                Переменные указываются в фигурных скобках, например: {"{{Имя_Поля}}"}
              </div>
            </div>
          )}
        </div>

      </div>

      {/* CREATE/EDIT MODAL TEMPLATE */}
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
                className="text-slate-400 hover:text-slate-600 hover:bg-slate-100 p-2 rounded-xl transition"
              >
                &times;
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex flex-col gap-4">
              
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Название документа</label>
                <input 
                  type="text" 
                  placeholder="Например: Договор аренды автомобиля..."
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-black uppercase tracking-wider text-slate-500">Короткое описание</label>
                <input 
                  type="text" 
                  placeholder="Кому и для чего предназначен шаблон..."
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

Просим предоставить транспорт по маршруту {{Маршрут_Движения}}...`}
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-xs font-mono p-4 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition resize-none"
                />
              </div>

              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 flex gap-2">
                <Info size={16} className="text-emerald-700 flex-shrink-0 mt-0.5" />
                <div className="text-[10px] text-emerald-800 leading-normal">
                  <strong>Как это работает:</strong> Все выражения, написанные в двойных фигурных скобках like <code>{"{{Сумма}}"}</code> или <code>{"{{ФИО_Водителя}}"}</code>, автоматически парсятся в интерактивные поля для ввода на панели слева при выборе шаблона.
                </div>
              </div>

            </div>

            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50">
              <button 
                onClick={() => setIsModalOpen(false)}
                className="px-5 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 active:scale-95 transition text-xs font-mono uppercase tracking-widest"
              >
                Отмена
              </button>
              <button 
                onClick={handleCreateOrUpdateTemplate}
                className="px-5 py-2.5 rounded-xl font-bold text-slate-950 bg-[#70FC8E] hover:bg-[#5ceb7d] active:scale-95 transition border border-black/10 text-xs font-mono uppercase tracking-widest"
              >
                Сохранить шаблон
              </button>
            </div>

          </div>
        </div>
      )}

    </div>
  );
}

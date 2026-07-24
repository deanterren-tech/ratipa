import React, {useState, useEffect} from 'react'
import {AppSettings} from '../../types'
import {Sparkles, Plus, Trash2, ArrowUp, ArrowDown, Check, Edit2, X, Eye, ShieldAlert} from 'lucide-react'

interface Props {
  settings: AppSettings | null;
  onSave: (newSettings: AppSettings) => void;
}

export default function AdminWelcomePhrasesBlock({ settings, onSave }: Props) {
  const [phrases, setPhrases] = useState<string[]>([]);
  const [newPhrase, setNewPhrase] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState('');
  const [previewIndex, setPreviewIndex] = useState(0);

  useEffect(() => {
    if (settings?.customPhrases) {
      setPhrases(settings.customPhrases);
    }
  }, [settings?.customPhrases]);

  // Welcome Scene simulated preview cycle
  useEffect(() => {
    if (phrases.length === 0) return;
    const interval = setInterval(() => {
      setPreviewIndex((prev) => (prev + 1) % phrases.length);
    }, 4000);
    return () => clearInterval(interval);
  }, [phrases]);

  const savePhrases = (updatedPhrases: string[]) => {
    if (!settings) return;
    setPhrases(updatedPhrases);
    onSave({ ...settings, customPhrases: updatedPhrases });
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPhrase.trim()) return;
    const updated = [...phrases, newPhrase.trim()];
    savePhrases(updated);
    setNewPhrase('');
  };

  const handleStartEdit = (index: number) => {
    setEditingIndex(index);
    setEditingText(phrases[index]);
  };

  const handleSaveEdit = (index: number) => {
    if (!editingText.trim()) return;
    const updated = [...phrases];
    updated[index] = editingText.trim();
    savePhrases(updated);
    setEditingIndex(null);
  };

  const handleDelete = (index: number) => {
    const updated = phrases.filter((_, i) => i !== index);
    savePhrases(updated);
    if (previewIndex >= updated.length && updated.length > 0) {
      setPreviewIndex(updated.length - 1);
    }
  };

  const handleMove = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === phrases.length - 1) return;

    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    const updated = [...phrases];
    const temp = updated[index];
    updated[index] = updated[targetIndex];
    updated[targetIndex] = temp;
    savePhrases(updated);
    
    if (previewIndex === index) {
      setPreviewIndex(targetIndex);
    } else if (previewIndex === targetIndex) {
      setPreviewIndex(index);
    }
  };

  const handleToggleRole = (roleId: string) => {
    if (!settings) return;
    let currentRoles = settings.customPhrasesRoles || [];
    const allRoles = ['root_admin', 'admin', 'manager', 'accountant', 'dispatcher', 'mechanic', 'viewer', 'logist'];
    
    // If empty, initialize to all except the one toggled (or similar behavior)
    if (currentRoles.length === 0) {
      currentRoles = [...allRoles];
    }

    let updatedRoles: string[];
    if (currentRoles.includes(roleId)) {
      updatedRoles = currentRoles.filter(r => r !== roleId);
    } else {
      updatedRoles = [...currentRoles, roleId];
    }

    // If all are selected, or none are selected, default back to empty array which means "visible to everyone"
    if (updatedRoles.length === allRoles.length || updatedRoles.length === 0) {
      updatedRoles = [];
    }

    onSave({ ...settings, customPhrasesRoles: updatedRoles });
  };

  const rolesList = [
    { id: 'root_admin', label: 'Root (Разработчик)' },
    { id: 'admin', label: 'Администратор' },
    { id: 'manager', label: 'Менеджер' },
    { id: 'accountant', label: 'Бухгалтер' },
    { id: 'dispatcher', label: 'Диспетчер' },
    { id: 'mechanic', label: 'Механик' },
    { id: 'viewer', label: 'Наблюдатель' },
    { id: 'logist', label: 'Логист' },
  ];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 w-full font-sans select-none">
      
      {/* Left Column: List and Management */}
      <div className="xl:col-span-8 flex flex-col gap-6">
        
        {/* Main Phrases Card */}
        <div className="bg-white/40 border border-white/45 backdrop-blur-xl rounded-[1.8rem] p-6 lg:p-8 shadow-sm flex flex-col h-full">
          
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/40 pb-5 mb-5 shrink-0">
            <div>
              <span className="bg-[#3765F6]/10 text-[#3765F6] border border-[#3765F6]/10 font-mono text-[8.5px] font-semibold uppercase tracking-widest px-2.5 py-0.5 rounded-full mb-1.5 inline-block">
                Marquee Ticker Configurator
              </span>
              <h2 className="text-sm font-bold tracking-tight text-slate-900 flex items-center gap-2">
                <Sparkles className="h-4.5 w-4.5 text-[#3765F6]" style={{ fill: '#C7D2FE' }} />
                Редактор текстов бегущей строки
              </h2>
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-slate-500 font-semibold bg-white/50 border border-white/40 px-3 py-1 rounded-xl shadow-xs shrink-0 self-start sm:self-auto">
              Всего записей: {phrases.length}
            </div>
          </div>

          <p className="text-[11px] text-slate-500 font-medium mb-4 leading-relaxed shrink-0">
            Эти тексты поочередно отображаются и плавно сменяются в бегущей строке в верхней панели управления системы. Смена происходит каждые 4 секунды. Вы можете добавлять новые объявления, редактировать существующие, менять их приоритет (порядок) или удалять в реальном времени.
          </p>

          {/* Scrollable Phrases List */}
          <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 space-y-2.5 custom-scrollbar mb-5">
            {phrases.length === 0 ? (
              <div className="text-center py-16 text-slate-400 text-xs font-mono font-semibold tracking-wider bg-white/30 backdrop-blur-sm rounded-[1.5rem] border border-white/40 shadow-inner flex flex-col items-center justify-center gap-3">
                <span className="p-4 bg-slate-900/5 text-slate-400 rounded-2xl">
                  <Sparkles size={24} />
                </span>
                <span>Бегущая строка пуста</span>
                <span className="text-[9px] text-slate-400 font-medium normal-case">Добавьте первый текст в поле ниже</span>
              </div>
            ) : (
              phrases.map((phrase, idx) => {
                const isEditing = editingIndex === idx;
                const isCurrentPreview = previewIndex === idx;

                return (
                  <div
                    key={idx}
                    className={`p-3.5 rounded-2xl border transition-all duration-200 flex items-center justify-between gap-3.5 ${
                      isCurrentPreview
                        ? 'bg-gradient-to-r from-[#3765F6]/5 to-white border-[#3765F6]/30 shadow-xs'
                        : 'bg-white/55 border-white/50 hover:bg-white/80'
                    }`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg shrink-0 ${
                        isCurrentPreview ? 'bg-[#3765F6] text-white' : 'bg-slate-900/5 text-slate-500'
                      }`}>
                        #{idx + 1}
                      </span>

                      {isEditing ? (
                        <input
                          type="text"
                          value={editingText}
                          onChange={(e) => setEditingText(e.target.value)}
                          className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-1 text-xs font-semibold text-slate-800 outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-[#3765F6]/10"
                        />
                      ) : (
                        <p className="text-xs font-semibold text-slate-800 truncate" title={phrase}>
                          {phrase}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {isEditing ? (
                        <>
                          <button
                            onClick={() => handleSaveEdit(idx)}
                            className="p-1.5 bg-[#3765F6] text-white rounded-lg hover:bg-[#2555E5] transition-colors cursor-pointer"
                            title="Сохранить"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="p-1.5 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors cursor-pointer"
                            title="Отмена"
                          >
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => handleMove(idx, 'up')}
                            disabled={idx === 0}
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 rounded-lg transition-colors cursor-pointer"
                            title="Вверх"
                          >
                            <ArrowUp size={13} />
                          </button>
                          <button
                            onClick={() => handleMove(idx, 'down')}
                            disabled={idx === phrases.length - 1}
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-20 rounded-lg transition-colors cursor-pointer"
                            title="Вниз"
                          >
                            <ArrowDown size={13} />
                          </button>
                          <button
                            onClick={() => handleStartEdit(idx)}
                            className="p-1 text-slate-400 hover:text-[#3765F6] hover:bg-[#3765F6]/5 rounded-lg transition-colors cursor-pointer"
                            title="Редактировать"
                          >
                            <Edit2 size={13} />
                          </button>
                          <button
                            onClick={() => handleDelete(idx)}
                            className="p-1 text-slate-400 hover:text-rose-500 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                            title="Удалить"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Quick Add Form */}
          <form onSubmit={handleAdd} className="mt-auto pt-4 border-t border-white/40 flex items-center gap-2.5 shrink-0">
            <input
              type="text"
              value={newPhrase}
              onChange={(e) => setNewPhrase(e.target.value)}
              placeholder="Введите новый текст для бегущей строки..."
              className="flex-1 bg-white/50 border border-slate-200/60 px-4 py-3 text-xs font-semibold rounded-2xl outline-none focus:border-[#3765F6] focus:ring-4 focus:ring-[#3765F6]/5 focus:bg-white transition-all shadow-sm"
              required
            />
            <button
              type="submit"
              className="px-5 py-3 bg-[#3765F6] hover:bg-[#2555E5] text-white text-xs font-bold rounded-2xl transition-all shadow-xs flex items-center gap-2 cursor-pointer shrink-0 active:scale-95"
            >
              <Plus size={14} />
              <span>Добавить текст</span>
            </button>
          </form>
        </div>
      </div>

      {/* Right Column: Simulated Live Preview & Role Settings */}
      <div className="xl:col-span-4 flex flex-col gap-6">
        
        {/* Live Simulation Screen */}
        <div className="bg-slate-950 rounded-[1.8rem] p-6 shadow-xl flex flex-col h-[180px] justify-between relative overflow-hidden border border-slate-800">
          <div className="absolute top-3 left-4 text-[8px] font-mono text-slate-500 font-bold tracking-widest uppercase flex items-center gap-1.5">
            <Eye size={10} className="text-[#3765F6]" />
            Симуляция бегущей строки
          </div>
          <div className="absolute top-3 right-4 text-[8px] font-mono text-[#3765F6] font-bold">
            LIVE
          </div>

          {/* Pulse Orb */}
          <div className="absolute -top-16 -right-16 w-32 h-32 rounded-full bg-[#3765F6]/10 blur-2xl" />
          
          <div className="flex-1 flex items-center justify-center pt-3">
            {phrases.length === 0 ? (
              <span className="text-xs text-slate-600 font-mono italic">Ratipa Marquee Ticker</span>
            ) : (
              <div className="text-center space-y-1.5 animate-in fade-in duration-500">
                <span className="text-[9px] font-mono text-slate-500 uppercase tracking-widest font-black leading-none block">
                  Бегущая строка Ratipa
                </span>
                <p className="text-sm font-bold text-white tracking-wide text-transparent bg-clip-text bg-gradient-to-r from-white via-slate-100 to-[#3765F6] px-2">
                  "{phrases[previewIndex]}"
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-1">
            {phrases.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  previewIndex === i ? 'w-4.5 bg-[#3765F6]' : 'w-1.5 bg-slate-800'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Roles Limitations Card */}
        <div className="bg-white/40 border border-white/45 backdrop-blur-xl rounded-[1.8rem] p-6 shadow-sm flex flex-col flex-1 justify-between">
          <div className="space-y-4">
            <div className="border-b border-white/40 pb-3 flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-[#3765F6]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Ограничение по ролям
              </h3>
            </div>
            
            <p className="text-[10px] text-slate-500 font-medium leading-relaxed">
              Выберите роли, сотрудники которых будут видеть бегущую строку. Если никто не выбран или выбраны все, ограничение отключается.
            </p>

            <div className="space-y-1.5 max-h-[190px] overflow-y-auto pr-1 custom-scrollbar">
              {rolesList.map((role) => {
                const isSelected = settings?.customPhrasesRoles?.includes(role.id) || false;
                const isEveryoneMode = !settings?.customPhrasesRoles || settings.customPhrasesRoles.length === 0;

                return (
                  <button
                    key={role.id}
                    onClick={() => handleToggleRole(role.id)}
                    className={`w-full text-left px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center justify-between border transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? 'bg-[#3765F6] text-white border-[#3765F6] shadow-sm'
                        : isEveryoneMode
                        ? 'bg-[#3765F6]/5 text-[#3765F6] border-dashed border-[#3765F6]/20 hover:bg-[#3765F6]/10'
                        : 'bg-white/50 border-white/50 text-slate-600 hover:bg-white/80 hover:text-slate-800'
                    }`}
                  >
                    <span>{role.label}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      isSelected ? 'bg-white' : isEveryoneMode ? 'bg-[#3765F6]' : 'bg-slate-300'
                    }`} />
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-[9.5px] text-slate-400 font-semibold font-mono mt-4 pt-3 border-t border-white/20">
            * Синий пунктир означает, что роль видит бегущую строку (активен глобальный режим видимости для всех).
          </p>
        </div>

      </div>

    </div>
  );
}

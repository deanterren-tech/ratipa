import React, {useState, useEffect} from 'react'
import {AppSettings} from '../../types'
import {Sparkles, Plus, Trash2, ArrowUp, ArrowDown, Check, Edit2, X, Eye, ShieldAlert} from 'lucide-react'
import { UI } from '../../ui/kit';
import { SectionHeader } from '../../ui/components';

interface Props {
  settings: AppSettings | null;
  onSave: (newSettings: AppSettings) => void;
}

const iconBtnDanger = 'inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer';

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
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 w-full">
      
      {/* Левая колонка: список и управление */}
      <div className="xl:col-span-8 flex flex-col gap-4">
        <SectionHeader
          icon={<Sparkles className="w-4 h-4" />}
          tone="accent"
          title="Редактор текстов бегущей строки"
        >
          <span className={UI.countBadge}>Всего записей: {phrases.length}</span>
        </SectionHeader>

        <p className={UI.hint}>
          Эти тексты поочередно отображаются и плавно сменяются в бегущей строке в верхней панели управления системы. Смена происходит каждые 4 секунды. Вы можете добавлять новые объявления, редактировать существующие, менять их приоритет (порядок) или удалять в реальном времени.
        </p>

        {/* Список текстов */}
        <div className="flex-1 overflow-y-auto max-h-[380px] pr-1 flex flex-col gap-0.5 custom-scrollbar">
          {phrases.length === 0 ? (
            <div className="py-12 text-center">
              <Sparkles size={24} className="mx-auto mb-2 text-[#D1D5DB]" />
              <p className="text-xs font-medium text-[#4B5563]">Бегущая строка пуста</p>
              <p className="text-xs text-[#6B7280] mt-1">Добавьте первый текст в поле ниже</p>
            </div>
          ) : (
            phrases.map((phrase, idx) => {
              const isEditing = editingIndex === idx;
              const isCurrentPreview = previewIndex === idx;

              return (
                <div
                  key={idx}
                  className={`group flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl transition-colors ${
                    isCurrentPreview ? 'bg-[var(--accent-10)]' : 'hover:bg-[#F9FAFB]'
                  }`}
                >
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded-md shrink-0 ${
                      isCurrentPreview ? 'bg-[var(--accent)] text-[var(--accent-on)]' : 'bg-[#F3F4F6] text-[#4B5563]'
                    }`}>
                      #{idx + 1}
                    </span>

                    {isEditing ? (
                      <input
                        type="text"
                        value={editingText}
                        onChange={(e) => setEditingText(e.target.value)}
                        className={`${UI.inputSm} flex-1`}
                      />
                    ) : (
                      <p className={`text-xs truncate ${isCurrentPreview ? 'font-semibold text-[#121316]' : 'text-[#4B5563]'}`} title={phrase}>
                        {phrase}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0">
                    {isEditing ? (
                      <>
                        <button
                          onClick={() => handleSaveEdit(idx)}
                          className="inline-flex items-center justify-center p-1.5 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] transition-colors cursor-pointer"
                          title="Сохранить"
                        >
                          <Check size={13} />
                        </button>
                        <button
                          onClick={() => setEditingIndex(null)}
                          className={UI.buttonIcon}
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
                          className={`${UI.buttonIcon} disabled:opacity-20 disabled:cursor-not-allowed`}
                          title="Вверх"
                        >
                          <ArrowUp size={13} />
                        </button>
                        <button
                          onClick={() => handleMove(idx, 'down')}
                          disabled={idx === phrases.length - 1}
                          className={`${UI.buttonIcon} disabled:opacity-20 disabled:cursor-not-allowed`}
                          title="Вниз"
                        >
                          <ArrowDown size={13} />
                        </button>
                        <button
                          onClick={() => handleStartEdit(idx)}
                          className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-[var(--accent-ink)] hover:bg-[var(--accent-10)] transition-colors cursor-pointer"
                          title="Редактировать"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(idx)}
                          className={iconBtnDanger}
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

        {/* Быстрое добавление */}
        <form onSubmit={handleAdd} className="mt-auto pt-4 border-t border-[#E5E7EB] flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
          <input
            type="text"
            value={newPhrase}
            onChange={(e) => setNewPhrase(e.target.value)}
            placeholder="Введите новый текст для бегущей строки..."
            className={`${UI.input} flex-1`}
            required
          />
          <button
            type="submit"
            className={`${UI.buttonPrimary} shrink-0`}
          >
            <Plus size={14} />
            Добавить текст
          </button>
        </form>
      </div>

      {/* Правая колонка: предпросмотр и роли */}
      <div className="xl:col-span-4 flex flex-col gap-4">
        
        {/* Симуляция бегущей строки */}
        <div className="bg-[#121316] rounded-2xl p-5 flex flex-col h-[180px] justify-between relative overflow-hidden">
          <div className="flex items-center justify-between text-[11px] font-mono uppercase tracking-wider">
            <span className="flex items-center gap-1.5 text-[#9CA3AF]">
              <Eye size={11} className="text-[var(--accent)]" />
              Симуляция бегущей строки
            </span>
            <span className="text-[var(--accent)] font-bold">LIVE</span>
          </div>

          <div className="flex-1 flex items-center justify-center">
            {phrases.length === 0 ? (
              <span className="text-xs text-[#6B7280] font-mono italic">Ratipa Marquee Ticker</span>
            ) : (
              <div className="text-center space-y-1.5">
                <span className="text-[10px] font-mono text-[#9CA3AF] uppercase tracking-widest block">
                  Бегущая строка Ratipa
                </span>
                <p className="text-sm font-semibold text-white tracking-wide px-2">
                  «{phrases[previewIndex]}»
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center gap-1">
            {phrases.map((_, i) => (
              <span
                key={i}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  previewIndex === i ? 'w-4 bg-[var(--accent)]' : 'w-1.5 bg-[#4B5563]'
                }`}
              />
            ))}
          </div>
        </div>

        {/* Ограничение по ролям */}
        <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col flex-1 justify-between gap-4">
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-2.5 pb-3 border-b border-[#E5E7EB]">
              <div className="p-2 bg-[#F3F4F6] text-[#121316] rounded-xl">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <h3 className="text-sm font-semibold text-[#121316]">
                Ограничение по ролям
              </h3>
            </div>
            
            <p className={UI.hint}>
              Выберите роли, сотрудники которых будут видеть бегущую строку. Если никто не выбран или выбраны все — ограничение отключается.
            </p>

            <div className="flex flex-col gap-1.5 max-h-[190px] overflow-y-auto pr-1 custom-scrollbar">
              {rolesList.map((role) => {
                const isSelected = settings?.customPhrasesRoles?.includes(role.id) || false;
                const isEveryoneMode = !settings?.customPhrasesRoles || settings.customPhrasesRoles.length === 0;

                return (
                  <button
                    key={role.id}
                    onClick={() => handleToggleRole(role.id)}
                    className={`w-full text-left px-3 py-2 rounded-xl text-xs font-medium flex items-center justify-between gap-2 border transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[var(--accent)] text-[var(--accent-on)] border-transparent'
                        : isEveryoneMode
                        ? 'bg-[#F9FAFB] text-[#4B5563] border-[#E5E7EB] hover:bg-[#F3F4F6]'
                        : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:bg-[#F3F4F6]'
                    }`}
                  >
                    <span>{role.label}</span>
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isSelected ? 'bg-[var(--accent-on)]' : isEveryoneMode ? 'bg-[var(--accent)]' : 'bg-[#D1D5DB]'
                    }`} />
                  </button>
                );
              })}
            </div>
          </div>

          <p className="text-[11px] text-[#9CA3AF] leading-relaxed pt-3 border-t border-[#E5E7EB]">
            * Акцентная точка означает, что роль видит бегущую строку (активен глобальный режим видимости для всех).
          </p>
        </div>

      </div>

    </div>
  );
}

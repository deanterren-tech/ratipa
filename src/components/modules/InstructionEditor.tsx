import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Check,
  ClipboardList,
  Eye,
  GripVertical,
  Lightbulb,
  ListChecks,
  Pencil,
  Plus,
  Save,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import type {
  InstructionData,
  InstructionDraft,
  InstructionStepItem,
} from './instructionsData';
import {
  MODULE_LINKS,
  cleanInstructionText,
  draftFingerprint,
  draftToInstruction,
  instructionToDraft,
  newStepId,
} from './instructionsData';
import { AutoGrowTextarea, InstructionBody, SectionHeading, StepBadge } from './instructionUi';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { parseHash } from '../../hooks/useHashRoute';

/**
 * Редактор инструкции в виде готовой страницы: название — на месте заголовка,
 * разделы — в итоговом оформлении, «Порядок действий» — отдельные нумерованные
 * шаги с автонумерацией, перестановкой (перетаскиванием и кнопками), отменой
 * удаления и мобильным управлением.
 *
 * Здесь же живут служебные вещи: панель «Сохранить / Отмена» поверх страницы,
 * индикатор несохранённых изменений, предупреждение при выходе и переключатель
 * «Редактирование / Просмотр» (просмотр показывает черновик без сохранения).
 */

export interface InstructionEditorProps {
  /** Запись из базы или пустой шаблон для новой инструкции. */
  initial: InstructionData;
  isNew: boolean;
  /** Известные темы — подсказки для поля темы. */
  themes: string[];
  saving: boolean;
  /** Сохранить. Возвращает true, если запись записана (родитель закроет редактор). */
  onSave: (data: InstructionData) => Promise<boolean>;
  /** Закрыть редактор без записи (выход уже подтверждён или изменений нет). */
  onExit: () => void;
}

type ListField = 'prerequisites' | 'tips';

export default function InstructionEditor({
  initial,
  isNew,
  themes,
  saving,
  onSave,
  onExit,
}: InstructionEditorProps) {
  const [draft, setDraft] = useState<InstructionDraft>(() => instructionToDraft(initial));
  const [mode, setMode] = useState<'edit' | 'view'>('edit');
  const [undoSolo, setUndoSolo] = useState<{ item: InstructionStepItem; index: number } | null>(null);
  const [insertFor, setInsertFor] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<{ id: string; edge: 'above' | 'below' } | null>(null);
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const { showConfirm } = useDialog();
  const { toast } = useToast();

  const [baseline] = useState(() => draftFingerprint(instructionToDraft(initial)));
  const dirty = useMemo(() => draftFingerprint(draft) !== baseline, [draft, baseline]);

  // ——— Несохранённые изменения: индикатор, внутренняя навигация, закрытие окна ———
  const dirtyRef = useRef(dirty);
  const onExitRef = useRef(onExit);
  const allowLeaveRef = useRef(false);
  const hashRef = useRef(typeof window === 'undefined' ? '' : window.location.hash);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  useEffect(() => { onExitRef.current = onExit; }, [onExit]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  /** Уход из модуля по хеш-навигации: возвращаем адрес и спрашиваем подтверждение. */
  useEffect(() => {
    const onHashChange = () => {
      const target = window.location.hash;
      if (parseHash(target).module === 'instructions') {
        hashRef.current = target;
        return;
      }
      if (allowLeaveRef.current || !dirtyRef.current) return;
      const back = hashRef.current || '#instructions';
      window.location.hash = back;
      void showConfirm(
        'Есть несохранённые изменения. Выйти без сохранения?',
        'Не сохранено',
        { confirmLabel: 'Выйти без сохранения', cancelLabel: 'Остаться' },
      ).then((ok) => {
        if (!ok) return;
        allowLeaveRef.current = true;
        onExitRef.current();
        window.location.hash = target;
      });
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, [showConfirm]);

  const requestExit = () => {
    if (!dirty) {
      onExit();
      return;
    }
    void showConfirm(
      'Есть несохранённые изменения. Выйти без сохранения?',
      'Не сохранено',
      { confirmLabel: 'Выйти без сохранения', cancelLabel: 'Остаться' },
    ).then((ok) => {
      if (ok) onExit();
    });
  };

  const handleSave = async () => {
    if (!draft.title.trim() || !draft.summary.trim() || draft.steps.every((s) => !cleanInstructionText(s.text))) {
      toast('Заполните название, описание и хотя бы один шаг.', 'error');
      if (mode === 'view') setMode('edit');
      return;
    }
    const data = draftToInstruction({
      ...draft,
      id: draft.id || `instr-${Date.now().toString(36)}`,
    });
    await onSave(data);
  };

  // ——— Правки ———
  const updateDraft = (patch: Partial<InstructionDraft>) => setDraft((d) => ({ ...d, ...patch }));

  const updateStepText = (id: string, text: string) =>
    setDraft((d) => ({ ...d, steps: d.steps.map((s) => (s.id === id ? { ...s, text } : s)) }));

  const moveStep = (id: string, dir: -1 | 1) =>
    setDraft((d) => {
      const i = d.steps.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= d.steps.length) return d;
      const steps = [...d.steps];
      [steps[i], steps[j]] = [steps[j], steps[i]];
      return { ...d, steps };
    });

  const insertStep = (index: number) => {
    const item: InstructionStepItem = { id: newStepId(), text: '' };
    setDraft((d) => {
      const steps = [...d.steps];
      steps.splice(Math.min(Math.max(index, 0), steps.length), 0, item);
      return { ...d, steps };
    });
    setInsertFor(null);
    setFocusKey(`step:${item.id}`);
  };

  /** Удаление непустого шага можно отменить — вернуть его обратно. */
  const deleteStep = (id: string) => {
    const i = draft.steps.findIndex((s) => s.id === id);
    if (i < 0) return;
    const item = draft.steps[i];
    if (cleanInstructionText(item.text).length > 0) {
      setUndoSolo({ item, index: i });
    } else {
      setUndoSolo(null);
    }
    if (insertFor === id) setInsertFor(null);
    setDraft((d) => ({ ...d, steps: d.steps.filter((s) => s.id !== id) }));
  };

  const undoDelete = () => {
    if (!undoSolo) return;
    const { item, index } = undoSolo;
    setDraft((d) => {
      const steps = [...d.steps];
      steps.splice(Math.min(Math.max(index, 0), steps.length), 0, item);
      return { ...d, steps };
    });
    setUndoSolo(null);
  };

  // Отмена удаления живёт ограниченное время — потом убираем подсказку.
  useEffect(() => {
    if (!undoSolo) return;
    const t = window.setTimeout(() => setUndoSolo(null), 12000);
    return () => window.clearTimeout(t);
  }, [undoSolo]);

  // ——— Перетаскивание шагов (работает и мышью, и пальцем) ———
  const stepRowsRef = useRef(new Map<string, HTMLDivElement>());
  const dragOverRef = useRef<typeof dragOver>(null);
  useEffect(() => { dragOverRef.current = dragOver; }, [dragOver]);

  const commitDrag = (id: string) => {
    const over = dragOverRef.current;
    if (!over || over.id === id) return;
    setDraft((d) => {
      const from = d.steps.findIndex((s) => s.id === id);
      if (from < 0) return d;
      const steps = [...d.steps];
      const [item] = steps.splice(from, 1);
      let to = steps.findIndex((s) => s.id === over.id);
      if (to < 0) return d;
      if (over.edge === 'below') to += 1;
      steps.splice(to, 0, item);
      return { ...d, steps };
    });
  };

  useEffect(() => {
    if (!dragId) return;
    const onMove = (e: PointerEvent) => {
      let over: { id: string; edge: 'above' | 'below' } | null = null;
      stepRowsRef.current.forEach((el, id) => {
        if (id === dragId) return;
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) {
          over = { id, edge: e.clientY < r.top + r.height / 2 ? 'above' : 'below' };
        }
      });
      setDragOver(over);
    };
    const onUp = () => {
      commitDrag(dragId);
      setDragId(null);
      setDragOver(null);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  // ——— Фокус: после добавления сразу становимся в новый блок ———
  const taRefs = useRef(new Map<string, HTMLTextAreaElement>());
  const registerTa = (key: string) => (el: HTMLTextAreaElement | null) => {
    if (el) taRefs.current.set(key, el);
    else taRefs.current.delete(key);
  };

  useEffect(() => {
    if (!focusKey) return;
    const el = taRefs.current.get(focusKey);
    if (!el) return;
    el.focus();
    const len = el.value.length;
    try { el.setSelectionRange(len, len); } catch { /* не критично */ }
    el.scrollIntoView({ block: 'nearest' });
    setFocusKey(null);
  }, [focusKey, draft.steps, draft.prerequisites, draft.tips]);

  // ——— Списки «Что понадобится» и «Подсказки» ———
  const updateList = (field: ListField, index: number, value: string) =>
    setDraft((d) => {
      const arr = [...d[field]];
      if (arr.length === 0) arr.push('');
      arr[index] = value;
      return { ...d, [field]: arr };
    });

  const removeListItem = (field: ListField, index: number) =>
    setDraft((d) => ({ ...d, [field]: d[field].filter((_, i) => i !== index) }));

  const addListItem = (field: ListField) => {
    const nextIndex = draft[field].length;
    setDraft((d) => ({ ...d, [field]: [...d[field], ''] }));
    setFocusKey(`list:${field}:${nextIndex}`);
  };

  const listRows = (field: ListField): string[] => {
    const arr = draft[field];
    return arr.length > 0 ? arr : [''];
  };

  // ——— Ссылки ———
  const updateLink = (index: number, module: string) => {
    const found = MODULE_LINKS.find((m) => m.module === module);
    setDraft((d) => {
      const links = [...d.links];
      links[index] = { module, label: found?.label || module };
      return { ...d, links };
    });
  };
  const removeLink = (index: number) =>
    setDraft((d) => ({ ...d, links: d.links.filter((_, i) => i !== index) }));
  const addLink = () => setDraft((d) => ({ ...d, links: [...d.links, { label: '', module: '' }] }));

  const preview = useMemo(() => draftToInstruction(draft), [draft]);

  /**
   * Высота редактора привязывается к видимой области: панель действий и содержимое
   * целиком помещаются на экран, прокручивается только середина (своя область).
   * Так «Сохранить / Отмена» доступны при любой прокрутке, независимо от раскладки окна.
   */
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [editorHeight, setEditorHeight] = useState<number | null>(null);
  useEffect(() => {
    const compute = () => {
      const root = rootRef.current;
      const main = root ? root.closest('main') : null;
      const headerH = document.querySelector('header')?.getBoundingClientRect().height || 0;
      let padTop = 0;
      let padBottom = 0;
      if (main) {
        const cs = getComputedStyle(main);
        padTop = parseFloat(cs.paddingTop) || 0;
        padBottom = parseFloat(cs.paddingBottom) || 0;
      }
      const h = Math.round(window.innerHeight - headerH - padTop - padBottom);
      setEditorHeight((prev) => (h > 360 && (prev === null || Math.abs(prev - h) > 2) ? h : prev === null ? h : prev));
    };
    compute();
    window.addEventListener('resize', compute);
    return () => window.removeEventListener('resize', compute);
  }, []);

  return (
    <div
      ref={rootRef}
      className="flex w-full flex-col"
      style={editorHeight ? { height: `${editorHeight}px` } : { height: '100%' }}
    >
      {/* Панель действий: всегда доступна, содержимое прокручивается под ней */}
      <div className="shrink-0 border-b border-[#E5E7EB] bg-white px-3 py-2 sm:px-6">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-2 gap-y-1.5">
          <button
            type="button"
            onClick={requestExit}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2.5 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            Назад
          </button>

          <div className="flex items-center rounded-xl bg-[#F3F4F6] p-0.5" role="group" aria-label="Режим редактора">
            <button
              type="button"
              aria-pressed={mode === 'edit'}
              onClick={() => setMode('edit')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-3 text-[11px] font-semibold transition-colors md:min-h-[36px] ${
                mode === 'edit' ? 'bg-white text-[#121316] shadow-sm' : 'text-[#6B7280] hover:text-[#121316]'
              }`}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Редактирование
            </button>
            <button
              type="button"
              aria-pressed={mode === 'view'}
              onClick={() => setMode('view')}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-[10px] px-3 text-[11px] font-semibold transition-colors md:min-h-[36px] ${
                mode === 'view' ? 'bg-white text-[#121316] shadow-sm' : 'text-[#6B7280] hover:text-[#121316]'
              }`}
            >
              <Eye className="h-3.5 w-3.5" aria-hidden="true" />
              Просмотр
            </button>
          </div>

          <span aria-live="polite" className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-medium">
            {dirty ? (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500" aria-hidden="true" />
                <span className="text-amber-700">Есть несохранённые изменения</span>
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
                <span className="text-[#6B7280]">{isNew ? 'Новая инструкция' : 'Изменений нет'}</span>
              </>
            )}
          </span>

          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--accent-solid)] px-4 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] disabled:opacity-60"
          >
            <Save className="h-3.5 w-3.5" aria-hidden="true" />
            {saving ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <button
            type="button"
            onClick={requestExit}
            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-[#E5E7EB] bg-white px-4 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
          >
            Отмена
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-4 sm:px-6">
        {mode === 'view' ? (
          <>
            {dirty && (
              <div className="mx-auto mb-3 w-full max-w-3xl rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
                Это предпросмотр черновика: изменения ещё не сохранены.
              </div>
            )}
            <InstructionBody data={preview} interactiveLinks={false} />
          </>
        ) : (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
            {/* ——— Название и описание: редактируются на месте заголовка ——— */}
            <div>
              <input
                list="instr-editor-themes"
                value={draft.theme}
                onChange={(e) => updateDraft({ theme: e.target.value })}
                placeholder="Тема или процесс…"
                aria-label="Тема или рабочий процесс"
                title="Тема: по ней инструкция группируется в списке"
                className="inline-flex h-9 w-auto min-w-[150px] max-w-full cursor-pointer items-center rounded-full border border-[#E5E7EB] bg-white px-3 text-[10px] font-semibold uppercase tracking-wider text-[#4B5563] transition focus:border-[var(--accent-ui)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)]"
              />
              <datalist id="instr-editor-themes">
                {themes.map((t) => <option key={t} value={t} />)}
              </datalist>

              <AutoGrowTextarea
                value={draft.title}
                onChange={(v) => updateDraft({ title: v })}
                placeholder="Название ситуации — например: машина сломалась в рейсе"
                ariaLabel="Название ситуации"
                className="-mx-1 mt-2 rounded-lg px-1 text-2xl font-semibold leading-tight tracking-tight text-[#121316] transition-colors placeholder:text-[#C2C8D0] hover:bg-[#F3F4F6]/60 focus:bg-[#F3F4F6]/60 focus:ring-2 focus:ring-[var(--accent-20)] sm:text-3xl"
              />

              <AutoGrowTextarea
                value={draft.summary}
                onChange={(v) => updateDraft({ summary: v })}
                placeholder="Коротко: когда и зачем выполнять — это описание под заголовком"
                ariaLabel="Когда и зачем выполнять"
                className="-mx-1 mt-2 rounded-lg px-1 text-sm leading-relaxed text-[#4B5563] transition-colors placeholder:text-[#B6BDC6] hover:bg-[#F3F4F6]/60 focus:bg-[#F3F4F6]/60 focus:ring-2 focus:ring-[var(--accent-20)]"
              />

              <label className="mt-3 flex min-h-[44px] cursor-pointer items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2.5 text-xs leading-relaxed text-[#4B5563] transition-colors hover:bg-[#F9FAFB]">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={draft.needsWork}
                  onChange={(e) => updateDraft({ needsWork: e.target.checked })}
                />
                <span>Требует уточнения — порядок шагов ещё не согласован</span>
              </label>
            </div>

            {/* ——— Что понадобится ——— */}
            <section>
              <SectionHeading icon={ClipboardList}>Что понадобится</SectionHeading>
              <div className="mt-2 rounded-2xl border border-[#E5E7EB] bg-white p-2 sm:p-3">
                <div className="flex flex-col gap-1">
                  {listRows('prerequisites').map((value, i) => (
                    <ListItemRow
                      key={i}
                      value={value}
                      placeholder={i === 0 ? 'Например: номер бланка или право на изменение раздела' : 'Ещё один пункт…'}
                      ariaLabel={`Пункт «Что понадобится», ${i + 1}`}
                      onChange={(v) => updateList('prerequisites', i, v)}
                      onRemove={draft.prerequisites.length > i ? () => removeListItem('prerequisites', i) : undefined}
                      registerRef={registerTa(`list:prerequisites:${i}`)}
                    />
                  ))}
                </div>
                <AddRowButton label="Добавить пункт" onClick={() => addListItem('prerequisites')} />
              </div>
            </section>

            {/* ——— Порядок действий: отдельные нумерованные шаги ——— */}
            <section>
              <SectionHeading icon={ListChecks}>Порядок действий</SectionHeading>
              <div className="mt-2 rounded-2xl border border-[#E5E7EB] bg-white p-2 sm:p-3">
                {draft.steps.length === 0 && (
                  <p className="px-2 py-3 text-xs leading-relaxed text-[#9CA3AF]">
                    Пока ни одного шага. Опишите первый шаг — Enter внутри шага добавляет абзац и не создаёт новый шаг.
                  </p>
                )}
                {draft.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    ref={(el) => {
                      if (el) stepRowsRef.current.set(step.id, el);
                      else stepRowsRef.current.delete(step.id);
                    }}
                    className={`relative rounded-xl px-1 py-1.5 transition-colors sm:px-2 ${
                      dragId === step.id ? 'opacity-50' : 'hover:bg-[#F9FAFB] focus-within:bg-[#F9FAFB]'
                    }`}
                  >
                    {dragOver && dragOver.id === step.id && dragOver.edge === 'above' && (
                      <span className="pointer-events-none absolute -top-px left-2 right-2 h-0.5 rounded-full bg-[var(--accent-ui)]" aria-hidden="true" />
                    )}
                    {dragOver && dragOver.id === step.id && dragOver.edge === 'below' && (
                      <span className="pointer-events-none absolute -bottom-px left-2 right-2 h-0.5 rounded-full bg-[var(--accent-ui)]" aria-hidden="true" />
                    )}

                    <div className="flex items-start gap-1.5 sm:gap-2">
                      <button
                        type="button"
                        aria-label={`Перетащить шаг ${idx + 1}`}
                        title="Перетащить, чтобы изменить порядок"
                        onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
                          e.preventDefault();
                          setInsertFor(null);
                          setDragId(step.id);
                          setDragOver(null);
                        }}
                        style={{ touchAction: 'none' }}
                        className="-ml-0.5 flex min-h-[44px] min-w-[44px] cursor-grab items-center justify-center rounded-lg text-[#C2C8D0] transition-colors hover:text-[#6B7280] active:cursor-grabbing md:min-h-[36px] md:min-w-[24px]"
                      >
                        <GripVertical className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <StepBadge n={idx + 1} className="mt-2" />
                      <AutoGrowTextarea
                        value={step.text}
                        onChange={(v) => updateStepText(step.id, v)}
                        placeholder={idx === 0 ? 'Что сделать: первый шаг…' : 'Что сделать…'}
                        ariaLabel={`Шаг ${idx + 1}`}
                        taRef={registerTa(`step:${step.id}`)}
                        className="min-w-0 flex-1 rounded-lg px-1 pt-1.5 text-sm leading-relaxed text-[#121316] placeholder:text-[#C2C8D0] focus:ring-2 focus:ring-[var(--accent-20)]"
                      />
                    </div>

                    <div className="mt-0.5 flex flex-wrap items-center justify-end gap-0.5 pl-9">
                      <StepIconButton label={`Переместить шаг ${idx + 1} вверх`} disabled={idx === 0} onClick={() => moveStep(step.id, -1)}>
                        <ArrowUp className="h-4 w-4" aria-hidden="true" />
                      </StepIconButton>
                      <StepIconButton label={`Переместить шаг ${idx + 1} вниз`} disabled={idx === draft.steps.length - 1} onClick={() => moveStep(step.id, 1)}>
                        <ArrowDown className="h-4 w-4" aria-hidden="true" />
                      </StepIconButton>
                      <StepIconButton
                        label={`Добавить шаг выше или ниже шага ${idx + 1}`}
                        active={insertFor === step.id}
                        onClick={() => setInsertFor(insertFor === step.id ? null : step.id)}
                      >
                        <Plus className="h-4 w-4" aria-hidden="true" />
                      </StepIconButton>
                      <StepIconButton label={`Удалить шаг ${idx + 1}`} tone="danger" onClick={() => deleteStep(step.id)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </StepIconButton>
                    </div>

                    {insertFor === step.id && (
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 border-t border-[#F3F4F6] px-1 pt-2">
                        <button
                          type="button"
                          onClick={() => insertStep(idx)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 text-[11px] font-medium text-[#4B5563] transition-colors hover:bg-[#F9FAFB] hover:text-[#121316]"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          Добавить шаг выше
                        </button>
                        <button
                          type="button"
                          onClick={() => insertStep(idx + 1)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-3 text-[11px] font-medium text-[#4B5563] transition-colors hover:bg-[#F9FAFB] hover:text-[#121316]"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          Добавить шаг ниже
                        </button>
                        <button
                          type="button"
                          onClick={() => setInsertFor(null)}
                          aria-label="Закрыть выбор места шага"
                          title="Закрыть"
                          className="ml-auto inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
                        >
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}

                {undoSolo && (
                  <div role="status" className="mt-1 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-1.5">
                    <span className="text-[11px] text-[#4B5563]">Шаг удалён.</span>
                    <button
                      type="button"
                      onClick={undoDelete}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg px-2 text-[11px] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-10)]"
                    >
                      <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
                      Вернуть шаг
                    </button>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => insertStep(draft.steps.length)}
                className="mt-2 inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#D1D5DB] bg-white px-4 text-xs font-semibold text-[#4B5563] transition-colors hover:bg-[#F9FAFB] hover:text-[#121316] sm:w-auto"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить шаг
              </button>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#9CA3AF]">
                Каждый шаг — отдельный пункт с автоматическим номером. Кнопки со стрелками или перетаскивание меняют порядок.
              </p>
            </section>

            {/* ——— Подсказки и частые ошибки ——— */}
            <section>
              <SectionHeading icon={Lightbulb}>Подсказки и частые ошибки</SectionHeading>
              <div className="mt-2 rounded-2xl border border-[#E5E7EB] bg-white p-2 sm:p-3">
                <div className="flex flex-col gap-1">
                  {listRows('tips').map((value, i) => (
                    <ListItemRow
                      key={i}
                      value={value}
                      placeholder={i === 0 ? 'Например: что часто забывают сделать' : 'Ещё одна подсказка…'}
                      ariaLabel={`Подсказка, ${i + 1}`}
                      onChange={(v) => updateList('tips', i, v)}
                      onRemove={draft.tips.length > i ? () => removeListItem('tips', i) : undefined}
                      registerRef={registerTa(`list:tips:${i}`)}
                    />
                  ))}
                </div>
                <AddRowButton label="Добавить подсказку" onClick={() => addListItem('tips')} />
              </div>
            </section>

            {/* ——— Где это в приложении ——— */}
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Где это в приложении</h2>
              <div className="mt-2 flex flex-col gap-2">
                {draft.links.length === 0 && (
                  <p className="text-[11px] leading-relaxed text-[#9CA3AF]">
                    Ссылок нет. Ниже можно добавить готовую кнопку-ссылку на раздел приложения — в инструкции она появится под шагами.
                  </p>
                )}
                {draft.links.map((link, idx) => (
                  <div key={idx} className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <select
                      value={link.module}
                      onChange={(e) => updateLink(idx, e.target.value)}
                      aria-label={`Раздел приложения для ссылки ${idx + 1}`}
                      className={`min-h-[44px] w-full rounded-xl px-3 text-xs font-semibold transition focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)] sm:min-h-[44px] sm:w-72 ${
                        link.module
                          ? 'cursor-pointer border border-transparent bg-[var(--accent-solid)] text-[var(--accent-on)]'
                          : 'cursor-pointer border border-[#E5E7EB] bg-white text-[#6B7280]'
                      }`}
                    >
                      <option value="">Выберите раздел…</option>
                      {MODULE_LINKS.map((m) => (
                        <option key={m.module} value={m.module}>{m.label}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => removeLink(idx)}
                      aria-label={`Убрать ссылку ${idx + 1}`}
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-rose-600 sm:w-auto"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                      Убрать
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addLink}
                  className="inline-flex min-h-[44px] w-fit items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-white px-4 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F9FAFB] hover:text-[#121316]"
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                  Добавить ссылку
                </button>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

/** Строка списка («Что понадобится», «Подсказки»): блок с авторазмером и удалением. */
function ListItemRow({
  value,
  placeholder,
  ariaLabel,
  onChange,
  onRemove,
  registerRef,
}: {
  value: string;
  placeholder: string;
  ariaLabel: string;
  onChange: (value: string) => void;
  onRemove?: () => void;
  registerRef: (el: HTMLTextAreaElement | null) => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-xl px-1.5 py-1 transition-colors hover:bg-[#F9FAFB] focus-within:bg-[#F9FAFB]">
      <span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9CA3AF]" aria-hidden="true" />
      <AutoGrowTextarea
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        ariaLabel={ariaLabel}
        taRef={registerRef}
        className="min-w-0 flex-1 rounded-lg px-1 pt-1.5 text-sm leading-relaxed text-[#121316] placeholder:text-[#C2C8D0] focus:ring-2 focus:ring-[var(--accent-20)]"
      />
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`${ariaLabel}: убрать`}
          title="Убрать"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-rose-50 hover:text-rose-600 md:min-h-0 md:min-w-0 md:p-1.5"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/** Кнопка «добавить пункт/подсказку» внутри списка. */
function AddRowButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 rounded-xl px-2.5 text-[11px] font-medium text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-10)]"
    >
      <Plus className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Иконка-кнопка управления шагом: на мобильном — цель 44×44. */
function StepIconButton({
  label,
  onClick,
  children,
  disabled = false,
  tone = 'default',
  active = false,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  tone?: 'default' | 'danger';
  active?: boolean;
}) {
  const cls = disabled
    ? 'text-[#E5E7EB]'
    : tone === 'danger'
      ? 'text-[#9CA3AF] hover:bg-rose-50 hover:text-rose-600'
      : active
        ? 'bg-[var(--accent-10)] text-[var(--accent-ink)]'
        : 'text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#121316]';
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg transition-colors md:min-h-[36px] md:min-w-[36px] ${cls}`}
    >
      {children}
    </button>
  );
}

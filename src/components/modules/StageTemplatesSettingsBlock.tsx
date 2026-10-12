/**
 * «Шаблоны этапов» (Настройки → Системные настройки) — управление веткой
 * `stageTemplates`: УПОРЯДОЧЕННЫЕ списки НАЗВАНИЙ этапов (без мест и дат).
 *
 * Доступ: ТОЛЬКО администратор (root_admin / admin) — для остальных блока нет.
 * Возможности: создать/переименовать/удалить шаблон, менять порядок этапов,
 * добавлять/удалять/переименовывать этапы внутри шаблона.
 *
 * Применение шаблонов — кнопка «Из шаблона» в окне рейса (создаёт этапы с
 * пустыми местом и датами; при непустом списке — «в конец» или «заменить
 * пустые», внесённые данные не затираются). Автоподстановка по направлению в
 * «Новом рейсе» — отдельная опция и по умолчанию ВЫКЛЮЧЕНА.
 *
 * Пока ветка пуста, показываются стартовые «Турция»/«Китай» (по факту реальных
 * рейсов, lib/stageTemplates); первое сохранение становится записью базы.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Layers, Plus, Trash2, TriangleAlert } from 'lucide-react';
import type { UserProfile } from '../../types';
import { dbService } from '../../api';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { UI } from '../../ui/kit';
import { SectionHeader } from '../../ui/components';
import { isAdminRole } from './tripTimeline/lib/stageRights';
import {
  addTemplateStage,
  effectiveStageTemplates,
  moveTemplateStage,
  newTemplateId,
  removeTemplateStage,
  stageTemplatesFromDb,
  templateCreatedLabel,
  type StageTemplate,
} from './tripTimeline/lib/stageTemplates';

interface WorkItem {
  name: string;
  stages: string[];
}

export default function StageTemplatesSettingsBlock({ user }: { user: UserProfile }) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [dbList, setDbList] = useState<StageTemplate[]>([]);
  const [work, setWork] = useState<Record<string, WorkItem>>({});
  /** Шаблоны, созданные в этой сессии (ещё не в базе) — не пропадают при синхронизации. */
  const sessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = dbService.getStageTemplates((store) => setDbList(stageTemplatesFromDb(store)));
    return () => unsub();
  }, []);

  /** Показ: записи базы, при пустой ветке — стартовые шаблоны. */
  const effective = useMemo(() => effectiveStageTemplates(dbList), [dbList]);

  // Синхронизация рабочей копии: новые записи базы добавляются, удалённые из
  // базы — убираются; уже правленные поля не затираются (правки пользователя).
  useEffect(() => {
    setWork((prev) => {
      const next: Record<string, WorkItem> = {};
      effective.forEach((t) => {
        next[t.id] = prev[t.id] ?? { name: t.name, stages: [...t.stages] };
      });
      sessionIdsRef.current.forEach((id) => {
        if (prev[id] && !next[id]) next[id] = prev[id];
      });
      return next;
    });
  }, [effective]);

  if (!isAdminRole(user.role)) return null;

  const ids = Object.keys(work);

  const patch = (id: string, p: Partial<WorkItem>) => setWork((prev) => ({ ...prev, [id]: { ...prev[id], ...p } }));

  const createTemplate = () => {
    const id = newTemplateId();
    sessionIdsRef.current.add(id);
    setWork((prev) => ({ ...prev, [id]: { name: 'Новый шаблон', stages: [] } }));
  };

  const saveTemplate = (id: string) => {
    const item = work[id];
    if (!item) return;
    const name = item.name.trim();
    const stages = item.stages.map((s) => s.trim()).filter(Boolean);
    if (!name) {
      toast('У шаблона должно быть название (например, «Турция»)', 'error');
      return;
    }
    // Автор/время СОЗДАНИЯ (аддитивные поля) не теряются при правке из «Шаблонов».
    const created = dbList.find((t) => t.id === id);
    dbService.saveStageTemplate(
      {
        id,
        name,
        stages,
        ...(created?.createdAt ? { createdAt: created.createdAt } : {}),
        ...(created?.createdBy ? { createdBy: created.createdBy } : {}),
      },
      user.name,
      user.role,
      `Шаблон «${name}»: ${stages.join(' → ') || 'без этапов'}`,
    );
    sessionIdsRef.current.delete(id);
    toast(`Шаблон «${name}» сохранён (${stages.length} эт.)`, 'success');
  };

  const deleteTemplate = async (id: string) => {
    const name = work[id]?.name || id;
    const inDb = dbList.some((t) => t.id === id);
    const ok = await showConfirm(
      inDb
        ? `Удалить шаблон «${name}»? Существующие рейсы не затрагиваются — шаблон лишь исчезнет из списка «Из шаблона».`
        : `Убрать шаблон «${name}» из списка?`,
      'Удаление шаблона этапов',
      { variant: 'danger', confirmLabel: 'Удалить', cancelLabel: 'Отмена' },
    );
    if (!ok) return;
    if (inDb) dbService.deleteStageTemplate(id, user.name, user.role);
    sessionIdsRef.current.delete(id);
    setWork((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast(`Шаблон «${name}» удалён`, 'success');
  };

  return (
    <div data-ui="stage-templates-settings" className="flex flex-col gap-4">
      <SectionHeader
        icon={<Layers className="w-4 h-4" aria-hidden="true" />}
        tone="graphite"
        title="Шаблоны этапов"
        subtitle="Упорядоченные списки названий этапов (без мест и дат) для кнопки «Из шаблона» в окне рейса. Доступ — только администратор."
      />
      <div className="flex flex-col gap-3">
        {ids.length === 0 ? (
          <p className="text-[11px] text-[#6B7280]">Шаблонов нет — создайте первый.</p>
        ) : (
          ids.map((id) => {
            const item = work[id];
            const inDb = dbList.some((t) => t.id === id);
            const createdLabel = templateCreatedLabel(dbList.find((t) => t.id === id));
            return (
              <div key={id} data-ui="stage-template-card" data-template-id={id} className="border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={item.name}
                    onChange={(e) => patch(id, { name: e.target.value })}
                    placeholder="Название шаблона (Турция, Китай…)"
                    aria-label="Название шаблона"
                    data-ui="stage-template-name"
                    className="h-9 min-w-[200px] flex-1 bg-white border border-[#E5E7EB] rounded-xl px-3 text-[13px] text-[#121316] outline-none transition-colors focus:border-[var(--accent)]"
                  />
                  <span className={`text-[10px] ${inDb ? 'text-[#9CA3AF]' : 'text-amber-700 font-semibold'}`}>
                    {inDb ? `id: ${id}` : 'новый — не сохранён'}
                  </span>
                  {createdLabel ? (
                    <span className="text-[10px] text-[#9CA3AF]" data-ui="stage-template-created">
                      {createdLabel}
                    </span>
                  ) : null}
                  <button type="button" onClick={() => saveTemplate(id)} data-ui="stage-template-save" className={UI.buttonPrimary}>
                    Сохранить
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteTemplate(id)}
                    data-ui="stage-template-delete"
                    title="Удалить шаблон (рейсы не затрагиваются)"
                    className={UI.buttonGhost}
                  >
                    <Trash2 className="w-4 h-4" aria-hidden="true" />
                    удалить
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {item.stages.length === 0 ? (
                    <span className="text-[11px] text-[#9CA3AF]">Этапов нет — добавьте названия ниже (порядок = порядок применения).</span>
                  ) : (
                    item.stages.map((stageName, idx) => (
                      <div key={`${id}_${idx}`} className="flex items-center gap-1.5" data-ui="stage-template-stage-row">
                        <span className="w-5 text-[10px] text-[#9CA3AF] tabular-nums text-right">{idx + 1}.</span>
                        <input
                          value={stageName}
                          onChange={(e) => patch(id, { stages: item.stages.map((s, i) => (i === idx ? e.target.value : s)) })}
                          aria-label={`Этап ${idx + 1}`}
                          className="h-8 flex-1 min-w-[160px] bg-white border border-[#E5E7EB] rounded-lg px-2.5 text-[12px] text-[#121316] outline-none transition-colors focus:border-[var(--accent)]"
                        />
                        <button
                          type="button"
                          onClick={() => patch(id, { stages: moveTemplateStage(item.stages, idx, -1) })}
                          disabled={idx === 0}
                          aria-label="Выше"
                          className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#4B5563] disabled:opacity-40 cursor-pointer"
                        >
                          <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => patch(id, { stages: moveTemplateStage(item.stages, idx, 1) })}
                          disabled={idx === item.stages.length - 1}
                          aria-label="Ниже"
                          className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[#4B5563] disabled:opacity-40 cursor-pointer"
                        >
                          <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => patch(id, { stages: removeTemplateStage(item.stages, idx) })}
                          aria-label={`Удалить этап ${idx + 1}`}
                          className="h-8 w-8 inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] bg-white hover:bg-rose-50 text-[#9CA3AF] hover:text-rose-600 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  )}
                  <AddStageRow onAdd={(name) => patch(id, { stages: addTemplateStage(item.stages, name) })} />
                </div>
              </div>
            );
          })
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" data-ui="stage-template-create" onClick={createTemplate} className={UI.buttonGhost}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          новый шаблон
        </button>
        <span className="inline-flex items-start gap-1.5 text-[10px] text-[#6B7280]">
          <TriangleAlert className="w-3 h-3 text-amber-500 mt-px shrink-0" aria-hidden="true" />
          Названия этапов сопоставляются с типами (Настройки → типы этапов): «Загрузка», «Граница», «Растаможка (импорт)»… Незнакомое
          название создаст этап типа «Другое», название попадёт в «Место». Места и даты в шаблоне НЕ хранятся.
        </span>
      </div>
    </div>
  );
}

/** Строка «добавить этап» в шаблон (Enter или кнопка). */
function AddStageRow({ onAdd }: { onAdd: (name: string) => void }) {
  const [value, setValue] = useState('');
  const commit = () => {
    const v = value.trim();
    if (!v) return;
    onAdd(v);
    setValue('');
  };
  return (
    <div className="flex items-center gap-1.5">
      <label className="text-[10px] text-[#9CA3AF] w-5 text-right">+</label>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="Название этапа (например, Выгрузка)"
        aria-label="Новый этап шаблона"
        data-ui="stage-template-add-input"
        className="h-8 flex-1 min-w-[160px] bg-white border border-dashed border-[#D1D5DB] rounded-lg px-2.5 text-[12px] text-[#121316] outline-none transition-colors focus:border-[var(--accent)]"
      />
      <button type="button" onClick={commit} data-ui="stage-template-add" className={`${UI.buttonGhost} h-8`}>
        добавить
      </button>
    </div>
  );
}

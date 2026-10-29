/**
 * «Шаблоны этапов» (вкладка «Шаблоны» таймлайна) — управление веткой
 * `stageTemplates`: УПОРЯДОЧЕННЫЕ списки НАЗВАНИЙ этапов (без мест и дат).
 *
 * Доступ: ТОЛЬКО администратор (root_admin / admin) — для остальных блока нет.
 *
 * Компактный вид: каждый шаблон — карточка с цепочкой этапов (значок типа +
 * название). Правка открывается кнопкой «Изменить»: этапы — фишки со
 * стрелками и удалением, новые добавляются кнопками ТИПОВ справочника
 * (название тогда точно совпадает с типом) или своим названием. Название, не
 * совпадающее ни с одним типом, отмечено: при применении такой этап станет
 * «Другое», а название попадёт в «Место».
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
import { ChevronLeft, ChevronRight, Layers, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { TimelineStageType, UserProfile } from '../../types';
import { dbService } from '../../api';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { UI } from '../../ui/kit';
import { SectionHeader } from '../../ui/components';
import { isAdminRole } from './tripTimeline/lib/stageRights';
import { DEFAULT_STAGE_TYPES } from './tripTimeline/lib/catalog';
import { stageIconOf } from './tripTimeline/lib/visuals';
import {
  addTemplateStage,
  effectiveStageTemplates,
  moveTemplateStage,
  newTemplateId,
  removeTemplateStage,
  resolveStageTypeByName,
  stageTemplatesFromDb,
  templateCreatedLabel,
  type StageTemplate,
} from './tripTimeline/lib/stageTemplates';

interface WorkItem {
  name: string;
  stages: string[];
}

const sameItem = (a: WorkItem | undefined, b: { name: string; stages: string[] } | undefined): boolean =>
  !!a && !!b && a.name === b.name && a.stages.length === b.stages.length && a.stages.every((s, i) => s === b.stages[i]);

const iconBtn =
  'inline-flex items-center justify-center w-5 h-5 rounded-md text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] disabled:opacity-30 disabled:cursor-default cursor-pointer';

export default function StageTemplatesSettingsBlock({ user }: { user: UserProfile }) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [dbList, setDbList] = useState<StageTemplate[]>([]);
  const [dbTypes, setDbTypes] = useState<TimelineStageType[]>([]);
  const [work, setWork] = useState<Record<string, WorkItem>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Шаблоны, созданные в этой сессии (ещё не в базе) — не пропадают при синхронизации. */
  const sessionIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const unsub = dbService.getStageTemplates((store) => setDbList(stageTemplatesFromDb(store)));
    return () => unsub();
  }, []);
  useEffect(() => {
    const unsub = dbService.getTimelineStageTypes((list) => setDbTypes(list || []));
    return () => unsub();
  }, []);

  /** Справочник типов этапов: из базы, пока пусто — встроенный. */
  const stageTypes = useMemo(
    () => [...(dbTypes.length ? dbTypes : DEFAULT_STAGE_TYPES)].sort((a, b) => (a.order || 0) - (b.order || 0)),
    [dbTypes],
  );

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
    setEditingId(id);
  };

  const cancelEdit = (id: string) => {
    const saved = effective.find((t) => t.id === id);
    if (saved) {
      patch(id, { name: saved.name, stages: [...saved.stages] });
    } else {
      sessionIdsRef.current.delete(id);
      setWork((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
    setEditingId(null);
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
    setEditingId(null);
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
    if (editingId === id) setEditingId(null);
    setWork((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    toast(`Шаблон «${name}» удалён`, 'success');
  };

  /** Значок и признак совпадения названия этапа с типом справочника. */
  const stageMeta = (name: string) => {
    const type = resolveStageTypeByName(stageTypes, name);
    return { Icon: stageIconOf(type ? type.key : ''), known: !!type };
  };
  const unknownTitle = 'Название не совпадает ни с одним типом этапа: при применении станет «Другое», а название попадёт в «Место»';

  return (
    <div data-ui="stage-templates-settings" className="flex flex-col gap-4">
      <SectionHeader
        icon={<Layers className="w-4 h-4" aria-hidden="true" />}
        tone="graphite"
        title="Шаблоны этапов"
        subtitle="Порядок этапов для кнопки «Из шаблона» в окне рейса. Места и даты в шаблоне не хранятся."
      >
        <button type="button" data-ui="stage-template-create" onClick={createTemplate} className={UI.buttonGhost}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          Новый шаблон
        </button>
      </SectionHeader>

      {ids.length === 0 ? (
        <p className="text-[12px] text-[#6B7280]">Шаблонов нет — создайте первый.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {ids.map((id) => {
            const item = work[id];
            const saved = effective.find((t) => t.id === id);
            const inDb = dbList.some((t) => t.id === id);
            const dirty = !sameItem(item, saved);
            const editing = editingId === id;
            const createdLabel = templateCreatedLabel(dbList.find((t) => t.id === id));
            const unknownCount = item.stages.filter((s) => !stageMeta(s).known).length;
            return (
              <div
                key={id}
                data-ui="stage-template-card"
                data-template-id={id}
                className={`rounded-xl border bg-white px-3.5 py-3 flex flex-col gap-2.5 ${editing ? 'border-[var(--accent-40)] shadow-sm' : 'border-[#E5E7EB]'}`}
              >
                {/* Шапка карточки: название, счётчик, действия */}
                <div className="flex flex-wrap items-center gap-2">
                  {editing ? (
                    <input
                      value={item.name}
                      onChange={(e) => patch(id, { name: e.target.value })}
                      placeholder="Название шаблона (Турция, Китай…)"
                      aria-label="Название шаблона"
                      data-ui="stage-template-name"
                      autoFocus={!inDb}
                      className="h-8 min-w-[180px] flex-1 bg-white border border-[#E5E7EB] rounded-lg px-2.5 text-[13px] font-semibold text-[#121316] outline-none transition-colors focus:border-[var(--accent)]"
                    />
                  ) : (
                    <span className="text-[13px] font-semibold text-[#121316] truncate">{item.name}</span>
                  )}
                  <span className="text-[11px] text-[#6B7280] tabular-nums">{item.stages.length} эт.</span>
                  {dirty ? (
                    <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-px">
                      {inDb ? 'не сохранено' : 'новый'}
                    </span>
                  ) : null}
                  {!editing && createdLabel ? (
                    <span className="text-[10px] text-[#9CA3AF]" data-ui="stage-template-created">
                      {createdLabel}
                    </span>
                  ) : null}
                  <span className="ml-auto flex items-center gap-1.5">
                    {editing ? (
                      <>
                        <button type="button" onClick={() => cancelEdit(id)} className={`${UI.buttonGhost} min-h-0! h-8`}>
                          Отмена
                        </button>
                        <button type="button" onClick={() => saveTemplate(id)} data-ui="stage-template-save" className={`${UI.buttonPrimary} min-h-0! h-8`}>
                          Сохранить
                        </button>
                      </>
                    ) : (
                      <button type="button" onClick={() => setEditingId(id)} data-ui="stage-template-edit" className={`${UI.buttonGhost} min-h-0! h-8`}>
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                        Изменить
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void deleteTemplate(id)}
                      data-ui="stage-template-delete"
                      title="Удалить шаблон (рейсы не затрагиваются)"
                      aria-label="Удалить шаблон"
                      className={`${UI.buttonIcon} h-8 w-8 hover:text-rose-600 hover:bg-rose-50`}
                    >
                      <Trash2 className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </span>
                </div>

                {/* Цепочка этапов: в просмотре — компактно, в правке — фишки с действиями */}
                {item.stages.length === 0 ? (
                  <span className="text-[11px] text-[#9CA3AF]">Этапов нет — добавьте их кнопками ниже.</span>
                ) : (
                  <ol className="flex flex-wrap items-center gap-1" aria-label={`Этапы шаблона «${item.name}»`}>
                    {item.stages.map((stageName, idx) => {
                      const { Icon, known } = stageMeta(stageName);
                      return (
                        <li
                          key={`${id}_${idx}`}
                          data-ui="stage-template-stage-row"
                          title={known ? undefined : unknownTitle}
                          className={`inline-flex items-center gap-1 h-6 rounded-md border pl-1.5 text-[11px] ${editing ? 'pr-0.5' : 'pr-2'} ${
                            known ? 'border-[#E5E7EB] bg-[#F9FAFB] text-[#374151]' : 'border-amber-300 bg-amber-50 text-amber-800'
                          }`}
                        >
                          <span className="text-[9px] text-[#9CA3AF] tabular-nums">{idx + 1}</span>
                          <Icon className="w-3 h-3 shrink-0" style={{ color: known ? '#4B5563' : '#B45309' }} aria-hidden="true" />
                          <span className="whitespace-nowrap">{stageName}</span>
                          {editing ? (
                            <span className="inline-flex items-center ml-0.5">
                              <button
                                type="button"
                                onClick={() => patch(id, { stages: moveTemplateStage(item.stages, idx, -1) })}
                                disabled={idx === 0}
                                aria-label={`Этап ${idx + 1} раньше`}
                                className={iconBtn}
                              >
                                <ChevronLeft className="w-3 h-3" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => patch(id, { stages: moveTemplateStage(item.stages, idx, 1) })}
                                disabled={idx === item.stages.length - 1}
                                aria-label={`Этап ${idx + 1} позже`}
                                className={iconBtn}
                              >
                                <ChevronRight className="w-3 h-3" aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                onClick={() => patch(id, { stages: removeTemplateStage(item.stages, idx) })}
                                aria-label={`Удалить этап ${idx + 1}`}
                                className={`${iconBtn} hover:text-rose-600 hover:bg-rose-50`}
                              >
                                <X className="w-3 h-3" aria-hidden="true" />
                              </button>
                            </span>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}

                {editing ? (
                  <div className="flex flex-col gap-2 border-t border-[#F1F2F4] pt-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mr-1">Добавить</span>
                      {stageTypes.map((t) => {
                        const Icon = stageIconOf(t.key);
                        return (
                          <button
                            key={t.key}
                            type="button"
                            data-ui="stage-template-add-type"
                            onClick={() => patch(id, { stages: addTemplateStage(item.stages, t.name) })}
                            className="inline-flex items-center gap-1 h-7 px-2 rounded-lg border border-[#E5E7EB] bg-white hover:bg-[#F3F4F6] text-[11px] text-[#374151] cursor-pointer"
                          >
                            <Icon className="w-3 h-3" style={{ color: '#4B5563' }} aria-hidden="true" />
                            {t.name}
                          </button>
                        );
                      })}
                    </div>
                    <AddStageRow onAdd={(name) => patch(id, { stages: addTemplateStage(item.stages, name) })} />
                    {unknownCount ? (
                      <span className="text-[10px] text-amber-700">
                        Этапов с незнакомым названием: {unknownCount}. {unknownTitle}.
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Своё название этапа (Enter или кнопка). */
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
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit();
          }
        }}
        placeholder="Своё название этапа — Enter"
        aria-label="Новый этап шаблона"
        data-ui="stage-template-add-input"
        className="h-7 w-full max-w-[320px] bg-white border border-dashed border-[#D1D5DB] rounded-lg px-2.5 text-[12px] text-[#121316] outline-none transition-colors focus:border-[var(--accent)]"
      />
      <button type="button" onClick={commit} data-ui="stage-template-add" className={`${UI.buttonGhost} min-h-0! h-7`}>
        Добавить
      </button>
    </div>
  );
}

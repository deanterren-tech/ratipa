/**
 * Шаблоны этапов рейса — ЧИСТАЯ логика (без React и базы), покрывается тестами
 * (scripts/test-stage-templates.ts).
 *
 * Модель данных (ветка RTDB `stageTemplates`):
 *   stageTemplates/<id>: { id, name, stages: string[], updatedAt, updatedBy,
 *                          createdAt?, createdBy? }
 *   · stages — УПОРЯДОЧЕННЫЙ список НАЗВАНИЙ этапов (без мест и дат);
 *   · createdAt/createdBy — аддитивные поля автора создания (пишутся при
 *     создании шаблона из окна рейса — кнопка «Сохранить как шаблон»);
 *     схема совместима со старыми записями без них;
 *   · название применяется к рейсу как ТИП этапа (сопоставление по названию
 *     справочника типов `tripTimeline/config/stageTypes`); если названию типа
 *     ничего не соответствует — этап создаётся типом «Другое», а название
 *     сохраняется в поле «Место» (данные не теряются);
 *   · созданные этапы всегда с ПУСТЫМИ местом (кроме несопоставленного
 *     названия) и датами; место и даты владелец вносит сам.
 *
 * Стартовые шаблоны «Турция» и «Китай» — ПО ФАКТУ реальных рейсов портала
 * (снято READ-ONLY разведкой из trips_dashboard.direction + tripTimeline/
 * tripStages; частота по 8 рейсам Китая и 6 рейсам Турции с этапами):
 *   · Китай: типы по числу рейсов — Загрузка (7), Граница (7),
 *     Растаможка (импорт) (4), Выгрузка (4); порядок в фактах:
 *     Загрузка → Граница → Растаможка (импорт) → Выгрузка. Затаможка
 *     (экспорт) в фактах Китая не встречается — в шаблон не включена.
 *   · Турция: по числу рейсов — Растаможка (импорт) (3), Выгрузка (3),
 *     Загрузка (3), Граница (2), Затаможка (экспорт) (2); порядок в фактах:
 *     Загрузка → Затаможка (экспорт) → Граница → Растаможка (импорт) →
 *     Выгрузка. Служебное «Другое» в шаблоны не включается никогда.
 * Значения ниже — фолбэк, пока ветка `stageTemplates` в базе пуста (как у
 * типов этапов: первое сохранение становится сидом справочника).
 */
import type { TimelineStage, TimelineStageType } from '../../../../types';
import { sortStagesRoute, stageRouteCmp } from './stageSchedule';

export interface StageTemplate {
  id: string;
  name: string;
  /** Упорядоченный список названий этапов (без мест и дат). */
  stages: string[];
  updatedAt?: string;
  updatedBy?: string;
  /** Автор и время СОЗДАНИЯ шаблона (аддитивные поля; у старых записей нет). */
  createdAt?: string;
  createdBy?: string;
}

/** Стартовые шаблоны по факту рейсов (см. справку модуля). */
export const DEFAULT_STAGE_TEMPLATES: StageTemplate[] = [
  {
    id: 'tpl_turkey',
    name: 'Турция',
    stages: ['Загрузка', 'Затаможка (экспорт)', 'Граница', 'Растаможка (импорт)', 'Выгрузка'],
  },
  {
    id: 'tpl_china',
    name: 'Китай',
    stages: ['Загрузка', 'Граница', 'Растаможка (импорт)', 'Выгрузка'],
  },
];

const str = (v: unknown): string => String(v ?? '').trim();

/** Ветка базы → список шаблонов (мусор не выдумываем, порядок — по названию). */
export const stageTemplatesFromDb = (
  raw: Record<string, unknown> | null | undefined,
): StageTemplate[] => {
  if (!raw || typeof raw !== 'object') return [];
  return Object.entries(raw)
    .filter(([, v]) => v && typeof v === 'object')
    .map(([key, v]) => {
      const rec = v as Record<string, unknown>;
      const stagesRaw = rec.stages;
      const stages: string[] = Array.isArray(stagesRaw)
        ? stagesRaw.map((s) => str(s))
        : stagesRaw && typeof stagesRaw === 'object'
          ? Object.values(stagesRaw as Record<string, unknown>).map((s) => str(s))
          : [];
      return {
        id: str(rec.id) || key,
        name: str(rec.name) || key,
        stages: stages.filter(Boolean),
        ...(rec.updatedAt ? { updatedAt: str(rec.updatedAt) } : {}),
        ...(rec.updatedBy ? { updatedBy: str(rec.updatedBy) } : {}),
        ...(rec.createdAt ? { createdAt: str(rec.createdAt) } : {}),
        ...(rec.createdBy ? { createdBy: str(rec.createdBy) } : {}),
      } satisfies StageTemplate;
    })
    .filter((t) => t.name)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
};

/** Эффективный список: шаблоны из базы, при пустой ветке — стартовые. */
export const effectiveStageTemplates = (dbTemplates: StageTemplate[]): StageTemplate[] =>
  dbTemplates && dbTemplates.length ? dbTemplates : DEFAULT_STAGE_TEMPLATES;

/**
 * Шаблон для направления: по названию варианта («Турция»/«Китай»), затем по
 * коду/id записи. Не найдено — null (не выдумываем).
 */
export const templateForDirection = (
  templates: StageTemplate[],
  directionName?: string,
  directionCode?: string,
): StageTemplate | null => {
  const name = str(directionName).toLowerCase();
  const code = str(directionCode).toLowerCase();
  const list = templates || [];
  // 1) Точное совпадение: имя шаблона = имя направления (или id/имя = код направления).
  const exact =
    list.find((t) => name && str(t.name).toLowerCase() === name) ||
    list.find((t) => code && (str(t.id).toLowerCase() === code || str(t.name).toLowerCase() === code));
  if (exact) return exact;
  // 2) Шаблон направления с уточнением в названии: «Турция 1», «Турция (основной)»,
  //    «Китай 2» — имя направления является началом имени шаблона (или наоборот).
  //    Без этого переименованный шаблон перестаёт давать подсказку порядка,
  //    мягкое предупреждение по шаблону и сопоставление в аудите, хотя шаблон
  //    направления реально существует. Короткие строки (<3) не сравниваем, чтобы
  //    код «TR» не совпадал случайно.
  const tolerant = (n: string): StageTemplate | null =>
    n.length >= 3
      ? list.find((t) => {
          const tn = str(t.name).toLowerCase();
          return tn.length >= 3 && (tn === n || tn.startsWith(n) || n.startsWith(tn));
        }) || null
      : null;
  return tolerant(name) || tolerant(code) || null;
};

// ---------------------------------------------------------------------------
// Предупреждение порядка по шаблону направления (НЕ блокирует сохранение)
// ---------------------------------------------------------------------------

/** Пара одного дня, стоящая вразрез с порядком шаблона направления. */
export interface TemplateOrderWarning {
  /** Этап с меньшим seq (стоит РАНЬШЕ), но по шаблону должен идти ПОЗЖЕ. */
  a: TimelineStage;
  /** Этап с большим seq (стоит позже), но по шаблону должен идти раньше. */
  b: TimelineStage;
  /** Плановая дата пары (ISO, один и тот же день). */
  dayIso: string;
  /** Метки типов пары (для сообщения; пустой тип — метка места/тип). */
  nameA: string;
  nameB: string;
}

/**
 * Мягкий контроль порядка по ТИПАМ: в пределах ОДНОГО дня этапы должны идти
 * так же, как в шаблоне этапов направления (например, «Граница» раньше
 * «Выгрузки»). Возвращает пары-нарушения (пусто — порядок шаблону соответствует
 * либо шаблона/типов нет): используется карточкой для предупреждения с
 * кнопками «Поменять местами» / «Оставить как есть». Сохранение НЕ блокирует.
 * Этапы без типа/вне шаблона в проверку не входят (сравнивать не с чем).
 */
export const templateOrderWarnings = (
  stages: TimelineStage[] | null | undefined,
  template: StageTemplate | null | undefined,
  stageTypes: TimelineStageType[] | null | undefined,
): TemplateOrderWarning[] => {
  const tplNames = (template?.stages || []).map((s) => str(s)).filter(Boolean);
  if (!tplNames.length) return [];
  const types = stageTypes || [];
  // Позиция ТИПА этапа в шаблоне направления (первое вхождение названия типа).
  const tplIndex = new Map<string, number>();
  tplNames.forEach((name, i) => {
    const type = resolveStageTypeByName(types, name);
    if (type && !tplIndex.has(type.key)) tplIndex.set(type.key, i);
  });
  if (!tplIndex.size) return [];
  const nameOf = (s: TimelineStage): string => {
    const t = types.find((x) => x && x.key === s.type);
    return str(t?.name) || str(s.label) || str(s.type);
  };
  // Порядок итерации — единый порядок отображения (дата, затем seq): в одном
  // дне пары перебираются по seq, «раньше стоит — раньше в паре».
  const ordered = sortStagesRoute((stages || []).filter((s) => s && typeof s === 'object'));
  const out: TemplateOrderWarning[] = [];
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      const a = ordered[i];
      const b = ordered[j];
      const dayA = str(a.plannedDate);
      const dayB = str(b.plannedDate);
      if (!dayA || dayA !== dayB) continue; // только этапы ОДНОГО дня
      const ia = tplIndex.get(str(a.type));
      const ib = tplIndex.get(str(b.type));
      if (ia == null || ib == null || ia <= ib) continue; // пара шаблону не противоречит
      out.push({ a, b, dayIso: dayA, nameA: nameOf(a), nameB: nameOf(b) });
    }
  }
  return out;
};

/** Сопоставление названия шаблона типу этапа справочника (точно, затем по вхождению). */
export const resolveStageTypeByName = (
  stageTypes: TimelineStageType[],
  name: string,
): TimelineStageType | null => {
  const n = str(name).toLowerCase();
  if (!n) return null;
  return (
    (stageTypes || []).find((t) => str(t.name).toLowerCase() === n) ||
    (stageTypes || []).find((t) => {
      const tn = str(t.name).toLowerCase();
      return tn.length >= 3 && (tn.includes(n) || n.includes(tn));
    }) ||
    null
  );
};

/** Заполненный этап (место/даты) — «внесённые данные»: replace-empty их не трогает. */
export const stageHasContent = (s: TimelineStage | null | undefined): boolean =>
  !!s && (!!str(s.label) || !!str(s.plannedDate) || !!str(s.actualDate));

// ---------------------------------------------------------------------------
// «Сохранить как шаблон» (окно рейса → диалог создания шаблона): чистые функции
// ---------------------------------------------------------------------------

/** Служебная строка плана (фолбэк-этап) — в базе её нет, в шаблон не переносится. */
const isFallbackStageId = (id: unknown): boolean => String(id ?? '').endsWith('-fallback-load');

/**
 * Названия этапов РЕЙСА для нового шаблона (кнопка «Сохранить как шаблон»):
 *  · порядок — как в таблице этапов: «сначала дата, затем seq» (stageRouteCmp);
 *  · имя = метка ТИПА этапа из справочника (как в существующих шаблонах:
 *    «Загрузка», «Граница», «Растаможка (импорт)»…);
 *  · пропускаются: служебная строка плана (`*-fallback-load` — отображение,
 *    в базе не хранится), тип «Другое» (служебное — в шаблоны не попадает
 *    никогда) и неизвестные справочнику типы — «пустые/без типа»;
 *  · повторяющиеся типы НЕ схлопываются: рейс может реально пройти границу
 *    дважды — шаблон повторяет маршрут как есть.
 */
export const templateStagesFromTrip = (
  stages: TimelineStage[] | null | undefined,
  stageTypes: TimelineStageType[] | null | undefined,
): string[] => {
  const types = stageTypes || [];
  return [...(stages || [])]
    .filter((s) => s && typeof s === 'object' && !isFallbackStageId(s.id))
    .sort(stageRouteCmp)
    .map((s) => types.find((t) => t && t.key === s.type))
    .filter((t): t is TimelineStageType => !!t && t.key !== 'other' && !!str(t.name))
    .map((t) => str(t.name));
};

/** Есть ли в рейсе собственные этапы (без служебной строки плана-фолбэка). */
export const tripHasOwnStages = (stages: TimelineStage[] | null | undefined): boolean =>
  (stages || []).some((s) => s && typeof s === 'object' && !isFallbackStageId(s.id));

/** Занято ли имя шаблона (без учёта регистра и краевых пробелов). */
export const templateNameTaken = (
  templates: StageTemplate[] | null | undefined,
  name: string,
  exceptId?: string,
): boolean => {
  const n = str(name).toLowerCase();
  return !!n && (templates || []).some((t) => t && t.id !== exceptId && str(t.name).toLowerCase() === n);
};

/**
 * Свободное имя на основе желаемого: «Китай» занято → «Китай 2» → «Китай 3»…
 * (предложение БЕЗ молчаливого создания дубля — показывается в диалоге).
 */
export const suggestTemplateName = (
  desired: string,
  templates: StageTemplate[] | null | undefined,
): string => {
  const base = str(desired) || 'Шаблон';
  if (!templateNameTaken(templates, base)) return base;
  for (let i = 2; i < 100; i += 1) {
    const candidate = `${base} ${i}`;
    if (!templateNameTaken(templates, candidate)) return candidate;
  }
  return `${base} ${Date.now().toString(36)}`;
};

/** Подпись автора/времени создания шаблона («создан: Иван, 12.10.2026»); '' — нет данных. */
export const templateCreatedLabel = (t: StageTemplate | null | undefined): string => {
  const by = str(t?.createdBy);
  const at = str(t?.createdAt);
  let when = '';
  if (at) {
    const d = new Date(at);
    when = Number.isNaN(d.getTime()) ? at : d.toLocaleDateString('ru-RU');
  }
  if (!by && !when) return '';
  return `создан${by ? `: ${by}` : ''}${when ? `, ${when}` : ''}`;
};

export interface ApplyTemplateContext {
  /** Справочник типов этапов (та же «Настройки», что у карточки рейса). */
  stageTypes: TimelineStageType[];
  /** Генератор id нового этапа (по умолчанию — как у «Добавить этап»). */
  makeId?: () => string;
}

export type ApplyTemplateMode = 'append' | 'replaceEmpty';

export interface ApplyTemplateResult {
  /** Новый список этапов (черновик окна — в базу попадёт кнопкой «Сохранить»). */
  stages: TimelineStage[];
  /** Сколько этапов создано шаблоном. */
  added: number;
  /** Сколько пустых этапов удалено (режим «Заменить пустые»). */
  removed: number;
}

/**
 * Применение шаблона к этапам рейса:
 *  · append — НОВЫЕ этапы в конец: порядок по шаблону, seq от max+1 (от max+1
 *    берётся максимум из seq/order/количества — старые записи без seq не
 *    дают коллизий); существующие этапы не меняются;
 *  · replaceEmpty — удаляются ТОЛЬКО пустые этапы (без места и дат), этапы с
 *    внесёнными данными сохраняются и остаются впереди; затем весь список
 *    перенумеровывается seq/order 1..N (порядок шаблона сохраняется).
 * Созданные этапы: место пустое (несопоставленное название сохраняется в
 * «Место»), даты пустые, запас — шаблон типа (Настройки), как при «Добавить этап».
 */
export const applyStageTemplate = (
  existing: TimelineStage[] | null | undefined,
  template: StageTemplate | null | undefined,
  mode: ApplyTemplateMode,
  ctx: ApplyTemplateContext,
): ApplyTemplateResult => {
  const base = (existing || []).map((s) => ({ ...s }));
  const names = (template?.stages || []).map((s) => str(s)).filter(Boolean);
  const makeId = ctx.makeId || (() => `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`);

  const createStages = (seqStart: number): TimelineStage[] =>
    names.map((name, i) => {
      const type = resolveStageTypeByName(ctx.stageTypes, name);
      const buffer = Number(type?.bufferDays);
      return {
        id: makeId(),
        type: type ? type.key : 'other',
        // Место пустое; несопоставленное название не теряем — оно и есть «место».
        label: type ? '' : name,
        plannedDate: '',
        actualDate: '',
        isCritical: false,
        reason: '',
        action: '',
        order: seqStart + i,
        seq: seqStart + i,
        bufferDays: Number.isFinite(buffer) && buffer > 0 ? Math.floor(buffer) : 0,
      } satisfies TimelineStage;
    });

  if (mode === 'replaceEmpty') {
    const kept = base.filter((s) => stageHasContent(s));
    const removed = base.length - kept.length;
    const fresh = createStages(kept.length + 1);
    const all = [...kept, ...fresh].map((s, i) => ({ ...s, seq: i + 1, order: i + 1 }));
    return { stages: all, added: fresh.length, removed };
  }

  // append: seq от max+1 (учитываем seq, order и длину — легаси-записи без seq).
  const maxSeq = base.reduce(
    (m, s) => Math.max(m, Number(s.seq) || 0, Number(s.order) || 0),
    base.length,
  );
  const fresh = createStages(maxSeq + 1);
  return { stages: [...base, ...fresh], added: fresh.length, removed: 0 };
};

// ---------------------------------------------------------------------------
// Правки шаблона (окно «Настройки» → «Шаблоны этапов»): чистые функции списков
// ---------------------------------------------------------------------------

/** Перестановка этапа шаблона (dir: -1 — выше, +1 — ниже). */
export const moveTemplateStage = (stages: string[], index: number, dir: -1 | 1): string[] => {
  const list = [...(stages || [])];
  const to = index + dir;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const [moved] = list.splice(index, 1);
  list.splice(to, 0, moved);
  return list;
};

/** Добавление этапа в шаблон (пустое имя не добавляется). */
export const addTemplateStage = (stages: string[], name: string): string[] => {
  const n = str(name);
  return n ? [...(stages || []), n] : [...(stages || [])];
};

/** Удаление этапа шаблона по позиции. */
export const removeTemplateStage = (stages: string[], index: number): string[] =>
  (stages || []).filter((_, i) => i !== index);

/** Переименование этапа шаблона по позиции (пустое имя не принимается). */
export const renameTemplateStage = (stages: string[], index: number, name: string): string[] => {
  const n = str(name);
  if (!n) return [...(stages || [])];
  return (stages || []).map((s, i) => (i === index ? n : s));
};

/** Новый id записи шаблона. */
export const newTemplateId = (): string => `tpl_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/**
 * Связь записей с учётными записями диспетчеров.
 *
 * В портале диспетчер исторически хранился текстом: в одних разделах — имя
 * («Матвей»), в других — идентификатор учётной записи. Из-за этого запись
 * нельзя было надёжно связать с пользователем, а в интерфейсе показывалось
 * неполное имя.
 *
 * Единая модель записи (её же приводит миграция `scripts/migrate-dispatchers.ts`):
 *   dispatcherId   — стабильный идентификатор учётной записи (связь);
 *   dispatcherName — имя и фамилия из учётной записи (для отображения);
 *   dispatcher     — то же отображаемое имя (совместимость со старым кодом,
 *                    который сравнивает это поле с именем пользователя).
 *
 * Для журнальных полей (`logist`) текст остаётся историческим, а связь
 * хранится рядом в `logistId`.
 */

import { UserProfile } from '../types';

export interface DispatcherRef {
  id: string;
  name: string;
  color?: string;
}

/** Запись, у которой может быть указан диспетчер. */
export interface DispatcherCarrier {
  dispatcher?: string;
  dispatcherName?: string;
  dispatcherId?: string;
  logist?: string;
  logistId?: string;
  [key: string]: unknown;
}

const norm = (s: unknown) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');

/** Первое слово имени — для сопоставления сокращений вида «Матвей» ↔ «Матвей Солодкий». */
const firstWord = (s: string) => norm(s).split(' ')[0] || '';

/** Полное имя пользователя: отдельные поля «Имя» и «Фамилия», иначе общее поле. */
export function profileFullName(user?: Partial<UserProfile> | null): string {
  if (!user) return '';
  const first = String((user as any).firstName || '').trim();
  const last = String((user as any).lastName || '').trim();
  if (first || last) return [first, last].filter(Boolean).join(' ');
  const parts = String((user as any).name || '').trim().split(/\s+/).filter(Boolean);
  return parts.length > 1 ? `${parts[0]} ${parts.slice(1).join(' ')}` : parts[0] || '';
}

/** Справочник диспетчеров: идентификатор → имя и обратные соответствия. */
export interface DispatcherDirectory {
  list: DispatcherRef[];
  byId: Map<string, DispatcherRef>;
  byName: Map<string, DispatcherRef>;
  byFirstName: Map<string, DispatcherRef[]>;
}

export function buildDispatcherDirectory(list: DispatcherRef[] = []): DispatcherDirectory {
  const clean = (list || [])
    .filter((d) => d && d.id && d.name)
    .map((d) => ({ id: String(d.id), name: String(d.name), color: d.color }));
  const byId = new Map(clean.map((d) => [d.id, d]));
  const byName = new Map<string, DispatcherRef>();
  for (const d of clean) byName.set(norm(d.name), d);
  const byFirstName = new Map<string, DispatcherRef[]>();
  for (const d of clean) {
    const key = firstWord(d.name);
    if (!key) continue;
    byFirstName.set(key, [...(byFirstName.get(key) || []), d]);
  }
  return { list: clean, byId, byName, byFirstName };
}

/**
 * Идентификатор записи: явное поле, затем поиск по тексту (полное имя,
 * затем имя без фамилии — только если соответствующая учётная запись одна).
 */
export function resolveDispatcherId(rec: DispatcherCarrier, dir: DispatcherDirectory, field: 'dispatcher' | 'logist' = 'dispatcher'): string {
  const explicit = field === 'dispatcher' ? rec.dispatcherId : rec.logistId;
  if (explicit && dir.byId.has(String(explicit))) return String(explicit);
  const text = String((field === 'dispatcher' ? rec.dispatcherName || rec.dispatcher : rec.logist) || '').trim();
  if (!text) return '';
  if (dir.byId.has(text)) return text;
  const full = dir.byName.get(norm(text));
  if (full) return full.id;
  const byFirst = dir.byFirstName.get(firstWord(text)) || [];
  if (byFirst.length === 1) return byFirst[0].id;
  return explicit ? String(explicit) : '';
}

/** Имя для показа: сначала идентификатор (актуальное имя из учётной записи), затем текст записи. */
export function dispatcherDisplayName(rec: DispatcherCarrier, dir: DispatcherDirectory, field: 'dispatcher' | 'logist' = 'dispatcher'): string {
  const id = resolveDispatcherId(rec, dir, field);
  if (id && dir.byId.has(id)) return dir.byId.get(id)!.name;
  const text = String((field === 'dispatcher' ? rec.dispatcherName || rec.dispatcher : rec.logist) || '').trim();
  return text || '—';
}

/**
 * Поля, которые нужно сохранить в записи при выборе диспетчера.
 * Храним и идентификатор, и отображаемое имя — как того требует модель.
 */
export function dispatcherFieldsFor(nameOrId: string, dir: DispatcherDirectory, field: 'dispatcher' | 'logist' = 'dispatcher'): Record<string, string> {
  const value = String(nameOrId || '').trim();
  const byId = dir.byId.get(value);
  const byName = dir.byName.get(norm(value));
  const found = byId || byName || null;
  const name = found ? found.name : value;
  const id = found ? found.id : '';
  if (field === 'logist') {
    return { logist: value, logistId: id };
  }
  return { dispatcher: name, dispatcherName: name, dispatcherId: id };
}

/**
 * Имя человека для показа.
 *
 * В старых записях автор или диспетчер записан коротко («Сергей»). Если такое
 * имя однозначно соответствует учётной записи, показываем имя и фамилию из неё;
 * иначе оставляем текст как есть. Данные при этом не меняются.
 */
export function resolvePersonName(name: string | undefined | null, dir: DispatcherDirectory): string {
  const value = String(name || '').trim();
  if (!value) return '';
  const byFull = dir.byName.get(norm(value));
  if (byFull) return byFull.name;
  const byFirst = dir.byFirstName.get(firstWord(value)) || [];
  if (byFirst.length === 1) return byFirst[0].name;
  return value;
}

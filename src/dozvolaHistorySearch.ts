/**
 * Поиск по истории событий модуля «Учёт дозволов».
 *
 * Чистые функции без зависимостей: используются вкладкой «История документов»
 * и покрыты тестами. Поиск идёт по ВСЕМ текстовым данным записи, без учёта
 * регистра и по части строки. Записи истории не изменяются — только читаются.
 */

export type HistoryKind = 'document' | 'action';

/** Поле записи, по ��оторому идёт поиск. Подпись показывается в результатах. */
export interface SearchField {
  label: string;
  value: string;
}

export interface SearchMatch {
  /** Подпись поля, в котором найдено совпадение. */
  field: string;
  /** Текст до совпадения (с многоточием, если обрезан). */
  before: string;
  /** Само совпадение — подсвечивается в интерфейсе. */
  match: string;
  /** Текст после совпадения. */
  after: string;
}

const SNIPPET_WINDOW = 46;

/** Все текстовые данные записи — по ним идёт поиск. */
export function getSearchFields(rec: any, kind: HistoryKind): SearchField[] {
  const permits = Array.isArray(rec?.permits) ? rec.permits : [];
  const fields: SearchField[] = [];

  if (kind === 'document') {
    fields.push({ label: 'Название документа', value: rec?.documentName || '' });
    fields.push({ label: 'Тип документа', value: rec?.documentType || '' });
  } else {
    fields.push({ label: 'Бланк дозвола', value: rec?.doc || '' });
  }

  fields.push({ label: 'Действие', value: rec?.action || '' });

  // Номера дозволов — самый частый запрос в этом модуле, поэтому идут раньше служебных полей
  if (permits.length) {
    fields.push({
      label: 'Номер дозвола',
      value: permits
        .map((p: any) => `${p?.type || ''} ${p?.number || ''}`.trim())
        .filter(Boolean)
        .join(', '),
    });
  }

  fields.push({ label: 'Результат', value: rec?.result || '' });
  fields.push({ label: 'Автор', value: rec?.logist || '' });
  fields.push({ label: 'Дата и время', value: rec?.time || '' });
  fields.push({ label: 'Детали', value: rec?.details || rec?.meta || '' });
  fields.push({ label: 'Имя файла', value: rec?.fileName || '' });

  return fields.filter((f) => f.value && String(f.value).trim());
}

/** Первое поле, содержащее запрос; для него — фрагмент вокруг совпадения. */
export function matchRecord(rec: any, kind: HistoryKind, query: string): SearchMatch | null {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;

  for (const field of getSearchFields(rec, kind)) {
    const value = String(field.value);
    const idx = value.toLowerCase().indexOf(q);
    if (idx === -1) continue;

    const start = Math.max(0, idx - SNIPPET_WINDOW);
    const end = Math.min(value.length, idx + q.length + SNIPPET_WINDOW);
    return {
      field: field.label,
      before: (start > 0 ? '…' : '') + value.slice(start, idx),
      match: value.slice(idx, idx + q.length),
      after: value.slice(idx + q.length, end) + (end < value.length ? '…' : ''),
    };
  }
  return null;
}

/** Есть ли совпадение в записи (без фрагмента) — для фильтрации таблицы. */
export function recordMatches(rec: any, kind: HistoryKind, query: string): boolean {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return getSearchFields(rec, kind).some((f) => String(f.value).toLowerCase().includes(q));
}

/** Подборка записей по запросу с ограничением размера выпадающего списка. */
export function searchHistory(
  records: any[],
  kind: HistoryKind,
  query: string,
  limit = 25,
): { rec: any; kind: HistoryKind; match: SearchMatch }[] {
  const q = String(query || '').trim();
  if (!q) return [];
  const out: { rec: any; kind: HistoryKind; match: SearchMatch }[] = [];
  for (const rec of records || []) {
    const m = matchRecord(rec, kind, q);
    if (m) out.push({ rec, kind, match: m });
    if (out.length >= limit) break;
  }
  return out;
}

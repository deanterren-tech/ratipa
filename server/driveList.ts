// Список файлов папки Google Диска для поиска внутри панели «Google Диск».
//
// Почему через сервер: страница встроенного просмотра папки — чужой источник,
// в браузере её содержимое прочитать нельзя (CORS), а поиск внутри iframe встроить
// невозможно. Поэтому список файлов забирает сервер и отдаёт приложению как JSON:
// поиск идёт по реальному содержимому папки, результаты показываются в самой панели.

export type DriveEntryKind = 'folder' | 'doc' | 'sheet' | 'slide' | 'pdf' | 'image' | 'file';

export interface DriveEntry {
  id: string;
  name: string;
  kind: DriveEntryKind;
  modified?: string;
}

/** Достаёт id папки из ссылки Диска (или из самого id). Возвращает null, если это не папка. */
export function extractFolderId(input: string): string | null {
  const value = String(input || '').trim();
  if (!value) return null;
  const byPath = value.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (byPath) return byPath[1];
  const byId = value.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (byId) return byId[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(value)) return value;
  return null;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function kindByName(name: string): DriveEntryKind {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['doc', 'docx', 'rtf', 'odt', 'txt'].includes(ext)) return 'doc';
  if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'sheet';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'slide';
  if (ext === 'pdf') return 'pdf';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'bmp'].includes(ext)) return 'image';
  return 'file';
}

/** Разбирает страницу встроенного просмотра папки в список записей. */
export function parseDriveFolderHtml(html: string): DriveEntry[] {
  const entries: DriveEntry[] = [];
  const seen = new Set<string>();
  const parts = String(html || '').split('<div class="flip-entry" id="entry-');
  for (let i = 1; i < parts.length; i += 1) {
    const block = parts[i];
    const idEnd = block.indexOf('"');
    if (idEnd <= 0) continue;
    const id = block.slice(0, idEnd);
    const nameMatch = block.match(/class="flip-entry-title">([^<]*)</);
    if (!nameMatch) continue;
    const name = decodeEntities(nameMatch[1]).trim();
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    const isFolder = /\/drive\/folders\//.test(block);
    const modifiedMatch = block.match(/flip-entry-last-modified"><div>([^<]*)</);
    entries.push({
      id,
      name,
      kind: isFolder ? 'folder' : kindByName(name),
      modified: modifiedMatch ? decodeEntities(modifiedMatch[1]).trim() : undefined,
    });
  }
  return entries;
}

/** Забирает список файлов папки с Google Диска (публичная папка или папка по ссылке). */
export async function loadDriveFolder(folderInput: string): Promise<DriveEntry[]> {
  const folderId = extractFolderId(folderInput);
  if (!folderId) return [];
  const response = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language': 'ru,en;q=0.9',
    },
    signal: AbortSignal.timeout(9000),
  });
  if (!response.ok) return [];
  const html = await response.text();
  return parseDriveFolderHtml(html);
}

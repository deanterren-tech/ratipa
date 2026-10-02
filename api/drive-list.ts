// Список файлов папки Google Диска для поиска внутри панели «Google Диск».
// Публичный маршрут: /api/drive-list?folder=<ссылка на папку или её id>
//
// Функция намеренно самодостаточна (как api/agent.ts): без импортов из проекта —
// серверные функции Vercel собираются отдельно, и локальные вспомогательные модули
// в сборку не попадают (проверено: с импортом функция падала с FUNCTION_INVOCATION_FAILED).
//
// Почему через сервер: страницу встроенного просмотра папки браузер прочитать не может
// (чужой источник, CORS), а поиск внутрь iframe не встроить. Поэтому список забирает
// сервер и отдаёт приложению как JSON — поиск идёт по настоящему содержимому папки.

type DriveEntryKind = 'folder' | 'doc' | 'sheet' | 'slide' | 'pdf' | 'image' | 'file';

interface DriveEntry {
  id: string;
  name: string;
  kind: DriveEntryKind;
  modified?: string;
}

function extractFolderId(input: string): string | null {
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

function parseDriveFolderHtml(html: string): DriveEntry[] {
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

async function loadDriveFolder(folderId: string): Promise<DriveEntry[]> {
  const anyAbort = AbortSignal as any;
  const timeout = typeof AbortSignal !== 'undefined' && typeof anyAbort.timeout === 'function'
    ? anyAbort.timeout(9000)
    : undefined;
  const response = await fetch(`https://drive.google.com/embeddedfolderview?id=${folderId}#list`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36',
      'Accept-Language': 'ru,en;q=0.9',
    },
    signal: timeout,
  });
  if (!response.ok) return [];
  return parseDriveFolderHtml(await response.text());
}

export default async function handler(req: any, res: any) {
  try {
    const query = (req && req.query) || {};
    // Диагностика: /api/drive-list?ping=1 — отвечает без обращения к Диску.
    if (String(query.ping || '') === '1') {
      res.status(200).json({ ok: true, ping: true, version: 2 });
      return;
    }
    const folder = String(query.folder || '');
    const folderId = extractFolderId(folder);
    if (!folderId) {
      res.status(400).json({ ok: false, error: 'bad_folder', files: [] });
      return;
    }
    const files = await loadDriveFolder(folderId);
    // Пустой список — либо закрытая папка, либо Диск не ответил: не кэшируем надолго.
    res.setHeader('Cache-Control', files.length ? 'public, max-age=300' : 'no-store');
    res.status(200).json({ ok: true, files, folderId });
  } catch (e: any) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: false,
      error: 'drive_unavailable',
      message: e && e.message ? String(e.message).slice(0, 160) : 'unknown',
      files: [],
    });
  }
}

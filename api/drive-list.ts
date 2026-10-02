// Список файлов папки Google Диска для поиска внутри панели «Google Диск».
// Публичный маршрут: /api/drive-list?folder=<ссылка на папку или её id>
import { loadDriveFolder, extractFolderId } from './_driveList';

export default async function handler(req: any, res: any) {
  const folder = String((req.query && req.query.folder) || '');
  if (!extractFolderId(folder)) {
    res.status(400).json({ ok: false, error: 'bad_folder' });
    return;
  }
  try {
    const files = await loadDriveFolder(folder);
    // Пустой список — это либо закрытая папка, либо Диск не ответил: не кэшируем ошибку надолго.
    res.setHeader('Cache-Control', files.length ? 'public, max-age=300' : 'no-store');
    res.status(200).json({ ok: true, files, folderId: extractFolderId(folder) });
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: false, error: 'drive_unavailable', files: [] });
  }
}

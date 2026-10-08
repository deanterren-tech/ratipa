import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Search,
  X,
  ArrowLeft,
  ChevronRight,
  ClipboardList,
  Plus,
  Pencil,
  Trash2,
  Folder,
  RefreshCw,
  Maximize2,
  Minimize2,
  HardDrive,
  Loader2,
  FileText,
  Table2,
  Presentation,
  Image as ImageIcon,
  File as FileIcon,
  ExternalLink,
} from 'lucide-react';
import { AppSettings, Instruction, UserProfile } from '../../types';
import { useHashRoute } from '../../hooks/useHashRoute';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';
import { dbService } from '../../api';
import { resolvePermission } from '../../utils/permissions';
import { getEmbeddableDriveUrl, getDriveSearchUrl } from '../../utils/embed';
import {
  EMPTY_INSTRUCTION,
  WORK_INSTRUCTIONS,
  THEME_ORDER,
  normalizeInstruction,
  searchBlob,
} from './instructionsData';
import type { InstructionData } from './instructionsData';
import InstructionEditor from './InstructionEditor';
import { InstructionBody } from './instructionUi';
import { BackButton } from '../../ui/components';

/**
 * Модуль «Инструкции» (раздел «Текущее») — инструкции по ситуациям в работе.
 *
 * Содержимое живёт в appSettings.instructions и заполняется прямо здесь: у кого есть
 * право записи, тот может добавить, изменить и удалить инструкцию. Подсказки про сам
 * портал (тема, фотография, виды списка и т.п.) — в меню пользователя.
 *
 * Модуль не меняет рабочие данные и статусы: только текст инструкций.
 */

interface Props {
  user: UserProfile;
  settings?: AppSettings | null;
}

/** Что редактируется прямо сейчас: запись как она лежит в базе (сырая) + признак новой. */
interface EditingState {
  record: InstructionData;
  isNew: boolean;
}

/** Куда попал запрос: подпись поля и фрагмент текста с найденным словом. */
function matchFragment(i: Instruction, q: string) {
  const needle = q.trim().toLowerCase();
  if (!needle) return null;
  const fields: [string, string[]][] = [
    ['Название', [i.title]],
    ['Тема', [i.theme]],
    ['Описание', [i.summary]],
    ['Что понадобится', i.prerequisites || []],
    ['Порядок действий', i.steps || []],
    ['Подсказки', i.tips || []],
  ];
  for (const [label, arr] of fields) {
    for (const text of arr) {
      const idx = (text || '').toLowerCase().indexOf(needle);
      if (idx >= 0) {
        return {
          field: label,
          before: (idx > 26 ? '…' : '') + text.slice(Math.max(0, idx - 26), idx),
          match: text.slice(idx, idx + needle.length),
          after: text.slice(idx + needle.length, idx + needle.length + 60),
        };
      }
    }
  }
  return null;
}


/** Запись папки Google Диска (приходит с сервера: /api/drive-list). */
export interface DriveEntry {
  id: string;
  name: string;
  kind: 'folder' | 'doc' | 'sheet' | 'slide' | 'pdf' | 'image' | 'file';
  modified?: string;
}

function DriveKindIcon({ kind, className }: { kind: DriveEntry['kind']; className?: string }) {
  if (kind === 'folder') return <Folder className={className} aria-hidden="true" />;
  if (kind === 'sheet') return <Table2 className={className} aria-hidden="true" />;
  if (kind === 'slide') return <Presentation className={className} aria-hidden="true" />;
  if (kind === 'image') return <ImageIcon className={className} aria-hidden="true" />;
  if (kind === 'doc' || kind === 'pdf') return <FileText className={className} aria-hidden="true" />;
  return <FileIcon className={className} aria-hidden="true" />;
}

function driveKindLabel(kind: DriveEntry['kind']) {
  if (kind === 'folder') return 'Папка';
  if (kind === 'doc') return 'Документ';
  if (kind === 'sheet') return 'Таблица';
  if (kind === 'slide') return 'Презентация';
  if (kind === 'pdf') return 'PDF';
  if (kind === 'image') return 'Изображение';
  return 'Файл';
}

/** Название файла с подсвеченным совпадением. */
function highlightName(name: string, query: string) {
  const q = query.trim();
  if (!q) return name;
  const idx = name.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return name;
  return (
    <>
      {name.slice(0, idx)}
      <mark className="rounded bg-[var(--accent-20)] px-0.5 text-[#121316]">{name.slice(idx, idx + q.length)}</mark>
      {name.slice(idx + q.length)}
    </>
  );
}

export default function InstructionsModule({ user, settings }: Props) {
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<string>('all');
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [saving, setSaving] = useState(false);
  const [isSuggestOpen, setIsSuggestOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const { route, navigate } = useHashRoute({ module: 'instructions' });
  const { showConfirm, showPrompt } = useDialog();
  const { toast } = useToast();

  // ——— Панель Google Диска (как в «Авто и водителях», ссылка своя) ———
  const [isDriveOpen, setIsDriveOpen] = useState(() => {
    try { return window.localStorage.getItem('ratipa_instructions_drive_visible') === 'true'; } catch { return false; }
  });
  const [isDriveFocus, setIsDriveFocus] = useState(false);
  const [isDriveLoading, setIsDriveLoading] = useState(true);
  const [driveKey, setDriveKey] = useState(0);
  const [driveQuery, setDriveQuery] = useState('');
  const [driveFiles, setDriveFiles] = useState<DriveEntry[] | null>(null);
  const [driveListState, setDriveListState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [driveFolderUrl, setDriveFolderUrl] = useState('');
  const [driveFolderName, setDriveFolderName] = useState('');
  const [drivePreview, setDrivePreview] = useState<DriveEntry | null>(null);
  const rawDriveUrl = settings?.instructionsDriveUrl || '';
  const driveCurrentUrl = driveFolderUrl || rawDriveUrl;
  const driveEmbedUrl = driveCurrentUrl ? getEmbeddableDriveUrl(driveCurrentUrl) : '';
  const driveQueryText = driveQuery.trim().toLowerCase();
  const driveMatches = driveQueryText && driveFiles
    ? driveFiles
        .filter((f) => f.name.toLowerCase().includes(driveQueryText))
        .sort((a, b) => {
          const ai = a.name.toLowerCase().indexOf(driveQueryText);
          const bi = b.name.toLowerCase().indexOf(driveQueryText);
          return ai - bi || a.name.localeCompare(b.name, 'ru');
        })
    : null;

  const closeDrive = () => {
    setIsDriveOpen(false);
    setDriveQuery('');
    setDrivePreview(null);
    setDriveFolderUrl('');
    setDriveFolderName('');
    try { window.localStorage.setItem('ratipa_instructions_drive_visible', 'false'); } catch { /* приватный режим */ }
  };

  /** Escape закрывает панель Диска: из открытого файла — назад к поиску, иначе — закрыть панель. */
  useEffect(() => {
    if (!isDriveOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (drivePreview) { setDrivePreview(null); return; }
      closeDrive();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isDriveOpen, drivePreview]);

  /** Переход в подпапку: и список файлов, и просмотр переключаются на неё. */
  const openDriveFolder = (folder: DriveEntry) => {
    setDriveFolderUrl(`https://drive.google.com/drive/folders/${folder.id}`);
    setDriveFolderName(folder.name);
    setDriveQuery('');
    setDrivePreview(null);
    setIsDriveLoading(true);
  };

  /** Список файлов папки для поиска внутри панели (сервер читает папку по ссылке). */
  useEffect(() => {
    if (!isDriveOpen || !rawDriveUrl) return;
    let cancelled = false;
    setDriveListState('loading');
    fetch(`/api/drive-list?folder=${encodeURIComponent(driveFolderUrl || rawDriveUrl)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (data && data.ok && Array.isArray(data.files) && data.files.length) {
          setDriveFiles(data.files);
          setDriveListState('ready');
        } else {
          setDriveFiles(null);
          setDriveListState('error');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDriveFiles(null);
        setDriveListState('error');
      });
    return () => { cancelled = true; };
  }, [isDriveOpen, rawDriveUrl, driveFolderUrl, driveKey]);

  /**
   * Открытие панели Диска. Ссылку на папку задаёт только администратор
   * («Администрирование» → «Интеграции» → «Google Диск для модуля инструкций»):
   * из модуля она не читается на запись и не меняется.
   */
  const toggleDrive = () => {
    if (!rawDriveUrl) {
      toast(
        'Ссылка на папку Диска не задана. Её указывает администратор: «Администрирование» → «Интеграции» → «Google Диск для модуля инструкций».',
        'error',
      );
      return;
    }
    if (isDriveOpen) { closeDrive(); return; }
    setIsDriveOpen(true);
    setIsDriveLoading(true);
    try { window.localStorage.setItem('ratipa_instructions_drive_visible', 'true'); } catch { /* приватный режим */ }
  };

  const openId = route.tab ? decodeURIComponent(route.tab) : null;

  const canWrite =
    user.role === 'root_admin' ||
    user.role === 'admin' ||
    resolvePermission(user, 'instructions', settings?.rolePermissions) === 'write';

  /**
   * Сырые записи из базы — их отдаём обратно при сохранении, чтобы не перезаписывать
   * чужие поля и не «мигрировать» записи, которые просто открывали. Нормализованные
   * копии — только для показа и поиска.
   */
  const rawInstructions: InstructionData[] = useMemo(() => {
    const fromDb = settings?.instructions;
    const raw = Array.isArray(fromDb) && fromDb.length > 0 ? fromDb : WORK_INSTRUCTIONS;
    return raw.filter((i) => i && i.id && i.title) as InstructionData[];
  }, [settings?.instructions]);

  const instructions: InstructionData[] = useMemo(
    () => rawInstructions.map(normalizeInstruction),
    [rawInstructions],
  );

  const themes = useMemo(() => {
    const seen = new Set<string>();
    instructions.forEach((i) => seen.add(i.theme || 'Прочее'));
    const known = THEME_ORDER.filter((t) => seen.has(t));
    const extra = [...seen].filter((t) => !THEME_ORDER.includes(t)).sort((a, b) => a.localeCompare(b, 'ru'));
    return [...known, ...extra];
  }, [instructions]);

  // Поле поиска по ширине надписей: меряем текст подсказки или введённый запрос.
  const measureRef = useRef<HTMLSpanElement | null>(null);
  const [fieldWidth, setFieldWidth] = useState(240);
  const SEARCH_PLACEHOLDER = 'Поиск: сломался, граница, дозвол, сдача…';
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    el.textContent = query || SEARCH_PLACEHOLDER;
    const w = Math.min(560, Math.max(200, Math.ceil(el.getBoundingClientRect().width) + 56));
    setFieldWidth((prev) => (Math.abs(prev - w) > 4 ? w : prev));
  }, [query]);

  const found = useMemo(() => {
    const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
    return instructions.filter((i) => {
      if (theme !== 'all' && (i.theme || 'Прочее') !== theme) return false;
      if (!q) return true;
      return searchBlob(i).includes(q);
    });
  }, [instructions, query, theme]);

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    // Показываем ВСЕ варианты, которые есть: сначала совпадение в названии, затем в содержимом.
    return instructions
      .filter((i) => searchBlob(i).includes(q))
      .sort((a, b) => {
        const aTitle = (a.title || '').toLowerCase().includes(q) ? 0 : 1;
        const bTitle = (b.title || '').toLowerCase().includes(q) ? 0 : 1;
        return aTitle - bTitle || (a.title || '').localeCompare(b.title || '', 'ru');
      });
  }, [instructions, query]);

  const grouped = useMemo(
    () => {
      const q = query.trim().toLowerCase();
      const rank = (i: Instruction) => (q && (i.title || '').toLowerCase().includes(q) ? 0 : 1);
      return themes
        .map((t) => ({
          theme: t,
          items: found
            .filter((i) => (i.theme || 'Прочее') === t)
            .sort((a, b) => rank(a) - rank(b) || (a.title || '').localeCompare(b.title || '', 'ru')),
        }))
        .filter((g) => g.items.length > 0);
    },
    [found, themes, query],
  );

  const open = openId ? instructions.find((i) => i.id === openId) || null : null;

  /** Сохраняет набор инструкций: новая — в конец, изменённая — на своём месте. */
  const persist = async (next: InstructionData[]) => {
    if (!settings) return false;
    setSaving(true);
    try {
      await dbService.saveSettings({ ...settings, instructions: next }, user.name, user.role);
      return true;
    } catch {
      toast('Не удалось сохранить инструкцию. Попробуйте ещё раз.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const openInstruction = (id: string) => {
    setIsSuggestOpen(false);
    navigate(encodeURIComponent(id));
  };

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      if (isSuggestOpen) { e.preventDefault(); setIsSuggestOpen(false); }
      return;
    }
    if (!isSuggestOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length) { setIsSuggestOpen(true); setHighlighted(0); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted((p) => (p + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted((p) => (p - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[highlighted];
      if (pick) openInstruction(pick.id);
    }
  };

  const startCreate = () => setEditing({ record: { ...EMPTY_INSTRUCTION }, isNew: true });

  /** Редактируем сырую запись: в редакторе конвертация в шаги происходит без записи в базу. */
  const startEdit = (i: Instruction) => {
    const raw = rawInstructions.find((x) => x.id === i.id) || (i as InstructionData);
    setEditing({ record: raw, isNew: false });
  };

  /** Сохранение из редактора: пишем только отредактированную запись, остальные — как есть. */
  const saveDraft = async (data: InstructionData): Promise<boolean> => {
    if (!editing) return false;
    const isNew = editing.isNew || !rawInstructions.some((x) => x.id === data.id);
    const next = isNew
      ? [...rawInstructions, data]
      : rawInstructions.map((x) => (x.id === data.id ? data : x));
    if (await persist(next)) {
      toast(isNew ? 'Инструкция добавлена' : 'Изменения сохранены', 'success');
      setEditing(null);
      navigate(encodeURIComponent(data.id));
      return true;
    }
    return false;
  };

  const removeInstruction = async (i: Instruction) => {
    const ok = await showConfirm(
      `Инструкция «${i.title}» будет удалена из списка. Рабочие данные это не затрагивает.`,
      'Удалить инструкцию?',
      { variant: 'danger', confirmLabel: 'Удалить' },
    );
    if (!ok) return;
    const next = rawInstructions.filter((x) => x.id !== i.id);
    if (await persist(next)) {
      toast('Инструкция удалена', 'success');
      if (openId === i.id) navigate(null);
    }
  };

  /** Панель Диска: на широких экранах — сбоку; на телефоне — на весь экран; на планшете — карточкой. */
  const drivePanelContent = (
    <>
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[#E5E7EB] bg-white p-3">
          <div className="flex min-w-0 items-center gap-2">
            <BackButton onClose={closeDrive} />
            <span className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-medium uppercase text-[#4B5563]">
              <HardDrive className="h-3 w-3" aria-hidden="true" />
              Drive
            </span>
            <h3 className="hidden shrink-0 truncate text-xs font-semibold tracking-tight text-[#121316] sm:block">Google Диск</h3>
          </div>

          {/* Поиск по файлам папки: результаты показываются здесь же, в этом окне */}
          <form
            className="relative min-w-0 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              const q = driveQuery.trim();
              if (!q) return;
              // Один вариант — открываем сразу; если список недоступен, ищем на Диске.
              if (driveMatches && driveMatches.length === 1) {
                const only = driveMatches[0];
                if (only.kind === 'folder') openDriveFolder(only);
                else setDrivePreview(only);
                return;
              }
              if (driveListState === 'error' && rawDriveUrl) {
                window.open(getDriveSearchUrl(rawDriveUrl, q), '_blank', 'noopener');
              }
            }}
          >
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
            <input
              value={driveQuery}
              onChange={(e) => { setDriveQuery(e.target.value); setDrivePreview(null); }}
              placeholder="Поиск в папке…"
              aria-label="Поиск в папке Google Диска"
              title="Начните вводить название файла — найденное появится в этом окне"
              className="w-full rounded-lg border border-[#E5E7EB] bg-white py-1.5 pl-8 pr-2 text-[11px] text-[#121316] transition focus:border-[var(--accent-ui)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)]"
            />
          </form>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => { setIsDriveLoading(true); setDriveKey((k) => k + 1); }}
              aria-label="Обновить Диск"
              title="Обновить Диск"
              className="rounded-lg p-1.5 text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <a
              href={rawDriveUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Открыть во вкладке"
              title="Открыть во вкладке"
              className="rounded-lg p-1.5 text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={() => setIsDriveFocus((v) => !v)}
              aria-label={isDriveFocus ? 'Свернуть' : 'Развернуть на весь экран'}
              title={isDriveFocus ? 'Свернуть' : 'Развернуть на весь экран'}
              className="hidden xl:inline-flex rounded-lg p-1.5 text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
            >
              {isDriveFocus ? <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={closeDrive}
              aria-label="Закрыть панель"
              title="Закрыть панель"
              className="hidden md:inline-flex items-center justify-center min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 rounded-lg p-1.5 text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-rose-600"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden bg-white p-2">
          {drivePreview ? (
            /* Файл открыт прямо в панели */
            <div className="flex h-full flex-col gap-2">
              <div className="flex shrink-0 items-center gap-1.5 rounded-xl border border-[#E5E7EB] bg-[#F8F9FA] px-2 py-1.5">
                <button
                  type="button"
                  onClick={() => setDrivePreview(null)}
                  aria-label="Вернуться к поиску"
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg px-1.5 py-1 text-[11px] font-medium text-[#4B5563] transition-colors hover:bg-white hover:text-[#121316]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Назад
                </button>
                <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-[#121316]" title={drivePreview.name}>
                  {drivePreview.name}
                </span>
                <a
                  href={`https://drive.google.com/file/d/${drivePreview.id}/view`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Открыть файл в Google Диске"
                  title="Открыть файл в Google Диске"
                  className="shrink-0 rounded-lg p-1.5 text-[#4B5563] transition-colors hover:bg-white hover:text-[#121316]"
                >
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </div>
              <iframe
                src={`https://drive.google.com/file/d/${drivePreview.id}/preview`}
                title={drivePreview.name}
                allow="autoplay"
                className="min-h-0 w-full flex-1 rounded-xl border-0 bg-white"
              />
            </div>
          ) : driveMatches ? (
            /* Результаты поиска — в этом же окне */
            <div className="flex h-full flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 px-1.5 pb-2">
                <span className="text-[11px] text-[#6B7280]" aria-live="polite">
                  {driveListState === 'loading' && 'Ищу в папке…'}
                  {driveListState === 'error' && 'Не удалось прочитать папку'}
                  {driveListState === 'ready' && (driveMatches.length
                    ? `Найдено: ${driveMatches.length} из ${driveFiles ? driveFiles.length : 0}`
                    : 'Ничего не найдено')}
                </span>
                {driveListState === 'error' && rawDriveUrl && (
                  <button
                    type="button"
                    onClick={() => window.open(getDriveSearchUrl(rawDriveUrl, driveQuery.trim()), '_blank', 'noopener')}
                    className="text-[11px] font-medium text-[var(--accent-ink)] hover:underline"
                  >
                    Искать в Google Диске
                  </button>
                )}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {driveMatches.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => (f.kind === 'folder' ? openDriveFolder(f) : setDrivePreview(f))}
                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#F8F9FA]">
                      <DriveKindIcon kind={f.kind} className="h-3.5 w-3.5 text-[#4B5563]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] font-medium text-[#121316]">{highlightName(f.name, driveQuery)}</span>
                      <span className="block text-[10px] text-[#9CA3AF]">
                        {driveKindLabel(f.kind)}{f.modified ? ` · ${f.modified}` : ''}
                      </span>
                    </span>
                  </button>
                ))}
                {driveListState === 'ready' && !driveMatches.length && (
                  <div className="px-3 py-6 text-center text-[11px] leading-relaxed text-[#9CA3AF]">
                    Попробуйте слово из названия файла.
                  </div>
                )}
              </div>
            </div>
          ) : (
            /* Папка целиком */
            <>
              {driveFolderUrl && (
                <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white/95 px-2 py-1 shadow-sm">
                  <button
                    type="button"
                    onClick={() => { setDriveFolderUrl(''); setDriveFolderName(''); setIsDriveLoading(true); }}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-[#4B5563] hover:text-[#121316]"
                  >
                    <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    В основную папку
                  </button>
                  {driveFolderName && <span className="max-w-[140px] truncate text-[10px] text-[#9CA3AF]" title={driveFolderName}>{driveFolderName}</span>}
                </div>
              )}
              {isDriveLoading && (
                <div className="absolute inset-2 z-10 flex flex-col items-center justify-center gap-2.5 rounded-xl bg-white p-6">
                  <Folder className="h-8 w-8 text-[#D1D5DB]" aria-hidden="true" />
                  <span className="inline-flex items-center gap-2 text-[11px] font-medium text-[#6B7280]">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-ui)] motion-reduce:animate-none" aria-hidden="true" />
                    Подключение к Google Диску…
                  </span>
                  <span className="text-[11px] text-[#9CA3AF]">Загрузка папки с материалами</span>
                </div>
              )}
              <iframe
                key={driveEmbedUrl}
                src={driveEmbedUrl}
                onLoad={() => setIsDriveLoading(false)}
                allow="clipboard-write"
                title="Google Диск — материалы по инструкциям"
                className="h-full w-full rounded-xl border-0 bg-white"
              />
            </>
          )}
        </div>
    </>
  );

  const drivePanel = isDriveOpen && (
    <>
      <div
        className="fixed inset-0 z-[4000] bg-black/40 backdrop-blur-[2px] xl:hidden"
        onClick={closeDrive}
        aria-hidden="true"
      />
      <aside
        aria-label="Google Диск — материалы по инструкциям"
        className={
          isDriveFocus
            ? 'fixed inset-0 z-[4100] flex flex-col bg-white'
            : 'fixed inset-0 z-[4100] flex flex-col overflow-hidden bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] md:inset-x-3 md:top-20 md:bottom-3 md:rounded-2xl md:border md:border-[#E5E7EB] md:pt-0 md:pb-0 md:shadow-[0_25px_60px_rgba(0,0,0,0.25)] xl:hidden'
        }
      >
        {drivePanelContent}
      </aside>
    </>
  );

  // ——— Редактор: инструкция редактируется в её итоговом оформлении ———
  if (editing) {
    return (
      <InstructionEditor
        key={editing.record.id || 'new'}
        initial={editing.record}
        isNew={editing.isNew}
        themes={themes}
        saving={saving}
        onSave={saveDraft}
        onExit={() => setEditing(null)}
      />
    );
  }

  // ——— Подробная инструкция ———
  if (open) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="flex flex-wrap items-center gap-1 px-4 pt-5 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(null)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            К списку инструкций
          </button>
          {canWrite && (
            <>
              <button
                type="button"
                onClick={() => startEdit(open)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Редактировать
              </button>
              <button
                type="button"
                onClick={() => removeInstruction(open)}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-xs font-medium text-rose-600 transition-colors hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Удалить
              </button>
            </>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2 sm:px-6">
          <InstructionBody data={open} interactiveLinks />
        </div>
      </div>
    );
  }

  // ——— Список ———
  return (
    <div className="flex h-full min-h-0 w-full">
      <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="px-4 pt-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight text-[#121316] sm:text-3xl">Инструкции</h1>
            <p className="mt-1.5 text-xs leading-relaxed text-[#6B7280] sm:text-sm">
              Что делать в рабочих ситуациях: порядок действий, подсказки и где это в приложении.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={toggleDrive}
              aria-pressed={isDriveOpen}
              title={rawDriveUrl ? 'Материалы на Google Диске' : 'Ссылка на Диск не задана в настройках'}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-4 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] ${
                isDriveOpen
                  ? 'bg-[#121316] text-white hover:bg-black'
                  : 'border border-[#E5E7EB] bg-white text-[#121316] hover:bg-[#F9FAFB]'
              } ${rawDriveUrl ? '' : 'opacity-60'}`}
            >
              <Folder className="h-4 w-4" aria-hidden="true" />
              Google Диск
            </button>
            {canWrite && (
              <button
                type="button"
                onClick={startCreate}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--accent-solid)] px-4 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Добавить инструкцию
              </button>
            )}
          </div>
        </div>

        {/* Поиск: поле по ширине надписи + выпадающий список найденного */}
        <div className="relative mt-4" style={{ maxWidth: '100%' }}>
          <span
            ref={measureRef}
            aria-hidden="true"
            className="pointer-events-none absolute left-0 top-0 -z-10 whitespace-pre text-xs opacity-0"
          >
            {SEARCH_PLACEHOLDER}
          </span>
          <div className="relative" style={{ width: `${fieldWidth}px`, maxWidth: '100%' }}>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
            <input
              type="text"
              value={query}
              autoComplete="off"
              onChange={(e) => { setQuery(e.target.value); setIsSuggestOpen(true); setHighlighted(0); }}
              onFocus={() => setIsSuggestOpen(true)}
              onKeyDown={onSearchKeyDown}
              onBlur={() => setIsSuggestOpen(false)}
              placeholder={SEARCH_PLACEHOLDER}
              aria-label="Поиск по инструкциям"
              role="combobox"
              aria-expanded={isSuggestOpen && suggestions.length > 0}
              aria-controls="instructions-search-results"
              className="w-full rounded-xl border border-[#E5E7EB] bg-white py-2.5 pl-9 pr-9 text-xs text-[#121316] transition focus:border-[var(--accent-ui)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => { setQuery(''); setIsSuggestOpen(false); }}
                aria-label="Очистить поиск"
                title="Очистить поиск"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}

            {isSuggestOpen && query.trim() && (
              <div
                id="instructions-search-results"
                role="listbox"
                className="absolute left-0 right-0 z-[1200] mt-1.5 max-h-[360px] min-w-[320px] overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
              >
                {suggestions.length === 0 ? (
                  <div className="px-4 py-6 text-center">
                    <p className="text-xs text-[#6B7280]">Ничего не найдено по запросу «{query.trim()}».</p>
                    <p className="mt-1 text-[11px] text-[#9CA3AF]">
                      Попробуйте слово из названия ситуации или из порядка действий.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2 border-b border-[#F3F4F6] bg-[#FCFCFD] px-3.5 py-2 text-[10px] font-medium uppercase tracking-wider text-[#9CA3AF]">
                      <span>Найдено: {suggestions.length}</span>
                      <span className="normal-case tracking-normal">↓ выбор · Enter открыть</span>
                    </div>
                    {suggestions.map((s, i) => {
                    const frag = matchFragment(s, query);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        role="option"
                        aria-selected={i === highlighted}
                        onMouseEnter={() => setHighlighted(i)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => openInstruction(s.id)}
                        className={`w-full cursor-pointer border-b border-[#F3F4F6] px-3.5 py-2.5 text-left transition-colors last:border-0 ${
                          i === highlighted ? 'bg-[var(--accent-10)]' : 'hover:bg-[#F9FAFB]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <span className="truncate text-xs font-semibold text-[#121316]">{s.title}</span>
                          <span className="shrink-0 text-[10px] text-[#9CA3AF]">{s.theme}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-2">
                          {frag ? (
                            <>
                              <span className="rounded bg-[var(--accent-15)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--accent-ink)]">
                                {frag.field}
                              </span>
                              <span className="truncate text-[11px] text-[#6B7280]">
                                {frag.before}
                                <mark className="rounded-sm bg-[#FFE08A] px-0.5 text-[#121316]">{frag.match}</mark>
                                {frag.after}
                              </span>
                            </>
                          ) : (
                            <span className="truncate text-[11px] text-[#6B7280]">{s.summary}</span>
                          )}
                        </div>
                      </button>
                    );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 flex w-fit max-w-full items-center gap-1.5 overflow-x-auto rounded-xl bg-[#F3F4F6]/75 p-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setTheme('all')}
            className={`min-h-[44px] cursor-pointer rounded-lg px-4 py-2 text-xs font-semibold transition ${
              theme === 'all' ? 'bg-[#121316] text-white' : 'text-[#4B5563] hover:text-[#121316]'
            }`}
          >
            Все ({instructions.length})
          </button>
          {themes.map((t) => {
            const n = instructions.filter((i) => (i.theme || 'Прочее') === t).length;
            if (n === 0) return null;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`min-h-[44px] cursor-pointer whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  theme === t ? 'bg-[#121316] text-white' : 'text-[#4B5563] hover:text-[#121316]'
                }`}
              >
                {t} ({n})
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {(query.trim() || theme !== 'all') && (
            <div className="mb-3 flex items-center justify-between gap-2 text-[11px] text-[#6B7280]">
              <span aria-live="polite">Найдено: {found.length} из {instructions.length}</span>
              <button
                type="button"
                onClick={() => { setQuery(''); setTheme('all'); setIsSuggestOpen(false); }}
                className="font-medium text-[var(--accent-ink)] hover:underline"
              >
                Сбросить
              </button>
            </div>
          )}
          {grouped.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-6 py-10 text-center">
              <Search className="h-5 w-5 text-[#9CA3AF]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#121316]">
                {instructions.length === 0 ? 'Инструкций пока нет' : 'Ничего не найдено'}
              </p>
              <p className="text-xs text-[#6B7280]">
                {instructions.length === 0
                  ? 'Добавьте первую инструкцию по рабочей ситуации.'
                  : 'Попробуйте другое слово или сбросьте фильтр по теме.'}
              </p>
              <button
                type="button"
                onClick={() => { setQuery(''); setTheme('all'); }}
                className="mt-1 inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
              >
                Показать все инструкции
              </button>
            </div>
          )}

          {grouped.map((group) => (
            <section key={group.theme} className="mb-6">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                {group.theme}
                <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-medium text-[#4B5563]">
                  {group.items.length}
                </span>
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {group.items.map((i) => (
                  <div
                    key={i.id}
                    className="group flex w-full items-start gap-2 rounded-2xl border border-[#E5E7EB] bg-white p-4 transition-colors hover:border-[#D1D5DB] hover:bg-[#F9FAFB]"
                  >
                    <button
                      type="button"
                      onClick={() => navigate(encodeURIComponent(i.id))}
                      className="flex min-w-0 flex-1 items-start gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                    >
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#4B5563]">
                        <ClipboardList className="h-4 w-4" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-semibold text-[#121316]">{i.title}</span>
                          {i.needsWork && (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                              требует уточнения
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-[#6B7280]">{i.summary}</span>
                        <span className="mt-1.5 block text-[11px] text-[#9CA3AF]">
                          {i.steps.length > 1 ? `Шагов: ${i.steps.length}` : 'Шаги не описаны'}
                          {i.links?.length ? ` · раздел: ${i.links.map((l) => l.label).join(', ')}` : ''}
                        </span>
                      </span>
                    </button>
                    {canWrite && (
                      <span className="flex shrink-0 items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() => startEdit(i)}
                          aria-label={`Редактировать «${i.title}»`}
                          title="Редактировать"
                          className="rounded-lg p-2 text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
                        >
                          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeInstruction(i)}
                          aria-label={`Удалить «${i.title}»`}
                          title="Удалить"
                          className="rounded-lg p-2 text-[#9CA3AF] transition-colors hover:bg-rose-50 hover:text-rose-600"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </span>
                    )}
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="mt-2 pb-6 text-[11px] leading-relaxed text-[#9CA3AF]">
            Инструкции заполняются по рабочим ситуациям. Где порядок ещё не согласован — ставится отметка
            «требует уточнения», чтобы догадка не выглядела как правило.
          </p>
        </div>
      </div>
      </div>

      {/* На широком экране панель Диска отжимает список инструкций, а не накрывает его */}
      {isDriveOpen && !isDriveFocus && (
        <aside
          aria-label="Google Диск — боковая панель материалов"
          className="hidden w-[520px] shrink-0 flex-col overflow-hidden border-l border-[#E5E7EB] bg-white xl:flex"
        >
          {drivePanelContent}
        </aside>
      )}

      {drivePanel}
    </div>
  );
}

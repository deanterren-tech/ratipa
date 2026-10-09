import {useState, useEffect, useMemo, useRef} from 'react'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {directoryService} from '../../api'
import {BookOpen, Trash2, Plus, Pencil} from 'lucide-react'
import {UserProfile} from '../../types'
import CurrencyDirectoryBlock from './directories/CurrencyDirectoryBlock'
import FerryDirectoryBlock from './directories/FerryDirectoryBlock'
import CheckpointDirectoryBlock from './directories/CheckpointDirectoryBlock'
import { mergeDirections } from './tripTimeline/lib/directions'
import {UI, foundLabel} from '../../ui/kit'
import {ModuleShell, SearchField, EmptyState, ModalShell} from '../../ui/components'

interface DirectoriesModuleProps {
  user: UserProfile;
  /** Встроенный режим: раздел открыт вкладкой внутри другого раздела —
   *  заголовок и внешние отступы не дублируются. */
  embedded?: boolean;
}

type DirKey = 'vehicleBrands' | 'trailerBrands' | 'rateGroups' | 'directions' | 'tripDirections' | 'currencies' | 'ferries' | 'checkpoints';

interface TabDef {
  key: DirKey;
  label: string;
  idField?: string;
  nameField?: string;
  fields?: { f: string; label: string; ph?: string; type?: string; numeric?: boolean }[];
  searchable?: boolean;
  block?: React.ComponentType<{ user: UserProfile }>;
}

const TABS: TabDef[] = [
  { key: 'vehicleBrands', label: 'Марки тягачей', idField: 'key', nameField: 'name',
    fields: [{ f: 'name', label: 'Название', ph: 'Mercedes' }], searchable: true },
  { key: 'trailerBrands', label: 'Марки прицепов', idField: 'key', nameField: 'name',
    fields: [{ f: 'name', label: 'Название', ph: 'Kögel' }], searchable: true },
  
  { key: 'rateGroups', label: 'Группы ставок', idField: 'id', nameField: 'name',
    fields: [
      { f: 'name', label: 'Название', ph: 'Стандарт' },
      { f: 'rate', label: 'Ставка €/км', ph: '0.125', numeric: true },
      { f: 'perDiemRate', label: 'Суточные €', ph: '35', numeric: true },
      { f: 'comment', label: 'Коммент', ph: '' },
    ], searchable: true },
  { key: 'directions', label: 'Направления', idField: 'id', nameField: 'label',
    fields: [
      { f: 'label', label: 'Название', ph: 'RUS-BY' },
      { f: 'coeff', label: 'Коэффициент', ph: '1.0', numeric: true },
    ], searchable: true },
  { key: 'tripDirections', label: 'Направления (цвета)', idField: 'id', nameField: 'name',
    fields: [
      { f: 'name', label: 'Название', ph: 'Казахстан' },
      { f: 'code', label: 'Короткий код', ph: 'KZ' },
      { f: 'color', label: 'Цвет метки', type: 'color' },
      { f: 'order', label: 'Порядок', ph: '3', numeric: true },
    ], searchable: true },
  { key: 'currencies', label: 'Валюты', block: CurrencyDirectoryBlock },
  { key: 'ferries', label: 'Паромы', block: FerryDirectoryBlock },
  { key: 'checkpoints', label: 'Погранпереходы', block: CheckpointDirectoryBlock },
];

const PAGE_SIZE = 30;

export default function DirectoriesModule({ user, embedded = false }: DirectoriesModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DirKey>('vehicleBrands');
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [page, setPage] = useState(1);
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const listRef = useRef<HTMLDivElement>(null);

  const tab = useMemo(() => TABS.find((t) => t.key === activeTab)!, [activeTab]);

  useEffect(() => {
    setItems([]);
    if (tab.block) {
      setSearch('');
      setEditing(null);
      return;
    }
    const getter = {
      vehicleBrands: directoryService.getVehicleBrands,
      trailerBrands: directoryService.getTrailerBrands,
      rateGroups: directoryService.getRateGroups,
      directions: directoryService.getDirections,
      // Направления таймлайна: встроенные Турция/Китай показываются вместе с
      // записями справочника (правка встроенных сохраняется как переопределение).
      tripDirections: (cb: (list: any[]) => void) =>
        directoryService.getTripDirections((list: any[]) => cb(mergeDirections(list))),
    }[activeTab];
    if (!getter) return;
    const unsub = getter((list: any[]) => setItems(list || []));
    setSearch('');
    setPage(1);
    setSortKey(null);
    setEditing(null);
    return unsub;
  }, [activeTab]);

  const filtered = useMemo(() => {
    let result = items;
    // Search
    if (search.trim() && tab.searchable) {
      const q = search.toLowerCase();
      result = result.filter((it) =>
        String(it[tab.nameField] || it[tab.idField] || '').toLowerCase().includes(q)
      );
    }
    // Sort
    if (sortKey) {
      result = [...result].sort((a, b) => {
        const va = String(a[sortKey] ?? '').toLowerCase();
        const vb = String(b[sortKey] ?? '').toLowerCase();
        const cmp = va.localeCompare(vb);
        return sortDir === 'asc' ? cmp : -cmp;
      });
    }
    return result;
  }, [items, search, tab, sortKey, sortDir]);

  const paginated = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page]);
  const hasMore = paginated.length < filtered.length;

  const openAdd = () => {
    if (!tab.fields) return;
    setDraft({});
    setEditing({ __new: true });
  };

  const openEdit = (it: any) => {
    if (!tab.fields) return;
    const d: Record<string, string> = {};
    if (it.dbKey != null) d.dbKey = String(it.dbKey);
    if (it.id != null) d.id = String(it.id);
    tab.fields.forEach((f) => { d[f.f] = it[f.f] != null ? String(it[f.f]) : ''; });
    if (it[tab.idField] != null) d[tab.idField] = String(it[tab.idField]);
    setDraft(d);
    setEditing(it);
  };

  const closeModal = async () => {
    const hasChanges = Object.keys(draft).length > 0;
    // Подтверждение — штатным диалогом приложения (единый язык модальных окон),
    // а не системным окном браузера. Смысл подтверждения не меняется.
    if (hasChanges && !(await showConfirm('Несохранённые изменения будут потеряны. Продолжить?'))) return;
    setEditing(null);
  };

  const handleSave = () => {
    if (!tab.fields || isSubmitting) return;
    const nameField = tab.nameField || 'name';
    const nameVal = (draft[nameField] || '').trim();
    if (!nameVal) {
      toast('Заполните название', 'error');
      return;
    }
    // Проверка уникальности (только для новых записей)
    if (editing?.__new) {
      const dup = items.some((it) =>
        String(it[nameField] || '').toLowerCase() === nameVal.toLowerCase()
      );
      if (dup) {
        toast('Запись с таким названием уже существует', 'error');
        return;
      }
    }
    setIsSubmitting(true);
    const rec: any = { ...draft };
    if (draft.dbKey) { rec.dbKey = draft.dbKey; rec.id = draft.dbKey; }
    else if (draft.id) rec.id = draft.id;
    if (draft[tab.idField]) rec[tab.idField] = draft[tab.idField];
    tab.fields.forEach((f) => {
      if (f.numeric) {
        const norm = String(rec[f.f] ?? '').replace(',', '.');
        rec[f.f] = norm === '' ? (f.f === 'perDiemRate' ? null : 0) : parseFloat(norm);
      }
    });
    if (tab.idField === 'key' && !rec.key) {
      rec.key = (rec.name || '').toString().toUpperCase().replace(/\s+/g, '_');
    }
    if (!rec.id && !rec.key) rec.id = 'dir_' + Date.now().toString();

    const CYR_TO_LAT: Record<string, string> = {
      А:'A',В:'B',Е:'E',К:'K',М:'M',Н:'H',О:'O',Р:'P',С:'C',Т:'T',У:'Y',Х:'X',
      а:'a',в:'b',е:'e',к:'k',м:'m',н:'h',о:'o',р:'p',с:'c',т:'t',у:'y',х:'x',
    };
    const normId = (s: string) =>
      String(s || '').split('').map((ch) => CYR_TO_LAT[ch] ?? ch).join('')
        .replace(/[.#$[\]\\]/g, '_').replace(/[^a-zA-Z0-9_-]/g, '');
    if (rec.id) rec.id = normId(rec.id);
    if (rec.key) rec.key = normId(rec.key);
    if (rec[tab.idField]) rec[tab.idField] = normId(rec[tab.idField]);

    try {
      directoryService.saveDirItem(tab.key, rec, user.name, user.role);
      toast('Сохранено в справочник', 'success');
    } catch (err: any) {
      console.error('[DirectoriesModule] saveDirItem failed:', err);
      toast('Ошибка сохранения: ' + (err?.message || err), 'error');
    } finally {
      setIsSubmitting(false);
      setEditing(null);
    }
  };

  const handleDelete = async (it: any) => {
    const idv = it.dbKey || it.id || it[tab.idField] || it.key;
    if (await showConfirm(`Удалить «${it[tab.nameField] || idv}» из справочника?`)) {
      directoryService.deleteDirItem(tab.key, idv, user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  const toggleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const tabButtons = TABS.map((t) => {
    const isActive = activeTab === t.key;
    return (
      <button
        key={t.key}
        type="button"
        role="tab"
        aria-selected={isActive}
        onClick={() => setActiveTab(t.key)}
        className={`${UI.tab} ${isActive ? UI.tabActive : UI.tabIdle}`}
      >
        {t.label}
        {isActive ? <span className={UI.tabUnderline} aria-hidden="true" /> : null}
      </button>
    );
  });

  const content = (
        <div key={activeTab} className="flex flex-col gap-4 min-w-0">
          {/* Toolbar: search + add */}
          {!tab.block && (
            <div className="flex flex-wrap items-center gap-3 pt-1">
              {tab.searchable && (
                <SearchField
                  value={search}
                  onChange={setSearch}
                  placeholder="Поиск…"
                  ariaLabel={`Поиск в справочнике «${tab.label}»`}
                  className="max-w-md"
                />
              )}
              <button type="button" onClick={openAdd} className={UI.buttonPrimary}>
                <Plus className="w-4 h-4" aria-hidden="true" />
                Добавить
              </button>
              <span className={UI.hint}>{foundLabel(filtered.length)}</span>
              {tab.key === 'tripDirections' ? (
                <span className={UI.hint}>
                  Турция и Китай — встроенные направления (метки на таймлайне): их можно править, цвет выбирается полем «Цвет метки»;
                  новые направления добавляются сюда и сразу появляются в фильтре таймлайна.
                </span>
              ) : null}
            </div>
          )}

          {/* List — на холсте, без карточки */}
          {!tab.block && (paginated.length === 0 ? (
            <EmptyState
              kind={search.trim() ? 'no-results' : 'empty'}
              query={search}
              title={search.trim() ? undefined : 'Записей пока нет'}
              hint={search.trim() ? undefined : `Добавьте первую запись в справочник «${tab.label}».`}
              actionLabel={search.trim() ? undefined : 'Добавить запись'}
              onAction={search.trim() ? undefined : openAdd}
            />
          ) : (
            <div ref={listRef} className="w-full">
              {paginated.map((it, idx) => (
                <div
                  key={it[tab.idField] || it.id || idx}
                  className="group flex items-center justify-between gap-3 py-2.5 border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <BookOpen className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#121316] truncate">
                        {it[tab.nameField] || it[tab.idField] || it.id || it.dbKey || '—'}
                      </div>
                      {tab.key === 'rateGroups' && (
                        <div className="text-[11px] text-[#6B7280] font-mono">
                          €{it.rate}/км{it.perDiemRate ? ` · суточные €${it.perDiemRate}` : ''}
                        </div>
                      )}
                      {tab.key === 'directions' && it.coeff != null && (
                        <div className="text-[11px] text-[#6B7280] font-mono">коэфф: {it.coeff}</div>
                      )}
                      {tab.key === 'tripDirections' && (
                        <div className="text-[11px] text-[#6B7280] flex items-center gap-2">
                          {it.color ? (
                            <span
                              className="inline-block w-3 h-3 rounded-full shrink-0"
                              style={{ background: String(it.color), border: '1px solid #D1D5DB' }}
                              aria-hidden="true"
                            />
                          ) : null}
                          <span className="font-mono">
                            код: {String(it.code || '—')} · порядок: {it.order ?? '—'}
                          </span>
                          {it.builtin ? <span className={UI.chip}>встроенное</span> : null}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEdit(it)}
                      aria-label="Изменить"
                      title="Изменить"
                      className={UI.buttonIcon}
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    {!(tab.key === 'tripDirections' && it.builtin) && (
                      <button
                        type="button"
                        onClick={() => handleDelete(it)}
                        aria-label="Удалить"
                        title="Удалить"
                        className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {hasMore && (
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  className="w-full py-3 min-h-[44px] text-xs font-medium text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
                >
                  Показать ещё ({filtered.length - paginated.length})
                </button>
              )}
            </div>
          ))}

          {/* Block components */}
          {tab.block && <tab.block user={user} />}
        </div>
  );

  return (
    <>
      {embedded ? (
        <div className={UI.shell}>
          <div className="mt-1 border-b border-[#E5E7EB] overflow-x-auto scrollbar-none">
            <nav className={UI.tabsNav} role="tablist" aria-label="Вкладки справочников">
              {tabButtons}
            </nav>
          </div>
          <div className="flex-1 pt-5">{content}</div>
        </div>
      ) : (
        <ModuleShell
          title="Справочники"
          tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
          activeTab={activeTab}
          onTabChange={(key) => setActiveTab(key as DirKey)}
          tabsAriaLabel="Вкладки справочников"
        >
          {content}
        </ModuleShell>
      )}

      {/* Edit/Add Modal */}
      <ModalShell
        isOpen={!!editing && !!tab.fields}
        onClose={closeModal}
        title={`${editing?.__new ? 'Добавить в ' : 'Изменить · '}${tab.label}`}
        icon={editing?.__new ? <Plus className="w-4 h-4" aria-hidden="true" /> : <Pencil className="w-4 h-4" aria-hidden="true" />}
        ariaLabel={editing?.__new ? `Добавить в ${tab.label}` : `Изменить · ${tab.label}`}
        maxWidth="max-w-md"
        footer={
          <>
            <button type="button" onClick={closeModal} className={UI.buttonGhost}>
              Отмена
            </button>
            <button type="button" onClick={handleSave} disabled={isSubmitting} className={UI.buttonPrimary}>
              {isSubmitting ? 'Сохранение…' : 'Сохранить'}
            </button>
          </>
        }
      >
        {tab.fields && (
          <div className="flex flex-col gap-4">
            {tab.fields.map((f) => (
              <div key={f.f} className="flex flex-col gap-2">
                <label className={UI.fieldLabel}>
                  {f.label}{f.f === (tab.nameField || 'name') ? ' *' : ''}
                </label>
                <input
                  type={f.type || 'text'}
                  value={draft[f.f] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.f]: e.target.value }))}
                  placeholder={f.ph}
                  className={UI.input}
                />
              </div>
            ))}
          </div>
        )}
      </ModalShell>
    </>
  );
}

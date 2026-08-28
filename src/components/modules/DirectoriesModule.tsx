import {useState, useEffect, useMemo, useRef} from 'react'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {directoryService} from '../../api'
import {BookOpen, Trash2, Save, Plus, Search, Pencil, X} from 'lucide-react'
import {UserProfile} from '../../types'
import DriverDirectoryBlock from './directories/DriverDirectoryBlock'
import CurrencyDirectoryBlock from './directories/CurrencyDirectoryBlock'
import DistanceDirectoryBlock from './directories/DistanceDirectoryBlock'
import FerryDirectoryBlock from './directories/FerryDirectoryBlock'

interface DirectoriesModuleProps {
  user: UserProfile;
}

type DirKey = 'vehicleBrands' | 'trailerBrands' | 'rateGroups' | 'directions' | 'currencies' | 'distances' | 'ferries';

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
    fields: [{ f: 'name', label: 'Название', ph: 'Mercedes' }] },
  { key: 'trailerBrands', label: 'Марки прицепов', idField: 'key', nameField: 'name',
    fields: [{ f: 'name', label: 'Название', ph: 'Kögel' }] },
  
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
  { key: 'currencies', label: 'Валюты', block: CurrencyDirectoryBlock },
  { key: 'distances', label: 'Расстояния', block: DistanceDirectoryBlock },
  { key: 'ferries', label: 'Паромы', block: FerryDirectoryBlock },
];

export default function DirectoriesModule({ user }: DirectoriesModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<DirKey>('vehicleBrands');
  const [items, setItems] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<any | null>(null);  // запись для модалки (null = закрыто)
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [dragIdx, setDragIdx] = useState<number | null>(null);
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
    }[activeTab];
    if (!getter) return;
    const unsub = getter((list: any[]) => setItems(list || []));
    setSearch('');
    setEditing(null);
    return unsub;
  }, [activeTab]);

  const filtered = useMemo(() => {
    if (!search.trim() || !tab.searchable) return items;
    const q = search.toLowerCase();
    return items.filter((it) =>
      String(it[tab.nameField] || it[tab.idField] || '').toLowerCase().includes(q)
    );
  }, [items, search, tab]);

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

  const handleSave = () => {
    if (!tab.fields) return;
    const rec: any = { ...draft };
    if (draft.dbKey) { rec.dbKey = draft.dbKey; rec.id = draft.dbKey; }  // реальный ключ БД (приоритет)
    else if (draft.id) rec.id = draft.id;
    if (draft[tab.idField]) rec[tab.idField] = draft[tab.idField];
    tab.fields.forEach((f) => {
      if (f.numeric) {
        const norm = String(rec[f.f] ?? '').replace(',', '.');
        rec[f.f] = norm === '' ? (f.f === 'perDiemRate' ? null : 0) : parseFloat(norm);
      }
    });
    if (tab.idField === 'key' && !rec.key) {
      rec.key = (rec.name || '').toString().toUpperCase().replace(/\\s+/g, '_');
    }
    if (!rec.id && !rec.key) rec.id = 'dir_' + Date.now().toString();

    // Нормализация ключа БД: транслит кириллицы + удаление недопустимых символов
    // (.#$[]), иначе set(ref) падает синхронно и модалка не закрывается.
    const CYR_TO_LAT: Record<string, string> = {
      А:'A',В:'B',Е:'E',К:'K',М:'M',Н:'H',О:'O',Р:'P',С:'C',Т:'T',У:'Y',Х:'X',
      а:'a',в:'b',е:'e',к:'k',м:'m',н:'h',о:'o',р:'p',с:'c',т:'t',у:'y',х:'x',
    };
    const normId = (s: string) =>
      String(s || '').split('').map((ch) => CYR_TO_LAT[ch] ?? ch).join('')
        .replace(/[.#$[\]]/g, '_').replace(/[^A-Z0-9_-]/g, '');
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

  // Drag reorder (только для dispatchers)
  const onDrop = (targetIdx: number) => {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const reordered = [...filtered];
    const [moved] = reordered.splice(dragIdx, 1);
    reordered.splice(targetIdx, 0, moved);
    // переносим порядок на весь items (с учётом фильтра — применяем к полному списку)
    const full = [...items];
    const fromId = filtered[dragIdx][tab.idField] || filtered[dragIdx].id;
    const toId = filtered[targetIdx][tab.idField] || filtered[targetIdx].id;
    const fromI = full.findIndex((x) => (x[tab.idField] || x.id) === fromId);
    const toI = full.findIndex((x) => (x[tab.idField] || x.id) === toId);
    if (fromI < 0 || toI < 0) return;
    const [mv] = full.splice(fromI, 1);
    full.splice(toI, 0, mv);
    directoryService.reorderDir(tab.key, full, user.name, user.role);
    setDragIdx(null);
  };

  const cardColor = (it: any) => it.color;

  return (
    <div key={activeTab} className="w-full space-y-6">
      <div className="bg-white rounded-[2rem] p-6 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col space-y-5">

        {/* Header with title + tab segment */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100">
          <div>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
              Справочники
            </span>
            <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
              <BookOpen className="w-5 h-5 text-slate-700" /> Справочники
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 overflow-x-auto max-w-full items-center">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-medium transition-all whitespace-nowrap ${
                    activeTab === t.key
                      ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40'
                      : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] text-slate-400 font-mono hidden sm:block">{items.length} записей</span>
          </div>
        </div>

        {/* Toolbar: search + add */}
        <div className="flex gap-2">
          {tab.searchable && (
            <div className="flex items-center flex-1 min-w-0 bg-white border border-slate-200/60 rounded-xl px-3 py-1.5">
              <Search className="w-3.5 h-3.5 text-slate-400 shrink-0 mr-2" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск…"
                className="w-full bg-transparent text-xs font-medium text-slate-800 outline-none placeholder:text-slate-400"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="text-xs hover:bg-slate-100 p-1 rounded-lg text-slate-400 hover:text-slate-700 transition"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          )}
          <button
            onClick={openAdd}
            className="px-4 py-2 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 bg-slate-900 text-white hover:bg-slate-800 shadow-sm border border-slate-800 shrink-0"
          >
            <Plus className="w-4 h-4 shrink-0" /> Добавить
          </button>
        </div>

        {/* List */}
        <div ref={listRef} className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden shadow-sm divide-y divide-slate-100">
          {filtered.length === 0 && (
            <div className="p-6 text-center text-xs text-slate-400">Пусто</div>
          )}
          {filtered.map((it, idx) => (
            <div
              key={it[tab.idField] || it.id || idx}
              data-nav-item
              draggable={false}
              onDragStart={() => setDragIdx(idx)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => onDrop(idx)}
              className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 group"
            >
              <div className="flex items-center gap-3 min-w-0">
                {cardColor(it) && (
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: cardColor(it) }} />
                )}
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-slate-800 truncate">
                    {it[tab.nameField] || it[tab.idField] || it.id || it.dbKey || '—'}
                  </div>
                  {tab.key === 'rateGroups' && (
                    <div className="text-[10px] text-slate-400">
                      €{it.rate}/км{it.perDiemRate ? ` · суточные €${it.perDiemRate}` : ''}
                    </div>
                  )}
                  {tab.key === 'directions' && it.coeff != null && (
                    <div className="text-[10px] text-slate-400">коэфф: {it.coeff}</div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                <button
                  onClick={() => openEdit(it)}
                  className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100"
                >
                  <Pencil className="w-4 h-4" />
                </button>
                <button
                  onClick={() => handleDelete(it)}
                  className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Block components */}
        {tab.block && <tab.block user={user} />}
      </div>

      {/* Edit/Add Modal */}
      {editing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in" onClick={() => setEditing(null)}>
          <div
            className="bg-white/90 backdrop-blur-xl rounded-3xl w-full max-w-md shadow-2xl p-4 sm:p-6 flex flex-col space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">
                {editing.__new ? 'Добавить в ' : 'Изменить · '}{tab.label}
              </h2>
              <button onClick={() => setEditing(null)} className="min-h-[44px] min-w-[44px] text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition flex items-center justify-center">
                <X className="w-4 h-4" />
              </button>
            </div>

            {tab.fields.map((f) => (
              <div key={f.f}>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{f.label}</label>
                <input
                  type={f.type || 'text'}
                  value={draft[f.f] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.f]: e.target.value }))}
                  placeholder={f.ph}
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-slate-400 bg-white/80 transition"
                />
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-2 text-xs font-medium text-slate-500 rounded-lg hover:bg-slate-100 transition"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-xs font-semibold px-3 py-2 rounded-lg hover:bg-slate-800 shadow-sm transition"
              >
                <Save className="w-3.5 h-3.5" /> Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
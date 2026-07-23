import {useState, useEffect, useMemo, useRef} from 'react'
import {useDialog} from '../DialogProvider'
import {useToast} from '../ToastProvider'
import {directoryService} from '../../api'
import {BookOpen, Trash2, Save, Plus, Search, Pencil, GripVertical, X} from 'lucide-react'
import {UserProfile} from '../../types'
import DriverDirectoryBlock from './directories/DriverDirectoryBlock'
import CurrencyDirectoryBlock from './directories/CurrencyDirectoryBlock'
import DistanceDirectoryBlock from './directories/DistanceDirectoryBlock'
import FerryDirectoryBlock from './directories/FerryDirectoryBlock'

interface DirectoriesModuleProps {
  user: UserProfile;
}

type DirKey = 'vehicleBrands' | 'trailerBrands' | 'dispatchers' | 'rateGroups' | 'statusTypes' | 'directions' | 'drivers' | 'currencies' | 'distances' | 'ferries';

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
  { key: 'dispatchers', label: 'Диспетчеры', idField: 'id', nameField: 'name',
    fields: [
      { f: 'name', label: 'Имя', ph: 'Сергей' },
      { f: 'color', label: 'Цвет (hex)', ph: '#70FC8E' },
    ], searchable: true },
  { key: 'rateGroups', label: 'Группы ставок', idField: 'id', nameField: 'name',
    fields: [
      { f: 'name', label: 'Название', ph: 'Стандарт' },
      { f: 'rate', label: 'Ставка €/км', ph: '0.125', numeric: true },
      { f: 'perDiemRate', label: 'Суточные €', ph: '35', numeric: true },
      { f: 'comment', label: 'Коммент', ph: '' },
    ], searchable: true },
  { key: 'statusTypes', label: 'Статусы', idField: 'id', nameField: 'label',
    fields: [
      { f: 'label', label: 'Название', ph: 'На базе' },
      { f: 'color', label: 'Цвет', ph: '#22c55e' },
      { f: 'category', label: 'Категория (park|trip|archive)', ph: 'park' },
    ], searchable: true },
  { key: 'directions', label: 'Направления', idField: 'id', nameField: 'label',
    fields: [
      { f: 'label', label: 'Название', ph: 'RUS-BY' },
      { f: 'coeff', label: 'Коэффициент', ph: '1.0', numeric: true },
    ], searchable: true },
  { key: 'drivers', label: 'Водители', block: DriverDirectoryBlock },
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
    if (tab.block) {
      setSearch('');
      setEditing(null);
      return;
    }
    const getter = {
      vehicleBrands: directoryService.getVehicleBrands,
      trailerBrands: directoryService.getTrailerBrands,
      dispatchers: directoryService.getDispatchers,
      rateGroups: directoryService.getRateGroups,
      statusTypes: directoryService.getStatusTypes,
      directions: directoryService.getDirections,
    }[activeTab];
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
    tab.fields.forEach((f) => { d[f.f] = it[f.f] != null ? String(it[f.f]) : ''; });
    if (tab.idField !== 'key' && it[tab.idField] != null) d[tab.idField] = String(it[tab.idField]);
    setDraft(d);
    setEditing(it);
  };

  const handleSave = () => {
    if (!tab.fields) return;
    const rec: any = { ...draft };
    if (tab.idField !== 'key' && draft[tab.idField]) rec[tab.idField] = draft[tab.idField];
    tab.fields.forEach((f) => {
      if (f.numeric) rec[f.f] = rec[f.f] === '' ? (f.f === 'perDiemRate' ? null : 0) : parseFloat(rec[f.f]);
    });
    if (tab.idField === 'key' && !rec.key) {
      rec.key = (rec.name || '').toString().toUpperCase().replace(/\s+/g, '_');
    }
    if (!rec.id && !rec.key) rec.id = 'dir_' + Date.now().toString();
    directoryService.saveDirItem(tab.key, rec, user.name, user.role);
    toast('Сохранено в справочник', 'success');
    setEditing(null);
  };

  const handleDelete = async (it: any) => {
    const idv = it[tab.idField] || it.id;
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

  const cardColor = (it: any) => it.color || (tab.key === 'statusTypes' ? it.color : undefined);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-4 sm:p-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <BookOpen className="w-5 h-5 text-[#3765F6]" />
          <h1 className="text-lg font-bold text-slate-800">Справочники</h1>
          <span className="ml-auto text-[11px] text-slate-400 font-mono">{items.length} записей</span>
        </div>

        {/* Tabs */}
        <div className="flex flex-wrap gap-1.5 mb-4">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                activeTab === t.key ? 'bg-[#3765F6] text-white shadow' : 'bg-white/70 text-slate-600 hover:bg-white'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Toolbar: search + add */}
        <div className="flex gap-2 mb-4">
          {tab.searchable && (
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск…"
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white/80 outline-none focus:border-[#3765F6]"
              />
            </div>
          )}
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-[#3765F6] text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-[#2a4fd0] shrink-0"
          >
            <Plus className="w-3.5 h-3.5" /> Добавить
          </button>
        </div>

        {/* List */}
        <div ref={listRef} className="bg-white/80 backdrop-blur rounded-2xl border border-slate-200/50 overflow-hidden shadow-sm">
          <div className="divide-y divide-slate-100">
            {filtered.length === 0 && (
              <div className="p-6 text-center text-xs text-slate-400">Пусто</div>
            )}
            {filtered.map((it, idx) => (
              <div
                key={it[tab.idField] || it.id || idx}
                draggable={tab.key === 'dispatchers'}
                onDragStart={() => setDragIdx(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(idx)}
                className="flex items-center justify-between px-4 py-3 hover:bg-slate-50 group"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {tab.key === 'dispatchers' && (
                    <GripVertical className="w-4 h-4 text-slate-300 cursor-grab active:cursor-grabbing" />
                  )}
                  {cardColor(it) && (
                    <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ background: cardColor(it) }} />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">
                      {it[tab.nameField] || it[tab.idField]}
                    </div>
                    {tab.key === 'rateGroups' && (
                      <div className="text-[10px] text-slate-400">
                        €{it.rate}/км{it.perDiemRate ? ` · суточные €${it.perDiemRate}` : ''}
                      </div>
                    )}
                    {tab.key === 'directions' && it.coeff != null && (
                      <div className="text-[10px] text-slate-400">коэфф: {it.coeff}</div>
                    )}
                    {tab.key === 'statusTypes' && it.category && (
                      <div className="text-[10px] text-slate-400">{it.category}</div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                  <button
                    onClick={() => openEdit(it)}
                    className="text-slate-400 hover:text-[#3765F6] p-1.5 rounded-lg hover:bg-blue-50"
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
        </div>
        {tab.block ? (
          <tab.block user={user} />
        ) : (
          <>
            {tab.key === 'dispatchers' && (
              <p className="text-[10px] text-slate-400 mt-2 text-center">Перетащите запись за значок ☰ чтобы изменить порядок</p>
            )}
          </>
        )}
      </div>

      {/* Edit/Add Modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div
            className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5 space-y-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-slate-800">
                {editing.__new ? 'Добавить в ' : 'Изменить · '}{tab.label}
              </h2>
              <button onClick={() => setEditing(null)} className="text-slate-400 hover:text-slate-700">
                <X className="w-4 h-4" />
              </button>
            </div>

            {tab.fields.map((f) => (
              <div key={f.f}>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{f.label}</label>
                <input
                  type={f.type || 'text'}
                  value={draft[f.f] || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.f]: e.target.value }))}
                  placeholder={f.ph}
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#3765F6]"
                />
              </div>
            ))}

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-2 text-xs font-bold text-slate-500 rounded-lg hover:bg-slate-100"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                className="inline-flex items-center gap-1.5 bg-[#3765F6] text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-[#2a4fd0]"
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

import {useState, useEffect, useMemo} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {Users, Trash2, Plus, Search, Pencil} from 'lucide-react'
import {UserProfile, Driver} from '../../../types'

interface Props { user: UserProfile }

export default function DriverDirectoryBlock({ user }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [items, setItems] = useState<Driver[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Driver | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    return dbService.getDrivers((list) => setItems(list || []));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((d) =>
      `${d.name} ${d.firstNameRu || ''} ${d.lastNameRu || ''} ${d.phone || ''}`.toLowerCase().includes(q)
    );
  }, [items, search]);

  const openAdd = () => { setDraft({}); setEditing({ id: '', name: '' } as Driver); };
  const openEdit = (d: Driver) => {
    const r: Record<string, string> = {};
    ['name','lastNameRu','firstNameRu','middleNameRu','phone','license','comment'].forEach((f) => {
      r[f] = (d as any)[f] != null ? String((d as any)[f]) : '';
    });
    if (d.id) r.id = d.id;
    setDraft(r); setEditing(d);
  };

  const handleSave = () => {
    const rec: any = { ...draft };
    if (!rec.id) rec.id = 'drv_' + Date.now().toString();
    if (!rec.name && (rec.firstNameRu || rec.lastNameRu))
      rec.name = [rec.lastNameRu, rec.firstNameRu, rec.middleNameRu].filter(Boolean).join(' ');
    dbService.saveDriver(rec as Driver, user.name, user.role);
    toast('Водитель сохранён', 'success');
    setEditing(null);
  };

  const handleDelete = async (d: Driver) => {
    if (await showConfirm(`Удалить водителя «${d.name}»?`)) {
      dbService.deleteDriver(d.id, user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  return (
    <div className="bg-white/80 backdrop-blur rounded-2xl border border-slate-200/50 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <Users className="w-4 h-4 text-[#3765F6]" />
        <h3 className="text-sm font-bold text-slate-800">Водители</h3>
        <span className="ml-auto text-[11px] text-slate-400 font-mono">{items.length}</span>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск…"
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-white/80 outline-none focus:border-[#3765F6]" />
          </div>
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 bg-[#3765F6] text-white text-xs font-bold px-3 py-2 rounded-xl hover:bg-[#2a4fd0] shrink-0">
            <Plus className="w-3.5 h-3.5" /> Добавить
          </button>
        </div>

        <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
          {filtered.length === 0 && <div className="p-6 text-center text-xs text-slate-400">Пусто</div>}
          {filtered.map((d) => (
            <div key={d.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 group">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-slate-800 truncate">{d.name}</div>
                <div className="text-[10px] text-slate-400">{d.phone || d.license || ''}</div>
              </div>
              <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                <button onClick={() => openEdit(d)} className="text-slate-400 hover:text-[#3765F6] p-1.5 rounded-lg hover:bg-blue-50">
                  <Pencil className="w-4 h-4" />
                </button>
                <button onClick={() => handleDelete(d)} className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-slate-800">{editing?.id ? 'Изменить' : 'Добавить'} водителя</h2>
            {[
              { f: 'lastNameRu', l: 'Фамилия (рус)' },
              { f: 'firstNameRu', l: 'Имя (рус)' },
              { f: 'middleNameRu', l: 'Отчество (рус)' },
              { f: 'phone', l: 'Телефон' },
              { f: 'license', l: 'Вод. удостоверение' },
              { f: 'comment', l: 'Комментарий' },
            ].map((fld) => (
              <div key={fld.f}>
                <label className="text-[10px] font-bold text-slate-500 uppercase">{fld.l}</label>
                <input value={draft[fld.f] || ''} onChange={(e) => setDraft((d) => ({ ...d, [fld.f]: e.target.value }))}
                  className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#3765F6]" />
              </div>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-xs font-bold text-slate-500 rounded-lg hover:bg-slate-100">Отмена</button>
              <button onClick={handleSave} className="inline-flex items-center gap-1.5 bg-[#3765F6] text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-[#2a4fd0]">
                <Plus className="w-3.5 h-3.5" /> Сохранить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

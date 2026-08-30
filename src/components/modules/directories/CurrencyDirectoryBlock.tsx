import {useState, useEffect, useMemo} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {Coins, Trash2, Plus, Search, Pencil} from 'lucide-react'
import {UserProfile, CurrencyPreset} from '../../../types'

interface Props { user: UserProfile }

export default function CurrencyDirectoryBlock({ user }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [items, setItems] = useState<CurrencyPreset[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CurrencyPreset | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});

  useEffect(() => {
    return dbService.getCurrencies((list) => setItems(list || []));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((c) => (c.code || '').toLowerCase().includes(q));
  }, [items, search]);

  const openAdd = () => { setDraft({}); setEditing({ id: '', code: '' }); };
  const openEdit = (c: CurrencyPreset) => { setDraft({ code: c.code || '' }); if (c.id) setDraft((d) => ({ ...d, id: c.id })); setEditing(c); };

  const handleSave = () => {
    const rec: any = { ...draft };
    if (!rec.id) rec.id = (rec.code || '').toString().toUpperCase() || 'cur_' + Date.now().toString();
    dbService.saveCurrency(rec as CurrencyPreset, user.name, user.role);
    toast('Валюта сохранена', 'success');
    setEditing(null);
  };

  const handleDelete = async (c: CurrencyPreset) => {
    if (await showConfirm(`Удалить валюту «${c.code}»?`)) {
      dbService.deleteCurrency(c.id, user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  return (
 <div className="bg-white rounded-2xl border border-slate-200/50 overflow-hidden shadow-sm">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <Coins className="w-4 h-4 text-[#3765F6]" />
        <h3 className="text-sm font-bold text-slate-800">Валюты</h3>
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
          {filtered.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 group">
              <div className="text-sm font-semibold text-slate-800">{c.code}</div>
              <div className="flex items-center gap-1 opacity-60 group-hover:opacity-100 transition">
                <button onClick={() => openEdit(c)} className="text-slate-400 hover:text-[#3765F6] p-1.5 rounded-lg hover:bg-blue-50"><Pencil className="w-4 h-4" /></button>
                <button onClick={() => handleDelete(c)} className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50"><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
      {editing && (
 <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-sm p-5 space-y-3 my-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-sm font-bold text-slate-800">{editing?.id ? 'Изменить' : 'Добавить'} валюту</h2>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase">Код (напр. EUR)</label>
              <input value={draft.code || ''} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
                className="w-full mt-1 px-3 py-2 text-sm rounded-lg border border-slate-200 outline-none focus:border-[#3765F6]" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-xs font-bold text-slate-500 rounded-lg hover:bg-slate-100">Отмена</button>
              <button onClick={handleSave} className="inline-flex items-center gap-1.5 bg-[#3765F6] text-white text-xs font-bold px-3 py-2 rounded-lg hover:bg-[#2a4fd0]"><Plus className="w-3.5 h-3.5" /> Сохранить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

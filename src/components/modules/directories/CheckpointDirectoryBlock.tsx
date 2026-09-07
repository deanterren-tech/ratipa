import {useState, useEffect, useMemo} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {MapPin, Trash2, Plus, Search, Pencil, Globe, ArrowRight} from 'lucide-react'
import {UserProfile} from '../../../types'

interface Props { user: UserProfile }

interface CheckpointRow {
  id: string;
  name: string;
  country: string;
  countryFrom?: string;
  countryTo?: string;
  active?: boolean;
}

const COUNTRY_FLAGS: Record<string, string> = {
  BY: '🇧🇾', RUS: '🇷🇺', KZ: '🇰🇿', UZ: '🇺🇿',
  TJ: '🇹🇯', KG: '🇰🇬', MN: '🇲🇳', CN: '🇨🇳',
  TR: '🇹🇷', IR: '🇮🇷', GE: '🇬🇪', AM: '🇦🇲', AZ: '🇦🇿',
};

export default function CheckpointDirectoryBlock({ user }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [items, setItems] = useState<CheckpointRow[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CheckpointRow | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    return dbService.getCheckpoints((list) => setItems((list || []).map((c: any) => ({
      id: c.id,
      name: c.name || '',
      country: c.country || '',
      countryFrom: c.countryFrom || '',
      countryTo: c.countryTo || '',
      active: c.active !== false,
    }))));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((c) => `${c.name} ${c.country} ${c.countryFrom || ''} ${c.countryTo || ''}`.toLowerCase().includes(q));
  }, [items, search]);

  const openAdd = () => {
    setDraft({ name: '', country: '', countryFrom: '', countryTo: '', active: 'true' });
    setEditing({ id: '', name: '', country: '', countryFrom: '', countryTo: '', active: true });
  };

  const openEdit = (c: CheckpointRow) => {
    setDraft({
      name: c.name, country: c.country,
      countryFrom: c.countryFrom || '', countryTo: c.countryTo || '',
      active: String(c.active !== false), id: c.id, dbKey: c.id,
    });
    setEditing(c);
  };

  const handleSave = () => {
    if (isSubmitting) return;
    const name = (draft.name || '').trim();
    if (!name) { toast('Укажите название КПП', 'error'); return; }
    if (editing && !(editing as any).id) {
      if (items.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
        toast('КПП с таким названием уже существует', 'error');
        return;
      }
    }
    setIsSubmitting(true);
    const rec: any = { ...draft, name };
    if (!rec.id) rec.id = 'cp_' + Date.now().toString();
    rec.active = rec.active !== 'false';
    dbService.saveCheckpoint(rec, user.name, user.role);
    toast('КПП сохранён', 'success');
    setIsSubmitting(false);
    setEditing(null);
  };

  const handleDelete = async (c: CheckpointRow) => {
    if (await showConfirm(`Удалить КПП «${c.name}»?`)) {
      setItems(prev => prev.filter(x => x.id !== c.id));
      dbService.deleteCheckpoint(c.id, user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  const grouped = useMemo(() => {
    const groups: Record<string, CheckpointRow[]> = { Другие: [] };
    items.forEach(c => {
      const key = c.country || 'Другие';
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    return Object.entries(groups).sort(([a], [b]) => a === 'Другие' ? 1 : b === 'Другие' ? -1 : a.localeCompare(b, 'ru'));
  }, [items]);



  return (
    <div className="bg-white rounded-2xl border border-slate-200/50 overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center">
            <MapPin className="w-4 h-4 text-slate-600" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Погранпереходы (КПП)</h3>
            <p className="text-[10px] text-slate-400 font-medium mt-0.5">{items.length} КПП</p>
          </div>
        </div>
        <button onClick={openAdd}
          className="inline-flex items-center gap-1.5 bg-slate-900 text-white text-xs font-semibold px-4 py-2.5 rounded-xl hover:bg-slate-800 shadow-sm transition shrink-0 cursor-pointer">
          <Plus className="w-4 h-4" /> Добавить
        </button>
      </div>

      {/* Search */}
      <div className="px-5 py-3 border-b border-slate-100">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию, стране..."
            className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 bg-slate-50 outline-none focus:border-slate-300 focus:bg-white transition" />
        </div>
      </div>

      {/* Grouped list */}
      <div className="divide-y divide-slate-100">
        {filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-slate-400">
            <MapPin className="w-8 h-8 mb-3 text-slate-300" />
            <div className="text-sm font-medium">Нет КПП</div>
            <div className="text-xs mt-1">Нажмите «Добавить» для создания первого погранперехода</div>
          </div>
        )}

        {grouped.map(([country, list]) => {
          const filteredList = list.filter(c => {
            if (!search.trim()) return true;
            const q = search.toLowerCase();
            return `${c.name} ${c.country} ${c.countryFrom || ''} ${c.countryTo || ''}`.toLowerCase().includes(q);
          });
          if (filteredList.length === 0) return null;
          return (
            <div key={country}>
              <div className="px-5 py-2 bg-slate-50 border-b border-slate-200/40 text-[10px] font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
                <Globe className="w-3 h-3" />
                {COUNTRY_FLAGS[country] || ''} {country === 'Другие' ? 'Другие страны' : country}
                <span className="text-[9px] font-normal opacity-60">{filteredList.length}</span>
              </div>
              {filteredList.map((c) => (
                <div key={c.id} className="flex items-center justify-between px-5 py-2.5 hover:bg-slate-50 group transition text-sm">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-xs shrink-0">
                      {COUNTRY_FLAGS[c.country] || '🚧'}
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-slate-800 truncate">{c.name}</div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-1.5">
                        {c.countryFrom && c.countryTo ? (
                          <>
                            <span>{COUNTRY_FLAGS[c.countryFrom] || ''} {c.countryFrom}</span>
                            <ArrowRight className="w-2.5 h-2.5 text-slate-300" />
                            <span>{COUNTRY_FLAGS[c.countryTo] || ''} {c.countryTo}</span>
                          </>
                        ) : (
                          <span>{c.country}</span>
                        )}
                        {c.active === false && <span className="ml-2 text-rose-400">(неактивен)</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition shrink-0">
                    <button onClick={() => openEdit(c)} className="text-slate-400 hover:text-slate-700 p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer" title="Изменить"><Pencil className="w-3.5 h-3.5" /></button>
                    <button onClick={() => handleDelete(c)} className="text-slate-400 hover:text-rose-500 p-1.5 rounded-lg hover:bg-rose-50 cursor-pointer" title="Удалить"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Add/Edit Modal */}
      {editing && (
        <div className="fixed inset-0 z-[100] bg-black/30 flex items-center justify-center p-4 overflow-y-auto" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl w-full max-w-md p-6 space-y-4 my-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-900">{editing?.id ? 'Изменить КПП' : 'Добавить КПП'}</h2>

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase">Название КПП *</label>
              <input type="text" value={draft.name || ''}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Кукурыки, Брест, Тересполь..."
                className="w-full mt-1 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white transition" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  {COUNTRY_FLAGS[draft.countryFrom || ''] || '🌍'} Страна с одной стороны
                </label>
                <select
                  value={draft.countryFrom || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, countryFrom: e.target.value }))}
                  className={`w-full mt-1 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white transition cursor-pointer ${draft.countryFrom ? 'text-slate-800 font-semibold' : 'text-slate-400'}`}
                >
                  <option value="">— Выберите страну —</option>
                  {['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'].map(c => (
                    <option key={c} value={c}>{COUNTRY_FLAGS[c] || ''} {c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1">
                  {COUNTRY_FLAGS[draft.countryTo || ''] || '🌍'} Страна с другой стороны
                </label>
                <select
                  value={draft.countryTo || ''}
                  onChange={(e) => setDraft((d) => ({ ...d, countryTo: e.target.value }))}
                  className={`w-full mt-1 px-3 py-2.5 text-sm rounded-xl border border-slate-200 outline-none focus:border-slate-400 bg-white transition cursor-pointer ${draft.countryTo ? 'text-slate-800 font-semibold' : 'text-slate-400'}`}
                >
                  <option value="">— Выберите страну —</option>
                  {['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'].map(c => (
                    <option key={c} value={c}>{COUNTRY_FLAGS[c] || ''} {c}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preview */}
            {draft.countryFrom && draft.countryTo && (
              <div className="bg-slate-50 rounded-xl px-4 py-3 text-xs text-slate-600 flex items-center gap-2 border border-slate-200">
                <span className="font-semibold">Соединяет:</span>
                {COUNTRY_FLAGS[draft.countryFrom] || ''} {draft.countryFrom}
                <ArrowRight className="w-3 h-3 text-slate-400" />
                {COUNTRY_FLAGS[draft.countryTo] || ''} {draft.countryTo}
              </div>
            )}

            {/* Auto-fill country from from→to */}
            {draft.countryFrom && draft.countryTo && !draft.country && (
              <div className="text-[10px] text-slate-400 italic">
                Страна КПП будет определена автоматически как {draft.countryFrom}/{draft.countryTo}
              </div>
            )}

            <label className="flex items-center gap-2.5 text-xs text-slate-600 cursor-pointer select-none py-1">
              <input type="checkbox" checked={draft.active !== 'false'} onChange={(e) => setDraft((d) => ({ ...d, active: String(e.target.checked) }))}
                className="rounded border-slate-300 text-slate-900 focus:ring-slate-400 w-4 h-4" />
              <span>Активен (показывать в выборе)</span>
            </label>

            <div className="flex justify-end gap-2 pt-1">
              <button onClick={() => setEditing(null)} className="px-4 py-2 text-xs font-medium text-slate-500 rounded-xl hover:bg-slate-100 transition cursor-pointer">Отмена</button>
              <button onClick={handleSave} disabled={isSubmitting} className={`inline-flex items-center gap-1.5 ${isSubmitting ? 'bg-slate-400 cursor-not-allowed' : 'bg-slate-900 hover:bg-slate-800'} text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-sm transition cursor-pointer`}>
                <Plus className="w-3.5 h-3.5" /> {isSubmitting ? 'Сохранение...' : 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
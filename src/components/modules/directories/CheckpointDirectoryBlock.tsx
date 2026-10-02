import {useState, useEffect, useMemo} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {MapPin, Trash2, Plus, Pencil, Globe, ArrowRight} from 'lucide-react'
import {UserProfile} from '../../../types'
import {UI} from '../../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ModalShell} from '../../../ui/components'

interface Props { user: UserProfile }

interface CheckpointRow {
  id: string;
  name: string;
  country: string;
  countryFrom?: string;
  countryTo?: string;
  active?: boolean;
}

const COUNTRY_CODES = ['BY','RUS','KZ','UZ','TJ','KG','MN','CN','TR','IR','GE','AM','AZ'];

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
    <div className="flex flex-col gap-4 min-w-0">
      <SectionHeader
        icon={<MapPin className="w-4 h-4" />}
        tone="graphite"
        title="Погранпереходы (КПП)"
        subtitle="Пункты пропуска по странам и направлениям"
      >
        <span className={UI.countBadge}>{items.length} КПП</span>
        <button type="button" onClick={openAdd} className={UI.buttonPrimary}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          Добавить
        </button>
      </SectionHeader>

      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Поиск по названию, стране…"
        ariaLabel="Поиск погранпереходов"
        className="max-w-md"
      />

      {filtered.length === 0 ? (
        <EmptyState
          kind={search.trim() ? 'no-results' : 'empty'}
          query={search}
          title={search.trim() ? undefined : 'Нет КПП'}
          hint={search.trim() ? undefined : 'Нажмите «Добавить» для создания первого погранперехода.'}
          actionLabel={search.trim() ? undefined : 'Добавить КПП'}
          onAction={search.trim() ? undefined : openAdd}
        />
      ) : (
        <div className="w-full">
          {grouped.map(([country, list]) => {
            const filteredList = list.filter(c => {
              if (!search.trim()) return true;
              const q = search.toLowerCase();
              return `${c.name} ${c.country} ${c.countryFrom || ''} ${c.countryTo || ''}`.toLowerCase().includes(q);
            });
            if (filteredList.length === 0) return null;
            return (
              <div key={country}>
                <div className="flex items-center gap-2 py-2 border-b border-[#E5E7EB] text-[11px] font-semibold text-[#6B7280] tracking-wider uppercase select-none">
                  <Globe className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" />
                  <span>{country === 'Другие' ? 'Другие страны' : country}</span>
                  <span className="font-mono text-[10px] text-[#9CA3AF]">{filteredList.length}</span>
                </div>
                {filteredList.map((c) => (
                  <div
                    key={c.id}
                    className="flex items-center justify-between gap-3 py-2.5 border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <MapPin className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#121316] truncate">{c.name}</div>
                        <div className="text-[11px] text-[#6B7280] flex items-center gap-1.5">
                          {c.countryFrom && c.countryTo ? (
                            <>
                              <span>{c.countryFrom}</span>
                              <ArrowRight className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />
                              <span>{c.countryTo}</span>
                            </>
                          ) : (
                            <span>{c.country || '—'}</span>
                          )}
                          {c.active === false && (
                            <span className="inline-flex items-center gap-1.5 text-[#6B7280]">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#9CA3AF]" aria-hidden="true" />
                              неактивен
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => openEdit(c)} aria-label="Изменить" title="Изменить" className={UI.buttonIcon}>
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(c)}
                        aria-label="Удалить"
                        title="Удалить"
                        className="inline-flex items-center justify-center p-1.5 rounded-lg text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}

      <ModalShell
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Изменить КПП' : 'Добавить КПП'}
        icon={<MapPin className="w-4 h-4" aria-hidden="true" />}
        ariaLabel={editing?.id ? 'Изменить КПП' : 'Добавить КПП'}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={UI.buttonGhost}>
              Отмена
            </button>
            <button type="button" onClick={handleSave} disabled={isSubmitting} className={UI.buttonPrimary}>
              {isSubmitting ? 'Сохранение…' : 'Сохранить'}
            </button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className={UI.fieldLabel}>Название КПП *</label>
            <input
              type="text"
              value={draft.name || ''}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Кукурыки, Брест, Тересполь…"
              className={UI.input}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel}>Страна с одной стороны</label>
              <select
                value={draft.countryFrom || ''}
                onChange={(e) => setDraft((d) => ({ ...d, countryFrom: e.target.value }))}
                className={`${UI.select} w-full`}
              >
                <option value="">— Выберите страну —</option>
                {COUNTRY_CODES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-2">
              <label className={UI.fieldLabel}>Страна с другой стороны</label>
              <select
                value={draft.countryTo || ''}
                onChange={(e) => setDraft((d) => ({ ...d, countryTo: e.target.value }))}
                className={`${UI.select} w-full`}
              >
                <option value="">— Выберите страну —</option>
                {COUNTRY_CODES.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Preview */}
          {draft.countryFrom && draft.countryTo && (
            <div className="flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-xs text-[#4B5563]">
              <span className="font-semibold text-[#121316]">Соединяет:</span>
              <span>{draft.countryFrom}</span>
              <ArrowRight className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />
              <span>{draft.countryTo}</span>
            </div>
          )}

          {/* Auto-fill country from from→to */}
          {draft.countryFrom && draft.countryTo && !draft.country && (
            <div className={UI.hint}>
              Страна КПП будет определена автоматически как {draft.countryFrom}/{draft.countryTo}
            </div>
          )}

          <label className="flex items-center gap-2.5 text-xs text-[#4B5563] cursor-pointer select-none py-1 min-h-[44px]">
            <input
              type="checkbox"
              checked={draft.active !== 'false'}
              onChange={(e) => setDraft((d) => ({ ...d, active: String(e.target.checked) }))}
              className={UI.checkbox}
            />
            <span>Активен (показывать в выборе)</span>
          </label>
        </div>
      </ModalShell>
    </div>
  );
}

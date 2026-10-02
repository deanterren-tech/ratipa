import {useState, useEffect, useMemo} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {Anchor, Trash2, Plus, Pencil} from 'lucide-react'
import {UserProfile, FerryTemplate} from '../../../types'
import {UI} from '../../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ModalShell} from '../../../ui/components'

interface Props { user: UserProfile }

export default function FerryDirectoryBlock({ user }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [items, setItems] = useState<FerryTemplate[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<FerryTemplate | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    return dbService.getFerryTemplates((list) => setItems(list || []));
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((f) => `${f.name || ''}`.toLowerCase().includes(q));
  }, [items, search]);

  const openAdd = () => { setDraft({}); setEditing({ id: '', name: '', price: 0 }); };
  const openEdit = (f: FerryTemplate) => { setDraft({ name: f.name || '', price: String(f.price || 0), id: f.id || '', dbKey: (f as any).dbKey || '' }); setEditing(f); };

  const handleSave = () => {
    if (isSubmitting) return;
    const name = (draft.name || '').trim();
    if (!name) { toast('Укажите название парома', 'error'); return; }
    if (editing && !(editing as any).id) {
      if (items.some((f) => f.name?.toLowerCase() === name.toLowerCase())) {
        toast('Тариф с таким названием уже существует', 'error');
        return;
      }
    }
    setIsSubmitting(true);
    const rec: any = { ...draft, name };
    rec.price = parseFloat(rec.price || '0') || 0;
    if (!rec.id) rec.id = (rec.dbKey as string) || 'ferry_' + Date.now().toString();
    dbService.saveFerryTemplate(rec as FerryTemplate, user.name, user.role);
    toast('Тариф парома сохранён', 'success');
    setIsSubmitting(false);
    setEditing(null);
  };

  const handleDelete = async (f: FerryTemplate) => {
    if (await showConfirm(`Удалить тариф «${f.name}»?`)) {
      dbService.deleteFerryTemplate((f as any).dbKey || f.id || '', user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <SectionHeader
        icon={<Anchor className="w-4 h-4" />}
        tone="graphite"
        title="Тарифы паромов"
        subtitle="Стоимость паромных переправ для расчётов по рейсам"
      >
        <span className={UI.countBadge}>{items.length}</span>
        <button type="button" onClick={openAdd} className={UI.buttonPrimary}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          Добавить
        </button>
      </SectionHeader>

      <SearchField
        value={search}
        onChange={setSearch}
        placeholder="Поиск по названию…"
        ariaLabel="Поиск тарифов паромов"
        className="max-w-md"
      />

      {filtered.length === 0 ? (
        <EmptyState
          kind={search.trim() ? 'no-results' : 'empty'}
          query={search}
          title={search.trim() ? undefined : 'Тарифов пока нет'}
          hint={search.trim() ? undefined : 'Добавьте первый тариф — он появится в этом списке.'}
          actionLabel={search.trim() ? undefined : 'Добавить тариф'}
          onAction={search.trim() ? undefined : openAdd}
        />
      ) : (
        <div className="w-full">
          {filtered.map((f) => (
            <div
              key={f.id}
              className="flex items-center justify-between gap-3 py-2.5 border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
            >
              <div className="min-w-0 text-xs font-semibold text-[#121316] truncate">{f.name}</div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={UI.chip}>{f.price} EUR</span>
                <button type="button" onClick={() => openEdit(f)} aria-label="Изменить" title="Изменить" className={UI.buttonIcon}>
                  <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(f)}
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
      )}

      <ModalShell
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Изменить тариф парома' : 'Добавить тариф парома'}
        icon={<Anchor className="w-4 h-4" aria-hidden="true" />}
        ariaLabel={editing?.id ? 'Изменить тариф парома' : 'Добавить тариф парома'}
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
            <label className={UI.fieldLabel}>Название (напр. Liepaja - Travemunde) *</label>
            <input
              type="text"
              value={draft.name || ''}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder="Liepaja - Travemunde"
              className={UI.input}
            />
          </div>
          <div className="flex flex-col gap-2">
            <label className={UI.fieldLabel}>Цена (EUR)</label>
            <input
              type="number"
              value={draft.price || ''}
              onChange={(e) => setDraft((d) => ({ ...d, price: e.target.value }))}
              placeholder="0"
              className={UI.input}
            />
          </div>
        </div>
      </ModalShell>
    </div>
  );
}

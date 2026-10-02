import {useState, useEffect, useMemo} from 'react'
import {useDialog} from '../../DialogProvider'
import {useToast} from '../../ToastProvider'
import {dbService} from '../../../api'
import {Coins, Trash2, Plus, Pencil} from 'lucide-react'
import {UserProfile, CurrencyPreset} from '../../../types'
import {UI} from '../../../ui/kit'
import {SectionHeader, SearchField, EmptyState, ModalShell} from '../../../ui/components'

interface Props { user: UserProfile }

export default function CurrencyDirectoryBlock({ user }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [items, setItems] = useState<CurrencyPreset[]>([]);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<CurrencyPreset | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
    if (isSubmitting) return;
    const code = (draft.code || '').trim().toUpperCase();
    if (!code) { toast('Укажите код валюты', 'error'); return; }
    // Проверка уникальности
    if (editing && !(editing as any).id) {
      if (items.some((c) => c.code?.toUpperCase() === code)) {
        toast('Валюта с таким кодом уже существует', 'error');
        return;
      }
    }
    setIsSubmitting(true);
    const rec: any = { ...draft, code };
    if (!rec.id) rec.id = code || 'cur_' + Date.now().toString();
    dbService.saveCurrency(rec as CurrencyPreset, user.name, user.role);
    toast('Валюта сохранена', 'success');
    setIsSubmitting(false);
    setEditing(null);
  };

  const handleDelete = async (c: CurrencyPreset) => {
    if (await showConfirm(`Удалить валюту «${c.code}»?`)) {
      dbService.deleteCurrency(c.id, user.name, user.role);
      toast('Удалено', 'success');
    }
  };

  return (
    <div className="flex flex-col gap-4 min-w-0">
      <SectionHeader
        icon={<Coins className="w-4 h-4" />}
        tone="graphite"
        title="Валюты"
        subtitle="Коды валют, используемые в расчётах и тарифах"
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
        placeholder="Поиск по коду валюты…"
        ariaLabel="Поиск валют по коду"
        className="max-w-md"
      />

      {filtered.length === 0 ? (
        <EmptyState
          kind={search.trim() ? 'no-results' : 'empty'}
          query={search}
          title={search.trim() ? undefined : 'Валют пока нет'}
          hint={search.trim() ? undefined : 'Добавьте первую валюту — она появится в этом списке.'}
          actionLabel={search.trim() ? undefined : 'Добавить валюту'}
          onAction={search.trim() ? undefined : openAdd}
        />
      ) : (
        <div className="w-full">
          {filtered.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between gap-3 py-2.5 border-b border-[#E5E7EB] last:border-0 hover:bg-[#F9FAFB] transition-colors"
            >
              <div className="min-w-0 text-xs font-semibold font-mono text-[#121316]">{c.code}</div>
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
      )}

      <ModalShell
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Изменить валюту' : 'Добавить валюту'}
        subtitle="Код валюты — три заглавные латинские буквы"
        icon={<Coins className="w-4 h-4" aria-hidden="true" />}
        ariaLabel={editing?.id ? 'Изменить валюту' : 'Добавить валюту'}
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
        <div className="flex flex-col gap-2">
          <label className={UI.fieldLabel}>Код (напр. EUR) *</label>
          <input
            value={draft.code || ''}
            onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value.toUpperCase() }))}
            placeholder="EUR"
            className={UI.input}
          />
        </div>
      </ModalShell>
    </div>
  );
}

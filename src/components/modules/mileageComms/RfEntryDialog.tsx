/**
 * Диалог ручной фиксации въезда в РФ. Никаких автопредположений:
 * время и источник подтверждения вводит сотрудник.
 */

import { useEffect, useState } from 'react';
import { CarFront, Trash2 } from 'lucide-react';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { UserProfile } from '../../../types';
import { useToast } from '../../ToastProvider';
import { useDialog } from '../../DialogProvider';
import { mcService } from './mcService';
import { MC_RF_SOURCES, fmtTs, type McRfEntry } from './mcTypes';

interface Props {
  carKey: string | null;
  carLabel: string;
  existing: McRfEntry | null;
  user: UserProfile;
  canEdit: boolean;
  onClose: () => void;
}

/** Значение для <input type="datetime-local"> из мс (локальное время браузера). */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return d.toISOString().slice(0, 16);
}

export default function RfEntryDialog({ carKey, carLabel, existing, user, canEdit, onClose }: Props) {
  const { toast } = useToast();
  const { showConfirm } = useDialog();
  const [atLocal, setAtLocal] = useState('');
  const [source, setSource] = useState<string>(MC_RF_SOURCES[0]);
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!carKey) return;
    setAtLocal(toLocalInput(existing?.atMs || Date.now()));
    setSource(existing?.source || MC_RF_SOURCES[0]);
    setComment(existing?.comment || '');
  }, [carKey, existing]);

  const save = async () => {
    if (!carKey || !canEdit || saving) return;
    const parsed = new Date(atLocal).getTime();
    if (!Number.isFinite(parsed)) {
      toast('Укажите корректные дату и время въезда', 'error');
      return;
    }
    setSaving(true);
    try {
      await mcService.writeRfEntry({ carKey, atMs: parsed, source, comment, user });
      toast('Въезд в РФ зафиксирован', 'success');
      onClose();
    } catch (e) {
      toast(`Не удалось сохранить: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = async () => {
    if (!carKey) return;
    const ok = await showConfirm('Удалить отметку въезда в РФ? Контекст окна ожидания перестанет учитываться.', 'Удаление отметки');
    if (!ok) return;
    try {
      await mcService.clearRfEntry({ carKey, user });
      toast('Отметка удалена', 'success');
      onClose();
    } catch (e) {
      toast(`Не удалось удалить: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, 'error');
    }
  };

  return (
    <ModalShell
      isOpen={carKey != null}
      onClose={onClose}
      title="Въезд в РФ — подтверждённая отметка"
      subtitle={`${carLabel}${existing ? ` · действует: ${fmtTs(existing.atMs)}` : ''}`}
      icon={<CarFront className="w-4 h-4" />}
      footer={
        canEdit ? (
          <div className="flex items-center justify-between w-full">
            {existing ? (
              <button type="button" className={UI.buttonDanger} onClick={removeEntry}>
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Удалить
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button type="button" className={UI.buttonGhost} onClick={onClose}>Отмена</button>
              <button type="button" className={UI.buttonPrimary} onClick={save} disabled={saving} data-testid="mc-rf-save">
                {saving ? 'Сохранение…' : 'Зафиксировать'}
              </button>
            </div>
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-xs text-[#6B7280] leading-relaxed">
          Отметка ставится только по подтверждённому сотрудником факту (сообщение водителя, звонок и т. п.).
          Система не определяет въезд автоматически по последней точке на границе.
        </p>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Дата и время въезда</span>
          <input type="datetime-local" className={UI.input} value={atLocal} onChange={(e) => setAtLocal(e.target.value)} disabled={!canEdit} data-testid="mc-rf-datetime" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Способ подтверждения</span>
          <select className={UI.select} value={source} onChange={(e) => setSource(e.target.value)} disabled={!canEdit}>
            {MC_RF_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Комментарий</span>
          <textarea className={UI.textarea} rows={3} value={comment} onChange={(e) => setComment(e.target.value)} disabled={!canEdit} placeholder="Кто подтвердил, обстоятельства"></textarea>
        </label>
      </div>
    </ModalShell>
  );
}

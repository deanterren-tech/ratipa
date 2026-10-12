/**
 * Окно «+ Направление» — АДДИТИВНОЕ добавление варианта в справочник
 * `directories/directions` (существующие записи не переписываются).
 *
 * Упрощено по требованию владельца: НИКАКИХ ставок, средних дней и плановых
 * значений — только минимальный набор, работающий на переключатель рейса:
 *   { id, dbKey, code (короткий: TR/CN/…), name, label, active, order }.
 * Плюс запись цвета в `directories/tripDirections` (если такого названия там
 * ещё нет) — чтобы чипы направлений и раскраска на таймлайне работали сразу.
 *
 * Правила окна: сохранение после подтверждения; защита от дублей ПО КОДУ и
 * предупреждение о совпадении названия; ошибки — внутри окна, данные формы не
 * теряются; успех — окно закрывается (существующий паттерн модальных окон).
 */
import { useState } from 'react';
import { Plus, TriangleAlert } from 'lucide-react';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { useDialog } from '../../DialogProvider';
import { useToast } from '../../ToastProvider';
import { directoryService } from '../../../api';
import { DIRECTION_PALETTE } from './lib/directions';
import { normalizeDirectionCode, type DirectionOption } from './lib/directionCatalog';

interface Props {
  /** Все записи справочника — для проверки дублей. */
  existing: DirectionOption[];
  /** Названия из directories/tripDirections — для цвета и без дублей. */
  existingColorNames: string[];
  user: { name: string; role: string };
  onClose: () => void;
  onSaved: (entry: DirectionOption) => void;
}

const labelCls = 'text-[13px] font-medium text-[#6B7280]';
const fieldCls =
  'w-full h-11 bg-white border border-[#E5E7EB] rounded-xl px-3.5 text-[15px] text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]';
const footerBtnBase =
  'inline-flex items-center justify-center gap-2 px-5 min-h-[46px] rounded-xl text-[15px] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed';

export default function DirectionAddModal({ existing, existingColorNames, user, onClose, onSaved }: Props) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (saving) return;
    const trimmedName = name.trim();
    const normCode = normalizeDirectionCode(code);
    if (!trimmedName) {
      setError('Укажите название направления (например, «Литва»).');
      return;
    }
    if (!/^[A-ZА-Я0-9]{2,4}$/.test(normCode)) {
      setError('Короткий код — 2–4 буквы/цифры без пробелов (например, TR, CN, LT). Он сохранится в рейсе.');
      return;
    }
    const dupCode = existing.find((d) => normalizeDirectionCode(d.code) === normCode);
    if (dupCode) {
      setError(`Код ${normCode} уже занят направлением «${dupCode.name}» — дубликат не создаётся. Измените код.`);
      return;
    }
    const dupName = existing.find((d) => d.name.trim().toLowerCase() === trimmedName.toLowerCase());
    const ok = await showConfirm(
      dupName
        ? `Направление с названием «${trimmedName}» уже есть (код ${dupName.code}). Добавить второе с названием «${trimmedName}» и кодом ${normCode}?`
        : `Добавить направление «${trimmedName}» с кодом ${normCode}?`,
      'Новое направление',
      dupName ? { confirmLabel: 'Добавить всё равно', cancelLabel: 'Отмена' } : { confirmLabel: 'Добавить', cancelLabel: 'Отмена' },
    );
    if (!ok) return;
    if (!directoryService.isOnline()) {
      setError('Нет подключения к базе — направление не добавлено. Данные формы сохранены, повторите после восстановления связи.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const id = `dir_${Date.now().toString()}`;
      const record: Record<string, unknown> = {
        id,
        dbKey: id,
        code: normCode,
        name: trimmedName,
        label: trimmedName,
        active,
        order: 1000 + existing.length,
        createdBy: user.name,
        createdAt: new Date().toISOString(),
      };
      directoryService.saveDirItem('directions', record, user.name, user.role);
      // Цвет на таймлайн — отдельный справочник (та же запись, что у встроенных
      // Китая/Турции через DEFAULT_DIRECTIONS): только если названия там ещё нет.
      const colorExists = existingColorNames.some((n) => n.trim().toLowerCase() === trimmedName.toLowerCase());
      if (!colorExists) {
        const color = DIRECTION_PALETTE[(existingColorNames.length + existing.length) % DIRECTION_PALETTE.length];
        directoryService.saveDirItem(
          'tripDirections',
          { id: `td_${id}`, name: trimmedName, code: normCode, color, order: 100 + existingColorNames.length },
          user.name,
          user.role,
        );
      }
      toast(`Направление «${trimmedName}» (${normCode}) добавлено`, 'success');
      onSaved({ id, code: normCode, name: trimmedName, order: 1000 + existing.length, active });
      onClose();
    } catch (err) {
      setError(`Не удалось сохранить направление: ${(err as Error)?.message || 'неизвестная ошибка'}. Данные формы сохранены — повторите.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      title="+ Направление"
      subtitle="Вариант переключателя направления в рейсах: название и короткий код (он сохраняется в рейсе)"
      icon={<Plus className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Добавить направление"
      closeProminent
      maxWidth="max-w-[560px]"
      footer={
        <>
          {error ? (
            <div className={`${UI.errorBox} mr-auto min-w-0 flex-1`} role="alert" data-ui="direction-add-error">
              <span className="flex items-start gap-1.5">
                <TriangleAlert className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
                <span>{error}</span>
              </span>
            </div>
          ) : (
            <span className={`${UI.hint} mr-auto`}>Проверка дублей по коду; сохранение — после подтверждения.</span>
          )}
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            data-ui="direction-add-cancel"
            className={`${footerBtnBase} bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] font-medium`}
          >
            Отмена
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            data-ui="direction-add-save"
            className={`${footerBtnBase} bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] font-semibold shadow-sm`}
          >
            {saving ? 'Сохранение…' : 'Добавить'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-5 py-1" data-ui="direction-add-form">
        <section className="flex flex-col gap-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className={labelCls}>Название *</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Литва"
                className={fieldCls}
                data-ui="direction-add-name"
              />
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className={labelCls}>Короткий код *</label>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                onBlur={() => setCode((v) => normalizeDirectionCode(v))}
                placeholder="LT"
                className={`${fieldCls} font-mono uppercase`}
                data-ui="direction-add-code"
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-[#121316] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="w-4 h-4 rounded border-[#D1D5DB] accent-[var(--accent)] cursor-pointer"
              data-ui="direction-add-active"
            />
            Активно (видно в переключателе)
          </label>
          <p className={`${UI.hint}`}>
            Ставок и плановых значений у направления НЕТ (упрощено по требованию владельца): в рейсе хранится одно значение-код
            («TR»/«CN»). Существующие записи справочника не переписываются — добавляется новая.
          </p>
        </section>
      </div>
    </ModalShell>
  );
}

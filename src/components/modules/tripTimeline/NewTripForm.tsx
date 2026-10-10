/**
 * Форма «Новый рейс» — создаёт связанную запись «Плана дохода».
 *
 * Раньше форма создавала отдельный «ручной рейс» ветки tripTimeline/trips,
 * который оставался без плана дохода. Теперь рейс из таймлайна создаётся СРАЗУ
 * как запись «Плана дохода» (trips_dashboard) — целые рейсы таймлайна и так
 * строятся из этих записей на чтении, поэтому дублирующей сущности нет.
 * Финансы (фрахт/расходы/прибыль) в форме не спрашиваются и не выдумываются:
 * запись создаётся в состоянии «Требует заполнения» и заполняется в плане.
 *
 * Форма отдаёт черновик наверх (`onCreate`) и НЕ сбрасывает поля до успешной
 * записи: при ошибке введённые данные остаются, показывается сообщение, а
 * повторная отправка защищена (кнопка блокируется, ключ записи переиспользуется).
 */
import { useState } from 'react';
import { Loader2, Plus } from 'lucide-react';
import CouplingPicker from '../../common/CouplingPicker';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { dayNum, todayStr } from './lib/timeline';
import DateInput from './DateInput';
import type { DispatcherOption } from './useTimelineData';

export interface NewTripDraft {
  /** Номер машины (тягача) — ключ строки таймлайна. */
  carNumber: string;
  vehicleId?: string;
  route: string;
  dispatcherId: string;
  dispatcherName: string;
  startDate: string;
  /** Плановая дата возвращения; пусто — план открыт (неполный), дата не выдумывается. */
  endDate: string;
  /** Количество кругов рейса — целое от 1 (по умолчанию 1). */
  circles: number;
}

/** Результат создания: ошибку форма показывает сама, данные не теряются. */
export interface NewTripResult {
  ok: boolean;
  error?: string;
}

interface Props {
  dispatchers: DispatcherOption[];
  /** Предвыбранный диспетчер: текущий пользователь, если он диспетчер. */
  defaultDispatcherId: string;
  canWrite: boolean;
  onCreate: (draft: NewTripDraft) => Promise<NewTripResult>;
  onCancel?: () => void;
}

export default function NewTripForm({ dispatchers, defaultDispatcherId, canWrite, onCreate, onCancel }: Props) {
  const [carNumber, setCarNumber] = useState('');
  const [vehicleId, setVehicleId] = useState<string | undefined>(undefined);
  const [route, setRoute] = useState('');
  const [dispatcherId, setDispatcherId] = useState(defaultDispatcherId);
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState('');
  /** Круги рейса: целое от 1; по умолчанию 1 (один внешний круг). */
  const [circles, setCircles] = useState(1);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => {
    setCarNumber('');
    setVehicleId(undefined);
    setRoute('');
    setEndDate('');
    setStartDate(todayStr());
    setCircles(1);
    setError('');
  };

  const submit = async () => {
    if (!canWrite || submitting) return;
    if (!carNumber.trim()) {
      setError('Укажите машину — выберите сцепку из базы.');
      return;
    }
    const s = dayNum(startDate);
    const e = dayNum(endDate);
    if (s != null && e != null && e < s) {
      setError('Плановое возвращение не может быть раньше планового старта.');
      return;
    }
    const disp = dispatchers.find((d) => d.id === dispatcherId);
    setError('');
    setSubmitting(true);
    const res = await onCreate({
      carNumber: carNumber.trim(),
      vehicleId,
      route: route.trim(),
      dispatcherId: disp ? disp.id : '',
      dispatcherName: disp ? disp.name : '',
      startDate: startDate || todayStr(),
      endDate,
      circles: Math.max(1, Math.floor(circles) || 1),
    });
    setSubmitting(false);
    if (!res.ok) {
      // Данные формы сохранены — повторная отправка безопасна (один и тот же ключ).
      setError(res.error || 'Не удалось создать рейс — повторите отправку.');
      return;
    }
    reset();
  };

  return (
    <div data-ui="new-trip-form" className="border border-[#E5E7EB] rounded-2xl bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={UI.sectionTitle}>Новый рейс</h3>
        <span className={UI.hint}>
          Рейс создаётся вместе с записью «Плана дохода»; фрахт и расходы заполняются в плане (статус «Требует заполнения»)
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Машина (из базы сцепок) *</label>
          <CouplingPicker
            value={carNumber}
            onSelect={(rec: { carNumber?: string; couplingId?: string; id?: string } | null) => {
              if (!rec) {
                setCarNumber('');
                setVehicleId(undefined);
                return;
              }
              const plate = rec.carNumber || '';
              setCarNumber(plate);
              setVehicleId(rec.couplingId || rec.id || undefined);
              setError('');
            }}
            mode="coupling"
            placeholder="Поиск сцепки (номер тягача)…"
            compact
          />
          {carNumber ? <span className={UI.hint}>Выбрано: {formatPlate(carNumber)}</span> : null}
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Маршрут</label>
          <input
            type="text"
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="Москва — Алматы"
            className={UI.inputSm}
            data-ui="new-trip-route"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Диспетчер</label>
          <select
            value={dispatcherId}
            onChange={(e) => setDispatcherId(e.target.value)}
            className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-1.5 text-xs text-[#121316] outline-none transition-colors cursor-pointer focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]"
            data-ui="new-trip-dispatcher"
          >
            <option value="">— не указан —</option>
            {dispatchers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Старт (план)</label>
          <DateInput value={startDate} onChange={setStartDate} ariaLabel="Старт рейса (план)" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Возвращение (план)</label>
          <DateInput value={endDate} onChange={setEndDate} ariaLabel="Возвращение рейса (план)" />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Круги</label>
          <div className="inline-flex items-center gap-1" data-ui="new-trip-circles">
            <button
              type="button"
              aria-label="Уменьшить количество кругов"
              disabled={circles <= 1}
              onClick={() => setCircles((c) => Math.max(1, c - 1))}
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-[#E5E7EB] bg-white text-[#4B5563] text-sm font-semibold hover:bg-[#F3F4F6] disabled:opacity-40 disabled:cursor-default transition-colors cursor-pointer"
            >
              −
            </button>
            <span
              className="inline-flex items-center justify-center min-w-[28px] h-7 rounded-lg border border-[#E5E7EB] bg-white text-xs font-semibold text-[#121316] tabular-nums"
              data-circles-value={circles}
              aria-live="polite"
              title="Количество кругов рейса: целое от 1 (по умолчанию 1)"
            >
              {circles}
            </span>
            <button
              type="button"
              aria-label="Увеличить количество кругов"
              onClick={() => setCircles((c) => c + 1)}
              className="inline-flex items-center justify-center w-7 h-7 rounded-lg border border-[#E5E7EB] bg-white text-[#4B5563] text-sm font-semibold hover:bg-[#F3F4F6] transition-colors cursor-pointer"
            >
              +
            </button>
          </div>
        </div>
      </div>
      {error ? <div className={UI.errorBox} role="alert" data-ui="new-trip-error">{error}</div> : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={!canWrite || submitting}
          className={UI.buttonPrimary}
          data-ui="new-trip-submit"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Plus className="w-4 h-4" aria-hidden="true" />}
          {submitting ? 'Создание…' : 'Добавить рейс'}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} disabled={submitting} className={UI.buttonGhost}>
            Отмена
          </button>
        ) : null}
        {!canWrite ? <span className={UI.hint}>Нет права на изменение — форма доступна только для чтения.</span> : null}
      </div>
    </div>
  );
}

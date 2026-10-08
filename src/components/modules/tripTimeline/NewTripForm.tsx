/**
 * Форма «Новый рейс» — простая (машина, маршрут, диспетчер, запас, старт).
 * Вынесена в отдельный компонент: по референсу владельца её будут переделывать,
 * поэтому всё, что она делает, — собирает черновик и отдаёт его наверх
 * (`onCreate`); запись в базу и открытие карточки живут в корне модуля.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import CouplingPicker from '../../common/CouplingPicker';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { todayStr } from './lib/timeline';
import DateInput from './DateInput';
import type { DispatcherOption } from './useTimelineData';

export interface NewTripDraft {
  /** Номер машины (тягача) — ключ строки таймлайна. */
  carNumber: string;
  vehicleId?: string;
  route: string;
  dispatcherId: string;
  dispatcherName: string;
  bufferDays: number;
  startDate: string;
}

interface Props {
  dispatchers: DispatcherOption[];
  /** Предвыбранный диспетчер: текущий пользователь, если он диспетчер. */
  defaultDispatcherId: string;
  canWrite: boolean;
  onCreate: (draft: NewTripDraft) => void;
  onCancel?: () => void;
}

export default function NewTripForm({ dispatchers, defaultDispatcherId, canWrite, onCreate, onCancel }: Props) {
  const [carNumber, setCarNumber] = useState('');
  const [vehicleId, setVehicleId] = useState<string | undefined>(undefined);
  const [route, setRoute] = useState('');
  const [dispatcherId, setDispatcherId] = useState(defaultDispatcherId);
  const [bufferDays, setBufferDays] = useState('2');
  const [startDate, setStartDate] = useState(todayStr());
  const [error, setError] = useState('');

  const submit = () => {
    if (!canWrite) return;
    if (!carNumber.trim()) {
      setError('Укажите машину — выберите сцепку из базы.');
      return;
    }
    const disp = dispatchers.find((d) => d.id === dispatcherId);
    onCreate({
      carNumber: carNumber.trim(),
      vehicleId,
      route: route.trim(),
      dispatcherId: disp ? disp.id : '',
      dispatcherName: disp ? disp.name : '',
      bufferDays: Math.max(0, Number(bufferDays.replace(',', '.')) || 0),
      startDate: startDate || todayStr(),
    });
    setCarNumber('');
    setVehicleId(undefined);
    setRoute('');
    setBufferDays('2');
    setStartDate(todayStr());
    setError('');
  };

  return (
    <div data-ui="new-trip-form" className="border border-[#E5E7EB] rounded-2xl bg-white p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className={UI.sectionTitle}>Новый рейс</h3>
        <span className={UI.hint}>Форму доработаем по референсу — сейчас базовые поля</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
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
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Диспетчер</label>
          <select
            value={dispatcherId}
            onChange={(e) => setDispatcherId(e.target.value)}
            className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-1.5 text-xs text-[#121316] outline-none transition-colors cursor-pointer focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]"
          >
            <option value="">— не указан —</option>
            {dispatchers.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Запас, дней</label>
          <input
            type="number"
            min={0}
            value={bufferDays}
            onChange={(e) => setBufferDays(e.target.value)}
            className={`${UI.inputSm} w-[90px]`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel}>Старт (план)</label>
          <DateInput value={startDate} onChange={setStartDate} ariaLabel="Старт рейса (план)" />
        </div>
      </div>
      {error ? <div className={UI.errorBox}>{error}</div> : null}
      <div className="flex items-center gap-2">
        <button type="button" onClick={submit} disabled={!canWrite} className={UI.buttonPrimary}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          Добавить рейс
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className={UI.buttonGhost}>
            Отмена
          </button>
        ) : null}
        {!canWrite ? <span className={UI.hint}>Нет права на изменение — форма доступна только для чтения.</span> : null}
      </div>
    </div>
  );
}

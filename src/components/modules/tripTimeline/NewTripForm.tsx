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
 * Компоновка (редизайн окна): форма владеет всем окном через ModalShell —
 * шапку («Новый рейс» + короткая подсказка + заметное закрытие) и нижнюю
 * панель («Отмена» / «Создать рейс») рисует ModalShell; прокручивается только
 * тело окна с блоками «Машина и ответственный», «Маршрут», «Плановые даты»,
 * «Количество кругов» и спокойным пояснением про «План дохода». Заголовок в
 * самой форме не дублируется.
 *
 * Форма отдаёт черновик наверх (`onCreate`) и НЕ сбрасывает поля до успешной
 * записи: при ошибке введённые данные остаются, показывается сообщение, а
 * повторная отправка защищена (кнопка блокируется, ключ записи переиспользуется).
 * Бизнес-логика не менялась: все проверки, обработчики и формат данных прежние.
 */
import { useState } from 'react';
import { Info, Loader2, Plus, TriangleAlert } from 'lucide-react';
import CouplingPicker from '../../common/CouplingPicker';
import { ModalShell } from '../../../ui/components';
import { UI, plural } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { dayNum, todayStr } from './lib/timeline';
import { planDaysForRange } from './lib/planFromDraft';
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

/** Подпись поля формы: над полем, а не вместо него (15–16px — только значения). */
const labelCls = 'text-[13px] font-medium text-[#6B7280]';
/** Заголовок блока формы. */
const blockTitleCls = 'text-[13px] font-semibold text-[#121316]';
/** Основное поле формы: высота 48px, значение 15px. */
const fieldCls =
  'w-full h-12 bg-white border border-[#E5E7EB] rounded-xl px-3.5 text-[15px] text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]';
/** Кнопка нижней панели: высота 46px, подпись 15px. */
const footerBtnBase =
  'inline-flex items-center justify-center gap-2 px-5 min-h-[46px] rounded-xl text-[15px] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]';

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

  // Ошибка порядка дат — «рядом с полями»: выводится из самих дат и видна
  // сразу, а не только после нажатия «Создать рейс».
  const startNum = dayNum(startDate);
  const endNum = dayNum(endDate);
  const dateOrderError = startNum != null && endNum != null && endNum < startNum;
  // Длительность — существующий расчёт приложения («План дохода»: обе даты
  // включительно), та же функция, что пишет поле days записи.
  const durationDays = dateOrderError ? undefined : planDaysForRange(startDate, endDate);

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
    if (dateOrderError) {
      // Сообщение уже показано рядом с полями дат.
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
    <ModalShell
      isOpen
      onClose={onCancel ?? (() => undefined)}
      title="Новый рейс"
      subtitle="Выберите машину, укажите маршрут и плановые даты"
      icon={<Plus className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Новый рейс"
      closeProminent
      maxWidth="max-w-[940px]"
      /* Нижняя панель — вне прокручиваемого тела окна (слот footer ModalShell):
         вторичная «Отмена» и основная «Создать рейс» всегда видны; во время
         сохранения — «Создание…» и защита от повторного нажатия; ошибка
         отправки видна прямо здесь, данные формы при этом не сбрасываются. */
      footer={
        <>
          {error ? (
            <div className={`${UI.errorBox} mr-auto min-w-0 flex-1`} role="alert" data-ui="new-trip-error">
              {error}
            </div>
          ) : null}
          {!canWrite ? (
            <span className={`${UI.hint} mr-auto`}>Нет права на изменение — форма доступна только для чтения.</span>
          ) : null}
          {onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              disabled={submitting}
              className={`${footerBtnBase} bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] text-[#4B5563] hover:text-[#121316] font-medium`}
              data-ui="new-trip-cancel"
            >
              Отмена
            </button>
          ) : null}
          <button
            type="button"
            onClick={submit}
            disabled={!canWrite || submitting}
            className={`${footerBtnBase} bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-[var(--accent-on)] font-semibold shadow-sm`}
            data-ui="new-trip-submit"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            ) : (
              <Plus className="w-4 h-4" aria-hidden="true" />
            )}
            {submitting ? 'Создание…' : 'Создать рейс'}
          </button>
        </>
      }
    >
      {/* Содержимое формы — единственная прокручиваемая зона окна: шапка и
          нижняя панель рисуются ModalShell'ом отдельно и остаются видимыми. */}
      <div data-ui="new-trip-form" className="flex flex-col gap-6 py-1">
        {/* Блок «Машина и ответственный»: выбор машины (поиск по базе сцепок)
            и диспетчер — на компьютере в две колонки. */}
        <section data-ui="new-trip-block-vehicle" className="flex flex-col gap-4">
          <h3 className={blockTitleCls}>Машина и ответственный</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className={labelCls}>Машина *</label>
              {/* Поле выбора сцепки: тот же CouplingPicker, крупнее под ритм
                  формы (48px / 15px) — размер задаётся только здесь. */}
              <div className="[&_input]:h-12 [&_input]:rounded-xl [&_input]:px-3.5 [&_input]:text-[15px]">
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
                  placeholder="Поиск по номеру тягача"
                  compact
                />
              </div>
              {carNumber ? (
                <span className="text-[13px] text-[#6B7280]" title={formatPlate(carNumber)}>
                  Выбрано: {formatPlate(carNumber)}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className={labelCls}>Диспетчер</label>
              <select
                value={dispatcherId}
                onChange={(e) => setDispatcherId(e.target.value)}
                className={`${fieldCls} cursor-pointer`}
                data-ui="new-trip-dispatcher"
              >
                <option value="">— не указан —</option>
                {dispatchers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        {/* Блок «Маршрут»: на всю ширину; многострочное поле, чтобы длинный
            маршрут читался целиком. Формат хранения не меняется — та же
            строка, что и раньше. */}
        <section data-ui="new-trip-block-route" className="flex flex-col gap-3">
          <h3 className={blockTitleCls}>Маршрут</h3>
          <textarea
            value={route}
            onChange={(e) => setRoute(e.target.value)}
            placeholder="Минск → Москва → Алматы → Минск"
            rows={2}
            className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3.5 py-3 min-h-[64px] text-[15px] leading-relaxed text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)] resize-y"
            data-ui="new-trip-route"
          />
        </section>

        {/* Блок «Плановые даты»: существующие календарные компоненты (DateInput),
            две колонки; ошибка порядка — рядом с полями, длительность — ниже. */}
        <section data-ui="new-trip-block-dates" className="flex flex-col gap-3">
          <h3 className={blockTitleCls}>Плановые даты</h3>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className={labelCls}>Плановый выезд</label>
              <div className="[&_input]:min-h-[46px] [&_input]:text-[15px]">
                <DateInput value={startDate} onChange={setStartDate} ariaLabel="Плановый выезд" compact={false} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5 min-w-0">
              <label className={labelCls}>Плановое возвращение</label>
              <div className="[&_input]:min-h-[46px] [&_input]:text-[15px]">
                <DateInput value={endDate} onChange={setEndDate} ariaLabel="Плановое возвращение" compact={false} />
              </div>
            </div>
          </div>
          {dateOrderError ? (
            <p role="alert" data-ui="new-trip-date-error" className="flex items-start gap-1.5 text-[13px] text-rose-600">
              <TriangleAlert className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
              Плановое возвращение не может быть раньше планового выезда.
            </p>
          ) : null}
          {durationDays != null ? (
            <p data-ui="new-trip-duration" className="text-[13px] text-[#6B7280]">
              Длительность рейса:{' '}
              <span className="font-semibold text-[#121316]">
                {durationDays} {plural(durationDays, 'день', 'дня', 'дней')}
              </span>
              <span className="text-[#9CA3AF]"> · обе даты включительно</span>
            </p>
          ) : null}
        </section>

        {/* Блок «Количество кругов»: прежняя логика и ограничения (целое от 1,
            шаг 1) — крупнее кнопки «−/+», читаемое число. */}
        <section data-ui="new-trip-block-circles" className="flex flex-col gap-3">
          <h3 className={blockTitleCls}>Количество кругов</h3>
          <div className="inline-flex items-center gap-2" data-ui="new-trip-circles">
            <button
              type="button"
              aria-label="Уменьшить количество кругов"
              disabled={circles <= 1}
              onClick={() => setCircles((c) => Math.max(1, c - 1))}
              className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-[#E5E7EB] bg-white text-[#4B5563] text-lg font-semibold hover:bg-[#F3F4F6] disabled:opacity-40 disabled:cursor-default transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
            >
              −
            </button>
            <span
              className="inline-flex items-center justify-center min-w-[56px] h-11 px-3 rounded-xl border border-[#E5E7EB] bg-white text-[16px] font-semibold text-[#121316] tabular-nums"
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
              className="inline-flex items-center justify-center w-11 h-11 rounded-xl border border-[#E5E7EB] bg-white text-[#4B5563] text-lg font-semibold hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
            >
              +
            </button>
          </div>
        </section>

        {/* Единственный спокойный информационный блок про «План дохода»
            (вместо повторявшихся пояснений в шапке и у полей). */}
        <div
          data-ui="new-trip-info"
          className="flex items-start gap-2.5 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3"
        >
          <Info className="w-4 h-4 shrink-0 mt-0.5 text-[#9CA3AF]" aria-hidden="true" />
          <div className="flex flex-col gap-1.5 min-w-0">
            <p className="text-[13px] leading-relaxed text-[#6B7280]">
              При создании рейса автоматически создаётся запись в «Плане дохода». Фрахт и расходы можно
              заполнить там позже.
            </p>
            <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
              <span>Статус финансовой записи:</span>
              <span className={UI.chip} data-ui="new-trip-info-status">
                Требует заполнения
              </span>
            </div>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

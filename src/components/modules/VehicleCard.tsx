/**
 * ПОЛНАЯ КАРТОЧКА АВТОМОБИЛЯ — единственная реализация на весь портал.
 *
 * Открывается из справочников («Автопарк и Водители»), из раздела «Данные по
 * авто и водителям» и из карточки водителя. Данные всегда загружаются полной
 * записью по vehicleId (tractors + couplings + trailers + водители + диспетчер
 * + тариф): строка списка в карточку не подставляется.
 *
 * Состояния: загрузка полной записи, ошибка с повторной попыткой, «не найдено»,
 * «нет доступа», незаполненные поля — «Не указано».
 */
import {
  Truck,
  User,
  Phone,
  MapPin,
  Calendar,
  ArrowRight,
  RefreshCw,
  AlertTriangle,
  Pencil,
  X,
} from 'lucide-react';
import {UI} from '../../ui/kit';
import {ModalShell, ErrorRow, EmptyState} from '../../ui/components';
import {useVehicleCard} from '../../hooks/useFleetCards';
import {
  displayValue,
  type VehicleCardModel,
  type VehicleDriverSlot,
} from '../../utils/fleetCardModel';
import {driverLinkNotice} from '../../utils/driverRegistry';
import {formatPlate} from '../../utils/salaryAutofill';

export interface VehicleCardProps {
  /** Номер автомобиля (человекочитаемый) или id записи. */
  carNumber: string;
  /** Точный id записи (если известен) — приоритетнее номера при поиске. */
  vehicleId?: string;
  /** Право просмотра (по умолчанию — есть). */
  canView?: boolean;
  /** Право редактирования: кнопка формы появляется только при нём. */
  canEdit?: boolean;
  /** Открыть существующую форму редактирования автомобиля. */
  onEdit?: (carNumber: string, vehicleId?: string) => void;
  /** Переход к карточке водителя — строго по driverId. */
  onOpenDriver?: (driverId: string, driverName: string) => void;
  onClose: () => void;
}

export default function VehicleCard({
  carNumber,
  vehicleId,
  canView = true,
  canEdit = false,
  onEdit,
  onOpenDriver,
  onClose,
}: VehicleCardProps) {
  const {phase, model, trips, retry} = useVehicleCard(carNumber, vehicleId);

  const title = model?.carNumber ? formatPlate(model.carNumber) : (carNumber || 'Автомобиль');

  if (!canView) {
    return (
      <ModalShell
        isOpen
        onClose={onClose}
        title="Карточка автомобиля"
        icon={<Truck className="w-4 h-4" aria-hidden="true" />}
        ariaLabel="Карточка автомобиля"
        maxWidth="max-w-lg"
      >
        <EmptyState
          kind="error"
          title="Нет доступа к карточке"
          hint="Просмотр данных автомобилей закрыт в соответствии с правами доступа."
          actionLabel="Закрыть"
          onAction={onClose}
        />
      </ModalShell>
    );
  }

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      title={title}
      subtitle="Полная карточка автомобиля"
      icon={<Truck className="w-4 h-4" aria-hidden="true" />}
      ariaLabel={`Карточка автомобиля ${title}`}
      maxWidth="max-w-2xl"
      footer={
        <>
          {canEdit && onEdit ? (
            <button
              type="button"
              data-ui="vehicle-card-edit"
              onClick={() => onEdit(model?.carNumber || carNumber, model?.recordId || vehicleId)}
              className={UI.buttonGhost}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Редактировать</span>
            </button>
          ) : null}
          <button type="button" data-ui="vehicle-card-close" onClick={onClose} className={UI.buttonPrimary}>
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Закрыть</span>
          </button>
        </>
      }
    >
      <div data-ui="vehicle-card" data-vehicle-id={model?.recordId || vehicleId || carNumber} className="flex flex-col gap-5">
        {phase === 'loading' ? (
          <div className={UI.loading} role="status" data-ui="vehicle-card-loading">
            <RefreshCw className="w-4 h-4 animate-spin text-[#9CA3AF]" aria-hidden="true" />
            <span>Загрузка полной карточки автомобиля…</span>
          </div>
        ) : phase === 'error' ? (
          <div data-ui="vehicle-card-error">
            <ErrorRow text="Не удалось загрузить полную карточку автомобиля." onRetry={retry} />
          </div>
        ) : phase === 'not-found' ? (
          <EmptyState
            kind="no-results"
            title="Автомобиль не найден"
            hint={`Запись «${carNumber}» отсутствует в единой базе сцепок. Проверьте номер или обновите данные.`}
            actionLabel="Повторить"
            onAction={retry}
          />
        ) : model ? (
          <VehicleCardContent
            model={model}
            trips={trips}
            onOpenDriver={onOpenDriver}
          />
        ) : null}
      </div>
    </ModalShell>
  );
}

function VehicleCardContent({
  model,
  trips,
  onOpenDriver,
}: {
  model: VehicleCardModel;
  trips: Array<{ date: string; direction: string }>;
  onOpenDriver?: (driverId: string, driverName: string) => void;
}) {
  return (
    <>
      {/* Группы сведений — по фактической структуре записи */}
      {model.sections.map((section) => (
        <div key={section.key} data-ui={`vehicle-card-section-${section.key}`}>
          <div className={`${UI.caption} mb-2`}>{section.title}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {section.fields.map((field) => (
              <div key={field.key} className="p-2.5 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] min-w-0">
                <div className={UI.fieldLabel}>{field.label}</div>
                <div
                  data-ui={`vehicle-field-${field.key}`}
                  data-empty={field.empty ? '1' : undefined}
                  className={`text-xs mt-1 break-words ${field.mono ? 'font-mono' : ''} ${
                    field.empty ? 'text-[#9CA3AF] italic' : 'font-semibold text-[#121316]'
                  }`}
                >
                  {displayValue(field)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Водители: переходы строго по driverId */}
      <div data-ui="vehicle-card-section-drivers">
        <div className={`${UI.caption} mb-2`}>Водители</div>
        <div className="flex flex-col gap-2">
          {model.drivers.map((slot) => (
            <DriverSlotRow key={slot.role} slot={slot} onOpenDriver={onOpenDriver} />
          ))}
        </div>
        {model.passportVerificationYear ? (
          <div className="mt-2 text-[11px] text-[#6B7280]">
            Паспорт водителя сверен: {model.passportVerificationYear} г.
          </div>
        ) : null}
      </div>

      {/* Связанные данные — только чтение текущих значений */}
      <div data-ui="vehicle-card-section-related">
        <div className={`${UI.caption} mb-2`}>Связанные данные (только чтение)</div>
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
            <MapPin
              className={`w-4 h-4 shrink-0 ${model.baza?.inBaza ? 'text-emerald-500' : 'text-[#9CA3AF]'}`}
              aria-hidden="true"
            />
            <div className="flex-1 min-w-0">
              <div className={UI.fieldLabel}>Местонахождение (Учёт выезда)</div>
              {model.baza ? (
                <div data-ui="vehicle-card-baza" className="text-xs font-semibold text-[#121316] mt-0.5 break-words">
                  {model.baza.statusLabel}
                  {model.baza.dateDeparture ? ` · выезд ${model.baza.dateDeparture}` : ''}
                </div>
              ) : (
                <div data-ui="vehicle-card-baza" className="text-xs text-[#6B7280] mt-0.5">
                  Сейчас не в учёте выезда
                </div>
              )}
            </div>
          </div>

          <div className="p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
            <div className={`${UI.fieldLabel} flex items-center gap-1.5`}>
              <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
              План дохода (последние рейсы)
            </div>
            {trips.length === 0 ? (
              <div className="text-xs text-[#6B7280] mt-1.5">Рейсы не найдены</div>
            ) : (
              <div className="flex flex-col gap-1 mt-1.5">
                {trips.map((t, i) => (
                  <div
                    key={i}
                    data-ui="vehicle-card-trip"
                    className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-xl bg-white border border-[#E5E7EB]"
                  >
                    <span className="font-mono text-[#4B5563] shrink-0">{t.date || '—'}</span>
                    <span className="text-[#6B7280] truncate text-right">{t.direction || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function DriverSlotRow({
  slot,
  onOpenDriver,
}: {
  slot: VehicleDriverSlot;
  onOpenDriver?: (driverId: string, driverName: string) => void;
}) {
  const notice = slot.status === 'empty' ? '' : driverLinkNotice(
    {status: slot.status, id: slot.driverId, displayName: slot.displayName, phone: slot.phone},
    slot.role === 'main' ? 'driver' : 'driver2',
  );
  const clickable = !!onOpenDriver
    && !!slot.driverId
    && (slot.status === 'ok' || slot.status === 'archived');

  const body = (
    <>
      <User
        className={`w-4 h-4 shrink-0 ${slot.status === 'ok' || slot.status === 'archived' ? 'text-[var(--accent-ink)]' : 'text-[#9CA3AF]'}`}
        aria-hidden="true"
      />
      <div className="flex-1 min-w-0">
        <div className={UI.fieldLabel}>{slot.label}</div>
        {slot.displayName ? (
          <div className="text-xs font-semibold text-[#121316] truncate mt-0.5 flex items-center gap-2">
            <span className="truncate">{slot.displayName}</span>
            {slot.archived ? (
              <span className="shrink-0 text-[10px] font-medium text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">
                архив
              </span>
            ) : null}
          </div>
        ) : (
          <div className="text-xs text-[#9CA3AF] italic mt-0.5">Не назначен</div>
        )}
        {slot.phone ? (
          <div className="text-[11px] font-mono text-[#4B5563] mt-0.5 flex items-center gap-1">
            <Phone className="w-3 h-3" aria-hidden="true" />
            {slot.phone}
          </div>
        ) : null}
        {notice ? (
          <div className="mt-1 inline-flex items-start gap-1 text-[11px] font-medium text-amber-600" role="status">
            <AlertTriangle className="w-3 h-3 shrink-0 mt-px" aria-hidden="true" />
            <span>{notice}</span>
          </div>
        ) : null}
      </div>
      {clickable ? <ArrowRight className="w-4 h-4 text-[#9CA3AF] shrink-0" aria-hidden="true" /> : null}
    </>
  );

  if (clickable) {
    return (
      <button
        type="button"
        data-ui={`vehicle-card-driver-${slot.role}`}
        data-driver-id={slot.driverId}
        onClick={() => onOpenDriver?.(slot.driverId, slot.displayName)}
        className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors text-left cursor-pointer min-h-[44px]"
      >
        {body}
      </button>
    );
  }
  return (
    <div
      data-ui={`vehicle-card-driver-${slot.role}`}
      data-driver-id={slot.driverId || undefined}
      data-link-status={slot.status}
      className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]"
    >
      {body}
    </div>
  );
}

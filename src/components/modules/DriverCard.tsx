/**
 * ПОЛНАЯ КАРТОЧКА ВОДИТЕЛЯ — единственная реализация на весь портал.
 *
 * Открывается одинаково из базы водителей, из карточки автомобиля, из раздела
 * «Данные по авто и водителям» и из базы сцепок: один компонент + один механизм
 * загрузки (useDriverCard) — полная запись по driverId из `drivers`, телефоны из
 * единого поля phones, назначения и диспетчер — по стабильным id из реестра.
 * Пустые поля показываются как «Не указано»; исторические снимки (документы,
 * завершённые операции) не изменяются — только чтение текущих значений.
 */
import {useEffect} from 'react';
import {
  User,
  Truck,
  Banknote,
  RefreshCw,
  X,
  ArrowRight,
  Pencil,
  AlertTriangle,
  Archive,
} from 'lucide-react';
import {UI} from '../../ui/kit';
import {ModalShell, ErrorRow, EmptyState} from '../../ui/components';
import {useDriverCard} from '../../hooks/useFleetCards';
import {displayValue, type DriverCardModel} from '../../utils/fleetCardModel';

export interface DriverCardProps {
  driverId: string;
  /** Имя для заголовка/подписи, пока запись грузится (связь всё равно по id). */
  driverName?: string;
  /** Право просмотра (по умолчанию — есть). */
  canView?: boolean;
  /** Право редактирования: кнопка формы появляется только при нём. */
  canEdit?: boolean;
  /** Открыть существующую форму редактирования водителя. */
  onEdit?: (driverId: string) => void;
  onClose: () => void;
  /** Переход к карточке машины водителя (номер/связка из назначений). */
  onOpenCoupling: (carNumber: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export default function DriverCard({
  driverId,
  driverName,
  canView = true,
  canEdit = false,
  onEdit,
  onClose,
  onOpenCoupling,
  onPrev,
  onNext,
}: DriverCardProps) {
  const {phase, model, salary, retry} = useDriverCard(driverId, driverName);

  // Keyboard control: Esc closes the card; ArrowLeft/ArrowRight navigate if handlers provided
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  const title = model?.displayName || driverName || 'Карточка водителя';

  if (!canView) {
    return (
      <ModalShell
        isOpen
        onClose={onClose}
        title="Карточка водителя"
        icon={<User className="w-4 h-4" aria-hidden="true" />}
        ariaLabel="Карточка водителя"
        maxWidth="max-w-lg"
      >
        <EmptyState
          kind="error"
          title="Нет доступа к карточке"
          hint="Просмотр данных водителей закрыт в соответствии с правами доступа."
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
      subtitle="Полная карточка водителя"
      icon={<User className="w-4 h-4" aria-hidden="true" />}
      ariaLabel={`Карточка водителя ${title}`}
      maxWidth="max-w-2xl"
      footer={
        <>
          {canEdit && onEdit && model ? (
            <button
              type="button"
              data-ui="driver-card-edit"
              onClick={() => onEdit(model.driverId)}
              className={UI.buttonGhost}
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Редактировать</span>
            </button>
          ) : null}
          <button type="button" data-ui="driver-card-close" onClick={onClose} className={UI.buttonPrimary}>
            <X className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Закрыть</span>
          </button>
        </>
      }
    >
      <div data-ui="driver-card" data-driver-id={driverId} className="flex flex-col gap-5">
        {phase === 'loading' ? (
          <div className={UI.loading} role="status" data-ui="driver-card-loading">
            <RefreshCw className="w-4 h-4 animate-spin text-[#9CA3AF]" aria-hidden="true" />
            <span>Загрузка полной карточки водителя…</span>
          </div>
        ) : phase === 'error' ? (
          <div data-ui="driver-card-error">
            <ErrorRow text="Не удалось загрузить полную карточку водителя." onRetry={retry} />
          </div>
        ) : phase === 'not-found' ? (
          <EmptyState
            kind="no-results"
            title="Водитель не найден"
            hint={
              driverName
                ? `Запись «${driverName}» отсутствует в едином реестре водителей. Новый водитель не создаётся автоматически — проверьте связь.`
                : 'Запись отсутствует в едином реестре водителей. Проверьте связь или добавьте водителя в базу.'
            }
            actionLabel="Повторить"
            onAction={retry}
          />
        ) : model ? (
          <DriverCardContent model={model} salary={salary} onOpenCoupling={onOpenCoupling} />
        ) : null}
      </div>
    </ModalShell>
  );
}

function DriverCardContent({
  model,
  salary,
  onOpenCoupling,
}: {
  model: DriverCardModel;
  salary: Array<{date: string; amount: string}>;
  onOpenCoupling: (carNumber: string) => void;
}) {
  return (
    <>
      {(model.archived || model.service) && (
        <div
          className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-700"
          role="status"
          data-ui="driver-card-record-notice"
        >
          <Archive className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>
            {model.service
              ? 'Служебная запись — не водитель. Из списков выбора скрывается.'
              : 'Архивная запись — не предлагается в новых назначениях.'}
          </span>
        </div>
      )}

      {/* Группы сведений — все существующие пользовательские поля водителя */}
      {model.sections.map((section) => (
        <div key={section.key} data-ui={`driver-card-section-${section.key}`}>
          <div className={`${UI.caption} mb-2`}>{section.title}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {section.fields.map((field) => (
              <div key={field.key} className="p-2.5 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] min-w-0">
                <div className={UI.fieldLabel}>{field.label}</div>
                <div
                  data-ui={`driver-field-${field.key}`}
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

      {/* Назначения: переход к машине — по номеру из связки (id уже разрешён реестром) */}
      <div data-ui="driver-card-section-assignments">
        <div className={`${UI.caption} mb-2`}>Назначения</div>
        {model.assignments.length === 0 ? (
          <div
            data-ui="driver-card-no-assignment"
            className="flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] text-xs text-[#6B7280]"
          >
            <Truck className="w-4 h-4 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
            <span>Не назначен ни на одну машину</span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {model.assignments.map((a) => (
              <button
                key={`${a.role}:${a.carNumber}`}
                type="button"
                data-ui="driver-card-assignment"
                onClick={() => onOpenCoupling(a.carNumber)}
                className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors text-left cursor-pointer min-h-[44px]"
              >
                <Truck className="w-4 h-4 text-[var(--accent-ink)] shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <div className={UI.fieldLabel}>
                    {a.role === 'main' ? 'Основной водитель' : 'Второй водитель'}
                  </div>
                  <div className="text-xs font-semibold text-[#121316] font-mono mt-0.5 truncate">
                    {a.carNumber}
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#9CA3AF] shrink-0" aria-hidden="true" />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Зарплата — связанная ветка, только чтение последних выплат */}
      <div data-ui="driver-card-section-salary">
        <div className={`${UI.caption} flex items-center gap-1.5 mb-2`}>
          <Banknote className="w-3.5 h-3.5" aria-hidden="true" />
          Зарплата (последние 5 выплат)
        </div>
        {salary.length === 0 ? (
          <div className="text-xs text-[#6B7280] py-2" data-ui="driver-card-salary-empty">Нет выплат</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {salary.map((s, i) => (
              <div
                key={i}
                data-ui="driver-card-salary-row"
                className="flex items-center justify-between gap-2 text-xs px-3 py-2 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]"
              >
                <span className="text-[#6B7280] truncate">{s.date || '—'}</span>
                <span className="font-semibold font-mono text-emerald-600 shrink-0">
                  {s.amount || '—'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {model.service ? (
        <div className="flex items-start gap-2 text-[11px] text-amber-600" role="status">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-px" aria-hidden="true" />
          <span>Служебные записи не открываются как карточки водителей в списках выбора.</span>
        </div>
      ) : null}
    </>
  );
}

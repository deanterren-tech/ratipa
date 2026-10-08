/**
 * Детали периода «Учёта выезда»: нахождение на базе и вложенный ремонт.
 * Показывает границы, статус незавершённого периода, причину и предупреждения,
 * а также переход к исходной записи учёта выезда. Ничего не досочиняет.
 */
import { CalendarClock, ExternalLink, Wrench } from 'lucide-react';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { formatPlate } from '../../../utils/salaryAutofill';
import { dayStr, fmtFull } from './lib/timeline';
import {
  baseBarRange,
  baseDeviation,
  readyBarRange,
  repairBarRange,
  type BasePeriod,
} from './lib/sources';

interface Props {
  period: BasePeriod | null;
  today: number;
  onClose: () => void;
  onOpenBaza: (recordId: string) => void;
}

const dayIso = (n: number | null): string => (n == null ? '' : dayStr(n));

export default function PeriodModal({ period, today, onClose, onOpenBaza }: Props) {
  if (!period) return null;
  const base = baseBarRange(period, today);
  const ready = readyBarRange(period);
  const repair = repairBarRange(period, today);
  const dev = baseDeviation(period, today);
  const devTone =
    dev.kind === 'late' || dev.kind === 'overdue'
      ? 'text-rose-600 font-semibold'
      : dev.kind === 'early'
        ? 'text-emerald-600 font-semibold'
        : dev.kind === 'on'
          ? 'text-[#4B5563]'
          : 'text-[#B45309]';
  const none = 'Не указано';

  return (
    <ModalShell
      isOpen={!!period}
      onClose={onClose}
      title="Период «Учёта выезда»"
      subtitle={`${formatPlate(period.carNumber)} · запись ${period.key}`}
      icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Период учёта выезда"
      footer={
        <button type="button" data-ui="open-baza" onClick={() => onOpenBaza(period.id)} className={UI.buttonGhost}>
          <ExternalLink className="w-4 h-4" aria-hidden="true" />
          Открыть учёт выезда
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="border border-[#E5E7EB] rounded-xl overflow-hidden text-[11px]">
          <div className="px-3 py-2 bg-[#F9FAFB] font-semibold text-[#6B7280]">План и факт нахождения на базе</div>
          <div className="px-3 py-2 text-[#4B5563] flex flex-col gap-1.5">
            <span>
              Дата приезда (общее начало плана и факта):{' '}
              <b className="text-[#121316]">{period.arrivalDay != null ? fmtFull(dayIso(period.arrivalDay)) : none}</b>
            </span>
            <span>
              План: приезд → срок готовности:{' '}
              <b className="text-[#121316]">
                {period.arrivalDay != null || period.plannedReadyDay != null
                  ? `${period.arrivalDay != null ? fmtFull(dayIso(period.arrivalDay)) : none} → ${period.plannedReadyDay != null ? fmtFull(dayIso(period.plannedReadyDay)) : 'срок готовности не указан'}`
                  : none}
              </b>
            </span>
            <span>
              Факт: приезд → фактический выезд:{' '}
              <b className="text-[#121316]">
                {period.arrivalDay != null
                  ? `${fmtFull(dayIso(period.arrivalDay))} → ${period.departureDay != null ? fmtFull(dayIso(period.departureDay)) : 'выезд не указан'}`
                  : none}
              </b>
            </span>
            <span>
              Отклонение выезда от срока готовности: <span className={devTone}>{dev.label}</span>
              {dev.days != null && dev.days !== 0 ? ` (календарных дней: ${Math.abs(dev.days)})` : ''}
            </span>
            <span>
              Причина нахождения на базе: <b className="text-[#121316]">{period.causeLabel}</b>
              {period.comment ? ` · ${period.comment}` : ''}
            </span>
          </div>
          {base && base.open ? (
            <div className="px-3 py-2 border-t border-[#E5E7EB] text-[#B45309] bg-amber-50">
              Выезд не указан — фактический период показан открытым до текущей даты. Текущая дата в учёт выезда не записывается.
            </div>
          ) : null}
          {dev.kind === 'overdue' ? (
            <div className="px-3 py-2 border-t border-[#E5E7EB] text-[#B45309] bg-amber-50">
              Срок готовности прошёл, фактический выезд не указан. Возможно, факт просто не внесён — статус машины по этим данным не утверждается.
            </div>
          ) : null}
          {dev.kind === 'no-plan' ? (
            <div className="border-t border-[#E5E7EB] px-3 py-2 text-[#6B7280]">
              Срок готовности не указан — плановое окончание не придумывается; фактическая полоса строится по приезду и выезду.
            </div>
          ) : null}
          {period.arrivalDay == null ? (
            <div className="border-t border-[#E5E7EB] px-3 py-2 text-[#6B7280]">
              Нет даты приезда — неполные данные: полная полоса базы без начала не строится, даты из соседних рейсов не подставляются.
              {dev.days != null ? ` Сравнение сроков допустимо: ${dev.label}.` : ''}
            </div>
          ) : null}
          {ready ? (
            <div className="border-t border-[#E5E7EB] px-3 py-2 text-[#6B7280]">
              Плановая полоса базы (приезд → срок готовности) отрисована в подстроке «План», фактическая (приезд → выезд) — в «Факт».
            </div>
          ) : null}
        </div>

        <div className="border border-[#E5E7EB] rounded-xl overflow-hidden text-[11px]">
          <div className="px-3 py-2 bg-[#F9FAFB] font-semibold text-[#6B7280] inline-flex items-center gap-1.5">
            <Wrench className="w-3.5 h-3.5 text-[#D97706]" aria-hidden="true" />
            Ремонт
          </div>
          {repair ? (
            <>
              <div className="px-3 py-2 text-[#4B5563] flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  начало: <b className="text-[#121316]">{period.repairStartDay != null ? fmtFull(dayIso(period.repairStartDay)) : 'не указано'}</b>
                </span>
                <span>
                  окончание: <b className="text-[#121316]">{period.repairEndDay != null ? fmtFull(dayIso(period.repairEndDay)) : 'не указано'}</b>
                </span>
              </div>
              {repair.open ? (
                <div className="px-3 py-2 border-t border-[#E5E7EB] text-[#B45309] bg-amber-50">
                  Ремонт не завершён — показан до текущей даты, вымышленная дата окончания не создаётся.
                </div>
              ) : null}
              {repair.capped ? (
                <div className="px-3 py-2 border-t border-[#E5E7EB] text-[#B45309] bg-amber-50">
                  Фактический выезд указан, а окончание ремонта не заполнено — ремонт показан до выезда, данные неполные.
                </div>
              ) : null}
            </>
          ) : (
            <div className="px-3 py-2 text-[#6B7280]">
              Ремонт в этой записи не зафиксирован — весь период на базе показан нейтрально, без окрашивания в ремонт.
            </div>
          )}
        </div>

        {period.comment ? <div className={UI.hint}>Комментарий учёта выезда: {period.comment}</div> : null}

        {period.warnings.length ? (
          <div className={UI.errorBox} role="alert">
            <div className="flex flex-col gap-1">
              {period.warnings.map((w) => (
                <span key={w}>• {w}</span>
              ))}
            </div>
          </div>
        ) : (
          <div className={UI.hint}>Конфликтов дат в записи не найдено.</div>
        )}
      </div>
    </ModalShell>
  );
}

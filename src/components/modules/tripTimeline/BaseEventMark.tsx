/**
 * Метка СОБЫТИЯ НА БАЗЕ на полотне таймлайна.
 *
 * Компонент повторяет приём и размеры метки события РЕЙСА (TimelineGrid,
 * case 'event': абсолютная метка на дне события, слой меток TL_Z.mark,
 * высота 9 px как у одиночной метки события рейса, role=button, Enter/Space,
 * полный текст в подсказке, клик открывает окно периода и подсвечивает
 * ИМЕННО это событие). Отличия события базы: свой розово-малиновый цвет
 * (BASE_EVENT_COLORS, lib/visuals), плашка с НАЧАЛОМ ТЕКСТА (у старых записей
 * без текста — подпись бывшего типа) и перенос на следующую строку, когда
 * несколько событий дня не помещаются в одну (раскладка — layoutEventDots).
 * Ширина метки задаётся раскладкой явно — отрисовка совпадает с расчётом.
 */
import { Wrench } from 'lucide-react';
import { EVENT_CHIP_H, eventMarkLabel, eventMarkText, type EventChip } from './lib/repairEvents';
import { BASE_EVENT_COLORS, TL_Z } from './lib/visuals';

interface Props {
  chip: EventChip;
  periodKey: string;
  archived: boolean;
  /** Верхняя координата строки раскладки (px от верхнего края полосы). */
  top: number;
  /** Клик: открыть окно периода этой машины и подсветить событие метки. */
  onOpen: () => void;
}

/** Подпись метки: начало текста (у старых записей без текста — бывший тип) и дата. */
const chipLabel = (chip: EventChip): string => (chip.extra > 0 ? `+${chip.extra}` : eventMarkLabel(chip.items[0]));

export default function BaseEventMark({ chip, periodKey, archived, top, onOpen }: Props) {
  const first = chip.items[0];
  const lines = chip.items.map((e) => `${eventMarkText(e)}`);
  const title = [
    ...lines,
    ...(chip.extra > 0 ? [`и ещё ${chip.extra} — открыть окно периода`] : []),
    'Клик — открыть период учёта выезда и подсветить это событие',
  ].join('\n');
  const label = chipLabel(chip);
  return (
    <button
      type="button"
      data-bz-event={first.type}
      data-bz-event-period={periodKey}
      data-bz-event-day={chip.day}
      data-bz-event-ids={chip.items.map((e) => e.id).join(',')}
      data-bz-event-line={chip.line}
      data-bz-event-width={Math.round(chip.width)}
      aria-label={`Событие на базе: ${eventMarkText(first)}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onOpen();
      }}
      className="absolute inline-flex items-center gap-[1px] overflow-hidden rounded-[2px] px-[2px] text-[7px] leading-[9px] font-medium text-white cursor-pointer select-none"
      style={{
        zIndex: TL_Z.mark,
        left: chip.x,
        top,
        width: chip.width,
        height: EVENT_CHIP_H,
        background: BASE_EVENT_COLORS.chip,
        color: BASE_EVENT_COLORS.chipText,
        boxShadow: `0 0 0 1px ${BASE_EVENT_COLORS.chipRing}`,
        padding: 0,
        opacity: archived ? 0.72 : 1,
        // Слой меток объявлен pointer-events:none (чтобы не мешать полотну) —
        // сама метка обязана принимать мышь: клик открывает окно периода.
        pointerEvents: 'auto',
      }}
    >
      <Wrench
        className="shrink-0"
        style={{ width: 7, height: 7 }}
        strokeWidth={2.4}
        aria-hidden="true"
      />
      <span className="truncate">{label}</span>
    </button>
  );
}

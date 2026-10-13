/**
 * Метка СОБЫТИЯ НА БАЗЕ на полотне таймлайна.
 *
 * Владелец: «событие базы сделать на таймлайне как событие рейса, только другого
 * цвета». Поэтому метка — ТОТ ЖЕ маркер, что у события рейса (TimelineGrid,
 * case 'event': ромб 9×9 — `width: 9`, `height: 9`, `borderRadius: 2`,
 * `transform: rotate(45deg)`, `opacity: 0.95`, слой TL_Z.mark). Отличаются
 * только ЦВЕТ (розово-малиновый, BASE_EVENT_COLORS.dot — константа в стилях) и
 * действие: клик открывает окно периода «Учёт выезда» этой машины и подсвечивает
 * ИМЕННО это событие (focusEventId — тот же механизм, что у событий рейса).
 * Полный текст события и дата — в подсказке (title).
 *
 * Несколько событий одного дня идут слева направо по порядку внесения (seq);
 * не поместившиеся раскладка (layoutEventDots) переносит на строку НИЖЕ под
 * полосой — метки не накладываются ни друг на друга, ни на подписи полос.
 */
import { EVENT_CHIP_DOT, eventMarkLabel, eventMarkText, type EventChip } from './lib/repairEvents';
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

export default function BaseEventMark({ chip, periodKey, archived, top, onOpen }: Props) {
  const first = chip.items[0];
  /** Подсказка: полный текст и дата каждого события метки, затем действие. */
  const title = [
    ...chip.items.map((e) => `${eventMarkLabel(e)}${e.text ? '' : ' — текст не заполнен'}`),
    ...(chip.extra > 0 ? [`и ещё ${chip.extra}`] : []),
    'Клик — открыть период учёта выезда и подсветить это событие',
  ].join('\n');
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
      className="absolute cursor-pointer select-none"
      style={{
        zIndex: TL_Z.mark,
        left: chip.x,
        top,
        width: EVENT_CHIP_DOT,
        height: EVENT_CHIP_DOT,
        background: BASE_EVENT_COLORS.dot,
        borderRadius: 2,
        transform: 'rotate(45deg)',
        opacity: archived ? 0.72 : 0.95,
        padding: 0,
        border: 'none',
        // Слой меток объявлен pointer-events:none (чтобы не мешать полотну) —
        // сама метка обязана принимать мышь: клик открывает окно периода.
        pointerEvents: 'auto',
      }}
    />
  );
}

/**
 * Карточка событий машины на таймлайне — заметки диспетчеров прямо у точки,
 * без открытия окна рейса.
 *
 * Показ: при наведении на точку события (или на номер машины / на свободное
 * место строки) карточка появляется рядом; клик по точке ЗАКРЕПЛЯЕТ её — тогда
 * текст можно выделить и скопировать, карточка закрывается крестиком, Escape
 * или кликом мимо. Окно рейса открывается кнопкой «Открыть рейс» в карточке.
 *
 * Карточка рисуется порталом в body (position: fixed): её не режет прокрутка
 * сетки и она не зависит от слоёв строки. Данные не читает и не пишет.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import type { EventMark } from './lib/eventMarks';

/** Выше полноэкранного таймлайна (4000), ниже модальных окон (5000+). */
const CARD_Z = 4200;
const MARGIN = 8;
const GAP = 6;

export interface EventCardAnchor {
  left: number;
  top: number;
  bottom: number;
}

interface Props {
  heading: string;
  events: EventMark[];
  anchor: EventCardAnchor;
  pinned: boolean;
  onClose: () => void;
  onOpenEvent: (tripKey: string, eventId: string) => void;
  /** Курсор над карточкой: она не закрывается, пока на ней курсор. */
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const fmtDay = (n: number): string =>
  new Date(n * 86400000).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' }).replace('.', '');

export default function EventCard({ heading, events, anchor, pinned, onClose, onOpenEvent, onPointerEnter, onPointerLeave }: Props) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: anchor.left, top: anchor.bottom + GAP });

  // Положение: под точкой, при нехватке места — над ней; не выходит за экран.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    let left = anchor.left;
    if (left + width > window.innerWidth - MARGIN) left = Math.max(MARGIN, window.innerWidth - width - MARGIN);
    let top = anchor.bottom + GAP;
    if (top + height > window.innerHeight - MARGIN) top = Math.max(MARGIN, anchor.top - height - GAP);
    setPos({ left, top });
  }, [anchor.left, anchor.top, anchor.bottom, events.length]);

  // Закрепённая карточка закрывается Escape и кликом мимо; «лёгкая» — прокруткой.
  useEffect(() => {
    if (pinned) {
      const onDown = (e: MouseEvent) => {
        if (!ref.current?.contains(e.target as Node)) onClose();
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      };
      document.addEventListener('mousedown', onDown);
      window.addEventListener('keydown', onKey, true);
      return () => {
        document.removeEventListener('mousedown', onDown);
        window.removeEventListener('keydown', onKey, true);
      };
    }
    const onScroll = () => onClose();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [pinned, onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={heading}
      data-ui="event-card"
      data-pinned={pinned ? '1' : undefined}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      className="fixed w-[340px] max-w-[calc(100vw-16px)] rounded-xl border border-[#E5E7EB] bg-white shadow-[0_16px_40px_rgba(18,19,22,0.16)] flex flex-col"
      style={{ left: pos.left, top: pos.top, zIndex: CARD_Z }}
    >
      <div className="flex items-center justify-between gap-2 px-3 pt-2.5 pb-1.5 border-b border-[#F1F2F4]">
        <span className="text-[11px] font-semibold text-[#121316] truncate">{heading}</span>
        {pinned ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="inline-flex items-center justify-center w-5 h-5 rounded-md text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] cursor-pointer"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        ) : (
          <span className="text-[10px] text-[#9CA3AF] whitespace-nowrap">клик по точке — закрепить</span>
        )}
      </div>
      <ul className="max-h-[min(60vh,420px)] overflow-y-auto px-3 py-2.5 flex flex-col gap-3">
        {events.map((ev) => (
          <li key={ev.eventId} data-event-id={ev.eventId} className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5 text-[10px] text-[#6B7280]">
              <span className="w-2 h-2 rounded-[2px] rotate-45 shrink-0" style={{ background: ev.color }} aria-hidden="true" />
              <span className="font-semibold text-[#374151]">
                {fmtDay(ev.day)}
                {ev.dayTo != null ? ` – ${fmtDay(ev.dayTo)}` : ''}
              </span>
              <span>· {ev.typeName}</span>
            </div>
            <p className="text-[12px] leading-[1.45] text-[#121316] whitespace-pre-wrap break-words select-text">
              {ev.note || 'Без текста'}
            </p>
            {ev.tripKey ? (
              <button
                type="button"
                onClick={() => onOpenEvent(ev.tripKey as string, ev.eventId)}
                className="self-start text-[11px] font-medium text-[var(--accent-ink)] hover:underline cursor-pointer"
              >
                Открыть рейс →
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>,
    document.body,
  );
}

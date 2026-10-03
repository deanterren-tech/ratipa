import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

/**
 * Компактный календарь в топ-баре: просмотр и выбор даты.
 *
 * Даты листаются вертикально: месяцы идут непрерывной лентой внутри окна,
 * поэтому колёсиком или свайпом можно просматривать предыдущие и следующие
 * месяцы подряд. Стрелки ‹ › остаются и плавно прокручивают ленту к соседнему
 * месяцу — прокрутка их дополняет, а не заменяет.
 *
 * Постоянные правила: неделя начинается с понедельника, слева номера недель по
 * ISO 8601, выбранный день выделен акцентом, сегодняшний отмечен отдельно.
 *
 * Прокрутка удерживается внутри окна (`overscroll-behavior: contain`), поэтому
 * страница под открытым календарём не прокручивается.
 */

const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/** Короткие названия месяцев для надписи в топ-баре: «1 окт.» */
const MONTHS_SHORT = ['янв.', 'февр.', 'мар.', 'апр.', 'мая', 'июн.', 'июл.', 'авг.', 'сент.', 'окт.', 'нояб.', 'дек.'];

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

/** Сколько месяцев добавляется к ленте за один подступ. */
const SPAN = 4;
/** Порог близости к краю ленты, при котором подставляется очередная порция. */
const EDGE = 180;
/** Предел длины ленты, чтобы DOM не разрастался при долгой прокрутке. */
const MAX_MONTHS = 60;

type MonthKey = { year: number; month: number };

const key = (m: MonthKey) => `${m.year}.${m.month}`;
const shift = (m: MonthKey, delta: number): MonthKey => {
  const d = new Date(m.year, m.month + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() };
};
const order = (m: MonthKey) => m.year * 12 + m.month;

/** Ключ дня для сравнения дат без времени. */
const dayKey = (date: Date) => `${date.getFullYear()}.${date.getMonth()}.${date.getDate()}`;

/** Формат даты портала: dd/mm/yyyy. */
const formatDate = (date: Date) =>
  [String(date.getDate()).padStart(2, '0'), String(date.getMonth() + 1).padStart(2, '0'), date.getFullYear()].join('/');

/** Номер недели по ISO 8601 (понедельник — первый день, неделя с четвергом — первая). */
export function isoWeekNumber(date: Date): number {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayNumber = (target.getDay() + 6) % 7; // Пн = 0 … Вс = 6
  target.setDate(target.getDate() - dayNumber + 3); // четверг этой недели
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  const firstDayNumber = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDayNumber + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}

/** Недели месяца: ведущие и замыкающие дни соседних месяцев, ширина кратна семи. */
function monthWeeks(view: MonthKey) {
  const firstOfMonth = new Date(view.year, view.month, 1);
  const offset = (firstOfMonth.getDay() + 6) % 7; // Пн = 0
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: Array<{ date: Date; inMonth: boolean }> = [];

  for (let i = offset - 1; i >= 0; i -= 1) {
    cells.push({ date: new Date(view.year, view.month, -i), inMonth: false });
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ date: new Date(view.year, view.month, day), inMonth: true });
  }
  while (cells.length % 7 !== 0) {
    const next = cells.length - offset - daysInMonth + 1;
    cells.push({ date: new Date(view.year, view.month + 1, next), inMonth: false });
  }

  const rows: Array<Array<{ date: Date; inMonth: boolean }>> = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
  return rows;
}

interface TopBarCalendarProps {
  /** Текущая дата (по умолчанию — системная). */
  today?: Date;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export default function TopBarCalendar({ today }: TopBarCalendarProps) {
  /**
   * Сегодняшняя дата по локальному времени пользователя.
   * Обновляется сама: таймер до ближайшей локальной полуночи (+ запас на
   * перевод часов), страховка по возвращении на вкладку. Надпись в топ-баре
   * всегда показывает сегодня и не зависит от того, что выбрано в календаре.
   */
  const [liveToday, setLiveToday] = useState<Date>(() => startOfDay(new Date()));

  useEffect(() => {
    if (today) return undefined; // в проверках дата задаётся снаружи
    let timer = 0;
    const schedule = () => {
      const now = new Date();
      const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
      // не дольше часа за раз: так дата не «застрянет» из-за сна машины или смены часового пояса
      const delay = Math.min(Math.max(nextMidnight - now.getTime() + 1000, 1000), 60 * 60 * 1000);
      timer = window.setTimeout(() => {
        setLiveToday((prev) => {
          const next = startOfDay(new Date());
          return prev.getTime() === next.getTime() ? prev : next;
        });
        schedule();
      }, delay);
    };
    schedule();
    const onWake = () => {
      if (document.hidden) return;
      setLiveToday((prev) => {
        const next = startOfDay(new Date());
        return prev.getTime() === next.getTime() ? prev : next;
      });
    };
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener('focus', onWake);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener('focus', onWake);
    };
  }, [today]);

  const todayDate = useMemo(() => startOfDay(today ? new Date(today) : liveToday), [today, liveToday]);

  /** Надпись кнопки: число и сокращённый месяц, например «1 окт.». */
  const todayLabel = `${todayDate.getDate()} ${MONTHS_SHORT[todayDate.getMonth()]}`;

  const [isOpen, setIsOpen] = useState(false);
  const [selected, setSelected] = useState<Date>(todayDate);
  /** Лента месяцев: вокруг выбранного, чтобы прокрутка работала в обе стороны. */
  const [months, setMonths] = useState<MonthKey[]>(() => {
    const base: MonthKey = { year: todayDate.getFullYear(), month: todayDate.getMonth() };
    const list: MonthKey[] = [];
    for (let i = -1; i <= SPAN; i += 1) list.push(shift(base, i));
    return list;
  });
  /** Месяц у верхнего края ленты — его показывает заголовок. */
  const [header, setHeader] = useState<MonthKey>({ year: todayDate.getFullYear(), month: todayDate.getMonth() });

  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  /** Высота ленты до подстановки месяцев выше — для восстановления позиции. */
  const pendingAnchor = useRef<number | null>(null);
  const scrollFrame = useRef<number | null>(null);
  /** Куда прокрутить после подстановки месяцев (для стрелок и «Сегодня»). */
  const pendingTarget = useRef<{ target: MonthKey; behavior: ScrollBehavior } | null>(null);

  // Закрытие по клику вне календаря и по Escape — как у остальных меню шапки
  useEffect(() => {
    if (!isOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setIsOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [isOpen]);

  /** Заголовок следует за прокруткой: берём месяц у верхнего края ленты. */
  const syncHeader = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    const blocks = Array.from(el.querySelectorAll<HTMLElement>('[data-month]'));
    if (blocks.length === 0) return;
    let current = blocks[0];
    for (const block of blocks) {
      if (block.offsetTop <= el.scrollTop + 12) current = block;
      else break;
    }
    const [year, month] = String(current.dataset.month || '').split('.').map(Number);
    if (!Number.isNaN(year) && !Number.isNaN(month)) {
      setHeader((prev) => (prev.year === year && prev.month === month ? prev : { year, month }));
    }
  }, []);

  /** Подставить месяцы выше ленты, сохранив позицию прокрутки (без скачка дат). */
  const prependMonths = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    pendingAnchor.current = el.scrollHeight;
    setMonths((prev) => {
      const first = prev[0];
      if (!first) return prev;
      const added: MonthKey[] = [];
      for (let i = SPAN; i >= 1; i -= 1) added.push(shift(first, -i));
      return [...added, ...prev];
    });
  }, []);

  /** Подставить месяцы ниже ленты; при перерастании обрезаем дальний край. */
  const appendMonths = useCallback(() => {
    setMonths((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      const added: MonthKey[] = [];
      for (let i = 1; i <= SPAN; i += 1) added.push(shift(last, i));
      const next = [...prev, ...added];
      if (next.length <= MAX_MONTHS) return next;
      const el = listRef.current;
      // Обрезаем тот край, который далеко от видимой части ленты
      return el && el.scrollTop > 800 ? next.slice(SPAN) : next.slice(0, next.length - SPAN);
    });
  }, []);

  const onScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    if (scrollFrame.current) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = null;
      syncHeader();
      if (el.scrollTop < EDGE) prependMonths();
      if (el.scrollHeight - (el.scrollTop + el.clientHeight) < EDGE) appendMonths();
    });
  }, [syncHeader, prependMonths, appendMonths]);

  // После подстановки месяцев восстанавливаем позицию и добираемся до цели (стрелки)
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    if (pendingAnchor.current !== null) {
      el.scrollTop += el.scrollHeight - pendingAnchor.current;
      pendingAnchor.current = null;
      syncHeader();
    }
    const pending = pendingTarget.current;
    if (pending) {
      const block = el.querySelector<HTMLElement>(`[data-month="${key(pending.target)}"]`);
      if (block) {
        el.scrollTo({ top: block.offsetTop, behavior: pending.behavior });
        pendingTarget.current = null;
      }
    }
  }, [months, syncHeader]);

  /** Перейти к месяцу: если его нет в ленте — сначала подставить нужную сторону. */
  const scrollToMonth = useCallback((target: MonthKey, behavior: ScrollBehavior = 'smooth') => {
    const el = listRef.current;
    if (!el) return;
    const block = el.querySelector<HTMLElement>(`[data-month="${key(target)}"]`);
    if (block) {
      el.scrollTo({ top: block.offsetTop, behavior });
      setHeader(target);
      return;
    }
    const first = months[0];
    const last = months[months.length - 1];
    pendingTarget.current = { target, behavior };
    if (first && order(target) < order(first)) prependMonths();
    else if (last && order(target) > order(last)) appendMonths();
    setHeader(target);
  }, [months, prependMonths, appendMonths]);

  // При открытии показываем месяц выбранной даты без анимации — дата не теряется
  useLayoutEffect(() => {
    if (!isOpen) return;
    const el = listRef.current;
    if (!el) return;
    const target = { year: selected.getFullYear(), month: selected.getMonth() };
    const block = el.querySelector<HTMLElement>(`[data-month="${key(target)}"]`);
    if (block) el.scrollTop = block.offsetTop;
    setHeader(target);
  }, [isOpen]);

  const shiftView = (delta: number) => scrollToMonth(shift(header, delta));

  const goToday = () => {
    setSelected(todayDate);
    scrollToMonth({ year: todayDate.getFullYear(), month: todayDate.getMonth() });
  };

  const isSameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

  return (
    <div className="relative font-sans" ref={rootRef}>
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={`Календарь, сегодня ${todayLabel} ${todayDate.getFullYear()}`}
        title={`Календарь — сегодня ${todayLabel}`}
        className={`relative h-8 shrink-0 px-2.5 rounded-lg border transition-colors cursor-pointer flex items-center justify-center whitespace-nowrap text-[11px] font-semibold tabular-nums select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] active:scale-[0.98] ${
          isOpen
            ? 'text-[var(--accent-ink)] bg-[var(--accent-10)] hover:bg-[var(--accent-15)] border-[var(--accent-25)]'
            : 'bg-white text-[#6B7280] border-[#E5E7EB] hover:bg-[#F3F4F6] hover:text-[#121316] hover:border-[#D1D5DB]'
        }`}
      >
        {/* Текущая дата: число и сокращённый месяц. Всегда «сегодня» —
            выбор в календаре на надпись не влияет. */}
        {todayLabel}
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Календарь"
          /* На узких экранах окно держится в границах экрана, на широких — под иконкой */
          className="fixed left-3 right-3 top-16 mx-auto md:absolute md:left-auto md:right-0 md:top-full md:mt-2 md:mx-0 w-auto md:w-[292px] max-w-[292px] bg-white border border-[#E5E7EB] rounded-xl shadow-[0_8px_24px_rgba(15,23,42,0.12)] z-[2000] p-3 select-none"
        >
          {/* Заголовок: месяц и год + переключение месяцев (прокручивает ленту) */}
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[11px] font-semibold tracking-tight text-[#121316]">
              {MONTHS[header.month]} {header.year}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => shiftView(-1)}
                aria-label="Предыдущий месяц"
                title="Предыдущий месяц"
                className="h-6 w-6 rounded-lg text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
              >
                <ChevronUp size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => shiftView(1)}
                aria-label="Следующий месяц"
                title="Следующий месяц"
                className="h-6 w-6 rounded-lg text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
              >
                <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Лента месяцев: вертикальная прокрутка колёсиком и свайпом.
              overscroll-behavior: contain — страница под календарём не прокручивается. */}
          <div
            ref={listRef}
            onScroll={onScroll}
            data-calendar-scroll="true"
            className="relative h-[236px] max-h-[calc(100vh-220px)] overflow-y-auto custom-scrollbar pr-1"
            /* overscroll-behavior и touch-action заданы явно: прокрутка ленты
               не «пробивается» на страницу, а жест по вертикали листает даты. */
            style={{
              overscrollBehaviorY: 'contain',
              overscrollBehaviorX: 'contain',
              touchAction: 'pan-y',
              WebkitOverflowScrolling: 'touch',
            } as React.CSSProperties}
          >
            {months.map((m) => (
              <div key={key(m)} data-month={key(m)} className="pb-2">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] mb-1 px-0.5">
                  {MONTHS[m.month]} {m.year}
                </div>
                <div className="grid grid-cols-[20px_repeat(7,1fr)] gap-y-0.5">
                  <span className="text-[8px] font-semibold uppercase tracking-wider text-[#D1D5DB] text-center self-center">н</span>
                  {WEEKDAYS.map((label, i) => (
                    <span
                      key={label}
                      className={`text-[9px] font-semibold uppercase tracking-wider text-center py-1 ${
                        i >= 5 ? 'text-[#D1D5DB]' : 'text-[#9CA3AF]'
                      }`}
                    >
                      {label}
                    </span>
                  ))}
                  {monthWeeks(m).map((row) => {
                    const monday = row[0].date;
                    return (
                      <React.Fragment key={dayKey(monday)}>
                        {/* Номер недели по ISO */}
                        <span
                          className="text-[9px] font-medium text-[#9CA3AF] tabular-nums text-center self-center"
                          title={`Неделя ${isoWeekNumber(monday)}`}
                        >
                          {isoWeekNumber(monday)}
                        </span>
                        {row.map(({ date, inMonth }) => {
                          const isSelected = isSameDay(date, selected);
                          const isToday = isSameDay(date, todayDate);
                          const isWeekend = (date.getDay() + 6) % 7 >= 5;
                          return (
                            <button
                              key={dayKey(date)}
                              type="button"
                              onClick={() => setSelected(date)}
                              aria-label={formatDate(date)}
                              aria-current={isToday ? 'date' : undefined}
                              className={`h-7 rounded-lg text-[11px] tabular-nums transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] ${
                                isSelected
                                  ? 'bg-[var(--accent-solid)] text-[var(--accent-on)] font-semibold'
                                  : isToday
                                    ? 'text-[var(--accent-ink)] font-semibold border border-[var(--accent-50)] hover:bg-[#F3F4F6]'
                                    : inMonth
                                      ? `${isWeekend ? 'text-[#9CA3AF]' : 'text-[#121316]'} hover:bg-[#F3F4F6]`
                                      : 'text-[#D1D5DB] hover:bg-[#F3F4F6]'
                              }`}
                            >
                              {date.getDate()}
                            </button>
                          );
                        })}
                      </React.Fragment>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {/* Итог: выбранная дата и быстрый возврат к сегодня */}
          <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-[#F3F4F6]">
            <span className="text-[10px] text-[#4B5563]">
              Выбрано: <span className="font-semibold text-[#121316] tabular-nums">{formatDate(selected)}</span>
            </span>
            <button
              type="button"
              onClick={goToday}
              className="text-[10px] font-medium text-[var(--accent-ink)] hover:underline cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] rounded"
            >
              Сегодня
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

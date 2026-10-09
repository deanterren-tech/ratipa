/**
 * Поле даты модуля «Таймлайн рейсов».
 *
 * Ручной ввод ДД/ММ/ГГГГ прямо в видимом поле (с маской и автоподстановкой
 * разделителей) + видимая кнопка календаря с собственным мини-календарём.
 *
 * Почему не нативный <input type="date">: прежний «сэндвич» (readOnly-текст +
 * невидимый нативный date) не давал пользователю ничего предсказуемого —
 * ручной ввод в видимое поле был запрещён, а невидимое принимало клавиши
 * только при попадании клика точно в сегмент, календарь открывался лишь по
 * невидимой иконке у правого края (в Safari нативного календаря нет вовсе).
 *
 * Контракт значения не меняется: в базе — строка YYYY-MM-DD (или '' — дата не
 * указана); сравнения — по календарным дням без часовых поясов (UTC-номер дня,
 * см. lib/timeline), поэтому сдвига на сутки не бывает.
 *
 * Поведение:
 *  - валидная полная дата набирается → onChange('YYYY-MM-DD') сразу;
 *  - поле очищено → onChange('') (отсутствие значения), это сохраняется;
 *  - незавершённый/битый ввод не пишется и возвращается к сохранённому на blur;
 *  - выбор дня в календаре → onChange + закрытие календаря; карточка не закрывается;
 *  - Escape закрывает только календарь и не доходит до окна рейса.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { DAY_MS, dayNum, dayStr, todayNum } from './lib/timeline';

/** YYYY-MM-DD → ДД/ММ/ГГГГ (пустая строка для пустого/битого значения). */
const shownOf = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

/** Цифры (до 8) → маска ДД/ММ/ГГГГ с автоподстановкой разделителей. */
const maskDigits = (digits: string): string => {
  const d = digits.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

/** ДД/ММ/ГГГГ → YYYY-MM-DD или null (строгая проверка существования даты). */
const isoOfShown = (text: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const n = Math.round(Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)) / DAY_MS);
  if (!Number.isFinite(n)) return null;
  const iso = dayStr(n);
  return iso === `${yyyy}-${mm}-${dd}` ? iso : null;
};

const WEEK_LABELS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];
const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

interface CalCell {
  day: number;
  inMonth: boolean;
}

/** Ячейки календаря: 6 недель (пн…вс), включая дни соседних месяцев. */
const buildCells = (y: number, month1: number): CalCell[] => {
  const first = Math.round(Date.UTC(y, month1 - 1, 1) / DAY_MS);
  const last = Math.round(Date.UTC(y, month1, 0) / DAY_MS);
  const offset = (new Date(first * DAY_MS).getUTCDay() + 6) % 7; // пн = 0
  const cells: CalCell[] = [];
  for (let i = 0; i < 42; i += 1) {
    const day = first - offset + i;
    cells.push({ day, inMonth: day >= first && day <= last });
  }
  return cells;
};

const monthOfDay = (n: number): { y: number; m: number } => {
  const d = new Date(n * DAY_MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
};

const firstDayOfMonth = (n: number): number => {
  const { y, m } = monthOfDay(n);
  return Math.round(Date.UTC(y, m - 1, 1) / DAY_MS);
};

export function DateInput({
  value,
  onChange,
  disabled,
  ariaLabel,
  className = '',
  compact = true,
}: {
  /** YYYY-MM-DD или '' */
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
  compact?: boolean;
}) {
  const [text, setText] = useState<string>(() => shownOf(value));
  const [focused, setFocused] = useState(false);
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const adjustedRef = useRef(false);
  const [viewFirst, setViewFirst] = useState<number>(() => firstDayOfMonth(dayNum(value) ?? todayNum()));

  // Внешнее значение (сохранение, ответ базы) показываем в поле только когда
  // пользователь в нём не печатает — ввод никогда не перетирается.
  useEffect(() => {
    if (!focused) setText(shownOf(value));
  }, [value, focused]);

  useEffect(() => {
    if (disabled && open) setOpen(false);
  }, [disabled, open]);

  const commitText = useCallback(
    (next: string) => {
      if (!next.trim()) {
        onChange('');
        return;
      }
      const iso = isoOfShown(next);
      if (iso) onChange(iso);
    },
    [onChange],
  );

  const onTyped = (e: React.ChangeEvent<HTMLInputElement>) => {
    const next = maskDigits(e.target.value);
    setText(next);
    // Пишем в состояние только полную валидную дату или полную очистку;
    // незаконченный ввод остаётся в поле до blur.
    if (!next) onChange('');
    else if (next.length === 10) commitText(next);
  };

  const invalid = text.length === 10 && !isoOfShown(text);

  const inputCls = compact
    ? `w-full bg-white border rounded-lg pl-2 pr-7 py-1.5 text-[11px] text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] disabled:cursor-not-allowed disabled:opacity-60 ${
        invalid ? 'border-rose-300' : 'border-[#E5E7EB] focus:border-[var(--accent)]'
      }`
    : `w-full bg-white border rounded-xl pl-3 pr-9 py-2 text-xs text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] min-h-[44px] disabled:cursor-not-allowed disabled:opacity-60 ${
        invalid ? 'border-rose-300' : 'border-[#E5E7EB] focus:border-[var(--accent)]'
      }`;

  const openCal = () => {
    if (disabled) return;
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setViewFirst(firstDayOfMonth(dayNum(value) ?? todayNum()));
    // Калибр высоты поповера: при нехватке места снизу открываем вверх,
    // чтобы на мобильных календарь не выходил за экран.
    const POP_H = 262;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
    const below = rect.bottom + 4;
    const flipUp = vh > 0 && below + POP_H > vh - 8 && rect.top - POP_H - 4 > 8;
    setCoords({ top: flipUp ? rect.top - POP_H - 4 : below, left: rect.left, width: rect.width });
    adjustedRef.current = false;
    setOpen(true);
  };

  // Уточнение по факту отрисовки: реальная высота календаря зависит от масштаба
  // экрана (мобильные кнопки выше) — если низ выходит за экран, поднимаем попап,
  // не давая ему обрезаться.
  useLayoutEffect(() => {
    if (!open || !popRef.current || adjustedRef.current) return;
    const pop = popRef.current.getBoundingClientRect();
    const vh = window.innerHeight;
    if (pop.bottom > vh - 4 || pop.top < 4) {
      setCoords((c) => (c ? { ...c, top: Math.max(4, Math.min(c.top, vh - 4 - pop.height)) } : c));
      adjustedRef.current = true;
    }
  }, [open, coords?.top]);

  // Клик мимо календаря и Escape закрывают ТОЛЬКО календарь.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setOpen(false);
    };
    // capture на window: срабатывает раньше Escape-обработчика окна рейса
    // (тот слушает document capture) — карточка при закрытии календаря не закрывается.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && popRef.current) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const pick = (day: number) => {
    onChange(dayStr(day));
    setText(shownOf(dayStr(day)));
    setOpen(false);
  };

  const cells = useMemo(() => {
    const { y, m } = monthOfDay(viewFirst);
    return buildCells(y, m);
  }, [viewFirst]);

  const selDay = dayNum(value);
  const today = todayNum();
  const { y: vy, m: vm } = monthOfDay(viewFirst);

  const shiftMonth = (delta: number) => {
    const mNext = vm + delta;
    const y = vy + Math.floor((mNext - 1) / 12);
    const m = ((mNext - 1) % 12 + 12) % 12 + 1;
    setViewFirst(Math.round(Date.UTC(y, m - 1, 1) / DAY_MS));
  };

  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <div className={`relative ${className}`} ref={wrapRef}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        maxLength={10}
        value={text}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder="ДД/ММ/ГГГГ"
        onChange={onTyped}
        onFocus={() => {
          setFocused(true);
          setOpen(false);
        }}
        onBlur={() => {
          setFocused(false);
          const iso = isoOfShown(text);
          if (!text.trim() || iso) commitText(text);
          else setText(shownOf(value)); // незавершённый ввод не сохраняем и не «залипаем»
        }}
        className={inputCls}
      />
      <button
        type="button"
        tabIndex={-1}
        disabled={disabled}
        aria-label={ariaLabel ? `${ariaLabel} — открыть календарь` : 'Открыть календарь'}
        title="Открыть календарь"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => (open ? setOpen(false) : openCal())}
        className={`absolute right-0.5 top-1/2 -translate-y-1/2 inline-flex items-center justify-center rounded-md text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${
          compact ? 'p-1' : 'p-1.5'
        }`}
      >
        <CalendarDays className={iconSize} aria-hidden="true" />
      </button>
      {open && coords ? (
        <div
          ref={popRef}
          role="dialog"
          aria-label="Календарь"
          className="fixed z-[99999] bg-white border border-[#E5E7EB] rounded-xl shadow-lg p-2 select-none"
          style={{
            top: coords.top,
            left: Math.max(8, Math.min(coords.left, (typeof window !== 'undefined' ? window.innerWidth : 0) - 248 - 8)),
            width: 240,
          }}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between gap-1 pb-1.5">
            <button
              type="button"
              aria-label="Предыдущий месяц"
              onClick={() => shiftMonth(-1)}
              className="inline-flex items-center justify-center p-1 rounded-md text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
            >
              <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
            <span className="text-[11px] font-semibold text-[#121316]">
              {MONTHS[vm - 1]} {vy}
            </span>
            <button
              type="button"
              aria-label="Следующий месяц"
              onClick={() => shiftMonth(1)}
              className="inline-flex items-center justify-center p-1 rounded-md text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
            >
              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {WEEK_LABELS.map((w) => (
              <span key={w} className="text-center text-[10px] text-[#9CA3AF] py-0.5">
                {w}
              </span>
            ))}
            {cells.map((c) => {
              const isSel = selDay != null && c.day === selDay;
              const isToday = c.day === today;
              return (
                <button
                  key={c.day}
                  type="button"
                  data-cal-day={c.day}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(c.day)}
                  className={`h-6 rounded-md text-[11px] leading-none transition-colors cursor-pointer ${
                    isSel
                      ? 'bg-[var(--accent)] text-white font-semibold'
                      : c.inMonth
                        ? `text-[#121316] hover:bg-[#F3F4F6] ${isToday ? 'font-semibold text-[var(--accent-ink)]' : ''}`
                        : 'text-[#C7CBD1] hover:bg-[#F9FAFB]'
                  }`}
                >
                  {new Date(c.day * DAY_MS).getUTCDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default DateInput;

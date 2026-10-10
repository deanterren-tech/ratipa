/**
 * ПЕРЕКРЁСТНАЯ ПОДСВЕТКА КЛЕТКИ ДНЯ — один лёгкий механизм для основного
 * полотна и встроенных мини-таймлайнов (окно рейса, машины, «Учёт выезда»).
 *
 * Что показывает:
 *   • оверлей-СТОЛБЕЦ дня по всей высоте полотна (под полосами/этапами —
 *     слой TL_Z.crosshair, pointer-events: none);
 *   • полосу СТРОКИ машины (пересечение строка×столбец — чуть сильнее);
 *   • плавающую метку даты у курсора («чт, 9 окт.»), не заслоняя курсор,
 *     со смещением у краёв экрана;
 *   • выделение дня в липкой шапке (мягкая заливка + «пилюля» числа —
 *     другим цветом, чем красная «Сегодня»; сам «сегодня» сохраняет вид).
 *
 * ПРОИЗВОДИТЕЛЬНОСТЬ: оверлеи создаются ОДИН раз (вне React), позиция
 * считается МАТЕМАТИКОЙ по X (масштаб, прокрутка, закреплённая колонка) в
 * requestAnimationFrame на mousemove/scroll/resize; React-состояние и клетки
 * не перерисовываются. Обновление только когда меняется день/строка.
 *
 * Тач: подсветка на время касания; клавиатура: тот же эффект по фокусу
 * (focusin внутри области).
 */
import { useEffect, useRef, type RefObject } from 'react';
import { dayAtContentX, MONTHS_RU, WEEKDAYS_RU } from './timeline';

export interface CrosshairOpts {
  /** Контейнер прокрутки полотна (основной или мини). */
  scrollRef: RefObject<HTMLElement | null>;
  /** Host-контейнер оверлеев (absolute inset-0 внутри сетки). */
  hostRef: RefObject<HTMLElement | null>;
  /** Подсветка включена (настройка пользователя). */
  enabled: boolean;
  /** Окно и масштаб (как у сетки/полос): начало, число дней, ширина дня, колонка машин. */
  vs: number;
  vn: number;
  colW: number;
  carColW: number;
}

/** «чт, 9 окт.» — метка даты у курсора. */
export const dayCursorLabel = (day: number): string => {
  const d = new Date(day * 86400000);
  return `${WEEKDAYS_RU[d.getUTCDay()].toLowerCase()}, ${d.getUTCDate()} ${MONTHS_RU[d.getUTCMonth()]}.`;
};

export function useCrosshair(opts: CrosshairOpts): void {
  // Актуальные числовые параметры — читаются в rAF, слушатели не пересоздаются.
  const stateRef = useRef(opts);
  stateRef.current = opts;
  const scheduleRef = useRef<() => void>(() => {});

  useEffect(() => {
    const scrollEl = opts.scrollRef.current;
    const host = opts.hostRef.current;
    if (!scrollEl || !host) return;

    // ── Оверлеи создаются один раз и живут вне React (не перерисовываются) ──
    const col = document.createElement('div');
    col.className = 'tl-cross-col';
    col.style.display = 'none';
    col.setAttribute('aria-hidden', 'true');
    const band = document.createElement('div');
    band.className = 'tl-cross-band';
    band.style.display = 'none';
    col.appendChild(band);
    host.appendChild(col);
    const label = document.createElement('div');
    label.className = 'tl-cross-label';
    label.style.display = 'none';
    label.setAttribute('aria-hidden', 'true');
    document.body.appendChild(label);

    let raf = 0;
    let inside = false;
    let px = 0;
    let py = 0;
    let lastLane: Element | null = null;
    let lastDay: number | null = null;
    let headerCell: Element | null = null;

    const hide = () => {
      if (col.style.display !== 'none') col.style.display = 'none';
      if (label.style.display !== 'none') label.style.display = 'none';
      if (headerCell) {
        headerCell.removeAttribute('data-tl-cross');
        headerCell = null;
      }
      lastDay = null;
      lastLane = null;
      band.style.display = 'none';
    };

    const tick = () => {
      raf = 0;
      const s = stateRef.current;
      if (!s.enabled || !inside) {
        hide();
        return;
      }
      const rect = scrollEl.getBoundingClientRect();
      const xIn = px - rect.left;
      // Наведение на закреплённую колонку машин — столбец не подсвечиваем.
      if (xIn < s.carColW) {
        hide();
        return;
      }
      // День — МАТЕМАТИКОЙ по X: масштаб, прокрутка и закреплённая колонка.
      const day = dayAtContentX(scrollEl.scrollLeft + xIn, s.vs, s.colW, s.carColW);
      if (day < s.vs || day > s.vs + s.vn - 1) {
        hide();
        return;
      }
      // ── оверлей-столбец ──────────────────────────────────────────────────
      col.style.transform = `translateX(${Math.round(s.carColW + (day - s.vs) * s.colW)}px)`;
      col.style.width = `${Math.max(1, Math.round(s.colW))}px`;
      if (col.style.display !== 'block') col.style.display = 'block';

      // ── строка машины под курсором (пересечение — сильнее) ───────────────
      const el = document.elementFromPoint(Math.round(px), Math.round(py));
      const lane = el && typeof el.closest === 'function' ? el.closest('[data-lane]') : null;
      if (lane !== lastLane) {
        lastLane = lane;
        band.style.display = 'none';
        if (lane) {
          const carKey = lane.getAttribute('data-tl-car');
          const group: Element[] = carKey
            ? Array.from(scrollEl.querySelectorAll(`[data-lane][data-tl-car="${CSS.escape(carKey)}"]`))
            : Array.from((lane.parentElement || lane).querySelectorAll('[data-lane]'));
          const hostRect = host.getBoundingClientRect();
          let top = Infinity;
          let bottom = -Infinity;
          group.forEach((l) => {
            const r = l.getBoundingClientRect();
            if (r.width <= 0) return;
            top = Math.min(top, r.top);
            bottom = Math.max(bottom, r.bottom);
          });
          if (bottom > top) {
            band.style.top = `${Math.max(0, Math.round(top - hostRect.top))}px`;
            band.style.height = `${Math.round(bottom - top)}px`;
            band.style.display = 'block';
          }
        }
      }

      // ── плавающая метка даты у курсора (не заслоняет, отступает у краёв) ──
      const text = dayCursorLabel(day);
      if (label.textContent !== text) label.textContent = text;
      const lw = label.offsetWidth || 72;
      const lh = label.offsetHeight || 18;
      const ox = px + 14 + lw > window.innerWidth - 6 ? -lw - 14 : 14;
      const oy = py + 16 + lh > window.innerHeight - 6 ? -lh - 12 : 16;
      label.style.transform = `translate(${Math.round(px + ox)}px, ${Math.round(py + oy)}px)`;
      if (label.style.display !== 'block') label.style.display = 'block';

      // ── день в липкой шапке (атрибут-класс, без ре-рендера) ───────────────
      if (lastDay !== day) {
        lastDay = day;
        const cell = scrollEl.querySelector(`[data-day="${day}"]`);
        if (headerCell && headerCell !== cell) headerCell.removeAttribute('data-tl-cross');
        headerCell = cell;
        if (cell) cell.setAttribute('data-tl-cross', '1');
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    scheduleRef.current = schedule;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch' && e.buttons === 0) return; // тач: только на время касания
      px = e.clientX;
      py = e.clientY;
      inside = true;
      schedule();
    };
    const onDown = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      inside = true;
      schedule();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        inside = false;
        schedule();
      }
    };
    const onLeave = () => {
      inside = false;
      schedule();
    };
    const onScroll = () => schedule(); // обновление по позиции курсора (не «залипает»)
    const onResize = () => schedule();
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!t || typeof t.getBoundingClientRect !== 'function') return;
      const r = t.getBoundingClientRect();
      if (r.width <= 0 && r.height <= 0) return;
      px = r.left + r.width / 2;
      py = r.top + r.height / 2;
      inside = true;
      schedule();
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && scrollEl.contains(to)) return;
      inside = false;
      schedule();
    };

    scrollEl.addEventListener('pointermove', onMove);
    scrollEl.addEventListener('pointerdown', onDown);
    scrollEl.addEventListener('pointerup', onUp);
    scrollEl.addEventListener('pointercancel', onUp);
    scrollEl.addEventListener('pointerleave', onLeave);
    scrollEl.addEventListener('scroll', onScroll, { passive: true });
    scrollEl.addEventListener('focusin', onFocusIn);
    scrollEl.addEventListener('focusout', onFocusOut);
    window.addEventListener('resize', onResize);
    schedule();

    return () => {
      scrollEl.removeEventListener('pointermove', onMove);
      scrollEl.removeEventListener('pointerdown', onDown);
      scrollEl.removeEventListener('pointerup', onUp);
      scrollEl.removeEventListener('pointercancel', onUp);
      scrollEl.removeEventListener('pointerleave', onLeave);
      scrollEl.removeEventListener('scroll', onScroll);
      scrollEl.removeEventListener('focusin', onFocusIn);
      scrollEl.removeEventListener('focusout', onFocusOut);
      window.removeEventListener('resize', onResize);
      if (raf) cancelAnimationFrame(raf);
      scheduleRef.current = () => {};
      if (headerCell) headerCell.removeAttribute('data-tl-cross');
      col.remove();
      label.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Геометрия/флаг изменились (масштаб, окно, колонка, переключатель) — пересчёт.
  useEffect(() => {
    scheduleRef.current();
  }, [opts.enabled, opts.vs, opts.vn, opts.colW, opts.carColW]);
}

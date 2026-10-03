import { useEffect } from 'react';

/**
 * Блокировка фоновой прокрутки при открытом модальном окне.
 *
 * Особенность портала: прокручивается сам документ (html) — AppShell растягивается
 * по высоте контента, а часть модулей дополнительно имеет собственный внутренний
 * скролл-контейнер. Поэтому `body { overflow: hidden }` здесь недостаточно:
 * ниже блокируется и документ (html/body), и все реально прокручиваемые контейнеры.
 *
 * Что делает блокировка:
 *  1. находит контейнеры с `overflow-y: auto|scroll`, у которых есть переполнение;
 *  2. запоминает их инлайновые стили и позицию прокрутки, ставит `overflow: hidden`;
 *  3. компенсирует исчезающий скроллбар отступом — страница не дёргается по ширине;
 *  4. вешает перехват `wheel` и `touchmove`, чтобы прокрутка не «пробивалась»
 *     на страницу через область backdrop и не уезжала по инерции на iOS.
 *
 * Прокрутка внутри самого модального окна продолжает работать: контейнеры,
 * находящиеся внутри `[data-scroll-lock="modal"]` / `[role="dialog"][aria-modal="true"]`,
 * не блокируются, а события из них не перехватываются.
 *
 * Блокировка учитывает вложенные окна: применяется при первом запросе и снимается
 * только при последнем.
 */

/** Селектор модальных окон: явный маркер или корректные ARIA-атрибуты. */
export const MODAL_SELECTOR = '[data-scroll-lock="modal"], [role="dialog"][aria-modal="true"]';

interface SavedStyles {
  el: HTMLElement;
  overflow: string;
  overflowX: string;
  paddingRight: string;
  scrollTop: number;
  scrollLeft: number;
}

let refCount = 0;
let savedTargets: SavedStyles[] = [];
let savedTouchAction = '';
let listenersAttached = false;

/** Элемент находится внутри модального окна — его прокрутку не трогаем. */
const isInsideModal = (node: EventTarget | null): boolean => {
  const el = node as HTMLElement | null;
  if (!el || typeof (el as any).closest !== 'function') return false;
  try {
    return !!(el as HTMLElement).closest(MODAL_SELECTOR);
  } catch {
    return false;
  }
};

/**
 * Есть ли внутри окна реально прокручиваемый контейнер на пути от элемента
 * до самого окна. Нужно, чтобы область backdrop не «пробивала» прокрутку
 * на страницу: она часть модального элемента, но прокручивать ей нечего.
 */
function hasScrollableAncestor(el: HTMLElement, boundary: HTMLElement | null): boolean {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.hasAttribute && node.hasAttribute('data-scroll-lock-scrollable')) return true;
    const cs = window.getComputedStyle(node);
    const scrollable = cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'overlay';
    if (scrollable && node.scrollHeight > node.clientHeight + 1) return true;
    if (node === boundary) break;
    node = node.parentElement;
  }
  return false;
}

/**
 * Прокрутка за пределами прокручиваемой области модального окна запрещена.
 * Внутри окна разрешена только там, где действительно есть что прокручивать.
 */
function blockOutsideScroll(e: Event) {
  const el = e.target as HTMLElement | null;
  const modal = el && typeof (el as any).closest === 'function'
    ? (el.closest(MODAL_SELECTOR) as HTMLElement | null)
    : null;

  // Вне окна — блокируем всегда.
  if (!modal) {
    if (e.cancelable) e.preventDefault();
    return;
  }
  // Внутри окна: пропускаем только в реально прокручиваемую область,
  // иначе колесо/свайп по backdrop уходил бы на страницу позади.
  if (!hasScrollableAncestor(el as HTMLElement, modal) && e.cancelable) e.preventDefault();
}

/**
 * Все контейнеры, которые сейчас реально прокручиваются.
 * Внутренности модальных окон исключаются: их прокрутка разрешена.
 */
function collectScrollTargets(): HTMLElement[] {
  const out: HTMLElement[] = [];
  const root = document.documentElement;
  if (!root) return out;

  const visit = (el: Element) => {
    if (!(el instanceof HTMLElement)) return;
    if (el.closest(MODAL_SELECTOR)) return; // внутри окна — не блокируем
    const cs = window.getComputedStyle(el);
    const scrollable = cs.overflowY === 'auto' || cs.overflowY === 'scroll';
    if (scrollable && el.scrollHeight > el.clientHeight) out.push(el);
    Array.from(el.children).forEach(visit);
  };

  // html и body проверяем отдельно: у них overflow по умолчанию visible
  visit(root);
  if (document.body && !out.includes(document.body) && document.body.closest(MODAL_SELECTOR) === null) {
    const bs = window.getComputedStyle(document.body);
    if ((bs.overflowY === 'auto' || bs.overflowY === 'scroll') && document.body.scrollHeight > document.body.clientHeight) {
      out.push(document.body);
    }
  }
  return out;
}

/** Ширина вертикального скроллбара у конкретного элемента. */
const elementScrollbarWidth = (el: HTMLElement) => Math.max(0, el.offsetWidth - el.clientWidth - (parseInt(window.getComputedStyle(el).borderLeftWidth || '0', 10) || 0) - (parseInt(window.getComputedStyle(el).borderRightWidth || '0', 10) || 0));

function attachListeners() {
  if (listenersAttached) return;
  document.addEventListener('wheel', blockOutsideScroll, { passive: false, capture: true });
  document.addEventListener('touchmove', blockOutsideScroll, { passive: false, capture: true });
  listenersAttached = true;
}

function detachListeners() {
  if (!listenersAttached) return;
  document.removeEventListener('wheel', blockOutsideScroll, { capture: true } as any);
  document.removeEventListener('touchmove', blockOutsideScroll, { capture: true } as any);
  listenersAttached = false;
}

function applyLock() {
  if (savedTargets.length > 0) return;

  const targets = collectScrollTargets();
  // html/body тоже держим: на части экранов прокручивается документ
  const all: HTMLElement[] = [document.documentElement];
  if (document.body) all.push(document.body);
  targets.forEach((t) => { if (!all.includes(t)) all.push(t); });

  savedTargets = all.map((el) => {
    const cs = window.getComputedStyle(el);
    const hadScrollbar = el.scrollHeight > el.clientHeight && (cs.overflowY === 'auto' || cs.overflowY === 'scroll');
    const sbw = hadScrollbar ? elementScrollbarWidth(el) : 0;
    const saved: SavedStyles = {
      el,
      overflow: el.style.overflow,
      overflowX: el.style.overflowX,
      paddingRight: el.style.paddingRight,
      scrollTop: el.scrollTop,
      scrollLeft: el.scrollLeft,
    };
    el.style.overflow = 'hidden';
    // Компенсация исчезнувшего скроллбара — без сдвига содержимого по ширине
    if (sbw > 0) {
      const current = parseFloat(cs.paddingRight) || 0;
      el.style.paddingRight = `${current + sbw}px`;
    }
    return saved;
  });

  // Запрещаем инерционную прокрутку страницы на тач-устройствах
  savedTouchAction = document.documentElement.style.touchAction;
  document.documentElement.style.touchAction = 'none';

  attachListeners();
}

function releaseLock() {
  if (savedTargets.length === 0) return;

  savedTargets.forEach(({ el, overflow, overflowX, paddingRight, scrollTop, scrollLeft }) => {
    el.style.overflow = overflow;
    el.style.overflowX = overflowX;
    el.style.paddingRight = paddingRight;
    // Возвращаем позицию прокрутки — без скачка к началу
    if (scrollTop) el.scrollTop = scrollTop;
    if (scrollLeft) el.scrollLeft = scrollLeft;
  });
  savedTargets = [];

  document.documentElement.style.touchAction = savedTouchAction;
  savedTouchAction = '';

  detachListeners();
}

/** Запросить блокировку. Возвращает функцию снятия (для уборки в эффекте). */
export function acquireScrollLock(): () => void {
  refCount += 1;
  if (refCount === 1) applyLock();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    refCount = Math.max(0, refCount - 1);
    if (refCount === 0) releaseLock();
  };
}

/** Снять все блокировки безусловно — при размонтировании приложения. */
export function releaseAllScrollLocks() {
  refCount = 0;
  releaseLock();
}

/** Подключить блокировку к компоненту: `useScrollLock(isOpen)`. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    return acquireScrollLock();
  }, [active]);
}

export default useScrollLock;

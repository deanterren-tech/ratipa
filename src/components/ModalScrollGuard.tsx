import { useEffect } from 'react';
import { MODAL_SELECTOR, acquireScrollLock, releaseAllScrollLocks } from '../hooks/useScrollLock';

/**
 * Единая точка блокировки фоновой прокрутки для всего Ratipa Portal.
 *
 * Монтируется один раз на уровне приложения (см. App.tsx), поэтому правило
 * действует на любое модальное окно — существующее и будущее, — без правок
 * в самих окнах: достаточно, чтобы оверлей несла маркер
 * `data-scroll-lock="modal"` или корректные `role="dialog" aria-modal="true"`.
 *
 * Наблюдение за DOM вместо ручного управления из каждого окна выбрано специально:
 * окна открываются из десятков мест, часть — через порталы, и централизованный
 * наблюдатель исключает «забыли вызвать хук».
 */
export default function ModalScrollGuard() {
  useEffect(() => {
    let release: (() => void) | null = null;

    /** Открыто ли прямо сейчас хотя бы одно реально отрисованное окно. */
    const hasVisibleModal = () => {
      const nodes = Array.from(document.querySelectorAll<HTMLElement>(MODAL_SELECTOR));
      return nodes.some((el) => {
        // Отсекаем окна, оставшиеся в DOM, но скрытые (display:none / hidden)
        if (el.getClientRects().length === 0) return false;
        const cs = window.getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden';
      });
    };

    const sync = () => {
      const open = hasVisibleModal();
      if (open && !release) {
        release = acquireScrollLock();
      } else if (!open && release) {
        // Снимаем блокировку при любом способе закрытия: кнопка, Escape,
        // клик по backdrop, успешное действие. Если сохранение упало и окно
        // осталось открытым, оверлей на месте — блокировка сохраняется.
        release();
        release = null;
      }
    };

    const observer = new MutationObserver(sync);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-scroll-lock', 'aria-modal', 'role', 'style', 'class', 'hidden'],
    });

    sync(); // окно могло быть открыто до подписки

    return () => {
      observer.disconnect();
      if (release) { release(); release = null; }
      releaseAllScrollLocks();
    };
  }, []);

  return null;
}

import { useEffect } from 'react';

/**
 * Global Keyboard Navigation and Shortcut Handler for Ratipa CRM & ERP.
 * Integrates deep contextual understanding of forms, lists, tables, and modals.
 */
export function useKeyboardShortcuts() {
  useEffect(() => {
    // Helper to find the topmost active modal dialog in viewport
    const getActiveModal = (): HTMLElement | null => {
      const selectors = [
        'div[role="dialog"]',
        '[data-modal]',
        'div.fixed.inset-0',
        'div[class*="fixed"][class*="inset-0"]',
      ];
      const overlays = Array.from(document.querySelectorAll(selectors.join(','))) as HTMLElement[];
      const visibleOverlays = overlays.filter(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const zIndex = parseInt(style.zIndex || '0', 10);
        return rect.width > 0 && rect.height > 0 &&
               style.display !== 'none' && style.visibility !== 'hidden' &&
               (zIndex > 0 || style.position === 'fixed');
      });
      if (visibleOverlays.length === 0) return null;
      // topmost by z-index / DOM order
      visibleOverlays.sort((a, b) =>
        parseInt(getComputedStyle(b).zIndex || '0', 10) -
        parseInt(getComputedStyle(a).zIndex || '0', 10)
      );
      return visibleOverlays[0];
    };

    // Helper to find navigable list/table items in active viewport
    const getNavigableItems = (): HTMLElement[] => {
      const container = document.querySelector('main, .min-h-screen, #root') || document.body;
      const rows = Array.from(container.querySelectorAll(
        'tbody tr, ' +
        '[id^="vehicle-driver-card-"], ' +
        '[data-nav-item], ' +
        '.grid .group.cursor-pointer, ' +
        'ul.divide-y li, ' +
        '.space-y-2 div.group, ' +
        '.divide-y tr, ' +
        'div[role="option"], ' +
        'li[role="option"]'
      )) as HTMLElement[];
      return rows.filter(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
      });
    };

    // Modal Mutation Observer for automatic autofocus & focus restore
    let lastActiveElement: HTMLElement | null = null;
    const observedModals = new Set<HTMLElement>();

    const observer = new MutationObserver(() => {
      const modal = getActiveModal();
      if (modal) {
        if (!observedModals.has(modal)) {
          observedModals.add(modal);
          // Save currently focused element to return focus later
          if (document.activeElement && !modal.contains(document.activeElement)) {
            lastActiveElement = document.activeElement as HTMLElement;
          }
          // Autofocus the first available inputs or buttons inside the modal
          setTimeout(() => {
            const focusables = modal.querySelectorAll<HTMLElement>(
              'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]:not([disabled]), [tabindex]:not([tabindex="-1"])'
            );
            const firstInput = Array.from(focusables).find(el =>
              ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName)
            );
            if (firstInput) {
              firstInput.focus();
            } else if (focusables.length > 0) {
              focusables[0].focus();
            }
          }, 150);
        }
      } else {
        if (observedModals.size > 0) {
          observedModals.clear();
          if (lastActiveElement && document.body.contains(lastActiveElement)) {
            lastActiveElement.focus();
            lastActiveElement = null;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    // Centralised keydown event handler
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement as HTMLElement;
      const isInputActive = activeEl && (
        activeEl.tagName === 'INPUT' ||
        activeEl.tagName === 'TEXTAREA' ||
        activeEl.tagName === 'SELECT' ||
        activeEl.isContentEditable
      );

      // Verify typing context: allow only saving (Ctrl+S) and search (Ctrl+K) in text editors
      if (isInputActive) {
        const isCtrlS = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's';
        const isCtrlK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
        if (!isCtrlS && !isCtrlK) {
          return; // Skip global shortcut triggers when actively typing
        }
      }

      const key = e.key.toLowerCase();
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;

      // Ctrl/Cmd + S — Save form or record
      if (isCtrlOrCmd && key === 's') {
        e.preventDefault();
        const saveBtn = Array.from(document.querySelectorAll('button')).find(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          return (text.includes('сохранить') || text.includes('применить') || text.includes('создать') || text.includes('подтвердить') || text.includes('save') || text.includes('apply')) && !btn.disabled;
        });
        if (saveBtn) {
          saveBtn.click();
        } else {
          // Fallback: Submit form if standard HTML form is available
          const form = document.querySelector('form');
          if (form) form.requestSubmit();
        }
        return;
      }

      // Ctrl/Cmd + K — Open global search
      if (isCtrlOrCmd && key === 'k') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('ratipa-toggle-search'));
        return;
      }

      // Escape — Close topmost modal, menu, or clear active search input
      if (e.key === 'Escape') {
        const modal = getActiveModal();
        if (modal) {
          const cancelBtn = Array.from(modal.querySelectorAll('button')).find(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            return text.includes('отмена') || text.includes('закрыть') || text.includes('close') || text.includes('cancel');
          }) || modal.querySelector('button[title*="Закрыть"], button[aria-label*="close"], button.rounded-full');

          if (cancelBtn) {
            cancelBtn.click();
            e.preventDefault();
          }
        } else {
          // Check for open global search panel (CommandCenter) or local search fields
          window.dispatchEvent(new CustomEvent('ratipa-close-search'));

          const searchInput = document.querySelector('input[placeholder*="Поиск"], input[placeholder*="поиск"], input[placeholder*="Быстрый поиск"]') as HTMLInputElement;
          if (searchInput && searchInput.value) {
            searchInput.value = '';
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            e.preventDefault();
          }
        }
        return;
      }

      // Enter — Confirm primary action or open selected row card
      if (e.key === 'Enter') {
        if (activeEl && activeEl.tagName === 'TEXTAREA') {
          return; // Let textarea handle text wrapping normally
        }

        // If row-list items are hovered via ArrowKeys navigation, Enter opens it
        const items = getNavigableItems();
        const activeItem = items.find(el => el.classList.contains('is-active'));
        if (activeItem && !isInputActive) {
          const clickTarget = activeItem.querySelector('td, a, button, [onClick]') as HTMLElement || activeItem;
          clickTarget.click();
          e.preventDefault();
          return;
        }

        // Confirm topmost dialog confirmation buttons if prompt modal is open
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          return (text === 'ок' || text === 'да' || text.includes('подтвердить') || text.includes('сохранить') || text.includes('применить') || text.includes('ok') || text.includes('apply')) && !btn.disabled;
        });
        if (confirmBtn) {
          confirmBtn.click();
          e.preventDefault();
        }
        return;
      }

      // Limit Tab-navigation inside active modals (Focus trapping)
      if (e.key === 'Tab') {
        const modal = getActiveModal();
        if (modal) {
          const focusables = Array.from(modal.querySelectorAll<HTMLElement>(
            'input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]:not([disabled]), [tabindex]:not([tabindex="-1"])'
          ));
          if (focusables.length > 0) {
            const first = focusables[0];
            const last = focusables[focusables.length - 1];
            if (e.shiftKey) {
              if (document.activeElement === first) {
                last.focus();
                e.preventDefault();
              }
            } else {
              if (document.activeElement === last) {
                first.focus();
                e.preventDefault();
              }
            }
          }
        }
        return;
      }

      // Alt + N — Create new record
      if (e.altKey && key === 'n') {
        e.preventDefault();
        const addBtn = Array.from(document.querySelectorAll('button')).find(btn => {
          const text = btn.textContent?.toLowerCase() || '';
          return (text.includes('добавить') || text.includes('создать') || text.includes('новая запись') || text.includes('new') || text.includes('add')) && !btn.disabled;
        });
        if (addBtn) {
          addBtn.click();
        }
        return;
      }

      // Alt + E — Edit current selected record
      if (e.altKey && key === 'e') {
        e.preventDefault();
        const activeItem = getNavigableItems().find(el => el.classList.contains('is-active'));
        let editBtn: HTMLElement | null = null;
        if (activeItem) {
          editBtn = activeItem.querySelector('button[title*="редакт"], button[title*="edit"], .text-blue-600, svg[class*="pencil"]') as HTMLElement;
        }
        if (!editBtn) {
          editBtn = Array.from(document.querySelectorAll('button')).find(btn => {
            const text = btn.textContent?.toLowerCase() || '';
            return (text.includes('редактировать') || text.includes('edit')) && !btn.disabled;
          }) as HTMLElement;
        }
        if (editBtn) {
          editBtn.click();
        }
        return;
      }

      // ArrowUp / ArrowDown — Move selection through lists, tables, and search results
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const items = getNavigableItems();
        if (items.length === 0) return;

        e.preventDefault();
        const currentIdx = items.findIndex(el => el.classList.contains('is-active'));

        let nextIdx = 0;
        if (e.key === 'ArrowDown') {
          nextIdx = currentIdx === -1 ? 0 : Math.min(currentIdx + 1, items.length - 1);
        } else {
          nextIdx = currentIdx === -1 ? 0 : Math.max(currentIdx - 1, 0);
        }

        // Toggle selection highlight classes
        items.forEach(el => el.classList.remove('is-active'));
        items[nextIdx].classList.add('is-active');

        // Scroll selected row nicely into active scroll area
        items[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      observer.disconnect();
    };
  }, []);
}

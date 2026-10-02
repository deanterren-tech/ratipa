import { useEffect, useRef } from 'react';

/**
 * Клавиатурное управление модальными окнами модуля дозволов.
 *
 * Правила:
 *  - Escape закрывает окно (если закрытие разрешено) — перехватывается в capture-фазе,
 *    поэтому глобальный обработчик не ищет «кнопку отмены» по тексту и не нажмёт что-то лишнее.
 *  - Enter подтверждает основное действие, НО только когда фокус не находится в поле ввода —
 *    так Enter в примечании или в текстовом поле никогда не отправит форму случайно.
 *  - Ctrl/Cmd + Enter подтверждает из любого места, в том числе из многострочного поля.
 *  - Фокус ставится на первое поле при открытии и возвращается на элемент-источник при закрытии.
 *
 * Необратимые операции (удаление, аннулирование) остаются за подтверждающим диалогом:
 * сам вызов onConfirm — это и есть подтверждённое действие внутри уже открытого окна.
 */
interface UseModalKeyboardOptions {
  isOpen: boolean;
  onClose: () => void;
  /** Основное действие окна. Если не передан — Enter ничего не делает. */
  onConfirm?: () => void;
  /** Разрешить закрытие по Escape (например, false пока идёт сохранение). */
  canClose?: boolean;
  /** Разрешить подтверждение по Enter (например, false пока форма невалидна). */
  canConfirm?: boolean;
  /** Селектор первого элемента для фокуса при открытии. */
  initialFocusSelector?: string;
  /** Не ставить фокус на первое поле (для информационных окон). */
  skipInitialFocus?: boolean;
}

const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'email', 'password', 'number', 'tel', 'url', 'date', 'time',
]);

function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return true;
  if (tag === 'SELECT') return false;
  if (tag === 'INPUT') {
    const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
    return TEXT_INPUT_TYPES.has(type);
  }
  return (el as HTMLElement).isContentEditable === true;
}

export function useModalKeyboard({
  isOpen,
  onClose,
  onConfirm,
  canClose = true,
  canConfirm = true,
  initialFocusSelector,
  skipInitialFocus = false,
}: UseModalKeyboardOptions) {
  const openerRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef(onClose);
  const confirmRef = useRef(onConfirm);
  const canCloseRef = useRef(canClose);
  const canConfirmRef = useRef(canConfirm);

  // Держим свежие колбэки/флаги, не переподписываясь на каждое изменение
  closeRef.current = onClose;
  confirmRef.current = onConfirm;
  canCloseRef.current = canClose;
  canConfirmRef.current = canConfirm;

  // Фокус: запоминаем источник при открытии, ставим фокус в окно, возвращаем при закрытии
  useEffect(() => {
    if (!isOpen) return;

    const active = document.activeElement as HTMLElement | null;
    if (active && active !== document.body) openerRef.current = active;

    if (!skipInitialFocus) {
      const timer = window.setTimeout(() => {
        const modal = document.querySelector('[role="dialog"], .dozvola-modal');
        const target = initialFocusSelector
          ? (modal?.querySelector(initialFocusSelector) as HTMLElement | null)
          : null;
        const fallback = modal?.querySelector(
          'input:not([type="hidden"]), select, textarea',
        ) as HTMLElement | null;
        (target || fallback)?.focus();
      }, 60);
      return () => {
        window.clearTimeout(timer);
        const opener = openerRef.current;
        if (opener && document.body.contains(opener)) {
          opener.focus();
        }
        openerRef.current = null;
      };
    }

    return () => {
      const opener = openerRef.current;
      if (opener && document.body.contains(opener)) {
        opener.focus();
      }
      openerRef.current = null;
    };
  }, [isOpen, initialFocusSelector, skipInitialFocus]);

  // Клавиши — capture-фаза, чтобы глобальные горячие клавиши не мешали
  useEffect(() => {
    if (!isOpen) return;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!canCloseRef.current) return;
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
        return;
      }

      if (e.key !== 'Enter') return;

      const confirm = confirmRef.current;
      if (!confirm || !canConfirmRef.current) return;

      // Ctrl/Cmd + Enter — подтверждение из любого поля, включая многострочное
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        e.stopPropagation();
        confirm();
        return;
      }

      // Обычный Enter в поле ввода/многострочном поле — не отправляем форму случайно
      if (isTextEntry(document.activeElement)) return;

      e.preventDefault();
      e.stopPropagation();
      confirm();
    };

    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isOpen]);

  return { openerRef };
}

export default useModalKeyboard;

/**
 * Горячие клавиши окон модуля «Таймлайн рейсов» (карточка рейса, окно машины):
 * один общий хук для всех окон — без копирования обработчиков.
 *
 * Порядок слоёв при Escape (сверху вниз):
 *  1) открытый календарь/подсказка DateInput — его обработчик стоит на
 *     window-capture и гасит событие раньше (календарь закрывается, окно нет);
 *  2) брендированное подтверждение (DialogProvider, [data-ratipa-dialog]) —
 *     Esc обрабатывает оно («Остаться»), окно не закрывается;
 *  3) само окно — onEscape (обычно «закрыть с проверкой несохранённых»).
 *
 * Enter: в обычном поле ввода (input, не textarea/кнопка/служебные типы)
 * сохраняет через onSave; не срабатывает при открытом автодополнении и при
 * наборе через IME (isComposing). Ctrl/Cmd+S — сохранить без закрытия окна,
 * системное сохранение страницы блокируется.
 */
import { useEffect, useRef } from 'react';

export interface WindowHotkeyOptions {
  /** Escape: закрыть окно (снаружи решается, спрашивать ли о несохранённых). */
  onEscape: () => void;
  /** Ctrl/Cmd+S: сохранить без закрытия. Без него клавиши не перехватываются. */
  onSave?: () => void;
  /**
   * Enter в поле ввода: сохранить И закрыть окно (как основная кнопка). Если не
   * задан — Enter ведёт себя как onSave (сохранение без закрытия).
   */
  onSaveClose?: () => void;
}

const SERVICE_INPUT_TYPES = new Set(['button', 'submit', 'reset', 'checkbox', 'radio', 'range', 'color', 'file', 'date', 'time', 'datetime-local', 'month', 'week']);

export function useWindowHotkeys({ onEscape, onSave, onSaveClose }: WindowHotkeyOptions): void {
  const ref = useRef({ onEscape, onSave, onSaveClose });
  ref.current = { onEscape, onSave, onSaveClose };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialogOpen = !!document.querySelector('[data-ratipa-dialog="1"]');
      if (e.key === 'Escape') {
        if (dialogOpen) return; // верхний слой — окно подтверждения
        ref.current.onEscape();
        // Клавиша обработана этим окном: не даём тому же событию дойти до
        // обработчиков верхнего слоя (окно подтверждения могло открыться прямо
        // сейчас — повторный Esc не должен его мгновенно закрывать).
        e.stopPropagation();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S' || e.key === 'ы' || e.key === 'Ы')) {
        const save = ref.current.onSave || ref.current.onSaveClose;
        if (dialogOpen || !save) return;
        e.preventDefault(); // не даём браузеру открыть «Сохранить страницу»
        save();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const save = ref.current.onSaveClose || ref.current.onSave;
        if (dialogOpen || !save) return;
        const t = e.target as HTMLElement | null;
        if (!t || t.tagName !== 'INPUT') return; // многострочные: Enter — перенос; кнопки/ссылки/select — нативное действие
        const input = t as HTMLInputElement;
        if (SERVICE_INPUT_TYPES.has((input.getAttribute('type') || 'text').toLowerCase())) return;
        if (e.isComposing || (e as unknown as { keyCode?: number }).keyCode === 229) return; // IME
        if (document.querySelector('[data-ac-popup="1"]')) return; // открытое автодополнение: Enter выбирает значение
        e.preventDefault();
        save();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, []);
}

/**
 * Текстовое поле события с автоматическим ростом высоты (авто-grow).
 *
 * Требование владельца: поле ввода текста растёт по содержимому — по scrollHeight,
 * БЕЗ max-height, без внутренней прокрутки и обрезки; переносы строк сохраняются;
 * при удалении текста поле уменьшается. Один компонент на добавление и правку
 * (та же форма), высота пересчитывается и при открытии формы с уже введённым
 * текстом, и при каждом изменении значения.
 *
 * Реализация: height='auto' → height=scrollHeight на useLayoutEffect (до
 * отрисовки кадра — моргания нет); resize-none + overflow-hidden убирают
 * собственную прокрутку. ResizeObserver пересчитывает высоту при смене ширины
 * (поворот экрана, изменение колонок). Никаких записей в базу здесь нет.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { UI } from '../../../ui/kit';

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** data-ui селектор существующих приёмочных прогонов (vyezd-event-text). */
  dataUi?: string;
  ariaLabel?: string;
  placeholder?: string;
  /** Количество строк до первого замера (стартовая высота пустого поля). */
  rows?: number;
  autoFocus?: boolean;
}

export default function GrowingTextarea({
  value,
  onChange,
  dataUi,
  ariaLabel,
  placeholder,
  rows = 2,
  autoFocus = false,
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  /** Высота = содержимое: сброс в auto, затем scrollHeight (без ограничений). */
  const fit = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  useLayoutEffect(() => {
    fit();
  }, [value, fit]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      const onResize = () => fit();
      window.addEventListener('resize', onResize);
      return () => window.removeEventListener('resize', onResize);
    }
    const ro = new ResizeObserver(() => fit());
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  return (
    <textarea
      ref={ref}
      rows={rows}
      // eslint-disable-next-line jsx-a11y/no-autofocus
      autoFocus={autoFocus}
      data-ui={dataUi}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`${UI.textarea} !py-1.5 resize-none overflow-hidden break-words`}
    />
  );
}

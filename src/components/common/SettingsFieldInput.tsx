import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, AlertCircle } from 'lucide-react';

/**
 * Поле настройки, которое сохраняется само.
 *
 * Зачем: раньше URL-поля в «Администрировании» писались в базу ТОЛЬКО по onBlur.
 * Из-за этого значение терялось, если пользователь:
 *  - нажимал Enter (в разделе «Интеграции» обработчика Enter не было);
 *  - кликал по элементу, который не забирает фокус (на macOS кнопки не получают фокус);
 *  - обновлял страницу или уходил в другой раздел, не выходя из поля.
 * Теперь запись идёт по паузе в наборе, по Enter и по потере фокуса — плюс видно
 * состояние сохранения, чтобы не оставалось сомнений.
 */
interface Props {
  /** Текущее значение из настроек (то, что реально лежит в базе). */
  value: string;
  /** Привести введённое значение к каноничному виду перед записью. */
  normalize?: (raw: string) => string;
  /** Запись в базу. Должна вернуть промис, чтобы показать состояние. */
  onCommit: (next: string) => Promise<unknown> | unknown;
  type?: 'text' | 'url';
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  /** Пауза в наборе перед автосохранением, мс. */
  debounceMs?: number;
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function SettingsFieldInput({
  value,
  normalize,
  onCommit,
  type = 'url',
  placeholder,
  className = '',
  ariaLabel,
  debounceMs = 700,
}: Props) {
  const [text, setText] = useState(value);
  const [state, setState] = useState<SaveState>('idle');
  const focusedRef = useRef(false);
  const lastCommittedRef = useRef(value);
  const timerRef = useRef<number | null>(null);
  const flashRef = useRef<number | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (flashRef.current) window.clearTimeout(flashRef.current);
    };
  }, []);

  // Внешнее значение изменилось (например, его поменял другой сотрудник) —
  // подхватываем, но не затираем то, что человек сейчас набирает.
  useEffect(() => {
    if (focusedRef.current) return;
    if (value === lastCommittedRef.current) return;
    lastCommittedRef.current = value;
    setText(value);
  }, [value]);

  const commit = async (raw: string) => {
    const next = normalize ? normalize(raw) : raw.trim();
    if (next === lastCommittedRef.current) return;
    lastCommittedRef.current = next;
    if (next !== raw) setText(next);
    if (mountedRef.current) setState('saving');
    try {
      await onCommit(next);
      if (!mountedRef.current) return;
      setState('saved');
      if (flashRef.current) window.clearTimeout(flashRef.current);
      flashRef.current = window.setTimeout(() => {
        if (mountedRef.current) setState('idle');
      }, 1800);
    } catch {
      if (!mountedRef.current) return;
      setState('error');
    }
  };

  const scheduleCommit = (raw: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      void commit(raw);
    }, debounceMs);
  };

  return (
    <div className="relative">
      <input
        type={type}
        value={text}
        aria-label={ariaLabel}
        placeholder={placeholder}
        onChange={(e) => {
          const next = e.target.value;
          setText(next);
          scheduleCommit(next);
        }}
        onFocus={() => { focusedRef.current = true; }}
        onBlur={(e) => {
          focusedRef.current = false;
          if (timerRef.current) window.clearTimeout(timerRef.current);
          void commit(e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (timerRef.current) window.clearTimeout(timerRef.current);
            void commit((e.target as HTMLInputElement).value);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={`${className} ${state === 'error' ? '!border-rose-300 !ring-2 !ring-rose-100' : ''}`}
        style={{ paddingRight: '2.25rem' }}
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 flex items-center" aria-hidden="true">
        {state === 'saving' && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#9CA3AF]" />}
        {state === 'saved' && <Check className="h-3.5 w-3.5 text-emerald-600" />}
        {state === 'error' && <AlertCircle className="h-3.5 w-3.5 text-rose-600" />}
      </span>
    </div>
  );
}

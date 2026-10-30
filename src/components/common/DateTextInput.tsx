/**
 * Поле даты для форм водителей и машин: дату можно ВВЕСТИ ЦИФРАМИ
 * (ДД/ММ/ГГГГ, разделители ставятся сами; вставка «14.07.1991» тоже работает)
 * или выбрать в календаре по кнопке справа.
 *
 * Раньше поле было только для чтения и открывало системный календарь: ввод руками
 * был невозможен. В данных по-прежнему хранится ISO (ГГГГ-ММ-ДД) — старые значения
 * «ДД.ММ.ГГГГ» читаются как раньше (utils/dateText).
 *
 * Поведение:
 *  - полная корректная дата набрана → onChange('ГГГГ-ММ-ДД') сразу;
 *  - поле очищено → onChange('');
 *  - неполный/несуществующий ввод не записывается; при уходе из поля показывается
 *    сохранённое значение (подсветка ошибки — пока человек печатает).
 */
import { useEffect, useState } from 'react';
import { Calendar } from 'lucide-react';
import { UI } from '../../ui/kit';
import { displayDate, toISODate, dateInputValue } from '../../utils/dateText';
import { openDatePicker } from '../../utils/openDatePicker';

/** Цифры (до 8) → ДД/ММ/ГГГГ с автоподстановкой разделителей. */
export const maskDateDigits = (raw: string): string => {
  const d = raw.replace(/\D/g, '').slice(0, 8);
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)}/${d.slice(2)}`;
  return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
};

/** Полная ли строка ДД/ММ/ГГГГ и существует ли такая дата → ISO, иначе ''. */
export const isoFromTyped = (text: string): string => {
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(text)) return '';
  const iso = toISODate(text);
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const real = new Date(Date.UTC(y, m - 1, d));
  return real.getUTCFullYear() === y && real.getUTCMonth() === m - 1 && real.getUTCDate() === d ? iso : '';
};

export default function DateTextInput({
  id,
  value,
  onChange,
  label,
  textDataUi,
  pickerDataUi,
  buttonDataUi,
}: {
  /** Базовый id: поле — `${id}-text`, скрытый календарь — `picker-${id}`. */
  id: string;
  value: string;
  onChange: (iso: string) => void;
  /** Подпись для кнопки календаря и скринридера. */
  label: string;
  textDataUi?: string;
  pickerDataUi?: string;
  buttonDataUi?: string;
}) {
  const [text, setText] = useState<string>(() => displayDate(value));
  const [focused, setFocused] = useState(false);

  // Внешнее значение (календарь, загрузка записи) показываем, пока человек не печатает.
  useEffect(() => {
    if (!focused) setText(displayDate(value));
  }, [value, focused]);

  const typedDigits = text.replace(/\D/g, '');
  const invalid = focused && typedDigits.length === 8 && !isoFromTyped(text);

  const handleChange = (raw: string) => {
    const masked = maskDateDigits(raw);
    setText(masked);
    if (!masked) {
      onChange('');
      return;
    }
    const iso = isoFromTyped(masked);
    if (iso) onChange(iso);
  };

  return (
    <div className="relative">
      <input
        id={`${id}-text`}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        placeholder="ДД/ММ/ГГГГ"
        maxLength={10}
        aria-label={label}
        aria-invalid={invalid || undefined}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          setText(displayDate(value));
        }}
        onChange={(e) => handleChange(e.target.value)}
        data-ui={textDataUi}
        className={`${UI.input} pr-11 ${invalid ? 'border-rose-400 focus:border-rose-500' : ''}`}
      />
      <input
        type="date"
        id={`picker-${id}`}
        value={dateInputValue(value)}
        onChange={(e) => {
          const iso = toISODate(e.target.value);
          onChange(iso || e.target.value);
          setText(displayDate(iso));
        }}
        data-ui={pickerDataUi}
        className="absolute inset-0 opacity-0 pointer-events-none"
        aria-hidden="true"
        tabIndex={-1}
      />
      <button
        type="button"
        onClick={() => openDatePicker(`picker-${id}`)}
        title={`Открыть календарь: ${label}`}
        aria-label={`Открыть календарь: ${label}`}
        data-ui={buttonDataUi}
        className="absolute right-1 top-1/2 flex min-h-[36px] min-w-[36px] -translate-y-1/2 items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] cursor-pointer"
      >
        <Calendar className="w-4 h-4" aria-hidden="true" />
      </button>
      {invalid ? <span className="sr-only" role="alert">Такой даты нет</span> : null}
    </div>
  );
}

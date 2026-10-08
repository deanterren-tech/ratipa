/**
 * Поле даты в стиле портала: видимый ввод ДД/ММ/ГГГГ + невидимый нативный
 * календарь поверх него. В базе значение остаётся строкой YYYY-MM-DD.
 */
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
  const shown = value ? value.split('-').reverse().join('/') : '';
  return (
    <div className={`relative ${className}`}>
      <input
        type="text"
        readOnly
        tabIndex={-1}
        disabled={disabled}
        value={shown}
        placeholder="ДД/ММ/ГГГГ"
        aria-hidden="true"
        className={
          compact
            ? 'w-full bg-white border border-[#E5E7EB] rounded-lg px-2 py-1.5 text-[11px] text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60'
            : 'w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-xs text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 min-h-[44px]'
        }
      />
      <input
        type="date"
        value={value || ''}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
      />
    </div>
  );
}

export default DateInput;

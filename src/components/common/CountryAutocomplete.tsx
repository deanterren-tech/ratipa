import {useState, useRef, useEffect, useMemo} from 'react'
import {UI} from '../../ui/kit'
import {COUNTRY_CODES, COUNTRY_NAMES} from '../modules/directories/DistanceDirectoryBlock'

/**
 * Поле страны с автодополнением из фиксированного справочника стран.
 * Список стран фиксирован (COUNTRY_CODES + COUNTRY_NAMES), подписок на Firebase не требуется.
 * Поддерживает поиск по коду (BY, RUS) и названию (Беларусь, Россия).
 */
interface CountryAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface SuggestionEntry {
  code: string;
  name: string;
}

export default function CountryAutocomplete({
  value,
  onChange,
  onBlur,
  placeholder,
  disabled,
  className = '',
}: CountryAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [coords, setCoords] = useState<{top: number; left: number; width: number} | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [highlighted, setHighlighted] = useState(0);
  const justSelectedRef = useRef(false);

  // Строим список подсказок один раз (страны фиксированы)
  const entries = useMemo<SuggestionEntry[]>(() => {
    return COUNTRY_CODES.map(code => ({
      code,
      name: COUNTRY_NAMES[code] || code,
    }));
  }, []);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q || q.length < 1) return entries;
    return entries.filter(e =>
      e.code.toLowerCase().includes(q) ||
      e.name.toLowerCase().includes(q)
    ).slice(0, 15);
  }, [entries, query]);

  const updateCoords = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setCoords({top: rect.bottom + 4, left: rect.left, width: rect.width});
    }
  };

  const handleOpen = () => {
    updateCoords();
    setHighlighted(0);
    setOpen(true);
  };

  const handleSelect = (entry: SuggestionEntry) => {
    setQuery(entry.code);
    onChange(entry.code);
    setOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setOpen(true);
        setHighlighted(0);
      }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlighted(p => Math.min(p + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlighted(p => Math.max(p - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[highlighted]) handleSelect(filtered[highlighted]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const handleBlur = () => {
    // Небольшая задержка, чтобы клик по пункту списка успел сработать
    setTimeout(() => {
      setOpen(false);
      if (onBlur) onBlur();
    }, 150);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setQuery(e.target.value);
    onChange(e.target.value);
    if (!open) setOpen(true);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={handleChange}
        onFocus={handleOpen}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`${UI.input} ${className}`}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls="country-suggestions"
      />
      {open && filtered.length > 0 && coords && (
        <div
          id="country-suggestions"
          ref={listRef}
          style={{
            position: 'fixed',
            top: coords.top,
            left: coords.left,
            width: coords.width,
            zIndex: 110,
          }}
          className="bg-white border border-[#E5E7EB] rounded-xl shadow-[0_16px_40px_rgba(15,23,42,0.16)] max-h-[200px] overflow-y-auto custom-scrollbar"
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtered.map((entry, idx) => (
            <button
              key={entry.code}
              type="button"
              onClick={() => handleSelect(entry)}
              onMouseEnter={() => setHighlighted(idx)}
              className={`w-full text-left px-3 py-2 text-xs font-medium text-[#121316] transition-colors flex items-center gap-2 ${
                idx === highlighted ? 'bg-[#F3F4F6]' : 'hover:bg-[#F9FAFB]'
              }`}
            >
              <span className="font-mono text-[10px] text-[#9CA3AF] shrink-0 w-5">{entry.code}</span>
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
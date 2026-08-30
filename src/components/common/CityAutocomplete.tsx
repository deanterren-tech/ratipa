import {useState, useRef, useEffect} from 'react'

interface CityAutocompleteProps {
  value: string;
  onChange: (val: string) => void;
  onBlur?: () => void;
  cities: string[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export default function CityAutocomplete({
  value,
  onChange,
  onBlur,
  cities,
  placeholder,
  disabled,
  className = '',
}: CityAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [coords, setCoords] = useState<{top: number; left: number; width: number} | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const filtered = query
    ? cities.filter((c) => c.toLowerCase().includes(query.toLowerCase()))
    : cities;

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        listRef.current && !listRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const updateCoords = () => {
    if (inputRef.current) {
      const rect = inputRef.current.getBoundingClientRect();
      setCoords({
        top: rect.bottom + 4,
        left: rect.left,
        width: rect.width,
      });
    }
  };

  const handleOpen = () => {
    updateCoords();
    setOpen(true);
  };

  const handleSelect = (city: string) => {
    setQuery(city);
    onChange(city);
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          onChange(e.target.value);
          setOpen(true);
          setTimeout(updateCoords, 0);
        }}
        onFocus={handleOpen}
        onBlur={() => {
          setTimeout(() => {
            setOpen(false);
            if (onBlur) onBlur();
          }, 200);
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        autoComplete="off"
      />
      {open && filtered.length > 0 && coords && (
        <div
          ref={listRef}
          className="fixed z-[99999] bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto custom-scrollbar"
          style={{
            top: coords.top,
            left: coords.left,
            width: coords.width,
          }}
        >
          {filtered.map((city) => (
            <button
              key={city}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(city);
              }}
              className={`w-full text-left px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition cursor-pointer ${
                city === value ? 'bg-slate-50 text-slate-900' : ''
              }`}
            >
              {city}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
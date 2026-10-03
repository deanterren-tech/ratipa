import {useState} from 'react'
import {Calendar, X} from 'lucide-react'
import {UI} from '../../ui/kit'

/** Склонение: 1 день, 2 дня, 10 дней. */
function daysWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return 'дня';
  return 'дней';
}

/** Дата в виде ДД/ММ/ГГГГ — в портале даты пишутся через слеши. */
function ruDate(iso: string): string {
  return iso ? iso.split('-').reverse().join('/') : '';
}

export default function CalendarDaysCalculator({ onDaysCalculated }: { onDaysCalculated: (days: number) => void }) {
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const calculateDays = (start: string, end: string) => {
    if (!start || !end) return 0;
    const startObj = new Date(start);
    const endObj = new Date(end);
    const diffTime = Math.abs(endObj.getTime() - startObj.getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays + 1; // Include both start and end days
  };

  const handleDateChange = (start: string, end: string) => {
    const days = calculateDays(start, end);
    onDaysCalculated(days);
  };

  const totalDays = calculateDays(startDate, endDate);
  // Период выбран наполовину или конец раньше начала: подсказываем, но расчёт не меняем.
  const partial = Boolean((startDate && !endDate) || (!startDate && endDate));
  const inverted = Boolean(startDate && endDate && endDate < startDate);

  const openPicker = (id: string) => {
    (document.getElementById(id) as HTMLInputElement | null)?.showPicker?.();
  };

  const resetDates = () => {
    setStartDate('');
    setEndDate('');
    onDaysCalculated(0);
  };

  const fields = [
    { id: 'salary-days-start', label: 'Дата начала', value: startDate, set: (v: string) => { setStartDate(v); handleDateChange(v, endDate); } },
    { id: 'salary-days-end', label: 'Дата конца', value: endDate, set: (v: string) => { setEndDate(v); handleDateChange(startDate, v); } },
  ];

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2.5 pb-3 border-b border-[#E5E7EB]">
        <div className="p-2 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg shrink-0">
          <Calendar className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#121316]">Калькулятор дней</h3>
          <p className="text-xs text-[#6B7280]">Период рейса — даты начала и конца, формат ДД/ММ/ГГГГ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {fields.map((f) => (
          <div key={f.id} className="flex flex-col gap-1.5">
            <label className={UI.fieldLabel} htmlFor={f.id}>{f.label}</label>
            {/* Как во всём портале: видно и вводится текст ДД/ММ/ГГГГ,
                календарь открывает скрытое поле type=date. */}
            <div className="relative">
              <input
                id={f.id}
                type="text"
                inputMode="numeric"
                readOnly
                value={ruDate(f.value)}
                placeholder="ДД/ММ/ГГГГ"
                onClick={() => openPicker(`${f.id}-picker`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(`${f.id}-picker`); }
                }}
                className={`${UI.input} cursor-pointer pr-10`}
                aria-label={f.label}
              />
              <input
                type="date"
                id={`${f.id}-picker`}
                value={f.value}
                onChange={(e) => f.set(e.target.value)}
                className="absolute inset-0 h-0 w-0 opacity-0 pointer-events-none"
                tabIndex={-1}
                aria-hidden="true"
              />
              <button
                type="button"
                aria-label={`Открыть календарь: ${f.label}`}
                onClick={() => openPicker(`${f.id}-picker`)}
                className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {(partial || inverted) && (
        <p role="status" className="text-[11px] leading-relaxed text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
          {inverted
            ? 'Дата конца раньше даты начала — проверьте период. Расчёт учитывает разницу дат.'
            : 'Выберите вторую дату, чтобы посчитать количество дней в рейсе.'}
        </p>
      )}

      <div className="mt-auto pt-4 border-t border-[#E5E7EB] flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <span className={UI.caption}>Всего дней в рейсе</span>
          <span className="text-2xl font-mono font-semibold tabular-nums text-[#121316]">{totalDays}</span>
        </div>
        <div className="flex items-center justify-between gap-2 min-h-[32px]">
          <span className="text-[11px] text-[#6B7280]">
            {startDate && endDate
              ? `${ruDate(startDate)} — ${ruDate(endDate)} · ${totalDays} ${daysWord(totalDays)}`
              : 'Даты не выбраны'}
          </span>
          {(startDate || endDate) && (
            <button
              type="button"
              onClick={resetDates}
              aria-label="Очистить выбранные даты"
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3 h-3" aria-hidden="true" />
              Сбросить
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

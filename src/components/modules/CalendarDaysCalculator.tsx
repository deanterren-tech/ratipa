import {useState} from 'react'
import {Calendar} from 'lucide-react'
import {UI} from '../../ui/kit'

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

  return (
    <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-4 h-full">
      <div className="flex items-center gap-2.5 pb-3 border-b border-[#E5E7EB]">
        <div className="p-2 bg-[#F3F4F6] text-[#A55329] rounded-lg shrink-0">
          <Calendar className="w-4 h-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[#121316]">Калькулятор дней</h3>
          <p className="text-xs text-[#6B7280]">Период рейса — даты начала и конца, формат ДД/ММ/ГГГГ</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {([
          { id: 'salary-days-start', label: 'Дата начала', value: startDate, set: (v: string) => { setStartDate(v); handleDateChange(v, endDate); } },
          { id: 'salary-days-end', label: 'Дата конца', value: endDate, set: (v: string) => { setEndDate(v); handleDateChange(startDate, v); } },
        ] as const).map((f) => (
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
                value={f.value ? f.value.split('-').reverse().join('/') : ''}
                placeholder="ДД/ММ/ГГГГ"
                onClick={() => (document.getElementById(`${f.id}-picker`) as HTMLInputElement | null)?.showPicker?.()}
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
                onClick={() => (document.getElementById(`${f.id}-picker`) as HTMLInputElement | null)?.showPicker?.()}
                className="absolute right-1 top-1/2 -translate-y-1/2 min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] transition-colors cursor-pointer"
              >
                <Calendar className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-auto pt-4 border-t border-[#E5E7EB] flex items-center justify-between gap-3">
        <span className={UI.caption}>Всего дней в рейсе</span>
        <span className="text-2xl font-mono font-semibold tabular-nums text-[#121316]">{totalDays}</span>
      </div>
    </div>
  );
}

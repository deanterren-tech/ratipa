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
          <p className="text-xs text-[#6B7280]">Период рейса — даты начала и конца</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel} htmlFor="salary-days-start">Дата начала</label>
          <input
            id="salary-days-start"
            type="date"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); handleDateChange(e.target.value, endDate); }}
            className={`${UI.input} cursor-pointer`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={UI.fieldLabel} htmlFor="salary-days-end">Дата конца</label>
          <input
            id="salary-days-end"
            type="date"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); handleDateChange(startDate, e.target.value); }}
            className={`${UI.input} cursor-pointer`}
          />
        </div>
      </div>

      <div className="mt-auto pt-4 border-t border-[#E5E7EB] flex items-center justify-between gap-3">
        <span className={UI.caption}>Всего дней в рейсе</span>
        <span className="text-2xl font-mono font-semibold tabular-nums text-[#121316]">{totalDays}</span>
      </div>
    </div>
  );
}

import {useState} from 'react'
import {Calendar} from 'lucide-react'

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
 <div className="bg-white p-6 rounded-[2rem] border border-slate-200/50 h-full flex flex-col gap-4 shadow-xl shadow-slate-900/5">
      <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
        <Calendar className="w-4 h-4 text-[#3765F6]" />
        Калькулятор дней
      </h3>
      
      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Дата начала</label>
          <input 
            type="date" 
            value={startDate} 
            onChange={(e) => { setStartDate(e.target.value); handleDateChange(e.target.value, endDate); }} 
            className="w-full bg-white/45 border border-slate-200/50 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 focus:bg-white transition cursor-pointer shadow-inner" 
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Дата конца</label>
          <input 
            type="date" 
            value={endDate} 
            onChange={(e) => { setEndDate(e.target.value); handleDateChange(startDate, e.target.value); }} 
            className="w-full bg-white/45 border border-slate-200/50 text-slate-800 text-xs font-semibold px-3.5 py-2.5 rounded-xl outline-none focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 focus:bg-white transition cursor-pointer shadow-inner" 
          />
        </div>
      </div>
      
      <div className="mt-auto pt-4 border-t border-slate-200/50 flex items-center justify-between bg-slate-50/40 -mx-6 -mb-6 p-6 rounded-b-[2rem]">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Всего дней в рейсе:</span>
        <span className="text-2xl font-bold text-[#3765F6] font-mono tracking-tight bg-white px-3 py-1 rounded-xl border border-slate-200/30 shadow-3xs">{totalDays}</span>
      </div>
    </div>
  );
}

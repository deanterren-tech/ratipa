import React, { useState } from 'react';
import { Calendar } from 'lucide-react';

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

  return (
    <div className="bg-slate-50 p-6 rounded-[2rem] border border-slate-200/60 h-full flex flex-col gap-4">
      <h3 className="text-lg font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
        <Calendar className="w-5 h-5 text-[#70FC8E]" /> Калькулятор дней
      </h3>
      <div className="grid grid-cols-1 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Дата начала</label>
          <input 
            type="date" 
            value={startDate} 
            onChange={(e) => { setStartDate(e.target.value); handleDateChange(e.target.value, endDate); }} 
            className="w-full bg-white border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] transition" 
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Дата конца</label>
          <input 
            type="date" 
            value={endDate} 
            onChange={(e) => { setEndDate(e.target.value); handleDateChange(startDate, e.target.value); }} 
            className="w-full bg-white border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] transition" 
          />
        </div>
      </div>
      <div className="mt-auto pt-4 border-t border-slate-200">
        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Всего дней</div>
        <div className="text-3xl font-black text-slate-900 tracking-tight">{calculateDays(startDate, endDate)}</div>
      </div>
    </div>
  );
}

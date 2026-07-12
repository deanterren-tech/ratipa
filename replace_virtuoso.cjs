const fs = require('fs');
let code = fs.readFileSync('src/components/modules/BazaModule.tsx', 'utf8');

const virtuosoStart = code.indexOf('<TableVirtuoso');
let afterVirtuoso = code.indexOf('</TableVirtuoso>', virtuosoStart);
if (afterVirtuoso === -1) {
  // It might be self-closing. We find the matching closing tag or `/>`
  afterVirtuoso = code.indexOf('/>', virtuosoStart) + 2;
} else {
  afterVirtuoso += '</TableVirtuoso>'.length;
}

const replacement = `
<table className="w-full text-left min-w-[1450px] border-separate border-spacing-y-2">
  <thead>
    <tr>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Госномер</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Статус Рейса</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Водитель</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Прибыл на базу</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">К какому числу должна быть готова машина</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Дата подачи заявки на ремонт</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Дата окончания ремонта</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Фактический выезд</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3">Примечание</th>
      <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 pb-2 px-3"></th>
    </tr>
  </thead>
  <tbody>
    {filteredList.map((v, index) => (
      <tr key={v.id || index} className="group cursor-pointer">
        <td onClick={() => openCarModal(v)} className="bg-slate-50 rounded-l-2xl px-5 py-5 border-y border-l border-slate-200/50 group-hover:bg-slate-100/60 transition duration-150">
          <span className="font-extrabold text-slate-950 text-xs sm:text-sm bg-white px-2.5 py-1.5 rounded-xl border border-slate-300 group-hover:border-slate-400 group-hover:bg-[#70FC8E]/10 transition-all font-mono tracking-wider shadow-xs whitespace-nowrap inline-block select-all">{v.carNumber}</span>
        </td>
        <td onClick={(e) => e.stopPropagation()} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
          <select 
            value={v.currentStatus || "ON_BASE"}
            onChange={(e) => updateVehicleStatus(v.id, e.target.value as any)}
            className={\`px-3 py-1.5 rounded-lg border outline-none cursor-pointer font-black text-[10px] uppercase tracking-wider \${v.currentStatus === 'ON_TRIP' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-600 border-slate-300'}\`}
          >
            <option value="ON_BASE">На базе</option>
            <option value="ON_TRIP">В рейсе</option>
          </select>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-sm font-black text-slate-800 group-hover:bg-slate-100/60 transition">{v.driverName || '—'}</td>
        <td onClick={() => openCarModal(v)} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
          <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateArrival ? v.dateArrival.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
          <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateLoading ? v.dateLoading.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
          <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateRepairStart ? v.dateRepairStart.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
          <span className="bg-white/80 border border-slate-200/60 px-2.5 py-1.5 rounded-lg whitespace-nowrap">{v.dateRepairEnd ? v.dateRepairEnd.split('-').reverse().join('.') : '—'}</span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs font-bold text-slate-700 group-hover:bg-slate-100/60 transition">
          <span className={\`px-2.5 py-1.5 rounded-lg border whitespace-nowrap \${
            v.dateDeparture
                ? 'bg-emerald-50 border-emerald-300 text-emerald-800 font-extrabold' 
                : 'bg-white/80 border-slate-200/60'
          }\`}>
            {v.dateDeparture ? v.dateDeparture.split('-').reverse().join('.') : '—'}
          </span>
        </td>
        <td onClick={() => openCarModal(v)} className="bg-slate-50 px-5 py-5 border-y border-slate-200/50 text-xs text-slate-600 group-hover:bg-slate-100/60 transition max-w-[200px] truncate">{v.notes || '—'}</td>
        <td className="bg-slate-50 px-5 py-5 border-y border-r border-slate-200/50 rounded-r-2xl group-hover:bg-slate-100/60 transition">
          <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); openCarModal(v); }} className="p-2 text-slate-400 hover:text-blue-600 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-200 rounded-lg shadow-sm transition-all" title="Редактировать">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
            </button>
            <button onClick={(e) => { e.stopPropagation(); deleteVehicle(v.id, v.carNumber); }} className="p-2 text-slate-400 hover:text-rose-600 bg-white hover:bg-rose-50 border border-slate-200 hover:border-rose-200 rounded-lg shadow-sm transition-all" title="Удалить">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </td>
      </tr>
    ))}
  </tbody>
</table>
`;

if (virtuosoStart !== -1) {
  code = code.substring(0, virtuosoStart) + replacement + code.substring(afterVirtuoso);
}

fs.writeFileSync('src/components/modules/BazaModule.tsx', code);

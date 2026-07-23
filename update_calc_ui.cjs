const fs = require('fs');
let code = fs.readFileSync('src/components/modules/DohodModule.tsx', 'utf-8');

const target = `<div className="flex items-center justify-between border-t border-slate-200 pt-3 mt-1">
              <span className="text-sm font-black text-slate-800">
                Дней в рейсе:
              </span>
              <input
                type="number"
                min="1"
                value={tripDays}
                onChange={(e) => setTripDays(Number(e.target.value))}
                className="bg-transparent text-right w-16 text-lg font-black outline-none border-b border-transparent focus:border-slate-300"
              />
            </div>`;

const replacement = `<div className="flex items-center justify-between border-t border-slate-200 pt-3 mt-1">
              <span className="text-sm font-black text-slate-800">
                Дней в рейсе:
              </span>
              <input
                type="number"
                min="1"
                value={tripDays}
                onChange={(e) => setTripDays(Number(e.target.value))}
                className="bg-transparent text-right w-16 text-lg font-black outline-none border-b border-transparent focus:border-slate-300"
              />
            </div>
            <div className="flex items-center justify-between border-t border-slate-200 pt-3 mt-1">
              <span className="text-sm font-black text-slate-800">
                Доп. расходы (€):
              </span>
              <input
                type="number"
                min="0"
                value={additionalExpenses}
                onChange={(e) => setAdditionalExpenses(Number(e.target.value))}
                className="bg-transparent text-right w-20 text-lg font-black outline-none border-b border-transparent focus:border-slate-300"
              />
            </div>`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/DohodModule.tsx', code);
  console.log("UI added");
} else {
  console.log("UI target not found");
}

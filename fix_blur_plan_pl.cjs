const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

const target = `                              <input
                                type="number"
                                value={leg.emptyRunKm || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].emptyRunKm = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none"
                              />`;

const replacement = `                              <input
                                type="number"
                                value={leg.emptyRunKm || ""}
                                onChange={(e) => {
                                  const nl = [...plLegs];
                                  nl[i].emptyRunKm = Number(e.target.value);
                                  setPlLegs(nl);
                                }}
                                onBlur={() => checkLegDistance(i, true)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none"
                              />`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);
  console.log("EmptyRun blur prompt added to PlanDohod plLegs");
} else {
  console.log("Target not found");
}

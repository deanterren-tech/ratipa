const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

const target = `                              <input
                                type="number"
                                value={leg.emptyRunKm || ""}
                                onChange={(e) =>
                                  updateLeg(idx, {
                                    emptyRunKm: Number(e.target.value),
                                  })
                                }
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                              />`;

const replacement = `                              <input
                                type="number"
                                value={leg.emptyRunKm || ""}
                                onChange={(e) =>
                                  updateLeg(idx, {
                                    emptyRunKm: Number(e.target.value),
                                  })
                                }
                                onBlur={() => checkLegDistance(idx)}
                                className="w-full px-3 py-2.5 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-blue-500 outline-none"
                              />`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);
  console.log("EmptyRun blur prompt added to PlanDohod");
} else {
  console.log("Target not found");
}

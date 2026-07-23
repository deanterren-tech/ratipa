const fs = require('fs');
let code = fs.readFileSync('src/components/modules/DohodModule.tsx', 'utf-8');

const target = `<input
                        type="number"
                        value={leg.emptyRun || ""}
                        onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
                      />`;

const replacement = `<input
                        type="number"
                        value={leg.emptyRun || ""}
                        onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                        onBlur={() => {
                          const prevTo = idx === 0 ? "Минск" : legs[idx - 1]?.to;
                          if (prevTo && leg.from && leg.emptyRun && leg.emptyRun > 0) {
                            checkManualDistanceUpdate(prevTo, leg.from, leg.emptyRun);
                          }
                        }}
                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none"
                      />`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/DohodModule.tsx', code);
  console.log("EmptyRun blur prompt added");
} else {
  console.log("Target not found");
}

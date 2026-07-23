const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

const target = `      if (newKm !== leg.km || newEmptyRun !== leg.emptyRunKm) {
        if (isPotentialList) {
          const nl = [...plLegs];
          if (newKm !== leg.km) nl[idx].km = newKm;
          if (newEmptyRun !== leg.emptyRunKm) nl[idx].emptyRunKm = newEmptyRun;
          setPlLegs(nl);
        } else {
          updateLeg(idx, { 
            ...(newKm !== leg.km ? { km: newKm } : {}), 
            ...(newEmptyRun !== leg.emptyRunKm ? { emptyRunKm: newEmptyRun } : {})
          });
        }
      }`;

const replacement = `      if (newKm !== leg.km || newEmptyRun !== leg.emptyRunKm) {
        if (isPotentialList) {
          const nl = [...plLegs];
          if (newKm !== leg.km) nl[idx].km = newKm;
          if (newEmptyRun !== leg.emptyRunKm) nl[idx].emptyRunKm = newEmptyRun;
          setPlLegs(nl);
        } else {
          updateLeg(idx, { 
            ...(newKm !== leg.km ? { km: newKm } : {}), 
            ...(newEmptyRun !== leg.emptyRunKm ? { emptyRunKm: newEmptyRun } : {})
          });
        }
      } else {
        // If they didn't change (meaning they were manually typed), prompt to save if they don't match db
        if (leg.km > 0 && leg.from && leg.to) {
          checkManualDistanceUpdate(leg.from, leg.to, leg.km);
        }
        if (leg.emptyRunKm > 0 && leg.from) {
          const prevTo = idx === 0 ? "Минск" : list[idx - 1]?.to;
          if (prevTo) {
            checkManualDistanceUpdate(prevTo, leg.from, leg.emptyRunKm);
          }
        }
      }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);
  console.log("PlanDohod checkLegDistance prompt logic updated");
} else {
  console.log("target not found");
}

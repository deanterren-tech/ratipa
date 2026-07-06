const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

const target = `  const checkLegDistance = (idx: number, isPotentialList: boolean = false) => {
    const list = isPotentialList ? plLegs : legs;
    const leg = list[idx];
    if (leg.from && leg.to) {
      if (settings.useDistanceLookup) {
        const d = findDistance(leg.from, leg.to);
        if (d !== null && leg.km === 0) {
          if (isPotentialList) {
            const nl = [...plLegs];
            nl[idx].km = d;
            setPlLegs(nl);
          } else {
            updateLeg(idx, { km: d });
          }
        }
      }
    }
  };`;

const replacement = `  const checkLegDistance = (idx: number, isPotentialList: boolean = false) => {
    const list = isPotentialList ? plLegs : legs;
    const leg = list[idx];
    
    let newKm = leg.km;
    let newEmptyRun = leg.emptyRunKm;
    
    if (settings.useDistanceLookup) {
      if (leg.from && leg.to && leg.km === 0) {
        const d = findDistance(leg.from, leg.to);
        if (d !== null) newKm = d;
      }
      
      if (leg.from && (!leg.emptyRunKm || leg.emptyRunKm === 0)) {
        const prevTo = idx === 0 ? "Минск" : list[idx - 1]?.to;
        if (prevTo) {
          const emptyRunD = findDistance(prevTo, leg.from);
          if (emptyRunD !== null) {
            newEmptyRun = emptyRunD;
          }
        }
      }
      
      if (newKm !== leg.km || newEmptyRun !== leg.emptyRunKm) {
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
      }
    }
  };`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);
  console.log("PlanDohod checkLegDistance updated");
} else {
  console.log("checkLegDistance target not found");
}

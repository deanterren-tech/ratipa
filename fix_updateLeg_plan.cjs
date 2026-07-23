const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

const target = `            const matchedDist = findDistance(merged.from, merged.to);
            if (
              matchedDist !== null &&
              matchedDist > 0 &&
              typeof updatedFields.km === "undefined"
            ) {
              merged.km = matchedDist;
            }`;

const replacement = `            const matchedDist = findDistance(merged.from, merged.to);
            if (
              matchedDist !== null &&
              matchedDist > 0 &&
              typeof updatedFields.km === "undefined"
            ) {
              merged.km = matchedDist;
            }
            
            // Auto populate emptyRunKm (доезд)
            const prevTo = i === 0 ? "Минск" : legs[i - 1]?.to;
            if (prevTo && merged.from) {
              const emptyRunDist = findDistance(prevTo, merged.from);
              if (
                emptyRunDist !== null &&
                emptyRunDist > 0 &&
                typeof updatedFields.emptyRunKm === "undefined"
              ) {
                merged.emptyRunKm = emptyRunDist;
              }
            }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);
  console.log("PlanDohod updateLeg updated");
} else {
  console.log("Target not found");
}

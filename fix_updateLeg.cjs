const fs = require('fs');
let code = fs.readFileSync('src/components/modules/DohodModule.tsx', 'utf-8');

const target = `            const matchedDist = findDistanceInPool(merged.from, merged.to);
            if (
              matchedDist !== null &&
              matchedDist > 0 &&
              typeof updatedFields.dist === "undefined"
            ) {
              merged.dist = matchedDist;
            }`;

const replacement = `            const matchedDist = findDistanceInPool(merged.from, merged.to);
            if (
              matchedDist !== null &&
              matchedDist > 0 &&
              typeof updatedFields.dist === "undefined"
            ) {
              merged.dist = matchedDist;
            }
            
            // Auto-populate emptyRun (доезд)
            const prevTo = i === 0 ? "Минск" : legs[i - 1]?.to;
            if (prevTo && merged.from) {
              const emptyRunDist = findDistanceInPool(prevTo, merged.from);
              if (
                emptyRunDist !== null &&
                emptyRunDist > 0 &&
                typeof updatedFields.emptyRun === "undefined"
              ) {
                merged.emptyRun = emptyRunDist;
              }
            }`;

if (code.includes(target)) {
  code = code.replace(target, replacement);
  fs.writeFileSync('src/components/modules/DohodModule.tsx', code);
  console.log("Empty run auto-population added to DohodModule");
} else {
  console.log("Target not found");
}

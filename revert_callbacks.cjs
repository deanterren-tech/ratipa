const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf8');

code = code.replace(
  /const findDistance = useCallback\(\(c1: string, c2: string\) => \{([\s\S]*?)  \}, \[distances\]\);/m,
  `function findDistance(c1: string, c2: string) {$1  }`
);

code = code.replace(
  /const calculateEuroFreight = useCallback\(\(infoRateRaw: string, currency: string\) => \{([\s\S]*?)  \}, \[currencies, nbrbRates\]\);/m,
  `function calculateEuroFreight(infoRateRaw: string, currency: string) {$1  }`
);

code = code.replace(
  /const updateLeg = useCallback\(\(index: number, updatedFields: Partial<LegPlan>\) => \{([\s\S]*?)  \}, \[settings\.useDistanceLookup, findDistance, calculateEuroFreight\]\);/m,
  `function updateLeg(index: number, updatedFields: Partial<LegPlan>) {$1  }`
);

fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);

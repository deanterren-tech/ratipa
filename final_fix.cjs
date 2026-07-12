const fs = require('fs');

// Fix types.ts duplicate
let t = fs.readFileSync('src/types.ts', 'utf8');
t = t.replace(/infoCurrency\?: string;\n  infoRateCurrency\?: string;/, 'infoRateCurrency?: string;');
fs.writeFileSync('src/types.ts', t);

// Fix PlanDohodModule.tsx
let p = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf8');
p = p.replace(/driverName: mappedDriverName,/, 'driverName: undefined,');
p = p.replace(/infoRateCurrency: e\.target\.value/g, 'infoCurrency: e.target.value'); // Reverting since it seems it meant infoCurrency
fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', p);

// Fix SalaryModule.tsx pdService
let s = fs.readFileSync('src/components/modules/SalaryModule.tsx', 'utf8');
if (!s.includes('import { pdService } from "../../firebase/planDohodService"')) {
    s = s.replace(/import \{ pdService \} from '\.\.\/\.\.\/firebase\/planDohodService';/, 'import { pdService } from "../../firebase/planDohodService";');
}
fs.writeFileSync('src/components/modules/SalaryModule.tsx', s);


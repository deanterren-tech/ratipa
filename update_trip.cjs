const fs = require('fs');
let code = fs.readFileSync('src/types.ts', 'utf-8');

code = code.replace(
  '  dispatcher: string;\n  currentMonth: string;',
  '  dispatcher: string;\n  driverName?: string;\n  currentMonth: string;'
);

fs.writeFileSync('src/types.ts', code);

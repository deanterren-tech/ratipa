const fs = require('fs');
let code = fs.readFileSync('src/components/modules/DohodModule.tsx', 'utf-8');

code = code.replace(
  "  const totalExpenses = legs.reduce((acc, l) => {",
  "  const totalExpenses = Number(additionalExpenses || 0) + legs.reduce((acc, l) => {"
);

code = code.replace(
  "      expenses: totalExpenses,",
  "      expenses: totalExpenses,\n      additionalExpenses: Number(additionalExpenses || 0),"
);

fs.writeFileSync('src/components/modules/DohodModule.tsx', code);
console.log("update_calc complete");

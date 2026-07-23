const fs = require('fs');
let code = fs.readFileSync('src/components/modules/DohodModule.tsx', 'utf-8');

// 1. Remove the "Swipe Help Badge"
code = code.replace(
  /<div className="block lg:hidden text-xs font-semibold text-slate-600 bg-blue-50\/30 border border-blue-100\/30 rounded-xl px-4 py-3 mb-4 text-center select-none shadow-sm">[\s\S]*?<\/div>/g,
  ''
);

fs.writeFileSync('src/components/modules/DohodModule.tsx', code);

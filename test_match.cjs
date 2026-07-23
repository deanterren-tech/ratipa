const fs = require('fs');
let code = fs.readFileSync('src/components/modules/BazaModule.tsx', 'utf8');
console.log(code.indexOf('</table> useState'));

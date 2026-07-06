const fs = require('fs');
let lines = fs.readFileSync('src/components/modules/DocumentsModule.tsx', 'utf8').split('\n');

let start = -1, end = -1;
for(let i=0; i<lines.length; i++) {
   if (lines[i].includes('const handleSaveNewPlace = ')) { start = i; break; }
}

if (start !== -1) {
   let open = 0;
   for (let i=start; i<lines.length; i++) {
      if (lines[i].includes('{')) open += (lines[i].match(/\{/g) || []).length;
      if (lines[i].includes('}')) open -= (lines[i].match(/\}/g) || []).length;
      if (open === 0 && i > start) { end = i; break; }
   }
   for (let i=start; i<=end; i++) lines[i] = '';
}

fs.writeFileSync('src/components/modules/DocumentsModule.tsx', lines.join('\n'));

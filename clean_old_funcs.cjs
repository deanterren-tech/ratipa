const fs = require('fs');
let lines = fs.readFileSync('src/components/modules/DocumentsModule.tsx', 'utf8').split('\n');

let start1 = -1, end1 = -1;
let start2 = -1, end2 = -1;

for (let i=0; i<lines.length; i++) {
   if (lines[i].includes('const handlePrintTirLossDeclarationOnlyData = () => {')) start1 = i;
   if (lines[i].includes('const handlePrintTirLossDeclaration = async () => {')) start2 = i;
}

if (start2 !== -1) {
   let open = 0;
   for (let i=start2; i<lines.length; i++) {
      if (lines[i].includes('{')) open += (lines[i].match(/\{/g) || []).length;
      if (lines[i].includes('}')) open -= (lines[i].match(/\}/g) || []).length;
      if (open === 0 && i > start2) {
         end2 = i;
         break;
      }
   }
}

if (start1 !== -1) {
   let open = 0;
   for (let i=start1; i<lines.length; i++) {
      if (lines[i].includes('{')) open += (lines[i].match(/\{/g) || []).length;
      if (lines[i].includes('}')) open -= (lines[i].match(/\}/g) || []).length;
      if (open === 0 && i > start1) {
         end1 = i;
         break;
      }
   }
}

console.log("Removing OnlyData:", start1, end1);
console.log("Removing Declaration:", start2, end2);

// clear them
for (let i=start1; i<=end1; i++) lines[i] = '';
for (let i=start2; i<=end2; i++) lines[i] = '';

fs.writeFileSync('src/components/modules/DocumentsModule.tsx', lines.join('\n'));

const fs = require('fs');
let lines = fs.readFileSync('src/components/modules/DocumentsModule.tsx', 'utf8').split('\n');

const removeFunc = (startText, endIndicator) => {
   let start = -1, end = -1;
   for (let i=0; i<lines.length; i++) {
      if (lines[i].includes(startText)) { start = i; break; }
   }
   if (start !== -1) {
      let open = 0;
      for (let i=start; i<lines.length; i++) {
         if (lines[i].includes('{')) open += (lines[i].match(/\{/g) || []).length;
         if (lines[i].includes('}')) open -= (lines[i].match(/\}/g) || []).length;
         if (open === 0 && i > start) {
            end = i;
            break;
         }
      }
      for (let i=start; i<=end; i++) lines[i] = '';
   }
};

const removeComponent = (startText) => {
   let start = -1, end = -1;
   for (let i=0; i<lines.length; i++) {
      if (lines[i].includes(startText)) { start = i; break; }
   }
   if (start !== -1) {
      let open = 0;
      for (let i=start; i<lines.length; i++) {
         if (lines[i].includes('{')) open += (lines[i].match(/\{/g) || []).length;
         if (lines[i].includes('}')) open -= (lines[i].match(/\}/g) || []).length;
         if (open === 0 && i > start) {
            end = i;
            break;
         }
      }
      for (let i=start; i<=end; i++) lines[i] = '';
   }
};

// 1. Remove handlePdfUpload
removeFunc('const handlePdfUpload = ');

// 2. Remove handleFieldDrop
removeFunc('const handleFieldDrop = ');

// 3. Remove DroppableField
removeComponent('const DroppableField = ');

// 4. Also there are calibration controls variables being referenced? We need to find where they are referenced and delete them.
// "tirGlobalOffsetX", "tirGlobalOffsetY", "tirOverlayBgVisible", "tirPrintMode"
// Wait, they are used in the calibration UI! But I thought I deleted the calibration UI!
// Let's check where "tirGlobalOffsetX" is used. It's used in lines 2009, 2022, 2031 etc.
// Let's see what is at line 2009.

fs.writeFileSync('src/components/modules/DocumentsModule.tsx', lines.join('\n'));

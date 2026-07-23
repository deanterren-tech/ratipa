const fs = require('fs');
let lines = fs.readFileSync('src/components/modules/DocumentsModule.tsx', 'utf8').split('\n');

// 1. Remove Floating Dialog Modal at the end
// Let's find "Floating Dialog Modal for inline field editing"
let modalStart = -1;
let modalEnd = -1;
for (let i = lines.length - 1; i >= 0; i--) {
  if (lines[i].includes('{/* Floating Dialog Modal for inline field editing */}')) {
    modalStart = i;
  }
}

if (modalStart !== -1) {
  // Find matching closing brace
  let openCount = 0;
  for (let i = modalStart; i < lines.length; i++) {
    if (lines[i].includes('{editingField && (')) openCount++;
    if (lines[i].includes(')}')) openCount--;
    if (openCount === 0 && i > modalStart) {
      modalEnd = i;
      break;
    }
  }
  // Let's just find the last ")} " before the end of the file.
  modalEnd = modalStart + 160; // rough, let's be safe
  
  // Actually, we know it ends near the end of the file before `  );`
  for (let i = lines.length - 1; i >= 0; i--) {
     if (lines[i].trim() === ')}') {
       modalEnd = i;
       break;
     }
  }
}

// Just slice out what we found
lines.splice(2665, 2681 - 2665 + 1); // delete 2666 to 2681
// Wait, my manual line indices in array are 0-based!
// Let's do it precisely:

lines[2213] = ''; // {tirSubTab === 'letter' ? (
for (let i = 2265; i <= 2680; i++) {
  lines[i] = ''; // remove ) : ( ... )}
}

// To remove the modal safely:
let newLines = [];
let skip = false;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('{/* Floating Dialog Modal for inline field editing */}')) {
    skip = true;
  }
  if (!skip) {
    newLines.push(lines[i]);
  }
  if (skip && lines[i].trim() === ')}' && i > lines.length - 10) {
    skip = false; // stopped skipping
  }
}

fs.writeFileSync('src/components/modules/DocumentsModule.tsx', newLines.filter(line => line !== '').join('\n'));

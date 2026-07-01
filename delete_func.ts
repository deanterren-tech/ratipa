import * as fs from 'fs';

const content = fs.readFileSync('src/components/modules/dozvola/DozvolaDocuments.tsx', 'utf-8');

const startMarker = 'const buildLossDeclarationHtml = () => {';
const endMarker = 'const getHtmlContent = () => {';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.log('Markers not found', startIndex, endIndex);
  process.exit(1);
}

fs.writeFileSync('src/components/modules/dozvola/DozvolaDocuments.tsx', content.substring(0, startIndex) + content.substring(endIndex));

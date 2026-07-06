const fs = require('fs');
let content = fs.readFileSync('src/components/modules/DocumentsModule.tsx', 'utf8');

// 1. Replace handleSaveTirLastData
const oldSaveFuncRegex = /const handleSaveTirLastData = \(\) => \{[\s\S]*?alert\("Ошибка при сохранении\."\);\n\s*\}\);\n\s*\};/;
const newSaveFunc = `const handleSaveTirLastData = () => {
    const payload = {
      tirOutboxNum,
      tirOutboxDate,
      tirCarnetNumbers,
      tirSignee
    };
    set(ref(database, 'bamapTirLastData'), payload)
      .then(() => {
        setTirSavedSuccess(true);
        dbService.logAction(user.name, user.role, "Документы МДП", "Documents", "last_tir", \`Сохранил параметры письма БАМАП № \${tirCarnetNumbers}\`);
        setTimeout(() => setTirSavedSuccess(false), 2500);
      })
      .catch(err => {
        console.error("TIR save failed", err);
        alert("Ошибка при сохранении.");
      });
  };`;
content = content.replace(oldSaveFuncRegex, newSaveFunc);

// 2. Remove handlePrintTirLossDeclaration
const oldPrintFuncRegex = /const handlePrintTirLossDeclaration = \(\) => \{[\s\S]*?printWindow\.document\.close\(\);\n\s*\};/;
content = content.replace(oldPrintFuncRegex, '');

// 3. Remove all tirLoss state declarations (lines 80-114 approx, wait, let's just use regex)
const tirLossStatesRegex = /\/\/ --- LOSS DECLARATION FORM STATE ---[\s\S]*?const \[placeSearchQuery, setPlaceSearchQuery\] = useState\(""\);/;
content = content.replace(tirLossStatesRegex, '');

// 4. Remove loading of bamapTirLossLastData
const loadLossRegex = /\/\/ Load last TIR Loss Declaration data[\s\S]*?\}, \{ onlyOnce: true \}\);/;
content = content.replace(loadLossRegex, '');

// 5. Remove rendering block: {/* Loss Declaration fields */} up to Actions
const lossFormRegex = /\{\/\* Loss Declaration fields \*\/\}[\s\S]*?\{\/\* Actions \*\/}/;
content = content.replace(lossFormRegex, '{/* Actions */}');

// 6. Remove Calibration controls and right side preview logic for Loss
// We find from {/* Calibration controls when overlay print mode is active */} down to the end of the ternary
// Wait, we can just replace {tirSubTab === 'letter' ? ( ... ) : ( ... )}
// with the content of the letter part.
const previewTernaryRegex = /\{tirSubTab === 'letter' \? \([\s\S]*?\) : \(\n\s*<div className="relative w-full aspect-\[1\/1\.414\][\s\S]*?\{\/\* Floating Dialog Modal for inline field editing \*\/\}/;
// Actually simpler: let's match the exact string bounds.

fs.writeFileSync('src/components/modules/DocumentsModule.tsx.tmp', content);

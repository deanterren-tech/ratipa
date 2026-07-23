const fs = require('fs');

function removeHint(file) {
  if (!fs.existsSync(file)) return;
  let code = fs.readFileSync(file, 'utf-8');
  // Usually it's in a <div className="block lg:hidden ...">...Таблица прокручивается вправо...</div>
  code = code.replace(/<div[^>]*block lg:hidden[^>]*>[\s\S]*?Таблица прокручивается вправо[\s\S]*?<\/div>/g, '');
  // DozvolaHistory has <div className="block xl:hidden ...">
  code = code.replace(/<div[^>]*block (lg|xl):hidden[^>]*>[\s\S]*?Таблица прокручивается вправо[\s\S]*?<\/div>/g, '');
  fs.writeFileSync(file, code);
}

removeHint('src/components/modules/BazaModule.tsx');
removeHint('src/components/modules/dozvola/DozvolaRegistryList.tsx');
removeHint('src/components/modules/dozvola/DozvolaHistory.tsx');

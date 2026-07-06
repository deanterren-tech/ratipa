const fs = require('fs');
const glob = require('glob');

// We don't have glob installed globally maybe, so let's just use child_process
const { execSync } = require('child_process');

const files = execSync('grep -rl "confirm(" src/').toString().trim().split('\n');

for (const file of files) {
  if (!file || file.endsWith('.js')) continue;
  let content = fs.readFileSync(file, 'utf8');
  
  // We need to inject useDialog
  if (content.includes('confirm(') || content.includes('window.confirm(')) {
    console.log("Fixing", file);
    // If it doesn't have useDialog, import it
    if (!content.includes('useDialog')) {
      // Find the last import
      const lastImportIndex = content.lastIndexOf('import ');
      const endOfLastImport = content.indexOf('\n', lastImportIndex);
      // We need to figure out the relative path to DialogProvider
      const depth = file.split('/').length - 2; // src/components/modules -> 3 - 2 = 1? wait.
      // src/components/modules/DohodModule.tsx -> depth 2 -> ../../
      let prefix = '';
      const parts = file.split('/');
      const relativeDepth = parts.length - 2; 
      // If file is in src/components/modules, parts is ['src', 'components', 'modules', 'DohodModule.tsx'] -> length 4.
      // We want to reach src/components/DialogProvider.
      // Path relative to src/components:
      // If parts[1] == 'components' and length 4 -> `../DialogProvider`
      
      let relativePath = '';
      if (file === 'src/components/AppShell.tsx') {
        relativePath = './DialogProvider';
      } else if (parts.length === 4) {
        relativePath = '../DialogProvider'; // src/components/modules/X
      } else if (parts.length === 5) {
        relativePath = '../../DialogProvider'; // src/components/modules/dozvola/X
      } else {
        relativePath = '../components/DialogProvider'; // default fallback
      }
      
      content = content.replace(
        /(import React.*?)\n/,
        `$1\nimport { useDialog } from '${relativePath}';\n`
      );
      if (!content.includes('useDialog')) {
         content = `import { useDialog } from '${relativePath}';\n` + content;
      }
    }
    
    // Inject const { showConfirm } = useDialog(); inside the component
    // This is tricky using regex. Let's do it manually for the files.
  }
}

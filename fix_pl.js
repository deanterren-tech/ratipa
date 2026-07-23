const fs = require('fs');

const path = 'src/components/modules/PlanDohodModule.tsx';
let content = fs.readFileSync(path, 'utf8');

// 1. Add import
if (!content.includes('useDialog')) {
  content = content.replace('import { pdService } from "../../firebase/planDohodService";', 'import { pdService } from "../../firebase/planDohodService";\nimport { useDialog } from "../DialogProvider";');
}

// 2. Add useDialog inside the component
if (!content.includes('const { showConfirm } = useDialog();')) {
  content = content.replace('export default function PlanDohodModule({ user }: PlanDohodModuleProps) {', 'export default function PlanDohodModule({ user }: PlanDohodModuleProps) {\n  const { showConfirm } = useDialog();');
}

// 3. deletePotentialLoad
content = content.replace(
  'const deletePotentialLoad = (id: string) => {\n    if (confirm("Удалить просчет?")) {',
  'const deletePotentialLoad = async (id: string) => {\n    if (await showConfirm("Удалить просчет?")) {'
);

// 4. applyPlToMain
content = content.replace(
  'const applyPlToMain = (pl: PotentialLoad) => {\n    if (\n      confirm(\n        "Осторожно: Это заменит текущие плечи в основной форме. Продолжить?",\n      )\n    ) {',
  'const applyPlToMain = async (pl: PotentialLoad) => {\n    if (\n      await showConfirm(\n        "Осторожно: Это заменит текущие плечи в основной форме. Продолжить?",\n      )\n    ) {'
);

fs.writeFileSync(path, content, 'utf8');

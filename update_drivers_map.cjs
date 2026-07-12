const fs = require('fs');
let code = fs.readFileSync('src/components/modules/SettingsModule.tsx', 'utf-8');

code = code.replace(
  "const [dispatchersMap, setDispatchersMap] = useState<Record<string, string>>({});",
  "const [dispatchersMap, setDispatchersMap] = useState<Record<string, string>>({});\n  const [driversMap, setDriversMap] = useState<Record<string, string>>({});"
);

code = code.replace(
  "const unsubMap = pdService.subscribeDispatchersCarMapping((m) => setDispatchersMap(m));",
  "const unsubMap = pdService.subscribeDispatchersCarMapping((m) => setDispatchersMap(m));\n    const unsubDriversMap = pdService.subscribeDriversCarMapping((m) => setDriversMap(m));"
);

code = code.replace(
  "return () => { unsubDisp(); unsubMap(); };",
  "return () => { unsubDisp(); unsubMap(); unsubDriversMap(); };"
);

fs.writeFileSync('src/components/modules/SettingsModule.tsx', code);

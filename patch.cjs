const fs = require('fs');
let code = fs.readFileSync('src/utils/bazaSync.ts', 'utf8');

code = code.replace(
  /export function applySharedDriverToBazaRecord\(bazaRecord: any, drivers: any\[\]\): any \{([\s\S]*?)  return \{/m,
  `export function applySharedDriverToBazaRecord(bazaRecord: any, drivers: any[]): any {
  if (!bazaRecord.driverId) return { ...bazaRecord, driverShortNameRu: bazaRecord.driverShortNameRu || bazaRecord.driverName || '— (Нет водителя)' };
  const driver = drivers.find(d => d.id === bazaRecord.driverId);
  if (!driver) return { ...bazaRecord, driverShortNameRu: bazaRecord.driverShortNameRu || bazaRecord.driverName || '— (Водитель удален)' };
  return {`
);

fs.writeFileSync('src/utils/bazaSync.ts', code);

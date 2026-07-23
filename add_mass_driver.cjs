const fs = require('fs');
let code = fs.readFileSync('src/components/modules/SettingsModule.tsx', 'utf-8');

const massTariffFuncStr = "  const handleMassMapToTariff = (targetGroup: CarRateGroup | null) => {";
const massDriverFuncStr = `  const handleMassMapToDriver = (driverId: string | null) => {
    if (!isWritePermitted || selectedCars.length === 0) return;
    const updatedMap = { ...driversMap };
    selectedCars.forEach(car => {
      if (!driverId || driverId === 'Без водителя') {
        delete updatedMap[car];
      } else {
        updatedMap[car] = driverId;
      }
    });
    pdService.updateDriversCarMapping(updatedMap);
    dbService.logAction(user.name, user.role, 'Mass Map Driver', 'Settings', selectedCars.join(', '), \`Массово назначен водитель \${driverId || 'Без водителя'}\`);
    toast(\`Назначен водитель для \${selectedCars.length} авто\`, 'success');
    setSelectedCars([]);
  };

`;

code = code.replace(massTariffFuncStr, massDriverFuncStr + massTariffFuncStr);
fs.writeFileSync('src/components/modules/SettingsModule.tsx', code);

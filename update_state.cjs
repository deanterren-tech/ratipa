const fs = require('fs');

let content = fs.readFileSync('src/components/modules/SettingsModule.tsx', 'utf-8');

const stateMarker = '// Dispatcher-Car Mapping States';
const newState = `
  // Mass Selection States
  const [selectedCars, setSelectedCars] = useState<string[]>([]);
  const [lastSelectedCar, setLastSelectedCar] = useState<string | null>(null);

  const toggleCarSelection = (car: string, isShift: boolean) => {
    const allPlates = allCars.filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase()));
    if (isShift && lastSelectedCar) {
      const startIndex = allPlates.indexOf(lastSelectedCar);
      const endIndex = allPlates.indexOf(car);
      if (startIndex !== -1 && endIndex !== -1) {
        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        const slice = allPlates.slice(start, end + 1);
        setSelectedCars(prev => [...new Set([...prev, ...slice])]);
        setLastSelectedCar(car);
        return;
      }
    }
    setSelectedCars(prev => {
      if (prev.includes(car)) {
        return prev.filter(c => c !== car);
      }
      return [...prev, car];
    });
    setLastSelectedCar(car);
  };

  const handleMassMapToDispatcher = (disp: string | null) => {
    if (!isWritePermitted || selectedCars.length === 0) return;
    const updatedMap = { ...dispatchersMap };
    selectedCars.forEach(car => {
      if (!disp || disp === 'Без диспетчера') {
        delete updatedMap[car];
      } else {
        updatedMap[car] = disp;
      }
    });
    pdService.updateDispatchersCarMapping(updatedMap);
    dbService.logAction(user.name, user.role, 'Mass Map Car', 'Settings', selectedCars.join(', '), \`Массово привязано к \${disp || 'Без диспетчера'}\`);
    toast(\`Назначен диспетчер для \${selectedCars.length} авто\`, 'success');
    setSelectedCars([]);
  };

  const handleMassMapToTariff = (targetGroup: CarRateGroup | null) => {
    if (!isWritePermitted || selectedCars.length === 0) return;
    
    // First remove from all existing groups
    carRateGroups.forEach(g => {
      const hasSelected = g.vehicles?.some(v => selectedCars.includes(v));
      if (hasSelected) {
        dbService.saveCarRateGroup({
          ...g,
          vehicles: (g.vehicles || []).filter(v => !selectedCars.includes(v))
        }, user.name, user.role);
      }
    });
    
    if (targetGroup) {
      // Add to new group
      dbService.saveCarRateGroup({
        ...targetGroup,
        vehicles: [...new Set([...(targetGroup.vehicles || []), ...selectedCars])]
      }, user.name, user.role);
    }
    
    dbService.logAction(user.name, user.role, 'Mass Map Tariff', 'Settings', selectedCars.join(', '), \`Массово назначен тариф \${targetGroup?.name || 'Без тарифа'}\`);
    toast(\`Назначен тариф для \${selectedCars.length} авто\`, 'success');
    setSelectedCars([]);
  };

  // Dispatcher-Car Mapping States`;

content = content.replace(stateMarker, newState);

fs.writeFileSync('src/components/modules/SettingsModule.tsx', content);

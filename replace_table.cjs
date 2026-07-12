const fs = require('fs');
let code = fs.readFileSync('src/components/modules/SettingsModule.tsx', 'utf-8');

code = code.replace(
  '<th className="px-4 py-3 whitespace-nowrap">Госномер</th>',
  '<th className="px-4 py-3 whitespace-nowrap">Госномер</th>\n                            <th className="px-4 py-3 whitespace-nowrap">Водитель</th>'
);

const driverRowLogic = `
                              const currentDisp = dispatchersMap[carPlate];
                              const currentDriverId = driversMap[carPlate];
                              const currentDriver = drivers.find(d => d.id === currentDriverId);
                              const tGroup = carRateGroups.find(g => (g.vehicles || []).includes(carPlate));
`;

code = code.replace(
  "const currentDisp = dispatchersMap[carPlate];\n                              const tGroup = carRateGroups.find(g => (g.vehicles || []).includes(carPlate));",
  driverRowLogic
);

const driverColumnHTML = `
                                  <td className="px-4 py-2.5">
                                    {currentDriver ? (
                                      <span className="inline-block px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-100 rounded-md text-[9px] font-black uppercase tracking-wider">{currentDriver.name}</span>
                                    ) : (
                                      <span className="text-[9px] text-slate-400 uppercase font-black">Нет</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {currentDisp ? (
`;

code = code.replace(
  `                                  <td className="px-4 py-2.5">
                                    {currentDisp ? (`,
  driverColumnHTML
);

fs.writeFileSync('src/components/modules/SettingsModule.tsx', code);

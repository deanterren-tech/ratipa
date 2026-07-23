const fs = require('fs');
let code = fs.readFileSync('src/components/modules/SettingsModule.tsx', 'utf-8');

const targetStr = '{/* TARIFFS BLOCK */}';

const driverBlock = `
                {/* DRIVERS BLOCK */}
                <div className="bg-slate-50/50 rounded-3xl border border-slate-200/60 p-5 flex flex-col gap-4">
                  <div>
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight flex items-center gap-2 mb-1">
                      <div className="w-5 h-5 rounded flex items-center justify-center bg-emerald-500/10">
                        <Users className="h-3 w-3 text-emerald-500" />
                      </div>
                      Водители
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium">Назначьте водителя для выделенных авто</p>
                  </div>
                  
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                    <div 
                      onClick={() => {
                        if (selectedCars.length > 0) handleMassMapToDriver('Без водителя');
                      }}
                      className={\`p-3 rounded-2xl border transition-all select-none flex justify-between items-center \${selectedCars.length > 0 ? 'cursor-pointer hover:border-red-400 hover:shadow-sm bg-white' : 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200'}\`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                        <strong className="text-xs font-black uppercase tracking-wider text-slate-800">Отвязать от всех</strong>
                      </div>
                      {selectedCars.length > 0 && <span className="text-[9px] font-mono font-black text-red-500 uppercase">Назначить</span>}
                    </div>

                    {drivers.map(drv => (
                      <div 
                        key={drv.id}
                        onClick={() => {
                          if (selectedCars.length > 0) handleMassMapToDriver(drv.id);
                        }}
                        className={\`p-3 rounded-2xl border transition-all select-none flex justify-between items-center \${selectedCars.length > 0 ? 'cursor-pointer hover:border-emerald-400 hover:shadow-sm bg-white' : 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200'}\`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
                          <strong className="text-xs font-black uppercase tracking-wider text-slate-800">{drv.name}</strong>
                        </div>
                        {selectedCars.length > 0 && <span className="text-[9px] font-mono font-black text-emerald-500 uppercase">Назначить</span>}
                      </div>
                    ))}
                  </div>
                </div>

                `;

code = code.replace(targetStr, driverBlock + targetStr);
fs.writeFileSync('src/components/modules/SettingsModule.tsx', code);

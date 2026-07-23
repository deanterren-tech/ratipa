const fs = require('fs');
let code = fs.readFileSync('src/components/modules/SettingsModule.tsx', 'utf-8');

const startMarker = '{/* INTERACTIVE CAR-DISPATCHER MAPPING BLOCK */}';
const endMarker = '{/* DRIVERS DIRECTORY - FULL WIDTH CARDS */}';

const startIndex = code.indexOf(startMarker);
const endIndex = code.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Markers not found");
  process.exit(1);
}

const newBlock = `
          {/* UNIFIED FLEET MANAGEMENT BLOCK */}
          <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-xl shadow-slate-900/5 flex flex-col relative space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 border-b border-slate-200/60">
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Truck className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                  <span>Управление автопарком</span>
                </h2>
                <p className="text-[11px] text-slate-400 font-medium mt-1">
                  Единое окно для управления автомобилями, привязкой к диспетчерам и тарифами
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
              
              {/* LEFT: FLEET BASE (with multiselect) - 7 cols */}
              <div className="xl:col-span-7 flex flex-col space-y-4">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between bg-slate-50/50 p-4 rounded-3xl border border-slate-200/60">
                    <div className="flex items-center gap-3">
                      <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider font-mono">
                        База ({allCars.length})
                      </span>
                      {selectedCars.length > 0 && (
                        <span className="text-[10px] font-black uppercase bg-blue-100 text-blue-700 px-2.5 py-1 rounded-lg">
                          Выбрано: {selectedCars.length}
                        </span>
                      )}
                    </div>
                    {/* Local search */}
                    <div className="relative w-full sm:w-56">
                      <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                        <Search className="w-4 h-4" />
                      </span>
                      <input
                        type="text"
                        placeholder="Поиск по госномеру..."
                        value={carSearchInMapping}
                        onChange={(e) => setCarSearchInMapping(e.target.value)}
                        className="w-full bg-white border border-slate-200 pl-9 pr-3 py-2 rounded-xl text-xs font-bold uppercase tracking-wide outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-500/10 shadow-sm transition font-mono"
                      />
                    </div>
                  </div>

                  {isWritePermitted && (
                    <form onSubmit={handleAddKnownCar} className="flex gap-2 bg-white/50 backdrop-blur-md p-2 rounded-2xl border border-slate-200/80 shadow-sm">
                      <input
                        type="text"
                        placeholder="ДОБАВИТЬ НОВЫЙ: 1234 AB-7"
                        required
                        value={newCarPlate}
                        onChange={(e) => setNewCarPlate(e.target.value)}
                        className="flex-1 px-4 py-2 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 font-black placeholder:text-slate-400 text-slate-800 uppercase font-mono tracking-widest shadow-inner transition"
                      />
                      <button type="submit" className="bg-blue-500 hover:bg-blue-600 text-white rounded-xl text-xs font-semibold px-5 py-2 transition-all cursor-pointer shadow-sm active:scale-95">
                        Добавить
                      </button>
                    </form>
                  )}

                  {/* List of cars */}
                  <div className="flex-1 overflow-hidden bg-white/50 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-sm flex flex-col">
                    <div className="overflow-x-auto flex-1 max-h-[600px] custom-scrollbar">
                      <table className="w-full text-left border-collapse select-none">
                        <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur shadow-sm">
                          <tr className="text-[9px] font-black uppercase text-slate-500 font-mono border-b border-slate-200/80">
                            <th className="px-4 py-3 w-10 text-center">
                              <input 
                                type="checkbox" 
                                checked={allCars.length > 0 && selectedCars.length === allCars.filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase())).length}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedCars(allCars.filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase())));
                                  } else {
                                    setSelectedCars([]);
                                  }
                                }}
                                className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer" 
                              />
                            </th>
                            <th className="px-4 py-3 whitespace-nowrap">Госномер</th>
                            <th className="px-4 py-3 whitespace-nowrap">Диспетчер</th>
                            <th className="px-4 py-3 whitespace-nowrap">Тариф</th>
                            {isWritePermitted && <th className="px-4 py-3 text-right w-[80px]"></th>}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100/80 text-xs text-slate-700 font-mono bg-white/40">
                          {allCars
                            .filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase()))
                            .map((carPlate, idx) => {
                              const isSelected = selectedCars.includes(carPlate);
                              const knownItem = knownFleetObjects.find(x => x.plate.trim().toUpperCase() === carPlate);
                              const isEditing = knownItem && editingCarKey === knownItem.key;
                              
                              const currentDisp = dispatchersMap[carPlate];
                              const tGroup = carRateGroups.find(g => (g.vehicles || []).includes(carPlate));

                              return (
                                <tr 
                                  key={carPlate} 
                                  onClick={(e) => {
                                    if ((e.target).closest('button') || (e.target).closest('input[type="text"]')) return;
                                    toggleCarSelection(carPlate, e.shiftKey);
                                  }}
                                  className={\`transition-colors group cursor-pointer \${isSelected ? 'bg-blue-50/50 hover:bg-blue-50/80' : 'hover:bg-slate-50'}\`}
                                >
                                  <td className="px-4 py-2.5 text-center">
                                    <input 
                                      type="checkbox" 
                                      checked={isSelected}
                                      readOnly
                                      className="w-3.5 h-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer pointer-events-none" 
                                    />
                                  </td>
                                  <td className="px-4 py-2.5 font-black text-slate-800 uppercase tracking-widest whitespace-nowrap">
                                    {isEditing ? (
                                      <input
                                        type="text"
                                        value={editCarPlate}
                                        onChange={(e) => setEditCarPlate(e.target.value)}
                                        className="p-1.5 bg-white text-xs rounded-lg border border-blue-400 shadow-[0_0_0_2px_rgba(59,130,246,0.2)] font-black w-[110px] outline-none uppercase font-mono tracking-widest text-slate-800"
                                      />
                                    ) : (
                                      carPlate
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {currentDisp ? (
                                      <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-md text-[9px] font-black uppercase tracking-wider">{currentDisp}</span>
                                    ) : (
                                      <span className="text-[9px] text-slate-400 uppercase font-black">Нет</span>
                                    )}
                                  </td>
                                  <td className="px-4 py-2.5">
                                    {tGroup ? (
                                      <span className="inline-block px-2 py-0.5 bg-indigo-50 text-indigo-700 border border-indigo-100 rounded-md text-[9px] font-black uppercase tracking-wider">{tGroup.name}</span>
                                    ) : (
                                      <span className="text-[9px] text-slate-400 uppercase font-black">Нет</span>
                                    )}
                                  </td>
                                  {isWritePermitted && (
                                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                      {knownItem && (
                                        isEditing ? (
                                          <div className="flex gap-1.5 justify-end">
                                            <button
                                              onClick={() => handleSaveEditCar(knownItem.key)}
                                              className="text-emerald-600 bg-emerald-50 hover:bg-emerald-100 p-1.5 rounded-lg transition"
                                              title="Сохранить"
                                            >
                                              <Check className="h-4 w-4" />
                                            </button>
                                            <button
                                              onClick={() => setEditingCarKey(null)}
                                              className="text-slate-500 bg-slate-100 hover:bg-slate-200 p-1.5 rounded-lg transition"
                                              title="Отмена"
                                            >
                                              <X className="h-4 w-4" />
                                            </button>
                                          </div>
                                        ) : (
                                          <div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                                            <button
                                              onClick={() => handleStartEditCar(knownItem.key, knownItem.plate)}
                                              className="text-blue-600 bg-blue-50 hover:bg-blue-100 p-1.5 rounded-lg transition"
                                              title="Изменить"
                                            >
                                              <Edit2 className="h-3.5 w-3.5" />
                                            </button>
                                            <button
                                              onClick={() => handleDeleteKnownCar(knownItem.key, knownItem.plate)}
                                              className="text-rose-600 bg-rose-50 hover:bg-rose-100 p-1.5 rounded-lg transition"
                                              title="Удалить"
                                            >
                                              <Trash2 className="h-3.5 w-3.5" />
                                            </button>
                                          </div>
                                        )
                                      )}
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT: ACTIONS & TARIFFS - 5 cols */}
              <div className="xl:col-span-5 flex flex-col space-y-6">
                
                {/* DISPATCHERS BLOCK */}
                <div className="bg-slate-50/50 rounded-3xl border border-slate-200/60 p-5 flex flex-col gap-4">
                  <div>
                    <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight flex items-center gap-2 mb-1">
                      <Users className="h-4 w-4 text-blue-500" />
                      Диспетчеры
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium">Назначьте диспетчера для выделенных авто</p>
                  </div>
                  
                  <div className="space-y-2 max-h-[220px] overflow-y-auto pr-2 custom-scrollbar">
                    <div 
                      onClick={() => {
                        if (selectedCars.length > 0) handleMassMapToDispatcher('Без диспетчера');
                      }}
                      className={\`p-3 rounded-2xl border transition-all select-none flex justify-between items-center \${selectedCars.length > 0 ? 'cursor-pointer hover:border-red-400 hover:shadow-sm bg-white' : 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200'}\`}
                    >
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                        <strong className="text-xs font-black uppercase tracking-wider text-slate-800">Отвязать от всех</strong>
                      </div>
                      {selectedCars.length > 0 && <span className="text-[9px] font-mono font-black text-red-500 uppercase">Назначить</span>}
                    </div>

                    {dispatchers.map(dispName => (
                      <div 
                        key={dispName}
                        onClick={() => {
                          if (selectedCars.length > 0) handleMassMapToDispatcher(dispName);
                        }}
                        className={\`p-3 rounded-2xl border transition-all select-none flex justify-between items-center \${selectedCars.length > 0 ? 'cursor-pointer hover:border-blue-400 hover:shadow-sm bg-white' : 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200'}\`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                          <strong className="text-xs font-black uppercase tracking-wider text-slate-800">{dispName}</strong>
                        </div>
                        {selectedCars.length > 0 && <span className="text-[9px] font-mono font-black text-blue-500 uppercase">Назначить</span>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* TARIFFS BLOCK */}
                <div className="bg-slate-50/50 rounded-3xl border border-slate-200/60 p-5 flex flex-col gap-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="text-xs font-black text-slate-900 uppercase tracking-tight flex items-center gap-2 mb-1">
                        <Wallet className="h-4 w-4 text-indigo-500" />
                        Тарифные группы
                      </h3>
                      <p className="text-[10px] text-slate-400 font-medium">Ставки для ЗП водителей</p>
                    </div>
                  </div>

                  {isWritePermitted && (
                    <form onSubmit={handleAddTariff} className="flex gap-2">
                      <input
                        type="text"
                        placeholder="Имя"
                        required
                        value={stName}
                        onChange={(e) => setStName(e.target.value)}
                        className="w-[30%] px-3 py-2 bg-white text-[10px] rounded-xl border border-slate-200 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 font-bold uppercase font-mono"
                      />
                      <input
                        type="number"
                        step="0.001"
                        placeholder="€/км"
                        required
                        value={stRate || ''}
                        onChange={(e) => setStRate(Number(e.target.value))}
                        className="w-[25%] px-3 py-2 bg-white text-[10px] rounded-xl border border-slate-200 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 font-black font-mono"
                      />
                      <input
                        type="number"
                        placeholder="€/день"
                        value={stPerDiem || ''}
                        onChange={(e) => setStPerDiem(e.target.value ? Number(e.target.value) : undefined)}
                        className="w-[25%] px-3 py-2 bg-white text-[10px] rounded-xl border border-slate-200 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-500/10 font-black font-mono"
                      />
                      <button type="submit" className="w-[20%] bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-[10px] font-bold transition-all shadow-sm active:scale-95 cursor-pointer">
                        Создать
                      </button>
                    </form>
                  )}

                  <div className="space-y-2 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    <div 
                      onClick={() => {
                        if (selectedCars.length > 0) handleMassMapToTariff(null);
                      }}
                      className={\`p-3 rounded-2xl border transition-all select-none flex justify-between items-center \${selectedCars.length > 0 ? 'cursor-pointer hover:border-red-400 hover:shadow-sm bg-white' : 'opacity-50 cursor-not-allowed bg-slate-100 border-slate-200'}\`}
                    >
                      <div className="flex flex-col gap-0.5">
                        <strong className="text-xs font-black uppercase tracking-wider text-slate-800">Без тарифа</strong>
                      </div>
                      {selectedCars.length > 0 && <span className="text-[9px] font-mono font-black text-red-500 uppercase">Применить</span>}
                    </div>

                    {carRateGroups.map(group => (
                      <div 
                        key={group.id}
                        onClick={(e) => {
                          if ((e.target).closest('button')) return;
                          if (selectedCars.length > 0) handleMassMapToTariff(group);
                        }}
                        className={\`p-3 rounded-2xl border transition-all select-none flex justify-between items-center group relative \${selectedCars.length > 0 ? 'cursor-pointer hover:border-indigo-400 hover:shadow-sm bg-white' : 'bg-white border-slate-200'}\`}
                      >
                        <div className="flex flex-col gap-1">
                          <strong className="text-xs font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                            {group.name}
                            <span className="text-[9px] font-mono font-black bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">
                              {group.vehicles?.length || 0} авто
                            </span>
                          </strong>
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[9px] font-black text-slate-500">
                              {group.rate} €/км
                            </span>
                            {group.perDiemRate !== undefined && (
                              <span className="font-mono text-[9px] font-black text-indigo-500 border-l border-slate-200 pl-1.5">
                                {group.perDiemRate} €/д
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {selectedCars.length > 0 && <span className="text-[9px] font-mono font-black text-indigo-500 uppercase">Применить</span>}
                          {isWritePermitted && selectedCars.length === 0 && (
                            <button onClick={() => handleDeleteTariff(group.id)} className="text-rose-400 hover:text-rose-600 bg-white border border-rose-100 shadow-sm p-1.5 hover:bg-rose-50 rounded-lg transition opacity-0 group-hover:opacity-100">
                              <Trash2 className="h-3.5 w-3.5"/>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              </div>
            </div>
          </div>
`;

code = code.substring(0, startIndex) + newBlock + '\n          ' + code.substring(endIndex);

fs.writeFileSync('src/components/modules/SettingsModule.tsx', code);

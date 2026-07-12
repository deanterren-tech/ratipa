const fs = require('fs');

let content = fs.readFileSync('src/components/modules/SettingsModule.tsx', 'utf-8');

const startMarker = '{/* INTERACTIVE CAR-DISPATCHER MAPPING BLOCK */}';
const endMarker = '{/* DRIVERS DIRECTORY - FULL WIDTH CARDS */}';

const startIndex = content.indexOf(startMarker);
const endIndex = content.indexOf(endMarker);

if (startIndex === -1 || endIndex === -1) {
  console.error("Markers not found");
  process.exit(1);
}

const newBlocks = `
          {/* INTERACTIVE CAR-DISPATCHER MAPPING BLOCK */}
          <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-xl shadow-slate-900/5 flex flex-col relative">
            <div className="flex flex-col md:flex-row md:items-center justify-between pb-5 border-b border-slate-200/60 mb-6">
              <div>
                <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
                    <Users className="h-4.5 w-4.5 text-blue-500" />
                  </div>
                  <span>Интерактивная привязка авто к диспетчерам</span>
                </h2>
                <p className="text-[11px] text-slate-400 font-medium mt-1">
                  Перетаскивайте автомобили из базы (справа) на карточки диспетчеров (слева) для привязки
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
              {/* LEFT COLUMN: Dispatchers Tabs */}
              <div className="lg:col-span-4 space-y-4 bg-slate-50/50 rounded-3xl p-5 border border-slate-200/60">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-black uppercase text-slate-500 font-mono tracking-wider">
                    Список Диспетчеров
                  </span>
                  <span className="text-[10px] text-slate-500 font-bold uppercase bg-white border border-slate-200 px-2 py-0.5 rounded-lg shadow-sm font-mono">
                    {dispatchers.length} активных
                  </span>
                </div>
                
                <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {/* "Без диспетчера" Card */}
                  <div 
                    onDragOver={(e) => handleDragOverDispCard(e, 'Без диспетчера')}
                    onDragLeave={handleDragLeaveDispCard}
                    onDrop={(e) => handleDropOnDispCard(e, 'Без диспетчера')}
                    onClick={() => setActiveDispSelect('Без диспетчера')}
                    className={\`p-4 rounded-2xl border transition-all cursor-pointer select-none relative \${
                      activeDispSelect === 'Без диспетчера'
                        ? 'border-red-400 bg-red-50 text-red-950 shadow-md ring-4 ring-red-500/10'
                        : 'border-slate-200 hover:border-slate-300 bg-white shadow-sm text-slate-700'
                    } \${dragOverDisp === 'Без диспетчера' ? 'ring-2 ring-red-500 ring-dashed border-red-500 scale-[1.02]' : ''}\`}
                  >
                    <div className="flex justify-between items-center">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
                        <strong className="text-xs font-black uppercase tracking-wider text-slate-800">Без диспетчера</strong>
                      </div>
                      <span className="bg-white border border-slate-200 shadow-sm px-2.5 py-1 rounded-lg font-mono text-[10px] font-black text-slate-600">
                        {allCars.filter(c => !dispatchersMap[c]).length}
                      </span>
                    </div>
                  </div>

                  {dispatchers.map((dispName) => {
                    const countAssigned = allCars.filter(c => dispatchersMap[c] === dispName).length;
                    return (
                      <div 
                        key={dispName}
                        onDragOver={(e) => handleDragOverDispCard(e, dispName)}
                        onDragLeave={handleDragLeaveDispCard}
                        onDrop={(e) => handleDropOnDispCard(e, dispName)}
                        onClick={() => setActiveDispSelect(dispName)}
                        className={\`p-4 rounded-2xl border transition-all cursor-pointer select-none relative \${
                          activeDispSelect === dispName
                            ? 'border-[#3765F6] bg-[#3765F6]/5 text-blue-950 shadow-md ring-4 ring-[#3765F6]/10'
                            : 'border-slate-200 hover:border-slate-300 bg-white shadow-sm text-slate-700'
                        } \${dragOverDisp === dispName ? 'ring-2 ring-blue-500 ring-dashed border-blue-500 scale-[1.02]' : ''}\`}
                      >
                        <div className="flex justify-between items-center">
                          <div className="flex items-center gap-2.5">
                            <span className="w-2 h-2 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
                            <strong className="text-xs font-black uppercase tracking-wider text-slate-800">{dispName}</strong>
                          </div>
                          <span className="bg-white border border-slate-200 shadow-sm px-2.5 py-1 rounded-lg font-mono text-[10px] font-black text-slate-600">
                            {countAssigned}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* RIGHT COLUMN: All Cars in DB base */}
              <div className="lg:col-span-8 flex flex-col space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/50 p-4 rounded-3xl border border-slate-200/60">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider font-mono">
                      Все Автомобили ({allCars.length})
                    </span>
                    <span className="text-[10px] text-slate-400 font-medium">Перетяните карточку авто влево</span>
                  </div>
                  <div className="relative w-full sm:w-64">
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

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
                  {allCars
                    .filter(plate => !carSearchInMapping.trim() || plate.toLowerCase().includes(carSearchInMapping.toLowerCase()))
                    .map((carPlate) => {
                      const currentDisp = dispatchersMap[carPlate];
                      return (
                        <div 
                          key={carPlate}
                          draggable={isWritePermitted}
                          onDragStart={(e) => handleDragStartCarMapping(e, carPlate)}
                          className={\`p-3.5 rounded-2xl border transition-all relative select-none flex flex-col gap-2 cursor-move shadow-sm hover:shadow-md \${
                            currentDisp 
                              ? "border-blue-100 bg-blue-50/30 hover:border-blue-200" 
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }\`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className={\`w-7 h-7 rounded-lg flex items-center justify-center shadow-sm border \${currentDisp ? 'bg-blue-100 text-blue-600 border-blue-200/50' : 'bg-slate-50 text-slate-400 border-slate-200/50'}\`}>
                                <Truck className="w-3.5 h-3.5" />
                              </div>
                              <span className="font-mono text-xs font-black tracking-widest text-slate-800 uppercase">
                                {carPlate}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center justify-between border-t border-slate-100/60 pt-2 mt-0.5">
                            <span className="text-[9px] font-mono font-bold uppercase bg-white px-2 py-0.5 rounded-md border border-slate-100 shadow-sm">
                              {currentDisp ? (
                                <span className="text-blue-600">{currentDisp}</span>
                              ) : (
                                <span className="text-slate-400">Свободен</span>
                              )}
                            </span>
                            {isWritePermitted && currentDisp && (
                                <button 
                                  onClick={() => handleMapCarToDispatcher(carPlate, null)}
                                  className="text-[9px] font-black text-rose-500 hover:bg-rose-50 px-1.5 py-0.5 rounded transition uppercase border border-rose-100 shadow-sm bg-white"
                                >
                                  Снять
                                </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>

          {/* TWO PANEL ROW: VEHICLES DIRECTORY & TARIFF GROUPS */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-8">
            
            {/* 1. VEHICLES DIRECTORY (5 cols) */}
            <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5 xl:col-span-5 flex flex-col">
              <div className="flex flex-col gap-3 mb-5">
                <div className="flex items-center justify-between pb-4 border-b border-slate-200/60">
                  <div>
                    <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-emerald-500/10 flex items-center justify-center">
                        <Truck className="h-4 w-4 text-emerald-500" />
                      </div>
                      <span>База Автопарка</span>
                    </h3>
                    <p className="text-[10px] text-slate-400 font-medium mt-1">Реестр активных тягачей</p>
                  </div>
                  {/* Local search */}
                  <div className="relative w-full sm:w-44">
                    <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                      <Search className="w-3.5 h-3.5" />
                    </span>
                    <input
                      type="text"
                      placeholder="Поиск..."
                      value={carSearch}
                      onChange={(e) => setCarSearch(e.target.value)}
                      className="w-full bg-white border border-slate-200 pl-9 pr-3 py-2 rounded-xl text-[10px] font-bold uppercase tracking-wide outline-none focus:border-emerald-400 focus:ring-4 focus:ring-emerald-500/10 shadow-sm transition font-mono"
                    />
                  </div>
                </div>

                {isWritePermitted && (
                  <form onSubmit={handleAddKnownCar} className="flex gap-2 bg-white/50 backdrop-blur-md p-2 rounded-2xl border border-slate-200/80 shadow-sm">
                    <input
                      type="text"
                      placeholder="1234 AB-7"
                      required
                      value={newCarPlate}
                      onChange={(e) => setNewCarPlate(e.target.value)}
                      className="flex-1 px-4 py-2 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 font-black placeholder:text-slate-400 text-slate-800 uppercase font-mono tracking-widest shadow-inner transition"
                    />
                    <button type="submit" className="bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-xs font-semibold px-5 py-2 transition-all cursor-pointer shadow-sm active:scale-95">
                      Добавить
                    </button>
                  </form>
                )}
              </div>

              <div className="flex-1 overflow-hidden bg-white/50 backdrop-blur-md border border-slate-200/80 rounded-2xl shadow-sm flex flex-col">
                <div className="overflow-x-auto flex-1 max-h-[400px] custom-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur shadow-sm">
                      <tr className="text-[9px] font-black uppercase text-slate-500 font-mono border-b border-slate-200/80">
                        <th className="px-4 py-3 whitespace-nowrap">Госномер</th>
                        <th className="px-4 py-3 whitespace-nowrap">Диспетчер</th>
                        <th className="px-4 py-3 whitespace-nowrap">Тариф</th>
                        {isWritePermitted && <th className="px-4 py-3 text-right w-[80px]"></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100/80 text-xs text-slate-700 font-mono bg-white/40">
                      {filteredKnownFleet.map((item) => {
                        const isEditing = editingCarKey === item.key;
                        const disp = dispatchersMap[item.plate];
                        let tGroup = null;
                        carRateGroups.forEach(g => {
                          if ((g.vehicles || []).includes(item.plate)) {
                            tGroup = g;
                          }
                        });

                        return (
                          <tr key={item.key} className="hover:bg-white/80 transition-colors group">
                            <td className="px-4 py-2.5 font-black text-slate-800 uppercase tracking-widest whitespace-nowrap">
                              {isEditing ? (
                                <input
                                  type="text"
                                  value={editCarPlate}
                                  onChange={(e) => setEditCarPlate(e.target.value)}
                                  className="p-1.5 bg-white text-xs rounded-lg border border-emerald-400 shadow-[0_0_0_2px_rgba(16,185,129,0.2)] font-black w-[110px] outline-none uppercase font-mono tracking-widest text-slate-800"
                                />
                              ) : (
                                item.plate
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {disp ? (
                                <span className="inline-block px-2 py-0.5 bg-blue-50 text-blue-700 border border-blue-100 rounded-md text-[9px] font-black uppercase tracking-wider">{disp}</span>
                              ) : (
                                <span className="text-[9px] text-slate-400 uppercase font-black">Нет</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              {tGroup ? (
                                <span className="inline-block px-2 py-0.5 bg-slate-100 text-slate-700 border border-slate-200 rounded-md text-[9px] font-black uppercase tracking-wider">{tGroup.name}</span>
                              ) : (
                                <span className="text-[9px] text-slate-400 uppercase font-black">Нет</span>
                              )}
                            </td>
                            {isWritePermitted && (
                              <td className="px-4 py-2.5 text-right whitespace-nowrap">
                                {isEditing ? (
                                  <div className="flex gap-1.5 justify-end">
                                    <button
                                      onClick={() => handleSaveEditCar(item.key)}
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
                                      onClick={() => handleStartEditCar(item.key, item.plate)}
                                      className="text-indigo-600 bg-indigo-50 hover:bg-indigo-100 p-1.5 rounded-lg transition"
                                      title="Изменить"
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteKnownCar(item.key, item.plate)}
                                      className="text-rose-600 bg-rose-50 hover:bg-rose-100 p-1.5 rounded-lg transition"
                                      title="Удалить"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                )}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {filteredKnownFleet.length === 0 && (
                        <tr>
                          <td colSpan={isWritePermitted ? 4 : 3} className="text-center py-10 text-slate-400 text-[10px] uppercase font-mono font-black tracking-wider">
                            Машины не найдены
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* 2. TARIFF GROUPS (7 cols) */}
            <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-6 border border-slate-200/50 shadow-xl shadow-slate-900/5 xl:col-span-7 flex flex-col">
              <div className="flex flex-col gap-1 pb-4 border-b border-slate-200/60 mb-5">
                <h3 className="text-sm font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-indigo-500/10 flex items-center justify-center">
                    <Wallet className="h-4 w-4 text-indigo-500" />
                  </div>
                  <span>Тарифные Группы (Зарплата)</span>
                </h3>
                <p className="text-[10px] text-slate-400 font-medium ml-9">Определяют ставку за 1 км и размер суточных для привязанных авто</p>
              </div>

              {isWritePermitted && (
                <form onSubmit={handleAddTariff} className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-white/50 backdrop-blur-md p-3.5 rounded-2xl border border-slate-200/80 shadow-sm mb-5">
                  <input
                    type="text"
                    placeholder="Название (0.135)"
                    required
                    value={stName}
                    onChange={(e) => setStName(e.target.value)}
                    className="px-4 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 font-bold text-slate-800 placeholder:text-slate-400 transition"
                  />
                  <input
                    type="number"
                    step="0.001"
                    placeholder="Ставка (€/км)"
                    required
                    value={stRate || ''}
                    onChange={(e) => setStRate(Number(e.target.value))}
                    className="px-4 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 font-black text-slate-800 placeholder:text-slate-400 font-mono transition"
                  />
                  <input
                    type="number"
                    placeholder="Суточные (€/д)"
                    value={stPerDiem || ''}
                    onChange={(e) => setStPerDiem(e.target.value ? Number(e.target.value) : undefined)}
                    className="px-4 py-2.5 bg-white text-xs rounded-xl border border-slate-200 outline-none focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 font-black text-slate-800 placeholder:text-slate-400 font-mono transition"
                  />
                  <button type="submit" className="bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95 py-2.5">
                    Создать
                  </button>
                </form>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-h-[460px] overflow-y-auto pr-2 custom-scrollbar">
                {carRateGroups.map((group) => (
                  <div key={group.id} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col hover:shadow-md transition-shadow">
                    <div className="bg-slate-50/50 p-3 border-b border-slate-100 flex justify-between items-start">
                      <div className="flex flex-col gap-1.5">
                        <span className="font-black text-slate-900 text-xs uppercase tracking-tight">{group.name}</span>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[9px] font-black py-0.5 px-2 bg-white border border-slate-200 rounded-md text-slate-700 shadow-sm">
                            {group.rate} €/км
                          </span>
                          {group.perDiemRate !== undefined && (
                            <span className="font-mono text-[9px] font-black py-0.5 px-2 bg-indigo-50 border border-indigo-100 rounded-md text-indigo-700 shadow-sm">
                              {group.perDiemRate} €/д
                            </span>
                          )}
                        </div>
                      </div>
                      {isWritePermitted && (
                        <button onClick={() => handleDeleteTariff(group.id)} className="text-rose-400 hover:text-rose-600 bg-white border border-rose-100 shadow-sm p-1.5 hover:bg-rose-50 rounded-lg transition">
                          <Trash2 className="h-3.5 w-3.5"/>
                        </button>
                      )}
                    </div>

                    <div className="p-3 flex-1">
                      <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider mb-2 block font-mono">
                        Автомобили ({group.vehicles?.length || 0})
                      </span>
                      <div className="flex flex-wrap gap-2">
                        {(group.vehicles || []).map((v, i) => (
                          <div key={\`\${group.id}-\${i}-\${v}\`} className="bg-slate-50 px-2 py-1 rounded-lg border border-slate-200 text-[10px] font-mono font-black text-slate-700 flex items-center gap-1.5 uppercase shadow-sm">
                            {v}
                            {isWritePermitted && (
                              <button 
                                onClick={() => handleRemoveVehicleFromGroup(group, v)} 
                                className="text-slate-400 hover:text-rose-500 transition-colors w-4 h-4 flex items-center justify-center bg-white rounded-full border border-slate-200 hover:border-rose-200"
                              >
                                <X className="w-2.5 h-2.5"/>
                              </button>
                            )}
                          </div>
                        ))}
                        {addingVehicleGroup?.id === group.id ? (
                          <div className="flex items-center gap-1 bg-white px-1.5 py-1 rounded-lg border border-indigo-300 ring-2 ring-indigo-500/10 shadow-sm">
                            <input
                              type="text"
                              placeholder="АВТО"
                              className="text-[10px] font-mono uppercase font-black outline-none w-16 border-0 p-0 text-indigo-900"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleConfirmAddVehicleToGroup(group, e.currentTarget.value);
                                }
                              }}
                              onBlur={(e) => {
                                if (!e.currentTarget.value.trim()) {
                                  setAddingVehicleGroup(null);
                                }
                              }}
                            />
                            <button
                              onClick={(e) => {
                                const val = e.currentTarget.previousSibling ? (e.currentTarget.previousSibling).value : '';
                                handleConfirmAddVehicleToGroup(group, val);
                              }}
                              className="text-emerald-600 bg-emerald-50 hover:bg-emerald-100 w-4 h-4 rounded flex items-center justify-center"
                            >
                              <Check className="w-2.5 h-2.5"/>
                            </button>
                            <button
                              onClick={() => setAddingVehicleGroup(null)}
                              className="text-slate-400 bg-slate-100 hover:bg-slate-200 w-4 h-4 rounded flex items-center justify-center"
                            >
                              <X className="w-2.5 h-2.5"/>
                            </button>
                          </div>
                        ) : (
                          isWritePermitted && (
                            <button 
                              onClick={() => setAddingVehicleGroup(group)}
                              className="bg-white border border-dashed border-slate-300 px-2 py-1 rounded-lg text-[10px] font-mono font-bold text-slate-500 hover:text-indigo-600 hover:border-indigo-300 hover:bg-indigo-50 transition cursor-pointer shadow-sm flex items-center gap-1"
                            >
                              <Plus className="w-3 h-3"/> добавить
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {!carRateGroups.length && (
                  <div className="col-span-1 sm:col-span-2 text-center py-12 text-slate-400 text-xs font-mono font-black uppercase tracking-wider bg-white/50 border border-slate-200/60 rounded-3xl border-dashed">
                    Группы не созданы
                  </div>
                )}
              </div>
            </div>
          </div>
`;

content = content.substring(0, startIndex) + newBlocks + '\n          ' + content.substring(endIndex);

fs.writeFileSync('src/components/modules/SettingsModule.tsx', content);

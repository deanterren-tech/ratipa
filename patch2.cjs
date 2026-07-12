const fs = require('fs');
let content = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

const replacement = `
    const profitPerDay = Math.round(profitFact / (getTripDays() || 1));
    const profitPerDayPlan = Math.round(profit / (getTripDays() || 1));

    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
        <div className="bg-slate-50 rounded-[2rem] w-full max-w-[1400px] shadow-2xl overflow-hidden flex flex-col relative my-auto">
          
          {/* Header */}
          <div className="bg-white px-6 py-4 flex flex-col md:flex-row md:items-center justify-between sticky top-0 z-10 border-b border-slate-200/60 shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
            <div className="flex flex-col">
              <div className="flex items-center gap-3">
                <div className="bg-blue-50 text-blue-600 p-2 rounded-xl border border-blue-100">
                  <Calculator className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-black text-slate-800 uppercase tracking-tight">
                  {editingTripId ? "Редактирование плана" : "Новый план"}
                </h2>
              </div>
              <div className="flex flex-wrap gap-4 text-[10px] font-bold text-slate-500 uppercase tracking-wider ml-[3.25rem] mt-1">
                <span className="text-blue-500">Авто: {carNumber || "—"}</span>
                <span>Направление: {direction || "—"}</span>
                <span>Диспетчер: {dispatcher || "—"}</span>
                <span>Сроки: {dateStart ? new Date(dateStart).toLocaleDateString('ru-RU') : "—"} — {dateEnd ? new Date(dateEnd).toLocaleDateString('ru-RU') : "—"}</span>
              </div>
            </div>

            <div className="flex items-center gap-6 mt-4 md:mt-0">
              <div className="flex bg-slate-100 rounded-full p-1 gap-1 border border-slate-200/50">
                <button
                  type="button"
                  onClick={() => setModalTab("main")}
                  className={\`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-wider transition \${modalTab === "main" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-800"}\`}
                >
                  Форма
                </button>
                <button
                  type="button"
                  onClick={() => setModalTab("potential")}
                  className={\`px-5 py-2 rounded-full text-[10px] font-black uppercase tracking-wider transition \${modalTab === "potential" ? "bg-white shadow-sm text-purple-600" : "text-slate-500 hover:text-slate-800"}\`}
                >
                  Потенциал. грузы
                  {potentialLoads.length > 0 && (
                    <span className="ml-1 bg-purple-500 text-white rounded-full px-1.5 py-0.5 text-[8px]">
                      {potentialLoads.length}
                    </span>
                  )}
                </button>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-800 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto custom-scrollbar max-h-[80vh]">
            {modalTab === "main" ? (
              <>
                <div className="grid grid-cols-1 xl:grid-cols-[1fr_400px] gap-6">
                  {/* Основные реквизиты */}
                  <div className="bg-white rounded-[1.5rem] p-6 border border-slate-200/60 shadow-sm flex flex-col">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-blue-50 text-blue-500"><FileText className="w-4 h-4"/></div> 
                      Основные реквизиты
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Автомобиль</label>
                        <input
                          type="text"
                          list="saved-cars-list"
                          placeholder="АХ 1234-7"
                          value={carNumber}
                          onChange={(e) => handleCarNumberChange(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold uppercase outline-none focus:border-blue-500 transition"
                        />
                        <datalist id="saved-cars-list">
                          {savedCars.map((c) => (
                            <option key={c} value={c} />
                          ))}
                        </datalist>
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Направление</label>
                        <select
                          value={direction}
                          onChange={(e) => handleDirChange(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 transition appearance-none"
                        >
                          {Object.keys(directions).map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Диспетчер</label>
                        <select
                          value={dispatcher}
                          onChange={(e) => setDispatcher(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 transition appearance-none"
                        >
                          <option value="">Не выбран</option>
                          {dispatchers.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-blue-500 mb-1.5 block">Дата старта</label>
                        <input
                          type="date"
                          value={dateStart}
                          onChange={(e) => setDateStart(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Дата финиша</label>
                        <input
                          type="date"
                          value={dateEnd}
                          onChange={(e) => setDateEnd(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 transition"
                        />
                      </div>
                    </div>
                  </div>

                  {/* AI Assistant */}
                  <div className="bg-white rounded-[1.5rem] p-6 border border-slate-200/60 shadow-sm flex flex-col">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-slate-50 text-slate-500"><Bot className="w-4 h-4"/></div> 
                      AI-Ассистент маршрута
                    </h3>
                    <p className="text-[10px] text-slate-400 mb-2">Вставьте текст (напр: Минск — Стамбул, 4300 евро, 2450 км, паром 300)</p>
                    <div className="flex gap-2 bg-slate-50 p-1.5 rounded-xl border border-slate-200 focus-within:border-slate-300 transition h-12">
                      <input 
                        value={aiRouteInput}
                        onChange={(e) => setAiRouteInput(e.target.value)}
                        placeholder="Вставить текст для автоматического распознавания..."
                        onKeyDown={(e) => {
                          if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                            e.preventDefault();
                            processAiRoute();
                          }
                        }}
                        className="flex-1 bg-transparent px-3 text-xs font-medium outline-none placeholder-slate-400"
                      />
                      <button 
                        type="button"
                        onClick={processAiRoute}
                        disabled={isAiProcessing}
                        className={\`text-white px-5 rounded-lg font-black text-[10px] uppercase tracking-wider transition \${isAiProcessing ? "bg-slate-400" : "bg-[#1E293B] hover:bg-[#0F172A]"}\`}
                      >
                        {isAiProcessing ? "..." : "Распознать"}
                      </button>
                    </div>
                    {aiRouteFeedback && (
                      <span className="text-[10px] font-black text-blue-600 mt-2 block">
                        {aiRouteFeedback}
                      </span>
                    )}
                  </div>
                </div>

                {/* Плечи маршрута */}
                <div className="bg-white rounded-[1.5rem] p-6 border border-slate-200/60 shadow-sm">
                  <div className="flex justify-between items-center mb-6">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-emerald-50 text-emerald-500"><MapPin className="w-4 h-4"/></div> 
                      Плечи маршрута
                    </h3>
                    <span className="text-[10px] text-blue-500 font-bold hover:underline cursor-pointer">Маршрутная сетка</span>
                  </div>

                  <div className="block lg:hidden text-[10px] font-black text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 mb-3 text-center uppercase tracking-wider select-none">
                    <span className="inline-block text-blue-500 mr-1.5 font-sans">↔</span> Таблица прокручивается вправо
                  </div>

                  <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
                    <table className="w-full min-w-[950px] border-collapse relative">
                      <thead>
                        <tr>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-center w-12">Акт.</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left w-8">#</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Откуда</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Куда</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Км</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Доезд (км)</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Фрахт €</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Инфо ставка (Доп)</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Паром € (Доп)</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-left">Коэфф.</th>
                          <th className="pb-3 text-[9px] font-black uppercase text-slate-400 tracking-wider text-right"></th>
                        </tr>
                      </thead>
                      <tbody className="space-y-2">
                        {legs.map((leg, idx) => (
                          <tr key={idx}>
                            <td className="py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => setActiveLegIndex(idx === activeLegIndex ? undefined : idx)}
                                className={\`w-5 h-5 rounded flex items-center justify-center border transition mx-auto cursor-pointer \${activeLegIndex === idx ? "bg-blue-500 border-blue-500 text-white" : "bg-white border-slate-300 text-transparent"}\`}
                              >
                                <Check className="w-3 h-3" />
                              </button>
                            </td>
                            <td className="py-1.5 text-[10px] font-black text-slate-400">{idx + 1}</td>
                            <td className="py-1.5 pr-2">
                              <input
                                list="cities-db-pl"
                                value={leg.from}
                                onChange={(e) => updateLeg(idx, { from: e.target.value })}
                                onBlur={() => checkLegDistance(idx)}
                                className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                list="cities-db-pl"
                                value={leg.to}
                                onChange={(e) => updateLeg(idx, { to: e.target.value })}
                                onBlur={() => checkLegDistance(idx)}
                                className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2 relative">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.km || ""}
                                onChange={(e) => updateLeg(idx, { km: Number(e.target.value) })}
                                className="w-full text-left pl-3 pr-8 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 transition"
                              />
                              <button
                                type="button"
                                onClick={() => openMapRouteModal(idx, leg.from, leg.to, false)}
                                className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 transition"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                              </button>
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.emptyRunKm || ""}
                                onChange={(e) => updateLeg(idx, { emptyRunKm: Number(e.target.value) })}
                                className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.rate || ""}
                                onChange={(e) => updateLeg(idx, { rate: Number(e.target.value) })}
                                className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <div className="flex bg-white border border-slate-200 rounded-lg overflow-hidden focus-within:border-blue-500 transition">
                                <input
                                  type="text"
                                  value={leg.referenceRate || ""}
                                  onChange={(e) => updateLeg(idx, { referenceRate: e.target.value })}
                                  className="w-full px-3 py-2 bg-transparent text-xs font-bold outline-none"
                                />
                                <select
                                  value={leg.referenceCurrency || ""}
                                  onChange={(e) => updateLeg(idx, { referenceCurrency: e.target.value })}
                                  className="bg-transparent border-l border-slate-200 text-slate-500 text-[10px] font-bold outline-none px-1 cursor-pointer"
                                >
                                  <option value=""></option>
                                  {currencies.map((c) => (
                                    <option key={c.id} value={c.code}>{c.code}</option>
                                  ))}
                                </select>
                              </div>
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                onFocus={(e) => e.target.select()}
                                value={leg.ferry || ""}
                                onChange={(e) => updateLeg(idx, { ferry: Number(e.target.value) })}
                                className="w-full text-left px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 transition"
                              />
                            </td>
                            <td className="py-1.5 pr-2">
                              <input
                                type="number"
                                step="0.01"
                                value={leg.coeff}
                                onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold outline-none focus:border-blue-500 transition"
                              />
                            </td>
                            <td className="py-1.5 text-right whitespace-nowrap space-x-1">
                              <button
                                type="button"
                                onClick={() => addLeg(idx)}
                                className="w-6 h-6 inline-flex items-center justify-center text-slate-400 hover:text-slate-800 transition"
                              >
                                <Plus className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeLeg(idx)}
                                disabled={legs.length <= 1}
                                className="w-6 h-6 inline-flex items-center justify-center text-slate-400 hover:text-rose-500 transition disabled:opacity-30"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <datalist id="cities-db-pl">
                    {Array.from(new Set(distances.flatMap((d) => [d.from, d.to]))).map((c) => c && <option key={c} value={c} />)}
                  </datalist>
                </div>

                {/* Financial Params & Comment */}
                <div className="bg-white rounded-[1.5rem] p-6 border border-slate-200/60 shadow-sm flex flex-col gap-6">
                  <div>
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-3 mb-6">
                      <div className="p-2 rounded-lg bg-orange-50 text-orange-500"><CircleDollarSign className="w-4 h-4"/></div> 
                      Финансовые параметры
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Доп расходы €</label>
                        <input
                          type="number"
                          value={extraExpense || ""}
                          onChange={(e) => setExtraExpense(Number(e.target.value))}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Коммент расходов</label>
                        <input
                          type="text"
                          value={extraExpenseNote}
                          onChange={(e) => setExtraExpenseNote(e.target.value)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1.5 block">Факт км</label>
                        <input
                          type="number"
                          placeholder="Введите факт км"
                          value={factKm || ""}
                          onChange={(e) => setFactKm(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-2.5 text-sm font-bold outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-2 block">Цвет плашки рейса</label>
                        <div className="flex gap-2">
                          {[
                            "bg-slate-200",
                            "bg-blue-300",
                            "bg-blue-500",
                            "bg-[#70FC8E]",
                            "bg-amber-300",
                            "bg-rose-300",
                            "bg-purple-500",
                            "bg-slate-800",
                          ].map((cc) => (
                            <button
                              type="button"
                              key={cc}
                              onClick={() => setStripColor(cc)}
                              className={\`w-6 h-6 rounded-full border-2 \${stripColor === cc ? "border-slate-800 scale-110" : "border-transparent"} \${cc} transition\`}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-slate-100 pt-6">
                    <h3 className="text-[11px] font-black uppercase tracking-widest text-slate-800 flex items-center gap-3 mb-4">
                      <div className="p-2 rounded-lg bg-slate-50 text-slate-500"><MessageSquare className="w-4 h-4"/></div> 
                      Комментарий к рейсу
                    </h3>
                    <input
                      type="text"
                      value={tripNote}
                      onChange={(e) => setTripNote(e.target.value)}
                      placeholder="Введите дополнительные примечания к рейсу..."
                      className="w-full bg-white border border-slate-200 text-slate-800 rounded-xl px-4 py-3 text-sm font-medium outline-none focus:border-blue-500 transition"
                    />
                  </div>
                </div>

                {/* Dark Finance Dashboard */}
                <div className="bg-[#111625] rounded-[1.5rem] p-6 text-white shadow-lg">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                    <div className="border-l-[3px] border-[#70FC8E] pl-5 flex flex-col">
                      <span className="text-[9px] uppercase tracking-widest text-slate-400 mb-1.5">Прибыль общая</span>
                      <span className="text-4xl sm:text-5xl font-black text-[#70FC8E] leading-none mb-4">
                        {Math.round(profitFact)} <span className="text-xl sm:text-2xl text-slate-400 font-medium">€</span>
                      </span>
                      <div className="flex justify-between items-center text-[10px] border-t border-slate-800/50 pt-2 text-slate-500 mt-auto">
                        <span>План:</span>
                        <span>{Math.round(profit)} €</span>
                      </div>
                    </div>
                    
                    <div className="border-l-[3px] border-[#418AF2] pl-5 flex flex-col">
                      <span className="text-[9px] uppercase tracking-widest text-slate-400 mb-1.5">Прибыль в день</span>
                      <span className="text-4xl sm:text-5xl font-black text-white leading-none mb-4">
                        {profitPerDay} <span className="text-xl sm:text-2xl text-slate-400 font-medium">€</span>
                      </span>
                      <div className="flex justify-between items-center text-[10px] border-t border-slate-800/50 pt-2 text-slate-500 mt-auto">
                        <span>План:</span>
                        <span>{profitPerDayPlan} €/дн</span>
                      </div>
                    </div>
                    
                    <div className="border-l-[3px] border-orange-500 pl-5 flex flex-col justify-center">
                      <span className="text-[9px] uppercase tracking-widest text-slate-400 mb-1.5">Количество дней</span>
                      <span className="text-4xl sm:text-5xl font-black text-white leading-none">
                        {getTripDays()} <span className="text-xl sm:text-2xl text-slate-400 font-medium">дн.</span>
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 bg-[#161D30] rounded-[1rem] p-5">
                    <div>
                      <span className="text-[9px] uppercase tracking-widest text-slate-400 block mb-1">План км</span>
                      <span className="text-lg font-black text-white">{Math.round(totalKm)} км</span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-widest text-slate-400 block mb-1">Фрахт</span>
                      <span className="text-lg font-black text-[#418AF2]">{Math.round(totalFreight)} €</span>
                    </div>
                    <div>
                      <span className="text-[9px] uppercase tracking-widest text-slate-400 block mb-1">Расходы</span>
                      <span className="text-lg font-black text-orange-400">{Math.round(totalExpenses)} €</span>
                    </div>
                  </div>
                </div>

                {/* Footer Buttons */}
                <div className="flex flex-wrap justify-end gap-3 mt-2">
                  {isEditing && (
                    <>
                      <button
                        type="button"
                        onClick={deleteCurrentTrip}
                        className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-rose-600 bg-rose-50 hover:bg-rose-100 flex items-center gap-2 transition"
                      >
                        <Trash2 className="w-4 h-4"/> Удалить
                      </button>
                      <button
                        type="button"
                        onClick={archiveCurrentTrip}
                        className="px-6 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-amber-700 bg-amber-50 hover:bg-amber-100 flex items-center gap-2 transition"
                      >
                        <Archive className="w-4 h-4"/> В архив
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    onClick={saveCurrentTrip}
                    disabled={isSubmitting}
                    className="px-8 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-wider text-white bg-blue-600 hover:bg-blue-500 flex items-center gap-2 transition shadow-md shadow-blue-500/20 disabled:opacity-50"
                  >
                    <Save className="w-4 h-4"/> Сохранить
                  </button>
                </div>
              </>
            ) : modalTab === "potential" ? (
`;

// we need to replace from `return (` after `const renderCurrentFormModal = () => {`
// to `) : modalTab === "potential" ? (`

const startMarker = `const renderCurrentFormModal = () => {`;
const idxRender = content.indexOf(startMarker);
if (idxRender === -1) {
    console.error("Could not find renderCurrentFormModal");
    process.exit(1);
}

const returnMarker = `    return (`;
const idxReturn = content.indexOf(returnMarker, idxRender);

const endMarker = `) : modalTab === "potential" ? (`
const idxEnd = content.indexOf(endMarker, idxReturn);

if (idxReturn !== -1 && idxEnd !== -1) {
    const before = content.slice(0, idxReturn);
    // Note: the replacement includes `return (` up to `) : modalTab === "potential" ? (`
    const after = content.slice(idxEnd + endMarker.length);
    content = before + replacement + after;
    fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', content);
    console.log("Replaced successfully!");
} else {
    console.error("Could not find boundaries.");
}

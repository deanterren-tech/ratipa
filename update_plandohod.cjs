const fs = require('fs');
let code = fs.readFileSync('src/components/modules/PlanDohodModule.tsx', 'utf-8');

// 1. Remove the "Swipe Help Badge"
code = code.replace(
  /<div className="block lg:hidden text-\[10px\] font-semibold text-slate-500 bg-slate-100 border border-slate-200 rounded-xl px-4 py-2 mb-3 text-center uppercase tracking-wider select-none">[\s\S]*?<\/div>/g,
  ''
);

// 2. Hide the table on lg screens, and add mobile cards view
code = code.replace(
  /<div className="w-full overflow-x-auto pb-4 custom-scrollbar">/g,
  '<div className="hidden lg:block w-full overflow-x-auto pb-4 custom-scrollbar">'
);

const mobileCardsStr = `
                  {/* Mobile Cards View for Legs */}
                  <div className="block lg:hidden space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-1 pb-4">
                    {legs.map((leg, idx) => (
                      <div key={idx} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-4 relative shadow-sm">
                        <div className="flex justify-between items-center pb-2 border-b border-slate-100">
                          <div className="flex items-center gap-3">
                            <span className="text-xs font-black text-slate-500 bg-slate-100 px-2 py-1 rounded-md">#{idx + 1}</span>
                            <button
                              type="button"
                              onClick={() => setActiveLegIndex(idx === activeLegIndex ? undefined : idx)}
                              className={\`w-6 h-6 rounded flex items-center justify-center border transition cursor-pointer \${activeLegIndex === idx ? "bg-slate-900 border-slate-900 text-white" : "bg-white border-slate-300 text-transparent"}\`}
                            >
                              <Check className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => addLeg(idx)}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition cursor-pointer"
                            >
                              <Plus className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => removeLeg(idx)}
                              disabled={legs.length <= 1}
                              className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 transition disabled:opacity-30 cursor-pointer"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Откуда</span>
                            <input
                              list="cities-db-pl"
                              value={leg.from}
                              onChange={(e) => updateLeg(idx, { from: e.target.value })}
                              onBlur={() => checkLegDistance(idx)}
                              className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Куда</span>
                            <input
                              list="cities-db-pl"
                              value={leg.to}
                              onChange={(e) => updateLeg(idx, { to: e.target.value })}
                              onBlur={() => checkLegDistance(idx)}
                              className="w-full px-3 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5 relative">
                            <span className="text-[10px] uppercase font-black text-slate-400">Км</span>
                            <input
                              type="number"
                              value={leg.km || ""}
                              onChange={(e) => updateLeg(idx, { km: Number(e.target.value) })}
                              className="w-full pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                            <button
                              type="button"
                              onClick={() => openMapRouteModal(idx, leg.from, leg.to, false)}
                              className="absolute right-2 bottom-1.5 text-slate-400 hover:text-slate-600 p-1"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <div className="flex flex-col gap-1.5 relative">
                            <span className="text-[10px] uppercase font-black text-slate-400">Доезд (км)</span>
                            <input
                              type="number"
                              value={leg.emptyRun || ""}
                              onChange={(e) => updateLeg(idx, { emptyRun: Number(e.target.value) })}
                              className="w-full pl-3 pr-8 py-2 bg-slate-50 hover:bg-slate-100/50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums text-slate-800 outline-none focus:bg-white focus:border-[#3765F6] transition shadow-sm"
                            />
                            <button
                              type="button"
                              onClick={() => openMapRouteModal(idx, leg.from, leg.to, true)}
                              className="absolute right-2 bottom-1.5 text-slate-400 hover:text-slate-600 p-1"
                            >
                              <MapPin className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Фрахт</span>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={leg.freight || ""}
                                onChange={(e) => updateLeg(idx, { freight: Number(e.target.value) })}
                                className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                              />
                              <select
                                value={leg.freightCurrency}
                                onChange={(e) => updateLeg(idx, { freightCurrency: e.target.value })}
                                className="w-16 px-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold"
                              >
                                {currencies.map((c) => (
                                  <option key={c.id} value={c.code}>{c.code}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Инфо ставка</span>
                            <div className="flex gap-1">
                              <input
                                type="number"
                                value={leg.infoRate || ""}
                                onChange={(e) => updateLeg(idx, { infoRate: Number(e.target.value) })}
                                className="w-full px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                              />
                              <select
                                value={leg.infoRateCurrency || "EUR"}
                                onChange={(e) => updateLeg(idx, { infoRateCurrency: e.target.value })}
                                className="w-16 px-1 bg-slate-100 border border-slate-200 rounded-lg text-[10px] font-bold"
                              >
                                <option value=""></option>
                                {currencies.map((c) => (
                                  <option key={c.id} value={c.code}>{c.code}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Паром €</span>
                            <input
                              type="number"
                              value={leg.ferry || ""}
                              onChange={(e) => updateLeg(idx, { ferry: Number(e.target.value) })}
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                            />
                          </div>
                          <div className="flex flex-col gap-1.5">
                            <span className="text-[10px] uppercase font-black text-slate-400">Коэфф.</span>
                            <input
                              type="number"
                              step="0.01"
                              value={leg.coeff}
                              onChange={(e) => updateLeg(idx, { coeff: Number(e.target.value) })}
                              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold font-mono tabular-nums outline-none"
                            />
                          </div>
                        </div>

                      </div>
                    ))}
                  </div>
`;

code = code.replace(
  /<\/table>\s*<\/div>\s*<datalist id="cities-db-pl">/,
  '</table>\n                  </div>\n' + mobileCardsStr + '\n                  <datalist id="cities-db-pl">'
);

fs.writeFileSync('src/components/modules/PlanDohodModule.tsx', code);

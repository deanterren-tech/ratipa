import React, { useState } from 'react';
import { UserProfile } from '../../../types';
import { Sparkles, X } from 'lucide-react';
import { useFirebase, database } from '../../../firebase';
import { ref, push, set, update } from 'firebase/database';

interface DozvolaAIAssistantProps {
    user: UserProfile;
    dozvolsData: Record<string, any>;
    customTypesOrder: string[];
    customTypes: Record<string, any>;
    knownFleetCars: Record<string, any>;
}

export default function DozvolaAIAssistant({ user, dozvolsData, customTypesOrder, customTypes, knownFleetCars }: DozvolaAIAssistantProps) {
    const [rawText, setRawText] = useState('');
    const [tempBatchItems, setTempBatchItems] = useState<any[]>([]);

    const aliasesMap: Record<string, string> = {
        "турцияа": "TR A", "турцияa": "TR A",
        "турцияб": "TR B", "турцияb": "TR B",
        "уз2": "UZ 2", "уз3": "UZ 3", "уз4": "UZ 4"
    };

    const normalizeAIText = (text: string) => {
        return String(text || '').toLowerCase().replace(/ё/g, 'е').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
    };

    const getPermitTypeNamesForAI = () => {
        const typeNames = customTypesOrder.map(id => customTypes[id]?.name).filter(Boolean);
        return [...new Set([...typeNames, "RUS", "TR B", "TR A", "UZ 4", "UZ 3", "UZ 2", "GE", "AM3", "KZ3", "CHN 2", "CHN 3"])];
    };

    const detectPermitTypeFromAI = (lineForParsing: string, fallbackType: string) => {
        const normalizedLine = normalizeAIText(lineForParsing).replace(/\s+/g, '');
        for (const [alias, realName] of Object.entries(aliasesMap)) {
            if (normalizedLine.includes(alias)) return realName;
        }

        const semanticAliases: Record<string, string> = {
            "турция а": "TR A", "турция а первая": "TR A", "турция 1": "TR A",
            "турция б": "TR B", "турция вторая": "TR B", "турция 2": "TR B",
            "россия": "RUS", "рус": "RUS", "рф": "RUS",
            "узбекистан 2": "UZ 2", "узбекистан 3": "UZ 3", "узбекистан 4": "UZ 4",
            "китай 2": "CHN 2", "китай 3": "CHN 3", "грузия": "GE"
        };
        const normalizedSpaced = normalizeAIText(lineForParsing);
        for (const [alias, realName] of Object.entries(semanticAliases)) {
            if (normalizedSpaced.includes(alias)) return realName;
        }

        for (let typeName of getPermitTypeNamesForAI()) {
            const compactType = normalizeAIText(typeName).replace(/\s+/g, '');
            if (compactType && normalizedLine.includes(compactType)) return typeName;
            const spacedRegex = new RegExp(typeName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*'), 'i');
            if (spacedRegex.test(lineForParsing)) return typeName;
        }
        return fallbackType || "RUS";
    };

    const detectStatusFromAI = (lineForParsing: string, existingStatus: string, foundCar: string) => {
        const text = normalizeAIText(lineForParsing);
        let status = existingStatus || (foundCar ? "hand" : "office");

        if (/(аннулирован|аннулировать|ошибка|списать|списан|брак)/i.test(text)) return { status: "expired", clearCar: false };
        if (/(транспортн|инспекц|реестр|возврат).{0,25}(сдан|сдали|сдать|возврат)|сдан.{0,25}(транспортн|инспекц)/i.test(text)) return { status: "used", clearCar: true };
        if (/(сдан[ао]?|сдали|сдать|вернули|возврат).{0,18}(на|в)?\s*офис|сдан\s+оригинал|оригинал\s+сдан|использован|закрыт/i.test(text)) return { status: "office_return", clearCar: true };
        if (/(выдан|выдать|рейс|отдан|у\s+водителя|на\s+машину|на\s+\d{4})/i.test(text)) return { status: "hand", clearCar: false };
        if (/(принят|получен|пришел|поступил|в\s+офисе|лежит\s+в\s+офисе)/i.test(text)) return { status: "office", clearCar: true };

        return { status, clearCar: false };
    };

    const handleProcess = () => {
        if (!rawText.trim()) return;
        const rawLines = rawText.split(/\n/);
        const newBatchItems: any[] = [];

        rawLines.forEach(line => {
            const cleanLine = line.trim(); if(cleanLine.length < 3) return;
            let comment = "";
            const commentRegex = cleanLine.match(/(?:комментарий|коммент|пометка|примечание):\s*(.*)/i);
            if (commentRegex) comment = commentRegex[1].trim();
            let lineForParsing = cleanLine.split(/(?:комментарий|коммент|пометка|примечание):/i)[0];

            const recognizedTypeForLine = detectPermitTypeFromAI(lineForParsing, "RUS");
            let numberCandidates: string[] = [];
            const commaPartMatch = lineForParsing.match(/(?:^|[,;\s])(?:rus|tr\s*a|tr\s*b|uz\s*\d|uz|ge|am\d|kz\d|chn\s*\d|китай\s*\d|россия|турция|узбекистан)[^:]*?[,:\s]+(.+)/i);
            const numbersText = commaPartMatch ? commaPartMatch[1] : lineForParsing;
            numberCandidates = (numbersText.match(/\b\d{3,8}\b/g) || [])
                .filter(n => !/^20\d{2}$/.test(n))
                .filter(n => !Object.keys(knownFleetCars).some(car => car.replace(/\D/g, '').includes(n) && n.length === 4));

            const directMatch = lineForParsing.match(/(?:rus|tr a|tr b|uz \d|uz|ge|am\d|kz\d|chn \d)\s*(\d{3,8})/i);
            if (directMatch && directMatch[1] && !numberCandidates.includes(directMatch[1])) numberCandidates.unshift(directMatch[1]);
            numberCandidates = [...new Set(numberCandidates)];
            if(!numberCandidates.length) return;

            let foundCar = "";
            const fullCarMatch = lineForParsing.toUpperCase().match(/\b[A-ZА-Я]{1,3}\s?\d{3,5}[-\s]?\d\b/);
            if (fullCarMatch) foundCar = fullCarMatch[0].replace(/\s+/g, ' ').trim();
            if (!foundCar) {
                const carMatches = lineForParsing.match(/\b\d{4}\b/g);
                if (carMatches) {
                    let candidate = carMatches.find(digits => !numberCandidates.includes(digits));
                    if (candidate) {
                        const fullCarFromFleet = Object.keys(knownFleetCars).find(car => car.includes(candidate));
                        foundCar = fullCarFromFleet ? fullCarFromFleet : candidate;
                    }
                }
            }

            numberCandidates.forEach(number => {
                const existingDozvol = Object.values(dozvolsData).find((d: any) => d.number === number);
                let mode = existingDozvol ? "update" : "create";
                let recognizedType = detectPermitTypeFromAI(lineForParsing, existingDozvol ? existingDozvol.type : recognizedTypeForLine); 

                let statusInfo = detectStatusFromAI(lineForParsing, existingDozvol ? existingDozvol.status : "", foundCar);
                let status = statusInfo.status;
                let itemCar = statusInfo.clearCar ? "" : foundCar;

                let isCopy = false;
                if (recognizedType === 'CHN 2' || recognizedType === 'CHN 3') {
                    isCopy = existingDozvol ? existingDozvol.isCopy : false;
                    if (/копи|коп|скан|фото|сбросил/i.test(lineForParsing)) { if (!/нет копии|без копии/i.test(lineForParsing)) isCopy = true; }
                    if (/нет копии|без копии/i.test(lineForParsing)) isCopy = false;
                }

                newBatchItems.push({
                    id: existingDozvol ? existingDozvol.id : null, mode, type: recognizedType, number, status, isCopy, car: itemCar || (existingDozvol ? existingDozvol.car : ""), comment: comment || (existingDozvol ? (existingDozvol.comment || "") : "")
                });
            });
        });
        setTempBatchItems(newBatchItems);
    };

    const getStatusLabel = (status: string) => {
        const map: any = { office: 'В офисе', hand: 'В рейсе / на руках', office_return: 'Сдан в офис', used: 'Сдан в транспортную инспекцию', expired: 'Аннулирован' };
        return map[status] || status || '—';
    };

    const logAction = (type: string, number: string, action: string, meta: string) => {
        if (!useFirebase) return;
        const logist = localStorage.getItem('ratipa_auth_user') || "Система";
        push(ref(database, 'dozvolsHistoryV4'), {
            time: new Date().toLocaleString("ru-RU"),
            logist,
            doc: `${type} №${number}`,
            action,
            meta
        });
    };

    const verifyOrCreateCar = async (carNum: string) => {
        if (!carNum || carNum.trim() === "") return;
        const cleanCar = carNum.trim().toUpperCase();
        if (knownFleetCars[cleanCar]) return;
        if (useFirebase) set(ref(database, 'knownFleetCars/' + cleanCar), true);
    };

    const saveAllPreviewedDozvols = async () => {
        for(let item of tempBatchItems) {
            if(!item.number) continue; 
            if(item.car) await verifyOrCreateCar(item.car);
            
            const isChina = (item.type === 'CHN 2' || item.type === 'CHN 3');
            if (!isChina) item.isCopy = false;

            if(item.mode === 'update' && item.id) {
                const old = dozvolsData[item.id] || {};
                let diffs = [];
                if(old.car !== item.car) diffs.push(`Автомобиль: [${old.car||'—'}] ➔ [${item.car||'—'}]`);
                if(old.status !== item.status) diffs.push(`Статус: [${getStatusLabel(old.status)}] ➔ [${getStatusLabel(item.status)}]`);
                let logMsg = diffs.length > 0 ? diffs.join(' | ') : "Обновление параметров через ИИ";
                
                if (useFirebase) {
                    update(ref(database, `dozvolsRegistryV4/${item.id}`), { type: item.type, number: item.number, status: item.status, isCopy: item.isCopy, car: item.car, comment: item.comment || "" });
                    logAction(item.type, item.number, "Обновление через ИИ-помощник", logMsg);
                }
            } else {
                if (useFirebase) {
                    const newKey = push(ref(database, 'dozvolsRegistryV4')).key;
                    if (newKey) {
                        set(ref(database, 'dozvolsRegistryV4/' + newKey), { id: newKey, type: item.type, number: item.number, issueDate: new Date().toISOString().split('T')[0], status: item.status, isCopy: item.isCopy, car: item.car, comment: item.comment || "" });
                        logAction(item.type, item.number, "Внесение через ИИ-помощник", `Статус: ${getStatusLabel(item.status)}`);
                    }
                }
            }
        }
        setTempBatchItems([]);
        setRawText('');
    };

    return (
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col gap-4 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-4 opacity-5 pointer-events-none">
                <Sparkles className="w-24 h-24 text-blue-500" />
            </div>
            
            <div className="flex justify-between items-center z-10">
                <h3 className="text-sm font-black uppercase text-slate-800 tracking-tight flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-blue-500" /> ИИ-Помощник (разбор номеров)
                </h3>
            </div>
            
            <div className="z-10">
                <textarea 
                    value={rawText}
                    onChange={(e) => setRawText(e.target.value)}
                    placeholder="Вставьте сюда текст. Система разберет строки вида:&#10;• бланк RUS 130520 выдан в рейс на AB 9271-7 комментарий: отправлен к Виждан&#10;• CHN 2, 4175, 3467, 3133 копии сданы"
                    className="w-full h-24 p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:bg-white focus:border-blue-300 resize-none font-mono leading-relaxed"
                />
            </div>
            
            <div className="flex justify-end z-10">
                <button 
                    onClick={handleProcess}
                    className="bg-slate-950 hover:bg-slate-800 text-white px-5 py-2.5 rounded-xl text-xs font-black uppercase tracking-wide transition shadow-sm cursor-pointer"
                >
                    Распознать текст ⚡
                </button>
            </div>

            {tempBatchItems.length > 0 && (
                <div className="mt-4 pt-4 border-t-2 border-dashed border-slate-200/80 z-10">
                    <div className="text-[13px] font-black text-emerald-700 mb-3 flex justify-between items-center">
                        <span>📋 ПОДТВЕРЖДЕНИЕ ОПЕРАЦИЙ:</span>
                        <button 
                            onClick={() => setTempBatchItems([])}
                            className="bg-rose-50 text-rose-500 hover:bg-rose-100 px-3 py-1.5 rounded-lg text-[10px] uppercase cursor-pointer"
                        >
                            Сбросить ✕
                        </button>
                    </div>
                    
                    <div className="overflow-x-auto bg-white rounded-xl border border-slate-200/50 p-1.5 shadow-sm">
                        <table className="w-full text-left border-collapse min-w-[700px]">
                            <thead className="bg-slate-50">
                                <tr>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Действие ИИ</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Вид дозвола</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Номер бланка</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Статус</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Привязка к авто</th>
                                    <th className="p-2 text-[10px] uppercase font-black text-slate-400">Комментарий</th>
                                    <th className="p-2 w-8"></th>
                                </tr>
                            </thead>
                            <tbody className="text-xs font-semibold">
                                {tempBatchItems.map((item, index) => {
                                    const allTypes = [...new Set([...Object.values(customTypes).map((t:any) => t.name), item.type])];
                                    
                                    return (
                                        <tr key={index} className="border-t border-slate-100 hover:bg-slate-50/50">
                                            <td className="p-2 text-slate-600">{item.mode === 'update' ? '🔄 Обновить' : '📥 Новый'}</td>
                                            <td className="p-2">
                                                <select 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.type}
                                                    onChange={(e) => {
                                                        const newArr = [...tempBatchItems];
                                                        newArr[index].type = e.target.value;
                                                        setTempBatchItems(newArr);
                                                    }}
                                                >
                                                    {allTypes.map(t => <option key={t} value={t}>{t}</option>)}
                                                </select>
                                            </td>
                                            <td className="p-2">
                                                <input 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.number}
                                                    onChange={e => {
                                                        const newArr = [...tempBatchItems];
                                                        newArr[index].number = e.target.value.trim();
                                                        setTempBatchItems(newArr);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-2">
                                                <select 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.status}
                                                    onChange={(e) => {
                                                        const newArr = [...tempBatchItems];
                                                        newArr[index].status = e.target.value;
                                                        setTempBatchItems(newArr);
                                                    }}
                                                >
                                                    <option value="office">В офисе</option>
                                                    <option value="hand">В рейсе</option>
                                                    <option value="office_return">Сдан в офис</option>
                                                    <option value="used">Сдан в транспортную инспекцию</option>
                                                    <option value="expired">Аннулирован</option>
                                                </select>
                                            </td>
                                            <td className="p-2">
                                                <input 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.car}
                                                    onChange={e => {
                                                        const newArr = [...tempBatchItems];
                                                        newArr[index].car = e.target.value.trim().toUpperCase();
                                                        setTempBatchItems(newArr);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-2">
                                                <input 
                                                    className="w-full p-1.5 bg-slate-50 border border-slate-200 rounded text-[11px] focus:outline-none"
                                                    value={item.comment || ''}
                                                    onChange={e => {
                                                        const newArr = [...tempBatchItems];
                                                        newArr[index].comment = e.target.value.trim();
                                                        setTempBatchItems(newArr);
                                                    }}
                                                />
                                            </td>
                                            <td className="p-2">
                                                <button 
                                                    onClick={() => {
                                                        const newArr = [...tempBatchItems];
                                                        newArr.splice(index, 1);
                                                        setTempBatchItems(newArr);
                                                    }}
                                                    className="p-1 rounded hover:bg-rose-50 text-rose-500 cursor-pointer"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                    
                    <div className="flex justify-end mt-4">
                        <button 
                            onClick={saveAllPreviewedDozvols}
                            className="bg-emerald-500 hover:bg-emerald-600 text-white px-5 py-2.5 rounded-xl text-xs font-black tracking-wide shadow-sm cursor-pointer"
                        >
                            Применить изменения и внести бланки ➔
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}


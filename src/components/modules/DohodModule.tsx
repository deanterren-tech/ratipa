import React, { useState, useEffect } from 'react';
import { UserProfile, RouteCalculation, Leg, FerryTemplate, DistancePreset, ChatMessage, RouteTemplate, DirectionPreset } from '../../types';
import { dbService } from '../../firebase';
import { Plus, Trash2, Save, MapPin, Calculator, MessageSquare, Sparkles, Info, Ship, TrendingUp, FileSpreadsheet, Calendar, RefreshCw, Edit, Copy } from 'lucide-react';

interface DohodModuleProps {
  user: UserProfile;
}

export default function DohodModule({ user }: DohodModuleProps) {
  const [calculationHistory, setCalculationHistory] = useState<RouteCalculation[]>([]);
  const [routeTemplates, setRouteTemplates] = useState<RouteTemplate[]>([]);
  const [ferries, setFerries] = useState<FerryTemplate[]>([]);
  const [distances, setDistances] = useState<DistancePreset[]>([]);
  const [directions, setDirections] = useState<DirectionPreset[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [editingMsgId, setEditingMsgId] = useState<string | null>(null);

  // Form State
  const [globalDirection, setGlobalDirection] = useState('Турция');
  
  // Date and Days
  const [tripStartDate, setTripStartDate] = useState<string>('');
  const [tripEndDate, setTripEndDate] = useState<string>('');
  const [tripDays, setTripDays] = useState<number>(1);

  const [editingCalcId, setEditingCalcId] = useState<string | null>(null);
  const [editingCalcData, setEditingCalcData] = useState<Partial<RouteCalculation>>({});
  
  const [nbrbRates, setNbrbRates] = useState<Record<string, { scale: number; rate: number }>>({
    USD: { scale: 1, rate: 3.25 },
    EUR: { scale: 1, rate: 3.55 },
    RUB: { scale: 100, rate: 3.42 },
    BYN: { scale: 1, rate: 1.0 },
  });

  const [conversionDialog, setConversionDialog] = useState<{
    index: number;
    infoRate: number;
    infoCurrency: string;
    proposedFreight: number;
  } | null>(null);
  
  const [legs, setLegs] = useState<Omit<Leg, 'id'>[]>([{ 
    from: '', to: '', dist: 0, freight: 0, coeff: 0, infoRate: 0, infoCurrency: 'USD', ferrySelectValue: 'none', ferryCost: 0 
  }]);

  const [aiSuggestions, setAiSuggestions] = useState<string>('Вставьте рабочий текст вроде «Минск — Стамбул 4300 евро». Система добавит плечи и найдет километраж.');
  const [routeSearch, setRouteSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');

  useEffect(() => {
    const today = new Date();
    const nextWeek = new Date(today);
    nextWeek.setDate(today.getDate() + 10);
    setTripStartDate(today.toISOString().split('T')[0]);
    setTripEndDate(nextWeek.toISOString().split('T')[0]);
    
    const diffDays = Math.ceil(Math.abs(nextWeek.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)) || 1;
    setTripDays(diffDays);

    const subHistory = dbService.getRouteCalculations(setCalculationHistory);
    const subRouteTpl = dbService.getRouteTemplates(setRouteTemplates);
    const subFerries = dbService.getFerryTemplates(setFerries);
    const subDistances = dbService.getDistances(setDistances);
    const subDirs = dbService.getDirections(setDirections);
    const subChat = dbService.getChatMessages('ai_dispatcher', setChatMessages);

    // Fetch live NBRB rates directly with fallbacks
    fetch('https://api.nbrb.by/exrates/rates?periodicity=0')
      .then(res => res.json())
      .then((data: any[]) => {
        const updated: Record<string, { scale: number; rate: number }> = {
          BYN: { scale: 1, rate: 1.0 },
          USD: { scale: 1, rate: 3.25 },
          EUR: { scale: 1, rate: 3.55 },
          RUB: { scale: 100, rate: 3.42 },
        };
        if (Array.isArray(data)) {
          data.forEach(item => {
            if (item && ['USD', 'EUR', 'RUB'].includes(item.Cur_Abbreviation)) {
              updated[item.Cur_Abbreviation] = {
                scale: item.Cur_Scale || 1,
                rate: item.Cur_OfficialRate,
              };
            }
          });
        }
        setNbrbRates(updated);
      })
      .catch(err => {
        console.warn('Failed to fetch NBRB rates:', err);
      });

    return () => {
      subHistory();
      subRouteTpl();
      subFerries();
      subDistances();
      subDirs();
      subChat();
    };
  }, []);

  useEffect(() => {
    if (tripStartDate && tripEndDate) {
      const s = new Date(tripStartDate).getTime();
      const e = new Date(tripEndDate).getTime();
      if (e >= s) {
        const d = Math.ceil((e - s) / (1000 * 3600 * 24)) || 1;
        setTripDays(d);
      }
    }
  }, [tripStartDate, tripEndDate]);

  useEffect(() => {
    if (directions.length > 0 && !directions.find(d => d.name === globalDirection)) {
       setGlobalDirection(directions[0].name);
    }
  }, [directions]);

  const addLegRowAfter = (index: number) => {
    const newLeg = { from: '', to: '', dist: 0, freight: 0, coeff: getDirCoeff(), infoRate: 0, infoCurrency: 'USD', ferrySelectValue: 'none', ferryCost: 0 };
    const newLegs = [...legs];
    newLegs.splice(index + 1, 0, newLeg);
    setLegs(newLegs);
  };

  const removeLeg = (index: number) => {
    if (legs.length <= 1) return;
    setLegs(legs.filter((_, i) => i !== index));
  };
  
  const getDirCoeff = () => {
    const found = directions.find(d => d.name === globalDirection);
    return found ? found.coeff : 0;
  };

  const handleGlobalDirectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    setGlobalDirection(val);
    const found = directions.find(d => d.name === val);
    const coeff = found ? found.coeff : 0;
    setLegs(legs.map(l => ({ ...l, coeff })));
  };

  const updateLeg = (index: number, updatedFields: Partial<Omit<Leg, 'id'>>) => {
    setLegs(legs.map((l, i) => {
      if (i === index) {
        const merged = { ...l, ...updatedFields };
        
        if (updatedFields.from !== undefined || updatedFields.to !== undefined) {
          const matchedDist = findDistanceInPool(merged.from, merged.to);
          if (matchedDist !== null && matchedDist > 0 && typeof updatedFields.dist === 'undefined') {
            merged.dist = matchedDist;
          }
        }
        
        if (updatedFields.ferrySelectValue !== undefined) {
            if (updatedFields.ferrySelectValue === 'none') {
                merged.ferryCost = 0;
            } else if (updatedFields.ferrySelectValue !== 'custom') {
                const tpl = ferries[parseInt(updatedFields.ferrySelectValue)];
                if (tpl) merged.ferryCost = tpl.eur || tpl.price || 0;
            }
        }
        
        return merged;
      }
      return l;
    }));
  };

  const handleInfoRateBlur = (index: number) => {
    const leg = legs[index];
    if (!leg || !leg.infoRate || leg.infoCurrency === 'EUR') return;
    triggerConversionCheck(index, leg.infoRate, leg.infoCurrency);
  };

  const handleCurrencyChange = (index: number, newCurrency: string) => {
    const leg = legs[index];
    if (!leg || !leg.infoRate || newCurrency === 'EUR') return;
    triggerConversionCheck(index, leg.infoRate, newCurrency);
  };

  const triggerConversionCheck = (index: number, infoRate: number, infoCurrency: string) => {
    const rateX = nbrbRates[infoCurrency] ? (nbrbRates[infoCurrency].rate / nbrbRates[infoCurrency].scale) : 0;
    const rateEur = nbrbRates['EUR'] ? nbrbRates['EUR'].rate : 1;
    const proposedFreight = rateEur > 0 ? Math.round(infoRate * rateX / rateEur) : 0;

    const currentFreight = legs[index]?.freight || 0;
    if (proposedFreight > 0 && Math.abs(currentFreight - proposedFreight) > 2) {
      setConversionDialog({
        index,
        infoRate,
        infoCurrency,
        proposedFreight
      });
    }
  };

  const applyConversion = () => {
    if (conversionDialog) {
      updateLeg(conversionDialog.index, { freight: conversionDialog.proposedFreight });
      setConversionDialog(null);
    }
  };

  const dismissConversion = () => {
    setConversionDialog(null);
  };

  const findDistanceInPool = (c1: string, c2: string) => {
    if (!c1 || !c2) return null;
    const from = c1.trim().toLowerCase();
    const to = c2.trim().toLowerCase();
    const found = distances.find(d => {
        const a = d.from.trim().toLowerCase();
        const b = d.to.trim().toLowerCase();
        return (a === from && b === to) || (a === to && b === from);
    });
    return found ? found.distance : null;
  };

  const checkManualDistanceUpdate = (from: string, to: string, newDist: number) => {
    if (!from || !to || newDist <= 0) return;
    const matched = distances.find(d => {
        const a = d.from.trim().toLowerCase();
        const b = d.to.trim().toLowerCase();
        return (a === from.trim().toLowerCase() && b === to.trim().toLowerCase()) || 
               (a === to.trim().toLowerCase() && b === from.trim().toLowerCase());
    });
    
    if (!matched || matched.distance !== newDist) {
        const q = matched 
            ? `Изменить расстояние ${from} - ${to} в базе шаблонов с ${matched.distance} км на ${newDist} км?`
            : `Сохранить новое плечо ${from} - ${to} (${newDist} км) в общую базу шаблонов расстояний?`;
        
        setTimeout(() => {
            if (window.confirm(q)) {
                if (matched) {
                    dbService.saveDistance({ ...matched, distance: newDist }, user.name, user.role);
                } else {
                    dbService.saveDistance({ id: 'dist_' + Date.now(), from, to, distance: newDist }, user.name, user.role);
                }
            }
        }, 100);
    }
  };

  // Math totals exactly matching legacy
  const totalKm = legs.reduce((acc, l) => acc + Number(l.dist || l.distance || 0), 0);
  const totalFreight = legs.reduce((acc, l) => acc + Number(l.freight || 0), 0);
  const totalFerryCosts = legs.reduce((acc, l) => acc + Number(l.ferryCost || 0), 0);
  
  // Legacy logic: expenses = sum(dist * coeff + ferryCost)
  const totalExpenses = legs.reduce((acc, l) => {
      return acc + ((Number(l.dist || l.distance || 0) * Number(l.coeff || 0)) + Number(l.ferryCost || 0));
  }, 0);
  
  const totalProfit = totalFreight - totalExpenses;
  const currentDailyProfit = tripDays > 0 ? (totalProfit / tripDays) : 0;

  const saveCalculation = () => {
    if (legs.some(l => !l.from && !l.to && !l.dist && !l.freight)) {
      alert("Калькулятор пуст пустой. Нечего сохранять.");
      return;
    }

    const newCalc: RouteCalculation = {
      id: "calc_" + Date.now(),
      legs: legs,
      direction: globalDirection,
      days: tripDays,
      km: totalKm,
      freight: totalFreight,
      expenses: totalExpenses,
      netProfit: totalProfit,
      dailyProfit: currentDailyProfit,
      datetime: new Date().toLocaleString('ru-RU'),
      logist: user.name,
      username: user.name
    };

    dbService.saveRouteCalculation(newCalc, user.name, user.role);
  };

  const saveCurrentAsTemplate = () => {
      const name = prompt("Введите название для нового шаблона мульти-рейса:");
      if (!name || !name.trim()) return;
      const validLegs = legs.filter(l => l.from || l.to || l.dist || l.freight);
      if (validLegs.length === 0) {
          alert("Калькулятор пуст!"); return;
      }
      dbService.saveRouteTemplate({
          name: name.trim(),
          globalDir: globalDirection,
          legs: validLegs as any
      }, user.name, user.role);
  };

  const loadTemplate = (tpl: RouteTemplate) => {
      if (tpl.globalDir) setGlobalDirection(tpl.globalDir);
      const newArray = tpl.legs.map((l: any) => ({
          from: l.from || '',
          to: l.to || '',
          dist: l.dist || l.distance || 0,
          freight: l.freight || 0,
          infoRate: l.infoRate || 0,
          infoCurrency: l.infoCurrency || 'USD',
          ferrySelectValue: l.ferrySelectValue || 'none',
          ferryCost: l.ferryCost || l.ferry || 0,
          coeff: l.coeff || 0
      }));
      setLegs(newArray);
  };

  const copyHistoryToForm = (calc: RouteCalculation) => {
    if (calc.direction || calc.globalDirection) setGlobalDirection(calc.direction || calc.globalDirection || 'Турция');
    if (calc.days) setTripDays(calc.days);
    
    // Attempt reverse-engineer dates from days
    if (calc.days) {
        const start = new Date(tripStartDate || new Date());
        const end = new Date(start);
        end.setDate(start.getDate() + calc.days);
        setTripStartDate(start.toISOString().split('T')[0]);
        setTripEndDate(end.toISOString().split('T')[0]);
    }

    if (calc.legs && calc.legs.length > 0) {
        setLegs(calc.legs.map((l: any) => ({
            from: l.from || '',
            to: l.to || '',
            dist: l.dist || l.distance || 0,
            freight: l.freight || 0,
            infoRate: l.infoRate || 0,
            infoCurrency: l.infoCurrency || 'USD',
            ferrySelectValue: l.ferrySelectValue || 'none',
            ferryCost: l.ferryCost || 0,
            coeff: l.coeff || 0
        })));
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const editHistoryEntry = (calc: RouteCalculation) => {
      copyHistoryToForm(calc);
      dbService.deleteRouteCalculation(calc.id, user.name, user.role);
  };

  const openEditCalcModal = (calc: RouteCalculation) => {
      setEditingCalcId(calc.id);
      setEditingCalcData(calc);
  };

  const closeEditCalcModal = () => {
      setEditingCalcId(null);
      setEditingCalcData({});
  };

  const saveEditCalcModal = () => {
      if (!editingCalcId) return;
      
      const totalKm = (editingCalcData.legs || []).reduce((acc, leg) => acc + (leg.dist || leg.distance || 0), 0);
      const totalFreight = (editingCalcData.legs || []).reduce((acc, leg) => acc + (leg.freight || 0), 0);
      
      const days = editingCalcData.days || 1;
      const dailyProfit = (editingCalcData.netProfit || 0) / Math.max(days, 1);

      dbService.updateRouteCalculation(editingCalcId, {
          ...editingCalcData,
          totalKm,
          totalFreight,
          dailyProfit,
      }, user.name, user.role);

      closeEditCalcModal();
  };

  // Date and Days helper
  const extractDays = (txt: string): number | null => {
      const lower = txt.toLowerCase();
      // Ищем паттерны вроде "5 дней", "на 10 дн", "рейс 7 суток", "круг 14 дней", "12 суток"
      const m = lower.match(/(\d+)\s*(?:дней|дн\.|дн|суток|сут\.|сут|дня|день|сутки)/i) || 
                lower.match(/(?:круг|рейс|на|срок|время)\s*(\d+)\s*(?:дней|дн\.|дн|суток|сут\.|сут|дня|день|сутки)?/i);
      if (m) {
          return parseInt(m[1], 10);
      }
      return null;
  };

  // AI PARSER logic ported from dohod-7.html and heavily upgraded
  const parseRouteMessage = (text: string) => {
    const parsedLegs: any[] = [];
    const originalText = (text || '').replace(/[→➔➡]/g, ' ').replace(/[—–]/g, '-');

    const normalizeCityName = (name: string) => (name || '').trim().replace(/\s+/g, ' ').split(' ').map(p => p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : '').join(' ');
    
    // Продвинутый маппинг валют
    const mapCurrency = (raw: string) => {
        const v = (raw || '').toLowerCase().trim().replace(/[^a-zа-яё0-9$€₽.]/g, '');
        if (!v) return 'EUR';
        if (['€', 'eur', 'евро', 'euro', 'эур', 'евр'].some(x => v.includes(x)) || v.includes('€')) return 'EUR';
        if (['₽', 'rub', 'руб', 'рубль', 'рублей', 'рос', 'росруб', 'рр', 'росс', 'рубли'].some(x => v.includes(x)) || v.includes('₽') || v === 'рр') return 'RUB';
        if (['byn', 'бел', 'белруб', 'рб', 'by', 'белорус'].some(x => v.includes(x))) return 'BYN';
        if (['usd', '$', 'долл', 'доллар', 'доллара', 'долларов', 'уе', 'бакс', 'баксов', 'dollars', 'y.e', 'ye'].some(x => v.includes(x)) || v.includes('$')) return 'USD';
        return 'USD';
    };

    // Продвинутый парсинг стоимости (учитывает тыс., к, пробелы, запятые)
    const extractRate = (chunk: string) => {
        const matches = [];
        // В регулярном выражении для валют ищем словосочетания с пробелами, такие как рос руб
        const rateRegex = /(\d[\d\s]*(?:[.,]\d+)?)\s*(тыс|тысяч|тыс\.|тысячи|к|k)?\s*(евро|eur|euro|эур|€|долл|доллар|доллара|долларов|usd|\$|у\.е|уе|руб(?:лей|ль|ля|и|ов)?|rub|₽|byn|бел(?:рус|руб(?:лей)?)?|рос\.?\s*руб(?:лей|ля|ь)?|росруб|рр)/gi;
        let match;
        while ((match = rateRegex.exec(chunk)) !== null) {
            const after = chunk.slice(match.index + match[0].length, match.index + match[0].length + 8).toLowerCase();
            if (/^\s*(км|km)/.test(after)) continue;
            let amount = parseFloat(match[1].replace(/\s+/g, '').replace(',', '.')) || 0;
            const multiplier = match[2] ? match[2].toLowerCase() : '';
            if (['тыс', 'тысяч', 'тыс.', 'тысячи', 'к', 'k'].some(m => multiplier.includes(m))) {
                amount *= 1000;
            }
            if (amount > 0) {
                matches.push({ amount, currency: mapCurrency(match[3]), hasCurrency: Boolean(match[3]) });
            }
        }
        return matches.find(i => i.hasCurrency) || matches[matches.length - 1] || { amount: 0, currency: 'EUR' };
    };

    // Нормализация падежей для fallback-режима
    const cleanCityName = (city: string) => {
        let name = city.trim();
        if (name.length <= 2) return name;
        const low = name.toLowerCase();
        if (low.endsWith('ска')) return name.slice(0, -1); // Минска -> Минск
        if (low.endsWith('ске')) return name.slice(0, -1); // Минске -> ...
        if (low.endsWith('ску')) return name.slice(0, -1) + 'к'; // Минску -> Минск
        if (low.endsWith('кву')) return name.slice(0, -1) + 'а'; // Москву -> Москва
        if (low.endsWith('квы')) return name.slice(0, -1) + 'а'; // Москвы -> Москва
        if (low.endsWith('кве')) return name.slice(0, -1) + 'а'; // Москве -> Москва
        if (low.endsWith('бурга')) return name.slice(0, -1); // ...
        if (low.endsWith('бурге')) return name.slice(0, -1); // ...
        if (low.endsWith('града')) return name.slice(0, -1); 
        if (low.endsWith('граде')) return name.slice(0, -1);
        if (low.endsWith('тера')) return name.slice(0, -1) + 'р'; // Питера -> Питер
        if (low.endsWith('тере')) return name.slice(0, -1) + 'р'; // Питере -> Питер
        if (low.endsWith('ова')) return name.slice(0, -1); // Ростова -> Ростов
        if (low.endsWith('ове')) return name.slice(0, -1); // Ростове ->  Ростов
        return name;
    };

    // Автогенерация базовых словоформ для городов из пресетов distances
    const getCityForms = (cityName: string): string[] => {
        const lower = cityName.toLowerCase().trim();
        const forms = [lower];
        
        if (lower.includes('санкт-петербург') || lower === 'питер' || lower === 'спб') {
            forms.push('санкт-петербург', 'санкт-петербурга', 'санкт-петербурге', 'питер', 'питера', 'питере', 'спб');
        }
        if (lower === 'нижний новгород') {
            forms.push('нижний новгород', 'нижнего новгорода', 'нижнем новгороде', 'нн', 'нижнем');
        }
        if (lower.includes('ростов-на-дону')) {
            forms.push('ростов-на-дону', 'ростове-на-дону', 'ростова-на-дону', 'ростов');
        }

        if (lower.length > 3) {
            if (lower.endsWith('а') || lower.endsWith('ы')) {
                forms.push(lower.slice(0, -1)); // Москва -> москв
            } else if (lower.endsWith('о') || lower.endsWith('е')) {
                forms.push(lower.slice(0, -1)); // ...
            } else if (lower.endsWith('ий') || lower.endsWith('ый')) {
                forms.push(lower.slice(0, -2));
            } else if (lower.endsWith('ь')) {
                forms.push(lower.slice(0, -1)); // Гомель -> гомел
            }
        }
        
        return Array.from(new Set(forms)).filter(f => f.length > 2).sort((a, b) => b.length - a.length);
    };

    const citiesDataset = Array.from(new Set(distances.flatMap(item => [item.from, item.to]).filter(Boolean)))
                .map(city => String(city).trim())
                .filter(city => city.length > 1);
    
    const lowerSource = originalText.toLowerCase();
    const mentions: any[] = [];

    citiesDataset.forEach(city => {
        const forms = getCityForms(city);
        forms.forEach(form => {
            let index = lowerSource.indexOf(form);
            while (index !== -1) {
                const bBefore = lowerSource[index - 1] || ' ';
                const bAfter = lowerSource[index + form.length] || ' ';
                const hasCleanBoundary = !/[а-яёa-z0-9]/i.test(bBefore) && !/[а-яёa-z0-9]/i.test(bAfter);
                const overlaps = mentions.some(m => index < m.end && (index + form.length) > m.index);
                if (hasCleanBoundary && !overlaps) {
                    mentions.push({ 
                        city: city, // Используем правильное (официальное) имя города из пресетов
                        matchedText: originalText.slice(index, index + form.length),
                        index, 
                        end: index + form.length 
                    });
                }
                index = lowerSource.indexOf(form, index + 1);
            }
        });
    });

    mentions.sort((a, b) => a.index - b.index);

    if (mentions.length >= 2) {
        for (let i = 0; i < mentions.length - 1; i++) {
            const from = mentions[i].city;
            const to = mentions[i + 1].city;
            if (from.toLowerCase() === to.toLowerCase()) continue;
            const nextBoundary = mentions[i + 2] ? mentions[i + 2].index : originalText.length;
            const rateChunk = originalText.slice(mentions[i + 1].end, nextBoundary);
            const rate = extractRate(rateChunk);
            parsedLegs.push({ 
                from, 
                to, 
                eurRate: rate.currency === 'EUR' ? rate.amount : 0, 
                infoRate: rate.currency !== 'EUR' ? rate.amount : 0, 
                infoCurrency: rate.currency 
            });
        }
        return parsedLegs;
    }

    // fallback
    const tokens = originalText.replace(/[,.;:()]/g, ' ').replace(/-/g, ' ').split(/\s+/).filter(t => t.length > 0);
    const noiseWords = ['в', 'во', 'из', 'с', 'со', 'от', 'на', 'до', 'по', 'потом', 'далее', 'через', 'едем', 'рейс', 'маршрут', 'ставка', 'фрахт', 'цена', 'за', 'евро', 'eur', 'euro', '€', 'долл', 'usd', '$', 'руб', 'rub', '₽', 'byn', 'бел', 'дней', 'дн', 'дней', 'суток', 'сут', 'дня', 'день', 'сутки'];
    const cityItems: string[] = [];

    tokens.forEach(token => {
        if (noiseWords.includes(token.toLowerCase()) || /^\d/.test(token)) return;
        cityItems.push(normalizeCityName(cleanCityName(token)));
    });

    for (let i = 0; i < cityItems.length - 1; i++) {
        const rateChunk = originalText.split(cityItems[i + 1]).slice(1).join(cityItems[i + 1]);
        const rate = extractRate(rateChunk);
        parsedLegs.push({ 
            from: cityItems[i], 
            to: cityItems[i + 1], 
            eurRate: rate.currency === 'EUR' ? rate.amount : 0, 
            infoRate: rate.currency !== 'EUR' ? rate.amount : 0, 
            infoCurrency: rate.currency 
        });
    }
    return parsedLegs;
  };

  const handleAISend = () => {
      const text = chatInput.trim();
      if (!text) return;
      
      const parsed = parseRouteMessage(text);
      const parsedDays = extractDays(text);
      
      if (parsed.length > 0) {
          const newArray = [...legs];
          if (newArray.length === 1 && !newArray[0].from && !newArray[0].to) newArray.shift();

          parsed.forEach(r => {
              const matchedDist = findDistanceInPool(r.from, r.to) || 0;
              let freightValue = r.eurRate || 0;
              if (!freightValue && r.infoRate && r.infoCurrency !== 'EUR') {
                  const rateX = nbrbRates[r.infoCurrency] ? (nbrbRates[r.infoCurrency].rate / nbrbRates[r.infoCurrency].scale) : 0;
                  const rateEur = nbrbRates['EUR'] ? nbrbRates['EUR'].rate : 1;
                  freightValue = rateEur > 0 ? Math.round(r.infoRate * rateX / rateEur) : 0;
              }
              newArray.push({
                  from: r.from, to: r.to, dist: matchedDist, freight: freightValue,
                  infoRate: r.infoRate || 0, infoCurrency: r.infoCurrency || 'USD',
                  coeff: getDirCoeff(), ferrySelectValue: 'none', ferryCost: 0
              });
          });
          setLegs(newArray);
          
          if (parsedDays) {
              setTripDays(parsedDays);
          }

          let responseMsg = `Запрос обработан! Добавлено плеч: ${parsed.length}.`;
          if (parsedDays) {
              responseMsg += ` Установлено время поездки: ${parsedDays} дн.`;
          }
          
          // Детальная расшифровка того, что было найдено
          const details = parsed.map(p => {
              let rateStr = '';
              if (p.eurRate) rateStr = `${p.eurRate} EUR`;
              else if (p.infoRate) rateStr = `${p.infoRate} ${p.infoCurrency}`;
              return `${p.from} ➔ ${p.to} (${rateStr || 'без ставки'})`;
          }).join(', ');

          dbService.sendChatMessage('ai_dispatcher', `${responseMsg} (${details})`, "🤖 Робот парсер", "system");
      } else {
          dbService.sendChatMessage('ai_dispatcher', `Не удалось распознать маршрут. Пожалуйста, напишите в формате: "Минск Москва 120 тыс рос руб, едем 6 дней"`, "🤖 Робот парсер", "system");
      }

      if (editingMsgId) {
          dbService.updateChatMessage(editingMsgId, text);
          setEditingMsgId(null);
      } else {
          dbService.sendChatMessage('ai_dispatcher', text, user.name, user.uid);
      }
      setChatInput('');
  };

  const loadCitiesDatalist = () => {
      const set = new Set<string>();
      distances.forEach(d => { set.add(d.from); set.add(d.to); });
      return Array.from(set).map(c => <option key={c} value={c} />);
  };

  return (
    <div className="w-full grid grid-cols-1 xl:grid-cols-12 gap-6 font-sans">
      <datalist id="cities-datalist">{loadCitiesDatalist()}</datalist>

      {/* Main Left Workspace */}
      <div className="xl:col-span-8 space-y-6">
        
      {/* Header Block */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col sm:flex-row justify-between gap-4 select-none items-center">
        <div>
              <div className="flex items-center gap-2 mb-1.5">
              <span className="bg-[#70FC8E] text-slate-950 font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono border border-black/5">
                Оптимизатор Плеч
              </span>
              <span className="text-[9px] text-slate-400 font-extrabold uppercase font-mono">Доходность Логистики</span>
            </div>
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
              <Calculator className="h-6 w-6 text-slate-800" style={{ fill: '#70FC8E' }} />
              Калькуляция
            </h1>
        </div>
      </div>

       {/* AI Parser Chat Panel */}
       <div className="bg-slate-900 rounded-[2rem] p-6 text-white border border-slate-800 shadow-md relative overflow-hidden flex flex-col h-[300px]">
        <div className="absolute top-0 right-0 p-2 opacity-10"><Sparkles className="h-16 w-16" /></div>
        <div className="flex items-center gap-2 mb-3">
           <div className="p-1 px-2 rounded-full bg-[#70FC8E]/20 text-[#70FC8E] text-[9px] font-black uppercase font-mono tracking-widest border border-[#70FC8E]/30">AI Помощник</div>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-3 bg-slate-950/50 rounded-xl p-4 mb-3 border border-slate-800 custom-scrollbar pr-2 flex flex-col-reverse">
           <div className="flex flex-col gap-3">
               {chatMessages.map(msg => (
                   <div key={msg.id} className={`flex flex-col ${msg.userId === user.uid ? 'items-end' : 'items-start'} animate-fade-in`}>
                       <span className="text-[10px] font-bold text-slate-500 mb-0.5">{msg.username}</span>
                       <div className={`px-4 py-2.5 rounded-2xl max-w-[85%] text-sm leading-relaxed whitespace-pre-wrap ${msg.userId === 'system' ? 'bg-[#70FC8E]/10 text-[#70FC8E] border border-[#70FC8E]/20 text-xs font-mono' : msg.userId === user.uid ? 'bg-indigo-600 text-white rounded-br-none' : 'bg-slate-800 text-slate-200 rounded-bl-none border border-slate-700'}`}>
                           {msg.text}
                       </div>
                   </div>
               ))}
               {chatMessages.length === 0 && <span className="text-xs text-slate-500 flex items-center justify-center font-bold">История парсера пуста</span>}
           </div>
        </div>
        
        <div className="flex gap-2 relative mt-auto">
            <input type="text" value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Пример: Минск — Стамбул 4300..." className="flex-1 bg-slate-800 border border-slate-700 text-slate-200 text-sm px-3 py-3 rounded-xl outline-none focus:border-[#70FC8E]" onKeyDown={e => e.key === 'Enter' && handleAISend()} />
            <button onClick={handleAISend} className="bg-[#70FC8E] hover:bg-[#5be277] text-slate-950 font-black px-4 rounded-xl text-lg flex items-center justify-center transition">→</button>
        </div>
    </div>

        {/* Table Container */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden flex flex-col">
            <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 font-mono pb-3 border-b border-slate-100 mb-4 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-900"><MapPin className="h-5 w-5" style={{ fill: '#70FC8E' }} /> Конструктор плеч маршрута</span>
                <select value={globalDirection} onChange={handleGlobalDirectionChange} className="ml-4 px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-xs font-black outline-none w-36">
                    {directions.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                </select>
            </h2>
            
            <div className="w-full overflow-x-auto pb-4 custom-scrollbar">
                <table className="w-full min-w-[950px] border-collapse relative">
                    <thead className="bg-slate-50/50">
                        <tr>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left rounded-tl-xl w-8">#</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-32">Откуда</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-32">Куда</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">Пробег км</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">Ставка €</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-24">Инфо ставка</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-20">Валюта</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-48">Паром</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-left w-16">Коэф.</th>
                            <th className="p-3 text-xs font-black uppercase text-slate-500 tracking-wider text-right rounded-tr-xl w-24">Действия</th>
                        </tr>
                    </thead>
                    <tbody className="space-y-2">
                        {legs.map((leg, idx) => (
                           <tr key={idx} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/50 transition">
                               <td className="p-2 text-xs font-black text-slate-400">{idx + 1}</td>
                               <td className="p-2">
                                   <input list="cities-datalist" value={leg.from} onChange={(e) => updateLeg(idx, {from: e.target.value})} className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none" />
                               </td>
                               <td className="p-2">
                                   <input list="cities-datalist" value={leg.to} onChange={(e) => updateLeg(idx, {to: e.target.value})} className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none" />
                               </td>
                               <td className="p-2">
                                    <input type="number" 
                                        value={leg.dist || leg.distance || ''} 
                                        onChange={(e) => updateLeg(idx, { dist: Number(e.target.value), distance: Number(e.target.value) })} 
                                        onBlur={(e) => checkManualDistanceUpdate(leg.from, leg.to, Number(e.target.value))}
                                        className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none" 
                                    />
                               </td>
                               <td className="p-2">
                                   <input type="number" value={leg.freight || ''} onChange={(e) => updateLeg(idx, {freight: Number(e.target.value)})} className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none" />
                               </td>
                               <td className="p-2 relative group">
                                   <input 
                                       type="number" 
                                       value={leg.infoRate || ''} 
                                       onChange={(e) => updateLeg(idx, {infoRate: Number(e.target.value)})} 
                                       onBlur={() => handleInfoRateBlur(idx)}
                                       className="w-full pr-8 px-2 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold focus:border-[#0f7632] outline-none" 
                                   />
                                   {leg.infoRate > 0 && leg.infoCurrency !== 'EUR' && (
                                       <button 
                                           type="button"
                                           onClick={() => triggerConversionCheck(idx, leg.infoRate, leg.infoCurrency)} 
                                           title="Конвертировать по курсу НБРБ"
                                           className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-emerald-600 transition p-1"
                                       >
                                           <RefreshCw className="h-3.5 w-3.5" />
                                       </button>
                                   )}
                               </td>
                               <td className="p-2">
                                    <select 
                                        value={leg.infoCurrency} 
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            updateLeg(idx, {infoCurrency: val});
                                            handleCurrencyChange(idx, val);
                                        }} 
                                        className="w-full px-1 py-2 bg-slate-50 border border-slate-200 rounded-lg text-[10px] font-bold outline-none leading-tight overflow-hidden text-ellipsis"
                                    >
                                        <option value="USD">USD</option><option value="EUR">EUR</option><option value="RUB">RUB</option><option value="BYN">BYN</option>
                                    </select>
                               </td>
                               <td className="p-2">
                                   <div className="flex flex-col gap-1 w-full min-w-[140px]">
                                    <select value={leg.ferrySelectValue || 'none'} onChange={(e) => updateLeg(idx, {ferrySelectValue: e.target.value})} className="w-full px-2 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none">
                                        <option value="none">Без парома</option>
                                        {ferries.map((f, i) => (
                                            <option key={f.id} value={i}>{f.from} ➔ {f.to} ({f.eur || f.price}€)</option>
                                        ))}
                                        <option value="custom">Ввести вручную ✎</option>
                                    </select>
                                    {leg.ferrySelectValue === 'custom' && (
                                        <input type="number" value={leg.ferryCost || ''} placeholder="Цена €" onChange={(e) => updateLeg(idx, {ferryCost: Number(e.target.value)})} className="w-full px-2 py-1.5 bg-yellow-50 border border-yellow-200 rounded-lg text-[10px] font-black outline-none" />
                                    )}
                                   </div>
                               </td>
                               <td className="p-2">
                                   <input type="number" step="0.1" value={leg.coeff === undefined ? getDirCoeff() : leg.coeff} onChange={(e) => updateLeg(idx, {coeff: Number(e.target.value)})} className="w-full px-1 py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-bold outline-none text-center" />
                               </td>
                               <td className="p-2 text-right space-x-1 whitespace-nowrap">
                                  <button onClick={() => addLegRowAfter(idx)} className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-blue-50 hover:bg-blue-100 text-blue-600 transition"><Plus className="w-4 h-4"/></button>
                                  <button onClick={() => removeLeg(idx)} disabled={legs.length <= 1} className="w-7 h-7 inline-flex items-center justify-center rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 transition disabled:opacity-30"><Trash2 className="w-4 h-4"/></button>
                               </td>
                           </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            
            {/* Multi-Leg save template helper */}
            <div className="mt-4 flex justify-end gap-2">
                <button onClick={() => setLegs([{ from: '', to: '', dist: 0, freight: 0, coeff: getDirCoeff(), infoRate: 0, infoCurrency: 'USD', ferrySelectValue: 'none', ferryCost: 0 }])}
                    className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-bold transition">
                    Сбросить
                </button>
                <button onClick={saveCurrentAsTemplate} className="text-[10px] font-black uppercase text-slate-500 hover:text-slate-800 bg-slate-50 hover:bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200 flex items-center gap-1 transition">
                   <Save className="h-3 w-3"/> Шаблонизировать текущий вид
                </button>
                {user.permissions.dohod === 'write' && (
                  <button onClick={saveCalculation} className="flex items-center justify-center gap-2 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] text-xs font-black px-5 py-2.5 rounded-xl transition cursor-pointer border border-black">
                    <Save className="h-4 w-4" /> Сохранить расчет
                  </button>
                )}
            </div>
        </div>

        {/* Templates Board */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
           <div className="flex justify-between items-center pb-3 border-b border-slate-100 mb-4">
               <h2 className="text-sm font-black uppercase text-slate-400 font-mono tracking-wider flex items-center gap-1.5"><FileSpreadsheet className="h-5 w-5"/>База готовых шаблонов мульти-рейсов</h2>
               <input type="text" placeholder="Поиск... " value={routeSearch} onChange={e => setRouteSearch(e.target.value)} className="text-xs px-4 py-2 bg-slate-50 border border-slate-200 rounded-lg outline-none font-bold" />
           </div>
           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
               {routeTemplates.filter(t => t.name.toLowerCase().includes(routeSearch.toLowerCase())).map((t, idx) => (
                   <div key={idx} className="p-5 bg-slate-50 border border-slate-200 rounded-2xl flex flex-col justify-between group">
                       <div className="flex justify-between items-start mb-3">
                           <span className="font-extrabold text-base text-slate-800 break-all leading-tight">📁 {t.name}</span>
                           <button onClick={() => dbService.deleteRouteTemplate(t.id!, user.name, user.role)} className="opacity-0 group-hover:opacity-100 text-rose-500 hover:bg-rose-100 p-1 rounded transition">
                               <Trash2 className="h-4 w-4"/>
                           </button>
                        </div>
                        <div className="text-xs text-slate-500 mb-4 space-y-1">
                            {(t.legs || []).map((l, i) => <div key={i}>• {l.from} ➔ {l.to} ({l.dist || l.distance} км)</div>)}
                        </div>
                        <button onClick={() => loadTemplate(t)} className="bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold py-3 rounded-lg w-full transition uppercase">Развернуть ↵</button>
                    </div>
                ))}
                {routeTemplates.length === 0 && <div className="text-sm text-slate-400 font-bold">Шаблоны не найдены</div>}
            </div>
         </div>
      </div>

      {/* Main Right Sidebar Workspace */}
      <div className="xl:col-span-4 space-y-6">
        
         {/* MyFin Currency Converter Widget */}
         <div id="myfin-converter-widget" className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] relative overflow-hidden">
             <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-4 select-none">
                 <h2 className="text-xs font-black uppercase text-slate-800 tracking-tight flex items-center gap-1.5 font-mono">
                     🏦 Конвертер валют НБ РБ
                 </h2>
                 <a 
                   href="https://myfin.by/converter" 
                   target="_blank" 
                   rel="noopener noreferrer" 
                   className="text-[9px] font-black uppercase tracking-wider text-blue-600 hover:underline"
                 >
                   Myfin.by ↗
                 </a>
             </div>
             
             <div className="flex flex-wrap items-center justify-between gap-1 mb-4 bg-slate-50 border border-slate-200/60 p-3 rounded-2xl text-[10px] font-mono select-none">
                 <span className="text-slate-400 font-bold uppercase tracking-wider">Курсы НБ РБ:</span>
                 <span className="text-slate-800 font-black">1 USD = {(nbrbRates['USD']?.rate || 3.25).toFixed(4)}</span>
                 <span className="text-slate-800 font-black">1 EUR = {(nbrbRates['EUR']?.rate || 3.55).toFixed(4)}</span>
                 <span className="text-slate-800 font-black">100 RUB = {(nbrbRates['RUB']?.rate || 3.42).toFixed(4)}</span>
             </div>

             <div className="w-full relative bg-slate-50 rounded-2xl overflow-hidden border border-slate-200" style={{ height: '390px' }}>
                 <iframe 
                     src="https://myfin.by/outer/informer/nb/converter" 
                     width="100%" 
                     height="100%" 
                     style={{ border: 'none', overflow: 'hidden' }}
                     scrolling="no"
                     title="Конвертер валют НБ РБ"
                     referrerPolicy="no-referrer"
                 />
             </div>
             <p className="text-[9px] text-slate-400 mt-2 font-mono leading-tight uppercase font-medium">
                 *официальный информер Национального Банка РБ от портала myfin.by
             </p>
         </div>

         {/* Profit per Day Widget / Calendar */}
         <div className="bg-white rounded-[2rem] p-6 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] relative overflow-hidden">
             <h2 className="text-sm font-black uppercase text-slate-800 tracking-tight mb-2">Доходность проекта</h2>
             <p className="text-[10px] text-slate-500 mb-4 leading-relaxed tracking-wide">Рассчитайте среднюю прибыль за каждый день в рейсе. Заполните даты старта и завершения поездки.</p>
             
             <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3 mb-4">
                  <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-500 uppercase font-mono">Старт:</span>
                      <input type="date" value={tripStartDate} onChange={e => setTripStartDate(e.target.value)} className="bg-white px-2 py-2 text-sm font-bold rounded border border-slate-200 outline-none focus:border-[#0f7632]"/>
                  </div>
                  <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-slate-500 uppercase font-mono">Завершение:</span>
                      <input type="date" value={tripEndDate} onChange={e => setTripEndDate(e.target.value)} className="bg-white px-2 py-2 text-sm font-bold rounded border border-slate-200 outline-none focus:border-[#0f7632]"/>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-3 mt-1">
                      <span className="text-sm font-black text-slate-800">Дней в рейсе:</span>
                      <input type="number" min="1" value={tripDays} onChange={e => setTripDays(Number(e.target.value))} className="bg-transparent text-right w-16 text-lg font-black outline-none border-b border-transparent focus:border-slate-300"/>
                  </div>
             </div>

             <div className={`text-center py-5 rounded-2xl text-4xl font-black tracking-tighter ${currentDailyProfit > 200 ? 'bg-[#70FC8E]/20 text-[#143e1d]' : 'bg-rose-50 text-rose-600'}`}>
                 {Math.round(currentDailyProfit).toLocaleString('ru-RU')} €
                 <span className="block text-[10px] uppercase font-mono font-black mt-1 opacity-50">за сутки</span>
             </div>
         </div>

        {/* Total Stats Banner - Vertical Panel */}
        <div className="bg-slate-950 rounded-[2rem] p-6 lg:p-8 text-white shadow-xs space-y-6 border border-slate-800 flex flex-col sticky top-6">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-[#70FC8E] font-mono flex items-center gap-2 mb-2">
            <TrendingUp className="h-4 w-4 text-[#70FC8E]" /> Экономика рейса
          </h2>
          <div className="flex flex-col gap-4">
            <div className="border-b border-slate-800 pb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-mono font-black mb-0.5">Общий пробег</span>
              <span className="text-2xl font-black tracking-tighter inline-block font-mono">{totalKm.toLocaleString('ru-RU')} км</span>
            </div>
            <div className="border-b border-slate-800 pb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-mono font-black mb-0.5">Общий Фрахт</span>
              <span className="text-2xl font-black tracking-tighter text-white inline-block font-mono">{totalFreight.toLocaleString('ru-RU')} €</span>
            </div>
            <div className="border-b border-slate-800 pb-4">
              <span className="text-[10px] text-slate-500 uppercase tracking-widest block font-mono font-black mb-0.5">Расходы ({globalDirection})</span>
              <span className="text-2xl font-black tracking-tighter text-amber-500 inline-block font-mono">{totalExpenses.toLocaleString('ru-RU')} €</span>
            </div>
            <div className={`mt-2 border p-5 rounded-2xl ${totalProfit > 2000 ? 'border-[#70FC8E]/50 bg-[#70FC8E]/10' : 'border-rose-500/50 bg-rose-500/10'}`}>
              <span className={`text-[10px] uppercase tracking-widest block font-mono font-black ${totalProfit > 2000 ? 'text-[#70FC8E]/80' : 'text-rose-400'}`}>Чистая прибыль</span>
              <span className={`text-4xl font-black tracking-tighter mt-1 block font-mono ${totalProfit > 2000 ? 'text-[#70FC8E]' : 'text-rose-500'}`}>
                {totalProfit.toLocaleString('ru-RU')} €
              </span>
            </div>
          </div>
        </div>

      </div>

      {/* History of Saved Calculations - FULL WIDTH BOTTOM */}
      <div className="xl:col-span-12">
        <div className="bg-white rounded-[2rem] p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col">
          <div className="flex justify-between items-center border-b border-slate-100 pb-5 mb-6">
               <h2 className="text-sm font-black uppercase tracking-wider text-slate-400 font-mono flex items-center gap-2"><FileSpreadsheet className="h-5 w-5" /> Журнал расчетов</h2>
               <input type="text" placeholder="Поиск..." value={historySearch} onChange={e => setHistorySearch(e.target.value)} className="text-xs font-bold px-4 py-2 w-48 bg-slate-50 border border-slate-200 rounded-lg outline-none" />
          </div>
          
          <div className="overflow-y-auto pr-1 space-y-2 pb-4 custom-scrollbar max-h-[600px]">
            {calculationHistory.filter(c => c.username?.toLowerCase().includes(historySearch.toLowerCase()) || c.logist?.toLowerCase().includes(historySearch.toLowerCase()) || JSON.stringify(c.legs).toLowerCase().includes(historySearch.toLowerCase())).map((calc) => {
              
              const routePoints: string[] = [];
              calc.legs.forEach(l => {
                  if (l.from && routePoints[routePoints.length - 1] !== l.from) routePoints.push(l.from);
                  if (l.to && routePoints[routePoints.length - 1] !== l.to) routePoints.push(l.to);
              });
              const routeTitle = routePoints.join(' ➔ ');

              return (
              <div key={calc.id} className="p-5 bg-slate-50 rounded-xl border border-slate-100 flex flex-col group hover:bg-slate-100 transition">
                <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200">
                  <div className="flex flex-col gap-1 overflow-hidden">
                      <div className="text-sm font-black text-slate-800 truncate">{routeTitle || 'Без названия'}</div>
                      <div className="text-xs font-mono text-slate-400 uppercase tracking-widest">{calc.datetime} · {calc.netProfit ? Math.round(calc.netProfit).toLocaleString('ru-RU') : '0'} € · {calc.totalKm || calc.legs.reduce((acc, leg) => acc + (leg.dist || leg.distance || 0), 0)} км · {calc.globalDirection}</div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0 opacity-0 group-hover:opacity-100 transition">
                      <button title="Дублировать в форму" onClick={() => copyHistoryToForm(calc)} className="text-slate-400 hover:text-green-600 p-2"><Copy className="h-5 w-5"/></button>
                      <button title="Изменить" onClick={() => openEditCalcModal(calc)} className="text-slate-400 hover:text-emerald-500 p-2"><Edit className="h-5 w-5"/></button>
                      {user.role === 'root_admin' && (
                          <button onClick={() => dbService.deleteRouteCalculation(calc.id, user.name, user.role)} className="text-slate-400 hover:text-rose-600 p-2"><Trash2 className="h-5 w-5"/></button>
                      )}
                  </div>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mt-1">
                  {calc.legs.map((l, i) => (
                    <div key={i} className="bg-white p-4 rounded-[1.5rem] border border-slate-200 shadow-sm flex flex-col group/leg hover:border-blue-200 transition">
                      <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-3">
                         <span className="bg-slate-900 text-[#70FC8E] px-2.5 py-1 rounded-lg text-[9px] font-black uppercase font-mono tracking-widest shadow-xs">Плечо {i + 1}</span>
                         <span className="text-slate-800 font-black text-xs max-w-[160px] truncate uppercase tracking-tight" title={`${l.from || '?'} ➔ ${l.to || '?'}`}>{l.from || '?'} ➔ {l.to || '?'}</span>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col bg-slate-50 p-2.5 rounded-xl border border-slate-100 col-span-2">
                           <span className="text-[9px] font-black uppercase tracking-widest text-slate-400 font-mono mb-0.5">Километраж</span>
                           <span className="text-sm font-black text-slate-700 font-mono">{Math.round((l.dist || l.distance) || 0).toLocaleString('ru-RU')} <span className="text-slate-400 text-[10px]">км</span></span>
                        </div>
                        
                        {(l.freight || 0) > 0 && <div className="flex flex-col bg-[#70FC8E]/10 p-2.5 rounded-xl border border-[#70FC8E]/30 col-span-2">
                           <span className="text-[9px] font-black uppercase tracking-widest text-[#143e1d] font-mono mb-0.5">Ставка</span>
                           <span className="text-base font-black text-[#143e1d] font-mono tracking-tight">{Math.round(l.freight || 0).toLocaleString('ru-RU')} <span className="text-[#143e1d]/50 text-[10px]">€</span></span>
                        </div>}

                        {((l.ferryCost || 0) > 0 || (l.otherExpenses || 0) > 0) && (
                          <div className="flex flex-col bg-rose-50 p-2.5 rounded-xl border border-rose-100 col-span-2">
                             <span className="text-[9px] font-black uppercase tracking-widest text-rose-500 font-mono mb-0.5">Доп. расходы / Паром</span>
                             <span className="text-sm font-black text-rose-600 font-mono tracking-tight">{(Math.round((l.ferryCost || 0) + (l.otherExpenses || 0))).toLocaleString('ru-RU')} <span className="text-rose-400 text-[10px]">€</span></span>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

              </div>
            )})}
            {calculationHistory.length === 0 && <div className="text-center text-slate-400 text-sm font-mono font-black py-8 uppercase tracking-widest">Журнал пуст</div>}
          </div>
        </div>
      </div>
      
      {conversionDialog && (
         <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/45 backdrop-blur-xs animate-fade-in">
             <div className="bg-white rounded-[2rem] w-full max-w-md shadow-2xl border border-slate-200 p-6 lg:p-8 space-y-6">
                 <div className="flex items-center gap-3">
                     <div className="w-12 h-12 rounded-full bg-emerald-50 border border-emerald-100 flex items-center justify-center text-emerald-600">
                         <Sparkles className="h-6 w-6 animate-pulse" />
                     </div>
                     <div>
                         <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 font-mono">Автоконвертация НБ РБ</h3>
                         <p className="text-[10px] text-slate-400 font-mono font-bold uppercase mt-0.5">Курсы валют в реальном времени</p>
                     </div>
                 </div>

                 <p className="text-xs text-slate-600 font-extrabold leading-relaxed">
                     Вы указали инфо-ставку <span className="text-slate-900 underline font-black">{conversionDialog.infoRate} {conversionDialog.infoCurrency}</span>. Хотите автоматически сконвертировать её в евро для «Ставки €» плеча #{conversionDialog.index + 1}?
                 </p>

                 <div className="grid grid-cols-2 gap-3 bg-slate-50 p-4 rounded-xl border border-slate-200/60 font-mono text-center">
                     <div className="border-r border-slate-200">
                         <span className="block text-[8px] font-black text-slate-400 uppercase tracking-widest">Инфо Ставка</span>
                         <span className="text-sm font-black text-slate-700 mt-1 block">{conversionDialog.infoRate} {conversionDialog.infoCurrency}</span>
                     </div>
                     <div>
                         <span className="block text-[8px] font-black text-emerald-500 uppercase tracking-widest">Результат (€)</span>
                         <span className="text-sm font-black text-emerald-600 mt-1 block">{conversionDialog.proposedFreight} €</span>
                     </div>
                 </div>

                 <div className="text-[10px] font-mono text-slate-400 flex items-center justify-between px-1">
                     <span>Курс {conversionDialog.infoCurrency}/EUR (НБ РБ):</span>
                     <span className="font-extrabold text-slate-600">
                         {((nbrbRates[conversionDialog.infoCurrency]?.rate / nbrbRates[conversionDialog.infoCurrency]?.scale) / (nbrbRates['EUR']?.rate || 1)).toFixed(5)}
                     </span>
                 </div>

                 <div className="flex gap-2.5 pt-2">
                     <button onClick={dismissConversion} className="flex-1 py-3 px-4 bg-slate-100 hover:bg-slate-200 text-slate-600 font-black text-xs uppercase tracking-wider rounded-xl transition cursor-pointer">
                         Пропустить
                     </button>
                     <button onClick={applyConversion} className="flex-1 py-3 px-4 bg-slate-950 hover:bg-slate-800 text-[#70FC8E] font-black text-xs uppercase tracking-wider rounded-xl transition border border-black cursor-pointer flex items-center justify-center gap-1.5 shadow-xs">
                         Применить
                     </button>
                 </div>
             </div>
         </div>
      )}

      {editingCalcId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                <div className="bg-white rounded-[2rem] w-full max-w-lg shadow-2xl border border-slate-200">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-[2rem]">
                        <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                           <Edit className="w-5 h-5 text-emerald-500" /> Редактирование Калькуляции
                        </h3>
                        <button onClick={closeEditCalcModal} className="text-slate-400 hover:text-slate-600 bg-white shadow-sm border border-slate-200 w-8 h-8 rounded-full flex items-center justify-center font-bold">×</button>
                    </div>
                    
                    <div className="p-6 space-y-4">
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Направление</label>
                            <input type="text" value={editingCalcData.globalDirection || ''} onChange={e => setEditingCalcData({...editingCalcData, globalDirection: e.target.value})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Чистая прибыль (€)</label>
                            <input type="number" step="1" value={editingCalcData.netProfit || 0} onChange={e => setEditingCalcData({...editingCalcData, netProfit: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Дней в пути</label>
                            <input type="number" step="1" value={editingCalcData.days || 1} onChange={e => setEditingCalcData({...editingCalcData, days: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                            <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Дата</label>
                            <input type="text" value={editingCalcData.datetime || ''} onChange={e => setEditingCalcData({...editingCalcData, datetime: e.target.value})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                        </div>
                    </div>
                    
                    <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50 rounded-b-[2rem]">
                        <button onClick={closeEditCalcModal} className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-sm font-mono uppercase tracking-widest shadow-sm">Отмена</button>
                        <button onClick={saveEditCalcModal} className="px-6 py-3 rounded-xl font-bold text-slate-950 bg-[#70FC8E] hover:bg-[#5ceb7d] transition flex items-center justify-center gap-2 border border-black/10 shadow-sm text-sm font-mono uppercase tracking-widest cursor-pointer">
                            Сохранить
                        </button>
                    </div>
                </div>
            </div>
      )}

    </div>
  );
}


import React, { useState, useEffect } from 'react';
import { UserProfile, SalaryLog, CarRateGroup, AppSettings, Driver } from '../../types';
import { dbService } from '../../firebase';
import { Wallet, Calculator, Sparkles, Send, Trash2, Edit, Copy, Calendar } from 'lucide-react';
import CalendarDaysCalculator from './CalendarDaysCalculator';
import { useDialog } from '../DialogProvider';
import { useToast } from '../ToastProvider';

interface SalaryModuleProps {
  user: UserProfile;
}

const salarySteps = [
    { field: 'carNumber', label: 'Введите **ГОС. НОМЕР** автомобиля:', isNumeric: false },
    { field: 'ratePerKm', label: 'Укажите **СТАВКУ** за км (€) или оставьте стандартную:', isNumeric: true },
    { field: 'totalKm', label: 'Какой **ОБЩИЙ ПРОБЕГ** по рейсу (км)?', isNumeric: true },
    { field: 'tripMark', label: 'Пометка рейса (Напишите: **Турция** или **Китай**):', isSelect: true },
    { field: 'idleDays', label: 'Сколько дней **ПРОСТОЯ**?', isNumeric: true },
    { field: 'totalDays', label: 'Сколько **ВСЕГО ДНЕЙ** в рейсе?', isNumeric: true },
    { field: 'bonus', label: 'Какая **ПРЕМИЯ** за рейс (€)? Если премии нет, введите 0.', isNumeric: true },
    { field: 'driverName', label: 'Укажите **ФИО** Водителя:', isNumeric: false }
];

export default function SalaryModule({ user }: SalaryModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();
  const [logs, setLogs] = useState<SalaryLog[]>([]);
  const [carsPool, setCarsPool] = useState<CarRateGroup[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // AI Assistant State
  const [aiStep, setAiStep] = useState(0);
  const [aiInput, setAiInput] = useState('');
  const [aiOutput, setAiOutput] = useState<string>('Готов помочь рассчитать зарплату водителя по шагам.');

  // Form State
  const [carNumber, setCarNumber] = useState('');
  const [ratePerKm, setRatePerKm] = useState(0.125);
  const [ratePerDiem, setRatePerDiem] = useState<number | undefined>(undefined);
  const [totalKm, setTotalKm] = useState<number | ''>('');
  const [tripMark, setTripMark] = useState('Турция');
  const [idleDays, setIdleDays] = useState(0);
  const [totalDays, setTotalDays] = useState(1);
  const [bonus, setBonus] = useState(0);
  const [comment, setComment] = useState('');
  const [driverName, setDriverName] = useState('');

  const [editingSalaryId, setEditingSalaryId] = useState<string | null>(null);
  const [editingSalaryData, setEditingSalaryData] = useState<Partial<SalaryLog>>({});

  useEffect(() => {
    const unsubLogs = dbService.getSalaries((data) => setLogs(data));
    const unsubCars = dbService.getCarRateGroups((data) => setCarsPool(data));
    const unsubDrivers = dbService.getDrivers((data) => setDrivers(data));
    const unsubSettings = dbService.getSettings((data) => setSettings(data));

    return () => {
        unsubLogs();
        unsubCars();
        unsubDrivers();
        unsubSettings();
    };
  }, []);

  const handleCarNumberChange = (val: string) => {
    const typed = val.toUpperCase().trim();
    // Normalize to handle extra spaces
    const normalizedTyped = typed.replace(/\s+/g, ' ');
    setCarNumber(typed);

    // Find car in unified carsPool
    const group = carsPool.find(g => 
        (g.vehicles || []).some(v => v.toUpperCase().trim().replace(/\s+/g, ' ') === normalizedTyped)
    );
    
    if (group) {
        setRatePerKm(group.rate);
        setRatePerDiem(group.perDiemRate);
    } else {
        setRatePerKm(0.125);
        setRatePerDiem(undefined);
    }
  };

  const handleDriverNameChange = (val: string) => {
    setDriverName(val);
    
    // Find driver in drivers pool
    const foundDriver = drivers.find(d => String(d.name || '').trim().toLowerCase() === val.trim().toLowerCase());
    if (foundDriver && foundDriver.rateGroupId) {
      const group = carsPool.find(g => g.id === foundDriver.rateGroupId);
      if (group) {
        setRatePerKm(group.rate);
        setRatePerDiem(group.perDiemRate);
      }
    }
  };

  const currentIdleRate = settings?.idleRate ?? 30;
  const currentPerDiem = ratePerDiem ?? settings?.perDiemRate ?? 7;

  const kmMoney = (Number(totalKm) || 0) * ratePerKm;
  const idleMoney = idleDays * currentIdleRate;
  const daysMoney = totalDays * currentPerDiem;
  const totalSalary = kmMoney + idleMoney + daysMoney + bonus;
  const salaryPerDay = totalSalary / Math.max(totalDays, 1);

  const clearForm = () => {
    setCarNumber('');
    setRatePerKm(0.125);
    setRatePerDiem(undefined);
    setTotalKm('');
    setTripMark('Турция');
    setIdleDays(0);
    setTotalDays(1);
    setBonus(0);
    setComment('');
    setDriverName('');
  };

  const saveToHistory = async () => {
    if (!user.name) {
        alert("ОШИБКА: Имя пользователя не определено.");
        return;
    }

    const trimmedDriver = driverName.trim();
    if (trimmedDriver && trimmedDriver !== 'НЕ УКАЗАНО') {
      const exists = drivers.some(d => String(d.name || '').trim().toLowerCase() === trimmedDriver.toLowerCase());
      if (!exists) {
        const confirmAdd = await showConfirm(`Водитель "${trimmedDriver}" отсутствует в справочнике. Занести его в справочник?`);
        if (confirmAdd) {
          const newDriver: Driver = {
            id: "dr_" + Date.now(),
            name: trimmedDriver,
          };
          dbService.saveDriver(newDriver, user.name, user.role);
          toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
        }
      }
    }

    const newLog: SalaryLog = {
        id: Date.now().toString(),
        datetime: new Date().toLocaleDateString('ru-RU'),
        logist: user.name,
        car: carNumber.trim().toUpperCase() || 'НЕ УКАЗАНО',
        rate: ratePerKm,
        km: Number(totalKm) || 0,
        mark: tripMark,
        idleDays,
        totalDays: Math.max(totalDays, 1),
        bonus,
        kmMoney,
        idleMoney,
        daysMoney,
        comment: comment.trim(),
        driver: trimmedDriver || 'НЕ УКАЗАНО',
        totalSalary,
        salaryPerDay
    };

    dbService.saveSalary(newLog, user.name, user.role);
    clearForm();
    resetAi();
  };

  const renderAiLabel = (text: string) => {
      return <span dangerouslySetInnerHTML={{ __html: text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }} />;
  };

  const resetAi = () => {
    setAiStep(0);
    setAiInput('');
    setAiOutput('Готов помочь рассчитать зарплату водителя по шагам.');
  };

  const openEditModal = (log: SalaryLog) => {
    setEditingSalaryId(log.id);
    setEditingSalaryData(log);
  };

  const closeEditModal = () => {
    setEditingSalaryId(null);
    setEditingSalaryData({});
  };

  const copyHistoryToForm = (log: SalaryLog) => {
    setCarNumber('');
    setRatePerKm(log.rate || 0);
    setTotalKm(log.km || '');
    setTripMark(log.mark || 'Турция');
    setIdleDays(log.idleDays || 0);
    setTotalDays(log.totalDays || 1);
    setBonus(log.bonus || 0);
    setComment(log.comment || '');
    setDriverName(log.driver || '');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const saveEditModal = async () => {
    if (!editingSalaryId) return;
    
    const trimmedDriver = (editingSalaryData.driver || '').trim();
    if (trimmedDriver && trimmedDriver !== 'НЕ УКАЗАНО') {
      const exists = drivers.some(d => String(d.name || '').trim().toLowerCase() === trimmedDriver.toLowerCase());
      if (!exists) {
        const confirmAdd = await showConfirm(`Водитель "${trimmedDriver}" отсутствует в справочнике. Занести его в справочник?`);
        if (confirmAdd) {
          const newDriver: Driver = {
            id: "dr_" + Date.now(),
            name: trimmedDriver,
          };
          dbService.saveDriver(newDriver, user.name, user.role);
          toast(`Водитель "${trimmedDriver}" добавлен в справочник!`, 'success');
        }
      }
    }

    // Recalculate totals
    const kmMoney = (Number(editingSalaryData.km) || 0) * (editingSalaryData.rate || 0);
    const idleMoney = (editingSalaryData.idleDays || 0) * currentIdleRate;
    const daysMoney = (editingSalaryData.totalDays || 1) * currentPerDiem; // Using default for now as fallback
    const totalSalary = kmMoney + idleMoney + daysMoney + (Number(editingSalaryData.bonus) || 0);
    const salaryPerDay = totalSalary / Math.max((editingSalaryData.totalDays || 1), 1);

    const updates = {
      ...editingSalaryData,
      kmMoney,
      idleMoney,
      daysMoney,
      totalSalary,
      salaryPerDay
    };
    
    dbService.updateSalary(editingSalaryId, updates, user.name, user.role);
    closeEditModal();
  };

  const startAi = () => {
    setAiStep(1);
    setAiOutput(salarySteps[0].label);
  };

  const handleAiSubmit = () => {
    if (!aiInput.trim()) return;
    const rawVal = aiInput.trim();
    
    if (aiStep > 0 && aiStep <= salarySteps.length) {
        const step = salarySteps[aiStep - 1];
        
        if (step.field === 'carNumber') handleCarNumberChange(rawVal);
        if (step.field === 'ratePerKm') {
            const num = parseFloat(rawVal.replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) setRatePerKm(num);
        }
        if (step.field === 'totalKm') {
            const num = parseFloat(rawVal.replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) setTotalKm(num);
        }
        if (step.field === 'tripMark') {
            setTripMark(rawVal.toLowerCase().includes('кит') ? 'Китай' : 'Турция');
        }
        if (step.field === 'idleDays') {
            const num = parseFloat(rawVal.replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) setIdleDays(num);
        }
        if (step.field === 'totalDays') {
            const num = parseFloat(rawVal.replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) setTotalDays(Math.max(num, 1));
        }
        if (step.field === 'bonus') {
            const num = parseFloat(rawVal.replace(/[^0-9.]/g, ''));
            if (!isNaN(num)) setBonus(num);
        }
        if (step.field === 'driverName') setDriverName(rawVal);

        const nextStep = aiStep + 1;
        if (nextStep > salarySteps.length) {
            setAiStep(0);
            setAiOutput('**Все поля успешно заполнены!** Калькулятор обновил цифры. Нажмите кнопку **«Фиксировать выплату»** справа.');
        } else {
            setAiStep(nextStep);
            setAiOutput(salarySteps[nextStep - 1].label);
        }
    }
    
    setAiInput('');
  };

  const filteredHistory = logs.filter(rec => {
        const haystack = `${rec.datetime || ''} ${rec.logist || ''} ${rec.driver || ''} ${rec.car || ''} ${rec.mark || ''} ${rec.km || ''} ${rec.rate || ''} ${rec.bonus || ''} ${rec.totalSalary || ''}`.toLowerCase();
        return !searchQuery || haystack.includes(searchQuery.toLowerCase());
  });

  const totalPaid = logs.reduce((s, r) => s + (r.totalSalary || 0), 0);
  const avgPaid = logs.length > 0 ? totalPaid / logs.length : 0;
  const maxPaid = logs.length > 0 ? Math.max(...logs.map(r => r.totalSalary || 0)) : 0;
  const uniqueDrivers = new Set(logs.map(r => r.driver || '').filter(Boolean)).size;

  return (
    <div className="w-full space-y-6">
        {/* Header Block */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col sm:flex-row justify-between gap-4 select-none items-center">
            <div>
                 <div className="flex items-center gap-2 mb-1.5">
                  <span className="bg-[#70FC8E] text-slate-950 font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono border border-black/5">
                    Расчет Выплат
                  </span>
                  <span className="text-[9px] text-slate-400 font-extrabold uppercase font-mono">Взаиморасчеты с Водителями</span>
                </div>
                <h1 className="text-xl sm:text-2xl lg:text-3xl font-black text-slate-900 uppercase tracking-tight flex items-center gap-2">
                  <Wallet className="h-6 w-6 text-slate-800" style={{ fill: '#70FC8E' }} />
                  Зарплата водителей
                </h1>
            </div>
             <div className="flex flex-wrap items-center gap-2">
            </div>
        </div>

        <div className="flex flex-col gap-6">

                {/* AI Assistant Panel */}
                <div className="bg-slate-900 rounded-[2rem] p-6 lg:p-8 text-white border border-slate-800 shadow-[0_8px_30px_rgba(0,0,0,0.12)] relative overflow-hidden flex flex-col h-auto min-h-[200px]">
                    <div className="absolute top-0 right-0 p-4 opacity-10 pointer-events-none"><Sparkles className="h-24 w-24 text-[#70FC8E]" /></div>
                    
                    <div className="flex justify-between items-start mb-6 z-10 relative">
                        <div>
                            <div className="flex items-center gap-2 mb-3">
                               <div className="px-2 py-0.5 rounded-full bg-[#70FC8E] text-[#143e1d] text-[10px] font-black uppercase font-mono tracking-widest shadow-sm">AI помощник</div>
                            </div>
                            <h3 className="text-xl font-black text-slate-100 tracking-tight">Пошаговый расчет выплаты</h3>
                            <p className="text-sm font-medium text-slate-400 mt-1 max-w-xl">Помощник задаст вопросы по рейсу и заполнит форму ниже. Для тарифов используйте вкладку «Настройки».</p>
                        </div>
                        {aiStep > 0 && (
                             <button onClick={resetAi} className="text-[10px] font-black uppercase tracking-wider text-slate-500 hover:text-slate-300 transition">Сброс</button>
                        )}
                    </div>
                    
                    <div className="flex-1 flex flex-col gap-4 z-10 relative mt-auto">
                        <div className="bg-slate-800/80 backdrop-blur-md rounded-2xl p-5 border border-slate-700/80 text-slate-300 text-sm font-medium leading-relaxed shadow-inner">
                             {aiStep > 0 && <div className="text-[#70FC8E] text-[10px] font-black uppercase tracking-wider mb-2">Шаг {aiStep} из {salarySteps.length}</div>}
                             {renderAiLabel(aiOutput)}
                             {aiStep === 0 && (
                                 <div className="mt-4">
                                     <button onClick={startAi} className="bg-[#70FC8E] text-slate-900 font-black px-5 py-2.5 rounded-xl text-xs uppercase tracking-wider hover:bg-[#5be277] shadow-sm transition border border-black/10">Начать расчет рейса</button>
                                 </div>
                             )}
                        </div>

                        <div className="flex gap-2">
                            <input 
                                type="text" 
                                value={aiInput} 
                                onChange={e => setAiInput(e.target.value)} 
                                placeholder={aiStep > 0 ? "Введите ответ помощнику..." : "Начните расчет..."}
                                disabled={aiStep === 0}
                                onKeyDown={e => e.key === 'Enter' && handleAiSubmit()}
                                className="flex-1 bg-slate-800 border border-slate-700 text-slate-100 text-sm font-bold px-4 py-3.5 rounded-2xl outline-none focus:border-[#70FC8E] transition disabled:opacity-50 placeholder:text-slate-500" 
                            />
                            <button 
                                onClick={handleAiSubmit} 
                                disabled={aiStep === 0}
                                className="bg-[#70FC8E] hover:bg-[#5be277] text-slate-900 shadow-sm font-black px-6 rounded-2xl flex items-center justify-center transition disabled:opacity-50">
                                <Send className="h-5 w-5" />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Calculator Form */}
                <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                    <div className="lg:col-span-3 bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)] relative overflow-hidden">
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
                            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight">Калькулятор рейса водителя</h2>
                            <div className="flex gap-2">
                                 <button onClick={clearForm} className="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2 rounded-xl text-xs transition">Очистить</button>
                                 <button onClick={saveToHistory} className="bg-[#70FC8E] hover:bg-[#5be277] text-slate-900 font-black px-4 py-2 rounded-xl text-xs uppercase tracking-wide flex items-center gap-2 transition border border-black/5">
                                     Фиксировать выплату <Wallet className="h-4 w-4" />
                                 </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Номер авто</label>
                                <input type="text" list="salary-cars-list" value={carNumber} onChange={e => handleCarNumberChange(e.target.value)} placeholder="Начните вводить..." className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition uppercase" />
                                <datalist id="salary-cars-list">
                                    {carsPool.flatMap((g, i) => (g.vehicles || []).map((v, j) => <option key={`pool-${i}-${j}-${v}`} value={v}>Ставка: {g.rate} € ({g.name})</option>))}
                                </datalist>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Ставка за км (€)</label>
                                <input type="number" step="0.001" value={ratePerKm} onChange={e => setRatePerKm(Number(e.target.value))} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Общий пробег (км)</label>
                                <input type="number" value={totalKm} onChange={e => setTotalKm(Number(e.target.value))} placeholder="5500" className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Пометка рейса</label>
                                <select value={tripMark} onChange={e => setTripMark(e.target.value)} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition">
                                    <option value="Турция">Турция</option>
                                    <option value="Китай">Китай</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Дней простоя ({currentIdleRate} €/д)</label>
                                <input type="number" value={idleDays} onChange={e => setIdleDays(Number(e.target.value))} min="0" className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Дней в рейсе ({currentPerDiem} €/д)</label>
                                <input type="number" value={totalDays} onChange={e => setTotalDays(Number(e.target.value))} min="1" className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-yellow-600">Премия (€)</label>
                                <input type="number" value={bonus} onChange={e => setBonus(Number(e.target.value))} min="0" className="w-full bg-yellow-50 border border-yellow-200 text-yellow-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-yellow-500 focus:bg-yellow-100 transition placeholder:text-yellow-600/50" placeholder="0" />
                            </div>
                            <div className="flex flex-col gap-1.5 col-span-2 sm:col-span-1">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">ФИО Водителя</label>
                                <input list="salary-drivers-dl" type="text" value={driverName} onChange={e => handleDriverNameChange(e.target.value)} placeholder="Иванов И.И." className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5 col-span-1 sm:col-span-2 lg:col-span-3">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Комментарий к выплате</label>
                                <input type="text" value={comment} onChange={e => setComment(e.target.value)} placeholder="Опционально (штрафы, детали, премии...)" className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                        </div>
                    </div>
                    <div className="lg:col-span-1">
                        <CalendarDaysCalculator onDaysCalculated={(days) => setTotalDays(days)} />
                    </div>
                </div>

                {/* Totals Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    <div className="bg-white rounded-3xl p-5 border border-slate-200/60 flex flex-col justify-center">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">За километраж</div>
                        <div className="text-2xl font-black text-slate-900 tracking-tight">{Math.round(kmMoney).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-white rounded-3xl p-5 border border-slate-200/60 flex flex-col justify-center">
                        <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Простой + Суточные</div>
                        <div className="text-2xl font-black text-slate-900 tracking-tight">{Math.round(idleMoney + daysMoney).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-yellow-50 rounded-3xl p-5 border border-yellow-200 flex flex-col justify-center">
                        <div className="text-[10px] font-black uppercase tracking-widest text-yellow-600 mb-1">Премия</div>
                        <div className="text-2xl font-black text-yellow-800 tracking-tight">{Math.round(bonus).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-slate-900 rounded-3xl p-5 border border-slate-800 flex flex-col justify-center shadow-md">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[#70FC8E]/60 mb-1">З/П за сутки</div>
                        <div className="text-3xl font-black text-[#70FC8E] tracking-tight">{Math.round(salaryPerDay).toLocaleString('ru-RU')} €</div>
                    </div>
                    <div className="bg-slate-900 rounded-3xl p-5 border border-slate-800 flex flex-col justify-center shadow-md">
                        <div className="text-[10px] font-black uppercase tracking-widest text-[#70FC8E]/60 mb-1">Итого водителю</div>
                        <div className="text-3xl font-black text-[#70FC8E] tracking-tight">{Math.round(totalSalary).toLocaleString('ru-RU')} €</div>
                    </div>
                </div>

            </div>

        {/* Global Statistics Grid (Full Width) */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
            <h2 className="text-sm font-black text-slate-900 uppercase tracking-tight mb-5 flex items-center gap-2"><Calculator className="h-4 w-4 text-[#70FC8E] fill-[#70FC8E]/20" /> Статистика выплат (По всей истории)</h2>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                 <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-center">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Выплат всего</div>
                    <div className="text-xl font-black text-slate-800">{logs.length}</div>
                </div>
                <div className="bg-slate-900 rounded-2xl p-4 border border-slate-800 flex flex-col justify-center shadow-md">
                    <div className="text-[10px] font-black uppercase tracking-widest text-[#70FC8E]/60 mb-1">Сумма всех выплат</div>
                    <div className="text-xl font-black text-[#70FC8E]">{Math.round(totalPaid).toLocaleString('ru-RU')} €</div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-center">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Средняя выплата</div>
                    <div className="text-xl font-black text-slate-800">{Math.round(avgPaid).toLocaleString('ru-RU')} €</div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-center">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Максимальная</div>
                    <div className="text-xl font-black text-slate-800">{Math.round(maxPaid).toLocaleString('ru-RU')} €</div>
                </div>
                <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 flex flex-col justify-center">
                    <div className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Уникальных водителей</div>
                    <div className="text-xl font-black text-slate-800">{uniqueDrivers}</div>
                </div>
            </div>
        </div>

        {/* History Cards / Recent Logs (Full Width) */}
        <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
            <h2 className="text-lg font-black text-slate-900 uppercase tracking-tight mb-4">Журнал последних выплат</h2>
            
            <div className="mb-4">
                <input type="text" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Поиск: Водитель, логист..." className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-sm px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] transition" />
            </div>

            <div className="space-y-3">
                {filteredHistory.length === 0 ? (
                    <div className="text-center py-10 text-slate-400 font-bold text-sm bg-slate-50 rounded-xl border border-slate-200/50 italic">История пустая</div>
                ) : (
                    filteredHistory.slice(0, 50).map((rec) => (
                        <div key={rec.id} className="bg-slate-50 border border-slate-200 rounded-[1.5rem] p-5 flex flex-col group hover:bg-white hover:border-[#70FC8E]/50 transition duration-300">
                            
                            {/* Header Row */}
                            <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-200">
                                <div className="flex items-center gap-3">
                                    <div className="bg-slate-950 text-[#70FC8E] px-3 py-1.5 rounded-xl text-xs font-black uppercase font-mono tracking-widest">{rec.driver}</div>
                                    <div className="text-xs font-bold text-slate-500 font-mono flex items-center gap-2">
                                       <span className="text-slate-400">ТС:</span> <span className="text-slate-800">{rec.car}</span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-4">
                                     <div className="text-xs font-mono font-bold text-slate-400 tracking-wider hidden sm:block">
                                        {rec.datetime} · Логист: {rec.logist || 'Система'}
                                     </div>
                                     <div className="text-[10px] font-mono font-bold text-slate-400 tracking-wider sm:hidden">
                                        {rec.logist || 'Система'}
                                     </div>
                                     <div className="flex gap-2">
                                         <button onClick={() => copyHistoryToForm(rec)} title="Дублировать в форму" className="text-slate-400 hover:text-green-600 transition opacity-0 group-hover:opacity-100">
                                             <Copy className="w-4 h-4" />
                                         </button>
                                         <button onClick={() => openEditModal(rec)} title="Редактировать" className="text-slate-400 hover:text-emerald-500 transition opacity-0 group-hover:opacity-100">
                                             <Edit className="w-4 h-4" />
                                         </button>
                                         <button onClick={() => {if(confirm('Удалить эту выплату?')) dbService.deleteSalary(rec.id, user.name, user.role); }} title="Удалить" className="text-slate-400 hover:text-rose-500 transition opacity-0 group-hover:opacity-100">
                                             <Trash2 className="w-4 h-4" />
                                         </button>
                                     </div>
                                </div>
                            </div>

                            {/* Details Grid (Row 1) */}
                            <div className="flex flex-wrap gap-x-6 gap-y-4 items-center">
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">Пробег</span>
                                    <span className="text-sm font-black text-slate-800 font-mono">{Math.round(rec.km || 0).toLocaleString('ru-RU')} км</span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">Ставка</span>
                                    <span className="text-sm font-black text-slate-800 font-mono">{rec.rate || 0} <span className="text-slate-500 text-[10px]">€/км</span></span>
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">В рейсе</span>
                                    <span className="text-sm font-black text-slate-800 font-mono">{rec.totalDays || 0} <span className="text-slate-400 text-[10px] ml-0.5">дн.</span></span>
                                </div>
                                {(rec.idleDays || 0) > 0 && (
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">Простой</span>
                                    <span className="text-sm font-black text-slate-800 font-mono">{rec.idleDays} <span className="text-slate-400 text-[10px]">дн.</span></span>
                                </div>
                                )}
                                <div className="flex flex-col">
                                    <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">Оценка</span>
                                    {rec.mark === 'Отлично' ? 
                                        <span className="text-[10px] font-bold text-[#143e1d] bg-[#70FC8E]/20 border border-[#70FC8E] px-2 py-0.5 rounded-lg w-max mt-0.5 shadow-sm">Отлично</span> 
                                        : 
                                        <span className="text-[10px] font-bold text-slate-700 bg-slate-200 border border-slate-300 px-2 py-0.5 rounded-lg w-max mt-0.5 shadow-sm">{rec.mark || 'Не оценено'}</span>
                                    }
                                </div>
                            </div>

                            {/* Second Row: Totals */}
                            <div className="mt-4 pt-4 border-t border-slate-100 flex flex-wrap gap-4 items-center justify-between">
                                <div className="flex gap-4 flex-wrap">
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">З/П за КМ</span>
                                        <span className="text-base font-black text-slate-700 font-mono">{Math.round(rec.kmMoney || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">Суточные</span>
                                        <span className="text-base font-black text-slate-700 font-mono">{Math.round(rec.daysMoney || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                    {(rec.idleMoney || 0) > 0 && (
                                    <div className="flex flex-col">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400 font-mono mb-1">Простой</span>
                                        <span className="text-base font-black text-slate-700 font-mono">{Math.round(rec.idleMoney || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                    )}
                                    {(rec.bonus || 0) > 0 && (
                                    <div className="flex flex-col px-3 py-1 bg-yellow-50 rounded-xl border border-yellow-200">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-yellow-600 font-mono mb-0.5">Премия</span>
                                        <span className="text-base font-black text-yellow-700 font-mono">+{Math.round(rec.bonus || 0)} €</span>
                                    </div>
                                    )}
                                </div>
                                <div className="flex gap-2.5">
                                    {(rec.totalDays || 0) > 0 && (
                                        <div className="flex flex-col bg-slate-50 border border-slate-200 px-4 py-2 rounded-2xl justify-center items-end shadow-[0_2px_10px_rgba(0,0,0,0.01)] min-w-[120px]">
                                            <span className="text-[10px] font-black uppercase tracking-widest text-slate-500 font-mono mb-0.5">З/П в день</span>
                                            <span className="text-2xl font-black text-slate-800 font-mono tracking-tight">{Math.round((rec.totalSalary || 0) / rec.totalDays).toLocaleString('ru-RU')} €</span>
                                        </div>
                                    )}
                                    <div className="flex flex-col bg-slate-900 border border-slate-800 px-4 py-2 rounded-2xl justify-center items-end shadow-md min-w-[130px]">
                                        <span className="text-[10px] font-black uppercase tracking-widest text-[#70FC8E]/60 font-mono mb-0.5">Итого к выплате</span>
                                        <span className="text-2xl font-black text-[#70FC8E] font-mono tracking-tight">{Math.round(rec.totalSalary || 0).toLocaleString('ru-RU')} €</span>
                                    </div>
                                </div>
                            </div>

                            {rec.comment && (
                                <div className="mt-5 pt-4 -mx-5 -mb-5 px-5 pb-4 border-t border-slate-200 text-sm font-medium text-slate-600 flex gap-2 items-start bg-slate-100/50 rounded-b-[1.5rem]">
                                    <span className="text-slate-400 font-mono text-[10px] font-black uppercase tracking-widest mt-0.5">Комментарий:</span>
                                    <span className="text-slate-800 font-mono text-xs">{rec.comment}</span>
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>

        {editingSalaryId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
                <div className="bg-white rounded-[2rem] w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl border border-slate-200">
                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50 rounded-t-[2rem]">
                        <h3 className="text-sm font-black uppercase tracking-wider text-slate-800 flex items-center gap-2">
                           <Edit className="w-5 h-5 text-emerald-500" /> Редактирование Выплаты
                        </h3>
                        <button onClick={closeEditModal} className="text-slate-400 hover:text-slate-600 bg-white shadow-sm border border-slate-200 w-8 h-8 rounded-full flex items-center justify-center font-bold">×</button>
                    </div>
                    
                    <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">ФИО Водителя</label>
                                <input type="text" list="salary-drivers-dl" value={editingSalaryData.driver || ''} onChange={e => {
                                     const val = e.target.value;
                                     const foundDriver = drivers.find(d => String(d.name || '').trim().toLowerCase() === val.trim().toLowerCase());
                                     if (foundDriver && foundDriver.rateGroupId) {
                                         const group = carsPool.find(g => g.id === foundDriver.rateGroupId);
                                         if (group) {
                                             setEditingSalaryData({
                                                 ...editingSalaryData,
                                                 driver: val,
                                                 rate: group.rate
                                             });
                                             return;
                                         }
                                     }
                                     setEditingSalaryData({...editingSalaryData, driver: val});
                                 }} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Транспорт</label>
                                <input type="text" value={editingSalaryData.car || ''} onChange={e => setEditingSalaryData({...editingSalaryData, car: e.target.value})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition uppercase" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Оценка</label>
                                <select value={editingSalaryData.mark || ''} onChange={e => setEditingSalaryData({...editingSalaryData, mark: e.target.value})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition cursor-pointer appearance-none">
                                    <option value="Хорошо">Хорошо</option>
                                    <option value="Отлично">Отлично</option>
                                    <option value="Удовлетворительно">Удовлетворительно</option>
                                    <option value="Турция">Турция</option>
                                </select>
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Ставка (€/км)</label>
                                <input type="number" step="0.001" value={editingSalaryData.rate || 0} onChange={e => setEditingSalaryData({...editingSalaryData, rate: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Пробег (км)</label>
                                <input type="number" value={editingSalaryData.km || 0} onChange={e => setEditingSalaryData({...editingSalaryData, km: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Простой (дней)</label>
                                <input type="number" value={editingSalaryData.idleDays || 0} onChange={e => setEditingSalaryData({...editingSalaryData, idleDays: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Дней в рейсе</label>
                                <input type="number" value={editingSalaryData.totalDays || 1} onChange={e => setEditingSalaryData({...editingSalaryData, totalDays: Number(e.target.value)})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5">
                                <label className="text-[11px] font-black uppercase tracking-wider text-yellow-600">Премия (€)</label>
                                <input type="number" value={editingSalaryData.bonus || 0} onChange={e => setEditingSalaryData({...editingSalaryData, bonus: Number(e.target.value)})} className="w-full bg-yellow-50 border border-yellow-200 text-yellow-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-yellow-500 focus:bg-yellow-100 transition" />
                            </div>
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Комментарий</label>
                                <input type="text" value={editingSalaryData.comment || ''} onChange={e => setEditingSalaryData({...editingSalaryData, comment: e.target.value})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                            <div className="flex flex-col gap-1.5 col-span-2">
                                <label className="text-[11px] font-black uppercase tracking-wider text-slate-500">Логист / Кто внёс</label>
                                <input type="text" value={editingSalaryData.logist || ''} onChange={e => setEditingSalaryData({...editingSalaryData, logist: e.target.value})} className="w-full bg-slate-50 border border-slate-200/60 text-slate-900 text-sm font-bold px-4 py-2.5 rounded-xl outline-none focus:border-[#0f7632] focus:bg-white transition" />
                            </div>
                        </div>
                    </div>
                    
                    <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50/50 rounded-b-[2rem]">
                        <button onClick={closeEditModal} className="px-6 py-3 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition cursor-pointer text-sm font-mono uppercase tracking-widest shadow-sm">Отмена</button>
                        <button onClick={saveEditModal} className="px-6 py-3 rounded-xl font-bold text-slate-950 bg-[#70FC8E] hover:bg-[#5ceb7d] transition flex items-center justify-center gap-2 border border-black/10 shadow-sm text-sm font-mono uppercase tracking-widest cursor-pointer">
                            Сохранить Изменения
                        </button>
                    </div>
                </div>
            </div>
        )}

        <datalist id="salary-drivers-dl">
            {drivers.map(drv => (
                <option key={drv.id} value={drv.name} />
            ))}
        </datalist>

    </div>
  );
}


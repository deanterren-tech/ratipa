import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Plus, 
  Search, 
  Trash2, 
  Edit2, 
  Copy, 
  Check, 
  AlertTriangle, 
  User, 
  Phone, 
  Calendar, 
  Sparkles, 
  X,
  ClipboardCheck,
  Shield
} from 'lucide-react';
import { dbService } from '../../firebase';
import { UserProfile } from '../../types';

interface VehicleDriverDataModuleProps {
  user: UserProfile;
}

export interface VehicleDriverRecord {
  id: string;
  vehicleNumbers: string;
  brands: string;
  driverName: string;
  birthDate: string;
  passportNumber: string;
  personalId: string;
  passportStart: string;
  passportEnd: string;
  passportIssuedBy: string;
  phone: string;
  dispatcher: string;
  lastPassportVerificationYear?: number;
}

export default function VehicleDriverDataModule({ user }: VehicleDriverDataModuleProps) {
  const [records, setRecords] = useState<VehicleDriverRecord[]>([]);
  const [systemUsers, setSystemUsers] = useState<UserProfile[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Form/Modal states
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  
  // Form fields state
  const [vehicleNumbers, setVehicleNumbers] = useState('');
  const [brands, setBrands] = useState('');
  const [driverName, setDriverName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [passportNumber, setPassportNumber] = useState('');
  const [personalId, setPersonalId] = useState('');
  const [passportStart, setPassportStart] = useState('');
  const [passportEnd, setPassportEnd] = useState('');
  const [passportIssuedBy, setPassportIssuedBy] = useState('');
  const [phone, setPhone] = useState('');
  const [dispatcher, setDispatcher] = useState('');
  
  // AI assistant state
  const [aiText, setAiText] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  // Clipboard copies
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Passport Verification Modal queue state
  const [verificationQueue, setVerificationQueue] = useState<VehicleDriverRecord[]>([]);
  const [currentVerification, setCurrentVerification] = useState<VehicleDriverRecord | null>(null);

  useEffect(() => {
    // Fetch data
    const unsubData = dbService.getVehicleDriverData((list) => {
      setRecords(list);
    });

    const unsubUsers = dbService.getUsers((users) => {
      setSystemUsers(users);
    });

    return () => {
      unsubData();
      unsubUsers();
    };
  }, []);

  // Process passport verification queue on data load
  useEffect(() => {
    if (records.length === 0) return;

    const today = new Date();
    const currentYear = today.getFullYear();

    // Check if there are any records whose passport start anniversary has passed this year
    // and hasn't been verified for the current year yet.
    const pendingVerifications = records.filter(rec => {
      if (!rec.passportStart) return false;
      const parts = rec.passportStart.split('.');
      if (parts.length !== 3) return false;

      const day = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const year = parseInt(parts[2], 10);

      // Must be at least a year later
      if (currentYear <= year) return false;

      // Anniversary date in current year
      const anniversaryDate = new Date(currentYear, month, day);

      // If today is on or after the anniversary date this year, and lastPassportVerificationYear !== currentYear
      const isAnniversaryPassed = today >= anniversaryDate;
      const needsVerification = rec.lastPassportVerificationYear !== currentYear;

      return isAnniversaryPassed && needsVerification;
    });

    if (pendingVerifications.length > 0 && !currentVerification) {
      setVerificationQueue(pendingVerifications);
      setCurrentVerification(pendingVerifications[0]);
    }
  }, [records, currentVerification]);

  const handleVerifySuccess = async (rec: VehicleDriverRecord) => {
    const currentYear = new Date().getFullYear();
    const updated = {
      ...rec,
      lastPassportVerificationYear: currentYear
    };
    dbService.saveVehicleDriverRecord(updated, user.name, user.role);
    
    // Remove from queue
    const remaining = verificationQueue.filter(q => q.id !== rec.id);
    setVerificationQueue(remaining);
    if (remaining.length > 0) {
      setCurrentVerification(remaining[0]);
    } else {
      setCurrentVerification(null);
    }
  };

  const handleVerifyEdit = (rec: VehicleDriverRecord) => {
    // Open edit modal directly for this record
    openEdit(rec);
    // Remove from verification queue so it doesn't block
    const remaining = verificationQueue.filter(q => q.id !== rec.id);
    setVerificationQueue(remaining);
    if (remaining.length > 0) {
      setCurrentVerification(remaining[0]);
    } else {
      setCurrentVerification(null);
    }
  };

  const handleVerifySkip = (rec: VehicleDriverRecord) => {
    // Just skip for this session
    const remaining = verificationQueue.filter(q => q.id !== rec.id);
    setVerificationQueue(remaining);
    if (remaining.length > 0) {
      setCurrentVerification(remaining[0]);
    } else {
      setCurrentVerification(null);
    }
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setVehicleNumbers('');
    setBrands('');
    setDriverName('');
    setBirthDate('');
    setPassportNumber('');
    setPersonalId('');
    setPassportStart('');
    setPassportEnd('');
    setPassportIssuedBy('');
    setPhone('');
    setDispatcher('');
    setAiText('');
    setAiError('');
    setModalOpen(true);
  };

  const openEdit = (rec: VehicleDriverRecord) => {
    setEditingId(rec.id);
    setVehicleNumbers(rec.vehicleNumbers || '');
    setBrands(rec.brands || '');
    setDriverName(rec.driverName || '');
    setBirthDate(rec.birthDate || '');
    setPassportNumber(rec.passportNumber || '');
    setPersonalId(rec.personalId || '');
    setPassportStart(rec.passportStart || '');
    setPassportEnd(rec.passportEnd || '');
    setPassportIssuedBy(rec.passportIssuedBy || '');
    setPhone(rec.phone || '');
    setDispatcher(rec.dispatcher || '');
    setAiText('');
    setAiError('');
    setModalOpen(true);
  };

  const handleSave = () => {
    if (
      !vehicleNumbers.trim() ||
      !brands.trim() ||
      !driverName.trim() ||
      !birthDate.trim() ||
      !passportNumber.trim() ||
      !personalId.trim() ||
      !passportStart.trim() ||
      !passportEnd.trim() ||
      !passportIssuedBy.trim() ||
      !phone.trim() ||
      !dispatcher.trim()
    ) {
      alert('Пожалуйста, заполните абсолютно все поля. Все графы обязательны для заполнения!');
      return;
    }

    const recordId = editingId || "rec_" + Date.now();
    const existingRec = records.find(r => r.id === recordId);

    const record: VehicleDriverRecord = {
      id: recordId,
      vehicleNumbers: vehicleNumbers.trim(),
      brands: brands.trim(),
      driverName: driverName.trim(),
      birthDate: birthDate.trim(),
      passportNumber: passportNumber.trim(),
      personalId: personalId.trim(),
      passportStart: passportStart.trim(),
      passportEnd: passportEnd.trim(),
      passportIssuedBy: passportIssuedBy.trim(),
      phone: phone.trim(),
      dispatcher: dispatcher.trim(),
      lastPassportVerificationYear: existingRec?.lastPassportVerificationYear || 0
    };

    dbService.saveVehicleDriverRecord(record, user.name, user.role);
    setModalOpen(false);
  };

  const handleDelete = (id: string) => {
    if (confirm('Вы уверены, что хотите удалить эту запись?')) {
      dbService.deleteVehicleDriverRecord(id, user.name, user.role);
    }
  };

  const handleAiParse = async () => {
    if (!aiText.trim()) {
      setAiError('Введите текст для распознавания');
      return;
    }

    setAiLoading(true);
    setAiError('');

    try {
      const res = await fetch('/api/parse-driver-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: aiText })
      });

      if (!res.ok) {
        throw new Error('Ошибка связи с сервером AI');
      }

      const data = await res.json();
      if (data.results) {
        const r = data.results;
        if (r.vehicleNumbers) setVehicleNumbers(r.vehicleNumbers);
        if (r.brands) setBrands(r.brands);
        if (r.driverName) setDriverName(r.driverName);
        if (r.birthDate) setBirthDate(r.birthDate);
        if (r.passportNumber) setPassportNumber(r.passportNumber);
        if (r.personalId) setPersonalId(r.personalId);
        if (r.passportStart) setPassportStart(r.passportStart);
        if (r.passportEnd) setPassportEnd(r.passportEnd);
        if (r.passportIssuedBy) setPassportIssuedBy(r.passportIssuedBy);
        if (r.phone) setPhone(r.phone);
        if (r.dispatcher) setDispatcher(r.dispatcher);
      } else {
        setAiError('Не удалось корректно распознать данные. Попробуйте еще раз.');
      }
    } catch (err: any) {
      console.error(err);
      setAiError(err.message || 'Ошибка распознавания');
    } finally {
      setAiLoading(false);
    }
  };

  const copyToClipboard = (rec: VehicleDriverRecord) => {
    const text = `${rec.vehicleNumbers}
Марки: ${rec.brands}
Водитель: ${rec.driverName}
Дата рождения: ${rec.birthDate}
Паспорт: ${rec.passportNumber}
Идентификационный номер: ${rec.personalId}
Срок: ${rec.passportStart} – ${rec.passportEnd}
Выдан: ${rec.passportIssuedBy}
Телефон: ${rec.phone}`;

    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(rec.id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const filteredRecords = records.filter(rec => {
    const haystack = `${rec.vehicleNumbers} ${rec.brands} ${rec.driverName} ${rec.passportNumber} ${rec.dispatcher}`.toLowerCase();
    return haystack.includes(searchQuery.toLowerCase());
  });

  const dispatchersList = systemUsers
    .filter(u => u.role === 'dispatcher' || u.role === 'root_admin' || u.role === 'Диспетчер')
    .map(u => u.name)
    .filter((v, i, a) => a.indexOf(v) === i); // deduplicate

  // Fallback default dispatchers if list is empty
  const defaultDispatchers = dispatchersList.length > 0 ? dispatchersList : ['Юрий', 'Алексей', 'Татьяна', 'Сергей'];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-2.5">
              <FileText className="w-5.5 h-5.5 text-emerald-500" />
              <span>Данные по авто и водителям</span>
            </h1>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-wider font-mono mt-1">
              База данных паспортных реквизитов, телефонной связи и закрепленных диспетчеров
            </p>
          </div>
          
          <button
            onClick={handleOpenAdd}
            className="px-5 py-3 bg-[#70FC8E] hover:bg-[#5be277] text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition shadow-md border border-black/5 flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Добавить данные</span>
          </button>
        </div>

        {/* Search */}
        <div className="mt-6 relative">
          <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
            <Search className="w-4 h-4" />
          </span>
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Поиск по номерам ТС, бренду, имени водителя, паспорту или диспетчеру..."
            className="w-full bg-slate-50 border border-slate-200 text-slate-800 text-xs font-bold pl-10 pr-4 py-3 rounded-xl outline-none focus:border-emerald-500 transition shadow-inner"
          />
        </div>
      </div>

      {/* Grid List */}
      {filteredRecords.length === 0 ? (
        <div className="bg-white rounded-[2rem] p-12 text-center border border-slate-200/60 shadow-sm text-slate-400 font-bold text-sm italic">
          Записи не найдены. Нажмите «Добавить данные», чтобы занести новые сведения.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecords.map((rec) => {
            const isAnniversaryPassed = rec.passportStart ? (() => {
              const parts = rec.passportStart.split('.');
              if (parts.length === 3) {
                const day = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const year = parseInt(parts[2], 10);
                const anniversary = new Date(new Date().getFullYear(), month, day);
                return new Date() >= anniversary && new Date().getFullYear() > year;
              }
              return false;
            })() : false;

            const needsVerificationThisYear = rec.lastPassportVerificationYear !== new Date().getFullYear();
            const showVerificationIndicator = isAnniversaryPassed && needsVerificationThisYear;

            return (
              <div 
                key={rec.id} 
                className="bg-white rounded-3xl border border-slate-200/60 shadow-xs flex flex-col overflow-hidden hover:shadow-md transition duration-200 relative"
              >
                {/* Anniversary Indicator Ribbon */}
                {showVerificationIndicator && (
                  <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] font-black uppercase tracking-wider px-3 py-1 rounded-bl-xl shadow-xs flex items-center gap-1 z-10">
                    <AlertTriangle className="w-3 h-3 animate-pulse" />
                    <span>Требует верификации</span>
                  </div>
                )}

                {/* Card Header */}
                <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="text-xs font-black text-slate-800 uppercase tracking-tight">
                      {rec.vehicleNumbers}
                    </div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono">
                      Марки: {rec.brands}
                    </div>
                  </div>
                  <div className="bg-slate-200/70 border border-slate-300 text-slate-700 px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider font-mono shadow-2xs">
                    Диспетчер: {rec.dispatcher}
                  </div>
                </div>

                {/* Text representation card */}
                <div className="p-5 flex-1 space-y-4">
                  {/* Preformatted text block (like user requested) */}
                  <div className="bg-slate-900 text-slate-100 rounded-2xl p-4 font-mono text-[11px] leading-relaxed relative group">
                    <div className="text-[#70FC8E] border-b border-slate-800 pb-1.5 mb-2 flex items-center justify-between text-[8px] font-black tracking-widest uppercase">
                      <span>КОПИРУЕМЫЙ БЛОК ДАННЫХ</span>
                      <button
                        onClick={() => copyToClipboard(rec)}
                        className="text-[#70FC8E] hover:text-white transition flex items-center gap-1 p-0.5 cursor-pointer bg-slate-800 rounded px-1.5 border border-slate-700"
                        title="Скопировать весь блок"
                      >
                        {copiedId === rec.id ? <ClipboardCheck className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        <span>{copiedId === rec.id ? 'Скопировано!' : 'Копировать'}</span>
                      </button>
                    </div>
                    <div>{rec.vehicleNumbers}</div>
                    <div>Марки: {rec.brands}</div>
                    <div>Водитель: {rec.driverName}</div>
                    <div>Дата рождения: {rec.birthDate}</div>
                    <div>Паспорт: {rec.passportNumber}</div>
                    <div>Идентификационный номер: {rec.personalId}</div>
                    <div>Срок: {rec.passportStart} – {rec.passportEnd}</div>
                    <div>Выдан: {rec.passportIssuedBy}</div>
                    <div>Телефон: {rec.phone}</div>
                  </div>

                  {/* UI Quick Info */}
                  <div className="grid grid-cols-2 gap-3 text-xs pt-1">
                    <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                      <User className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{rec.driverName.split(' ')[0]}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-slate-600 font-medium">
                      <Phone className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{rec.phone}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="px-5 py-4 border-t border-slate-100 bg-slate-50/40 flex justify-between gap-2.5">
                  <button
                    onClick={() => openEdit(rec)}
                    className="flex-1 py-2 px-3 hover:bg-slate-100 text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 font-bold text-[10px] uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer font-mono"
                  >
                    <Edit2 className="w-3 h-3" />
                    <span>Редактировать</span>
                  </button>
                  <button
                    onClick={() => handleDelete(rec.id)}
                    className="py-2 px-3 text-rose-500 hover:text-rose-600 hover:bg-rose-50 border border-slate-200 hover:border-rose-100 rounded-xl transition flex items-center justify-center cursor-pointer"
                    title="Удалить"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Annual Passport Verification Pop-up Prompt */}
      {currentVerification && (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-md shadow-2xl p-6 border border-slate-100 flex flex-col gap-4 text-center">
            <div className="mx-auto bg-amber-50 text-amber-500 p-3.5 rounded-full shadow-sm w-max">
              <AlertTriangle className="w-8 h-8 animate-bounce" />
            </div>
            
            <div>
              <h3 className="text-sm font-black text-slate-800 uppercase tracking-tight">Ежегодная проверка актуальности</h3>
              <div className="text-[10px] font-black uppercase text-amber-500 font-mono tracking-widest mt-0.5">Требуется подтверждение данных паспорта</div>
            </div>

            <p className="text-xs text-slate-500 leading-relaxed font-medium">
              Уважаемый диспетчер! Сегодня наступила дата ежегодной сверки паспортных реквизитов для водителя:
              <br />
              <strong className="text-slate-900 text-sm block my-2 underline">
                {currentVerification.driverName}
              </strong>
              Паспорт серии <span className="font-mono font-bold text-slate-800">{currentVerification.passportNumber}</span>, дата выдачи: <span className="font-mono font-bold text-slate-800">{currentVerification.passportStart}</span>.
              <br />
              Данные паспорта по-прежнему актуальны?
            </p>

            <div className="flex flex-col gap-2 pt-2">
              <button
                onClick={() => handleVerifySuccess(currentVerification)}
                className="w-full py-3 bg-[#70FC8E] hover:bg-[#5be277] text-slate-950 font-black text-xs uppercase tracking-widest rounded-xl transition border border-black/5 cursor-pointer shadow-sm"
              >
                Да, данные актуальны
              </button>
              
              <div className="flex gap-2">
                <button
                  onClick={() => handleVerifyEdit(currentVerification)}
                  className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-black text-[10px] uppercase tracking-wider rounded-xl transition cursor-pointer border border-slate-200"
                >
                  Нет, редактировать
                </button>
                <button
                  onClick={() => handleVerifySkip(currentVerification)}
                  className="flex-1 py-2.5 bg-white hover:bg-slate-50 text-slate-400 font-bold text-[10px] uppercase tracking-wider rounded-xl transition cursor-pointer border border-slate-200"
                >
                  Пропустить
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit / Add Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
          <div className="bg-white rounded-3xl w-full max-w-2xl shadow-2xl overflow-hidden flex flex-col pt-1 my-8">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50">
              <div className="flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-500" />
                <h3 className="text-xs font-black text-slate-800 uppercase tracking-tight">
                  {editingId ? 'Редактировать запись' : 'Добавить новые данные авто и водителя'}
                </h3>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="w-8 h-8 rounded-full bg-white border border-slate-200 hover:bg-slate-50 flex items-center justify-center transition text-slate-500 font-bold text-lg"
              >
                ×
              </button>
            </div>

            {/* AI Input Assistant block */}
            <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 text-white space-y-3">
              <div className="flex items-center gap-1.5 text-[10px] font-black text-[#70FC8E] uppercase tracking-widest font-mono">
                <Sparkles className="w-4 h-4 animate-pulse" />
                <span>ИИ Помощник по заполнению данных</span>
              </div>
              
              <div className="text-[10px] text-slate-300 font-medium leading-relaxed">
                Вы можете вставить сырой скопированный текст (из мессенджера или файла), и ИИ автоматически разложит все данные по нужным графам!
              </div>

              <div className="flex gap-2">
                <textarea
                  value={aiText}
                  onChange={e => setAiText(e.target.value)}
                  placeholder="Вставьте сюда любой текст с данными..."
                  className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-100 placeholder-slate-500 outline-none focus:border-[#70FC8E] resize-none h-[54px] font-mono"
                />
                <button
                  type="button"
                  onClick={handleAiParse}
                  disabled={aiLoading}
                  className="px-4 bg-[#70FC8E] hover:bg-[#5be277] disabled:bg-slate-800 text-slate-950 disabled:text-slate-500 font-black text-[10px] uppercase tracking-widest rounded-xl transition flex items-center justify-center gap-1 border border-black/5 shadow-sm shrink-0 cursor-pointer"
                >
                  {aiLoading ? 'Анализ...' : 'Распознать ИИ'}
                </button>
              </div>

              {aiError && (
                <div className="text-rose-400 text-[10px] font-bold font-mono pl-1">
                  ⚠ Ошибка: {aiError}
                </div>
              )}
            </div>

            {/* Form Fields */}
            <div className="p-6 overflow-y-auto max-h-[50vh] space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* 1. Номера ТС */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Гос. номера Тягач / Полуприцеп <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={vehicleNumbers}
                    onChange={e => setVehicleNumbers(e.target.value)}
                    placeholder="AE 6052-7 / A 2453 Е-7"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 2. Марки */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Марки Тягач / Полуприцеп <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={brands}
                    onChange={e => setBrands(e.target.value)}
                    placeholder="Volvo / KOEGEL"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 3. Водитель */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    ФИО Водителя (Кириллица и Латиница) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={driverName}
                    onChange={e => setDriverName(e.target.value)}
                    placeholder="Устинов Олег Леонидович (USTSINAU ALEH)"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 4. Дата рождения */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Дата рождения <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={birthDate}
                    onChange={e => setBirthDate(e.target.value)}
                    placeholder="08.02.1973"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 5. Паспорт */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Серия и номер Паспорта <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportNumber}
                    onChange={e => setPassportNumber(e.target.value)}
                    placeholder="МР 5065058"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 6. Идентификационный номер */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Идентификационный номер <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={personalId}
                    onChange={e => setPersonalId(e.target.value)}
                    placeholder="3080273A018PB6"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition font-mono uppercase"
                  />
                </div>

                {/* 7. Срок начала */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Дата выдачи паспорта (Срок от) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportStart}
                    onChange={e => setPassportStart(e.target.value)}
                    placeholder="09.01.2024"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 8. Срок конца */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Дата окончания паспорта (Срок до) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportEnd}
                    onChange={e => setPassportEnd(e.target.value)}
                    placeholder="09.01.2034"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 9. Выдан */}
                <div className="space-y-1 md:col-span-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Кем выдан паспорт <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={passportIssuedBy}
                    onChange={e => setPassportIssuedBy(e.target.value)}
                    placeholder="Фрунзенским РУВД г. Минска"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 10. Телефон */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Телефон водителя <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    placeholder="+375 29 538-96-00"
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition"
                  />
                </div>

                {/* 11. Диспетчер */}
                <div className="space-y-1">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-wider font-mono">
                    Закрепленный диспетчер <span className="text-rose-500">*</span>
                  </label>
                  <select
                    value={dispatcher}
                    onChange={e => setDispatcher(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-xs font-bold text-slate-800 outline-none focus:border-emerald-500 transition cursor-pointer"
                  >
                    <option value="">Выберите диспетчера...</option>
                    {defaultDispatchers.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
              <button
                onClick={() => setModalOpen(false)}
                className="px-6 py-2.5 rounded-xl font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 transition text-xs font-mono uppercase tracking-widest cursor-pointer shadow-xs"
              >
                Отмена
              </button>
              <button
                onClick={handleSave}
                className="px-6 py-2.5 rounded-xl font-black text-slate-950 bg-[#70FC8E] hover:bg-[#5be277] transition border border-black/10 shadow-sm text-xs font-mono uppercase tracking-widest cursor-pointer"
              >
                {editingId ? 'Сохранить изменения' : 'Создать запись'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const fs = require('fs');
let code = fs.readFileSync('src/components/modules/VehicleDriverDataModule.tsx', 'utf-8');

const mapLogic = `          {filteredRecords.map((rec) => {
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
            
            return (`;

const replaceIndex = code.indexOf(mapLogic);

// We want to extract the rendering function. Let's do it an easier way.
// We'll replace the grid rendering section.

const renderBlockTarget = `      {/* Grid List */}
      {filteredRecords.length === 0 ? (
        <div className="bg-white rounded-[2rem] p-12 text-center border border-slate-200/60 shadow-sm text-slate-400 font-bold text-sm italic">
          Записи не найдены. Нажмите «Добавить данные», чтобы занести новые сведения.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">`;

const replacement = `      {/* Grid List */}
      {filteredRecords.length === 0 ? (
        <div className="bg-white rounded-[2rem] p-12 text-center border border-slate-200/60 shadow-sm text-slate-400 font-bold text-sm italic">
          Записи не найдены. Нажмите «Добавить данные», чтобы занести новые сведения.
        </div>
      ) : (
        <>
          {activeTab === 'all' && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredRecords.map(renderCard)}
            </div>
          )}
          {activeTab === 'by-dispatcher' && (
            <div className="space-y-8">
              {Array.from(new Set(filteredRecords.map(r => r.dispatcher || 'Без диспетчера'))).sort().map(dispatcher => (
                <div key={dispatcher} className="space-y-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-black text-slate-800 uppercase tracking-tight">{dispatcher}</h2>
                    <div className="h-px flex-1 bg-slate-200"></div>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredRecords.filter(r => (r.dispatcher || 'Без диспетчера') === dispatcher).map(renderCard)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      `;

// We also need to define renderCard before the return statement
const renderCardDefTarget = `  const defaultDispatchers = dispatchersList.length > 0 ? dispatchersList : ['Юрий', 'Алексей', 'Татьяна', 'Сергей'];`;

const renderCardDef = `  const defaultDispatchers = dispatchersList.length > 0 ? dispatchersList : ['Юрий', 'Алексей', 'Татьяна', 'Сергей'];

  const renderCard = (rec: VehicleDriverRecord) => {
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
        {showVerificationIndicator && (
          <div className="absolute top-0 right-0 bg-amber-500 text-white text-[8px] font-black uppercase tracking-wider px-3 py-1 rounded-bl-xl shadow-xs flex items-center gap-1 z-10">
            <AlertTriangle className="w-3 h-3 animate-pulse" />
            <span>Требует верификации</span>
          </div>
        )}
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
        <div className="p-5 flex-1 space-y-4">
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
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs pt-1">
            <div className="flex items-center gap-1.5 text-slate-600 font-medium">
              <User className="w-3.5 h-3.5 text-slate-400" />
              <span className="truncate">{rec.driverName.split(/\\s+/).slice(0, 2).join(' ')}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-600 font-medium">
              <Phone className="w-3.5 h-3.5 text-slate-400" />
              <span className="truncate">{rec.phone}</span>
            </div>
          </div>
        </div>
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
  };
`;

// we need to replace from the start of mapLogic to the end of the map:
// we find the map block
const indexOfMapLogic = code.indexOf(mapLogic);

if (indexOfMapLogic !== -1) {
  // Let's find the closing of the grid list.
  // The map closes with `          })}
  //        </div>
  //      )}
  //      {/* Annual Passport`
  const closePattern = '          })}\n        </div>';
  const closeIndex = code.indexOf(closePattern, indexOfMapLogic);
  
  if (closeIndex !== -1) {
    code = code.substring(0, code.indexOf(renderBlockTarget)) + replacement + code.substring(closeIndex + closePattern.length);
  } else {
    console.log('Close index not found');
  }
} else {
  console.log('Map logic not found');
}

code = code.replace(renderCardDefTarget, renderCardDef);

fs.writeFileSync('src/components/modules/VehicleDriverDataModule.tsx', code);

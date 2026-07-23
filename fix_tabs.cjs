const fs = require('fs');
let code = fs.readFileSync('src/components/modules/VehicleDriverDataModule.tsx', 'utf-8');

// 1. Change activeTab type
code = code.replace(
  "const [activeTab, setActiveTab] = useState<'all' | 'by-dispatcher'>('all');",
  "const [activeTab, setActiveTab] = useState<string>('all');"
);

// 2. We need to update the rendering of the tabs
const tabButtonsTarget = `<div className="flex gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('all')}
          className={\`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all \${
            activeTab === 'all' 
              ? 'bg-slate-800 text-white shadow-md' 
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
          }\`}
        >
          Все авто
        </button>
        <button
          onClick={() => setActiveTab('by-dispatcher')}
          className={\`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all \${
            activeTab === 'by-dispatcher' 
              ? 'bg-slate-800 text-white shadow-md' 
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
          }\`}
        >
          По диспетчерам
        </button>
      </div>`;

const tabButtonsReplacement = `<div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2">
        <button
          onClick={() => setActiveTab('all')}
          className={\`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all \${
            activeTab === 'all' 
              ? 'bg-slate-800 text-white shadow-md' 
              : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
          }\`}
        >
          Все авто
        </button>
        {defaultDispatchers.map(dispatcher => (
          <button
            key={dispatcher}
            onClick={() => setActiveTab(dispatcher)}
            className={\`px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all \${
              activeTab === dispatcher 
                ? 'bg-slate-800 text-white shadow-md' 
                : 'bg-white text-slate-500 border border-slate-200 hover:bg-slate-50'
            }\`}
          >
            {dispatcher}
          </button>
        ))}
      </div>`;

if (code.includes(tabButtonsTarget)) {
  code = code.replace(tabButtonsTarget, tabButtonsReplacement);
} else {
  console.log('Tab buttons target not found');
}

// 3. We need to update the Grid List
const gridListTarget = `{/* Grid List */}
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
      )}`;

const gridListReplacement = `{/* Grid List */}
      {filteredRecords.length === 0 ? (
        <div className="bg-white rounded-[2rem] p-12 text-center border border-slate-200/60 shadow-sm text-slate-400 font-bold text-sm italic">
          Записи не найдены. Нажмите «Добавить данные», чтобы занести новые сведения.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredRecords
            .filter(r => activeTab === 'all' || (r.dispatcher || 'Без диспетчера') === activeTab)
            .map(renderCard)}
        </div>
      )}`;

if (code.includes(gridListTarget)) {
  code = code.replace(gridListTarget, gridListReplacement);
} else {
  console.log('Grid list target not found');
}

fs.writeFileSync('src/components/modules/VehicleDriverDataModule.tsx', code);
console.log('Vehicle Driver changes applied.');

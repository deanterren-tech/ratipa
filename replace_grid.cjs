const fs = require('fs');
let code = fs.readFileSync('src/components/modules/VehicleDriverDataModule.tsx', 'utf-8');

const targetStart = '      ) : (\n        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">\n          {filteredRecords.map((rec) => {';
const targetEnd = '            );\n          })}\n        </div>\n      )}';

const replacement = `      ) : (
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

const startIdx = code.indexOf(targetStart);
if (startIdx !== -1) {
  const endIdx = code.indexOf(targetEnd, startIdx);
  if (endIdx !== -1) {
    code = code.substring(0, startIdx) + replacement + code.substring(endIdx + targetEnd.length);
    fs.writeFileSync('src/components/modules/VehicleDriverDataModule.tsx', code);
    console.log("Replaced successfully.");
  } else {
    console.log("targetEnd not found");
  }
} else {
  console.log("targetStart not found");
}

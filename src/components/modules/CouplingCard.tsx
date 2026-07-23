import {useState, useEffect} from 'react'
import {dbService} from '../../api'
import {Truck, User, Calendar, MapPin, X, ArrowLeft} from 'lucide-react'

interface CouplingCardProps {
  carNumber: string;
  onClose: () => void;
  onOpenDriver: (driverId: string, driverName: string) => void;
}

export default function CouplingCard({ carNumber, onClose, onOpenDriver }: CouplingCardProps) {
  const [center, setCenter] = useState<any>(null);
  const [bazaRec, setBazaRec] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);

  useEffect(() => {
    // center (soft reference - read only)
    const u1 = dbService.getVehicleDriverData((list: any[]) => {
      const found = (list || []).find((c) => (c.carNumber || c.vehicleNumbers || '').replace(/[^А-ЯA-Z0-9]/g, '') === carNumber.replace(/[^А-ЯA-Z0-9]/g, ''));
      setCenter(found || null);
    });
    // baza (Учёт выезда) - is this coupling currently there?
    const u2 = dbService.getBazaRecords((list: any[]) => {
      const found = (list || []).find((c) => (c.carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '') === carNumber.replace(/[^А-ЯA-Z0-9]/g, ''));
      setBazaRec(found || null);
    });
    // plan dohod trips
    const u3 = dbService.getPlanDohod((list: any[]) => {
      const found = (list || []).filter((t) => (t.carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '') === carNumber.replace(/[^А-ЯA-Z0-9]/g, ''));
      setTrips(found.slice(0, 5));
    });
    return () => { u1(); u2(); u3(); };
  }, [carNumber]);

  const inBaza = !!bazaRec;
  const bazaStatus = bazaRec?.status || (inBaza ? 'base' : null);
  const driverId = center?.driverId;
  const driverName = center?.driverNameRu || center?.driverName || center?.driverShortNameRu || bazaRec?.driverName || '';

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-[#3765F6]/10 to-transparent border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#3765F6]/10 flex items-center justify-center">
              <Truck className="w-5 h-5 text-[#3765F6]" />
            </div>
            <div>
              <div className="text-lg font-black text-slate-900 font-mono">{center?.coupling || carNumber}</div>
              <div className="text-[11px] text-slate-400 font-mono">
                {center?.trailerNumber ? `${center.trailerNumber}` : '—'}
                {(center?.brandModel || center?.brandsRu || center?.brand) ? ` · ${center.brandModel || center?.brandsRu || center?.brand}` : ''}
                {center?.trailerMake ? ` / ${center.trailerMake}` : ''}
                {center?.year ? ` · ${center.year} г.` : ''}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Location status (soft link to Учёт выезда) */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50">
            <MapPin className={`w-5 h-5 ${inBaza ? 'text-emerald-500' : 'text-slate-300'}`} />
            <div className="flex-1">
              <div className="text-[10px] font-bold uppercase text-slate-400">Местонахождение (Учёт выезда)</div>
              {inBaza ? (
                <div className="text-sm font-semibold text-slate-800">
                  В учёте выезда · статус: {bazaStatus === 'base' ? 'на базе' : bazaStatus === 'departure' ? 'в рейсе' : bazaStatus || '—'}
                  {bazaRec?.dateDeparture ? ` · выезд ${bazaRec.dateDeparture}` : ''}
                </div>
              ) : (
                <div className="text-sm text-slate-500">Сейчас не в учёте выезда</div>
              )}
            </div>
          </div>

          {/* Driver (soft link) */}
          {driverName && (
            <button onClick={() => onOpenDriver(driverId || '', driverName)}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-blue-50 transition text-left">
              <User className="w-5 h-5 text-[#3765F6]" />
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase text-slate-400">Водитель (из базы)</div>
                <div className="text-sm font-semibold text-slate-800">{driverName}</div>
              </div>
              <ArrowLeft className="w-4 h-4 text-slate-300 rotate-180" />
            </button>
          )}

          {/* Vehicle data (from базы сцепок) */}
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> Данные по авто
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Марка тягача</div>
                <div className="text-sm font-semibold text-slate-800">{center?.brandModel || center?.brandsRu || center?.brand || '—'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Марка прицепа</div>
                <div className="text-sm font-semibold text-slate-800">{center?.trailerMake || '—'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Тип</div>
                <div className="text-sm font-semibold text-slate-800">{center?.vehicleType || '—'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Год</div>
                <div className="text-sm font-semibold text-slate-800">{center?.year || '—'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Габариты</div>
                <div className="text-sm font-semibold text-slate-800">{center?.dimensions || '—'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Вес</div>
                <div className="text-sm font-semibold text-slate-800">{center?.weight || '—'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Ставка</div>
                <div className="text-sm font-semibold text-slate-800">{center?.rate != null ? `${center.rate} €` : '—'}</div>
              </div>
              <div className="p-3 rounded-2xl bg-slate-50">
                <div className="text-[10px] font-bold uppercase text-slate-400">Диспетчер</div>
                <div className="text-sm font-semibold text-slate-800">{center?.dispatcher || '—'}</div>
              </div>
            </div>
          </div>

          {/* Plan dohod (soft link) */}
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> План дохода (последние рейсы)
            </div>
            {trips.length === 0 ? (
              <div className="text-xs text-slate-400 p-2">Нет данных в плане дохода</div>
            ) : (
              <div className="space-y-1.5">
                {trips.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 rounded-xl bg-slate-50">
                    <span className="font-mono text-slate-700">{t.dateLoading || t.dateDeparture || '—'}</span>
                    <span className="text-slate-500">{t.direction || t.route || '—'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

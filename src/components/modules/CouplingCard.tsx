import {useState, useEffect} from 'react'
import { getCouplingsFlat } from '../../services/fleetService'
import {dbService} from '../../api'
import {useFleetUnit} from '../../hooks/useFleet'
import {Truck, User, Calendar, MapPin, X, ArrowLeft} from 'lucide-react'

interface CouplingCardProps {
  carNumber: string;
  bazaRec?: any;
  onClose: () => void;
  onOpenDriver: (driverId: string, driverName: string) => void;
}

export default function CouplingCard({ carNumber, onClose, onOpenDriver }: CouplingCardProps) {
  // ЕДИНАЯ БАЗА: авто + прицеп + водитель + диспетчер (изменяемая связка).
  const {unit: center, loading} = useFleetUnit(carNumber);

  const [bazaState, setBazaState] = useState<any>(null);
  const [trips, setTrips] = useState<any[]>([]);
  const [flatRecord, setFlatRecord] = useState<any>(null);

  // baza (Учёт выезда) и planDohod (рейсы) — отдельные ветки, soft-link (не часть сцепки).
  useEffect(() => {
    const u2 = dbService.getBazaRecords((list: any[]) => {
      const found = (list || []).find((c) => (c.carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '') === carNumber.replace(/[^А-ЯA-Z0-9]/g, ''));
      setBazaState(found || null);
    });
    const u3 = dbService.getPlanDohod((list: any[]) => {
      const found2 = (list || []).filter((t) => (t.carNumber || '').replace(/[^А-ЯA-Z0-9]/g, '') === carNumber.replace(/[^А-ЯA-Z0-9]/g, ''));
      setTrips(found2.slice(0, 5));
    });
    return () => { u2(); u3(); };
  }, [carNumber]);

  // Подтягиваем flat-запись из базы сцепок
  useEffect(() => {
    const unsub = getCouplingsFlat((list: any[]) => {
      const found = list.find((r: any) => r.carNumber === carNumber || r.id === carNumber);
      if (found) setFlatRecord(found);
    });
    return unsub;
  }, [carNumber]);

  const bazaRecord = bazaState || flatRecord;
  const inBaza = !!bazaState;
  const bazaCarNumber = bazaRecord?.carNumber || bazaRecord?.vehicleNumbers || '';
  const bazaStatus = bazaRecord?.status || (inBaza ? 'base' : null);
  const tractor = center?.tractor || null;
  const trailer = center?.trailer || null;
  const driver = center?.driver || null;
  const dispatcher = center?.dispatcher || null;
  const driverId = driver?.id || bazaRecord?.driverId || '';
  const driverName = driver?.shortNameRu || driver?.name || bazaRecord?.driverName || bazaRecord?.driverNameRu || '';
  const dispatcherName = dispatcher?.name || bazaRecord?.dispatcher || '—';

  return (
 <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 p-4 overflow-y-auto" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl my-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-[#3765F6]/10 to-transparent border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#3765F6]/10 flex items-center justify-center">
              <Truck className="w-5 h-5 text-[#3765F6]" />
            </div>
            <div>
              <div className="text-lg font-bold text-slate-900 font-mono">{tractor?.carNumber || bazaCarNumber || carNumber}</div>
              <div className="text-[11px] text-slate-400 font-mono">
                {trailer?.trailerNumber ? `${trailer.trailerNumber}` : '—'}
                {(tractor?.brandModel || tractor?.brandsRu || tractor?.brand) ? ` · ${tractor.brandModel || tractor?.brandsRu || tractor.brand}` : ''}
                {trailer?.trailerBrand ? ` / ${trailer.trailerBrand}` : ''}
                {tractor?.year ? ` · ${tractor.year} г.` : ''}
              </div>
            </div>
          </div>
          <button onClick={onClose} className="min-h-[44px] min-w-[44px] rounded-lg hover:bg-slate-100 text-slate-400 flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Location status */}
          <div className="flex items-center gap-3 p-3 rounded-2xl bg-slate-50">
            <MapPin className={`w-5 h-5 ${inBaza ? 'text-emerald-500' : 'text-slate-300'}`} />
            <div className="flex-1">
              <div className="text-[9px] font-bold uppercase text-slate-400">Местонахождение (Учёт выезда)</div>
              {inBaza ? (
                <div className="text-sm font-semibold text-slate-800 truncate">
                  В учёте выезда · статус: {bazaStatus === 'base' ? 'на базе' : bazaStatus === 'departure' ? 'в рейсе' : bazaStatus || '—'}
                  {bazaRecord?.dateDeparture ? ` · выезд ${bazaRecord.dateDeparture}` : ''}
                </div>
              ) : (
                <div className="text-sm text-slate-500">Сейчас не в учёте выезда</div>
              )}
            </div>
          </div>

          {/* Driver */}
          {driverName && (
            <button onClick={() => onOpenDriver(driverId || '', driverName)}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-blue-50 transition text-left">
              <User className="w-5 h-5 text-[#3765F6]" />
              <div className="flex-1">
                <div className="text-[9px] font-bold uppercase text-slate-400">Водитель (из единой базы)</div>
                <div className="text-sm font-semibold text-slate-800 truncate">{driverName}</div>
              </div>
              <ArrowLeft className="w-4 h-4 text-slate-300 rotate-180" />
            </button>
          )}

          {/* Vehicle data */}
          <div>
            <div className="text-[9px] font-bold uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Truck className="w-3.5 h-3.5" /> Данные по авто
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Марка тягача" value={tractor?.brandModel || bazaRecord?.brandModel || bazaRecord?.brandsRu || bazaRecord?.brand || '—'} />
              <Field label="Марка прицепа" value={trailer?.trailerBrand || bazaRecord?.trailerBrand || bazaRecord?.trailerMake || bazaRecord?.brandsLat || '—'} />
              <Field label="Прицеп (сцепка)" value={trailer?.trailerNumber || bazaRecord?.trailerNumber || '—'} />
              <Field label="Диспетчер" value={dispatcherName} />
              <Field label="Тип" value={tractor?.vehicleType || bazaRecord?.vehicleType || '—'} />
              <Field label="Год" value={tractor?.year || bazaRecord?.year || '—'} />
              <Field label="Габариты" value={tractor?.dimensions || bazaRecord?.dimensions || '—'} />
              <Field label="Вес" value={tractor?.weight || bazaRecord?.weight || '—'} />
              <Field label="Ставка" value={(tractor?.rate != null ? String(tractor.rate) : bazaRecord?.rate != null ? String(bazaRecord.rate) : '—') + ' €'} />
            </div>
          </div>

          {/* Plan dohod */}
          <div>
            <div className="text-[9px] font-bold uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> План дохода (последние рейсы)
            </div>
            {trips.length === 0 ? (
              <div className="text-xs text-slate-400 p-2">Нет данных в плане дохода</div>
            ) : (
              <div className="space-y-1">
                {trips.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2.5 rounded-xl bg-slate-50">
                    <span className="font-mono text-slate-700 truncate">{t.dateLoading || t.dateDeparture || '—'}</span>
                    <span className="text-slate-500 truncate ml-2">{t.direction || t.route || '—'}</span>
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

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="p-2.5 rounded-xl bg-slate-50">
      <div className="text-[9px] font-bold uppercase text-slate-400">{label}</div>
      <div className="text-xs font-semibold text-slate-700 truncate">{value}</div>
    </div>
  );
}
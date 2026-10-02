import {useState, useEffect} from 'react'
import { getCouplingsFlat } from '../../services/fleetService'
import {dbService} from '../../api'
import {useFleetUnit} from '../../hooks/useFleet'
import {Truck, User, Calendar, MapPin, X, ArrowRight} from 'lucide-react'
import {UI} from '../../ui/kit'

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
    <div
      data-scroll-lock="modal"
      className="fixed inset-0 z-[2000] bg-black/40 backdrop-blur-[2px] flex items-start justify-center p-4 sm:p-6 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative z-10 w-full max-w-lg bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] my-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-[#E5E7EB]">
          <div className="flex items-center gap-3 min-w-0">
            <div className="p-2 bg-[#F3F4F6] text-[#A55329] rounded-lg shrink-0">
              <Truck className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#121316] font-mono truncate">
                {tractor?.carNumber || bazaCarNumber || carNumber}
              </div>
              <div className="text-xs text-[#6B7280] font-mono mt-0.5 truncate">
                {trailer?.trailerNumber ? `${trailer.trailerNumber}` : '—'}
                {(tractor?.brandModel || tractor?.brandsRu || tractor?.brand) ? ` · ${tractor.brandModel || tractor?.brandsRu || tractor.brand}` : ''}
                {trailer?.trailerBrand ? ` / ${trailer.trailerBrand}` : ''}
                {tractor?.year ? ` · ${tractor.year} г.` : ''}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className={UI.modalClose}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Location status */}
          <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
            <MapPin className={`w-4 h-4 shrink-0 ${inBaza ? 'text-emerald-500' : 'text-[#9CA3AF]'}`} aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <div className={UI.fieldLabel}>Местонахождение (Учёт выезда)</div>
              {inBaza ? (
                <div className="text-xs font-semibold text-[#121316] truncate mt-0.5">
                  В учёте выезда · статус: {bazaStatus === 'base' ? 'на базе' : bazaStatus === 'departure' ? 'в рейсе' : bazaStatus || '—'}
                  {bazaRecord?.dateDeparture ? ` · выезд ${bazaRecord.dateDeparture}` : ''}
                </div>
              ) : (
                <div className="text-xs text-[#6B7280] mt-0.5">Сейчас не в учёте выезда</div>
              )}
            </div>
          </div>

          {/* Driver */}
          {driverName && (
            <button
              type="button"
              onClick={() => onOpenDriver(driverId || '', driverName)}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors text-left cursor-pointer"
            >
              <User className="w-4 h-4 text-[#A55329] shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className={UI.fieldLabel}>Водитель (из единой базы)</div>
                <div className="text-xs font-semibold text-[#121316] truncate mt-0.5">{driverName}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-[#9CA3AF] shrink-0" aria-hidden="true" />
            </button>
          )}

          {/* Vehicle data */}
          <div>
            <div className={`${UI.caption} flex items-center gap-1.5 mb-2`}>
              <Truck className="w-3.5 h-3.5" aria-hidden="true" /> Данные по авто
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
              <Field label="Ставка" value={(() => { const rateValue = tractor?.rate != null ? String(tractor.rate) : bazaRecord?.rate != null ? String(bazaRecord.rate) : ''; return rateValue ? rateValue + ' €' : '—'; })()} />
            </div>
          </div>

          {/* Plan dohod */}
          <div>
            <div className={`${UI.caption} flex items-center gap-1.5 mb-2`}>
              <Calendar className="w-3.5 h-3.5" aria-hidden="true" /> План дохода (последние рейсы)
            </div>
            {trips.length === 0 ? (
              <div className="text-xs text-[#6B7280] py-2">Нет данных в плане дохода</div>
            ) : (
              <div className="flex flex-col gap-1">
                {trips.map((t, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
                    <span className="font-mono text-[#4B5563] truncate">{t.dateLoading || t.dateDeparture || '—'}</span>
                    <span className="text-[#6B7280] truncate ml-2">{t.direction || t.route || '—'}</span>
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
    <div className="p-2.5 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
      <div className={UI.fieldLabel}>{label}</div>
      <div className="text-xs font-semibold text-[#121316] truncate mt-1">{value}</div>
    </div>
  );
}

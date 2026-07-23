import {useState, useEffect} from 'react'
import {dbService} from '../../api'
import {User, Truck, Banknote, FileText, X, ArrowLeft} from 'lucide-react'

interface DriverCardProps {
  driverId: string;
  driverName: string;
  onClose: () => void;
  onOpenCoupling: (carNumber: string) => void;
  onPrev?: () => void;
  onNext?: () => void;
}

export default function DriverCard({ driverId, driverName, onClose, onOpenCoupling, onPrev, onNext }: DriverCardProps) {
  const [driver, setDriver] = useState<any>(null);
  const [coupling, setCoupling] = useState<any>(null);
  const [salaries, setSalaries] = useState<any[]>([]);

  useEffect(() => {
    // driver passport data
    const u1 = dbService.getDrivers((list: any[]) => {
      const surname = (driverName || "").trim().split(/\s+/)[0].toLowerCase();
      const found = (list || []).find((d) =>
        d.id === driverId ||
        (d.shortNameRu || d.name || '').toLowerCase().includes(surname) ||
        (surname && (d.lastNameRu || d.name || '').toLowerCase().startsWith(surname))
      );
      setDriver(found || null);
    });
    // coupling (which car) - search center by driverId or name
    const u2 = dbService.getVehicleDriverData((list: any[]) => {
      const found = (list || []).find((c) =>
        (c.driverId && c.driverId === driverId) ||
        ((c.driverNameRu || c.driverName || c.driverShortNameRu || '') === driverName && driverName)
      );
      setCoupling(found || null);
    });
    // salary history
    const u3 = dbService.getDriverSalaryLogs(driverId, (logs: any[]) => {
      setSalaries((logs || []).slice(-5).reverse());
    });
    return () => { u1(); u2(); u3(); };
  }, [driverId, driverName]);

  const [copied, setCopied] = useState(false);

  // Keyboard control: Esc closes the card; ArrowLeft/ArrowRight navigate if handlers provided
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft' && onPrev) {
        onPrev();
      } else if (e.key === 'ArrowRight' && onNext) {
        onNext();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onPrev, onNext]);

  // Prefer coupling record (from vehicle_driver_data) as the source of passport data,
  // since driverId here comes from that branch and may not match driversPool id.
  const src = coupling || driver || {};
  const driverNameLat = src.driverNameLat || src.nameLat || src.shortNameLat || '';
  const driverNameRu = src.driverNameRu || src.name || driverName || '';

  return (
    <div className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200 shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 bg-gradient-to-r from-emerald-500/10 to-transparent border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
              <User className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <div className="text-lg font-black text-slate-900">{driverName}</div>
              <div className="text-[11px] text-slate-400">Карточка водителя</div>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-100 text-slate-400"><X className="w-4 h-4" /></button>
        </div>

        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Car (soft link) */}
          {coupling && (
            <button onClick={() => onOpenCoupling(coupling.carNumber || coupling.vehicleNumbers || '')}
              className="w-full flex items-center gap-3 p-3 rounded-2xl bg-slate-50 hover:bg-blue-50 transition text-left">
              <Truck className="w-5 h-5 text-[#3765F6]" />
              <div className="flex-1">
                <div className="text-[10px] font-bold uppercase text-slate-400">Текущая машина (из базы)</div>
                <div className="text-sm font-semibold text-slate-800 font-mono">
                  {coupling.coupling || (coupling.carNumber || coupling.vehicleNumbers || '')}
                </div>
              </div>
              <ArrowLeft className="w-4 h-4 text-slate-300 rotate-180" />
            </button>
          )}

          {/* Passport (from Авто-водители) */}
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-2 flex items-center gap-1">
              <FileText className="w-3.5 h-3.5" /> Паспортные данные
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Field label="ФИО (рус)" value={driverNameRu} />
              <Field label="ФИО (лат)" value={driverNameLat || '—'} />
              <Field label="ИНН" value={src.personalId || src.inn || '—'} />
              <Field label="Паспорт" value={src.passportNumber || '—'} />
              <Field label="Телефон" value={(src.phones && src.phones[0]?.number) || src.phone || src.driverPhone || '—'} />
              <Field label="Вод. удостоверение" value={src.license || '—'} />
              <Field label="Группа ставок" value={src.rateGroupId || src.rateGroup || '—'} />
              <Field label="Комментарий" value={src.comment || '—'} />
            </div>
          </div>

          {/* Salary (soft link to Зарплата) */}
          <div>
            <div className="text-[10px] font-bold uppercase text-slate-400 mb-2 flex items-center gap-1">
              <Banknote className="w-3.5 h-3.5" /> Зарплата (последние 5 выплат)
            </div>
            {salaries.length === 0 ? (
              <div className="text-xs text-slate-400 p-2">Нет выплат</div>
            ) : (
              <div className="space-y-1.5">
                {salaries.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs p-2 rounded-xl bg-slate-50">
                    <span className="text-slate-600">{s.date || s.datetime || s.period || '—'}</span>
                    <span className="font-bold text-emerald-600">{s.amount != null ? `${s.amount} €` : (s.total != null ? `${s.total} €` : '—')}</span>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-2.5 rounded-xl bg-slate-50">
      <div className="text-[9px] font-bold uppercase text-slate-400">{label}</div>
      <div className="text-slate-700 font-medium truncate">{value}</div>
    </div>
  );
}
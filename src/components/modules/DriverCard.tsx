import {useState, useEffect} from 'react'
import {dbService} from '../../api'
import {getDriversFlat, getCouplingsFlat} from '../../services/fleetService'
import {User, Truck, Banknote, FileText, X, ArrowRight} from 'lucide-react'
import {UI} from '../../ui/kit'

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
    const u1 = getDriversFlat((list: any[]) => {
      const surname = (driverName || "").trim().split(/\s+/)[0].toLowerCase();
      const found = (list || []).find((d) =>
        d.id === driverId ||
        (d.shortNameRu || d.name || '').toLowerCase().includes(surname) ||
        (surname && (d.lastNameRu || d.name || '').toLowerCase().startsWith(surname))
      );
      setDriver(found || null);
    });
    // coupling (which car) - search center by driverId or name
    const u2 = getCouplingsFlat((list: any[]) => {
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
    <div
      data-scroll-lock="modal"
      className="fixed inset-0 z-[2000] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
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
              <User className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-[#121316] truncate">{driverName}</div>
              <div className="text-xs text-[#6B7280] mt-0.5">Карточка водителя</div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className={UI.modalClose}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="px-6 py-5 flex flex-col gap-5">
          {/* Car (soft link) */}
          {coupling && (
            <button
              type="button"
              onClick={() => onOpenCoupling(coupling.carNumber || coupling.vehicleNumbers || '')}
              className="w-full flex items-center gap-3 p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors text-left cursor-pointer"
            >
              <Truck className="w-4 h-4 text-[#A55329] shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className={UI.fieldLabel}>Текущая машина (из базы)</div>
                <div className="text-xs font-semibold text-[#121316] font-mono mt-0.5">
                  {coupling.coupling || (coupling.carNumber || coupling.vehicleNumbers || '')}
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[#9CA3AF] shrink-0" aria-hidden="true" />
            </button>
          )}

          {/* Passport (from Авто-водители) */}
          <div>
            <div className={`${UI.caption} flex items-center gap-1.5 mb-2`}>
              <FileText className="w-3.5 h-3.5" aria-hidden="true" /> Паспортные данные
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="ФИО (рус)" value={driverNameRu} />
              <Field label="ФИО (лат)" value={driverNameLat || '—'} />
              <Field label="ИНН" value={src.personalId || src.inn || '—'} />
              <Field label="Паспорт" value={src.passportNumber || '—'} />
              <Field label="Телефон" value={(src.phones && src.phones[0]?.number) || src.phone || src.driverPhone || '—'} />
              <Field label="Вод. удостоверение" value={src.licenseNumber || src.license || '—'} />
              <Field label="Комментарий" value={src.comment || '—'} />
            </div>
          </div>

          {/* Salary (soft link to Зарплата) */}
          <div>
            <div className={`${UI.caption} flex items-center gap-1.5 mb-2`}>
              <Banknote className="w-3.5 h-3.5" aria-hidden="true" /> Зарплата (последние 5 выплат)
            </div>
            {salaries.length === 0 ? (
              <div className="text-xs text-[#6B7280] py-2">Нет выплат</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {salaries.map((s, i) => (
                  <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
                    <span className="text-[#6B7280]">{s.date || s.datetime || s.period || '—'}</span>
                    <span className="font-semibold font-mono text-emerald-600">
                      {s.amount != null ? `${s.amount} €` : (s.total != null ? `${s.total} €` : '—')}
                    </span>
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
    <div className="p-3 rounded-xl bg-[#F9FAFB] border border-[#E5E7EB]">
      <div className={UI.fieldLabel}>{label}</div>
      <div className="text-xs font-semibold text-[#121316] truncate mt-1">{value}</div>
    </div>
  );
}

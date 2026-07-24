import {useState, useEffect} from 'react'
import {UserProfile, Vehicle, RouteCalculation, SalaryLog} from '../../types'
import {dbService} from '../../api'
import { 
  Archive, 
  Trash2, 
  RefreshCcw, 
  Search, 
  Truck, 
  Calculator, 
  FileText,
  Bookmark
} from 'lucide-react';
import {useToast} from '../ToastProvider'

interface ArchiveModuleProps {
  user: UserProfile;
}

export default function ArchiveModule({ user }: ArchiveModuleProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<'vehicles' | 'calculations' | 'salaries'>('vehicles');
  const [archivedVehicles, setArchivedVehicles] = useState<Vehicle[]>([]);
  const [calculations, setCalculations] = useState<RouteCalculation[]>([]);
  const [salaries, setSalaries] = useState<SalaryLog[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    // Subscriptions
    const subArchive = dbService.getArchiveVehicles(setArchivedVehicles);
    const subCalcs = dbService.getRouteCalculations(setCalculations);
    const subSalaries = dbService.getSalaries(setSalaries);

    return () => {
      subArchive();
      subCalcs();
      subSalaries();
    };
  }, []);

  const handleRestoreVehicle = (vec: Vehicle) => {
    dbService.restoreVehicle(vec, user.name, user.role);
    toast(`Экипаж ${vec.carNumber} успешно возвращен в активный список в модуле «База».`, 'success');
  };

  // Searching logic based on active tab
  const getFilteredData = () => {
    const query = searchQuery.toLowerCase();
    switch (activeTab) {
      case 'vehicles':
        return archivedVehicles.filter(
          v => v.carNumber.toLowerCase().includes(query) || 
               v.driverName.toLowerCase().includes(query) ||
               v.comment.toLowerCase().includes(query)
        );
      case 'calculations':
        // Show older queries or all
        return calculations.filter(
          c => c.from.toLowerCase().includes(query) ||
               c.to.toLowerCase().includes(query) ||
               c.username.toLowerCase().includes(query)
        );
      case 'salaries':
        return salaries.filter(
          s => s.driver.toLowerCase().includes(query) ||
               s.car.toLowerCase().includes(query) ||
               s.logist.toLowerCase().includes(query)
        );
      default:
        return [];
    }
  };

  const filteredItems = getFilteredData();

  return (
    <div className="w-full space-y-6 font-sans">
      
      {/* Banner */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] select-none">
        <span className="bg-[#c3fb12] text-slate-950 font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono border border-black/5">
          Системный Репозиторий
        </span>
        <h1 className="text-2xl lg:text-3xl font-black text-slate-900 mt-1.5 flex items-center gap-2 uppercase tracking-tight">
          <Archive className="h-6 w-6 text-slate-900" style={{ fill: '#c3fb12' }} />
          Архивные реестры
        </h1>
        <p className="text-xs text-slate-500 mt-1 font-semibold">
          Единое облачное хранилище списанной техники, выполненных рейсов, тарификаций и ведомостей расчетов.
        </p>
      </div>

      {/* Tabs navigation and search bar */}
      <div className="bg-white rounded-[2rem] shadow-[0_8px_30px_rgba(0,0,0,0.01)] border border-slate-200/50 overflow-hidden">
        
        {/* Navigation row */}
        <div className="p-6 bg-slate-50/50 border-b border-slate-200/40 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          
          <div className="flex flex-wrap items-center gap-2 w-full xl:w-auto">
            <button
              onClick={() => { setActiveTab('vehicles'); setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl text-xs font-black transition whitespace-nowrap uppercase tracking-tight cursor-pointer ${
                activeTab === 'vehicles' 
                  ? 'bg-slate-950 text-[#c3fb12] shadow-sm' 
                  : 'bg-white text-slate-650 border border-slate-200/40 hover:bg-slate-50'
              }`}
            >
              <Truck className="h-4 w-4" />
              Архив Машин ({archivedVehicles.length})
            </button>
            <button
              onClick={() => { setActiveTab('calculations'); setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl text-xs font-black transition whitespace-nowrap uppercase tracking-tight cursor-pointer ${
                activeTab === 'calculations' 
                  ? 'bg-slate-950 text-[#c3fb12] shadow-sm' 
                  : 'bg-white text-slate-650 border border-slate-200/40 hover:bg-slate-50'
              }`}
            >
              <Calculator className="h-4 w-4" />
              Расчеты Маршрутов ({calculations.length})
            </button>
            <button
              onClick={() => { setActiveTab('salaries'); setSearchQuery(''); }}
              className={`flex items-center gap-1.5 px-4.5 py-2.5 rounded-xl text-xs font-black transition whitespace-nowrap uppercase tracking-tight cursor-pointer ${
                activeTab === 'salaries' 
                  ? 'bg-slate-950 text-[#c3fb12] shadow-sm' 
                  : 'bg-white text-slate-650 border border-slate-200/40 hover:bg-slate-50'
              }`}
            >
              <FileText className="h-4 w-4" />
              Wages & Ведомости ({salaries.length})
            </button>
          </div>

          <div className="relative w-full xl:max-w-sm">
            <Search className="h-4 w-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Поиск по архивным записям..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold focus:outline-none focus:border-slate-400 placeholder:text-slate-400 shadow-2xs text-slate-800"
            />
          </div>

        </div>

        {/* Tab content viewports */}
        <div className="p-6">
          
          {/* TAP 1: VEHICLES */}
          {activeTab === 'vehicles' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/40 text-[10px] uppercase font-mono font-black text-slate-400">
                    <th className="p-3.5 pl-4">Госномер</th>
                    <th className="p-3.5">ФИО Водителя</th>
                    <th className="p-3.5">Комментарий при списании</th>
                    <th className="p-3.5 pr-4 text-right">Действия</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700">
                  {filteredItems.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition duration-100">
                      <td className="p-3.5 pl-4 font-mono font-black text-slate-900">{item.carNumber}</td>
                      <td className="p-3.5 font-bold text-slate-800">{item.driverName}</td>
                      <td className="p-3.5 text-slate-500 max-w-sm truncate font-medium">{item.comment || '--'}</td>
                      <td className="p-3.5 pr-4 text-right">
                        {user.permissions.archives === 'write' && (
                          <button
                            onClick={() => handleRestoreVehicle(item)}
                            className="inline-flex items-center gap-1 p-2 px-3 bg-slate-950 text-[#c3fb12] hover:bg-[#c3fb12] hover:text-black rounded-lg text-[10px] font-black uppercase transition duration-150 cursor-pointer border border-black/5"
                            title="Разархивировать"
                          >
                            <RefreshCcw className="h-3 w-3" /> Восстановить экипаж
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!filteredItems.length && (
                    <tr>
                      <td colSpan={4} className="text-center p-12 text-slate-400 font-bold uppercase tracking-wider font-mono">Нет списанной техники в архиве.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: CALCULATIONS */}
          {activeTab === 'calculations' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
              {filteredItems.map((item: any) => (
                <div key={item.id} className="bg-slate-50 p-5 rounded-2xl border border-slate-200/40 hover:border-slate-350 transition duration-150 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-[9px] text-slate-400 uppercase font-bold font-mono border-b border-slate-200/20 pb-2 mb-3 select-none">
                      <span>{new Date(item.date).toLocaleDateString()}</span>
                      <span>Сохранил: {item.username}</span>
                    </div>
                    <div className="text-sm font-black text-slate-900 uppercase tracking-tight">
                      {item.from} — {item.to}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-4 text-[10px] uppercase font-mono tracking-wider border-t border-slate-100 mt-4 leading-normal">
                    <div>
                      <span className="text-slate-400 block pb-0.5">Дистанция:</span>
                      <strong className="text-slate-700 font-extrabold">{item.distance} км</strong>
                    </div>
                    <div>
                      <span className="text-slate-400 block pb-0.5">Чистый доход:</span>
                      <strong className="text-emerald-700 font-black">{item.totalProfit?.toFixed(0)} EUR</strong>
                    </div>
                  </div>
                </div>
              ))}
              {!filteredItems.length && (
                <div className="text-center py-12 text-slate-400 col-span-full text-xs font-mono font-black uppercase tracking-widest bg-slate-50 rounded-2xl border border-slate-250/20">
                  Расчеты по фильтру не обнаружены.
                </div>
              )}
            </div>
          )}

          {/* TAB 3: SALARIES */}
          {activeTab === 'salaries' && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200/40 text-[10px] uppercase font-mono font-black text-slate-400">
                    <th className="p-3.5 pl-4">Дата</th>
                    <th className="p-3.5">Водитель</th>
                    <th className="p-3.5">Машина</th>
                    <th className="p-3.5">Пробег (км)</th>
                    <th className="p-3.5">Общий итог</th>
                    <th className="p-3.5">Сотрудник логист</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-650 font-semibold">
                  {filteredItems.map((item: any) => (
                    <tr key={item.id} className="hover:bg-slate-50/50 transition duration-100">
                      <td className="p-3.5 pl-4 text-slate-400 font-mono">{new Date(item.datetime).toLocaleDateString()}</td>
                      <td className="p-3.5 font-bold text-slate-900">{item.driver}</td>
                      <td className="p-3.5 font-bold text-slate-700 font-mono">{item.car}</td>
                      <td className="p-3.5 font-mono">{item.km} км</td>
                      <td className="p-3.5 font-black text-emerald-750 font-mono">{item.totalSalary?.toFixed(0)} EUR</td>
                      <td className="p-3.5 font-semibold text-slate-400">{item.logist}</td>
                    </tr>
                  ))}
                  {!filteredItems.length && (
                    <tr>
                      <td colSpan={6} className="text-center p-12 text-slate-400 font-mono font-black uppercase tracking-wider">Архив зарплатных ведомостей пуст.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

        </div>

      </div>

    </div>
  );
}
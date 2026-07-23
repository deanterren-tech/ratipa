import {useDialog} from '../DialogProvider'
import {useState} from 'react'
import {AppSettings, UserProfile} from '../../types'
import {dbService} from '../../api'
import {Map, RefreshCw, AlertCircle, CheckCircle2, Layers, Navigation} from 'lucide-react'

interface AdminMapboxLimitsBlockProps {
  settings: AppSettings | null;
  user: UserProfile;
}

export default function AdminMapboxLimitsBlock({ settings, user }: AdminMapboxLimitsBlockProps) {
  const { showConfirm } = useDialog();
  const [successMsg, setSuccessMsg] = useState('');

  // Local settings backup if settings are loading
  const mapboxUsage = settings?.mapboxUsage || {
    count: 0,
    limit: 100000,
    allowExceed: false,
    loadsCount: 0,
    loadsLimit: 50000,
    allowExceedLoads: false,
    currentMonth: new Date().toISOString().substring(0, 7),
    lastReset: new Date().toISOString()
  };

  const currentCount = mapboxUsage.count || 0;
  const limit = mapboxUsage.limit || 100000;
  const allowExceed = !!mapboxUsage.allowExceed;

  const currentLoadsCount = mapboxUsage.loadsCount || 0;
  const loadsLimit = mapboxUsage.loadsLimit || 50000;
  const allowExceedLoads = !!mapboxUsage.allowExceedLoads;

  const currentMonth = mapboxUsage.currentMonth || new Date().toISOString().substring(0, 7);
  const lastReset = mapboxUsage.lastReset ? new Date(mapboxUsage.lastReset).toLocaleString('ru-RU') : 'Не производился';

  const percentRequests = Math.min(100, Math.round((currentCount / limit) * 100));
  const percentLoads = Math.min(100, Math.round((currentLoadsCount / loadsLimit) * 100));

  // Determine Month Label in Russian
  const getMonthLabel = (yearMonth: string) => {
    try {
      const [year, month] = yearMonth.split('-');
      const date = new Date(parseInt(year), parseInt(month) - 1, 1);
      return date.toLocaleString('ru-RU', { month: 'long', year: 'numeric' });
    } catch {
      return yearMonth;
    }
  };

  const handleUpdateLimit = (newLimit: number) => {
    if (!settings) return;
    const updatedSettings: AppSettings = {
      ...settings,
      mapboxUsage: {
        ...mapboxUsage,
        limit: newLimit
      }
    };
    dbService.saveSettings(updatedSettings, user.name, user.role);
    showTempSuccess('Лимит запросов успешно обновлен');
  };

  const handleUpdateLoadsLimit = (newLimit: number) => {
    if (!settings) return;
    const updatedSettings: AppSettings = {
      ...settings,
      mapboxUsage: {
        ...mapboxUsage,
        loadsLimit: newLimit
      }
    };
    dbService.saveSettings(updatedSettings, user.name, user.role);
    showTempSuccess('Лимит показов успешно обновлен');
  };

  const handleToggleAllowExceed = (checked: boolean) => {
    if (!settings) return;
    const updatedSettings: AppSettings = {
      ...settings,
      mapboxUsage: {
        ...mapboxUsage,
        allowExceed: checked
      }
    };
    dbService.saveSettings(updatedSettings, user.name, user.role);
    showTempSuccess(checked ? 'Разрешено превышение лимита запросов' : 'Превышение лимита запросов заблокировано (авто-переход на OSRM)');
  };

  const handleToggleAllowExceedLoads = (checked: boolean) => {
    if (!settings) return;
    const updatedSettings: AppSettings = {
      ...settings,
      mapboxUsage: {
        ...mapboxUsage,
        allowExceedLoads: checked
      }
    };
    dbService.saveSettings(updatedSettings, user.name, user.role);
    showTempSuccess(checked ? 'Разрешено превышение лимита показов карты' : 'Превышение лимита показов заблокировано (показы карты отключаются)');
  };

  const handleResetCounter = async () => {
    if (!settings) return;
    if (!(await showConfirm('Вы действительно хотите сбросить счетчик запросов в этом месяце?'))) return;
    
    const updatedSettings: AppSettings = {
      ...settings,
      mapboxUsage: {
        ...mapboxUsage,
        count: 0,
        lastReset: new Date().toISOString()
      }
    };
    dbService.saveSettings(updatedSettings, user.name, user.role);
    showTempSuccess('Счетчик запросов успешно сброшен на 0');
  };

  const handleResetLoadsCounter = async () => {
    if (!settings) return;
    if (!(await showConfirm('Вы действительно хотите сбросить счетчик показов карты в этом месяце?'))) return;
    
    const updatedSettings: AppSettings = {
      ...settings,
      mapboxUsage: {
        ...mapboxUsage,
        loadsCount: 0,
        lastReset: new Date().toISOString()
      }
    };
    dbService.saveSettings(updatedSettings, user.name, user.role);
    showTempSuccess('Счетчик показов успешно сброшен на 0');
  };

  const showTempSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(''), 3000);
  };

  // UI colors based on usage
  const getProgressBarColor = (percent: number) => {
    if (percent < 60) return 'bg-indigo-500';
    if (percent < 90) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  const getPercentageTextColor = (percent: number) => {
    if (percent < 60) return 'text-emerald-600';
    if (percent < 90) return 'text-amber-600';
    return 'text-rose-600';
  };

  return (
    <div className="bg-white/60 backdrop-blur-2xl rounded-[2.5rem] p-6 lg:p-8 border border-white/40 shadow-xl space-y-8 w-full select-none">
      
      {/* Block Header */}
      <div className="border-b border-white/40 pb-4">
        <span className="bg-indigo-600 text-white font-black text-[9px] px-2.5 py-0.5 rounded-full uppercase font-mono tracking-wider">
          API Management
        </span>
        <h2 className="text-sm font-black uppercase tracking-tight text-slate-900 mt-2 flex items-center gap-1.5">
          <Map className="h-4 w-4 text-slate-850" />
          Контроль и лимиты Mapbox API
        </h2>
        <p className="text-[10px] text-slate-500 font-medium mt-1 leading-relaxed">
          Контроль навигационных запросов и показов интерактивной карты, ограничение затрат и автоматическое переключение на резервные шлюзы.
        </p>
      </div>

      {/* 1. DIRECTIONS API BLOCK */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 text-indigo-600" />
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
            Маршрутизация (Directions API) — Бесплатно до 100 000 запр/мес
          </h3>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Usage Card */}
          <div className="xl:col-span-2 bg-white/40 border border-white/45 backdrop-blur-md shadow-inner rounded-[1.8rem] p-6 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                  Запросы маршрутов
                </span>
                <span className="text-xs font-black text-slate-900 bg-white/50 backdrop-blur-md border border-white/40 px-2.5 py-1 rounded-lg uppercase tracking-tight shadow-sm">
                  {getMonthLabel(currentMonth)}
                </span>
              </div>
              
              <div className="flex items-baseline gap-2 mt-4">
                <span className="text-4xl font-black text-slate-900 font-mono tracking-tight">
                  {currentCount.toLocaleString('ru-RU')}
                </span>
                <span className="text-sm font-bold text-slate-400">
                  / {limit.toLocaleString('ru-RU')} запр.
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-500">Достигнуто лимита запросов</span>
                <span className={`${getPercentageTextColor(percentRequests)} font-mono`}>{percentRequests}%</span>
              </div>
              
              {/* Progress bar container */}
              <div className="w-full h-3 bg-slate-900/10 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${getProgressBarColor(percentRequests)} rounded-full transition-all duration-500`}
                  style={{ width: `${percentRequests}%` }}
                />
              </div>
            </div>
          </div>

          {/* Action controls block */}
          <div className="bg-white/40 border border-white/45 backdrop-blur-md shadow-inner rounded-[1.8rem] p-6 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono block">
                Параметры шлюза запросов
              </span>

              {/* Switch exceed limits */}
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <input 
                  type="checkbox" 
                  checked={allowExceed}
                  onChange={(e) => handleToggleAllowExceed(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded text-slate-900 border-indigo-300 focus:ring-indigo-500 text-indigo-600 cursor-pointer transition"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-black text-slate-800 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">
                    Разрешить сверх лимита
                  </span>
                  <p className="text-[10px] text-slate-500 font-medium leading-normal">
                    При выключении, после превышения {limit.toLocaleString()} запросы перейдут на бесплатный OSRM.
                  </p>
                </div>
              </label>

              {/* Preset limits selector */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono block">
                  Месячный лимит
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[10000, 50000, 100000, 200000].map((val) => (
                    <button
                      key={val}
                      onClick={() => handleUpdateLimit(val)}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${limit === val ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white/50 backdrop-blur-md text-slate-600 border border-white/40 hover:bg-white/70'}`}
                    >
                      {(val / 1000) + ' тыс'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-white/40">
              <button
                onClick={handleResetCounter}
                className="w-full flex items-center justify-center gap-2 bg-white/50 backdrop-blur-md hover:bg-rose-500/10 active:scale-95 border border-white/45 text-slate-700 shadow-sm hover:text-rose-700 font-black uppercase text-[10px] tracking-wider py-2.5 rounded-xl transition-all cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" />
                Сбросить запросы
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. MAP LOADS BLOCK */}
      <div className="space-y-4 pt-4 border-t border-white/40">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-emerald-600" />
          <h3 className="text-xs font-black uppercase tracking-wider text-slate-800">
            Отрисовка карты (Map Loads for Web) — Бесплатно до 50 000 поинтов/мес
          </h3>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          {/* Usage Card */}
          <div className="xl:col-span-2 bg-white/40 border border-white/45 backdrop-blur-md shadow-inner rounded-[1.8rem] p-6 flex flex-col justify-between">
            <div>
              <div className="flex justify-between items-start mb-2">
                <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono">
                  Показы интерактивной карты
                </span>
                <span className="text-xs font-black text-slate-900 bg-white/50 backdrop-blur-md border border-white/40 px-2.5 py-1 rounded-lg uppercase tracking-tight shadow-sm">
                  {getMonthLabel(currentMonth)}
                </span>
              </div>
              
              <div className="flex items-baseline gap-2 mt-4">
                <span className="text-4xl font-black text-slate-900 font-mono tracking-tight">
                  {currentLoadsCount.toLocaleString('ru-RU')}
                </span>
                <span className="text-sm font-bold text-slate-400">
                  / {loadsLimit.toLocaleString('ru-RU')} показов.
                </span>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <div className="flex justify-between text-xs font-bold">
                <span className="text-slate-500">Достигнуто лимита показов</span>
                <span className={`${getPercentageTextColor(percentLoads)} font-mono`}>{percentLoads}%</span>
              </div>
              
              {/* Progress bar container */}
              <div className="w-full h-3 bg-slate-900/10 rounded-full overflow-hidden">
                <div 
                  className={`h-full ${getProgressBarColor(percentLoads)} rounded-full transition-all duration-500`}
                  style={{ width: `${percentLoads}%` }}
                />
              </div>
            </div>
          </div>

          {/* Action controls block */}
          <div className="bg-white/40 border border-white/45 backdrop-blur-md shadow-inner rounded-[1.8rem] p-6 flex flex-col justify-between space-y-4">
            <div className="space-y-4">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider font-mono block">
                Параметры отображения карты
              </span>

              {/* Switch exceed limits */}
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <input 
                  type="checkbox" 
                  checked={allowExceedLoads}
                  onChange={(e) => handleToggleAllowExceedLoads(e.target.checked)}
                  className="mt-1 h-4 w-4 rounded text-slate-900 border-indigo-300 focus:ring-indigo-500 text-indigo-600 cursor-pointer transition"
                />
                <div className="space-y-0.5">
                  <span className="text-xs font-black text-slate-800 uppercase tracking-tight group-hover:text-indigo-600 transition-colors">
                    Разрешить сверх лимита
                  </span>
                  <p className="text-[10px] text-slate-500 font-medium leading-normal">
                    При выключении, после превышения {loadsLimit.toLocaleString()} отрисовка карты будет заблокирована в целях экономии.
                  </p>
                </div>
              </label>

              {/* Preset limits selector */}
              <div className="space-y-1.5 pt-1">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider font-mono block">
                  Месячный лимит
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {[5000, 10000, 25000, 50000].map((val) => (
                    <button
                      key={val}
                      onClick={() => handleUpdateLoadsLimit(val)}
                      className={`px-2.5 py-1 text-[10px] font-bold rounded-lg transition-all cursor-pointer ${loadsLimit === val ? 'bg-indigo-600 text-white shadow-sm' : 'bg-white/50 backdrop-blur-md text-slate-600 border border-white/40 hover:bg-white/70'}`}
                    >
                      {(val / 1000) + ' тыс'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="pt-2 border-t border-white/40">
              <button
                onClick={handleResetLoadsCounter}
                className="w-full flex items-center justify-center gap-2 bg-white/50 backdrop-blur-md hover:bg-rose-500/10 active:scale-95 border border-white/45 text-slate-700 shadow-sm hover:text-rose-700 font-black uppercase text-[10px] tracking-wider py-2.5 rounded-xl transition-all cursor-pointer"
              >
                <RefreshCw className="h-3 w-3" />
                Сбросить показы
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Info Notice Banner */}
      <div className="bg-white/40 border border-white/45 backdrop-blur-md shadow-inner rounded-[1.8rem] p-6 flex gap-3.5">
        <AlertCircle className="h-5 w-5 text-indigo-600 shrink-0 mt-0.5 animate-pulse" />
        <div className="text-xs text-slate-600 space-y-1 font-medium leading-relaxed">
          <p className="font-bold text-slate-800">Как распределяются лимиты?</p>
          <ul className="list-disc list-inside space-y-1 pl-1 text-[11px] text-slate-500">
            <li><strong className="text-slate-700">Запросы Directions API</strong> используются сервером при каждом расчете километража поездки. Лимит по умолчанию — 100 000 запросов в месяц. При превышении приложение плавно переключается на бесплатные OSRM-ноды.</li>
            <li><strong className="text-slate-700">Показы карт Map Loads for Web</strong> расходуются непосредственно при отрисовке интерактивного окна карты Mapbox GL JS в браузере. Лимит по умолчанию — 50 000 показов в месяц.</li>
            <li>Оба счетчика календарно обновляются в начале каждого месяца.</li>
          </ul>
        </div>
      </div>

      {/* Feedback Messages */}
      {successMsg && (
        <div className="bg-emerald-500/10 border border-emerald-500/20 shadow-inner text-emerald-800 rounded-xl p-3.5 flex items-center gap-2 text-xs font-bold animate-fade-in">
          <CheckCircle2 className="h-4 w-4 text-emerald-600 animate-bounce" />
          {successMsg}
        </div>
      )}

    </div>
  );
}
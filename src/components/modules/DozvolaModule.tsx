import {useState, useEffect, lazy, Suspense} from 'react'
import {UserProfile} from '../../types'
import {FileCheck} from 'lucide-react'
import DozvolaRegistryList from './dozvola/DozvolaRegistryList';
import DozvolaDocuments from './dozvola/DozvolaDocuments';
import DozvolaTypesDirectory from './dozvola/DozvolaTypesDirectory';
import DozvolaHistory from './dozvola/DozvolaHistory';
import DozvolaQuotasBlock from './dozvola/DozvolaQuotasBlock';
import {useFirebase, database, onValue} from '../../api'
import {ref} from 'firebase/database'

const DozvolaLocations = lazy(() => import('./dozvola/DozvolaLocations'));

interface DozvolaModuleProps {
  user: UserProfile;
}

export default function DozvolaModule({ user }: DozvolaModuleProps) {
  const [activeTab, setActiveTab] = useState<'registry' | 'documents' | 'types' | 'history' | 'locations' | 'quotas'>('registry');
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [customTypesOrder, setCustomTypesOrder] = useState<string[]>([]);

  useEffect(() => {
    if (!useFirebase) return;
    const unsubTypes = onValue(ref(database, 'dozvolsTypesV4'), (snap) => setCustomTypes(snap.val() || {}));
    const unsubOrder = onValue(ref(database, 'dozvolsTypesOrderV4'), (snap) => setCustomTypesOrder(Array.isArray(snap.val()) ? snap.val() : Object.keys(snap.val() || {})));
    return () => { unsubTypes(); unsubOrder(); };
  }, []);

  const customTypesMap = Object.keys(customTypes).reduce((acc: any, key) => {
    acc[key] = customTypes[key].name;
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm flex flex-col gap-5">
      
      {/* Page Header */}
      <div className="flex items-center gap-3 pb-4 border-b border-slate-100">
        <div>
          <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">
            Модуль Дозвола
          </span>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight flex items-center gap-2.5">
            <FileCheck className="w-7 h-7 text-slate-800" /> Дозвола
          </h1>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 overflow-x-auto custom-scrollbar">
        <button
          onClick={() => setActiveTab('registry')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'registry' 
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
          }`}
        >
          Реестр дозволов
        </button>
        <button
          onClick={() => setActiveTab('locations')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'locations' 
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
          }`}
        >
          Карта локаций
        </button>
        <button
          onClick={() => setActiveTab('quotas')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'quotas' 
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
          }`}
        >
          Квоты
        </button>
        <button
          onClick={() => setActiveTab('documents')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'documents' 
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
          }`}
        >
          Документы
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'history' 
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
          }`}
        >
          Журнал операций
        </button>
        <button
          onClick={() => setActiveTab('types')}
          className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
            activeTab === 'types' 
              ? 'bg-white text-slate-900 shadow-xs border border-slate-200/40' 
              : 'text-slate-500 hover:text-slate-900 hover:bg-slate-200/30'
          }`}
        >
          Справочник видов
        </button>
      </div>

      {/* Active Tab Content */}
      <div>
        <div className={activeTab === 'registry' ? '' : 'hidden'}>
          <DozvolaRegistryList user={user} />
        </div>
        <div className={activeTab === 'quotas' ? '' : 'hidden'}>
          <DozvolaQuotasBlock user={user} />
        </div>
        <div className={activeTab === 'documents' ? '' : 'hidden'}>
          <DozvolaDocuments user={user} />
        </div>
        <div className={activeTab === 'history' ? '' : 'hidden'}>
          <DozvolaHistory user={user} />
        </div>
        <div className={activeTab === 'types' ? '' : 'hidden'}>
          <DozvolaTypesDirectory user={user} />
        </div>
        {activeTab === 'locations' && (
          <div className="h-[700px]">
            <Suspense fallback={<div className="w-full h-full flex items-center justify-center bg-slate-50/50 rounded-xl"><div className="text-xs text-slate-400 font-semibold animate-pulse">Загрузка карты...</div></div>}>
              <DozvolaLocations user={user} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}
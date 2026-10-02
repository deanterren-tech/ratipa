import {useState, useEffect, useMemo, lazy, Suspense} from 'react'
import { useHashRoute } from '../../hooks/useHashRoute'
import {UserProfile} from '../../types'
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

type TabId = 'registry' | 'locations' | 'quotas' | 'documents' | 'history' | 'types';

interface TabConfig {
  id: TabId;
  label: string;
  badge?: number;
}


/** Слаги вкладок в URL: #dozvola/map, #dozvola/quotas, ... */
const TAB_SLUGS: Record<TabId, string> = {
  registry: 'registry',
  locations: 'map',
  quotas: 'quotas',
  documents: 'documents',
  history: 'history',
  types: 'types',
};
const SLUG_TO_TAB: Record<string, TabId> = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab as TabId]),
) as Record<string, TabId>;
const DEFAULT_TAB: TabId = 'registry';

export default function DozvolaModule({ user }: DozvolaModuleProps) {
  // Вкладка живёт в URL: #dozvola/map, #dozvola/quotas?year=2026&quarter=3 …
  // Состояние всегда читается из маршрута, поэтому обновление данных из Firebase
  // и повторные рендеры не сбрасывают вкладку.
  const { route, navigate } = useHashRoute({ module: 'dozvola' });
  const requestedTab = route.tab ? SLUG_TO_TAB[route.tab] : DEFAULT_TAB;
  const activeTab: TabId = requestedTab || DEFAULT_TAB;

  // Неизвестный маршрут модуля → нормализуем на вкладку по умолчанию
  useEffect(() => {
    if (route.tab && !SLUG_TO_TAB[route.tab]) {
      navigate(DEFAULT_TAB, undefined, { replace: true });
    }
  }, [route.tab, navigate]);

  const setActiveTab = (tab: TabId, params?: Record<string, string>) => {
    navigate(tab === DEFAULT_TAB && !params ? DEFAULT_TAB : tab, params);
  };
  const [customTypes, setCustomTypes] = useState<Record<string, any>>({});
  const [customTypesOrder, setCustomTypesOrder] = useState<string[]>([]);
  const [registryCount, setRegistryCount] = useState(0);
  const [documentsCount, setDocumentsCount] = useState(0);

  // Первый заход: приводим адрес к виду #dozvola/<вкладка>, сохраняя query-параметры
  useEffect(() => {
    const h = window.location.hash || '';
    if (!h.startsWith('#dozvola')) {
      navigate(activeTab, route.params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!useFirebase) return;
    const unsubTypes = onValue(ref(database, 'dozvolsTypesV4'), (snap) => setCustomTypes(snap.val() || {}));
    const unsubOrder = onValue(ref(database, 'dozvolsTypesOrderV4'), (snap) => setCustomTypesOrder(Array.isArray(snap.val()) ? snap.val() : Object.keys(snap.val() || {})));
    const unsubRegistry = onValue(ref(database, 'dozvolsRegistryV4'), (snap) => {
      const v = snap.val() || {};
      setRegistryCount(Object.keys(v).length);
    });
    const unsubDocs = onValue(ref(database, 'dozvolsDocumentsHistoryV1'), (snap) => {
      const v = snap.val() || {};
      setDocumentsCount(Array.isArray(v) ? v.length : Object.keys(v).length);
    });
    return () => { unsubTypes(); unsubOrder(); unsubRegistry(); unsubDocs(); };
  }, []);

  const tabs: TabConfig[] = [
    { id: 'registry', label: 'Реестр', badge: registryCount },
    { id: 'locations', label: 'Карта локаций' },
    { id: 'quotas', label: 'Квоты и лимиты' },
    { id: 'documents', label: 'Документы', badge: documentsCount },
    { id: 'history', label: 'Журнал операций' },
    { id: 'types', label: 'Справочник видов', badge: customTypesOrder.length },
  ];

  return (
    <div className="w-full flex flex-col h-full min-h-0">
      <div className={`px-4 sm:px-6 pt-5 ${activeTab === 'locations' ? 'pb-0' : 'pb-2'}`}>
        {/* Название модуля в рабочей области портала */}
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-[#121316]">
          Учёт дозволов
        </h1>

        {/* Вкладки модуля */}
        <div className="mt-4 border-b border-[#E5E7EB] overflow-x-auto scrollbar-none">
          <nav className="flex items-center space-x-6 min-w-max pb-px" aria-label="Вкладки модуля дозволов">
            {tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  data-tab={tab.id}
                  onClick={() => navigate(TAB_SLUGS[tab.id])}
                  className={`relative py-2.5 text-xs font-medium transition-colors focus-visible:outline-none cursor-pointer ${
                    isActive
                      ? 'text-[#121316] font-semibold'
                      : 'text-[#6B7280] hover:text-[#121316]'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    {tab.label}
                    {tab.badge !== undefined && tab.badge > 0 && (
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded-full ${
                          isActive
                            ? 'bg-[#121316] text-white'
                            : 'bg-[#E5E7EB] text-[#4B5563]'
                        }`}
                      >
                        {tab.badge}
                      </span>
                    )}
                  </span>
                  {/* Understated active indicator line */}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#121316] rounded-t-sm" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Module Content Workspace */}
      <div className={`flex-1 min-h-0 flex flex-col ${activeTab === 'locations' ? 'p-0' : 'overflow-y-auto px-4 sm:px-6 py-4'}`}>
        <div className={activeTab === 'registry' ? '' : 'hidden'}>
          <DozvolaRegistryList
            user={user}
            routeParams={route.params}
            onFiltersChange={(params) => navigate('registry', params)}
          />
        </div>
        <div className={activeTab === 'quotas' ? '' : 'hidden'}>
          <DozvolaQuotasBlock
            user={user}
            routeParams={route.params}
            onPeriodChange={(params) => navigate('quotas', params)}
          />
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
          <div className="flex-1 min-h-0 flex flex-col">
            <Suspense fallback={
              <div className="w-full h-full flex flex-col items-center justify-center text-[#6B7280] text-xs">
                <div className="w-6 h-6 border-2 border-[var(--accent-ui)] border-t-transparent rounded-full animate-spin mb-3" />
                <span>Загрузка карты...</span>
              </div>
            }>
              <DozvolaLocations user={user} />
            </Suspense>
          </div>
        )}
      </div>
    </div>
  );
}

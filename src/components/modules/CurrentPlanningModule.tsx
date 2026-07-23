import {useState, useEffect, useRef} from 'react'
import {UserProfile, AppSettings} from '../../types'
import {dbService} from '../../api'
import {getEmbeddableSheetUrl} from '../../utils/embed'
import GoogleSheetFrame from '../common/GoogleSheetFrame'

interface CurrentPlanningModuleProps {
  user: UserProfile;
}

export default function CurrentPlanningModule({ user }: CurrentPlanningModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [refreshKeys, setRefreshKeys] = useState<Record<string, number>>({});

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('ratipa_zoom_currentPlanning');
    return saved ? parseFloat(saved) : 1;
  });

  useEffect(() => {
    localStorage.setItem('ratipa_zoom_currentPlanning', zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    const unsubscribe = dbService.getSettings((s) => setSettings(s));
    return () => unsubscribe();
  }, []);

  const tabs = settings?.currentPlanningTabs || [];

  useEffect(() => {
    if (tabs.length > 0 && !activeTabId) {
       const allowedTabs = tabs.filter(t => user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions[`currentPlanning_${t.id}`] !== 'none'));
       if (allowedTabs.length > 0) {
         setActiveTabId(allowedTabs[0].id);
       }
    }
  }, [tabs, activeTabId, user]);

  const allowedTabs = tabs.filter(t => user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions[`currentPlanning_${t.id}`] !== 'none'));

  const handleRefresh = () => {
    if (activeTabId) {
      setRefreshKeys(prev => ({ ...prev, [activeTabId]: (prev[activeTabId] || 0) + 1 }));
    }
  };

  if (allowedTabs.length === 0) {
    return (
      <div className="bg-white rounded-[2rem] p-10 shadow-sm border border-slate-200 text-center flex flex-col justify-center items-center h-full">
        <span className="text-sm font-black text-slate-800 uppercase font-mono tracking-wider">Нет доступных вкладок</span>
        <p className="text-xs text-slate-500 max-w-xs mt-2 font-medium">
          Вам не назначено прав доступа ни к одной подвкладке текущего планирования.
        </p>
      </div>
    );
  }

  const activeTab = allowedTabs.find(t => t.id === activeTabId) || allowedTabs[0];
  const embedUrl = activeTab?.sheetUrl ? getEmbeddableSheetUrl(activeTab.sheetUrl) : "";

  const sheetTabs = allowedTabs.map(t => ({ id: t.id, name: t.name, variant: 'blue' as const }));

  return (
    <div className={`w-full h-full flex flex-col font-sans ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-2 lg:p-4' : ''}`}>
      <GoogleSheetFrame
        title="Текущее планирование"
        subtitle="Расписание, мониторинг и управление текущими рейсами"
        zoom={zoomLevel}
        onZoomChange={setZoomLevel}
        onRefresh={handleRefresh}
        tabs={sheetTabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
        collapseKey="currentPlanning"
        toolbar
      >
        {activeTab && activeTab.sheetUrl ? (
          <div style={{
              width: `${100 / zoomLevel}%`,
              height: `${100 / zoomLevel}%`,
              transform: `scale(${zoomLevel})`,
              transformOrigin: 'top left'
            }} 
            className="absolute top-0 left-0"
          >
            <iframe 
              key={`${activeTab.id}-${refreshKeys[activeTab.id] || 0}`}
              src={embedUrl}
              className="w-full h-full border-none"
              title={`google-sheet-${activeTab.id}`}
            />
          </div>
        ) : (
          <div className="absolute inset-0 bg-white rounded-3xl flex items-center justify-center border border-slate-200/60 p-10">
            <div className="text-center font-mono font-black uppercase tracking-widest text-slate-400 text-xs">
              Ссылка на Google Таблицу не указана.
            </div>
          </div>
        )}
      </GoogleSheetFrame>
    </div>
  );
}

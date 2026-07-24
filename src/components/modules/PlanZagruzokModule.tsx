import {useState, useEffect, useRef, useMemo} from 'react'
import {UserProfile, AppSettings} from '../../types'
import {dbService} from '../../api'
import {getEmbeddableSheetUrl} from '../../utils/embed'
import {useToast} from '../ToastProvider'
import GoogleSheetFrame, {SheetTab} from '../common/GoogleSheetFrame'
import {Lock} from 'lucide-react'

interface PlanZagruzokModuleProps {
  user: UserProfile;
}

export default function PlanZagruzokModule({ user }: PlanZagruzokModuleProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [loadedFrameIds, setLoadedFrameIds] = useState<Record<string, boolean>>({});
  const [iframeKey, setIframeKey] = useState(0);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);

  const activeIsLoading = activeTabId ? !loadedFrameIds[activeTabId] : true;
  const [zoomLevel, setZoomLevel] = useState(() => {
    const saved = localStorage.getItem('ratipa_zoom_planZagruzok');
    return saved ? parseInt(saved, 10) : 100;
  });

  useEffect(() => {
    localStorage.setItem('ratipa_zoom_planZagruzok', zoomLevel.toString());
  }, [zoomLevel]);

  useEffect(() => {
    const unsubscribe = dbService.getSettings((s) => setSettings(s));
    return () => unsubscribe();
  }, []);

  const allowedTabs = useMemo(() => {
    const dynamicTabs = settings?.planZagruzokTabs || [];
    const allowedDynamicTabs = dynamicTabs.filter(t => user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions[`planZagruzok_${t.id}`] !== 'none'));
    const hasBasePermission = user.role === 'root_admin' || user.role === 'admin' || (user.permissions && user.permissions.planZagruzok !== 'none');

    return [
      ...(hasBasePermission ? [
        { 
          id: 'plan', 
          name: 'План загрузок', 
          sheetUrl: settings?.planZagruzokSheetUrl || settings?.googleSheetsUrl || "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit#gid=0", 
          variant: 'default' as const 
        },
        ...(settings?.planZagruzokBlacklistUrl ? [
          { 
            id: 'blacklist', 
            name: 'Чёрный список', 
            sheetUrl: settings?.planZagruzokBlacklistUrl, 
            variant: 'rose' as const 
          }
        ] : [])
      ] : []),
      ...allowedDynamicTabs.map(t => ({
        id: t.id,
        name: t.name,
        sheetUrl: t.sheetUrl,
        variant: 'blue' as const
      }))
    ];
  }, [settings, user.role, user.permissions]);

  useEffect(() => {
    const firstAllowedId = allowedTabs[0]?.id;
    if (!firstAllowedId) return;
    if (!activeTabId || !allowedTabs.some((t) => t.id === activeTabId)) {
      setActiveTabId(firstAllowedId);
    }
  }, [allowedTabs, activeTabId]);

  const activeTabObj = allowedTabs.find(t => t.id === activeTabId) || allowedTabs[0];
  const embedUrl = activeTabObj?.sheetUrl || "";

  const handleRefresh = () => {
    if (activeTabId) {
      setLoadedFrameIds(prev => ({ ...prev, [activeTabId]: false }));
      setIframeKey(prev => prev + 1);
    }
  };

  return (
    <div className={`w-full h-full font-sans flex flex-col ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/10 backdrop-blur-md p-4 lg:p-6' : ''}`}>
      <GoogleSheetFrame
        title="План загрузок"
        subtitle="Полная таблица планирования загрузок"
        url={embedUrl}
        zoom={zoomLevel}
        onZoomChange={setZoomLevel}
        onRefresh={handleRefresh}
        tabs={allowedTabs}
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
        collapseKey="planZagruzok"
        toolbar
        mode="fill"
      >
        {allowedTabs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col justify-center items-center p-8 text-center bg-slate-50/50 rounded-2xl select-none">
            <span className="text-sm font-bold text-slate-800 uppercase tracking-tight">Доступ Заблокирован</span>
          </div>
        ) : (
          <div style={{
             width: `${10000 / zoomLevel}%`,
             height: `${10000 / zoomLevel}%`,
             transform: `scale(${zoomLevel / 100})`,
             transformOrigin: 'top left',
             minHeight: '100%',
             position: 'absolute'
          }}>
            {allowedTabs.map(tab => (
              <iframe
                key={tab.id + '-' + (activeTabId === tab.id ? iframeKey : 0)}
                src={getEmbeddableSheetUrl(tab.sheetUrl)}
                onLoad={() => setLoadedFrameIds(prev => ({ ...prev, [tab.id]: true }))}
                className="w-full h-full border-0 absolute top-0 left-0"
                style={{ display: activeTabId === tab.id ? 'block' : 'none' }}
                allow="clipboard-write"
                title={`План Загрузок Ratipa ${tab.name}`}
              />
            ))}
            {activeIsLoading && (
              <div className="absolute inset-0 bg-white/95 flex flex-col p-8 gap-6 z-10 transition duration-350 select-none">
                <div className="flex items-center justify-between">
                  <div className="h-6 w-48 bg-slate-200 rounded-lg" />
                  <div className="flex gap-2">
                    <div className="h-10 w-24 bg-slate-100 rounded-xl" />
                    <div className="h-10 w-24 bg-slate-100 rounded-xl" />
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 flex-1 overflow-hidden">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div key={i} className="border border-slate-200/40 rounded-2xl p-5 space-y-4 bg-white/60 backdrop-blur-xs shadow-2xs">
                      <div className="flex justify-between items-center">
                        <div className="h-4 w-2/3 bg-slate-200 rounded" />
                        <div className="h-4 w-1/4 bg-slate-100 rounded" />
                      </div>
                      <div className="space-y-2">
                        <div className="h-3 w-full bg-slate-100 rounded" />
                        <div className="h-3 w-5/6 bg-slate-100 rounded" />
                        <div className="h-3 w-4/6 bg-slate-100 rounded" />
                      </div>
                      <div className="pt-2 flex gap-2">
                        <div className="h-7 w-16 bg-slate-100 rounded-lg" />
                        <div className="h-7 w-16 bg-slate-100 rounded-lg" />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </GoogleSheetFrame>
    </div>
  );
}
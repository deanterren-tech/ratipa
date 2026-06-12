import { useState, useEffect } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../firebase';
import { 
  FileSpreadsheet, 
  Maximize2, 
  Minimize2, 
  RefreshCw, 
  ExternalLink, 
  HelpCircle,
  Sparkles,
  Link2,
  Lock
} from 'lucide-react';
import { useToast } from '../ToastProvider';

interface PlanZagruzokModuleProps {
  user: UserProfile;
}

export default function PlanZagruzokModule({ user }: PlanZagruzokModuleProps) {
  const { toast } = useToast();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [isIframeLoading, setIsIframeLoading] = useState(true);
  const [iframeKey, setIframeKey] = useState(0); // to force reload the iframe
  const [customSheetId, setCustomSheetId] = useState('');

  useEffect(() => {
    // Subscribe to settings
    const unsubscribe = dbService.getSettings((s) => {
      setSettings(s);
      if (s) {
        setCustomSheetId(s.googleSheetsId || "1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM");
      }
    });

    return () => unsubscribe();
  }, []);

  // Construct iframe source URL
  // Section 28.6 standard sheet: 1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM
  const sheetId = settings?.googleSheetsId || "1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM";
  
  // High fidelity iframe source: we prefer the edit view with minimal headers or published view
  // If we embed "https://docs.google.com/spreadsheets/d/1qUSrRKGqqo3fZSlpZnxEw-59Y86KJ7tmSnf4liNoMM/edit?rm=minimal&chrome=false", it becomes fully operational if users are logged into their Google account!
  const embedUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?rm=minimal&chrome=false&widget=true&headers=false`;
  const sheetsExternalUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/edit?usp=sharing`;

  const handleRefresh = () => {
    setIsIframeLoading(true);
    setIframeKey(prev => prev + 1);
  };

  const handleOverrideSheetId = () => {
    if (!settings) return;
    if (!customSheetId.trim()) {
      toast("Пожалуйста, введите корректный ID Google Таблицы.", 'error');
      return;
    }

    // Extract ID if a full URL is pasted
    let finalId = customSheetId.trim();
    if (finalId.includes('/spreadsheets/d/')) {
       const match = finalId.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
       if (match) {
         finalId = match[1];
       }
    }

    const updated: AppSettings = {
      ...settings,
      googleSheetsId: finalId,
      googleSheetsUrl: `https://docs.google.com/spreadsheets/d/${finalId}/edit`,
    };

    dbService.saveSettings(updated, user.name, user.role);
    toast("Параметры таблицы изменены и синхронизированы в Firebase.", 'success');
  };

  return (
    <div className={`w-full space-y-6 font-sans flex flex-col ${isFocusMode ? 'fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-md p-6' : 'h-full'}`}>
      
      {/* Top modern action block corresponding to high-end style */}
      <div className="bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] flex flex-col lg:flex-row items-center justify-between gap-6 select-none">
        
        {/* Left Side: Title and indicators */}
        <div className="flex items-center gap-4 w-full lg:w-auto">
          <div className="w-12 h-12 rounded-full bg-[#70FC8E]/15 border border-[#70FC8E]/45 flex items-center justify-center shrink-0">
            <FileSpreadsheet className="h-5 w-5 text-slate-900" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl sm:text-2xl font-black text-slate-900 uppercase tracking-tight">
                План Загрузок
              </h1>
              <span className="bg-[#70FC8E] text-slate-950 text-[9px] font-mono font-black px-2.5 py-0.5 rounded-full border border-black/5 uppercase tracking-wider">
                Синхр Google Таблиц
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-500 mt-1 font-medium">
              {isFocusMode ? 'Режим Focus: Скрыта вспомогательная панель' : 'Синхронизировано в реальном времени с облачным реестром компании'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-start lg:justify-end">
          
          {/* Quick Override Input for managers */}
          {user.role === 'root_admin' && !isFocusMode && (
            <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 p-1.5 rounded-xl">
              <Link2 className="h-4 w-4 text-slate-400 pl-1" />
              <input
                type="text"
                placeholder="Вставить ID таблицы..."
                value={customSheetId}
                onChange={(e) => setCustomSheetId(e.target.value)}
                className="bg-transparent text-[11px] font-bold text-slate-800 focus:outline-none w-36 placeholder:text-slate-400"
              />
              <button
                onClick={handleOverrideSheetId}
                className="bg-slate-950 hover:bg-slate-800 text-[#70FC8E] text-[10px] font-black px-3 py-1.5 rounded-lg transition uppercase tracking-tighter"
              >
                Сохранить
              </button>
            </div>
          )}

          {/* Action buttons */}
          <button
            onClick={handleRefresh}
            className="flex items-center gap-2 bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-black px-4 py-2.5 rounded-xl border border-slate-200/50 transition cursor-pointer"
            title="Перезагрузить фрейм"
          >
            <RefreshCw className="h-4 w-4 text-slate-500" />
            <span className="hidden sm:inline">Обновить</span>
          </button>

          <a
            href={sheetsExternalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 bg-slate-950 hover:bg-slate-850 text-[#70FC8E] text-xs font-black px-4 py-2.5 rounded-xl transition cursor-pointer shadow-xs uppercase tracking-tight"
          >
            <ExternalLink className="h-4 w-4" />
            <span>Открыть в Таблицах</span>
          </a>

          <button
            onClick={() => setIsFocusMode(!isFocusMode)}
            className={`flex items-center gap-2 text-xs font-black px-4 py-2.5 rounded-xl border transition cursor-pointer uppercase tracking-tight ${
              isFocusMode 
                ? 'bg-[#70FC8E] border-[#70FC8E] text-slate-950 hover:opacity-90 shadow-sm' 
                : 'bg-white border-slate-250 text-slate-705 lg:hover:bg-slate-50'
            }`}
          >
            {isFocusMode ? (
              <>
                <Minimize2 className="h-4 w-4" />
                <span>Свернуть</span>
              </>
            ) : (
              <>
                <Maximize2 className="h-4 w-4" />
                <span>На весь экран</span>
              </>
            )}
          </button>

        </div>
      </div>

      {/* Frame Workspace (Container filling up the maximum screen bounds) */}
      <div 
        className="relative bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)] overflow-hidden flex-1 flex flex-col"
        style={{ minHeight: isFocusMode ? 'calc(100vh - 120px)' : 'calc(100vh - 230px)' }}
      >
        
        {/* Iframe loader representation */}
        {isIframeLoading && (
          <div className="absolute inset-0 bg-white/85 backdrop-blur-md flex flex-col justify-center items-center z-10 transition duration-350 select-none">
            <div className="relative">
              <div className="h-14 w-14 rounded-full border-4 border-slate-100 border-t-slate-950 animate-spin" />
              <FileSpreadsheet className="h-5 w-5 text-slate-900 absolute top-4.5 left-4.5" />
            </div>
            <span className="text-sm font-black text-slate-900 mt-5 uppercase tracking-wider font-mono animate-pulse">
              Интеграция Google Таблиц...
            </span>
            <p className="text-[10px] text-slate-400 mt-1 max-w-[280px] text-center font-bold">
              Подключение к защищенным серверам Google API
            </p>
          </div>
        )}

        {/* Security instructions overlay */}
        {user.permissions.planZagruzok === 'none' ? (
          <div className="flex-1 flex flex-col justify-center items-center p-8 text-center bg-slate-50 select-none">
            <Lock className="h-10 w-10 text-slate-900 mb-2" />
            <span className="text-sm font-black text-slate-900 uppercase tracking-tight">Доступ Заблокирован</span>
            <p className="text-xs text-slate-500 max-w-sm mt-1.5 font-medium">
              У вас недостаточно полномочий в профиле для просмотра плана загрузок. Обратитесь к Сергей.
            </p>
          </div>
        ) : (
          <div className="w-full flex-1 relative bg-slate-100">
            <iframe
              key={iframeKey}
              src={embedUrl}
              onLoad={() => setIsIframeLoading(false)}
              className="w-full h-full border-0"
              style={{
                width: '100%',
                height: '100%',
                minHeight: isFocusMode ? 'calc(100vh - 130px)' : 'calc(100vh - 240px)',
                position: 'absolute',
                top: 0,
                left: 0
              }}
              allow="clipboard-write"
              title="План Загрузок Ratipa"
            />
          </div>
        )}

      </div>

      {/* Guide details footer (Only when not in focus mode) */}
      {!isFocusMode && (
        <div className="p-5 bg-slate-50 rounded-[2rem] border border-slate-200/50 flex items-start gap-3 text-xs text-slate-600 shadow-[0_8px_30px_rgba(0,0,0,0.01)]">
          <HelpCircle className="h-5 w-5 shrink-0 text-slate-900 mt-0.5" />
          <p className="font-semibold leading-relaxed">
            <strong className="font-black text-slate-900 uppercase tracking-wider block mb-1">Инструкция по редактированию</strong>
            Чтобы изменять ячейки во фрейме, вы должны быть авторизованы в своем рабочем Google-аккаунте, которому предоставлен доступ редактора к этой Google Таблице. В ином случае таблица откроется только в режиме чтения. Используйте кнопку <strong className="text-slate-905 font-black">«Открыть в Таблицах»</strong>, чтобы перейти к работе в полноценном внешнем окне Google Sheets.
          </p>
        </div>
      )}

    </div>
  );
}

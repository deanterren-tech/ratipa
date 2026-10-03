import {useDialog} from '../DialogProvider'
import { useToast } from '../ToastProvider';
import {useState, useEffect, useRef} from 'react'
import {UserProfile, AppSettings} from '../../types'
import { dbService, directoryService } from '../../api';
import {
  ChevronDown,
  ChevronUp,
  Lock,
  LogOut,
  ShieldAlert,
  ShieldCheck,
  Layers,
  ExternalLink,
  Globe,
  Check,
} from 'lucide-react';
import UserManagementBlock from './UserManagementBlock';
import ErrorsBlock from './ErrorsBlock';
import AdminOnlinePresenceBlock from './AdminOnlinePresenceBlock';

import AdminFirebaseConfigBlock from './AdminFirebaseConfigBlock';
import AdminAgentBlock from './AdminAgentBlock';
import AdminAuditLogsBlock from './AdminAuditLogsBlock';
import AdminWelcomePhrasesBlock from './AdminWelcomePhrasesBlock';
import AdminBroadcastBlock from './AdminBroadcastBlock';import AdminLinksBlock from './AdminLinksBlock';
import AdminAnnouncementsBlock from './AdminAnnouncementsBlock';
import CurrentPlanningSettingsBlock from './CurrentPlanningSettingsBlock';
import PlanZagruzokSettingsBlock from './PlanZagruzokSettingsBlock';
import {pdService} from '../../api';
import { UI } from '../../ui/kit';
import { ModuleShell, SectionHeader } from '../../ui/components';

interface AdminModuleProps {
  user: UserProfile;
}

type AdminTab = 'users' | 'broadcast' | 'links' | 'integrations' | 'planning' | 'system' | 'agent' | 'errors';

/** Подтверждение сохранения настроек — одинаковое на всех вкладках с инлайновой записью. */
function SaveFlash() {
  return (
    <span
      aria-live="polite"
      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-medium text-emerald-700"
    >
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      Настройки сохранены
    </span>
  );
}

export default function AdminModule({ user }: AdminModuleProps) {
  const { showConfirm } = useDialog();
  const { toast } = useToast();

  /** Ссылки часто вставляют без схемы — дополняем и обрезаем пробелы, чтобы адрес работал. */
  const normalizeUrl = (raw: string) => {
    const value = (raw || '').trim();
    if (!value) return '';
    return /^https?:\/\//i.test(value) ? value : `https://${value}`;
  };
  

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const savedFlashTimer = useRef<number | null>(null);
  const [logs, setLogs] = useState<any[]>([]);
  const [searchLogs, setSearchLogs] = useState('');
  const [userListCount, setUserListCount] = useState(0);
  const [dispatchersCount, setDispatchersCount] = useState(0);
  const [customPhrasesText, setCustomPhrasesText] = useState('');
  const [activeTab, setActiveTab] = useState<AdminTab>('users');
  useEffect(() => {
    if (settings?.customPhrases) setCustomPhrasesText(settings.customPhrases.join('\n'));
  }, [settings?.customPhrases]);

  // Fetch data
  useEffect(() => {
    const unsubSettings = dbService.getSettings(setSettings);
    const unsubLogs = dbService.getAuditLogs(setLogs);
    const unsubUsers = dbService.getUsers((list) => setUserListCount(list?.length || 0));
    const unsubDisp = directoryService.getDispatchersFlat((disp) => setDispatchersCount(disp?.length || 0));
    return () => {
      unsubSettings();
      unsubLogs();
      unsubUsers();
      unsubDisp();
    };
  }, []);

  const saveSettings = (newStgs: AppSettings) => {
    const changed = JSON.stringify(newStgs) !== JSON.stringify(settings);
    setSettings(newStgs);
    if (changed) {
      // Подтверждение показываем и плашкой в разделе, и уведомлением: запись уходит в базу,
      // а обратную связь пользователь должен увидеть сразу.
      setSavedFlash(true);
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = window.setTimeout(() => setSavedFlash(false), 3000);
      toast('Настройки сохранены', 'success');
    }
    dbService.saveSettings(newStgs, user.name, user.role).catch(() => {
      toast('Не удалось сохранить настройки. Попробуйте ещё раз.', 'error');
    });
  };

  // Принудительно завершить ВСЕ активные сессии (force-logout).
  // Инкрементируем globalSessionVersion -> все клиенты получают обновление и разлогиниваются.
  const handleForceLogoutAll = () => {
    showConfirm(
      'Все пользователи будут принудительно выведены из системы. Им потребуется повторно авторизоваться. Это безопасно после обновлений — гарантирует, что у всех подхватятся новые функции и схема данных.',
      'Завершить все сессии?'
    ).then((ok) => {
      if (!ok) return;
      const nextVersion = (Number(settings?.globalSessionVersion || 0)) + 1;
      saveSettings({ ...(settings as AppSettings), globalSessionVersion: nextVersion });
    });
  };

  const allModules = [
    { key: 'dashboard', label: 'Главная', icon: Layers },
    { key: 'dohod', label: 'Калькуляция', icon: Layers },
    { key: 'salary', label: 'Зарплата Водителей', icon: Layers },
    { key: 'planDohod', label: 'План Дохода', icon: Layers },
    { key: 'planZagruzok', label: 'План Загрузок', icon: Layers },
    { key: 'currentPlanning', label: 'Текущее Планирование', icon: Layers },
    { key: 'baza', label: 'Учет выезда', icon: Layers },
    { key: 'dozvola', label: 'Учет Дозволов', icon: Layers },
    { key: 'disposition', label: 'Диспозиция', icon: Layers },
    { key: 'settings', label: 'Справочники', icon: Layers },
    { key: 'appSettings', label: 'Настройки', icon: Layers },
    { key: 'admin', label: 'Администрирование', icon: ShieldAlert }
  ];

  const moveModule = (moduleKey: string, direction: 'up' | 'down') => {
    if (!settings) return;
    const currentOrder = settings.moduleOrder || allModules.map(m => m.key);
    const order = [...currentOrder];
    // Ensure all keys are in order array
    allModules.forEach(m => { if (!order.includes(m.key)) order.push(m.key); });
    
    const idx = order.indexOf(moduleKey);
    if (idx < 0) return;
    
    if (direction === 'up' && idx > 0) {
      const temp = order[idx - 1];
      order[idx - 1] = order[idx];
      order[idx] = temp;
    } else if (direction === 'down' && idx < order.length - 1) {
      const temp = order[idx + 1];
      order[idx + 1] = order[idx];
      order[idx] = temp;
    }
    saveSettings({ ...settings, moduleOrder: order });
  };

  // Audit Logs filtering
  const filteredLogs = logs.filter(
    l => String(l.user || '').toLowerCase().includes(searchLogs.toLowerCase()) ||
         String(l.details || '').toLowerCase().includes(searchLogs.toLowerCase()) ||
         String(l.module || '').toLowerCase().includes(searchLogs.toLowerCase())
  );

  // Lock non-admins completely
  if (user.role !== 'root_admin' && user.role !== 'admin') {
    return (
      <div className="w-full flex flex-col items-center justify-center py-24 text-center select-none">
        <div className="p-3 bg-[#F3F4F6] rounded-2xl mb-3">
          <Lock className="h-7 w-7 text-[#9CA3AF]" style={{ strokeWidth: 1.5 }} />
        </div>
        <span className="text-sm font-semibold text-[#121316]">Доступ заблокирован</span>
        <p className="text-xs text-[#6B7280] max-w-xs mt-1.5 leading-relaxed">
          Панель root-администрирования доступна только администраторам.
        </p>
      </div>
    );
  }

  // Вкладки идут по частоте ежедневной работы: люди → общение → материалы →
  // внешние системы → планирование → системное → диагностика.
  const sheetAndGpsFields = [
    'planZagruzokSheetUrl', 'planZagruzokBlacklistUrl', 'dispositionSheetUrl', 'bookIssueSheetUrl',
    'tabelSheetUrl', 'mdpJournalSheetUrl', 'googleDriveUrl', 'instructionsDriveUrl',
    'gpsBeltranssputnikUrl', 'gpsWialonUrl', 'gpsEraGlonassUrl',
  ] as const;
  const integrationCount = settings
    ? sheetAndGpsFields.filter((f) => String(settings[f] || '').trim() !== '').length
    : 0;

  const tabsList = [
    { key: 'users', label: 'Сотрудники и доступ', count: userListCount },
    { key: 'broadcast', label: 'Сообщения', count: settings?.customPhrases?.length || 0 },
    { key: 'links', label: 'Ссылки и материалы', count: (settings?.quickLinks?.length || 0) + (settings?.externalTabs?.length || 0) },
    { key: 'integrations', label: 'Интеграции', count: integrationCount },
    { key: 'planning', label: 'Планирование', count: 0 },
    { key: 'system', label: 'Система', count: 0 },
    { key: 'agent', label: 'Агент (API)', count: 0 },
    { key: 'errors', label: 'Ошибки', count: 0 },
  ].map((t) => ({ ...t, count: t.count > 0 ? t.count : undefined }));

  // Порядок модулей в меню (восстановленная настройка: AppShell читает settings.moduleOrder,
  // а интерфейс для правки был потерян).
  const orderedModules = (() => {
    const order = (settings?.moduleOrder && settings.moduleOrder.length)
      ? [...settings.moduleOrder]
      : allModules.map((m) => m.key);
    allModules.forEach((m) => { if (!order.includes(m.key)) order.push(m.key); });
    return order
      .map((key) => allModules.find((m) => m.key === key))
      .filter(Boolean) as typeof allModules;
  })();

  return (
    <ModuleShell
      title="Администрирование"
      tabs={tabsList}
      activeTab={activeTab}
      onTabChange={(key) => setActiveTab(key as AdminTab)}
      tabsAriaLabel="Вкладки панели администрирования"
      actions={
        <span className="inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-[#4B5563] bg-[#F3F4F6] border border-[#E5E7EB] px-2.5 py-1 rounded-full select-none">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          {user.role === 'root_admin' ? 'Root доступ' : 'Администратор'}
        </span>
      }
    >
      <div className="space-y-8">

        {/* ПОЛЬЗОВАТЕЛИ И СЕССИИ */}
        <div className={activeTab === 'users' ? 'space-y-8' : 'hidden'}>
          <UserManagementBlock user={user} />
          <AdminOnlinePresenceBlock user={user} />
        </div>

        {/* СИСТЕМА: состояние базы, порядок меню, сессии, журнал действий */}
        <div className={activeTab === 'system' ? 'space-y-8' : 'hidden'}>
          <AdminFirebaseConfigBlock />

          <div className="flex flex-col gap-4">
            <SectionHeader
              icon={<Layers className="w-4 h-4" />}
              tone="graphite"
              title="Порядок модулей в меню"
              subtitle="Определяет порядок пунктов в верхнем меню портала. Меняйте стрелками — сохраняется сразу."
            />
            <div className="bg-white border border-[#E5E7EB] rounded-2xl divide-y divide-[#F3F4F6] overflow-hidden">
              {orderedModules.map((m, index) => (
                <div key={m.key} className="flex items-center gap-3 px-4 py-2 min-h-[44px]">
                  <span className="w-5 shrink-0 text-[11px] font-mono text-[#9CA3AF]">{index + 1}</span>
                  <m.icon className="w-3.5 h-3.5 shrink-0 text-[#6B7280]" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-xs text-[#121316]">{m.label}</span>
                  <button
                    type="button"
                    aria-label={`Поднять «${m.label}» выше`}
                    disabled={index === 0}
                    onClick={() => moveModule(m.key, 'up')}
                    className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] disabled:opacity-30 disabled:cursor-default cursor-pointer"
                  >
                    <ChevronUp className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Опустить «${m.label}» ниже`}
                    disabled={index === orderedModules.length - 1}
                    onClick={() => moveModule(m.key, 'down')}
                    className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center rounded-lg text-[#6B7280] hover:text-[#121316] hover:bg-[#F3F4F6] disabled:opacity-30 disabled:cursor-default cursor-pointer"
                  >
                    <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
            <span className={UI.hint}>Скрытые для роли модули продолжают работать — настройка меняет только порядок.</span>
          </div>

          {/* Force Logout All Sessions — только для Root Admin */}
          {user.role === 'root_admin' && (
            <div className="bg-white border border-rose-200 rounded-2xl shadow-xs p-5">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="p-2 bg-rose-50 text-rose-600 rounded-xl shrink-0">
                    <ShieldAlert className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-[#121316]">Завершение всех сессий</h3>
                    <p className="text-xs text-[#6B7280] mt-0.5 max-w-md leading-relaxed">
                      Принудительно выводит из системы всех пользователей. Используйте после обновлений, чтобы все гарантированно вошли заново и работали на актуальной схеме данных.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleForceLogoutAll}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold transition-colors cursor-pointer shadow-sm shrink-0 min-h-[44px] self-start"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Завершить все сессии
                </button>
              </div>
              <div className="mt-4 pt-3 border-t border-[#E5E7EB] text-[11px] font-mono text-[#6B7280]">
                Текущая версия сессии: {settings?.globalSessionVersion || 0}
              </div>
            </div>
          )}

          <AdminAuditLogsBlock logs={logs} />
        </div>

        {/* СООБЩЕНИЯ: рассылка, объявления, бегущая строка на главной */}
        <div className={activeTab === 'broadcast' ? 'space-y-8' : 'hidden'}>
          <AdminBroadcastBlock user={user} />
          <AdminAnnouncementsBlock user={user} settings={settings} />
          <AdminWelcomePhrasesBlock settings={settings} onSave={saveSettings} />
        </div>

        {/* ССЫЛКИ И МАТЕРИАЛЫ */}
        <div className="flex h-5 items-center justify-end">{savedFlash ? <SaveFlash /> : null}</div>
        <div
          className={activeTab === 'links' ? 'space-y-8' : 'hidden'}
          onKeyDownCapture={(e) => {
            // Enter в поле ссылки = сохранить (уходим из поля, срабатывает onBlur)
            const target = e.target as HTMLElement;
            if (e.key === 'Enter' && target.tagName === 'INPUT') {
              (target as HTMLInputElement).blur();
            }
          }}
        >
          <AdminLinksBlock user={user} settings={settings} onSave={saveSettings} />
        </div>

        {/* ИНТЕГРАЦИИ: Google Таблицы и GPS-мониторинг */}
        <div className={activeTab === 'integrations' ? 'space-y-8' : 'hidden'}>
          <div className="flex h-5 items-center justify-end">{savedFlash ? <SaveFlash /> : null}</div>

          {/* Интеграции: Google Sheets & GPS */}
          {settings && (
            <div className="flex flex-col gap-5">
              <SectionHeader
                icon={<Layers className="w-4 h-4" />}
                tone="graphite"
                title="Google Таблицы и GPS-мониторинг"
                subtitle="Адреса встроенных таблиц портала и систем спутникового контроля автопарка. Ссылки сохраняются при уходе из поля."
              />

              {/* Google Таблицы */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <ExternalLink className="w-3.5 h-3.5 text-[#6B7280]" />
                  <h4 className="text-xs font-semibold text-[#121316]">Google Таблицы (встроенные фреймы)</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">План Загрузок</label>
                    <input type="url"
                      defaultValue={settings.planZagruzokSheetUrl || ''}
                      onBlur={(e) => saveSettings({...settings, planZagruzokSheetUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://docs.google.com/spreadsheets/d/..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">План Загрузок (чёрный список)</label>
                    <input type="url"
                      defaultValue={settings.planZagruzokBlacklistUrl || ''}
                      onBlur={(e) => saveSettings({...settings, planZagruzokBlacklistUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://docs.google.com/spreadsheets/d/..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Диспозиция</label>
                    <input type="url"
                      defaultValue={settings.dispositionSheetUrl || ''}
                      onBlur={(e) => saveSettings({...settings, dispositionSheetUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://docs.google.com/spreadsheets/d/..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Книга выдачи — Google Таблица</label>
                    <input type="url"
                      defaultValue={settings.bookIssueSheetUrl || ''}
                      onBlur={(e) => saveSettings({...settings, bookIssueSheetUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://docs.google.com/spreadsheets/d/..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Табель — Google Таблица</label>
                    <input type="url"
                      defaultValue={settings.tabelSheetUrl || ''}
                      onBlur={(e) => saveSettings({...settings, tabelSheetUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://docs.google.com/spreadsheets/d/..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Журнал МДП — Google Таблица</label>
                    <input type="url"
                      defaultValue={settings.mdpJournalSheetUrl || ''}
                      onBlur={(e) => saveSettings({...settings, mdpJournalSheetUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://docs.google.com/spreadsheets/d/..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Google Диск</label>
                    <input type="url"
                      defaultValue={settings.googleDriveUrl || ''}
                      onBlur={(e) => saveSettings({...settings, googleDriveUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://drive.google.com/drive/folders/..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Google Диск для модуля инструкций</label>
                    <input type="url"
                      defaultValue={settings.instructionsDriveUrl || ''}
                      onBlur={(e) => saveSettings({...settings, instructionsDriveUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://drive.google.com/drive/folders/..." />
                    <p className="text-[10px] leading-relaxed text-[#9CA3AF]">
                      Ссылку задают только здесь: в модуле «Инструкции» она не редактируется. Папка открывается
                      кнопкой «Google Диск» в этом модуле; ссылка своя, отдельная от Диска в «Авто и водителях».
                    </p>
                  </div>
                </div>
              </div>

              {/* GPS Интеграции */}
              <div className="pt-5 border-t border-[#E5E7EB] flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-[#6B7280]" />
                  <h4 className="text-xs font-semibold text-[#121316]">Спутниковый GPS мониторинг</h4>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Белтрансспутник</label>
                    <input type="url"
                      defaultValue={settings.gpsBeltranssputnikUrl || ''}
                      onBlur={(e) => saveSettings({...settings, gpsBeltranssputnikUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">Wialon</label>
                    <input type="url"
                      defaultValue={settings.gpsWialonUrl || ''}
                      onBlur={(e) => saveSettings({...settings, gpsWialonUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://..." />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-[#6B7280] block">ЭРА ГЛОНАСС</label>
                    <input type="url"
                      defaultValue={settings.gpsEraGlonassUrl || ''}
                      onBlur={(e) => saveSettings({...settings, gpsEraGlonassUrl: normalizeUrl(e.target.value)})}
                      className={UI.input}
                      placeholder="https://..." />
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* ПЛАНИРОВАНИЕ: вкладки текущего планирования и план загрузок */}
        <div className={activeTab === 'planning' ? 'space-y-8' : 'hidden'}>
          <SectionHeader
            icon={<Layers className="w-4 h-4" />}
            tone="graphite"
            title="Планирование"
            subtitle="Вкладки раздела «Текущее планирование» и параметры «Плана загрузок»."
          />
          <CurrentPlanningSettingsBlock user={user} />
          <PlanZagruzokSettingsBlock user={user} />
        </div>

        {/* АГЕНТ (API) */}
        <div className={activeTab === 'agent' ? '' : 'hidden'}>
          <AdminAgentBlock user={user} />
        </div>

        {/* ОШИБКИ: диагностика сбоев портала */}
        <div className={activeTab === 'errors' ? 'space-y-8' : 'hidden'}>
          <ErrorsBlock user={user} />
        </div>

      </div>
    </ModuleShell>
  );
}

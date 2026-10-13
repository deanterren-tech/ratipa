/**
 * Раздел «Пробег и связь» (упрощённый, по ТЗ владельца).
 *
 * Две вкладки:
 *  - «Нет обновлений» — состояние телеметрии по сопоставленному автопарку;
 *  - «Проверка пробега» — простая таблица «автомобиль — рейс — CAN-данные —
 *    график»: показания одометра смотрят в отдельном окне.
 *
 * Обращения и въезд в РФ из интерфейса раздела убраны (вкладка, колонки,
 * кнопки, диалог). Данные этих сущностей и их сервисный слой не удалены —
 * другие части портала их не используют, но и не должны пострадать.
 *
 * Данные приходят из RTDB (ветки telemetry_*), которые наполняет серверный
 * поллер (server/navby). Браузер к Nav.by не обращается.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Settings2, WifiOff } from 'lucide-react';
import { UserProfile, AppSettings, Vehicle } from '../../../types';
import { dbService } from '../../../api';
import { resolvePermission } from '../../../utils/permissions';
import { ModuleShell, EmptyState } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import { mcService } from './mcService';
import {
  MC_CONFIG_DEFAULTS,
  fmtTs,
  type McConfig, type McCurrent, type McIntegration, type McMapping,
  type McMappingHistoryEntry, type McNavbyObject,
} from './mcTypes';
import NoUpdatesTab from './NoUpdatesTab';
import MileageCheckTab from './MileageCheckTab';
import MappingSettings from './MappingSettings';

interface Props {
  user: UserProfile;
  settings?: AppSettings | null;
}

type TabKey = 'noUpdates' | 'check';

export default function MileageCommsModule({ user, settings }: Props) {
  const rolePerms = settings?.rolePermissions;
  const canView = resolvePermission(user, 'mileageComms', rolePerms) !== 'none';
  const canIntegration = resolvePermission(user, 'mileageCommsIntegration', rolePerms) === 'write';

  const [tab, setTab] = useState<TabKey>('noUpdates');
  const [nowTick, setNowTick] = useState(() => Date.now());

  const [cars, setCars] = useState<Vehicle[]>([]);
  const [config, setConfig] = useState<McConfig>(MC_CONFIG_DEFAULTS);
  const [integration, setIntegration] = useState<McIntegration | null>(null);
  const [current, setCurrent] = useState<Record<string, McCurrent>>({});
  const [mapping, setMapping] = useState<Record<string, McMapping>>({});
  const [mappingHistory, setMappingHistory] = useState<Record<string, Record<string, McMappingHistoryEntry>>>({});
  const [navbyObjects, setNavbyObjects] = useState<Record<string, McNavbyObject>>({});

  const [settingsOpen, setSettingsOpen] = useState(false);

  // Обновление «возраста» строк раз в минуту (время идёт, данные — нет).
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const unsubs = [
      mcService.subscribeConfig(setConfig),
      mcService.subscribeIntegration(setIntegration),
      mcService.subscribeCurrent(setCurrent),
      mcService.subscribeMapping(setMapping),
      mcService.subscribeMappingHistory(setMappingHistory),
      mcService.subscribeNavbyObjects(setNavbyObjects),
    ];
    return () => unsubs.forEach((u) => u());
  }, []);

  useEffect(() => {
    const unsub = dbService.getVehicleFleet((list) => setCars(list || []));
    return () => unsub();
  }, []);

  const plateOf = useCallback(
    (carKey: string): string => {
      const car = cars.find((c) => c.id === carKey);
      const m = mapping[carKey];
      return m?.plateRaw || m?.plate || car?.carNumber || carKey;
    },
    [cars, mapping],
  );

  const carLabelOf = useCallback(
    (carKey: string): string => {
      const car = cars.find((c) => c.id === carKey);
      const plate = plateOf(carKey);
      return car?.dispatcherName ? `${plate} · ${car.dispatcherName}` : plate;
    },
    [cars, plateOf],
  );

  const staleCount = useMemo(() => {
    let n = 0;
    for (const carKey of Object.keys(mapping)) {
      const cur = current[carKey] || null;
      const age = cur ? nowTick - cur.coordAtMs : null;
      if (cur == null || (age != null && age > config.staleHours * 3_600_000)) n += 1;
    }
    return n;
  }, [mapping, current, config.staleHours, nowTick]);

  if (!canView) {
    return (
      <ModuleShell title="Пробег и связь">
        <EmptyState
          kind="error"
          title="Раздел закрыт для вашей роли"
          hint="Обратитесь к администратору портала: доступ выдаётся в «Доступе и учётных записях»."
        />
      </ModuleShell>
    );
  }

  const integrationDown = integration?.mode === 'degraded' || integration?.mode === 'unconfigured';

  const tabs = [
    { key: 'noUpdates' as const, label: 'Нет обновлений', count: staleCount },
    { key: 'check' as const, label: 'Проверка пробега' },
  ];

  return (
    <>
      <ModuleShell
        title="Пробег и связь"
        tabs={tabs}
        activeTab={tab}
        onTabChange={(k) => setTab(k as TabKey)}
        tabsAriaLabel="Разделы «Пробег и связь»"
        actions={
          <>
            <IntegrationChip integration={integration} />
            {canIntegration && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className={UI.buttonGhost}
                title="Настройки модуля: сопоставление автопарка, интеграция, уведомления"
                data-testid="mc-settings-btn"
              >
                <Settings2 className="w-3.5 h-3.5" aria-hidden="true" />
                Настройки
              </button>
            )}
          </>
        }
      >
        {integrationDown && (
          <div className={`${UI.errorBox} mb-4`} role="status">
            <WifiOff className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
            <span className="flex-1">
              {integration?.mode === 'unconfigured'
                ? 'Интеграция Nav.by не настроена на сервере: данные не собираются. Показаны последние сохранённые значения.'
                : `Сбор данных Nav.by сейчас недоступен${integration?.lastError?.kind ? ` (${errorKindLabel(integration.lastError.kind)})` : ''}: данные не обновляются, показаны последние сохранённые значения с их возрастом.`}
            </span>
          </div>
        )}

        {tab === 'noUpdates' && (
          <NoUpdatesTab
            config={config}
            integration={integration}
            current={current}
            mapping={mapping}
            nowMs={nowTick}
            carLabelOf={carLabelOf}
          />
        )}

        {tab === 'check' && (
          <MileageCheckTab
            mapping={mapping}
            current={current}
            config={config}
            cars={cars}
            nowMs={nowTick}
          />
        )}
      </ModuleShell>

      {canIntegration && (
        <MappingSettings
          isOpen={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          user={user}
          config={config}
          integration={integration}
          mapping={mapping}
          mappingHistory={mappingHistory}
          navbyObjects={navbyObjects}
          cars={cars}
        />
      )}
    </>
  );
}

function errorKindLabel(kind: string): string {
  switch (kind) {
    case 'auth': return 'ошибка авторизации в Nav.by';
    case 'forbidden': return 'нет прав у учётной записи Nav.by';
    case 'rate_limit': return 'превышен лимит запросов Nav.by';
    case 'server': return 'ошибка сервера Nav.by';
    case 'timeout': return 'таймаут запроса к Nav.by';
    case 'network': return 'сеть недоступна';
    case 'not_configured': return 'не заданы доступы Nav.by';
    default: return 'сбой сбора данных';
  }
}

/** Статус интеграции в шапке: маленький чип с расшифровкой по ховеру. */
function IntegrationChip({ integration }: { integration: McIntegration | null }) {
  const mode = integration?.mode;
  const color = mode === 'ok' ? 'emerald' : mode ? 'amber' : 'grey';
  const label = mode === 'ok' ? 'Сбор данных работает'
    : mode === 'disabled' ? 'Сбор выключен'
    : mode === 'unconfigured' ? 'Интеграция не настроена'
    : mode === 'degraded' ? 'Сбор недоступен'
    : 'Сбор ещё не запускался';
  const dot: Record<string, string> = {
    emerald: 'bg-emerald-500', amber: 'bg-amber-500', grey: 'bg-[#9CA3AF]',
  };
  const title = [
    label,
    integration?.lastOkAt ? `последний успешный сбор: ${fmtTs(integration.lastOkAt)}` : '',
    integration?.lastRunAt ? `последний запуск: ${fmtTs(integration.lastRunAt)}` : '',
    integration?.objectsWithPosition != null ? `объектов с позицией: ${integration.objectsWithPosition} из ${integration.objectsTotal ?? '—'}` : '',
    integration?.matchedCars != null ? `сопоставлено машин: ${integration.matchedCars}` : '',
  ].filter(Boolean).join('\n');
  return (
    <span className={UI.chip + ' flex items-center gap-1.5'} title={title} data-testid="mc-integration-chip">
      <span className={`w-1.5 h-1.5 rounded-full ${dot[color]}`} aria-hidden="true" />
      {label}
    </span>
  );
}

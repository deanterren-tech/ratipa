/**
 * «Настройки» модуля «Пробег и связь» (для ролей с правом управления
 * интеграцией): сопоставление автопарка с объектами Nav.by + параметры
 * сбора и уведомлений. Секреты Nav.by здесь не показываются и не вводятся —
 * они живут только в переменных окружения сервера.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link2, RefreshCw, Unlink, History, Cable, AlertTriangle, SearchCheck } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { ModalShell, SectionHeader, FilterPills, SearchField, StatusText } from '../../../ui/components';
import type { UserProfile, Vehicle } from '../../../types';
import { useToast } from '../../ToastProvider';
import { useDialog } from '../../DialogProvider';
import { mcService } from './mcService';
import {
  ageLabel, fmtTs, plateNorm,
  type McConfig, type McIntegration, type McMapping, type McMappingHistoryEntry, type McNavbyObject,
} from './mcTypes';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  user: UserProfile;
  config: McConfig;
  integration: McIntegration | null;
  mapping: Record<string, McMapping>;
  mappingHistory: Record<string, Record<string, McMappingHistoryEntry>>;
  navbyObjects: Record<string, McNavbyObject>;
  cars: Vehicle[];
}

const ROLE_LABELS: Record<string, string> = {
  root_admin: 'Разработчик (Root)',
  admin: 'Администратор',
  manager: 'Менеджер',
  accountant: 'Бухгалтер',
  dispatcher: 'Диспетчер',
  mechanic: 'Механик',
  viewer: 'Наблюдатель',
  logist: 'Логист',
};

type Tab = 'mapping' | 'integration';

export default function MappingSettings(props: Props) {
  const { isOpen, onClose, user, config, integration, mapping, mappingHistory, navbyObjects, cars } = props;
  const [tab, setTab] = useState<Tab>('mapping');
  const [query, setQuery] = useState('');
  const [historyCarKey, setHistoryCarKey] = useState<string | null>(null);

  const plateOf = (carKey: string): string => {
    const m = mapping[carKey];
    const car = cars.find((c) => c.id === carKey);
    return m?.plateRaw || m?.plate || car?.carNumber || carKey;
  };

  const mappedObjectIds = useMemo(
    () => new Set(Object.values(mapping).map((m) => String(m.navbyObjectId))),
    [mapping],
  );

  const unmatchedObjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(navbyObjects)
      .filter((o) => !mappedObjectIds.has(String(o.objectId)))
      .filter((o) => !q || `${o.name} ${o.autoNumber || ''} ${o.objectId}`.toLowerCase().includes(q))
      .sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name, 'ru') : a.status === 'active' ? -1 : 1));
  }, [navbyObjects, mappedObjectIds, query]);

  /** Дубликаты нормализованных номеров среди объектов Nav.by (подсказка о конфликтах). */
  const duplicatePlates = useMemo(() => {
    const byPlate: Record<string, McNavbyObject[]> = {};
    for (const o of Object.values(navbyObjects)) {
      const key = plateNorm(o.autoNumber) || plateNorm(o.name);
      if (!key) continue;
      (byPlate[key] = byPlate[key] || []).push(o);
    }
    return Object.entries(byPlate).filter(([, list]) => list.length > 1);
  }, [navbyObjects]);

  const unmatchedCars = useMemo(() => {
    return cars
      .filter((c) => !mapping[c.id])
      .map((c) => ({ carKey: c.id, plate: c.carNumber || c.vehicleNumbers || c.id }))
      .sort((a, b) => a.plate.localeCompare(b.plate, 'ru'));
  }, [cars, mapping]);

  const historyEntries = historyCarKey ? Object.values(mappingHistory[historyCarKey] || {}).sort((a, b) => (a.at < b.at ? 1 : -1)) : [];

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Пробег и связь — настройки"
      subtitle="Сопоставление автопарка с Nav.by, параметры сбора и уведомлений"
      icon={<Cable className="w-4 h-4" />}
      maxWidth="max-w-4xl"
      footer={
        <button type="button" className={UI.buttonGhost} onClick={onClose}>Закрыть</button>
      }
    >
      <div className="flex flex-col gap-5">
        <FilterPills<Tab>
          ariaLabel="Разделы настроек"
          items={[
            { key: 'mapping', label: `Сопоставление (${Object.keys(mapping).length})` },
            { key: 'integration', label: 'Параметры сбора' },
          ]}
          active={tab}
          onChange={setTab}
        />

        {tab === 'mapping' && (
          <div className="flex flex-col gap-6">
            <SectionHeader
              icon={<Link2 className="w-4 h-4" />}
              tone="graphite"
              title="Привязка автомобилей к объектам Nav.by"
              subtitle="Госномер — только подсказка. Изменения фиксируются в истории привязки."
            />

            {duplicatePlates.length > 0 && (
              <div className={UI.errorBox} role="status">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
                <div className="flex-1">
                  <div className="font-semibold">Обнаружены дубликаты госномеров в Nav.by:</div>
                  {duplicatePlates.map(([plate, list]) => (
                    <div key={plate} className="text-[11px]">
                      {plate}: {list.map((o) => `${o.name} (объект ${o.objectId})`).join(', ')} — автопривязка по номеру для них отключена, решите вручную.
                    </div>
                  ))}
                </div>
              </div>
            )}

            <MappingTable
              mapping={mapping}
              navbyObjects={navbyObjects}
              plateOf={plateOf}
              user={user}
              onShowHistory={setHistoryCarKey}
            />

            <div className="flex flex-col gap-3">
              <SectionHeader
                icon={<SearchCheck className="w-4 h-4" />}
                tone="graphite"
                title={`Несопоставленные объекты Nav.by (${unmatchedObjects.length})`}
                subtitle="Привяжите объект к автомобилю портала или оставьте без привязки."
              >
                <SearchField value={query} onChange={setQuery} placeholder="Поиск: имя, номер, объект" ariaLabel="Поиск объектов" className="sm:max-w-xs" />
              </SectionHeader>
              {unmatchedObjects.length === 0 ? (
                <p className={UI.hint}>Несопоставленных объектов нет.</p>
              ) : (
                <div className={UI.tableWrap}>
                  <table className={UI.table}>
                    <thead>
                      <tr className={UI.theadRow}>
                        <th className={UI.th}>Объект</th>
                        <th className={UI.th}>Номер</th>
                        <th className={UI.th}>IMEI</th>
                        <th className={UI.th}>Статус</th>
                        <th className={UI.th}>Привязать к</th>
                      </tr>
                    </thead>
                    <tbody>
                      {unmatchedObjects.slice(0, 100).map((o) => (
                        <UnmatchedRow key={o.objectId} object={o} cars={unmatchedCars} user={user} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {historyCarKey && (
              <div className="flex flex-col gap-2">
                <SectionHeader
                  icon={<History className="w-4 h-4" />}
                  tone="graphite"
                  title={`История привязки: ${plateOf(historyCarKey)}`}
                  subtitle={`${historyEntries.length} записей`}
                >
                  <button type="button" className={UI.buttonGhost} onClick={() => setHistoryCarKey(null)}>Скрыть</button>
                </SectionHeader>
                <ul className="flex flex-col divide-y divide-[#E5E7EB]">
                  {historyEntries.map((h, i) => (
                    <li key={i} className="py-2 text-[11px] text-[#4B5563]">
                      <span className="text-[#9CA3AF]">{fmtTs(h.at)} · {h.by}</span>{' — '}
                      {historyActionLabel(h.action)}
                      {h.from?.navbyObjectId ? ` (${h.from.navbyObjectId} → ${h.to?.navbyObjectId ?? '—'})` : h.to?.navbyObjectId ? ` → ${h.to.navbyObjectId}` : ''}
                      {h.comment ? ` · ${h.comment}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {tab === 'integration' && <IntegrationSettings user={user} config={config} integration={integration} />}
      </div>
    </ModalShell>
  );
}

function historyActionLabel(a: string): string {
  switch (a) {
    case 'bind': return 'Привязка создана';
    case 'rebind': return 'Привязка изменена';
    case 'unbind': return 'Привязка снята';
    case 'confirm': return 'Привязка подтверждена';
    default: return a;
  }
}

function MappingTable({
  mapping, navbyObjects, plateOf, user, onShowHistory,
}: {
  mapping: Record<string, McMapping>;
  navbyObjects: Record<string, McNavbyObject>;
  plateOf: (carKey: string) => string;
  user: UserProfile;
  onShowHistory: (carKey: string) => void;
}) {
  const { toast } = useToast();
  const { showConfirm } = useDialog();
  const [editing, setEditing] = useState<string | null>(null);
  const [editObjectId, setEditObjectId] = useState('');
  const [busy, setBusy] = useState(false);

  const entries = Object.entries(mapping).sort((a, b) => plateOf(a[0]).localeCompare(plateOf(b[0]), 'ru'));
  if (entries.length === 0) return <p className={UI.hint}>Пока ни одна машина не привязана. Автопривязки появляются после запуска поллера.</p>;

  const confirmBinding = async (carKey: string) => {
    const m = mapping[carKey];
    if (!m) return;
    setBusy(true);
    try {
      await mcService.bindMapping({
        carKey, objectId: m.navbyObjectId, imei: m.imei,
        plateRaw: m.plateRaw || null, plateNormalized: m.plate || plateNorm(m.plateRaw),
        user, prev: m, action: 'confirm',
      });
      toast('Привязка подтверждена', 'success');
    } finally { setBusy(false); }
  };

  const saveRebind = async (carKey: string) => {
    const m = mapping[carKey];
    const obj = navbyObjects[editObjectId];
    if (!m || !obj) return;
    setBusy(true);
    try {
      await mcService.bindMapping({
        carKey, objectId: obj.objectId, imei: obj.uid || null,
        plateRaw: m.plateRaw || null, plateNormalized: m.plate || plateNorm(m.plateRaw),
        user, prev: m, action: 'rebind', comment: 'Привязка изменена вручную',
      });
      toast('Привязка обновлена', 'success');
      setEditing(null);
    } finally { setBusy(false); }
  };

  const unbind = async (carKey: string) => {
    const m = mapping[carKey];
    if (!m) return;
    const ok = await showConfirm(`Снять привязку «${plateOf(carKey)}» с объекта ${m.navbyObjectId}? История привязки сохранится.`, 'Снятие привязки');
    if (!ok) return;
    setBusy(true);
    try {
      await mcService.unbindMapping({ carKey, user, prev: m });
      toast('Привязка снята', 'success');
    } finally { setBusy(false); }
  };

  return (
    <div className={UI.tableWrap}>
      <table className={UI.table}>
        <thead>
          <tr className={UI.theadRow}>
            <th className={UI.th}>Автомобиль</th>
            <th className={UI.th}>Объект Nav.by</th>
            <th className={UI.th}>IMEI</th>
            <th className={UI.th}>Статус привязки</th>
            <th className={UI.th}>Изменено</th>
            <th className={UI.stickyTh} aria-label="Действия" />
          </tr>
        </thead>
        <tbody>
          {entries.map(([carKey, m]) => {
            const obj = navbyObjects[m.navbyObjectId];
            return (
              <tr key={carKey} className={UI.tr} data-testid={`mc-map-${carKey}`}>
                <td className={UI.tdStrong}>{plateOf(carKey)}</td>
                <td className={UI.td}>
                  {editing === carKey ? (
                    <select className={UI.select + ' !min-h-0 !py-1'} value={editObjectId} onChange={(e) => setEditObjectId(e.target.value)}>
                      <option value="">— выберите объект —</option>
                      {Object.values(navbyObjects).map((o) => (
                        <option key={o.objectId} value={o.objectId}>{o.name} · {o.autoNumber || 'без номера'} · объект {o.objectId}{o.status === 'paused' ? ' (приостановлен)' : ''}</option>
                      ))}
                    </select>
                  ) : (
                    <>
                      {obj ? obj.name : `объект ${m.navbyObjectId}`}
                      <div className="text-[10px] text-[#9CA3AF]">объект {m.navbyObjectId}{obj?.status === 'paused' ? ' · приостановлен' : ''}</div>
                    </>
                  )}
                </td>
                <td className={UI.td}>{editing === carKey ? (navbyObjects[editObjectId]?.uid || '—') : (m.imei || '—')}</td>
                <td className={UI.td}>
                  {m.status === 'confirmed'
                    ? <StatusText color="emerald">подтверждено</StatusText>
                    : m.status === 'conflict'
                      ? <StatusText color="rose">конфликт</StatusText>
                      : <StatusText color="amber">авто по номеру — не подтверждено</StatusText>}
                  <div className="text-[10px] text-[#9CA3AF]">{m.source === 'manual' ? 'вручную' : 'автоматически'}</div>
                </td>
                <td className={UI.td}>
                  {m.updatedAt ? fmtTs(m.updatedAt) : '—'}
                  <div className="text-[10px] text-[#9CA3AF]">{m.updatedBy || ''}</div>
                </td>
                <td className={UI.td}>
                  <div className="flex items-center gap-1 flex-wrap">
                    {editing === carKey ? (
                      <>
                        <button type="button" className={UI.buttonDark + ' !min-h-0 !px-2 !py-1'} disabled={busy || !editObjectId} onClick={() => saveRebind(carKey)}>Сохранить</button>
                        <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2 !py-1'} onClick={() => setEditing(null)}>Отмена</button>
                      </>
                    ) : (
                      <>
                        {m.status !== 'confirmed' && (
                          <button type="button" className={UI.buttonDark + ' !min-h-0 !px-2 !py-1'} disabled={busy} onClick={() => confirmBinding(carKey)} data-testid={`mc-confirm-${carKey}`}>Подтвердить</button>
                        )}
                        <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2 !py-1'} onClick={() => { setEditing(carKey); setEditObjectId(m.navbyObjectId); }}>
                          <RefreshCw className="w-3 h-3" aria-hidden="true" /> Изменить
                        </button>
                        <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2 !py-1'} onClick={() => unbind(carKey)} title="Снять привязку">
                          <Unlink className="w-3 h-3" aria-hidden="true" /> Снять
                        </button>
                        <button type="button" className={UI.buttonLink} onClick={() => onShowHistory(carKey)}>история</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function UnmatchedRow({ object, cars, user }: { object: McNavbyObject; cars: Array<{ carKey: string; plate: string }>; user: UserProfile }) {
  const { toast } = useToast();
  const [carKey, setCarKey] = useState('');
  const [busy, setBusy] = useState(false);

  // Подсказка: нормализованный номер совпадает с номером автомобиля портала.
  const hintCar = useMemo(() => {
    const key = plateNorm(object.autoNumber) || plateNorm(object.name);
    if (!key) return null;
    return cars.find((c) => plateNorm(c.plate) === key) || null;
  }, [object, cars]);

  const bind = async () => {
    if (!carKey) return;
    setBusy(true);
    try {
      await mcService.bindMapping({
        carKey,
        objectId: object.objectId,
        imei: object.uid,
        plateRaw: cars.find((c) => c.carKey === carKey)?.plate || null,
        plateNormalized: plateNorm(object.autoNumber) || plateNorm(object.name),
        user,
        prev: null,
        action: 'bind',
        comment: 'Привязка создана вручную (несопоставленный объект)',
      });
      toast('Объект привязан', 'success');
      setCarKey('');
    } finally { setBusy(false); }
  };

  return (
    <tr className={UI.tr}>
      <td className={UI.tdStrong}>{object.name}<div className="text-[10px] text-[#9CA3AF]">объект {object.objectId}</div></td>
      <td className={UI.td}>
        {object.autoNumber || '—'}
        {hintCar && <div className="text-[10px] text-amber-600">вероятное совпадение: {hintCar.plate}</div>}
      </td>
      <td className={UI.td}>{object.uid || '—'}</td>
      <td className={UI.td}>{object.status === 'active' ? <StatusText color="emerald">активен</StatusText> : <StatusText color="grey">приостановлен</StatusText>}</td>
      <td className={UI.td}>
        <div className="flex items-center gap-1.5">
          <select className={UI.select + ' !min-h-0 !py-1 max-w-[220px]'} value={carKey} onChange={(e) => setCarKey(e.target.value)}>
            <option value="">— автомобиль —</option>
            {cars.map((c) => <option key={c.carKey} value={c.carKey}>{c.plate}</option>)}
          </select>
          <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2 !py-1'} disabled={busy || !carKey} onClick={bind}>Привязать</button>
        </div>
      </td>
    </tr>
  );
}

function IntegrationSettings({ user, config, integration }: { user: UserProfile; config: McConfig; integration: McIntegration | null }) {
  const { toast } = useToast();
  const [form, setForm] = useState<McConfig>(config);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setForm(config); }, [config]);

  const num = (v: string, min: number, fallback: number): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? n : fallback;
  };

  const save = async () => {
    setBusy(true);
    try {
      await mcService.saveConfig({ patch: { ...form }, user });
      toast('Настройки сохранены', 'success');
    } catch (e) {
      toast(`Не удалось сохранить: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, 'error');
    } finally { setBusy(false); }
  };

  const toggleRole = (r: string) => {
    setForm((f) => ({
      ...f,
      alertRoles: f.alertRoles.includes(r) ? f.alertRoles.filter((x) => x !== r) : [...f.alertRoles, r],
    }));
  };

  return (
    <div className="flex flex-col gap-5">
      <SectionHeader
        icon={<Cable className="w-4 h-4" />}
        tone="graphite"
        title="Состояние интеграции"
        subtitle="Сбор выполняет серверный поллер портала; браузер к Nav.by не обращается"
      />
      <div className={`${UI.bar} flex flex-wrap gap-x-6 gap-y-1.5`}>
        <span className="text-[11px] text-[#6B7280]">Режим: <span className="text-[#4B5563] font-medium">{integration?.mode ? modeLabel(integration.mode) : 'не запускался'}</span></span>
        <span className="text-[11px] text-[#6B7280]">Последний запуск: <span className="text-[#4B5563] font-medium">{integration?.lastRunAt ? `${fmtTs(integration.lastRunAt)} (${ageLabel(Date.now() - new Date(integration.lastRunAt).getTime())} назад)` : '—'}</span></span>
        <span className="text-[11px] text-[#6B7280]">Успешный сбор: <span className="text-[#4B5563] font-medium">{integration?.lastOkAt ? fmtTs(integration.lastOkAt) : '—'}</span></span>
        <span className="text-[11px] text-[#6B7280]">Объектов: <span className="text-[#4B5563] font-medium">{integration?.objectsWithPosition ?? '—'} / {integration?.objectsTotal ?? '—'}</span></span>
        <span className="text-[11px] text-[#6B7280]">Сопоставлено машин: <span className="text-[#4B5563] font-medium">{integration?.matchedCars ?? '—'}</span></span>
        <span className="text-[11px] text-[#6B7280]">Токен: <span className="text-[#4B5563] font-medium">{integration?.tokenSource === 'login' ? 'логин/пароль сервера' : integration?.tokenSource === 'env' ? 'из переменной окружения' : '—'}</span></span>
      </div>
      {integration?.lastError?.kind && integration.mode !== 'ok' && (
        <div className={UI.errorBox} role="status">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
          <span>Последняя ошибка сбора: {integration.lastError.kind}{integration.lastError.status ? ` (HTTP ${integration.lastError.status})` : ''}{integration.lastError.at ? ` · ${fmtTs(integration.lastError.at)}` : ''}</span>
        </div>
      )}
      <p className={UI.hint}>
        Доступы Nav.by (NAVBY_LOGIN/NAVBY_PASSWORD или NAVBY_TOKEN) и ключ сервисного аккаунта Firebase задаются
        в переменных окружения сервера — не в этом интерфейсе. Смена интервала вступает в силу без перезапуска.
      </p>

      <SectionHeader icon={<RefreshCw className="w-4 h-4" />} tone="graphite" title="Параметры сбора" subtitle="Применяются к следующему циклу поллера" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="flex items-center gap-2.5 sm:col-span-2">
          <input type="checkbox" className={UI.checkbox} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          <span className="text-xs text-[#4B5563]">Сбор данных включён</span>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Интервал опроса, сек (мин. 60)</span>
          <input type="number" min={60} step={30} className={UI.input} value={form.intervalSec} onChange={(e) => setForm({ ...form, intervalSec: num(e.target.value, 60, 300) })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Порог «нет обновлений», часов</span>
          <input type="number" min={1} className={UI.input} value={form.staleHours} onChange={(e) => setForm({ ...form, staleHours: num(e.target.value, 1, 24) })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Окно ожидания после въезда в РФ, часов</span>
          <input type="number" min={1} className={UI.input} value={form.rfWindowHours} onChange={(e) => setForm({ ...form, rfWindowHours: num(e.target.value, 1, 48) })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Хранение истории, дней</span>
          <input type="number" min={7} className={UI.input} value={form.retentionDays} onChange={(e) => setForm({ ...form, retentionDays: num(e.target.value, 7, 120) })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Напоминание «нет ответа», часов</span>
          <input type="number" min={1} className={UI.input} value={form.replyRemindHours} onChange={(e) => setForm({ ...form, replyRemindHours: num(e.target.value, 1, 72) })} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Не чаще уведомлений раз в, часов</span>
          <input type="number" min={1} className={UI.input} value={form.alertCooldownHours} onChange={(e) => setForm({ ...form, alertCooldownHours: num(e.target.value, 1, 12) })} />
        </label>
      </div>

      <SectionHeader icon={<AlertTriangle className="w-4 h-4" />} tone="amber" title="Уведомления" subtitle="Уходят существующим каналом портала: колокольчик. Одно открытое уведомление на событие, с ограничением частоты." />
      <label className="flex items-center gap-2.5">
        <input type="checkbox" className={UI.checkbox} checked={form.alertsEnabled} onChange={(e) => setForm({ ...form, alertsEnabled: e.target.checked })} data-testid="mc-alerts-enabled" />
        <span className="text-xs text-[#4B5563]">Уведомления включены (отсутствие обновлений, истечение окна РФ, нет ответа по обращению, требуется мастер)</span>
      </label>
      <div className="flex flex-col gap-2">
        <span className={UI.fieldLabel}>Получатели по ролям</span>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <label key={role} className="inline-flex items-center gap-2 text-[11px] text-[#4B5563] bg-white border border-[#E5E7EB] rounded-lg px-2.5 py-1.5 cursor-pointer">
              <input type="checkbox" className={UI.checkbox} checked={form.alertRoles.includes(role)} onChange={() => toggleRole(role)} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2.5">
        <button type="button" className={UI.buttonPrimary} onClick={save} disabled={busy} data-testid="mc-save-config">Сохранить настройки</button>
        <span className={UI.hint}>Изменения применяются без перезапуска сервера.</span>
      </div>
    </div>
  );
}

function modeLabel(mode: string): string {
  switch (mode) {
    case 'ok': return 'работает';
    case 'degraded': return 'недоступно (показаны последние данные)';
    case 'disabled': return 'выключено настройкой';
    case 'unconfigured': return 'не настроено (нет доступов)';
    default: return mode;
  }
}

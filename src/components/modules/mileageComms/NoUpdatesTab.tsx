/**
 * Вкладка «Нет обновлений»: какие автомобили давно не давали данных и что
 * с ними делать. Никаких названных причин без подтверждения: различаем
 * «интеграция недоступна», «данных нет вовсе», «координата устарела»,
 * «одометр не передаётся» и показываем возраст, а не вердикт.
 */

import { useMemo, useState } from 'react';
import { MapPin, AlertTriangle, Settings2, PhoneCall } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { FilterPills, SearchField, EmptyState, StatusText } from '../../../ui/components';
import type { Vehicle } from '../../../types';
import { UserProfile } from '../../../types';
import {
  ageLabel, fmtTs, isOpenRequest, recommendedAction, rfWindowState, rowStateOf,
  type McConfig, type McCurrent, type McIntegration, type McMapping, type McRequest, type McRfEntry, type McRowState,
} from './mcTypes';

interface Props {
  user: UserProfile;
  cars: Vehicle[];
  canRequests: boolean;
  canRfEntry: boolean;
  config: McConfig;
  integration: McIntegration | null;
  current: Record<string, McCurrent>;
  mapping: Record<string, McMapping>;
  requestsByCar: Record<string, McRequest>;
  rfEntries: Record<string, McRfEntry>;
  nowMs: number;
  carLabelOf: (carKey: string) => string;
  onOpenRfDialog: (carKey: string) => void;
  onCreateRequest: (carKey: string) => void;
  onGoToRequest: (id: string) => void;
}

type Filter = 'all' | 'stale' | 'rf' | 'openReq' | 'fresh';

interface Row {
  carKey: string;
  label: string;
  m: McMapping;
  cur: McCurrent | null;
  state: McRowState;
  ageMs: number | null;
  rfState: ReturnType<typeof rfWindowState>;
  rf: McRfEntry | null;
  openReq: McRequest | null;
  action: string;
}

const STATE_TEXT: Record<McRowState, { label: string; color: 'emerald' | 'amber' | 'rose' | 'grey' | 'blue' }> = {
  integration_down: { label: 'Сбор данных недоступен', color: 'grey' },
  no_data: { label: 'Данных от объекта нет', color: 'rose' },
  stale: { label: 'Координата устарела', color: 'amber' },
  fresh_no_odo: { label: 'Данные идут, одометра нет', color: 'blue' },
  fresh: { label: 'Данные свежие', color: 'emerald' },
};

export default function NoUpdatesTab(props: Props) {
  const {
    user, canRequests, canRfEntry, config, integration, current, mapping,
    requestsByCar, rfEntries, nowMs, carLabelOf, onOpenRfDialog, onCreateRequest, onGoToRequest,
  } = props;

  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');

  const rows = useMemo<Row[]>(() => {
    const list: Row[] = [];
    for (const [carKey, m] of Object.entries(mapping)) {
      if (!m || !m.navbyObjectId) continue;
      const cur = current[carKey] || null;
      const state = rowStateOf({ current: cur, integrationMode: integration?.mode, nowMs, staleHours: config.staleHours });
      const rf = rfEntries[carKey] || null;
      const rfState = rfWindowState(rf, cur?.coordAtMs, nowMs, config.rfWindowHours);
      const openReq = requestsByCar[carKey] || null;
      list.push({
        carKey,
        label: carLabelOf(carKey),
        m, cur, state,
        ageMs: cur ? nowMs - cur.coordAtMs : null,
        rfState, rf, openReq,
        action: recommendedAction({ state, rfState, openRequest: openReq }),
      });
    }
    const rank = (r: Row): number => {
      if (r.state === 'integration_down') return 0;
      if (r.state === 'no_data') return 1;
      if (r.state === 'stale') return 2;
      if (r.state === 'fresh_no_odo') return 3;
      return 4;
    };
    const rfRank = (r: Row) => (r.rfState === 'window_over' ? 0 : r.rfState === 'in_window' ? 1 : 2);
    return list.sort((a, b) => {
      const s = rank(a) - rank(b);
      if (s !== 0) return s;
      const rf = rfRank(a) - rfRank(b);
      if (rf !== 0) return rf;
      return (b.ageMs ?? 0) - (a.ageMs ?? 0);
    });
  }, [mapping, current, integration?.mode, nowMs, config.staleHours, config.rfWindowHours, requestsByCar, rfEntries, carLabelOf]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !`${r.label} ${r.m.navbyObjectId} ${r.m.imei || ''}`.toLowerCase().includes(q)) return false;
      switch (filter) {
        case 'stale': return r.state === 'stale' || r.state === 'no_data';
        case 'rf': return r.rfState === 'in_window' || r.rfState === 'window_over';
        case 'openReq': return r.openReq != null;
        case 'fresh': return r.state === 'fresh' || r.state === 'fresh_no_odo';
        default: return true;
      }
    });
  }, [rows, filter, query]);

  const counts = useMemo(() => ({
    stale: rows.filter((r) => r.state === 'stale' || r.state === 'no_data').length,
    rf: rows.filter((r) => r.rfState === 'in_window' || r.rfState === 'window_over').length,
    openReq: rows.filter((r) => r.openReq != null).length,
  }), [rows]);

  if (Object.keys(mapping).length === 0) {
    return (
      <div className="flex flex-col gap-4">
        <IntegrationSummary integration={integration} config={config} />
        <EmptyState
          title="Автопарк ещё не сопоставлен с Nav.by"
          hint="Поллер собирает данные и предлагает автопривязки по однозначному совпадению госномера. Проверьте и подтвердите сопоставление в «Настройках» раздела."
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <IntegrationSummary integration={integration} config={config} />

      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <FilterPills<Filter>
          ariaLabel="Фильтр по состоянию"
          items={[
            { key: 'all', label: `Все (${rows.length})` },
            { key: 'stale', label: `Нет обновлений (${counts.stale})`, tone: counts.stale ? 'warn' : 'default' },
            { key: 'rf', label: `Въезд в РФ (${counts.rf})` },
            { key: 'openReq', label: `С обращением (${counts.openReq})` },
            { key: 'fresh', label: 'Свежие' },
          ]}
          active={filter}
          onChange={setFilter}
        />
        <SearchField value={query} onChange={setQuery} placeholder="Поиск: номер, объект, IMEI" ariaLabel="Поиск по автопарку" className="sm:ml-auto sm:max-w-xs" />
      </div>

      {filtered.length === 0 ? (
        <EmptyState kind="no-results" query={query} />
      ) : (
        <>
          {/* Десктоп: таблица; мобильный: карточки строкой ниже (md:hidden) */}
          <div className={`${UI.tableWrap} hidden md:block`}>
            <table className={UI.table}>
              <thead>
                <tr className={UI.theadRow}>
                  <th className={UI.th}>Автомобиль</th>
                  <th className={UI.th}>Последняя известная позиция</th>
                  <th className={UI.th}>Возраст координаты</th>
                  <th className={UI.th}>Сообщение устройства</th>
                  <th className={UI.th}>Одометр</th>
                  <th className={UI.th}>Въезд в РФ</th>
                  <th className={UI.th}>Обращение</th>
                  <th className={UI.th}>Рекомендуемое действие</th>
                  <th className={UI.stickyTh} aria-label="Действия" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.carKey} className={UI.tr} data-testid={`mc-row-${r.carKey}`}>
                    <td className={UI.tdStrong}>
                      <div className="flex flex-col gap-1">
                        <span>{r.label}</span>
                        <span className="text-[10px] font-normal text-[#9CA3AF]">объект {r.m.navbyObjectId}{r.m.imei ? ` · ${r.m.imei}` : ''}</span>
                        <StatusText color={STATE_TEXT[r.state].color}>{STATE_TEXT[r.state].label}</StatusText>
                      </div>
                    </td>
                    <td className={UI.td}>
                      {r.cur ? (
                        <span title={`${r.cur.lat.toFixed(5)}, ${r.cur.lon.toFixed(5)}`}>
                          <span className="inline-flex items-center gap-1"><MapPin className="w-3 h-3 text-[#9CA3AF]" aria-hidden="true" />последняя известная{'\u00A0'}· {fmtTs(r.cur.coordAtMs)}</span>
                          {r.cur.place ? <div className="text-[10px] text-[#9CA3AF] mt-0.5 max-w-[280px] truncate">{r.cur.place}</div> : null}
                        </span>
                      ) : <span className="text-[#9CA3AF]">данных нет</span>}
                    </td>
                    <td className={UI.td}>{r.cur ? ageLabel(r.ageMs) : '—'}</td>
                    <td className={UI.td}>
                      <span className="text-[#9CA3AF]" title="Nav.by не предоставляет отдельного времени последнего сообщения устройства">
                        недоступно
                      </span>
                    </td>
                    <td className={UI.td}>
                      {r.cur && r.cur.odoQuality === 'ok' && r.cur.odoKm != null ? (
                        <span>
                          {Math.round(r.cur.odoKm).toLocaleString('ru-RU')} км
                          <div className="text-[10px] text-[#9CA3AF] mt-0.5" title="Время измерения одометра API не передаёт">время измерения — нет в API</div>
                        </span>
                      ) : <span className="text-[#9CA3AF]">не передаётся</span>}
                    </td>
                    <td className={UI.td}>
                      <RfCell row={r} nowMs={nowMs} rfWindowHours={config.rfWindowHours} />
                    </td>
                    <td className={UI.td}>
                      {r.openReq ? (
                        <button type="button" className={UI.buttonLink} onClick={() => onGoToRequest(r.openReq!.id)}>
                          {statusShort(r.openReq.status)}
                        </button>
                      ) : <span className="text-[#9CA3AF]">нет</span>}
                    </td>
                    <td className={UI.td}>{r.action}</td>
                    <td className={UI.td}>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {canRfEntry && (
                          <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2 !py-1'} onClick={() => onOpenRfDialog(r.carKey)} title="Зафиксировать подтверждённый въезд в РФ">
                            Въезд РФ
                          </button>
                        )}
                        {canRequests && !r.openReq && (r.state === 'stale' || r.state === 'no_data' || r.rfState === 'window_over') && (
                          <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2 !py-1'} onClick={() => onCreateRequest(r.carKey)} data-testid={`mc-create-req-${r.carKey}`}>
                            <PhoneCall className="w-3 h-3" aria-hidden="true" /> Обращение
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="md:hidden flex flex-col gap-2">
            {filtered.map((r) => (
              <div key={r.carKey} className="bg-white border border-[#E5E7EB] rounded-xl p-3 flex flex-col gap-2" data-testid={`mc-card-${r.carKey}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-xs font-semibold text-[#121316]">{r.label}</div>
                    <div className="text-[10px] text-[#9CA3AF]">объект {r.m.navbyObjectId}{r.m.imei ? ` · ${r.m.imei}` : ''}</div>
                  </div>
                  <StatusText color={STATE_TEXT[r.state].color}>{STATE_TEXT[r.state].label}</StatusText>
                </div>
                <div className="text-[11px] text-[#4B5563] leading-relaxed">
                  {r.cur ? (
                    <>
                      <div>Последняя известная позиция: {fmtTs(r.cur.coordAtMs)}{r.cur.place ? ` — ${r.cur.place}` : ''}</div>
                      <div>Возраст координаты: {ageLabel(r.ageMs)}</div>
                    </>
                  ) : <div>Данных от объекта нет</div>}
                  <div>Одометр: {r.cur && r.cur.odoQuality === 'ok' && r.cur.odoKm != null ? `${Math.round(r.cur.odoKm).toLocaleString('ru-RU')} км (время измерения API не передаёт)` : 'не передаётся'}</div>
                  <div>Въезд в РФ: <RfCell row={r} nowMs={nowMs} rfWindowHours={config.rfWindowHours} /></div>
                  <div>Обращение: {r.openReq ? statusShort(r.openReq.status) : 'нет'}</div>
                  <div className="text-[#121316] font-medium mt-1">{r.action}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                  {canRfEntry && (
                    <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2.5 !py-1.5'} onClick={() => onOpenRfDialog(r.carKey)}>Въезд РФ</button>
                  )}
                  {canRequests && !r.openReq && (r.state === 'stale' || r.state === 'no_data' || r.rfState === 'window_over') && (
                    <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2.5 !py-1.5'} onClick={() => onCreateRequest(r.carKey)}>Обращение</button>
                  )}
                  {r.openReq && (
                    <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2.5 !py-1.5'} onClick={() => onGoToRequest(r.openReq!.id)}>К обращению</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RfCell({ row, nowMs, rfWindowHours }: { row: Row; nowMs: number; rfWindowHours: number }) {
  if (!row.rf) return <span className="text-[#9CA3AF]">отметки нет</span>;
  const state = row.rfState;
  if (state === 'in_window') {
    const left = Math.max(0, row.rf.atMs + rfWindowHours * 3_600_000 - nowMs);
    return (
      <span className="inline-flex items-center gap-1" title={`Въезд подтверждён ${fmtTs(row.rf.atMs)} (${row.rf.source})`}>
        <AlertTriangle className="w-3 h-3 text-amber-500" aria-hidden="true" />
        <span>окно ожидания, осталось {ageLabel(left)}</span>
      </span>
    );
  }
  if (state === 'window_over') {
    return (
      <span className="inline-flex items-center gap-1 text-amber-700" title={`Въезд подтверждён ${fmtTs(row.rf.atMs)} (${row.rf.source})`}>
        <AlertTriangle className="w-3 h-3 text-amber-500" aria-hidden="true" />
        <span>окно истекло {fmtTs(row.rf.atMs)}</span>
      </span>
    );
  }
  return <span title={`${row.rf.source}${row.rf.authorName ? ` · ${row.rf.authorName}` : ''}`}>{fmtTs(row.rf.atMs)}</span>;
}

function statusShort(s: string): string {
  switch (s) {
    case 'draft': return 'черновик';
    case 'sent': return 'отправлено';
    case 'awaiting_reply': return 'ожидается ответ';
    case 'diagnostics': return 'диагностика';
    case 'master_needed': return 'требуется мастер';
    case 'restored': return 'восстановлено';
    case 'closed': return 'закрыто';
    default: return s;
  }
}

function IntegrationSummary({ integration, config }: { integration: McIntegration | null; config: McConfig }) {
  const items: Array<{ label: string; value: string }> = [
    { label: 'Последний успешный сбор', value: integration?.lastOkAt ? `${fmtTs(integration.lastOkAt)} (${ageLabel(Date.now() - new Date(integration.lastOkAt).getTime())} назад)` : 'ещё не было' },
    { label: 'Объектов с позицией', value: integration ? `${integration.objectsWithPosition ?? '—'} из ${integration.objectsTotal ?? '—'}` : '—' },
    { label: 'Порог «нет обновлений»', value: `${config.staleHours} ч` },
    { label: 'Окно после въезда в РФ', value: `${config.rfWindowHours} ч` },
  ];
  return (
    <div className={`${UI.bar} flex flex-wrap items-center gap-x-6 gap-y-1`}>
      <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-[#121316]">
        <Settings2 className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" /> Телеметрия Nav.by
      </span>
      {items.map((i) => (
        <span key={i.label} className="text-[11px] text-[#6B7280]">
          {i.label}: <span className="text-[#4B5563] font-medium">{i.value}</span>
        </span>
      ))}
    </div>
  );
}

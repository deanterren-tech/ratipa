/**
 * Вкладка «Проверка пробега» — простая таблица: автомобиль, рейс (выбор из
 * «Плана дохода»), индикатор поступления CAN-данных, кнопка «График».
 *
 * Показания одометра смотрят в отдельном окне (CanGraphDialog) — по клику на
 * строку или кнопке «График». Строка таблицы не раскрывается: приросты,
 * GPS-сравнение, стоянки, полнота данных и статусы проверки здесь не
 * показываются, интерфейс понятен без инструкций.
 *
 * Статусы поступления данных загружаются пакетно (см. CanStatusBadge), рейс
 * каждой машины выбирается в таблице и задаёт период графика; поиск и выбор
 * рейса сохраняются при открытии/закрытии окна (таблица не размонтируется).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Gauge, RefreshCw } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { SearchField, EmptyState, SectionHeader } from '../../../ui/components';
import { dbService } from '../../../api';
import type { Vehicle } from '../../../types';
import { resolveTripWindow, tripsForCar, type TripCandidate } from './engine/binding';
import { mcService } from './mcService';
import type { McConfig, McCurrent, McMapping } from './mcTypes';
import { CAN_STATUS_LOADING, CanStatusBadge, useCanStatuses } from './CanStatusBadge';
import CanGraphDialog from './CanGraphDialog';

interface Props {
  mapping: Record<string, McMapping>;
  current: Record<string, McCurrent>;
  config: McConfig;
  cars: Vehicle[];
  nowMs: number;
}

interface CarRow {
  carKey: string;
  plate: string;
  trips: TripCandidate[];
  selected: TripCandidate | null;
}

/** ISO-день (YYYY-MM-DD) → дд/мм/гггг. */
const ruIso = (s: string | null | undefined): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '—';
};

export default function MileageCheckTab(props: Props) {
  const { mapping, current, config, cars, nowMs } = props;
  const [query, setQuery] = useState('');
  const [selectedByCar, setSelectedByCar] = useState<Record<string, string>>({});
  const [planTrips, setPlanTrips] = useState<Array<Record<string, unknown>>>([]);
  const [stagesStore, setStagesStore] = useState<Record<string, Record<string, unknown>>>({});
  const [graphCarKey, setGraphCarKey] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [collectSig, setCollectSig] = useState('');

  useEffect(() => {
    const u1 = dbService.getPlanDohodTrips((list) => setPlanTrips((list || []) as unknown as Array<Record<string, unknown>>));
    const u2 = dbService.getTimelineTripStages((store) => setStagesStore(store || {}));
    const u3 = mcService.subscribeCanCollectState((v) =>
      setCollectSig(`${(v?.lastSweepAtMs as number) || ''}|${String(v?.lastRunAt || '')}`),
    );
    return () => {
      if (typeof u1 === 'function') u1();
      if (typeof u2 === 'function') u2();
      if (typeof u3 === 'function') u3();
    };
  }, []);

  const plateOf = useCallback(
    (carKey: string) => {
      const car = cars.find((c) => c.id === carKey);
      return mapping[carKey]?.plateRaw || mapping[carKey]?.plate || car?.carNumber || carKey;
    },
    [cars, mapping],
  );

  const carNumberOf = useCallback(
    (carKey: string) => {
      const car = cars.find((c) => c.id === carKey);
      return car?.carNumber || mapping[carKey]?.plateRaw || mapping[carKey]?.plate || carKey;
    },
    [cars, mapping],
  );

  const allRows: CarRow[] = useMemo(() => {
    const keys = new Set<string>();
    for (const [carKey, m] of Object.entries(mapping)) if (m?.navbyObjectId) keys.add(carKey);
    const out: CarRow[] = [];
    for (const carKey of keys) {
      const carNumber = carNumberOf(carKey);
      const trips = tripsForCar(planTrips, carKey, carNumber);
      let selected: TripCandidate | null = null;
      if (trips.length) {
        const chosenKey = selectedByCar[carKey];
        selected = (chosenKey && trips.find((t) => t.key === chosenKey)) || null;
        if (!selected) {
          // текущий рейс (окно содержит сейчас), иначе — самый свежий
          selected =
            trips.find((t) => {
              const r = resolveTripWindow({ candidate: t, carKey, factDays: [], override: null, nowMs });
              return r.window != null && nowMs >= r.window.fromMs && nowMs <= r.window.toMs;
            }) || trips[0];
        }
      }
      out.push({ carKey, plate: plateOf(carKey), trips, selected });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, planTrips, cars, selectedByCar, nowMs, carNumberOf, plateOf]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allRows
      .filter((r) => !q || `${r.plate} ${r.carKey} ${mapping[r.carKey]?.navbyObjectId || ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.plate.localeCompare(b.plate, 'ru'));
  }, [allRows, query, mapping]);

  // Статусы для видимых строк + открытой в окне машины (окно остаётся живым,
  // даже если фильтр поиска её скрыл).
  const statusKeys = useMemo(() => {
    const keys = rows.map((r) => r.carKey);
    if (graphCarKey && !keys.includes(graphCarKey)) keys.push(graphCarKey);
    return keys;
  }, [rows, graphCarKey]);

  const statuses = useCanStatuses({
    carKeys: statusKeys,
    current,
    nowMs,
    intervalSec: config.intervalSec,
    refreshToken: `${refreshTick}|${collectSig}|${Math.floor(nowMs / 300_000)}`,
    forceToken: refreshTick,
  });

  const setCarTrip = (carKey: string, tripKey: string) => {
    setSelectedByCar((s) => ({ ...s, [carKey]: tripKey }));
  };

  if (Object.keys(mapping).length === 0) {
    return (
      <EmptyState
        title="Нет сопоставленных автомобилей"
        hint="Сопоставьте автопарк с объектами Nav.by в настройках модуля — после этого здесь появятся машины и их показания."
      />
    );
  }

  const graphRow = graphCarKey ? allRows.find((r) => r.carKey === graphCarKey) || null : null;

  return (
    <div className="flex flex-col gap-3">
      <SectionHeader
        icon={<Gauge className="w-4 h-4" />}
        tone="graphite"
        title="Автомобили"
        subtitle="Поступление CAN-данных и график показаний одометра по машине."
      >
        <div className="flex items-center gap-2">
          <SearchField
            value={query}
            onChange={setQuery}
            placeholder="Поиск: номер или объект"
            ariaLabel="Поиск по автомобилям"
            className="sm:max-w-xs"
          />
          <button
            type="button"
            className={UI.buttonGhost + ' !min-h-0 !py-1.5 text-[11px] inline-flex items-center gap-1 shrink-0'}
            onClick={() => setRefreshTick((x) => x + 1)}
            title="Перечитать данные по машинам"
            data-testid="mc-check-refresh"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Обновить
          </button>
        </div>
      </SectionHeader>

      {rows.length === 0 ? (
        <EmptyState kind="no-results" query={query} />
      ) : (
        <div className={UI.tableWrap}>
          <table className={UI.table} data-testid="mc-overview-table">
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Автомобиль</th>
                <th className={UI.th}>Рейс</th>
                <th className={UI.th}>Данные CAN-одометра</th>
                <th className={UI.th} aria-label="График" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.carKey}
                  className={`${UI.tr} cursor-pointer`}
                  onClick={() => setGraphCarKey(r.carKey)}
                  data-testid={`mc-car-row-${r.carKey}`}
                >
                  <td className={UI.tdStrong}>{r.plate}</td>
                  <td className={UI.td}>
                    {r.trips.length === 0 && <span className="text-[#9CA3AF]">нет рейсов в «Плане дохода»</span>}
                    {r.trips.length > 0 && (
                      <select
                        className={UI.select + ' !min-h-0 !py-1 text-[11px] max-w-[220px]'}
                        value={r.selected?.key || ''}
                        onChange={(e) => setCarTrip(r.carKey, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        data-testid={`mc-trip-select-${r.carKey}`}
                      >
                        {r.trips.map((t) => (
                          <option key={t.key} value={t.key}>
                            {ruIso(t.dateStart)} → {ruIso(t.dateEnd)}
                            {t.direction ? ` · ${t.direction.slice(0, 24)}` : ''}
                            {t.archived ? ' (архив)' : ''}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className={UI.td}>
                    <CanStatusBadge status={statuses[r.carKey] ?? CAN_STATUS_LOADING} nowMs={nowMs} />
                  </td>
                  <td className={`${UI.td} text-right`}>
                    <button
                      type="button"
                      className={UI.buttonGhost + ' !min-h-0 !px-2.5 !py-1 text-[11px]'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setGraphCarKey(r.carKey);
                      }}
                      data-testid={`mc-graph-btn-${r.carKey}`}
                    >
                      График
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {graphRow && (
        <CanGraphDialog
          key={graphRow.carKey}
          carKey={graphRow.carKey}
          plate={graphRow.plate}
          trips={graphRow.trips}
          stagesStore={stagesStore}
          initialTripKey={graphRow.selected?.key ?? null}
          current={current[graphRow.carKey]}
          intervalSec={config.intervalSec}
          status={statuses[graphRow.carKey] ?? CAN_STATUS_LOADING}
          nowMs={nowMs}
          onRefreshStatus={() => setRefreshTick((x) => x + 1)}
          onClose={() => setGraphCarKey(null)}
        />
      )}
    </div>
  );
}

/**
 * Вкладка «Проверка пробега» (этап 2): обзор по автомобилям и рейсам.
 *
 * Единица проверки — рейс (запись «Плана дохода»). Строка показывает машину,
 * выбранный рейс, границы и их источник, а после раскрытия — накопленный
 * пробег, стоянки с событиями, полноту данных и статус проверки.
 * Анализ загружается лениво: только раскрытая машина, только её окно.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Gauge, Info } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { SearchField, EmptyState, StatusText, SectionHeader } from '../../../ui/components';
import { dbService } from '../../../api';
import type { UserProfile, Vehicle } from '../../../types';
import { MC_CHECK_DEFAULTS, type CheckParams } from './engine/params';
import { resolveTripWindow, tripsForCar, factDaysOfStages, type TripCandidate } from './engine/binding';
import { fmtDMY, fmtKm } from './engine/format';
import { mcService } from './mcService';
import type { McConfig, McCurrent, McIntegration, McMapping } from './mcTypes';
import TripCheckCard from './TripCheckCard';
import type { TripResultBrief } from './TripCheckView';

interface Props {
  user: UserProfile;
  canEvents: boolean;
  canRules: boolean;
  mapping: Record<string, McMapping>;
  current: Record<string, McCurrent>;
  config: McConfig;
  integration: McIntegration | null;
  cars: Vehicle[];
  nowMs: number;
  onCreateRequest: (carKey: string, problem?: string) => void;
}

interface CarRow {
  carKey: string;
  plate: string;
  mapped: boolean;
  trips: TripCandidate[];
  selected: TripCandidate | null;
}

export default function MileageCheckTab(props: Props) {
  const { user, canEvents, canRules, mapping, current, config, integration, cars, nowMs, onCreateRequest } = props;
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [selectedByCar, setSelectedByCar] = useState<Record<string, string>>({});
  const [planTrips, setPlanTrips] = useState<Array<Record<string, unknown>>>([]);
  const [stagesStore, setStagesStore] = useState<Record<string, Record<string, unknown>>>({});
  const [mappingHistory, setMappingHistory] = useState<Record<string, Record<string, { at: string; action: string; comment?: string }>>>({});
  const [checkParams, setCheckParams] = useState<CheckParams>(MC_CHECK_DEFAULTS);
  const [briefs, setBriefs] = useState<Record<string, TripResultBrief>>({});

  useEffect(() => {
    const u1 = dbService.getPlanDohodTrips((list) => setPlanTrips((list || []) as unknown as Array<Record<string, unknown>>));
    const u2 = dbService.getTimelineTripStages((store) => setStagesStore(store || {}));
    const u3 = mcService.subscribeMappingHistory((store) => setMappingHistory(store || {}));
    const u4 = mcService.subscribeCheckConfig(setCheckParams);
    return () => {
      if (typeof u1 === 'function') u1();
      if (typeof u2 === 'function') u2();
      if (typeof u3 === 'function') u3();
      if (typeof u4 === 'function') u4();
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

  const rows: CarRow[] = useMemo(() => {
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
      out.push({ carKey, plate: plateOf(carKey), mapped: true, trips, selected });
    }
    const q = query.trim().toLowerCase();
    return out
      .filter((r) => !q || `${r.plate} ${mapping[r.carKey]?.navbyObjectId || ''}`.toLowerCase().includes(q))
      .sort((a, b) => a.plate.localeCompare(b.plate, 'ru'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, planTrips, cars, query, selectedByCar, nowMs, carNumberOf]);

  if (Object.keys(mapping).length === 0) {
    return (
      <EmptyState
        title="Нет сопоставленных автомобилей"
        hint="Сопоставьте автопарк с объектами Nav.by в настройках модуля — после этого здесь появится проверка пробега по рейсам."
      />
    );
  }

  const withTrips = rows.filter((r) => r.trips.length > 0).length;

  const setCarTrip = (carKey: string, tripKey: string) => {
    setSelectedByCar((s) => ({ ...s, [carKey]: tripKey }));
    setBriefs((b) => {
      const next = { ...b };
      for (const k of Object.keys(next)) if (k.startsWith(`${carKey}|`) && !k.endsWith(`|${tripKey}`)) delete next[k];
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className={`${UI.bar} flex items-start gap-2.5 !rounded-xl`}>
        <Info className="w-4 h-4 text-[#9CA3AF] shrink-0 mt-px" aria-hidden="true" />
        <div className="text-[11px] leading-relaxed text-[#4B5563]">
          <div className="font-semibold text-[#121316]">Проверка пробега по целому рейсу</div>
          Единица проверки — рейс из «Плана дохода» (даты и заявленный километраж берутся из него, параллельный реестр не создаётся).
          Границы анализа показываются с источником: фактические даты этапов, плановые границы или ручное уточнение.
          Стоянки определяются отчётом Nav.by «Стоянка-движение»{integration?.mode ? '' : ' (если доступен)'}, при его недоступности — расчётом портала по измерениям.
          {` Сопоставлено машин: ${rows.length}; с рейсами в «Плане дохода»: ${withTrips}.`}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeader
          icon={<Gauge className="w-4 h-4" />}
          tone="graphite"
          title="Автомобили и рейсы"
          subtitle="Раскройте строку: анализ загрузит историю измерений этой машины и интервалы стоянок."
        >
          <SearchField value={query} onChange={setQuery} placeholder="Поиск: номер или объект" ariaLabel="Поиск по автомобилям" className="sm:max-w-xs" />
        </SectionHeader>

        <div className={UI.tableWrap}>
          <table className={UI.table} data-testid="mc-overview-table">
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Автомобиль</th>
                <th className={UI.th}>Рейс</th>
                <th className={UI.th}>Начало и окончание</th>
                <th className={UI.th}>Источник границ</th>
                <th className={UI.th}>Накопленный пробег</th>
                <th className={UI.th}>GPS-сравнение</th>
                <th className={UI.th}>Стоянки с событиями</th>
                <th className={UI.th}>Другие события</th>
                <th className={UI.th}>Полнота данных</th>
                <th className={UI.th}>Статус проверки</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isOpen = expanded === r.carKey;
                const brief = r.selected ? briefs[`${r.carKey}|${r.selected.key}`] : undefined;
                const win = r.selected
                  ? resolveTripWindow({ candidate: r.selected, carKey: r.carKey, factDays: factDaysOfStages(stagesStore, r.selected.id), override: null, nowMs })
                  : null;
                return (
                  <tr
                    key={r.carKey}
                    className={`${UI.tr} cursor-pointer`}
                    onClick={() => setExpanded(isOpen ? null : r.carKey)}
                    data-testid={`mc-car-row-${r.plate}`}
                  >
                      <td className={UI.tdStrong}>
                        <span className="inline-flex items-center gap-1.5">
                          {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5 text-[#9CA3AF]" aria-hidden="true" />}
                          {r.plate}
                        </span>
                      </td>
                      <td className={UI.td} onClick={(e) => e.stopPropagation()}>
                        {r.trips.length === 0 && <span className="text-[#9CA3AF]">нет рейсов в «Плане дохода»</span>}
                        {r.trips.length > 0 && (
                          <select
                            className={UI.select + ' !min-h-0 !py-1 text-[11px] max-w-[220px]'}
                            value={r.selected?.key || ''}
                            onChange={(e) => setCarTrip(r.carKey, e.target.value)}
                            data-testid={`mc-trip-select-${r.plate}`}
                          >
                            {r.trips.map((t) => (
                              <option key={t.key} value={t.key}>
                                {t.dateStart || '—'} → {t.dateEnd || '—'}{t.direction ? ` · ${t.direction.slice(0, 24)}` : ''}{t.archived ? ' (архив)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                      </td>
                      <td className={UI.td}>
                        {win?.window ? `${fmtDMY(win.window.fromMs)} → ${win.window.ongoing ? 'сейчас' : fmtDMY(win.window.toMs)}`
                          : r.selected ? <StatusText color="amber">требует уточнения</StatusText> : '—'}
                      </td>
                      <td className={UI.td}>
                        {win?.window ? <span className={UI.chip}>{win.window.sourceLabel.split('(')[0].trim()}</span> : '—'}
                      </td>
                      <td className={UI.td}>{brief ? (brief.odoGainKm != null ? fmtKm(brief.odoGainKm) : <span className="text-[#9CA3AF]">не вычислить</span>) : <span className="text-[#9CA3AF]">раскройте строку</span>}</td>
                      <td className={UI.td}>
                        {brief
                          ? brief.gpsCoveragePct != null && brief.gpsCoveragePct > 0
                            ? `доступно — ${brief.gpsCoveragePct}% времени`
                            : <span className="text-[#9CA3AF]">нет пригодных данных</span>
                          : <span className="text-[#9CA3AF]">—</span>}
                      </td>
                      <td className={UI.td}>{brief ? brief.stopsWithEvents : <span className="text-[#9CA3AF]">—</span>}</td>
                      <td className={UI.td}>{brief ? brief.otherEvents : <span className="text-[#9CA3AF]">—</span>}</td>
                      <td className={UI.td}>{brief ? `${brief.completeness ?? '—'}%` : <span className="text-[#9CA3AF]">—</span>}</td>
                      <td className={UI.td}>
                        {!r.selected
                          ? <span className="text-[#6B7280]">Недостаточно данных — нет рейса</span>
                          : brief
                            ? <StatusText color={brief.statusColor}>{brief.status}</StatusText>
                            : <span className="text-[#6B7280]">Не рассчитано</span>}
                      </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Подробный анализ — отдельным блоком под таблицей (полная ширина, без
            горизонтальной прокрутки обзорной таблицы). */}
        {(() => {
          const openRow = rows.find((r) => r.carKey === expanded) || null;
          if (!openRow) return null;
          return (
            <div className="bg-[#F9FAFB] border border-[#E5E7EB] rounded-2xl p-3" data-testid="mc-expanded-block">
              <div className="text-[11px] font-semibold text-[#121316] mb-2 flex items-center justify-between gap-2 flex-wrap">
                <span>{openRow.plate} — подробный анализ рейса</span>
                <button type="button" className={UI.buttonLink} onClick={() => setExpanded(null)}>Свернуть</button>
              </div>
              {openRow.selected ? (
                <TripCheckCard
                  carKey={openRow.carKey}
                  plate={openRow.plate}
                  candidate={openRow.selected}
                  factDays={factDaysOfStages(stagesStore, openRow.selected.id)}
                  nowMs={nowMs}
                  params={checkParams}
                  user={user}
                  canEvents={canEvents}
                  canRules={canRules}
                  mappingHistoryEntries={Object.entries(mappingHistory[openRow.carKey] || {}).map(([, v]) => ({
                    atMs: Date.parse(v.at),
                    action: v.action,
                    comment: v.comment,
                  })).sort((a, b) => a.atMs - b.atMs)}
                  onCreateRequest={(problem) => onCreateRequest(openRow.carKey, problem)}
                  onResultBrief={(brief2) => setBriefs((b) => ({ ...b, [`${openRow.carKey}|${openRow.selected?.key}`]: brief2 }))}
                />
              ) : (
                <div className="text-[11px] text-[#6B7280] px-1 py-2">
                  У машины нет рейсов в «Плане дохода» — анализировать нечего. Добавьте рейс в «Плане дохода» или на таймлайне.
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/**
 * Карточка раскрытой строки обзора: подписка на записи проверки, загрузка
 * истории измерений выбранной машины и отчёта Nav.by «Стоянка-движение»,
 * затем — подробный анализ рейса (TripCheckView).
 * Грузится ТОЛЬКО выбранная машина; повторные раскрытия используют кэш.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UserProfile } from '../../../types';
import { mcService } from './mcService';
import type { McCheckRecords } from './mcTypes';
import type { CheckParams } from './engine/params';
import { resolveTripWindow, type TripCandidate } from './engine/binding';
import type { BoundsOverride, MeasureSample, ParkingIntervalRaw } from './engine/types';
import type { MappingHistoryLite } from './engine/tech';
import TripCheckView, { type TripResultBrief } from './TripCheckView';

interface Props {
  carKey: string;
  plate: string;
  candidate: TripCandidate;
  factDays: number[];
  nowMs: number;
  params: CheckParams;
  user: UserProfile;
  canEvents: boolean;
  canRules: boolean;
  mappingHistoryEntries: Array<{ atMs: number; action: string; comment?: string }>;
  onCreateRequest: (problem: string) => void;
  onResultBrief: (brief: TripResultBrief) => void;
}

export default function TripCheckCard(props: Props) {
  const { carKey, plate, candidate, factDays, nowMs, params, user, canEvents, canRules, mappingHistoryEntries, onCreateRequest, onResultBrief } = props;

  const [records, setRecords] = useState<McCheckRecords>({});
  const [samples, setSamples] = useState<MeasureSample[] | null>(null);
  const [report, setReport] = useState<{ available: boolean; reason: string | null; fetchedAt: string | null; intervals: ParkingIntervalRaw[] | null }>({
    available: false, reason: 'загрузка…', fetchedAt: null, intervals: null,
  });
  const [loading, setLoading] = useState(true);
  const [reloadTick, setReloadTick] = useState(0);
  const loadSeq = useRef(0);

  const override: BoundsOverride | null = useMemo(() => {
    const b = records.bounds;
    if (!b || typeof b.fromMs !== 'number' || typeof b.toMs !== 'number') return null;
    return { fromMs: b.fromMs, toMs: b.toMs, by: b.by, byId: b.byId, at: b.at, comment: b.comment };
  }, [records.bounds]);

  useEffect(() => mcService.subscribeCheckRecords(carKey, candidate.key, setRecords), [carKey, candidate.key]);

  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    const res = resolveTripWindow({ candidate, carKey, factDays, override, nowMs });
    if (!res.window) {
      setSamples([]);
      setReport({ available: false, reason: res.needClarification, fetchedAt: null, intervals: null });
      setLoading(false);
      return;
    }
    const win = res.window;
    const [history, rep] = await Promise.all([
      mcService.readHistoryRange(carKey, win.fromMs, win.toMs),
      mcService.fetchParkingReport(carKey, win.fromMs, win.toMs),
    ]);
    if (seq !== loadSeq.current) return; // устаревшая загрузка
    setSamples(history);
    setReport({
      available: rep.ok,
      reason: rep.ok ? null : rep.reason || 'отчёт недоступен',
      fetchedAt: rep.fetchedAt || null,
      intervals: rep.intervals || null,
    });
    setLoading(false);
  }, [candidate, carKey, factDays, override, nowMs]);

  useEffect(() => {
    void load();
  }, [load, reloadTick]);

  return (
    <TripCheckView
      carKey={carKey}
      plate={plate}
      candidate={candidate}
      factDays={factDays}
      override={override}
      nowMs={nowMs}
      samples={samples || []}
      report={report}
      checkRecords={records}
      mappingHistory={mappingHistoryEntries as MappingHistoryLite[]}
      params={params}
      user={user}
      canEvents={canEvents}
      canRules={canRules}
      loading={loading}
      onReload={() => setReloadTick((t) => t + 1)}
      onCreateRequest={onCreateRequest}
      onResultBrief={onResultBrief}
    />
  );
}

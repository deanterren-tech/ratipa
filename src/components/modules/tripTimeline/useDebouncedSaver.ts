/**
 * Debounce-сохранение правок таймлайна без потери фокуса.
 *
 * Поля карточек рейса/события правятся локальным черновиком (контролируемые
 * инпуты не перебиваются ответами базы), а запись уходит в RTDB не на каждый
 * символ, а через паузу; при закрытии карточки буфер сбрасывается принудительно.
 * Правки копятся ПО ЦЕЛЯМ: рейс — merge по узлу рейса, этап — merge по узлу
 * этапа, поэтому одновременные правки разных полей не перетирают друг друга.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { dbService } from '../../../api';
import type { TimelineTrip } from '../../../types';

export type SaverStatus = 'idle' | 'saved';

export interface TimelineSaver {
  queueTrip: (tripId: string, patch: Partial<TimelineTrip>) => void;
  queueStage: (tripId: string, stageId: string, patch: Record<string, unknown>) => void;
  /** Этапы рейсов из внешних источников (План дохода): tripTimeline/tripStages/<sourceId>. */
  queueAutoStage: (sourceId: string, stageId: string, patch: Record<string, unknown>) => void;
  flush: () => void;
  /** Сбросить ещё НЕ записанный буфер без записи (сценарий «Выйти без сохранения»). */
  cancel: () => void;
  status: SaverStatus;
}

export function useDebouncedSaver(delayMs = 650): TimelineSaver {
  const tripBuf = useRef<Map<string, Partial<TimelineTrip>>>(new Map());
  const stageBuf = useRef<Map<string, Record<string, unknown>>>(new Map());
  const autoBuf = useRef<Map<string, Record<string, unknown>>>(new Map());
  const timer = useRef<number | null>(null);
  const savedTimer = useRef<number | null>(null);
  const mounted = useRef(true);
  const [status, setStatus] = useState<SaverStatus>('idle');

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const flush = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const trips = tripBuf.current;
    const stages = stageBuf.current;
    const autos = autoBuf.current;
    tripBuf.current = new Map();
    stageBuf.current = new Map();
    autoBuf.current = new Map();
    if (!trips.size && !stages.size && !autos.size) return;
    const nowIso = new Date().toISOString();
    trips.forEach((patch, id) => {
      dbService.updateTimelineTrip(id, { ...patch, updatedAt: nowIso });
    });
    stages.forEach((patch, key) => {
      const sep = key.indexOf('::');
      dbService.updateTimelineStage(key.slice(0, sep), key.slice(sep + 2), patch);
    });
    autos.forEach((patch, key) => {
      const sep = key.indexOf('::');
      dbService.updateTimelineTripStage(key.slice(0, sep), key.slice(sep + 2), patch);
    });
    if (mounted.current) {
      setStatus('saved');
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => {
        if (mounted.current) setStatus('idle');
      }, 1600);
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delayMs);
  }, [flush, delayMs]);

  const queueTrip = useCallback(
    (tripId: string, patch: Partial<TimelineTrip>) => {
      if (!tripId) return;
      const prev = tripBuf.current.get(tripId) || {};
      tripBuf.current.set(tripId, { ...prev, ...patch });
      schedule();
    },
    [schedule],
  );

  const queueStage = useCallback(
    (tripId: string, stageId: string, patch: Record<string, unknown>) => {
      if (!tripId || !stageId) return;
      const key = `${tripId}::${stageId}`;
      const prev = stageBuf.current.get(key) || {};
      stageBuf.current.set(key, { ...prev, ...patch });
      schedule();
    },
    [schedule],
  );

  const queueAutoStage = useCallback(
    (sourceId: string, stageId: string, patch: Record<string, unknown>) => {
      if (!sourceId || !stageId) return;
      const key = `${sourceId}::${stageId}`;
      const prev = autoBuf.current.get(key) || {};
      autoBuf.current.set(key, { ...prev, ...patch });
      schedule();
    },
    [schedule],
  );

  /**
   * Отменить буфер: ещё не записанные правки НЕ уходят в базу. Используется
   * сценарием «Выйти без сохранения» (осознанный отказ от последних правок);
   * уже записанные ранее значения не откатываются.
   */
  const cancel = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    tripBuf.current = new Map();
    stageBuf.current = new Map();
    autoBuf.current = new Map();
  }, []);

  // Уход со страницы/смена вкладки — не теряем несохранённое
  useEffect(() => () => flush(), [flush]);

  return { queueTrip, queueStage, queueAutoStage, flush, cancel, status };
}

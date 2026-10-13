/**
 * Индикатор поступления CAN-данных машины: значок + подпись + время последнего
 * полученного показания, подробности — в подсказке.
 *
 * Пакетная загрузка статусов: одна выборка на машину (история сегодня+вчера и
 * покрытие), ограничение параллелизма, кэш с TTL и повторная загрузка по
 * сигналу обновления (ручная кнопка / новый съём сбора / истечение TTL).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { STATUS_DOT, UI } from '../../../ui/kit';
import { fmtDMYHM, fmtKm } from './engine/format';
import type { McCurrent } from './mcTypes';
import {
  CAN_PHASE_LABEL, CAN_STATUS_LOADING, computeCanCarStatus, readCanStatusRaw,
  type CanCarStatus, type CanStatusRaw,
} from './canStatus';

/* ─────────────────────────── Пакетная загрузка статусов ─────────────────────────── */

/** Кэш статуса: держим до 10 минут, дальше молча перечитываем при следующем сигнале. */
const STATUS_TTL_MS = 10 * 60_000;
const STATUS_CONCURRENCY = 6;

async function runPool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let idx = 0;
  const n = Math.min(Math.max(1, limit), items.length);
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (idx < items.length) {
        const i = idx;
        idx += 1;
        await worker(items[i]);
      }
    }),
  );
}

interface RawEntry {
  version: number;
  raw: CanStatusRaw | null;
  error: string | null;
  loadedAtMs: number;
}

export function useCanStatuses(args: {
  carKeys: string[];
  current: Record<string, McCurrent>;
  nowMs: number;
  intervalSec: number;
  /** Сигнал «проверить устаревшие»: ключ съёма + 5-минутные корзины времени. */
  refreshToken: string;
  /** Ручное обновление: перечитать всех немедленно, не дожидаясь TTL. */
  forceToken?: number;
}): Record<string, CanCarStatus> {
  const { carKeys, current, nowMs, intervalSec, refreshToken, forceToken = 0 } = args;
  const [entries, setEntries] = useState<Record<string, RawEntry>>({});
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const versionRef = useRef(0);
  const lastForceRef = useRef(forceToken);
  const aliveRef = useRef(true);
  const keysSig = useMemo(() => carKeys.join('|'), [carKeys]);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    const version = versionRef.current + 1;
    versionRef.current = version;
    const forced = lastForceRef.current !== forceToken;
    lastForceRef.current = forceToken;
    const now = Date.now();
    // Массово (по сигналу сбора / ручной кнопке) не перечитываем: только
    // отсутствующие, ошибочные и устаревшие записи — иначе автоповторы будут
    // долбить базу по каждому тику.
    const need = carKeys.filter((k) => {
      const e = entriesRef.current[k];
      if (forced) return true;
      if (!e) return true;
      if (e.error) return true;
      return now - e.loadedAtMs > STATUS_TTL_MS;
    });
    if (!need.length) return;
    setEntries((prev) => {
      const next = { ...prev };
      for (const k of need) {
        if (!prev[k]) next[k] = { version, raw: null, error: null, loadedAtMs: 0 };
      }
      return next;
    });
    void runPool(need, STATUS_CONCURRENCY, async (k) => {
      let raw: CanStatusRaw | null = null;
      let error: string | null = null;
      try {
        raw = await readCanStatusRaw(k, Date.now());
      } catch (e) {
        error = String(e instanceof Error ? e.message : e).slice(0, 140);
      }
      if (!aliveRef.current || versionRef.current !== version) return;
      setEntries((p) => ({ ...p, [k]: { version, raw, error, loadedAtMs: Date.now() } }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keysSig, refreshToken, forceToken]);

  return useMemo(() => {
    const out: Record<string, CanCarStatus> = {};
    for (const k of carKeys) {
      const e: RawEntry | undefined = entries[k];
      out[k] = computeCanCarStatus({
        raw: e?.raw ?? null,
        error: e?.error ?? null,
        current: current[k] ?? null,
        nowMs,
        intervalSec,
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carKeys, entries, current, nowMs, intervalSec]);
}

/* ─────────────────────────── Значок ─────────────────────────── */

/** Цвет индикатора по фазе; подписи — единый источник CAN_PHASE_LABEL (canStatusCore). */
export const PHASE_META: Record<CanCarStatus['phase'], { label: string; dot: string }> = {
  flowing: { label: CAN_PHASE_LABEL.flowing, dot: STATUS_DOT.emerald },
  stale: { label: CAN_PHASE_LABEL.stale, dot: STATUS_DOT.amber },
  no_odometer: { label: CAN_PHASE_LABEL.no_odometer, dot: STATUS_DOT.grey },
  loading: { label: CAN_PHASE_LABEL.loading, dot: STATUS_DOT.grey },
  error: { label: CAN_PHASE_LABEL.error, dot: STATUS_DOT.rose },
};

/** Краткое время показания: сегодня — «18:53», иначе «02/10 12:49», другой год — с годом. */
function fmtShortTs(ms: number | null, nowMs: number): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  const d = new Date(ms + 180 * 60_000);
  const n = new Date(nowMs + 180 * 60_000);
  const p = (x: number) => String(x).padStart(2, '0');
  const hm = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
  if (d.getUTCFullYear() === n.getUTCFullYear() && d.getUTCMonth() === n.getUTCMonth() && d.getUTCDate() === n.getUTCDate()) return hm;
  const base = `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${hm}`;
  return d.getUTCFullYear() === n.getUTCFullYear() ? base : `${base}/${String(d.getUTCFullYear()).slice(2)}`;
}

/** Подсказка с фактами: что пришло и когда; без домыслов о причинах. */
function statusTitle(s: CanCarStatus, nowMs: number): string {
  const lines: string[] = [PHASE_META[s.phase].label];
  if (s.lastMeasMs != null) {
    const km = fmtKm(s.lastMeasValueKm, s.lastMeasPrecision === 'km_int' ? 0 : 3);
    lines.push(`последнее измерение истории: ${fmtDMYHM(s.lastMeasMs)} — ${km}${s.lastMeasReceivedAtMs != null ? ` (получено порталом: ${fmtDMYHM(s.lastMeasReceivedAtMs)})` : ''}`);
  } else {
    lines.push('измерений истории за сегодня и вчера нет');
  }
  if (s.lastSnapMs != null) {
    lines.push(`снимок поллера с одометром: ${fmtDMYHM(s.lastSnapMs)} — ${fmtKm(s.lastSnapValueKm, 3)} (время измерения одометра в API отсутствует)`);
  }
  if (s.covFilledAtMs != null) lines.push(`последний съём истории по машине: ${fmtDMYHM(s.covFilledAtMs)}`);
  if (s.phase === 'flowing') lines.push('Неизменное показание не означает отсутствие данных: считается факт получения.');
  if (s.phase === 'stale') {
    const ref = s.lastReadingMs;
    if (ref != null) lines.push(`Новых показаний нет ${fmtAge(nowMs - ref)}. Наличие старой истории не доказывает, что данные идут сейчас.`);
  }
  if (s.phase === 'no_odometer') lines.push('Показаний одометра по машине нет: история пуста, свежих снимков с одометром нет.');
  if (s.phase === 'error') lines.push('Не удалось прочитать данные (сеть или доступ). Нажмите «Обновить» ещё раз.');
  return lines.join('\n');
}

function fmtAge(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60_000));
  if (min < 1) return 'меньше минуты';
  const h = Math.floor(min / 60);
  if (h < 1) return `${min} мин`;
  const d = Math.floor(h / 24);
  if (d >= 1) return `${d} дн ${h % 24} ч`;
  return `${h} ч ${min % 60} мин`;
}

export function CanStatusBadge({ status, nowMs, size = 'sm' }: { status: CanCarStatus; nowMs: number; size?: 'sm' | 'lg' }) {
  const meta = PHASE_META[status.phase];
  const time = status.phase === 'flowing' || status.phase === 'stale' ? fmtShortTs(status.lastReadingMs, nowMs) : null;
  return (
    <span
      className={UI.status + (size === 'lg' ? ' text-xs' : '')}
      title={statusTitle(status, nowMs)}
      data-testid="mc-can-status"
      data-can-phase={status.phase}
    >
      <span className={`${UI.statusDot} ${meta.dot}`} aria-hidden="true" />
      <span className="text-[#4B5563]">{meta.label}</span>
      {time ? <span className="text-[#9CA3AF] font-normal">· {time}</span> : null}
    </span>
  );
}

export { CAN_STATUS_LOADING };

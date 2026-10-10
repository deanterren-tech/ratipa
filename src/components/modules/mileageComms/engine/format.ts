/**
 * Форматирование для движка и графиков (пояс портала — Europe/Minsk, +03,
 * как fmtTs в mcTypes). Движок считает в UTC-мс, подписи — в поясе портала.
 */

export const TZ_OFFSET_MIN = 180;

const shift = (ms: number): Date => new Date(ms + TZ_OFFSET_MIN * 60_000);

const p2 = (n: number): string => String(n).padStart(2, '0');

/** «14:17» в поясе портала. */
export const fmtHM = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = shift(ms);
  return `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};

/** «10.10 14:17». */
export const fmtDMHM = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = shift(ms);
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};

/** «10.10.2026 14:17». */
export const fmtDMYHM = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = shift(ms);
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`;
};

/** «10.10.2026». */
export const fmtDMY = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const d = shift(ms);
  return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
};

/** Длительность: «2 ч 05 мин», «15 мин», «3 дн 4 ч». */
export const fmtDuration = (ms: number | null | undefined): string => {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 60) return `${min} мин`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h} ч${m ? ` ${p2(m)} мин` : ''}`;
  const d = Math.floor(h / 24);
  return `${d} дн ${h % 24} ч`;
};

/** Километры: «1 234,5 км» (дробность по величине). */
export const fmtKm = (km: number | null | undefined, digits?: number): string => {
  if (km == null || !Number.isFinite(km)) return '—';
  const d = digits ?? (Math.abs(km) >= 100 ? 1 : 2);
  return `${km.toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d })} км`;
};

/** Число с фиксированной дробностью (ru). */
export const fmtNum = (v: number | null | undefined, digits = 1): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  return v.toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

/** Время суток из мс — для подписей осей (день + час). */
export const fmtAxis = (ms: number): string => {
  const d = shift(ms);
  const h = d.getUTCHours();
  if (h === 0) return `${p2(d.getUTCDate())}.${p2(d.getUTCMonth() + 1)}`;
  return `${p2(h)}:00`;
};

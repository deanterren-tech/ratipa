/**
 * Даты в текстовом виде: единое чтение и запись для форм портала.
 *
 * В интерфейсе дата показывается как ДД/ММ/ГГГГ (текстовое поле + скрытый
 * нативный input[type=date]), а в НОВЫХ данных хранится ISO (ГГГГ-ММ-ДД).
 * Старые значения портала бывают «14/07/1991», «14.07.1991» и ISO — читаем
 * все три вида, чтобы правка старой записи не теряла дату.
 */

/** Разобранные части даты: год, месяц (1–12), день. */
export interface DateParts {
  y: number;
  m: number;
  d: number;
}

/**
 * Разобрать дату из строки в частях. Поддерживает ДД/ММ/ГГГГ, ДД.ММ.ГГГГ,
 * ГГГГ-ММ-ДД и ISO-строку с временем. Возвращает null, если не дата.
 */
export function parseDateParts(value: string | null | undefined): DateParts | null {
  const v = String(value ?? '').trim();
  if (!v) return null;
  // ISO: 1991-07-14 или 1991-07-14T00:00:00.000Z
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    return validParts(y, mo, d);
  }
  // ДД/ММ/ГГГГ или ДД.ММ.ГГГГ (двузначный год — 19xx/20xx)
  m = v.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    let y = Number(m[3]);
    if (m[3].length === 2) y = y >= 70 ? 1900 + y : 2000 + y;
    return validParts(y, mo, d);
  }
  return null;
}

function validParts(y: number, m: number, d: number): DateParts | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return { y, m, d };
}

/** Значение в формате ISO (ГГГГ-ММ-ДД) для хранения в НОВЫХ данных; '' если не дата. */
export function toISODate(value: string | null | undefined): string {
  const p = parseDateParts(value);
  if (!p) return '';
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Отображение даты как ДД/ММ/ГГГГ; '' если не дата. */
export function displayDate(value: string | null | undefined): string {
  const p = parseDateParts(value);
  if (!p) return '';
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/** Значение для скрытого input[type=date] (ГГГГ-ММ-ДД); '' если не дата. */
export function dateInputValue(value: string | null | undefined): string {
  return toISODate(value);
}

/** Год окончания срока действия (для расчёта ежегодной проверки). Поддерживает оба формата. */
export function dateYear(value: string | null | undefined): number | null {
  const p = parseDateParts(value);
  return p ? p.y : null;
}

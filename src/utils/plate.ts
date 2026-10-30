/**
 * Государственные номера: ОДНО правило сравнения и ОДИН вид записи.
 *
 * plateKey — ключ сравнения (латиница, только буквы и цифры; кириллица-двойники
 * приводятся к латинице). Им сравнивают номера между модулями и коллекциями.
 * formatPlate — единый вид записи: «AO 8807-7» (Беларусь), «A042HY67» (РФ),
 * «A 1086 B-7» (прицеп РБ); неизвестный вид возвращается только в латинице.
 * Чистые функции: ничего не читают и не пишут.
 */
const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };

const toLatin = (s: string): string => s.toUpperCase().replace(/[АВЕКМНОРСТХУ]/g, (c) => LOOKALIKE[c]);

/** Ключ всей строки номера (для «тягач / прицеп» — обе части): латиница, буквы и цифры. */
export const plateKeyFull = (plate: unknown): string =>
  toLatin(String(plate ?? '')).replace(/[^A-Z0-9]/g, '');

/** Ключ номера для сравнения; у «тягач / прицеп» берётся тягач (до «/»). */
export const plateKey = (plate: unknown): string =>
  toLatin(String(plate ?? '').split('/')[0]).replace(/[^A-Z0-9]/g, '');

const formatOne = (raw: string): string => {
  const k = toLatin(raw).replace(/[^A-Z0-9]/g, '');
  let m = /^([A-Z]{2})(\d{4})(\d)$/.exec(k);
  if (m) return `${m[1]} ${m[2]}-${m[3]}`;
  m = /^([A-Z])(\d{4})([A-Z])(\d)$/.exec(k);
  if (m) return `${m[1]} ${m[2]} ${m[3]}-${m[4]}`;
  m = /^([A-Z])(\d{3})([A-Z]{2})(\d{2,3})$/.exec(k);
  if (m) return `${m[1]}${m[2]}${m[3]}${m[4]}`;
  return raw.trim();
};

/** Единый вид номера; «тягач / прицеп» форматируется по частям. */
export const formatPlate = (plate: unknown): string =>
  String(plate ?? '').split('/').map((p) => formatOne(p)).filter(Boolean).join(' / ');

export const samePlate = (a: unknown, b: unknown): boolean => {
  const x = plateKey(a);
  return !!x && x === plateKey(b);
};

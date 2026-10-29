/**
 * Приведение полей карточки авто к единому виду ПЕРЕД записью в базу.
 *
 * Зачем: одни и те же данные попадали в базу в разном написании, и программа
 * считала их разными (марки «Mercedes» / «MERCEDES-BENZ», «Kogel» / «KOEGEL»;
 * знак «х» кириллицей в габаритах; кириллические буквы в номерах документов;
 * нулевой год проверки паспорта вместо пустого значения).
 *
 * Принятые правила:
 *  - марка в карточке — КЛЮЧ справочника заглавными (MERCEDES-BENZ, KOEGEL…):
 *    так пишет выпадающий список редактора сцепок, и значение совпадает с его
 *    пунктом. Неизвестная марка — введённый текст заглавными (ключ записи
 *    справочника получается из него так же, как раньше);
 *  - «тягач / прицеп» в одном поле марки — берётся нужная половина;
 *  - габариты — «x» латиницей;
 *  - номера документов (паспорт, личный номер, права) — латиница вместо
 *    одинаково выглядящих кириллических букв;
 *  - год проверки паспорта 0 → пусто.
 *
 * Чистые функции: ничего не читают и не пишут, входная запись не меняется.
 */

export type BrandKind = 'vehicle' | 'trailer';

export interface BrandInfo {
  /** Значение для карточки (и ключ записи справочника, если марка известна). */
  key: string;
  /** Название для справочника (как показывать в списке). */
  name: string;
  /** Марка есть в таблице известных. */
  known: boolean;
}

interface KnownBrand {
  key: string;
  name: string;
}

/** Известные марки тягачей: ключ сравнения → запись. */
const VEHICLE: Record<string, KnownBrand> = {
  mercedes: { key: 'MERCEDES-BENZ', name: 'Mercedes-Benz' },
  volvo: { key: 'VOLVO', name: 'Volvo' },
  daf: { key: 'DAF', name: 'DAF' },
};

/** Известные марки прицепов: ключ сравнения (oe→o) → запись. */
const TRAILER: Record<string, KnownBrand> = {
  kogel: { key: 'KOEGEL', name: 'KOEGEL' },
  schwarzmuller: { key: 'SCHWARZMULLER', name: 'Schwarzmuller' },
  kassbohrer: { key: 'KASSBOHRER', name: 'Kassbohrer' },
  kazberer: { key: 'KASSBOHRER', name: 'Kassbohrer' },
};

/** Частые опечатки: ключ сравнения опечатки → ключ сравнения верной марки. */
const ALIASES: Record<BrandKind, Record<string, string>> = {
  vehicle: { mersedes: 'mercedes', mercedez: 'mercedes' },
  trailer: {},
};

/** Ключ сравнения: нижний регистр, без знаков; для тягача — без «benz», для прицепа — oe→o. */
export const brandCompareKey = (kind: BrandKind, raw: string): string => {
  const base = raw.toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]/g, '');
  const key = kind === 'vehicle' ? base.replace(/benz/g, '') : base.replace(/oe/g, 'o');
  return ALIASES[kind][key] || key;
};

/** Марка из введённого текста; null — текст пустой. */
export const canonicalBrand = (kind: BrandKind, raw: unknown): BrandInfo | null => {
  let text = typeof raw === 'string' ? raw.trim() : '';
  if (!text) return null;
  if (text.includes('/')) {
    // «MERSEDES / KOEGEL» — пара тягач/прицеп: для прицепа нужна последняя часть, для тягача — первая.
    const parts = text.split('/').map((p) => p.trim()).filter(Boolean);
    text = (kind === 'trailer' ? parts[parts.length - 1] : parts[0]) || text;
  }
  const hit = (kind === 'vehicle' ? VEHICLE : TRAILER)[brandCompareKey(kind, text)];
  if (hit) return { key: hit.key, name: hit.name, known: true };
  const spaced = text.replace(/\s+/g, ' ');
  return { key: spaced.toUpperCase(), name: spaced, known: false };
};

/** Ключ записи справочника марок (как его строило приложение: только A-Z, 0-9, _ и -). */
export const directoryKeyOf = (info: BrandInfo): string => info.key.replace(/[^A-Z0-9_-]/g, '_');

/** Габариты: «х» кириллицей → «x» латиницей. */
export const fixDimensions = (s: string): string => s.replace(/[хХ]/g, 'x');

const LOOKALIKE: Record<string, string> = { А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y' };

/** Номер документа: одинаково выглядящие кириллические буквы → латиница, пробелы по краям убираются. */
export const fixDocumentNumber = (s: string): string => s.trim().replace(/[АВЕКМНОРСТХУ]/g, (c) => LOOKALIKE[c]);

const VEHICLE_BRAND_FIELDS = ['brand', 'brandModel', 'brands'];
const TRAILER_BRAND_FIELDS = ['trailerMake', 'trailerBrand'];
const DOCUMENT_FIELDS = ['passportNumber', 'passport', 'personalId', 'licenseNumber', 'license'];

/** Копия записи авто с полями в едином виде. */
export const sanitizeVehicleRecord = <T extends object>(rec: T): T => {
  const out = { ...rec } as Record<string, unknown>;
  for (const f of VEHICLE_BRAND_FIELDS) {
    const info = canonicalBrand('vehicle', out[f]);
    if (info) out[f] = info.key;
  }
  for (const f of TRAILER_BRAND_FIELDS) {
    const info = canonicalBrand('trailer', out[f]);
    if (info) out[f] = info.key;
  }
  if (typeof out.dimensions === 'string') out.dimensions = fixDimensions(out.dimensions);
  for (const f of DOCUMENT_FIELDS) {
    if (typeof out[f] === 'string') out[f] = fixDocumentNumber(out[f] as string);
  }
  if (out.lastPassportVerificationYear === 0) out.lastPassportVerificationYear = null;
  return out as T;
};

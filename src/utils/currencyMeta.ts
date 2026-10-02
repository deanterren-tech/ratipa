/**
 * Символ и русское название валюты.
 *
 * Нужны только для оформления: подпись поля и знак валюты в конвертере.
 * Расчёты берутся исключительно из курсов (useConverter) — здесь их нет,
 * поэтому подписи не могут повлиять на результат конвертации.
 */
export interface CurrencyMeta {
  symbol: string;
  name: string;
}

const CURRENCY_META: Record<string, CurrencyMeta> = {
  USD: { symbol: '$', name: 'Доллар США' },
  EUR: { symbol: '€', name: 'Евро' },
  BYN: { symbol: 'Br', name: 'Белорусский рубль' },
  RUB: { symbol: '₽', name: 'Российский рубль' },
  TRY: { symbol: '₺', name: 'Турецкая лира' },
  KZT: { symbol: '₸', name: 'Казахстанский тенге' },
  CNY: { symbol: '¥', name: 'Китайский юань' },
  UZS: { symbol: 'so\u2018m', name: 'Узбекский сум' },
  AMD: { symbol: '֏', name: 'Армянский драм' },
  GEL: { symbol: '₾', name: 'Грузинский лари' },
  AZN: { symbol: '₼', name: 'Азербайджанский манат' },
  PLN: { symbol: 'zł', name: 'Польский злотый' },
  UAH: { symbol: '₴', name: 'Украинская гривна' },
  GBP: { symbol: '£', name: 'Фунт стерлингов' },
};

/** Символ валюты; для неизвестного кода — сам код. */
export function currencySymbol(code: string): string {
  return CURRENCY_META[String(code || '').toUpperCase()]?.symbol || String(code || '');
}

/** Название валюты; для неизвестного кода — нейтральная подпись. */
export function currencyName(code: string): string {
  return CURRENCY_META[String(code || '').toUpperCase()]?.name || 'Валюта';
}

/**
 * ЕДИНОЕ разрешение диспетчера для любой записи машины (рейс из плана, ручной
 * рейс, период «Учёта выезда» (база/ремонт), событие машины).
 *
 * Первопричина жалобы владельца «запись ремонта по 8806 читается как без
 * диспетчера»: в справочнике сцепок (`couplings`) назначение у большинства
 * машин хранится ТОЛЬКО ИМЕНЕМ («Максим Половиков»), без `dispatcherId`.
 * Дальше строка таймлайна группируется по паре «диспетчер-человек», где имя
 * блока берётся из справочника диспетчеров ПО ИДЕНТИФИКАТОРУ: пустой id даёт
 * пустое имя блока — «Без диспетчера», хотя имя диспетчера в записи есть.
 *
 * Поэтому здесь идентификатор ВЫВОДИТСЯ ИЗ ИМЕНИ (через существующий
 * `resolveDispatcherId` справочника), а не только берётся из поля. Плюс
 * плановый откат выбирает диспетчера ПО ДАТЕ записи, а не «однозначного за всю
 * историю»: у машины диспетчер за историю меняется (8806: Юрий → Максим), и
 * правило «только один на всю историю» оставляло машину без назначения.
 *
 * Ничего не выдумывается: если назначения нет ни в одном источнике — запись
 * честно остаётся без диспетчера.
 */
import {
  buildDispatcherDirectory,
  resolveDispatcherId,
  type DispatcherDirectory,
} from '../../../../utils/dispatcher';
import { dayNum } from './timeline';

const CYR2LAT: Record<string, string> = {
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', У: 'Y', Х: 'X', І: 'I', Ё: 'E',
};
const LAT2CYR: Record<string, string> = Object.fromEntries(
  Object.entries(CYR2LAT).map(([cyr, lat]) => [lat, cyr]),
);

const normKey = (s: unknown): string => String(s ?? '').toUpperCase().replace(/[^A-ZА-ЯЁ0-9]/g, '');
const translit = (s: string, map: Record<string, string>): string => [...s].map((ch) => map[ch] || ch).join('');

/**
 * Машина из текста «машина / прицеп»: в «Учёте выезда» номер часто записан как
 * «AO 8806-7 / A3928B7» (машина и прицеп). Без отрезания прицепа ключ
 * «AO8806A3928B7» не совпадает ни с одной карточкой парка.
 */
export const carPartOf = (value: unknown): string => String(value ?? '').split(/[/;,]|\s+и\s+/i)[0].trim();

/** Варианты ключа номера: как есть и без прицепа, в трёх раскладках. */
export const vehicleKeyVariants = (value: unknown): string[] => {
  const raw = String(value ?? '');
  const out = new Set<string>();
  for (const part of [raw, carPartOf(raw)]) {
    if (!part) continue;
    for (const variant of [part, translit(part, CYR2LAT), translit(part, LAT2CYR)]) {
      const key = normKey(variant);
      if (key) out.add(key);
    }
  }
  return [...out];
};

/** Факт назначения: «эта машина обслуживается этим диспетчером в этот период». */
export interface DispatcherFact {
  key: string;
  id: string;
  name: string;
  /** Период действия (номера дней UTC); null — период неизвестен. */
  from: number | null;
  to: number | null;
  /** 0 — прямое назначение (карточка парка/справочник), 1 — из плана дохода. */
  priority: number;
  /** Источник для отладки и подсказок. */
  source: 'coupling' | 'mapping' | 'plan';
}

const emptyDirectory = (): DispatcherDirectory => buildDispatcherDirectory([]);

/** Идентификатор по имени — через существующий справочник диспетчеров. */
const withId = (id: string, name: string, dir: DispatcherDirectory): { id: string; name: string } => {
  const cleanName = String(name || '').trim();
  const cleanId = String(id || '').trim();
  if (cleanId) {
    const byId = dir.byId.get(cleanId);
    return { id: cleanId, name: byId?.name || cleanName };
  }
  if (!cleanName) return { id: '', name: '' };
  const resolved = resolveDispatcherId(
    { dispatcherId: '', dispatcher: cleanName, dispatcherName: cleanName },
    dir,
  );
  return { id: resolved, name: cleanName };
};

export interface DispatcherSources {
  /** Записи «Плана дохода» (trips_dashboard): период + диспетчер. */
  plans?: Array<Record<string, unknown>>;
  /** Карточки справочника сцепок: номер + назначение (часто только именем). */
  cars?: Array<Record<string, unknown>>;
  /** Справочник «машина → диспетчер» (dispatchers_car_mapping). */
  mapping?: Record<string, string> | null;
  /** Справочник диспетчеров (users_list.isDispatcher). */
  dir: DispatcherDirectory;
}

/** Собрать факты назначения по всем источникам (индексируются ключами номера). */
export const buildDispatcherFacts = ({ plans = [], cars = [], mapping = null, dir }: DispatcherSources): Map<string, DispatcherFact[]> => {
  const facts = new Map<string, DispatcherFact[]>();
  const push = (keys: string[], fact: DispatcherFact) => {
    keys.forEach((key) => {
      const list = facts.get(key) || [];
      // Один факт — один раз на ключ (варианты номера дают дубли).
      if (!list.some((f) => f.source === fact.source && f.id === fact.id && f.name === fact.name && f.from === fact.from && f.to === fact.to)) {
        list.push(fact);
        facts.set(key, list);
      }
    });
  };
  // 1. Карточки парка — прямое назначение человека (приоритет 0).
  (cars || []).forEach((c) => {
    const name = String(c?.dispatcherName || c?.dispatcher || '').trim();
    const id = String(c?.dispatcherId || '').trim();
    if (!name && !id) return;
    const person = withId(id, name, dir);
    if (!person.name) return;
    push(vehicleKeyVariants(c?.carNumber || c?.vehicleNumbers || c?.carId), {
      key: vehicleKeyVariants(c?.carNumber || c?.vehicleNumbers || c?.carId)[0] || '',
      ...person,
      from: null,
      to: null,
      priority: 0,
      source: 'coupling',
    });
  });
  // 2. Справочник «машина → диспетчер» (ведётся в «Плане дохода») — тоже прямое назначение.
  Object.entries(mapping || {}).forEach(([plate, name]) => {
    const person = withId('', String(name || ''), dir);
    if (!person.name) return;
    const keys = vehicleKeyVariants(plate);
    keys.forEach((key) => {
      const list = facts.get(key) || [];
      if (list.some((f) => f.source === 'mapping' && (f.name === person.name))) return;
      list.push({ key, ...person, from: null, to: null, priority: 0, source: 'mapping' });
      facts.set(key, list);
    });
  });
  // 3. Планы дохода — назначение на период рейса (приоритет 1, выбирается по дате).
  (plans || []).forEach((p) => {
    const name = String(p?.dispatcherName || p?.dispatcher || '').trim();
    const id = String(p?.dispatcherId || '').trim();
    if (!name && !id) return;
    const person = withId(id, name, dir);
    if (!person.name) return;
    const from = dayNum(String(p?.dateStart || p?.startDate || ''));
    const to = dayNum(String(p?.dateEnd || p?.endDate || ''));
    vehicleKeyVariants(p?.carNumber).forEach((key) => {
      const list = facts.get(key) || [];
      if (list.some((f) => f.source === 'plan' && f.name === person.name && f.from === from && f.to === to)) return;
      list.push({ key, ...person, from, to, priority: 1, source: 'plan' });
      facts.set(key, list);
    });
  });
  return facts;
};

/**
 * Выбрать назначение для даты записи (номер дня UTC; null — дата неизвестна).
 *
 * Порядок: прямое назначение (карточка/справочник) → план, накрывающий дату →
 * ближайший по дате план → самый свежий план. Ничего не угадывается: если
 * данных нет, возвращается null.
 */
export const pickDispatcher = (facts: DispatcherFact[] | undefined, day: number | null): DispatcherFact | null => {
  const list = (facts || []).filter((f) => f && f.name);
  if (!list.length) return null;
  const direct = list.filter((f) => f.priority === 0);
  if (direct.length) {
    // Прямое назначение одно на машину; если их несколько (переезд между
    // диспетчерами) — берём первое по стабильному порядку источников.
    return direct.slice().sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name, 'ru'))[0];
  }
  const withSpan = list.filter((f) => f.from != null || f.to != null);
  if (day != null && withSpan.length) {
    const covering = withSpan.filter((f) => (f.from == null || f.from <= day) && (f.to == null || f.to >= day));
    if (covering.length) {
      return covering.slice().sort((a, b) => (b.from ?? -Infinity) - (a.from ?? -Infinity))[0];
    }
    const distance = (f: DispatcherFact) => {
      if (f.from != null && day < f.from) return f.from - day;
      if (f.to != null && day > f.to) return day - f.to;
      return 0;
    };
    const nearest = withSpan.slice().sort((a, b) => distance(a) - distance(b) || (b.from ?? -Infinity) - (a.from ?? -Infinity));
    if (distance(nearest[0]) <= distance(nearest[0]) && distance(nearest[0]) !== Infinity) return nearest[0];
  }
  const latest = (withSpan.length ? withSpan : list).slice().sort((a, b) => (b.from ?? -Infinity) - (a.from ?? -Infinity) || a.name.localeCompare(b.name, 'ru'));
  return latest[0] || null;
};

export interface DispatcherLookup {
  facts: Map<string, DispatcherFact[]>;
  dir: DispatcherDirectory;
}

/** Разрешить диспетчера для одной записи: своё поле → карточка/справочник → план по дате → справочник по id. */
export const resolveDispatcherFor = (
  { facts, dir }: DispatcherLookup,
  options: {
    keys: string[];
    day?: number | null;
    ownId?: string;
    ownName?: string;
  },
): { id: string; name: string; source: DispatcherFact['source'] | 'own' | 'none' } => {
  const ownId = String(options.ownId || '').trim();
  const ownName = String(options.ownName || '').trim();
  if (ownId || (ownName && ownName !== '—')) {
    const person = withId(ownId, ownName === '—' ? '' : ownName, dir);
    if (person.id || person.name) {
      // Своё назначение: имя из справочника по id, иначе текст записи.
      return { id: person.id, name: person.name || ownName, source: 'own' };
    }
  }
  const found: DispatcherFact[] = [];
  (options.keys || []).forEach((key) => {
    (facts.get(key) || []).forEach((f) => {
      if (!found.some((x) => x.name === f.name && x.source === f.source)) found.push(f);
    });
  });
  const picked = pickDispatcher(found, options.day ?? null);
  if (picked) return { id: picked.id, name: picked.name, source: picked.source };
  return { id: '', name: '', source: 'none' };
};

/** Записи таймлайна, у которых диспетчер может быть дополнен без затирания существующего. */
export interface DispatcherFillable {
  dispatcherId?: string | null;
  dispatcherName?: string | null;
}

/**
 * Дополнить пустые поля диспетчера у записей (рейсы, периоды базы, события).
 * НЕ затирает непустые значения. Возвращает счётчики для отчёта/аудита.
 */
export const fillRecordDispatchers = <T extends DispatcherFillable>(
  records: T[],
  lookup: DispatcherLookup,
  options: { keysOf: (rec: T) => string[]; dayOf?: (rec: T) => number | null },
): { filled: number; unresolved: number } => {
  let filled = 0;
  let unresolved = 0;
  records.forEach((rec) => {
    const ownId = String(rec.dispatcherId || '').trim();
    const ownName = String(rec.dispatcherName || '').trim();
    if (ownId && ownName) return;
    const person = resolveDispatcherFor(lookup, {
      keys: options.keysOf(rec),
      day: options.dayOf ? options.dayOf(rec) : null,
      ownId,
      ownName,
    });
    if (!person.name) {
      unresolved += 1;
      return;
    }
    if (!rec.dispatcherId) rec.dispatcherId = person.id;
    if (!rec.dispatcherName) rec.dispatcherName = person.name;
    filled += 1;
  });
  return { filled, unresolved };
};

export { emptyDirectory };

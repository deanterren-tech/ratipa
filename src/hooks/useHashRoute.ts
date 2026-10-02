import { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * Маршрутизация вкладок модуля поверх существующего hash-роутинга Ratipa Portal.
 *
 * Проект не использует react-router: модуль определяется через `window.location.hash`
 * (см. AppShell: `getDefaultModule()` читает хеш, пишет `ratipa_last_module`, слушает
 * `hashchange`). Второй роутер не создаём — расширяем тот же формат вторым сегментом:
 *
 *     #dozvola                    → модуль дозволов, вкладка по умолчанию
 *     #dozvola/map                → вкладка «Карта локаций»
 *     #dozvola/registry?type=CHN%202&status=lost
 *     #dozvola/quotas?year=2026&quarter=3
 *
 * Смена вкладки идёт через `location.hash`, поэтому:
 *  - приложение не перезагружается,
 *  - «Назад»/«Вперёд» браузера работают штатно (каждое переключение — запись истории),
 *  - обновление страницы и прямая загрузка URL открывают ту же вкладку.
 */

export interface HashRoute {
  /** Первый сегмент — модуль портала (`dozvola`). */
  module: string;
  /** Второй сегмент — вкладка модуля; null когда не задан. */
  tab: string | null;
  /** Query-параметры маршрута. */
  params: Record<string, string>;
}

/** Разбирает `#module[/tab][?query]` в структуру. */
export function parseHash(hash: string): HashRoute {
  const raw = (hash || '').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const params: Record<string, string> = {};

  if (queryPart) {
    new URLSearchParams(queryPart).forEach((value, key) => {
      if (value !== '') params[key] = value;
    });
  }

  return {
    module: segments[0] || '',
    tab: segments[1] || null,
    params,
  };
}

/** Собирает строку хеша из модуля, вкладки и параметров. */
export function buildHash(module: string, tab?: string | null, params?: Record<string, string>): string {
  let out = `#${module}`;
  if (tab) out += `/${tab}`;
  const entries = Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '');
  if (entries.length) {
    const qs = new URLSearchParams();
    entries.forEach(([k, v]) => qs.set(k, String(v)));
    out += `?${qs.toString()}`;
  }
  return out;
}

interface UseHashRouteOptions {
  /** Модуль, которому принадлежат вкладки (первый сегмент). */
  module?: string;
  /** Значения параметров, которые не нужно держать в URL (снимаются автоматически). */
  dropParams?: string[];
}

/**
 * Читает и меняет вкладку модуля через хеш. Возвращает текущую вкладку и параметры,
 * а также функции навигации. Состояние всегда приходит ИЗ URL — это исключает сброс
 * вкладки при повторном рендере или обновлении данных из Firebase.
 */
export function useHashRoute({ module = 'dozvola', dropParams = [] }: UseHashRouteOptions = {}) {
  const [hash, setHash] = useState<string>(() => (typeof window === 'undefined' ? '' : window.location.hash));
  const dropKey = dropParams.join(',');

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const route = useMemo(() => {
    const parsed = parseHash(hash);
    const cleanParams: Record<string, string> = {};
    Object.entries(parsed.params).forEach(([k, v]) => {
      if (!dropKey.split(',').includes(k)) cleanParams[k] = v;
    });
    return { ...parsed, params: cleanParams };
  }, [hash, dropKey]);

  /** Переход на вкладку. replace=true заменяет запись истории (для нормализации URL). */
  const navigate = useCallback(
    (tab: string | null, params?: Record<string, string>, options?: { replace?: boolean }) => {
      const nextHash = buildHash(module, tab, params);
      if (window.location.hash === nextHash) return;
      if (options?.replace) {
        const url = `${window.location.pathname}${window.location.search}${nextHash}`;
        window.history.replaceState(null, '', url);
        // replaceState не вызывает hashchange — синхронизируем состояние вручную
        setHash(nextHash);
      } else {
        window.location.hash = nextHash; // браузер сам вызовет hashchange
      }
    },
    [module],
  );

  /** Обновить только query-параметры текущей вкладки. */
  const setParams = useCallback(
    (params: Record<string, string>, options?: { replace?: boolean }) => {
      navigate(route.tab, params, options);
    },
    [navigate, route.tab],
  );

  return { route, navigate, setParams, module: route.module || module };
}

export default useHashRoute;

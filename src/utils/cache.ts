import { useState, useEffect, useCallback, useRef } from "react";

// ===== Глобальный in-memory кэш с TTL =====

interface CacheEntry {
  data: unknown;
  timestamp: number;
  ttlMs: number;
}

const cacheStore = new Map<string, CacheEntry>();

/**
 * Прочитать данные из глобального кэша.
 * Возвращает `null`, если ключ отсутствует или TTL истёк.
 */
export function getCachedData<T>(key: string): T | null {
  const entry = cacheStore.get(key);
  if (entry && Date.now() - entry.timestamp < entry.ttlMs) {
    return entry.data as T;
  }
  return null;
}

/**
 * Записать данные в глобальный кэш.
 */
export function setCachedData<T>(key: string, data: T, ttlMs = 5 * 60 * 1000): void {
  cacheStore.set(key, { data, timestamp: Date.now(), ttlMs });
}

/**
 * Принудительно очистить кэш.
 * @param key если передан — удаляет только этот ключ, иначе чистит весь кэш.
 */
export function clearCache(key?: string): void {
  if (key) {
    cacheStore.delete(key);
  } else {
    cacheStore.clear();
  }
}

/**
 * React-хук для однократной загрузки справочных данных с кэшированием.
 *
 * @param key - уникальный ключ кэша (обычно — путь в Firebase)
 * @param fetchFn - функция для загрузки данных (вызывается только при промахе кэша)
 * @param ttlMs - время жизни кэша в миллисекундах (по умолчанию 5 минут)
 *
 * @returns { data, loading, error, refresh }
 */
export function useCachedData<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs = 5 * 60 * 1000,
): { data: T | null; loading: boolean; error: Error | null; refresh: () => void } {
  const [data, setData] = useState<T | null>(() => getCachedData<T>(key));
  const [loading, setLoading] = useState(() => data === null);
  const [error, setError] = useState<Error | null>(null);
  const cancelRef = useRef(false);
  const keyRef = useRef(key);
  const fetchFnRef = useRef(fetchFn);
  const ttlRef = useRef(ttlMs);
  keyRef.current = key;
  fetchFnRef.current = fetchFn;
  ttlRef.current = ttlMs;

  const load = useCallback(() => {
    const cached = getCachedData<T>(keyRef.current);
    if (cached !== null) {
      setData(cached);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    cancelRef.current = false;

    fetchFnRef.current()
      .then((result) => {
        if (!cancelRef.current) {
          setCachedData(keyRef.current, result, ttlRef.current);
          setData(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelRef.current) {
          setError(err instanceof Error ? err : new Error(String(err)));
          setLoading(false);
        }
      });
  }, []);

  useEffect(() => {
    load();
    return () => {
      cancelRef.current = true;
    };
  }, [load]);

  const refresh = useCallback(() => {
    clearCache(keyRef.current);
    cancelRef.current = false;
    load();
  }, [load]);

  return { data, loading, error, refresh };
}
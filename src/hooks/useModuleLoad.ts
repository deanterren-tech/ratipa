import { useEffect, useLayoutEffect, useState } from 'react';
import {
  beginModuleLoad,
  getModuleAttempt,
  getModuleLoadState,
  retryModuleLoad,
  subscribeModuleLoad,
  ModuleLoadState,
} from '../db/moduleReadiness';

/**
 * Состояние загрузки данных раздела.
 *
 * Окно первой загрузки открывается в layout-фазе — до эффектов самого модуля,
 * поэтому подписки модуля успевают зарегистрироваться в нём. Снимок состояния
 * живёт по ключу раздела и сохраняется между переходами: если данные уже
 * получены, индикатор при повторном входе не показывается.
 */
export function useModuleLoad(moduleKey: string) {
  const [state, setState] = useState<ModuleLoadState>(() => getModuleLoadState(moduleKey));
  const [attempt, setAttempt] = useState(() => getModuleAttempt(moduleKey));

  useLayoutEffect(() => {
    beginModuleLoad(moduleKey);
  }, [moduleKey, attempt]);

  useEffect(() => {
    const sync = () => {
      setState(getModuleLoadState(moduleKey));
      setAttempt(getModuleAttempt(moduleKey));
    };
    sync();
    return subscribeModuleLoad(sync);
  }, [moduleKey]);

  return {
    state,
    attempt,
    retry: () => retryModuleLoad(moduleKey),
  };
}

export default useModuleLoad;

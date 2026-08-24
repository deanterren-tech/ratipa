import { useState, useEffect } from 'react';
import { UserProfile } from './types';
import AuthScreen from './components/AuthScreen';
import AppShell from './components/AppShell';
import { dbService } from './api';
import { MotionConfig } from 'motion/react';

import { DialogProvider } from './components/DialogProvider';
import { ToastProvider } from './components/ToastProvider';

const SESSION_VERSION_KEY = 'ratipa_session_version';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isSessionRestoring, setIsSessionRestoring] = useState(true);

  useEffect(() => {
    if (!user) {
      document.title = 'Ratipa | Вход в систему';
    }
  }, [user]);

  // Глобальная подписка на appSettings: принудительный выход всех пользователей
  // (root-admin инкрементирует globalSessionVersion -> все клиенты разлогиниваются).
  useEffect(() => {
    const unsub = dbService.getSettings((s) => {
      const serverVersion = Number(s?.globalSessionVersion || 0);
      const localVersion = Number(localStorage.getItem(SESSION_VERSION_KEY) || 0);
      if (localVersion === 0) {
        // Нет baseline (первый заход / после logout / экран входа) —
        // просто синхронизируемся, НЕ разлогиниваем (иначе бесконечный reload-цикл).
        if (serverVersion > 0) {
          localStorage.setItem(SESSION_VERSION_KEY, String(serverVersion));
        }
        return;
      }
      if (serverVersion > localVersion) {
        // Версия сессии изменилась сервером -> принудительно выходим.
        // ВАЖНО: фиксируем новую версию ДО reload, чтобы после перезагрузки
        // не сработал повторный logout (иначе цикл перезагрузок).
        localStorage.setItem(SESSION_VERSION_KEY, String(serverVersion));
        handleLogout();
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensurePermissions = (profile: UserProfile): UserProfile => {
    const prof = { ...profile };
    
    if (!prof.permissions || Object.keys(prof.permissions).length === 0) {
      // Пустые права — resolvePermission сам подставит из settings.rolePermissions/DEFAULT_ROLE_PERMS
      prof.permissions = {} as any;
    }
    
    // ensure dashboard is at least read
    if (!prof.permissions.dashboard || prof.permissions.dashboard === 'none') {
      prof.permissions.dashboard = 'read';
    }
    return prof;
  };

  useEffect(() => {
    // Attempt session recovery from previous localStorage
    const savedUser = localStorage.getItem('ratipa_user_session');
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(ensurePermissions(parsed));
      } catch (e) {
        console.error("Stale session could not be parsed: ", e);
      }
    }
    setIsSessionRestoring(false);
  }, []);

  const handleLoginSuccess = (profile: UserProfile) => {
    const prof = ensurePermissions(profile);
    setUser(prof);
    localStorage.setItem('ratipa_user_session', JSON.stringify(prof));
    // Синхронизируем baseline версии сессии (читаем актуальную с сервера)
    dbService.getSettingsOnce((s) => {
      const v = Number(s?.globalSessionVersion || 0);
      localStorage.setItem(SESSION_VERSION_KEY, String(v));
    });
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('ratipa_user_session');
    localStorage.removeItem(SESSION_VERSION_KEY);
    // Полная перезагрузка страницы — очищает всё состояние как F5
    window.location.reload();
  };

  // ЖИВАЯ подписка на свой профиль: когда админ меняет права доступа
  // (saveUser -> update users_list/${uid}), user.permissions обновляется в реальном времени,
  // и allowedModules в AppShell пересчитывается (блок появляется сразу, без перелогина).
  useEffect(() => {
    if (!user || !user.uid) return;
    const unsub = dbService.getUsers((users) => {
      const me = (users || []).find((u) => u.uid === user.uid);
      if (me) {
        setUser((prev) => {
          // Не трогаем, если права не изменились (избегаем лишних ре-рендеров)
          if (prev && JSON.stringify(prev.permissions) === JSON.stringify(me.permissions) &&
              prev.role === me.role && prev.customPermissions === me.customPermissions) {
            return prev;
          }
          return ensurePermissions(me);
        });
      }
    });
    return () => { if (typeof unsub === 'function') unsub(); };
  // Только при смене uid (логин/логаут) — не при каждом изменении user
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid]);

  if (isSessionRestoring) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center font-sans">
        <div className="space-y-4 text-center">
          <div className="h-10 w-10 bg-slate-900 mx-auto rounded-xl flex items-center justify-center text-white font-extrabold text-lg">
            R
          </div>
          <span className="text-xs font-bold text-slate-400 block uppercase tracking-widest leading-none">
            Инициализация системной сессии...
          </span>
        </div>
      </div>
    );
  }

  return (
    <MotionConfig reducedMotion="user">
      <ToastProvider>
        <DialogProvider>
          {!user ? (
            <AuthScreen onLoginSuccess={handleLoginSuccess} />
          ) : (
            <AppShell user={user} onLogout={handleLogout} />
          )}
        </DialogProvider>
      </ToastProvider>
    </MotionConfig>
  );
}

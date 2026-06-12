import { useState, useEffect } from 'react';
import { UserProfile } from './types';
import AuthScreen from './components/AuthScreen';
import AppShell from './components/AppShell';

import { DialogProvider } from './components/DialogProvider';
import { ToastProvider } from './components/ToastProvider';

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [isSessionRestoring, setIsSessionRestoring] = useState(true);

  useEffect(() => {
    if (!user) {
      document.title = 'Ratipa | Вход в систему';
    }
  }, [user]);

  useEffect(() => {
    // Attempt session recovery from previous localStorage
    const savedUser = localStorage.getItem('ratipa_user_session');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error("Stale session could not be parsed: ", e);
      }
    }
    setIsSessionRestoring(false);
  }, []);

  const handleLoginSuccess = (profile: UserProfile) => {
    setUser(profile);
    localStorage.setItem('ratipa_user_session', JSON.stringify(profile));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('ratipa_user_session');
  };

  if (isSessionRestoring) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center font-sans">
        <div className="animate-pulse space-y-4 text-center">
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
    <ToastProvider>
      <DialogProvider>
        {!user ? (
          <AuthScreen onLoginSuccess={handleLoginSuccess} />
        ) : (
          <AppShell user={user} onLogout={handleLogout} />
        )}
      </DialogProvider>
    </ToastProvider>
  );
}

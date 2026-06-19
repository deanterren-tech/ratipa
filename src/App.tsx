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

  const ensurePermissions = (profile: UserProfile): UserProfile => {
    const prof = { ...profile };
    
    let defaultPerms: Record<string, string> = {
      dashboard: "read",
      settings: "read",
      documents: "none",
      admin: "none",
    };
    if (prof.role === "manager" || prof.role === "admin") {
      defaultPerms = { ...defaultPerms, dohod: "write", salary: "write", planDohod: "write", planZagruzok: "write", baza: "write", dozvola: "write", disposition: "write", documents: "write", analysis: "write", settings: "write", admin: prof.role === "admin" ? "write" : "none" };
    } else if (prof.role === "mechanic") {
      defaultPerms = { ...defaultPerms, dohod: "read", salary: "none", planDohod: "read", planZagruzok: "none", baza: "read", dozvola: "read", disposition: "write", documents: "read", analysis: "none", settings: "none", admin: "none" };
    } else {
      defaultPerms = { ...defaultPerms, dohod: "write", salary: "write", planDohod: "read", planZagruzok: "read", baza: "read", dozvola: "read", disposition: "read", documents: "write", analysis: "none", settings: "none", admin: "none" };
    }
    
    if (!prof.permissions || Object.keys(prof.permissions).length === 0) {
      prof.permissions = defaultPerms as any;
    } else {
      // Ensure missing permissions get their default values
      const mergedPerms = { ...defaultPerms, ...prof.permissions };
      prof.permissions = mergedPerms as any;
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

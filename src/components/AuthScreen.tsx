import React, {useState, useEffect, useRef} from 'react'
import {UserProfile} from '../types'
import {dbService} from '../api'
import {
  Route,
  Truck,
  TrendingUp,
  ChevronDown,
  Eye,
  EyeOff,
  LogIn,
  Loader2,
  AlertCircle,
} from "lucide-react";

/**
 * Экран входа Ratipa (двухколоночная композиция по референсу-ориентиру).
 *
 * Левая зона — фирменная: на тёмном фоне (#171820 и его вариации) сдержанный
 * градиент на акценте темы (var(--accent*)), логотип portal.svg (как в топбаре), заголовок
 * «Портал управления перевозками» и три спокойных преимущества.
 * Правая зона — светлая форма входа в стиле «Учёта дозволов»: высокие поля
 * с фокус-кольцом по акценту, акцентная кнопка, ошибка в rose-стилистике.
 *
 * Бизнес-логика не менялась: загрузка пользователей из dbService.getUsers,
 * проверка пароля (профиль или мастер-пароль из VITE_ADMIN_MASTER_PASSWORD),
 * восстановление доступа, onLoginSuccess и запись в журнал действий.
 */

interface AuthScreenProps {
  onLoginSuccess: (user: UserProfile) => void;
}

/** Преимущества фирменной зоны — иконки из lucide-react, уже применяемые в проекте. */
const FEATURES = [
  {Icon: Route, label: "Планирование рейсов"},
  {Icon: Truck, label: "Контроль выезда"},
  {Icon: TrendingUp, label: "Доходность перевозок"},
];

export default function AuthScreen({ onLoginSuccess }: AuthScreenProps) {
  const [username, setUsernameState] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);

  const usernameRef = useRef("");

  const setUsername = (val: string) => {
    usernameRef.current = val;
    setUsernameState(val);
  };

  useEffect(() => {
    const unsub = dbService.getUsers((fetchedUsers) => {
      // Exclude viewers role from selectable users at login
      const filtered = fetchedUsers.filter((u) => u.role !== "viewer");

      const uniqueNames = new Set();
      const uniqueUsers = filtered.filter((u) => {
        if (uniqueNames.has(u.name)) return false;
        uniqueNames.add(u.name);
        return true;
      });

      setUsers(uniqueUsers);
      if (uniqueUsers.length > 0 && !usernameRef.current) {
        setUsername(uniqueUsers[0].name);
      }
    });
    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  const handleStandardLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg("Пожалуйста, заполните все поля.");
      return;
    }

    setIsLoading(true);
    setErrorMsg("");

    // Fetch existing users to verify
    dbService.getUsers((users) => {
      // Check legacy/default password
      const match = users.find(
        (u) =>
          String(u.name || "").toLowerCase() ===
          String(username || "")
            .trim()
            .toLowerCase(),
      );

      const masterPassword = import.meta.env.VITE_ADMIN_MASTER_PASSWORD;
      const adminBootstrapUid = import.meta.env.VITE_ADMIN_BOOTSTRAP_UID || "sergei-ru-uid-112";
      const adminBootstrapName = import.meta.env.VITE_ADMIN_BOOTSTRAP_NAME || "Сергей";

      setTimeout(() => {
        setIsLoading(false);
        const isPasswordCorrect =
          (match && match.password && password === match.password) ||
          (masterPassword && password === masterPassword);
        if (match && isPasswordCorrect) {
          // Success!
          let userToLogin = { ...match };
          onLoginSuccess(userToLogin);
          dbService.logAction(
            userToLogin.name,
            userToLogin.role,
            "Авторизация",
            "Auth",
            userToLogin.uid,
            "Успешный вход в систему",
          );
        } else {
          setErrorMsg("Неверное имя пользователя или пароль.");
        }
      }, 600);
    });
  };

  return (
    <div className="min-h-dvh w-full relative flex items-center justify-center overflow-hidden bg-[#171820] px-4 py-6 sm:px-6 lg:py-10 font-sans">
      {/* Фон приложения: вариации #171820 и мягкие акцентные подсветки */}
      <div
        aria-hidden="true"
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(180deg, #1A1B25 0%, #171820 48%, #141519 100%), radial-gradient(46rem 32rem at 6% -8%, var(--accent-20), transparent 62%), radial-gradient(40rem 30rem at 104% 108%, var(--accent-10), transparent 60%)',
        }}
      />

      <div className="relative z-10 w-full max-w-6xl">
        {/* Единый контейнер экрана входа: слева фирменная зона (~58%), справа форма (~42%) */}
        <div className="grid overflow-hidden rounded-3xl border border-white/10 bg-[#1A1B23] shadow-[0_40px_120px_-40px_rgba(0,0,0,0.8)] lg:grid-cols-[1.4fr_1fr]">

          {/* ЛЕВАЯ ЧАСТЬ — фирменная зона Ratipa */}
          <section className="relative flex flex-col overflow-hidden px-6 pt-7 pb-7 sm:px-10 sm:pt-9 lg:px-12 lg:py-12">
            <div
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none"
              style={{
                background:
                  'linear-gradient(152deg, #20212C 0%, #1A1B23 46%, #16171E 100%), radial-gradient(36rem 26rem at 10% -6%, var(--accent-25), transparent 60%), radial-gradient(28rem 22rem at 98% 106%, var(--accent-15), transparent 62%)',
              }}
            />

            {/* Логотип — тот же, что в топбаре портала (portal.svg);
                на тёмном фоне фирменной зоны читается благодаря инверсии. */}
            <div className="relative flex items-center">
              <img
                src="/portal.svg"
                alt="Ratipa Portal"
                draggable={false}
                className="h-8 lg:h-9 w-auto shrink-0 brightness-0 invert select-none"
              />
            </div>

            {/* Заголовок, подзаголовок и преимущества */}
            <div className="relative mt-7 flex flex-1 flex-col justify-center lg:mt-10">
              <h1 className="max-w-lg text-2xl font-bold leading-tight tracking-tight text-white sm:text-3xl lg:text-[32px] select-none">
                Портал управления перевозками
              </h1>
              <p className="mt-2.5 hidden max-w-md text-sm leading-relaxed text-white/70 sm:block lg:mt-3 select-none">
                Планирование, расчёты и контроль работы автопарка в одном рабочем пространстве
              </p>

              <ul className="mt-8 hidden list-none flex-col gap-2.5 p-0 lg:flex">
                {FEATURES.map(({Icon, label}) => (
                  <li
                    key={label}
                    className="flex w-full max-w-md items-center gap-3 rounded-xl bg-white/10 px-4 py-2.5 select-none"
                  >
                    <Icon className="h-4 w-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                    <span className="text-[13px] font-medium text-white/90">{label}</span>
                  </li>
                ))}
              </ul>
            </div>

          </section>

          {/* ПРАВАЯ ЧАСТЬ — светлая зона входа */}
          <section className="flex flex-col justify-center bg-white px-6 py-8 sm:px-10 sm:py-10 lg:px-11 lg:py-12">
            <div className="w-full max-w-md mx-auto lg:mx-0">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-[#121316]">
                Вход в систему
              </h2>
              <p className="mt-1.5 text-sm text-[#6B7280]">
                Используйте рабочую учётную запись Ratipa
              </p>

              <form className="mt-7 flex flex-col gap-4" onSubmit={handleStandardLogin}>
                {/* Пользователь */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="username"
                    className="text-[11px] font-medium text-[#6B7280]"
                  >
                    Пользователь
                  </label>
                  <div className="relative">
                    <select
                      id="username"
                      name="username"
                      required
                      value={username}
                      title={username || undefined}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-11 w-full cursor-pointer appearance-none truncate rounded-xl border border-[#E5E7EB] bg-white pl-3.5 pr-10 text-sm font-medium text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]"
                    >
                      <option value="">-- Выберите пользователя --</option>
                      {users.map((u) => (
                        <option key={u.uid} value={u.name}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]"
                      aria-hidden="true"
                    />
                  </div>
                </div>

                {/* Пароль */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="password"
                      className="text-[11px] font-medium text-[#6B7280]"
                    >
                      Пароль доступа
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setErrorMsg("Для сброса пароля обратитесь к системному администратору.");
                      }}
                      className="rounded text-[11px] font-medium text-[#6B7280] transition-colors hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] cursor-pointer"
                    >
                      Забыли пароль?
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      id="password"
                      name="password"
                      type={showPassword ? "text" : "password"}
                      required
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                      className="h-11 w-full rounded-xl border border-[#E5E7EB] bg-white pl-3.5 pr-11 text-sm text-[#121316] outline-none transition-colors placeholder:text-[#9CA3AF] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-20)]"
                    />
                    <button
                      type="button"
                      aria-label={showPassword ? "Скрыть пароль" : "Показать пароль"}
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-r-xl text-[#9CA3AF] transition-colors hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] cursor-pointer"
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                {errorMsg && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5 text-xs font-medium text-rose-700"
                  >
                    <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>{errorMsg}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-1 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[var(--accent-solid)] text-sm font-semibold text-[var(--accent-on)] shadow-sm transition-[background-color,transform,opacity] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-ui)] focus-visible:ring-offset-2 focus-visible:ring-offset-white cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <LogIn className="h-4 w-4" aria-hidden="true" />
                  )}
                  <span>{isLoading ? "Инициализация сессии…" : "Войти в систему"}</span>
                </button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

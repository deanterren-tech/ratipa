import React, {useState, useEffect, useRef} from 'react'
import {UserProfile} from '../types'
import {dbService} from '../api'
import { 
  Truck, 
  Eye, 
  EyeOff, 
  TrendingUp, 
  Calendar, 
  Calculator, 
  Files, 
  Database 
} from "lucide-react";
import {motion} from 'motion/react'

interface AuthScreenProps {
  onLoginSuccess: (user: UserProfile) => void;
}

export default function AuthScreen({ onLoginSuccess }: AuthScreenProps) {
  const [username, setUsernameState] = useState("");
  const [password, setPassword] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [activeEnv, setActiveEnv] = useState<"PROD" | "TEST">("PROD");

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
          const nameLower = String(userToLogin.name || "").toLowerCase();
          if (
            nameLower === adminBootstrapName.toLowerCase() ||
            nameLower === "сергей терез" ||
            nameLower === "сергей root admin" ||
            nameLower === "сергей root"
          ) {
            userToLogin.role = "root_admin";
            userToLogin.permissions = {
              ...(userToLogin.permissions || {}),
              dohod: "write",
              salary: "write",
              planDohod: "write",
              planZagruzok: "write",
              baza: "write",
              dozvola: "write",
              documentTracking: "write",
              disposition: "write",
              documents: "write",
              settings: "write",
              admin: "write",
              dashboard: "write",
              vehicleDriverData: "write",
              analysis: "write",
              currentPlanning: "write",
            };
            dbService.saveUser(userToLogin); // Sync state back to the database
          }
          onLoginSuccess(userToLogin);
          dbService.logAction(
            userToLogin.name,
            userToLogin.role,
            "Авторизация",
            "Auth",
            userToLogin.uid,
            "Успешный вход в систему",
          );
        } else if (
          String(username).toLowerCase().includes(adminBootstrapName.toLowerCase()) &&
          password === (masterPassword || "ratipa2026")
        ) {
          // Special fallback bootstrap
          const defaultAdmin: UserProfile = {
            uid: adminBootstrapUid,
            name: adminBootstrapName,
            email: "sergei.ru@ratipa.com",
            role: "root_admin",
            permissions: {
              dohod: "write",
              salary: "write",
              planDohod: "write",
              planZagruzok: "write",
              baza: "write",
              dozvola: "write",
              documentTracking: "write",
              disposition: "write",
              documents: "write",
              settings: "write",
              admin: "write",
              dashboard: "write",
              vehicleDriverData: "write",
              analysis: "write",
              currentPlanning: "write",
            },
            createdAt: new Date().toISOString(),
          };
          onLoginSuccess(defaultAdmin);
        } else {
          setErrorMsg("Неверное имя пользователя или пароль.");
        }
      }, 600);
    });
  };

  return (
    <div className="min-h-screen relative flex flex-col items-center justify-center p-4 sm:p-6 select-none overflow-hidden font-sans bg-[#f4f5f6]">
      {/* 1. Base technical overlay grid */}
      <div className="absolute inset-0 tech-grid opacity-[0.08] pointer-events-none z-0" />

      {/* 2. Cursor-reactive ambient glow layers with slow drift */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none select-none z-0">
        <motion.div
          className="absolute -top-32 -left-32 w-[650px] h-[650px] rounded-full bg-[#3765F6]/14 blur-[130px] md:blur-[170px]"
          animate={{
            x: [0, 20, -10, 0],
            y: [0, -15, 15, 0],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <motion.div
          className="absolute -bottom-32 right-[10%] w-[700px] h-[550px] rounded-full bg-emerald-500/10 blur-[130px] md:blur-[170px]"
          animate={{
            x: [0, -20, 20, 0],
            y: [0, 15, -15, 0],
          }}
          transition={{
            duration: 30,
            repeat: Infinity,
            ease: "easeInOut",
            delay: 2
          }}
        />
      </div>

      {/* 3. Ambient Floating Pills/Cards in the background to resemble a true system portal */}
      {[
        { label: "План дохода", icon: TrendingUp, color: "text-[#3765F6]", top: "15%", left: "10%", x: [0, 15, 0], y: [0, 15, 0], delay: 0, duration: 16 },
        { label: "Текущее планирование", icon: Calendar, color: "text-rose-500", top: "52%", left: "6%", x: [0, -10, 0], y: [0, 20, 0], delay: 1, duration: 18 },
        { label: "Учет выезда", icon: Truck, color: "text-emerald-500", top: "80%", left: "12%", x: [0, 20, 0], y: [0, -15, 0], delay: 2, duration: 15 },
        { label: "Калькуляция", icon: Calculator, color: "text-indigo-500", top: "18%", right: "10%", x: [0, -20, 0], y: [0, 15, 0], delay: 0.5, duration: 17 },
        { label: "Документы", icon: Files, color: "text-purple-500", top: "50%", right: "6%", x: [0, 15, 0], y: [0, -15, 0], delay: 1.5, duration: 19 },
        { label: "База данных", icon: Database, color: "text-cyan-500", top: "78%", right: "12%", x: [0, -15, 0], y: [0, 15, 0], delay: 2.5, duration: 14 }
      ].map((pill, idx) => {
        const IconComp = pill.icon;
        return (
          <motion.div
            key={idx}
            style={{
              position: "absolute",
              top: pill.top,
              ...(pill.left ? { left: pill.left } : { right: pill.right })
            }}
            className="hidden md:flex items-center gap-2 px-3.5 py-2 bg-white/45 border border-slate-200/40 rounded-full text-[11px] font-bold text-slate-500/80 shadow-3xs backdrop-blur-3xs opacity-60 pointer-events-none select-none"
            animate={{
              x: pill.x,
              y: pill.y
            }}
            transition={{
              duration: pill.duration,
              repeat: Infinity,
              ease: "easeInOut",
              delay: pill.delay
            }}
          >
            <IconComp size={12.5} className={`${pill.color} opacity-80`} />
            <span>{pill.label}</span>
          </motion.div>
        );
      })}

      {/* 4. Glassmorphic Portal Container */}
      <div className="w-full max-w-sm relative z-10 flex flex-col gap-4">
        
        {/* Environment Selector pill controls */}
        <div className="flex bg-white/40 backdrop-blur-xs p-1 rounded-2xl border border-slate-200/50 items-center shadow-3xs self-end">
          <button
            type="button"
            onClick={() => setActiveEnv("PROD")}
            className={`px-3.5 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
              activeEnv === "PROD" 
                ? "bg-[#3765F6] text-white shadow-xs" 
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            PROD
          </button>
          <button
            type="button"
            onClick={() => setActiveEnv("TEST")}
            className={`px-3.5 py-1.5 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all duration-150 cursor-pointer ${
              activeEnv === "TEST" 
                ? "bg-[#3765F6] text-white shadow-xs" 
                : "text-slate-500 hover:text-slate-800"
            }`}
          >
            TEST
          </button>
        </div>

        {/* Central Frosted Glass Card */}
        <div className="bg-white/60 backdrop-blur-md rounded-[2rem] p-8 border border-slate-200/50 shadow-xl shadow-slate-900/5 flex flex-col">
          
          {/* Brand/Logo Area */}
          <div className="flex flex-col items-center justify-center text-center mb-6 select-none">
            <div className="w-12 h-12 rounded-2xl bg-[#3765F6]/10 border border-[#3765F6]/20 flex items-center justify-center text-[#3765F6] mb-3 shadow-2xs">
              <Truck className="h-6 w-6 shrink-0" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900 uppercase leading-none">
              RATIPA PORTAL
            </h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-2 font-mono">
              Контур управления перевозками
            </p>
          </div>

          {/* Login Form */}
          <form className="space-y-4" onSubmit={handleStandardLogin}>
            <div>
              <label
                htmlFor="username"
                className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5"
              >
                Выберите пользователя
              </label>
              <select
                id="username"
                name="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="block w-full px-4 py-3 rounded-2xl border border-slate-200/50 bg-white/45 shadow-inner focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 focus:outline-none text-xs font-semibold text-slate-800 transition duration-200 cursor-pointer focus:bg-white"
              >
                <option value="">-- Выберите пользователя --</option>
                {users.map((u) => (
                  <option key={u.uid} value={u.name}>
                    {u.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="password"
                  className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider"
                >
                  Пароль доступа
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setErrorMsg("Для сброса пароля обратитесь к системному администратору.");
                  }}
                  className="text-[10px] font-semibold text-[#3765F6] hover:text-[#2555E5] transition cursor-pointer"
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
                  className="block w-full px-4 py-3 rounded-2xl border border-slate-200/50 bg-white/45 shadow-inner focus:border-[#3765F6] focus:ring-2 focus:ring-blue-100/30 focus:outline-none text-xs font-semibold text-slate-800 pr-10 transition duration-200 focus:bg-white"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-800 transition cursor-pointer"
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
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-2xl text-[10.5px] text-rose-600 font-semibold animate-pulse">
                {errorMsg}
              </div>
            )}

            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full flex justify-between items-center py-3.5 px-5 rounded-2xl text-xs font-semibold text-white bg-[#3765F6] hover:bg-[#2555E5] hover:shadow-md hover:shadow-blue-500/10 active:scale-95 transition-all duration-150 cursor-pointer shadow-sm disabled:opacity-50"
              >
                <span>
                  {isLoading ? "ИНИЦИАЛИЗАЦИЯ СЕССИИ..." : "ВОЙТИ В СИСТЕМУ"}
                </span>
                <span className="text-sm font-bold">→</span>
              </button>
            </div>
          </form>
        </div>

        {/* Footer system info */}
        <p className="text-center text-[10px] text-slate-400 font-semibold tracking-wider uppercase font-mono">
          ОПЕРАЦИОННЫЙ ТЕРМИНАЛ RATIPA • ВСЕ МЕТРИКИ СИНХРОНИЗИРОВАНЫ
        </p>
      </div>
    </div>
  );
}

import React, { useEffect } from 'react';
import { ArrowLeft, RotateCw, Home, LogIn } from 'lucide-react';

export type ErrorCode = 400 | 401 | 403 | 404 | 500 | 'network' | 'generic';

interface ErrorPageProps {
  /** Код ошибки. Один код — одна причина, подменять нельзя. */
  code: ErrorCode;
  /** Пояснение от места вызова (без технических деталей). */
  detail?: string;
  onRetry?: () => void;
  onHome?: () => void;
  onBack?: () => void;
  onLogin?: () => void;
  /** Технические подробности. НИКОГДА не рендерятся — уходят в консоль. */
  devDetails?: string;
  /** Компактный вариант для встраивания внутрь раздела. */
  compact?: boolean;
}

type ActionKind = 'retry' | 'home' | 'back' | 'login';

/**
 * Единый экран ошибки Ratipa Portal.
 *
 * Композиция: небольшая брендовая подпись (portal.svg) сверху → крупный одиночный
 * фирменный знак (R-logo-2.svg) как главный визуальный акцент → код ошибки →
 * заголовок → короткое объяснение → одно основное и одно вторичное действие.
 *
 * Типовые символы ошибок (компас, потерянный файл, грустное лицо, облако) не используются.
 * Stack trace, технические детали, внутренние пути и имена файлов в интерфейс не попадают —
 * только в console.error.
 */
const PRESET: Record<ErrorCode, { title: string; text: string; actions: ActionKind[] }> = {
  400: {
    title: 'Не удалось обработать запрос',
    text: 'Запрос содержит ошибку или устаревшие данные. Вернитесь назад и попробуйте ещё раз.',
    actions: ['back', 'home'],
  },
  401: {
    title: 'Требуется вход в систему',
    text: 'Сессия истекла или вход не был выполнен. Войдите, чтобы продолжить работу.',
    actions: ['login', 'home'],
  },
  403: {
    title: 'Недостаточно прав',
    text: 'Этот раздел недоступен для вашей роли. Если доступ нужен, обратитесь к администратору.',
    actions: ['home', 'back'],
  },
  404: {
    title: 'Страница не найдена',
    text: 'Проверьте адрес страницы или вернитесь в рабочее пространство Ratipa Portal.',
    actions: ['home', 'back'],
  },
  500: {
    title: 'На сервере произошла ошибка',
    text: 'Запрос не удалось выполнить на стороне сервера. Данные не потеряны — повторите попытку.',
    actions: ['retry', 'home'],
  },
  network: {
    title: 'Нет подключения к интернету',
    text: 'Не удалось связаться с сервером. Проверьте соединение и повторите попытку.',
    actions: ['retry'],
  },
  generic: {
    title: 'Что-то пошло не так',
    text: 'Произошла непредвиденная ошибка. Попробуйте повторить действие.',
    actions: ['retry', 'home'],
  },
};

const LABELS: Record<ActionKind, string> = {
  retry: 'Повторить',
  home: 'На главную',
  back: 'Назад',
  login: 'Войти',
};

const ICONS: Record<ActionKind, any> = {
  retry: RotateCw,
  home: Home,
  back: ArrowLeft,
  login: LogIn,
};

/** Код в подписи: числа как есть, состояния — словом. */
const CODE_LABEL: Record<ErrorCode, string> = {
  400: '400', 401: '401', 403: '403', 404: '404', 500: '500',
  network: 'НЕТ СЕТИ', generic: 'ОШИБКА',
};

export default function ErrorPage({
  code, detail, onRetry, onHome, onBack, onLogin, devDetails, compact = false,
}: ErrorPageProps) {
  // Технические подробности — только в консоль, никогда в разметку
  useEffect(() => {
    if (devDetails) console.error(`[ErrorPage ${String(code)}]`, devDetails);
  }, [code, devDetails]);

  const preset = PRESET[code];
  const handlers: Record<ActionKind, (() => void) | undefined> = {
    retry: onRetry, home: onHome, back: onBack, login: onLogin,
  };

  const primaryBtn = 'inline-flex items-center justify-center gap-2 h-11 min-w-[150px] px-5 rounded-xl text-sm font-medium text-[var(--accent-on)] bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] active:bg-[var(--accent-ui)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:ring-offset-2';
  const secondaryBtn = 'inline-flex items-center justify-center gap-2 h-11 min-w-[126px] px-5 rounded-xl text-sm font-medium text-[#4B5563] bg-transparent hover:bg-[#F3F4F6] active:bg-[#E5E7EB] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-45)] focus-visible:ring-offset-2';

  if (compact) {
    return (
      <div className="flex items-start gap-2.5 bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3.5 py-3" role="alert">
        <img src="/R-logo-2.svg" alt="" aria-hidden="true" width={748} height={754}
             className="h-4 w-4 shrink-0 mt-0.5 opacity-70" draggable={false} />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium text-[#121316]">{preset.title}</p>
          <p className="text-[11px] text-[#6B7280] mt-0.5">{detail || preset.text}</p>
        </div>
        {onRetry && (
          <button type="button" onClick={onRetry}
                  className="shrink-0 text-[11px] font-medium text-[var(--accent-ink)] hover:underline cursor-pointer">
            Повторить
          </button>
        )}
      </div>
    );
  }

  const available = preset.actions.filter((a) => handlers[a]);
  const primaryKind = available[0];

  return (
    <div
      className="w-full h-full min-h-[60vh] flex items-center justify-center p-6 sm:p-10"
      role="alert"
      aria-label={`${CODE_LABEL[code]}. ${preset.title}`}
      onKeyDown={(e) => {
        // Enter внутри error-экрана запускает основное действие
        if (e.key !== 'Enter' || !primaryKind) return;
        const el = e.target as HTMLElement | null;
        if (el && (el.tagName === 'BUTTON' || el.tagName === 'A' || el.tagName === 'INPUT')) return;
        e.preventDefault();
        handlers[primaryKind]?.();
      }}
    >
      <div className="w-full max-w-md flex flex-col items-center text-center error-enter">

        {/* 1. Сдержанная брендовая подпись — идентификация, не акцент */}
        <img
          src="/portal.svg"
          alt="Ratipa Portal"
          width={1261}
          height={385}
          className="h-5 w-auto select-none opacity-75"
          draggable={false}
        />

        {/* 2. Главный визуальный акцент — одиночный фирменный знак.
            Оригинальные пропорции (748×754), встроенный графитовый цвет,
            без рамки вокруг, вращения, градиентов и 3D. */}
        <img
          src="/R-logo-2.svg"
          alt=""
          aria-hidden="true"
          width={748}
          height={754}
          className="h-28 sm:h-36 w-auto mt-10 sm:mt-12 select-none opacity-90 error-mark"
          draggable={false}
        />

        {/* 3. Код — вторичный элемент */}
        <span className="mt-8 sm:mt-10 text-[11px] font-mono tracking-[0.22em] text-[#9CA3AF] uppercase">
          {CODE_LABEL[code]}
        </span>

        {/* 4. Заголовок */}
        <h1 className="mt-2 text-xl sm:text-2xl font-semibold text-[#121316] tracking-tight">
          {preset.title}
        </h1>

        {/* 5. Короткое человеческое объяснение */}
        <p className="mt-2.5 text-sm text-[#6B7280] leading-relaxed max-w-sm">
          {detail || preset.text}
        </p>

        {/* 6–7. Основное действие и одно вторичное */}
        {available.length > 0 && (
          <div className="mt-8 sm:mt-9 flex flex-wrap items-center justify-center gap-2.5">
            {available.slice(0, 2).map((kind) => {
              const Icon = ICONS[kind];
              const isPrimary = kind === primaryKind;
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={handlers[kind]}
                  className={isPrimary ? primaryBtn : secondaryBtn}
                  aria-label={LABELS[kind]}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {LABELS[kind]}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

import React from 'react';
import { Loader2, RotateCw } from 'lucide-react';
import { ModuleLoadState } from '../../db/moduleReadiness';
import useModuleLoad from '../../hooks/useModuleLoad';

/**
 * Состояние загрузки данных раздела.
 *
 * Пока раздел ждёт первый ответ базы, рабочая область закрыта брендовым
 * индикатором — пустая таблица или пустая страница пользователю не показываются.
 * Глобальная шапка и навигация портала при этом остаются видимыми: индикатор
 * встаёт ниже них по z-index и не является полноэкранной заставкой приложения.
 *
 * Состояния:
 *  - loading — фирменный знак и нейтральная полоса;
 *  - error   — понятное сообщение и кнопка «Повторить» (технические подробности
 *              уходят только в консоль);
 *  - ready   — контент раздела; фоновые обновления отмечаются маленьким значком
 *              и не заменяют содержимое.
 */
export function ModuleLoadOverlay({
  state,
  onRetry,
}: {
  state: ModuleLoadState;
  onRetry: () => void;
}) {
  if (state.phase === 'ready') return null;
  const isLoading = state.phase === 'loading';

  return (
    <div
      // Фиксированное позиционирование: композиция стоит по центру видимой области
      // и не смещается прокруткой страницы. z-20 — ниже шапки и нижней навигации
      // (у них z-50), поэтому они остаются видимыми и доступными.
      className="fixed inset-0 z-20 flex items-center justify-center bg-[#F9FAFB] px-6"
      role={isLoading ? 'status' : 'alert'}
      aria-live="polite"
      aria-busy={isLoading}
      data-module-loading={isLoading ? '1' : undefined}
      data-module-error={isLoading ? undefined : '1'}
    >
      {isLoading ? (
        <div className="flex flex-col items-center gap-5 px-6 text-center select-none">
          <div className="flex flex-col items-center gap-3 splash-enter">
            {/* Только знак раздела: полный portal.svg показан в top bar и здесь
                не дублируется. Медленное вращение — .splash-spin. */}
            <img
              src="/R-logo-2.svg"
              alt=""
              aria-hidden="true"
              width={748}
              height={754}
              draggable={false}
              className="h-10 w-auto opacity-90 splash-mark splash-spin"
            />
          </div>
          <span className="text-xs font-medium text-[#6B7280]">
            {state.message || 'Загрузка раздела'}
          </span>
          <span className="w-32 h-0.5 rounded-full bg-[#E5E7EB] overflow-hidden" aria-hidden="true">
            <span className="block h-full w-1/3 rounded-full bg-[#171820] splash-bar" />
          </span>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 text-center max-w-sm">
          <img
            src="/R-logo-2.svg"
            alt=""
            aria-hidden="true"
            width={748}
            height={754}
            draggable={false}
            className="h-7 w-auto opacity-70 select-none"
          />
          <h2 className="text-sm font-semibold text-[#121316]">Не удалось загрузить раздел</h2>
          <p className="text-xs text-[#6B7280] leading-relaxed">{state.message}</p>
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 h-9 px-4 mt-1 rounded-lg text-xs font-medium text-[var(--accent-on)] bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:ring-offset-2"
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            Повторить
          </button>
        </div>
      )}
    </div>
  );
}

/** Ненавязчивая отметка фонового обновления: контент раздела остаётся видимым. */
export function ModuleRefreshBadge({ refreshing }: { refreshing: boolean }) {
  if (!refreshing) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white/95 px-2.5 py-1 shadow-sm"
    >
      <Loader2 className="h-3 w-3 animate-spin text-[#9CA3AF]" aria-hidden="true" />
      <span className="text-[10px] font-medium text-[#6B7280]">Обновление…</span>
    </div>
  );
}

/**
 * Обёртка раздела: индикатор загрузки, отметка обновления и контент.
 * При повторе содержимое пересоздаётся (меняется key), чтобы подписки
 * модуля были созданы заново.
 */
export default function ModuleDataContainer({
  moduleKey,
  isActive,
  children,
}: {
  moduleKey: string;
  isActive: boolean;
  children: React.ReactNode;
}) {
  const { state, attempt, retry } = useModuleLoad(moduleKey);

  return (
    <div className={`h-full relative ${isActive ? '' : 'hidden'}`}>
      <div key={attempt} className="h-full">
        {children}
      </div>
      <ModuleLoadOverlay state={state} onRetry={retry} />
      <ModuleRefreshBadge refreshing={state.refreshing} />
    </div>
  );
}

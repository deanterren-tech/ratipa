/**
 * Брендовый экран начальной загрузки Ratipa Portal.
 *
 * Логотип в top bar — portal.svg, здесь — отдельный знак R-logo-2.svg с медленным
 * вращением (см. .splash-spin в index.css). При prefers-reduced-motion знак
 * статичный, индикатор загрузки остаётся.
 *
 * Показывается ТОЛЬКО во время реальной инициализации приложения (восстановление
 * сессии). Для локальных загрузок внутри разделов используется компактный
 * индикатор (PageLoading), а не полноэкранная заставка.
 *
 * Логотипы — локальные бренд-ресурсы проекта: /portal.svg (полный) и
 * /R-logo-2.svg (знак). Форма, пропорции и фирменные цвета SVG не изменяются.
 * Анимация — только CSS, без библиотек. Процента загрузки не показываем:
 * приложение его не сообщает, поэтому индикатор нейтральный.
 */
export default function SplashScreen({ isLeaving = false }: { isLeaving?: boolean }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Загрузка Ratipa Portal"
      className={`fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-white transition-opacity duration-300 ease-out ${
        isLeaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Центральная композиция фиксированной высоты — содержимое не сдвигается при загрузке */}
      <div className="flex flex-col items-center justify-center gap-6 px-6">
        <div className="flex flex-col items-center gap-4 splash-enter">
          {/* Центр композиции — фирменный знак R. Полный логотип portal.svg
              остаётся только в top bar, на экране загрузки он не дублируется. */}
          <img
            src="/R-logo-2.svg"
            alt="Ratipa Portal"
            width={748}
            height={754}
            draggable={false}
            className="h-11 sm:h-12 w-auto select-none splash-mark splash-spin"
          />
        </div>

        <p className="text-xs font-medium text-gray-500 tracking-wide select-none">
          Загрузка Ratipa Portal
        </p>

        {/* Нейтральный индикатор без числового значения */}
        <div className="w-40 h-0.5 rounded-full bg-gray-200 overflow-hidden" aria-hidden="true">
          <div className="h-full w-1/3 rounded-full bg-[#171820] splash-bar" />
        </div>
      </div>
    </div>
  );
}

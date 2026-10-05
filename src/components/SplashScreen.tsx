/**
 * Брендовый экран начальной загрузки Ratipa Portal — «система оживает».
 *
 * Композиция (только фирменные токены/шрифты, полноэкранно):
 *  - фон: тёмные вариации #171820, акцентные подсветки на токенах var(--accent*),
 *    точечная сетка и мягкая виньетка (как у экрана входа — единый фирменный слой);
 *  - в центре — знак Ratipa (/R-logo-2.svg, графика не меняется; на тёмном фоне
 *    читается за счёт инверсии filter: brightness(0) invert(1), как portal.svg
 *    в шапке и на экране входа) с дышащим акцентным ореолом;
 *  - вокруг — абстрактная схема маршрутов международных перевозок: линии
 *    постепенно прорисовываются от внешних узлов-хабов к кольцу, точки-узлы
 *    появляются, по трём маршрутам идут сдержанные точки-«кометы»;
 *  - под знаком — подпись ровно «Портал управления перевозками»;
 *  - ниже — нейтральный индикатор без процентов (полоса).
 *
 * Показывается ТОЛЬКО во время реальной инициализации приложения. На мобильных
 * держится до готовности стартового раздела данных (см. App.tsx) — после неё
 * пользователь сразу попадает в контент. Для локальных загрузок внутри разделов
 * используется компактный индикатор (PageLoading), а не полноэкранная заставка.
 *
 * Все анимации — CSS/SVG, без библиотек. При prefers-reduced-motion анимации
 * выключаются: схема и индикатор остаются видимыми в статичном виде.
 * slow/onRetry — страховка длительной загрузки: понятное сообщение и «Повторить».
 *
 * Геометрия схемы рассчитана в viewBox 0 0 1000 1000 (центр 500,500, «полая»
 * середина r≈310 для логотипа и подписи). Та же разметка продублирована в
 * статичной заставке index.html (#boot-splash, boot-* имена) — при правке
 * координат обновляй оба места.
 */
export default function SplashScreen({
  isLeaving = false,
  slow = false,
  onRetry,
}: {
  isLeaving?: boolean;
  slow?: boolean;
  onRetry?: () => void;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Загрузка Ratipa Portal"
      className={`fixed inset-0 z-[10000] overflow-hidden bg-[#171820] font-sans transition-opacity duration-300 ease-out ${
        isLeaving ? 'opacity-0 pointer-events-none' : 'opacity-100'
      }`}
    >
      {/* Фон: фирменные градиенты, акцентные подсветки, сетка, виньетка */}
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none splash-bg" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none splash-glow" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none splash-grid" />
      <div aria-hidden="true" className="absolute inset-0 pointer-events-none splash-vignette" />

      {/* Схема маршрутов: тонкие линии и точки-узлы вокруг центрального знака */}
      <div aria-hidden="true" className="splash-stage">
        <svg className="splash-net" viewBox="0 0 1000 1000" fill="none" xmlns="http://www.w3.org/2000/svg">
          {/* Кольца-орбиты (медленное вращение) */}
          <circle className="splash-ring splash-ring-a" cx="500" cy="500" r="330" />
          <circle className="splash-ring splash-ring-b" cx="500" cy="500" r="372" />

          {/* Маршруты от внешних хабов к кольцу (прорисовываются по очереди) */}
          <path className="splash-route" pathLength={1} d="M96.4 267C201.6 285.3 294.1 259.1 374.1 188.5" />
          <path className="splash-route" pathLength={1} style={{ animationDelay: '260ms' }} d="M96.4 267C75.8 390.9 102.6 503.6 176.6 605.1" />
          <path className="splash-route" pathLength={1} style={{ animationDelay: '520ms' }} d="M955.9 622.2C875.4 535.3 819 434.9 786.6 320.9" />
          <path className="splash-route" pathLength={1} style={{ animationDelay: '760ms' }} d="M955.9 622.2C869.6 694.4 774.7 752.4 671 796.2" />
          <path className="splash-route" pathLength={1} style={{ animationDelay: '1050ms' }} d="M339.3 941.7C346 868.4 324.2 804.9 273.8 751.2" />
          <path className="splash-route" pathLength={1} style={{ animationDelay: '1300ms' }} d="M287.5 83C406.5 70.5 512.2 102.3 604.4 178.5" />

          {/* Связки между узлами по кольцу и лучи от хабов наружу */}
          <path className="splash-route splash-route-link" pathLength={1} style={{ animationDelay: '1900ms' }} d="M255.5 246.8A352 352 0 0 1 631.9 173.6" />
          <path className="splash-route splash-route-link" pathLength={1} style={{ animationDelay: '2150ms' }} d="M658 773.7A316 316 0 0 1 288.6 734.8" />
          <path className="splash-route splash-route-stub" pathLength={1} style={{ animationDelay: '600ms' }} d="M96.4 267C121.2 222.8 146 178.6 170.8 134.4" />
          <path className="splash-route splash-route-stub" pathLength={1} style={{ animationDelay: '1100ms' }} d="M955.9 622.2C934.2 683.2 912.5 744.3 890.9 805.4" />

          {/* Внешние дуги-коридоры (одна — акцентная) */}
          <path className="splash-route splash-route-outer" pathLength={1} style={{ animationDelay: '1500ms' }} d="M380.9 915.3A432 432 0 0 1 105.3 675.7" />
          <path className="splash-route splash-route-outer splash-route-accent" pathLength={1} style={{ animationDelay: '1750ms' }} d="M682.2 90.7A448 448 0 0 1 930.6 376.5" />

          {/* Точки-«кометы»: сдержанное движение по трём маршрутам */}
          <path className="splash-comet" pathLength={1} style={{ animationDelay: '2800ms' }} d="M96.4 267C75.8 390.9 102.6 503.6 176.6 605.1" />
          <path className="splash-comet" pathLength={1} style={{ animationDelay: '4100ms' }} d="M955.9 622.2C875.4 535.3 819 434.9 786.6 320.9" />
          <path className="splash-comet" pathLength={1} style={{ animationDelay: '5300ms' }} d="M287.5 83C406.5 70.5 512.2 102.3 604.4 178.5" />

          {/* Узлы: появляются вслед за линиями; акцентные — с пульсацией */}
          <g className="splash-node" style={{ animationDelay: '700ms' }}>
            <circle className="splash-node-ring" cx="96.4" cy="267" r="11" />
            <circle className="splash-node-dot" cx="96.4" cy="267" r="3.5" />
          </g>
          <g className="splash-node" style={{ animationDelay: '900ms' }}>
            <circle className="splash-node-ring" cx="955.9" cy="622.2" r="11" />
            <circle className="splash-node-dot" cx="955.9" cy="622.2" r="3.5" />
          </g>
          <g className="splash-node" style={{ animationDelay: '1200ms' }}>
            <circle className="splash-node-dot" cx="374.1" cy="188.5" r="7" />
          </g>
          <g className="splash-node splash-node-acc" style={{ animationDelay: '1360ms' }}>
            <circle className="splash-pulse" style={{ animationDelay: '3000ms' }} cx="176.6" cy="605.1" r="7" />
            <circle className="splash-node-dot" cx="176.6" cy="605.1" r="7" />
          </g>
          <g className="splash-node splash-node-acc" style={{ animationDelay: '1720ms' }}>
            <circle className="splash-pulse" style={{ animationDelay: '3600ms' }} cx="786.6" cy="320.9" r="7" />
            <circle className="splash-node-dot" cx="786.6" cy="320.9" r="7" />
          </g>
          <g className="splash-node" style={{ animationDelay: '1860ms' }}>
            <circle className="splash-node-dot" cx="671" cy="796.2" r="7" />
          </g>
          <g className="splash-node" style={{ animationDelay: '2000ms' }}>
            <circle className="splash-node-dot" cx="273.8" cy="751.2" r="7" />
          </g>
          <g className="splash-node" style={{ animationDelay: '2550ms' }}>
            <circle className="splash-node-dot" cx="604.4" cy="178.5" r="7" />
          </g>
          <g className="splash-node" style={{ animationDelay: '1600ms' }}>
            <circle className="splash-node-dot splash-node-dot-small" cx="339.3" cy="941.7" r="4.5" />
          </g>
          <g className="splash-node" style={{ animationDelay: '1800ms' }}>
            <circle className="splash-node-dot splash-node-dot-small" cx="287.5" cy="83" r="4.5" />
          </g>
          <g className="splash-node" style={{ animationDelay: '2100ms' }}>
            <circle className="splash-node-dot splash-node-dot-small" cx="170.8" cy="134.4" r="4.5" />
          </g>
          <g className="splash-node" style={{ animationDelay: '2300ms' }}>
            <circle className="splash-node-dot splash-node-dot-small" cx="890.9" cy="805.4" r="4.5" />
          </g>
        </svg>
      </div>

      {/* Центральная композиция: знак, подпись, нейтральный индикатор */}
      <div
        className="relative z-10 flex h-full w-full flex-col items-center justify-center gap-[26px] px-6"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="splash-enter relative flex items-center justify-center">
          <div aria-hidden="true" className="splash-halo" />
          {/* Центр композиции — фирменный знак R. Полный логотип portal.svg
              остаётся в top bar; здесь он не дублируется. Инверсия — как на
              экране входа: графика SVG не изменяется. */}
          <img
            src="/R-logo-2.svg"
            alt="Ratipa Portal"
            width={748}
            height={754}
            draggable={false}
            className="splash-logo relative h-12 sm:h-14 w-auto select-none"
          />
        </div>

        <p className="splash-caption select-none">Портал управления перевозками</p>

        {/* Нейтральный индикатор без числового значения */}
        <div className="splash-track" aria-hidden="true">
          <span className="splash-bar block h-full w-1/3 rounded-full bg-white/70" />
        </div>

        {/* Длительная загрузка: понятное сообщение и повтор попытки */}
        {slow && (
          <div className="flex flex-col items-center gap-3 px-6 text-center max-w-xs" role="alert">
            <p className="text-xs text-white/60 leading-relaxed">
              Загрузка занимает больше времени, чем обычно.
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-lg text-xs font-medium text-[var(--accent-on)] bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
              >
                Повторить
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

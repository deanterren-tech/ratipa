/**
 * Иконки мобильного хаба «Ещё» в стиле референс-набора Сергея: жирные заливные
 * глифы со скруглениями и вырезами (fillRule="evenodd" — вырезы ПРОЗРАЧНЫЕ,
 * поэтому корректно смотрятся на светлых плитках хаба).
 *
 * Часть глифов повторяет формы референса 1:1 (колокол, календарь, люди, сумка,
 * файл, чек-бейдж, стрелка-выход, переключатели, слайдеры), остальные нарисованы
 * в том же языке (грузовик, пин, калькулятор, квитанция, колонка топлива,
 * спасательный круг, навигационная стрелка и т.д.).
 *
 * Цвет задаётся через `style={{ color }}` на плитке (currentColor).
 * Лёгкий штрих currentColor с round-джойнами округляет углы и утолщает глиф.
 */
import React from 'react';

type HubIconProps = { className?: string; style?: React.CSSProperties };

const base = (className?: string, style?: React.CSSProperties) => ({
  className,
  style,
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'currentColor',
  stroke: 'currentColor',
  strokeWidth: 0.9,
  strokeLinejoin: 'round' as const,
  strokeLinecap: 'round' as const,
  fillRule: 'evenodd' as const,
  'aria-hidden': true,
  focusable: false,
});

/* ── Быстрый доступ ─────────────────────────────────────────────────────── */

/** Задачи: скруглённый квадрат с белой галочкой (бейдж). */
export function HubTasksIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9.1 3.6h5.8a5.5 5.5 0 0 1 5.5 5.5v5.8a5.5 5.5 0 0 1-5.5 5.5H9.1a5.5 5.5 0 0 1-5.5-5.5V9.1a5.5 5.5 0 0 1 5.5-5.5Z M7.6 12.2l3.4 3.4 5.6-7.1-1.7-1.4-4.1 5.2-1.5-1.5Z" />
    </svg>
  );
}

/** Документы: лист с загнутым углом и двумя строками. */
export function HubDocsIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M13.4 3.2H8.4A3.2 3.2 0 0 0 5.2 6.4v11.2a3.2 3.2 0 0 0 3.2 3.2h7.2a3.2 3.2 0 0 0 3.2-3.2V8.6l-5.4-5.4Z M13.4 3.4v3.6c0 .9.7 1.6 1.6 1.6h3.5L13.4 3.4Z M8.7 12.9h6.6v1.8H8.7Z M8.7 16.3h4.4v1.8H8.7Z" />
    </svg>
  );
}

/** Уведомления: колокол с язычком. */
export function HubBellIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M12 3.1a6.4 6.4 0 0 0-6.4 6.4c0 4.6-1.2 6.2-1.2 6.2a.9.9 0 0 0 .7 1.5h13.8a.9.9 0 0 0 .7-1.5s-1.2-1.6-1.2-6.2A6.4 6.4 0 0 0 12 3.1Z M10.1 19.4a2.1 2.1 0 0 0 3.8 0Z" />
    </svg>
  );
}

/** Поддержка: трубка телефона. */
export function HubPhoneIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M21.6 16.7v2.8a1.9 1.9 0 0 1-2 1.9 18.8 18.8 0 0 1-8.2-2.9 18.5 18.5 0 0 1-5.7-5.7A18.8 18.8 0 0 1 2.8 4.5a1.9 1.9 0 0 1 1.9-2h2.8a1.9 1.9 0 0 1 1.9 1.6 12.2 12.2 0 0 0 .7 2.7 1.9 1.9 0 0 1-.4 2l-1.2 1.2a15.2 15.2 0 0 0 5.7 5.7l1.2-1.2a1.9 1.9 0 0 1 2-.4 12.2 12.2 0 0 0 2.7.7 1.9 1.9 0 0 1 1.5 1.9Z" />
    </svg>
  );
}

/* ── Текущие операции ───────────────────────────────────────────────────── */

/** Рейсы: пунктирный маршрут с пином на конце. */
export function HubRouteIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M5.4 14.6a1.9 1.9 0 1 0 0 3.8 1.9 1.9 0 0 0 0-3.8Z M10.3 11.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z M15.6 3.3a5.4 5.4 0 0 0-5.4 5.4c0 3.6 4.1 7.4 4.9 8.1a.7.7 0 0 0 1 0c.8-.7 4.9-4.5 4.9-8.1a5.4 5.4 0 0 0-5.4-5.4Z M15.6 6.4a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6Z" />
    </svg>
  );
}

/** Загрузки: сумка-тоут со скобой. */
export function HubBagIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9 7.4V6.5a3.1 3.1 0 0 1 6.2 0v.9h-1.9v-.9a1.2 1.2 0 0 0-2.4 0v.9H9Z M5.7 9.2h12.6l-1 9.9a2.6 2.6 0 0 1-2.6 2.3H9.3a2.6 2.6 0 0 1-2.6-2.3l-1-9.9Z" />
    </svg>
  );
}

/** Автопарк: грузовик с колёсными арками. */
export function HubTruckIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M4.6 5.2h6.9c1.2 0 2.2 1 2.2 2.2v4.7h3.4c.7 0 1.3.3 1.7.8l1.8 2.4c.2.3.4.7.4 1.1v1.4c0 .8-.7 1.5-1.5 1.5H4.6a1.5 1.5 0 0 1-1.5-1.5V6.7c0-.8.7-1.5 1.5-1.5Z M7.4 19.3a2.9 2.9 0 0 0 5.8 0Z M15.6 19.3a2.9 2.9 0 0 0 5.8 0Z" />
    </svg>
  );
}

/** Фура: тягач слева (капот со скосом лобового стекла) + длинный полуприцеп справа, три колеса. */
export function HubSemiTruckIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M11.1 5H19.5a1.5 1.5 0 0 1 1.5 1.5V15.9a1.5 1.5 0 0 1-1.5 1.5H4.7a1.4 1.4 0 0 1-1.4-1.4V12.7L6 8.5H9.6V6.5a1.5 1.5 0 0 1 1.5-1.5Z M8.1 9.1h2.6v8.3H8.1Z M2.7 17.4a2.6 2.6 0 0 0 5.2 0Z M9.4 17.4a2.6 2.6 0 0 0 5.2 0Z M16.1 17.4a2.6 2.6 0 0 0 5.2 0Z" />
    </svg>
  );
}

/** Водители: человек. */
export function HubPersonIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M12 5.1a3.7 3.7 0 1 0 0 7.4 3.7 3.7 0 0 0 0-7.4Z M12 13.8c-4 0-7.2 2.1-7.2 4.7 0 .8.6 1.4 1.4 1.4h11.6c.8 0 1.4-.6 1.4-1.4 0-2.6-3.2-4.7-7.2-4.7Z" />
    </svg>
  );
}

/** Карта: пин локации. */
export function HubPinIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M12 2.7c-3.9 0-7 3.1-7 7 0 4.9 5.7 10.6 6.6 11.5.2.2.6.2.8 0 .9-.9 6.6-6.6 6.6-11.5 0-3.9-3.1-7-7-7Z M12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
  );
}

/** Выезды: бейдж со стрелкой наружу (вправо). */
export function HubExitIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9.1 3.8h5.8a5.3 5.3 0 0 1 5.3 5.3v5.8a5.3 5.3 0 0 1-5.3 5.3H9.1a5.3 5.3 0 0 1-5.3-5.3V9.1a5.3 5.3 0 0 1 5.3-5.3Z M8.7 11.2h5.4l-2-2 1.3-1.3 4.2 4.1-4.2 4.1-1.3-1.3 2-2H8.7Z" />
    </svg>
  );
}

/* ── Планирование ───────────────────────────────────────────────────────── */

/** Календарь: с шапкой, разделителем и сеткой точек. */
export function HubCalendarIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M8.5 2.8c.55 0 1 .45 1 1v.9h5c0-.55.45-1 1-1s1 .45 1 1v.9h.3A2.6 2.6 0 0 1 19.4 7.2v.9H4.6v-.9a2.6 2.6 0 0 1 2.6-2.6h.3v-.9c0-.55.45-1 1-1Z M4.6 9.7h14.8v7.1a2.6 2.6 0 0 1-2.6 2.6H7.2a2.6 2.6 0 0 1-2.6-2.6V9.7Z M8.3 12.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z M12 12.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z M15.7 12.3a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z M8.3 15.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z M12 15.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z M15.7 15.4a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
    </svg>
  );
}

/** Маршруты: навигационная стрелка (как в картах). */
export function HubNavIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M12 3.2c.32 0 .6.19.73.48l6.7 16.5c.2.5-.3 1.03-.82.84l-6.2-2.86a1 1 0 0 0-.82 0l-6.2 2.86c-.52.19-1.02-.34-.82-.84l6.7-16.5c.13-.29.41-.48.73-.48Z" />
    </svg>
  );
}

/** Расчёты: калькулятор. */
export function HubCalcIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9.1 3.6h5.8a5.5 5.5 0 0 1 5.5 5.5v5.8a5.5 5.5 0 0 1-5.5 5.5H9.1a5.5 5.5 0 0 1-5.5-5.5V9.1a5.5 5.5 0 0 1 5.5-5.5Z M8.1 7h7.8v2.5H8.1Z M9.3 12.4a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z M14.7 12.4a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z M9.3 15.5a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z M14.7 15.5a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z" />
    </svg>
  );
}

/** Задачи команды: планшет с чек-галочкой. */
export function HubClipboardIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M7.8 4.6h8.4a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H7.8a2.5 2.5 0 0 1-2.5-2.5v-10a2.5 2.5 0 0 1 2.5-2.5Z M9.7 2.6h4.6c.7 0 1.2.5 1.2 1.2v.9c0 .7-.5 1.2-1.2 1.2H9.7c-.7 0-1.2-.5-1.2-1.2v-.9c0-.7.5-1.2 1.2-1.2Z M8.8 11l3 3 5-5.7-1.6-1.4-3.5 4-1.4-1.4Z" />
    </svg>
  );
}

/* ── Финансы и отчётность ───────────────────────────────────────────────── */

/** Доходность: растущая линия со стрелкой. */
export function HubTrendIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path
        d="M5.4 17.6l5-5.2 2.4 2.4 6-7.2"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
      />
      <path
        d="M14.6 7.2h4.8v4.8"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
      />
      <path d="M5.4 15.5a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z" />
    </svg>
  );
}

/** Топливо: колонка с пистолетом. */
export function HubFuelIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M6.2 3.4h7c1 0 1.8.8 1.8 1.8v14.5H4.4V5.2c0-1 .8-1.8 1.8-1.8Z M6.7 6.6h6v4.4h-6Z" />
      <path
        d="M15 8h1.2c1.3 0 2.3 1 2.3 2.3v5.9c0 .9.7 1.5 1.5 1.5s1.5-.7 1.5-1.5v-5.6l-2.4-2.4"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
      />
    </svg>
  );
}

/** Счета: квитанция с зигзагом и строками. */
export function HubReceiptIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M6.4 3.9h11.2a1.8 1.8 0 0 1 1.8 1.8v14.2l-2.2-1.5-2.2 1.5-2.2-1.5-2.2 1.5-2.2-1.5-2.2 1.5V5.7a1.8 1.8 0 0 1 1.8-1.8Z M8.5 8h7v1.7h-7Z M8.5 11.4h7v1.7h-7Z" />
    </svg>
  );
}

/** Отчёты: три колонки. */
export function HubBarsIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M5.4 13.2h3.2v6.6H5.4Z M10.4 8.8h3.2v11H10.4Z M15.4 4.2h3.2v15.6h-3.2Z" />
    </svg>
  );
}

/* ── Система ────────────────────────────────────────────────────────────── */

/** Команда: два человека. */
export function HubUsersIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9.6 4.3a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z M16.9 5.6a2.6 2.6 0 1 0 0 5.2 2.6 2.6 0 0 0 0-5.2Z M9.6 12.8c-3.5 0-6.3 1.9-6.3 4.2 0 .8.6 1.4 1.4 1.4h9.8c.8 0 1.4-.6 1.4-1.4 0-2.3-2.8-4.2-6.3-4.2Z M16.9 13.4c-.9 0-1.7.13-2.4.36 1.1 1 1.8 2.2 1.8 3.6h4.2c.6 0 1.1-.5 1.1-1.1 0-1.7-2.1-2.9-4.7-2.9Z" />
    </svg>
  );
}

/** Интеграции: двойной переключатель. */
export function HubTogglesIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9.6 5.5h4.8a3.3 3.3 0 0 1 0 6.6H9.6a3.3 3.3 0 0 1 0-6.6Z M14.7 7.3a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z M9.6 11.9h4.8a3.3 3.3 0 0 1 0 6.6H9.6a3.3 3.3 0 0 1 0-6.6Z M9.3 13.7a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z" />
    </svg>
  );
}

/** Настройки: слайдеры. */
export function HubSlidersIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M4.2 8.3h15.6" fill="none" stroke="currentColor" strokeWidth={2.4} />
      <path d="M4.2 15.7h15.6" fill="none" stroke="currentColor" strokeWidth={2.4} />
      <path d="M15.2 6.2a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z M8.8 13.6a2.1 2.1 0 1 0 0 4.2 2.1 2.1 0 0 0 0-4.2Z" />
    </svg>
  );
}

/** Помощь: спасательный круг. */
export function HubHelpIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M12 3.6a8.4 8.4 0 1 0 0 16.8 8.4 8.4 0 0 0 0-16.8Z M12 8.7a3.3 3.3 0 1 0 0 6.6 3.3 3.3 0 0 0 0-6.6Z M8.9 5.4a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z M15.1 15.1a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z M15.1 5.4a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z M8.9 15.1a1.75 1.75 0 1 0 0 3.5 1.75 1.75 0 0 0 0-3.5Z" />
    </svg>
  );
}

/* ── Дополнительные глифы для пунктов топбара ПК ────────────────────────── */

/** Дозволы: ключ (кольцо + стержень с зубцами). */
export function HubKeyIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M12 3.3a4.2 4.2 0 1 0 0 8.4 4.2 4.2 0 0 0 0-8.4Z M12 6.7a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z" />
      <path d="M10.7 11.4h2.6v8.9a1.3 1.3 0 0 1-2.6 0Z" />
      <path d="M13.3 14.3h2.9v2.1h-2.9Z M13.3 17.6h2.2v2.1h-2.2Z" />
    </svg>
  );
}

/** Инструкции: закладка. */
export function HubBookmarkIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9.3 3.4h5.4a3 3 0 0 1 3 3v13.3c0 .85-1 1.3-1.65.78L12 17l-4.05 3.48c-.65.52-1.65.07-1.65-.78V6.4a3 3 0 0 1 3-3Z" />
    </svg>
  );
}

/** Зарплата: кошелёк. */
export function HubWalletIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M7 5.6h10a3.4 3.4 0 0 1 3.4 3.4v8a3.4 3.4 0 0 1-3.4 3.4H7A3.4 3.4 0 0 1 3.6 17v-8A3.4 3.4 0 0 1 7 5.6Z M16.3 10.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2Z" />
    </svg>
  );
}

/** Журнал МДП: книга с корешком. */
export function HubBookIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M8 3.4h7.2a2.9 2.9 0 0 1 2.9 2.9v11.4a2.9 2.9 0 0 1-2.9 2.9H8A3.6 3.6 0 0 1 4.4 17V7A3.6 3.6 0 0 1 8 3.4Z M8.3 3.6v16.8h1.3V3.6Z" />
    </svg>
  );
}

/** База данных: три полки-яруса. */
export function HubDatabaseIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <rect x="4.6" y="4.2" width="14.8" height="3.7" rx="1.8" />
      <rect x="4.6" y="10.2" width="14.8" height="3.7" rx="1.8" />
      <rect x="4.6" y="16.2" width="14.8" height="3.7" rx="1.8" />
    </svg>
  );
}

/** Справочники: папка с язычком. */
export function HubFolderIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M4.9 6.1a2.4 2.4 0 0 1 2.4-2.4h2.7c.72 0 1.4.32 1.85.87l.72.9h4.13a2.4 2.4 0 0 1 2.4 2.4v8.4a2.4 2.4 0 0 1-2.4 2.4H7.3a2.4 2.4 0 0 1-2.4-2.4V6.1Z" />
    </svg>
  );
}

/* ── Навигация (нижнее меню) ────────────────────────────────────────────── */

/** Главная: домик с арочной дверью (вырез). */
export function HubHomeIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M12 3.1c.37 0 .72.13 1 .38l7.2 6.2c.62.54.24 1.52-.58 1.52h-.52v5.9a2.6 2.6 0 0 1-2.6 2.6H7.5a2.6 2.6 0 0 1-2.6-2.6v-5.9h-.52c-.82 0-1.2-.98-.58-1.52l7.2-6.2c.28-.25.63-.38 1-.38Z M9.9 19.7v-3.2a2.1 2.1 0 0 1 4.2 0v3.2Z" />
    </svg>
  );
}

/** Ещё: четыре сильно скруглённых квадрата 2×2. */
export function HubGridIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <rect x="4.3" y="4.3" width="6.4" height="6.4" rx="2.4" />
      <rect x="13.3" y="4.3" width="6.4" height="6.4" rx="2.4" />
      <rect x="4.3" y="13.3" width="6.4" height="6.4" rx="2.4" />
      <rect x="13.3" y="13.3" width="6.4" height="6.4" rx="2.4" />
    </svg>
  );
}

/* ── Служебные ──────────────────────────────────────────────────────────── */

/** Стрелка «перейти» (профиль). */
export function HubChevronIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M9.3 5.9 15.4 12l-6.1 6.1" fill="none" stroke="currentColor" strokeWidth={2.4} />
    </svg>
  );
}

/** Метка внешней ссылки ↗. */
export function HubExternalIcon({ className, style }: HubIconProps) {
  return (
    <svg {...base(className, style)}>
      <path d="M7.4 16.6 15.6 8.4" fill="none" stroke="currentColor" strokeWidth={2.1} />
      <path d="M9.7 8.4h5.9v5.9" fill="none" stroke="currentColor" strokeWidth={2.1} />
    </svg>
  );
}

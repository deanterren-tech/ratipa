/**
 * Переиспользуемые элементы общего визуального слоя (образец — «Учёт дозволов»).
 *
 * Разметка снята с модуля дозволов, чтобы разделы не расходились по структуре:
 * оболочка без карточки, подчёркнутые вкладки, заголовки секций на холсте,
 * статусы точкой с текстом. Поведение минимальное: компоненты ничего не
 * подписывают, не запрашивают и не меняют данные.
 */

import React from 'react';
import { AlertTriangle, ArrowLeft, Inbox, RefreshCw, Search, SearchX, X } from 'lucide-react';
import { UI, foundLabel, STATUS_DOT } from './kit';

export interface TabItem {
  key: string;
  label: string;
  count?: number;
}

/**
 * Оболочка раздела: заголовок, подчёркнутые вкладки, содержимое.
 * Содержимое идёт сразу на холсте — без карточки вокруг всего раздела.
 */
export function ModuleShell({
  title,
  tabs,
  activeTab,
  onTabChange,
  actions,
  children,
  contentClassName,
  tabsAriaLabel,
}: {
  title: string;
  tabs?: TabItem[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  actions?: React.ReactNode;
  children: React.ReactNode;
  contentClassName?: string;
  tabsAriaLabel?: string;
}) {
  return (
    <div className={UI.shell}>
      <div className={UI.shellHeader}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <h1 className={UI.title}>{title}</h1>
          {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
        </div>
        {tabs && tabs.length > 0 ? (
          <div className={UI.tabsBar}>
            <nav className={UI.tabsNav} role="tablist" aria-label={tabsAriaLabel || title}>
              {tabs.map((t) => {
                const isActive = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => onTabChange?.(t.key)}
                    onKeyDown={(e) => {
                      // Стрелки / Home / End — как в стандартном списке вкладок,
                      // чтобы разделом можно было пользоваться без мыши.
                      const keys = tabs.map((x) => x.key);
                      const at = keys.indexOf(t.key);
                      let next = -1;
                      if (e.key === 'ArrowRight') next = (at + 1) % keys.length;
                      else if (e.key === 'ArrowLeft') next = (at - 1 + keys.length) % keys.length;
                      else if (e.key === 'Home') next = 0;
                      else if (e.key === 'End') next = keys.length - 1;
                      if (next < 0) return;
                      e.preventDefault();
                      onTabChange?.(keys[next]);
                      const nav = e.currentTarget.parentElement;
                      const buttons = nav ? nav.querySelectorAll<HTMLButtonElement>('[role="tab"]') : null;
                      buttons?.[next]?.focus();
                    }}
                    className={`${UI.tab} ${isActive ? UI.tabActive : UI.tabIdle}`}
                  >
                    {t.label}
                    {typeof t.count === 'number' ? (
                      <span className={`${UI.tabBadge} ${isActive ? UI.tabBadgeActive : UI.tabBadgeIdle}`}>{t.count}</span>
                    ) : null}
                    {isActive ? <span className={UI.tabUnderline} aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </nav>
          </div>
        ) : null}
      </div>
      <div className={contentClassName ?? `${UI.content} flex-1`}>{children}</div>
    </div>
  );
}

/** Заголовок секции: значок в плитке, название, пояснение, справа — действия. */
export function SectionHeader({
  icon,
  tone = 'graphite',
  title,
  subtitle,
  children,
}: {
  icon?: React.ReactNode;
  tone?: 'graphite' | 'accent' | 'amber' | 'emerald' | 'rose' | 'blue';
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    graphite: 'bg-[#F3F4F6] text-[#121316]',
    accent: 'bg-[var(--accent-10)] text-[var(--accent-ink)]',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    rose: 'bg-rose-50 text-rose-600',
    blue: 'bg-blue-50 text-blue-600',
  };
  return (
    <div className={`${UI.sectionHeader} flex-wrap gap-3`}>
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        {icon ? <div className={`p-2 rounded-xl shrink-0 ${tones[tone]}`}>{icon}</div> : null}
        <div className="min-w-0">
          <h3 className={UI.sectionTitle}>{title}</h3>
          {subtitle ? <p className={UI.sectionSubtitle}>{subtitle}</p> : null}
        </div>
      </div>
      {children ? (
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto sm:shrink-0">{children}</div>
      ) : null}
    </div>
  );
}

/** Строка поиска — заметный элемент на холсте. */
export function SearchField({
  value,
  onChange,
  placeholder,
  ariaLabel,
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <div className={`${UI.searchWrap} ${className}`}>
      <Search className={`${UI.searchIcon} text-[#9CA3AF]`} aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
        className={UI.searchInput}
      />
      {value ? (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Очистить поиск"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer"
        >
          <X className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** Сегментный фильтр: активный — графит, неактивный — тихий серый. */
export function FilterPills<T extends string>({
  items,
  active,
  onChange,
  ariaLabel,
}: {
  items: Array<{ key: T; label: string; tone?: 'default' | 'danger' | 'warn' }>;
  active: T;
  onChange: (key: T) => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={ariaLabel}>
      {items.map((it) => {
        const isActive = active === it.key;
        const tone = it.tone || 'default';
        const cls = isActive
          ? tone === 'danger'
            ? UI.filterPillDangerActive
            : tone === 'warn'
              ? UI.filterPillWarnActive
              : UI.filterPillActive
          : tone === 'danger'
            ? UI.filterPillDangerIdle
            : tone === 'warn'
              ? UI.filterPillWarnIdle
              : UI.filterPillIdle;
        return (
          <button
            key={it.key}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(it.key)}
            className={`${UI.filterPill} ${cls}`}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

/** Статус: точка + текст (без залитой плашки). */
export function StatusText({ color = 'grey', children }: { color?: keyof typeof STATUS_DOT; children: React.ReactNode }) {
  return (
    <span className={UI.status}>
      <span className={`${UI.statusDot} ${STATUS_DOT[color] || STATUS_DOT.grey}`} aria-hidden="true" />
      <span className="text-[#4B5563]">{children}</span>
    </span>
  );
}

/**
 * Пустое состояние: список пуст, ничего не найдено или ошибка загрузки.
 * Случаи различаются текстом и значком, а не только цветом.
 */
export function EmptyState({
  kind = 'empty',
  title,
  hint,
  actionLabel,
  onAction,
  query,
}: {
  kind?: 'empty' | 'no-results' | 'error';
  title?: string;
  hint?: string;
  actionLabel?: string;
  onAction?: () => void;
  query?: string;
}) {
  const defaults: Record<string, { title: string; hint: string }> = {
    empty: { title: 'Записей пока нет', hint: 'Добавьте первую запись — она появится в этом списке.' },
    'no-results': { title: 'Ничего не найдено', hint: 'Измените запрос или снимите фильтры.' },
    error: { title: 'Не удалось загрузить данные', hint: 'Проверьте соединение и повторите попытку.' },
  };
  const text = { ...defaults[kind], ...(title ? { title } : {}), ...(hint ? { hint } : {}) };
  const Icon = kind === 'error' ? AlertTriangle : kind === 'no-results' ? SearchX : Inbox;
  return (
    <div className={UI.empty} role={kind === 'error' ? 'alert' : undefined}>
      <Icon
        className={`w-6 h-6 mx-auto mb-2 ${kind === 'error' ? 'text-rose-500' : 'text-[#D1D5DB]'}`}
        aria-hidden="true"
      />
      <p className={UI.emptyTitle}>{text.title}</p>
      <p className={UI.emptyText}>
        {kind === 'no-results' && query ? `По запросу «${query}» ничего не найдено. ` : ''}
        {text.hint}
      </p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className={UI.emptyAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

/** Строка об ошибке с кнопкой повтора (загрузка/сохранение). */
export function ErrorRow({ text, onRetry }: { text: string; onRetry?: () => void }) {
  return (
    <div className={UI.errorBox} role="alert">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-px" aria-hidden="true" />
      <span className="flex-1">{text}</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 text-xs font-semibold underline cursor-pointer whitespace-nowrap"
        >
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
          Повторить
        </button>
      ) : null}
    </div>
  );
}

/** Строка «Найдено: N записей» + сброс фильтров. */
export function FoundCount({ count, onReset, className = '' }: { count: number; onReset?: () => void; className?: string }) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className={UI.hint}>{foundLabel(count)}</span>
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] font-medium text-[var(--accent)] hover:underline cursor-pointer"
        >
          Сбросить фильтры
        </button>
      ) : null}
    </div>
  );
}

/**
 * Кнопка «← Назад» мобильного окна — та же реализация и стиль, что в хабе
 * «Ещё» (после dd546b7): зона ≥ 44 px, понятное доступное имя, закрывает окно
 * той же логикой, что прежний крестик. Видна только на телефоне (<768):
 * на десктопе в шапке окна остаётся крестик.
 */
export function BackButton({
  onClose,
  className = '',
  label = 'Назад',
}: {
  onClose: () => void;
  className?: string;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label={label}
      className={`md:hidden -ml-1 inline-flex min-h-[44px] shrink-0 items-center gap-2 self-start rounded-xl px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] active:bg-[#F3F4F6] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] cursor-pointer ${className}`}
    >
      <ArrowLeft className="h-4 w-4" aria-hidden="true" />
      {label}
    </button>
  );
}

/** Оболочка модального окна: единый язык для всех разделов. */
export function ModalShell({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  iconTone = 'accent',
  footer,
  children,
  maxWidth = 'max-w-lg',
  ariaLabel,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  iconTone?: 'accent' | 'graphite' | 'rose' | 'amber' | 'emerald';
  footer?: React.ReactNode;
  children: React.ReactNode;
  maxWidth?: string;
  ariaLabel?: string;
}) {
  if (!isOpen) return null;
  const tones: Record<string, string> = {
    accent: 'bg-[var(--accent-10)] text-[var(--accent-ink)]',
    graphite: 'bg-[#F3F4F6] text-[#121316]',
    rose: 'bg-rose-50 text-rose-600',
    amber: 'bg-amber-50 text-amber-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <div
      className={UI.modalBackdrop}
      data-scroll-lock="modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`${UI.modalSurface} ${maxWidth}`} role="dialog" aria-modal="true" aria-label={ariaLabel || title}>
        <div className={UI.modalHeader}>
          <div className="flex items-start gap-1 min-w-0 flex-1">
            <BackButton onClose={onClose} className="mt-0.5" />
            <div className="flex items-start gap-3 min-w-0">
              {icon ? <div className={`${UI.modalIconTile} ${tones[iconTone]}`}>{icon}</div> : null}
              <div className="min-w-0">
                <h2 className={UI.modalTitle}>{title}</h2>
                {subtitle ? <p className={UI.modalSubtitle}>{subtitle}</p> : null}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className={UI.modalClose}>
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
        <div className={UI.modalBody}>{children}</div>
        {footer ? <div className={UI.modalFooter}>{footer}</div> : null}
      </div>
    </div>
  );
}

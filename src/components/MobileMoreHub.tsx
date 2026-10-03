/**
 * Мобильный хаб «Ещё» — полноэкранная страница-навигация ПОВЕРХ существующих
 * разделов портала. Полный редизайн по ОБЩЕЙ дизайн-системе приложения
 * (src/ui/kit.ts — тот же визуальный слой, что у «Учёта дозволов» и «Учёта
 * выезда»): холст #F8F9FA, белые карточки UI.card (shadow-xs), серые
 * icon-плитки #F3F4F6, тихие чипы UI.chip, подписи UI.caption, счётчики
 * UI.countBadge, статусы точка+текст UI.status.
 *
 * ВАЖНО: состав и подписи пунктов приходят снаружи (`groups`) и формируются в
 * AppShell ИЗ ТОГО ЖЕ ИСТОЧНИКА, что у топбара ПК-версии (settings.menuStructure
 * → фолбэк menuGroups, getSubtabLabel, фильтрация по правам getAllowedSubtabs).
 *
 * Иконки — заливной набор HubIcons по ключу модуля (MODULE_STYLE). Живые
 * показатели: рейсы (tripsdashboard, не архив), автопарк и водители — цифры
 * берутся ИЗ ТЕХ ЖЕ ИСТОЧНИКОВ, что показывают «Справочники» и сам раздел
 * «Авто и Водители»: единая база сцепок (getCouplingsFlat — как «База сцепок»
 * во вкладке «Автопарк и Водители») и справочник водителей (getDriversFlat —
 * как вкладка «База водителей»). Подписки живут только пока хаб открыт;
 * показываются у «План Дохода» и «Авто и Водители».
 */
import { useEffect, useState, type ComponentType, type CSSProperties } from 'react';
import { motion } from 'motion/react';
import {
  HubHomeIcon, HubDocsIcon,
  HubTruckIcon, HubPinIcon, HubExitIcon,
  HubSemiTruckIcon,
  HubCalendarIcon, HubNavIcon, HubCalcIcon,
  HubTrendIcon, HubReceiptIcon,
  HubUsersIcon, HubTogglesIcon, HubChevronIcon,
  HubKeyIcon, HubBookmarkIcon, HubWalletIcon, HubBookIcon, HubDatabaseIcon, HubFolderIcon,
  HubGridIcon,
} from './common/HubIcons';
import { dbService } from '../api';
import { getCouplingsFlat, getDriversFlat } from '../services/fleetService';
import { UserProfile } from '../types';
import { APP_VERSION_LABEL } from '../version';
import { getUserFullName } from '../utils/userName';
import { UI } from '../ui/kit';

type HubIconComponent = ComponentType<{ className?: string; style?: CSSProperties }>;

/** Пункт хаба — ключ реального модуля портала + подпись (как в топбаре ПК). */
export type HubGroupItem = { key: string; label: string };
export type HubGroup = { id: string; label: string; items: HubGroupItem[] };

/**
 * Иконка для каждого модуля портала — заливной набор в стиле референса.
 * Цвет всех иконок и точек — СВЕТЛЫЙ акцентный токен темы `var(--accent)`
 * (заказчик: ink-вариант слишком тёмный; акцент этой темы светлее — #FF8040).
 * Ключи соответствуют allModules в AppShell; неизвестный ключ получит сетку.
 */
const MODULE_STYLE: Record<string, { icon: HubIconComponent; color: string }> = {
  dashboard: { icon: HubHomeIcon, color: 'var(--accent)' },
  // Текущее
  disposition: { icon: HubPinIcon, color: 'var(--accent)' },
  baza: { icon: HubExitIcon, color: 'var(--accent)' },
  documents: { icon: HubDocsIcon, color: 'var(--accent)' },
  vehicleDriverData: { icon: HubTruckIcon, color: 'var(--accent)' },
  dozvola: { icon: HubKeyIcon, color: 'var(--accent)' },
  instructions: { icon: HubBookmarkIcon, color: 'var(--accent)' },
  // Планирование
  planZagruzok: { icon: HubSemiTruckIcon, color: 'var(--accent)' },
  planDohod: { icon: HubTrendIcon, color: 'var(--accent)' },
  currentPlanning: { icon: HubNavIcon, color: 'var(--accent)' },
  dohod: { icon: HubCalcIcon, color: 'var(--accent)' },
  // Отчетность
  salary: { icon: HubWalletIcon, color: 'var(--accent)' },
  bookIssue: { icon: HubReceiptIcon, color: 'var(--accent)' },
  tabel: { icon: HubCalendarIcon, color: 'var(--accent)' },
  mdpJournal: { icon: HubBookIcon, color: 'var(--accent)' },
  // Настройки
  settings: { icon: HubDatabaseIcon, color: 'var(--accent)' },
  appSettings: { icon: HubFolderIcon, color: 'var(--accent)' },
  admin: { icon: HubUsersIcon, color: 'var(--accent)' },
  agentAudit: { icon: HubTogglesIcon, color: 'var(--accent)' },
};

const FALLBACK_STYLE: { icon: HubIconComponent; color: string } = { icon: HubGridIcon, color: 'var(--accent)' };

/** Русские формы множественного числа: 1 единица / 2 единицы / 5 единиц. */
function pluralRu(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0] || '').join('').toUpperCase() || 'Р';
}

function roleLabel(role: string): string {
  if (role === 'root_admin' || role === 'admin') return 'Администратор';
  if (role === 'manager') return 'Менеджер';
  if (role === 'mechanic') return 'Механик';
  return 'Сотрудник';
}

type Props = {
  user: UserProfile;
  /** Группы пунктов — тот же состав, что у топбара ПК (подписи/права уже учтены). */
  groups: HubGroup[];
  onNavigate: (moduleKey: string) => void;
  onOpenAccount: () => void;
  onClose: () => void;
};

export default function MobileMoreHub({ user, groups, onNavigate, onOpenAccount }: Props) {
  const fullName = getUserFullName(user);

  // Живые показатели — подписки только на время открытого хаба.
  const [trips, setTrips] = useState<number | null>(null);
  const [fleet, setFleet] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<number | null>(null);

  useEffect(() => {
    const u1 = dbService.getTrips((list) => setTrips((list || []).filter((t) => !t.isArchived).length));
    // Автопарк — счёт из единой базы сцепок: тот же источник и та же цифра,
    // что «База сцепок» в «Справочниках» и «Реестр автопарка и экипажей» в
    // разделе «Авто и Водители» (не сырой узел tractors).
    const u2 = getCouplingsFlat((list: any[]) => setFleet((list || []).length));
    // Водители — справочник водителей: как «База водителей» в «Справочниках».
    const u3 = getDriversFlat((list: any[]) => setDrivers((list || []).length));
    return () => {
      if (typeof u1 === 'function') u1();
      if (typeof u2 === 'function') u2();
      if (typeof u3 === 'function') u3();
    };
  }, []);

  /**
   * Показатель модуля: число (font-mono, как значения в разделах)
   * + подпись (серый #4B5563). null — без подписи.
   */
  const metricPartsFor = (key: string): { num: string; text: string }[] | null => {
    if (key === 'planDohod' && trips !== null) {
      return [{ num: String(trips), text: ` ${pluralRu(trips, 'активный', 'активных', 'активных')}` }];
    }
    if (key === 'vehicleDriverData') {
      const parts: { num: string; text: string }[] = [];
      if (fleet !== null) parts.push({ num: String(fleet), text: ' авто · ' });
      if (drivers !== null) parts.push({ num: String(drivers), text: ` ${pluralRu(drivers, 'водитель', 'водителя', 'водителей')}` });
      return parts.length ? parts : null;
    }
    return null;
  };

  const renderTile = (item: HubGroupItem) => {
    const style = MODULE_STYLE[item.key] ?? FALLBACK_STYLE;
    const Icon = style.icon;
    const metric = metricPartsFor(item.key);
    return (
      <button
        key={item.key}
        type="button"
        onClick={() => onNavigate(item.key)}
        className={`${UI.card} relative min-h-[112px] p-3.5 flex flex-col items-start text-left transition-colors duration-150 hover:border-[#D1D5DB] hover:bg-[#F9FAFB] active:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] cursor-pointer`}
      >
        {/* Серый icon-тайл дизайн-системы (как в шапках модалок kit) */}
        <span className="h-10 w-10 rounded-xl bg-[#F3F4F6] flex items-center justify-center mb-2.5 shrink-0">
          <Icon className="h-5 w-5" style={{ color: style.color }} />
        </span>
        <span className="text-sm font-semibold text-[#121316] leading-tight">{item.label}</span>
        {metric && (
          <span className={`${UI.status} mt-1 tabular-nums`}>
            <span className={UI.statusDot} style={{ background: style.color }} />
            {metric.map((part, i) => (
              <span key={i}>
                <span className="font-mono font-semibold text-[#121316]">{part.num}</span>
                <span className="text-[#4B5563]">{part.text}</span>
              </span>
            ))}
          </span>
        )}
      </button>
    );
  };

  /** Заголовок группы (UI.caption) + тихий счётчик (UI.countBadge). */
  const sectionTitle = (title: string, count?: number) => (
    <div className="flex items-center gap-2 mb-2.5">
      <h3 className={UI.caption}>{title}</h3>
      {typeof count === 'number' && <span className={UI.countBadge}>{count}</span>}
    </div>
  );

  return (
    <div
      data-scroll-lock="modal"
      data-hub="mobile-more"
      className="md:hidden fixed left-0 right-0 top-14 bottom-0 z-40 bg-[#F8F9FA] flex flex-col"
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        <div
          className="px-4 flex flex-col gap-5"
          style={{
            paddingTop: '16px',
            paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 108px)',
          }}
        >
          {/* ── Профиль (UI.card + серый тайл аватара) ──────────────── */}
          <button
            type="button"
            onClick={onOpenAccount}
            className={`${UI.card} w-full flex items-center gap-3.5 p-4 text-left transition-colors duration-150 hover:border-[#D1D5DB] hover:bg-[#F9FAFB] active:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] cursor-pointer`}
          >
            <span className="h-12 w-12 shrink-0 rounded-xl bg-[#F3F4F6] text-[#121316] flex items-center justify-center text-sm font-bold overflow-hidden select-none">
              {user.avatarPhoto ? (
                <img src={user.avatarPhoto} alt="" className="h-full w-full object-cover" draggable={false} />
              ) : (
                initialsOf(fullName)
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-[15px] font-semibold text-[#121316] truncate">{fullName}</span>
              <span className="block mt-1.5">
                <span className={UI.chip}>{roleLabel(user.role)} · Ratipa</span>
              </span>
              <span className="block text-[11px] text-[#6B7280] mt-1">Минск, Беларусь</span>
            </span>
            <HubChevronIcon className="h-5 w-5 text-[#9CA3AF] shrink-0" />
          </button>

          {/* ── Группы пунктов — как в топбаре ПК ───────────────────── */}
          {groups.map((group) => {
            if (group.items.length === 0) return null;
            return (
              <section key={group.id}>
                {sectionTitle(group.label, group.items.length)}
                <div className="grid grid-cols-2 gap-3">{group.items.map(renderTile)}</div>
              </section>
            );
          })}

          {/* ── Версия ──────────────────────────────────────────────── */}
          <div className="text-center -mt-1">
            <span className="text-[10px] font-medium text-[#9CA3AF] tabular-nums">{APP_VERSION_LABEL}</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

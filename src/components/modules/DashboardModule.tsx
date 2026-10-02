import React, { useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { UserProfile, AppSettings } from '../../types';
import { dbService } from '../../api';
import TypingText from '../TypingText';
import AllLinksModal from '../AllLinksModal';
import PageLoading from '../common/PageLoading';
import { getUserFirstName } from '../../utils/userName';
import { Activity, ExternalLink, X, Map, Wallet, Pencil, Bell, ArrowRight } from 'lucide-react';

const getTimeOfDayGreeting = (): string => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Доброе утро';
  if (hour >= 12 && hour < 18) return 'Доброго дня';
  if (hour >= 18 && hour < 23) return 'Добрый вечер';
  return 'Доброй ночи';
};

/** Домен ссылки: полный адрес бывает очень длинным (OAuth-ссылки на сотни символов). */
const linkHost = (url: string): string => {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return String(url || '').replace(/^https?:\/\//, '').split('/')[0];
  }
};

interface DashboardModuleProps {
  user: UserProfile;
  onNavigate: (module: string) => void;
}

/**
 * Главная страница портала.
 *
 * Состав: крупное приветствие (только имя пользователя, с акцентом портала),
 * короткое описание, бегущая строка портала, объявления администратора и
 * «Полезные ссылки» с поиском.
 *
 * Из интерфейса убраны: блок Highlight вместе с редактором новостей и просмотром,
 * кнопки «Открыть план дохода» и «Калькуляция», часы и декоративный фон страницы
 * (техно-сетка и световые пятна). Данные новостей и объявлений в базе остаются
 * без изменений — они просто не показываются на главной.
 */
/** Сколько рядов ссылок показываем на главной, прежде чем прятать остальные в окно. */
const MAX_LINK_ROWS = 2;

export default function DashboardModule({ user, onNavigate }: DashboardModuleProps) {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dataLoaded, setDataLoaded] = useState(false);

  // Подписка на настройки портала: объявления, бегущая строка, полезные ссылки.
  // Экран приложения не показывается, пока подписка не установлена.
  useEffect(() => {
    const unsubscribeSettings = dbService.getSettings(setSettings);
    setDataLoaded(true);
    return () => {
      if (typeof unsubscribeSettings === 'function') unsubscribeSettings();
    };
  }, []);

  const links = useMemo(() => {
    const list = Array.isArray(settings?.quickLinks) ? settings!.quickLinks : [];
    return list.filter((l) => l && l.url);
  }, [settings]);

  /**
   * На главной — компактный набор ссылок: столько, сколько помещается в блоке
   * (два ряда на текущем размере экрана). Остальные доступны по кнопке
   * «Все ссылки» в отдельном окне. Главная из-за ссылок не растягивается.
   */
  const linksGridRef = useRef<HTMLDivElement | null>(null);
  const [visibleCount, setVisibleCount] = useState(MAX_LINK_ROWS);
  const [allLinksOpen, setAllLinksOpen] = useState(false);

  // Число колонок берём у самой сетки (grid-template-columns), а не считаем
  // по ширине: так оно всегда совпадает с CSS на любом размере экрана.
  useLayoutEffect(() => {
    const el = linksGridRef.current;
    if (!el) return undefined;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length || 1;
      const capacity = Math.max(1, tracks * MAX_LINK_ROWS);
      setVisibleCount((prev) => (prev === capacity ? prev : capacity));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [links.length]);

  const visibleLinks = useMemo(() => links.slice(0, visibleCount), [links, visibleCount]);

  const phrases = Array.isArray(settings?.customPhrases) ? settings!.customPhrases.filter(Boolean) : [];
  const phrasesAllowed =
    phrases.length > 0 &&
    (!settings?.customPhrasesRoles ||
      settings!.customPhrasesRoles.length === 0 ||
      settings!.customPhrasesRoles.includes(user.role));

  const isAdmin = user.role === 'admin' || user.role === 'root_admin';

  if (!dataLoaded) {
    return <PageLoading fullScreen text="Загрузка данных..." />;
  }

  // В приветствии — только ИМЯ: единое правило из utils/userName.
  const greetingName = getUserFirstName(user);

  // Приветствие — крупное и с акцентом портала; цвета из палитры портала.
  return (
    <div className="w-full relative h-full flex flex-col justify-between p-4 sm:p-6 lg:p-8 select-none overflow-hidden">

      {/* Едва заметное цветовое пятно: мягко разбавляет белый фон главной.
          Это только градиент (без изображений), очень низкой плотности, размытый,
          уходит за край — поэтому не выглядит отдельной подложкой и не мешает чтению.
          Цвет берётся из акцентной темы пользователя. */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div
          className="absolute -top-32 -right-28 w-[620px] h-[620px] rounded-full blur-3xl opacity-[0.12]"
          style={{ background: 'radial-gradient(circle at 50% 50%, var(--accent) 0%, var(--accent-60) 42%, transparent 70%)' }}
        />
      </div>

      {/* CENTER ZONE: приветствие, описание, сообщения портала, объявления */}
      <div className="relative z-10 flex-1 flex flex-col items-center justify-center text-center max-w-4xl mx-auto py-3 select-none overflow-y-auto min-h-0">

        {/* Логотип портала над приветствием: тот же фирменный файл, что в ша��ке.
            Пропорции заданы исходником 1261×385 (≈3,28:1) — высота задаётся,
            ширина считается сама, поэтому логотип не растягивается. */}
        <img
          src="/portal.svg"
          alt="Ratipa Portal"
          width={1261}
          height={385}
          draggable={false}
          className="h-7 sm:h-9 w-auto select-none mb-4 sm:mb-5"
        />

        {/* Приветствие: заметно крупнее и с акцентом портала */}
        <h1
          className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight leading-tight mb-3 select-text"
          style={{ color: '#121316' }}
        >
          {getTimeOfDayGreeting()}, <span className="text-[var(--accent)]">{greetingName}</span>
        </h1>

        <p className="text-xs sm:text-sm text-[#6B7280] max-w-2xl mx-auto leading-relaxed mb-7">
          Добро пожаловать в единую операционную среду Ratipa. Управляйте парком автомобилей, планируйте доходность и координируйте логистику в реальном времени.
        </p>

        {/* Бегущая строка портала — пользовательские фразы из настроек */}
        {phrasesAllowed && (
          <div className="flex items-center justify-center gap-2 mb-8 min-w-0 max-w-2xl mx-auto" aria-label="Сообщения портала">
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent-60)] shrink-0" aria-hidden="true" />
            <TypingText
              phrases={phrases}
              className="text-[11px] font-mono text-[#6B7280] tracking-tight truncate"
            />
          </div>
        )}

        {/* Объявления администратора */}
        {settings?.announcements && settings.announcements.length > 0 && (
          <div className="w-full max-w-2xl">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-2">
                <Bell size={14} className="text-[#9CA3AF]" />
                <span className="text-[10px] font-semibold text-[#121316]">Объявления</span>
              </div>
              {isAdmin && (
                <button
                  onClick={() => onNavigate('admin')}
                  className="flex items-center gap-1 h-7 text-[11px] font-medium text-[#6B7280] hover:text-[#121316] bg-white border border-[#E5E7EB] hover:border-[#D1D5DB] px-2 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
                  title="Редактировать объявления"
                >
                  <Pencil size={10} />
                  Правка
                </button>
              )}
            </div>
            <div className="space-y-2 text-left">
              {settings.announcements.slice(0, 5).map((ann) => (
                <div
                  key={ann.id}
                  className={"flex items-start gap-3 px-3.5 py-3 rounded-xl text-xs leading-relaxed border " + (
                    ann.important
                      ? "bg-amber-50 border-amber-200 text-[#121316] font-medium"
                      : "bg-[#F9FAFB] border-[#E5E7EB] text-[#4B5563]"
                  )}
                >
                  <span className="mt-0.5 shrink-0">
                    <Bell size={14} className={ann.important ? 'text-amber-600' : 'text-[#9CA3AF]'} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="leading-relaxed">{ann.text}</p>
                    <span className="text-[10px] text-[#9CA3AF] mt-1 block">{ann.author} • {ann.date}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>

      {/* BOTTOM ZONE: полезные ссылки с поиском */}
      {links.length > 0 && (
        <div className="relative z-10 w-full mt-8 select-none">
          {/* Шире остальных блоков: ссылок много, им нужна вся доступная ширина */}
          <div className="w-full max-w-[1600px] mx-auto mb-8">

            <div className="flex flex-wrap items-end justify-between gap-3 mb-3 px-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-[#121316]">Полезные ссылки</h2>
                <p className="text-[11px] text-[#6B7280] mt-0.5">
                  Часто используемые сервисы · {visibleLinks.length} из {links.length}
                </p>
              </div>
            </div>

            <div
              ref={linksGridRef}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-2.5 sm:gap-3"
            >
              {visibleLinks.map((link) => {
                const urlLower = String(link.url || '').toLowerCase();
                let iconEl = <ExternalLink size={15} className="text-[#9CA3AF] shrink-0" />;
                if (urlLower.includes('waze')) iconEl = <Map size={15} className="text-[var(--accent)] shrink-0" />;
                else if (urlLower.includes('google')) iconEl = <ExternalLink size={15} className="text-[var(--accent)] shrink-0" />;
                else if (urlLower.includes('yandex')) iconEl = <ExternalLink size={15} className="text-[var(--accent)] shrink-0" />;
                else if (urlLower.includes('booking') || urlLower.includes('hotel')) iconEl = <Wallet size={15} className="text-[var(--accent)] shrink-0" />;
                else if (urlLower.includes('fuel') || urlLower.includes('petrol') || urlLower.includes('gas')) iconEl = <Activity size={15} className="text-[var(--accent)] shrink-0" />;
                else if (urlLower.includes('map') || urlLower.includes('route')) iconEl = <Map size={15} className="text-[var(--accent)] shrink-0" />;
                const host = linkHost(link.url);
                return (
                  <a
                    key={link.id || link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${link.title} — ${host}`}
                    className="flex items-center gap-3 h-full min-h-[58px] bg-white hover:bg-[var(--accent-5)] border border-[#E5E7EB] hover:border-[var(--accent-30)] rounded-xl px-3.5 py-3 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:ring-offset-1"
                  >
                    <span className="w-9 h-9 rounded-lg bg-[var(--accent-8)] border border-[var(--accent-20)] flex items-center justify-center shrink-0 transition-colors">
                      {iconEl}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-[#121316] group-hover:text-[var(--accent)] truncate block leading-snug transition-colors">
                        {link.title}
                      </span>
                      <span className="text-[11px] text-[#6B7280] truncate block mt-0.5">
                        {(link as any).description || host}
                      </span>
                    </span>
                    <ExternalLink size={13} className="text-[#D1D5DB] group-hover:text-[var(--accent)] shrink-0 transition-colors" />
                  </a>
                );
              })}
            </div>

            {/* Остальные ссылки — в отдельном окне, главная не растягивается */}
            {links.length > visibleCount && (
              <button
                type="button"
                onClick={() => setAllLinksOpen(true)}
                className="mt-3 w-full sm:w-auto sm:ml-auto flex items-center justify-center gap-2 min-h-[44px] sm:h-10 px-4 bg-white hover:bg-[var(--accent-5)] border border-[#E5E7EB] hover:border-[var(--accent-30)] rounded-xl text-sm font-semibold text-[#121316] hover:text-[var(--accent)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:ring-offset-1"
                data-tour="all-links"
              >
                Все ссылки ({links.length})
                <ArrowRight size={15} className="shrink-0" aria-hidden="true" />
              </button>
            )}

          </div>
        </div>
      )}

      <AllLinksModal isOpen={allLinksOpen} links={links} onClose={() => setAllLinksOpen(false)} />

    </div>
  );
}

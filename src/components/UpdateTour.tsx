import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X, CalendarDays, UserCircle, Palette, LayoutDashboard, Check, Camera, Link2, LayoutGrid, Columns2, List } from 'lucide-react';
import { ACCENT_PRESETS } from '../theme/accent';

/**
 * Превью обновлений — короткое знакомство с изменениями при первом входе
 * после обновления приложения.
 *
 * Правила:
 *  - показывается один раз на пользователя и версию (факт хранится в профиле:
 *    users_list/{uid}.onboarding.{версия} = 'done' | 'skipped');
 *  - подсвечивает реальные элементы интерфейса (шапку и меню пользователя),
 *    ничего не нажимает за пользователя и не меняет работу этих элементов;
 *  - закрывается в любой момент: кнопка-крестик, «Пропустить», клавиша Escape
 *    или клик по затемнённой области;
 *  - шаг про акцентную тему показывается только когда выбор действительно
 *    доступен пользователю (палитра в настройках учётной записи).
 */

export interface UpdateStep {
  id: string;
  title: string;
  text: string;
  /** CSS-селектор подсвечиваемого элемента. Нет — карточка по центру. */
  selector?: string;
  /** Показать палитру акцентных цветов (персональные темы). */
  showPalette?: boolean;
  /** Подсказка про фотографию профиля и кадрирование. */
  showPhotoHint?: boolean;
  /** Подсказка про окно «Все ссылки». */
  showLinksHint?: boolean;
  /** Подсказка про переключатель вида списка. */
  showViewsHint?: boolean;
}

interface UpdateTourProps {
  isOpen: boolean;
  /** Доступен ли выбор акцентного цвета в настройках учётной записи. */
  accentAvailable: boolean;
  /** Сколько полезных ссылок настроено (0 — шаг про ссылки не показываем). */
  linksCount: number;
  /** Доступен ли пользователю раздел «Авто и водители» (иначе шаг про виды скрыт). */
  canSeeVehicles: boolean;
  onClose: (reason: 'done' | 'skipped') => void;
}

const CARD_W = 420;

export default function UpdateTour({ isOpen, accentAvailable, linksCount, canSeeVehicles, onClose }: UpdateTourProps) {
  const steps: UpdateStep[] = [
    {
      id: 'calendar',
      title: 'Дата и календарь в шапке',
      text: 'В шапке вместо значка календаря — сегодняшняя дата, например «2 окт.». Нажмите на неё, чтобы открыть календарь: месяцы с номерами недель, выбор даты и прокрутка колёсиком.',
      selector: 'button[aria-label^="Календарь"]',
    },
    {
      id: 'menu',
      title: 'Меню пользователя и настройки',
      text: 'Имя и аватар справа в шапке открывают меню. Пункт «Настройки учётной записи» — это профиль: фото, имя, пароль. Внизу меню указана версия приложения.',
      selector: 'button[title="Меню пользователя"]',
    },
    {
      id: 'photo',
      title: 'Фотография профиля',
      text: 'В настройках учётной записи можно добавить свою фотографию. Перед сохранением её предлагается кадрировать — выбрать нужный участок снимка. Открыть: меню пользователя → «Настройки учётной записи».',
      selector: 'button[title="Меню пользователя"]',
      showPhotoHint: true,
    },
    ...(accentAvailable ? [{
      id: 'theme',
      title: 'Персональная тема',
      text: 'Там же выбирается акцентный цвет интерфейса — он применяется ко всему порталу и сохраняется в вашей учётной записи.',
      selector: 'button[title="Меню пользователя"]',
      showPalette: true,
    }] : []),
    ...(linksCount > 0 ? [{
      id: 'links',
      title: 'Полезные ссылки',
      text: `На главной показана часть ссылок, остальные — по кнопке «Все ссылки (${linksCount})»: в окне весь список и поиск по названию и описанию.`,
      selector: '[data-tour="all-links"]',
      showLinksHint: true,
    }] : []),
    ...(canSeeVehicles ? [{
      id: 'views',
      title: 'Виды отображения авто и водителей',
      text: 'В разделе «Авто и водители» список можно показывать по-разному: сетка из четырёх колонок, широкие карточки или компактные строки. Переключатель — в панели над списком, справа от заголовка.',
      selector: '[aria-label="Вид списка"]',
      showViewsHint: true,
    }] : []),
    {
      id: 'design',
      title: 'Обновлённый дизайн',
      text: 'Интерфейс стал легче и понятнее: меньше рамок и цветных плашек, яснее заголовки и заметнее главные действия. Нужное находится быстрее.',
    },
  ];

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // Фактическая высота карточки: от неё зависит, встанет она под элементом или над ним,
  // чтобы не перекрывать подсвеченное место.
  const [cardH, setCardH] = useState(240);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  const step = steps[Math.min(index, steps.length - 1)];
  const isFirst = index === 0;
  const isLast = index >= steps.length - 1;

  // Отслеживаем положение подсвечиваемого элемента (в т.ч. при прокрутке и ресайзе)
  useLayoutEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      if (!step?.selector) { setRect(null); return; }
      // Элементов может быть несколько (мобильная и настольная версии) —
      // подсвечиваем первый видимый.
      const nodes = Array.from(document.querySelectorAll(step.selector));
      const el = nodes.find((n) => {
        const r = n.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      if (!el) { setRect(null); return; }
      setRect(el.getBoundingClientRect());
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isOpen, index, step?.selector]);

  useEffect(() => {
    if (isOpen) setIndex(0);
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  }, [isOpen, index, step?.id, cardH]);

  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => primaryRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [isOpen, index]);

  const next = useCallback(() => {
    if (isLast) onClose('done');
    else setIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [isLast, onClose, steps.length]);

  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  // Клавиатура: стрелки переключают шаги, Escape закрывает
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose('skipped'); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen, next, back, onClose]);

  // Возвращаем фокус на элемент, с которого открыли (обычно — пункт меню)
  useEffect(() => {
    if (isOpen) return;
    return () => { /* фокус вернёт вызывающая сторона */ };
  }, [isOpen]);

  if (!isOpen) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(CARD_W, vw - 24);

  // Карточка встаёт под подсвеченным элементом, не перекрывая его,
  // и не выходит за края экрана.
  let cardStyle: React.CSSProperties;
  if (rect) {
    const below = rect.bottom + 16;
    const fitsBelow = below + cardH + 12 < vh;
    const above = rect.top - cardH - 16;
    const top = fitsBelow ? below : Math.max(12, above);
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - cardW / 2, vw - cardW - 12));
    cardStyle = { top, left, width: cardW };
  } else {
    cardStyle = { top: Math.max(12, vh / 2 - cardH / 2), left: Math.max(12, (vw - cardW) / 2), width: cardW };
  }

  const palette = accentAvailable ? ACCENT_PRESETS.slice(0, 12) : [];

  return (
    <div className="fixed inset-0 z-[3000] max-md:z-[5600]" role="dialog" aria-modal="false" aria-label="Что нового в Ratipa Portal">
      {/* Затемнение с «окном» вокруг подсвеченного элемента.
          Слой прозрачный — затемнение даёт тень окна, клик закрывает превью. */}
      <div className="absolute inset-0" onClick={() => onClose('skipped')} aria-hidden="true" />
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute rounded-2xl ring-2 ring-[var(--accent)] shadow-[0_0_0_9999px_rgba(18,19,22,0.45)] transition-all duration-200"
          style={{
            top: Math.max(rect.top - 8, 4),
            left: Math.max(rect.left - 8, 4),
            width: rect.width + 16,
            height: rect.height + 16,
          }}
        />
      ) : (
        <div aria-hidden="true" className="absolute inset-0 bg-[#121316]/45" />
      )}

      <div
        ref={cardRef}
        className="absolute flex flex-col gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_25px_60px_rgba(0,0,0,0.28)] sm:p-5"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-10)] text-[var(--accent-ink)]">
            {step.id === 'calendar' ? <CalendarDays className="h-4 w-4" aria-hidden="true" />
              : step.id === 'menu' ? <UserCircle className="h-4 w-4" aria-hidden="true" />
              : step.id === 'photo' ? <Camera className="h-4 w-4" aria-hidden="true" />
              : step.id === 'theme' ? <Palette className="h-4 w-4" aria-hidden="true" />
              : step.id === 'links' ? <Link2 className="h-4 w-4" aria-hidden="true" />
              : step.id === 'views' ? <LayoutGrid className="h-4 w-4" aria-hidden="true" />
              : <LayoutDashboard className="h-4 w-4" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Что нового · шаг {index + 1} из {steps.length}
            </div>
            <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight text-[#121316]">{step.title}</h2>
          </div>
          <button
            type="button"
            onClick={() => onClose('skipped')}
            title="Закрыть"
            aria-label="Закрыть превью обновлений"
            className="-mr-1 -mt-1 flex h-9 w-9 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 shrink-0 items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <p className="text-xs leading-relaxed text-[#4B5563]">{step.text}</p>

        {step.showPhotoHint && (
          <div className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white border border-[#E5E7EB] text-[#6B7280]">
              <Camera className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-[11px] leading-relaxed text-[#6B7280]">
              Фотография хранится в вашей учётной записи. Кадрирование открывается сразу после выбора файла.
            </span>
          </div>
        )}

        {step.showLinksHint && (
          <div className="flex flex-col gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            <span className="flex items-center gap-2 text-[11px] text-[#6B7280]">
              <Link2 className="h-3.5 w-3.5 shrink-0 text-[var(--accent-ui)]" aria-hidden="true" />
              Блок «Полезные ссылки» на главной
            </span>
            <span className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[11px] font-semibold text-[#121316]">
              Все ссылки ({linksCount})
              <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
            </span>
          </div>
        )}

        {step.showViewsHint && (
          <div className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            <span className="inline-flex items-center gap-0.5 rounded-xl border border-[#E5E7EB] bg-[#F3F4F6] p-0.5">
              <span className="flex h-7 w-9 items-center justify-center rounded-lg bg-[#121316] text-white"><LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /></span>
              <span className="flex h-7 w-9 items-center justify-center rounded-lg text-[#4B5563]"><Columns2 className="h-3.5 w-3.5" aria-hidden="true" /></span>
              <span className="flex h-7 w-9 items-center justify-center rounded-lg text-[#4B5563]"><List className="h-3.5 w-3.5" aria-hidden="true" /></span>
            </span>
            <span className="text-[11px] leading-relaxed text-[#6B7280]">Сетка · широкие карточки · компактный список</span>
          </div>
        )}

        {step.showPalette && (
          <div className="flex flex-col gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-3">
            <span className="text-[11px] font-medium text-[#6B7280]">Доступные акцентные цвета</span>
            <div className="flex flex-wrap gap-1.5">
              {palette.map((p) => (
                <span
                  key={p.id}
                  title={p.name}
                  aria-hidden="true"
                  className="h-6 w-6 rounded-lg border border-black/10"
                  style={{ backgroundColor: p.hex }}
                />
              ))}
              <span className="self-center text-[11px] text-[#9CA3AF]">…и другие</span>
            </div>
            <span className="flex items-center gap-1.5 text-[11px] text-[#6B7280]">
              <Check className="h-3.5 w-3.5 text-[var(--accent-ui)]" aria-hidden="true" />
              Выбор сохраняется в вашей учётной записи — на других он не влияет.
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <div className="hidden flex-1 items-center gap-1 sm:flex" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${i === index ? 'w-5 bg-[var(--accent)]' : 'w-1.5 bg-[#D1D5DB]'}`}
              />
            ))}
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            <button
              type="button"
              onClick={() => onClose('skipped')}
              className="inline-flex cursor-pointer rounded-lg px-1.5 py-1 text-xs font-medium text-[#6B7280] transition-colors hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
            >
              Пропустить
            </button>
            {!isFirst && (
              <button
                type="button"
                onClick={back}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-1 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
              >
                <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Назад
              </button>
            )}
            <button
              ref={primaryRef}
              type="button"
              onClick={next}
              className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-solid)] px-3.5 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
            >
              {isLast ? 'Готово' : 'Далее'}
              {!isLast && <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

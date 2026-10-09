/**
 * ИНТЕРАКТИВНЫЙ ГАЙД по разделу «Таймлайн рейсов».
 *
 * Окно-мастер ПОВЕРХ таймлайна: шаги с прогресс-индикатором, кнопки «Назад» /
 * «Далее» / «Пропустить» / «Закрыть» (Esc), навигация клавиатурой (←/→),
 * фокус внутри окна (фокус-трап), aria-атрибуты. Спотлайт подсвечивает
 * РЕАЛЬНЫЕ элементы интерфейса: если элемента на экране нет (нет прав, нет
 * данных) — шаг в список не попадает (фильтрует вызывающий модуль).
 *
 * Тексты шагов — из ОДНОГО файла guide/guideContent.tsx; демо-иллюстрации —
 * из guide/guideDemos (изолированные данные, настоящие компоненты полос);
 * справочник обозначений — из ЕДИНОГО источника lib/legend (тот же список, что
 * показывает попап «Обозначения» на полотне).
 *
 * Прохождение (версия, шаг, дата) хранит ПРОФИЛЬ пользователя — запись делает
 * вызывающий модуль (TripTimelineModule) через dbService; окно только сообщает
 * о смене шага и причине закрытия.
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, HelpCircle, List, X } from 'lucide-react';
import type { UserProfile } from '../../../../types';
import type { DirectionDef } from '../lib/directions';
import { buildLegendItems } from '../lib/legend';
import { GUIDE_REFERENCE_BUTTONS, type GuideStep } from './guideContent';
import { GuideDemos } from './guideDemos';

const CARD_W = 480;

type GuideView = 'start' | 'whatsnew' | 'steps' | 'reference';

interface TripTimelineGuideProps {
  isOpen: boolean;
  user: UserProfile;
  /** Шаги роли (сценарий + отфильтрованные недоступные). */
  steps: GuideStep[];
  /** Направления — для общего с «Обозначениями» справочника. */
  directions: DirectionDef[];
  /** Показать «Что нового» первым экраном (версия гайда повысилась). */
  whatsNew?: string[] | null;
  /** Продолжить с шага (индекс), если прохождение не завершено. */
  resumeAt?: number | null;
  /** Открыть сразу на шаге (переход к нужному разделу). */
  openAt?: number | null;
  onClose: (reason: 'done' | 'skipped') => void;
  /** Смена шага — для сохранения прохождения в профиле. */
  onStepChange: (index: number) => void;
}

/** Первый видимый элемент по списку селекторов (иначе — null). */
const findVisible = (selectors: string[]): { el: HTMLElement; selector: string } | null => {
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
    const el = nodes.find((n) => {
      const r = n.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    if (el) return { el, selector };
  }
  return null;
};

/** Доступен ли шаг на экране: спотлайт-цель есть среди реальных элементов. */
export const guideStepAvailable = (step: GuideStep): boolean => {
  if (!step.spotlight) return true;
  return findVisible(step.spotlight.selectors) != null;
};

export default function TripTimelineGuide({
  isOpen,
  user,
  steps,
  directions,
  whatsNew,
  resumeAt,
  openAt,
  onClose,
  onStepChange,
}: TripTimelineGuideProps) {
  const [view, setView] = useState<GuideView>('start');
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [selUsed, setSelUsed] = useState<string>('');
  const [cardH, setCardH] = useState(280);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const safeIndex = Math.min(Math.max(index, 0), Math.max(0, steps.length - 1));
  const step = steps[safeIndex];
  const isFirst = safeIndex === 0;
  const isLast = safeIndex >= steps.length - 1;

  // Оглавление показываем всегда (переход к нужному разделу); шаг 7 включает
  // встроенную таблицу справочника.
  const legendItems = useMemo(() => buildLegendItems(directions), [directions]);

  // Открытие: «Что нового» → если просили, иначе оглавление; переход к шагу —
  // по openAt (кнопка «Обучение» → раздел), резюме — отдельной кнопкой.
  useEffect(() => {
    if (!isOpen) return;
    if (whatsNew && whatsNew.length) {
      setView('whatsnew');
      return;
    }
    if (typeof openAt === 'number' && openAt >= 0 && openAt < steps.length) {
      setIndex(openAt);
      setView('steps');
      return;
    }
    setView('start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // Смена шага — сообщаем наружу (запись прохождения в профиль).
  useEffect(() => {
    if (!isOpen || view !== 'steps') return;
    onStepChange(safeIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, view, safeIndex]);

  // Позиция подсветки: пересчитываем при открытии/смене шага/ресайзе/прокрутке.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const measure = () => {
      if (view !== 'steps' || !step?.spotlight) {
        setRect(null);
        setSelUsed('');
        return;
      }
      const found = findVisible(step.spotlight.selectors);
      if (!found) {
        setRect(null);
        setSelUsed('');
        return;
      }
      setSelUsed(found.selector);
      setRect(found.el.getBoundingClientRect());
    };
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [isOpen, view, safeIndex, step?.id, step?.spotlight]);

  // Фактическая высота карточки — от неё зависит, встанет она под элементом
  // или над ним (как в превью обновлений приложения).
  useLayoutEffect(() => {
    if (!isOpen) return;
    const h = cardRef.current?.offsetHeight;
    if (h && Math.abs(h - cardH) > 2) setCardH(h);
  }, [isOpen, view, safeIndex, step?.id, cardH]);

  // Фокус — на главную кнопку окна при каждом переходе.
  useEffect(() => {
    if (!isOpen) return;
    const t = window.setTimeout(() => primaryRef.current?.focus(), 60);
    return () => window.clearTimeout(t);
  }, [isOpen, view, safeIndex]);

  const next = useCallback(() => {
    if (isLast) onClose('done');
    else setIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [isLast, onClose, steps.length]);

  const back = useCallback(() => setIndex((i) => Math.max(i - 1, 0)), []);

  /** Переход к разделу из оглавления. */
  const jumpTo = useCallback((i: number) => {
    setIndex(Math.max(0, Math.min(i, steps.length - 1)));
    setView('steps');
  }, [steps.length]);

  // Клавиатура: Esc закрывает, ←/→ листают шаги (в режиме шагов), Tab не
  // выпускает фокус из окна (фокус-трап).
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose('skipped');
        return;
      }
      if (e.key === 'ArrowRight' && view === 'steps') {
        e.preventDefault();
        next();
        return;
      }
      if (e.key === 'ArrowLeft' && view === 'steps') {
        e.preventDefault();
        back();
        return;
      }
      if (e.key === 'Tab') {
        const root = rootRef.current;
        if (!root) return;
        const nodes = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((n) => n.getClientRects().length > 0);
        if (!nodes.length) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement as HTMLElement | null;
        if (e.shiftKey) {
          if (active === first || !root.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [isOpen, view, next, back, onClose]);

  if (!isOpen) return null;

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const isNarrow = vw < 768;
  const cardW = Math.min(CARD_W, vw - 24);

  // Карточка встаёт рядом с подсвеченным элементом, не перекрывая его,
  // и не выходит за края экрана; на узких экранах — нижним листом.
  let cardStyle: React.CSSProperties;
  if (isNarrow) {
    cardStyle = { left: 8, right: 8, bottom: 8, width: 'auto', maxHeight: Math.max(260, vh - 120) };
  } else if (rect) {
    const below = rect.bottom + 14;
    const fitsBelow = below + Math.min(cardH, 460) + 12 < vh;
    const above = rect.top - Math.min(cardH, 460) - 14;
    const top = fitsBelow ? below : Math.max(12, above);
    const left = Math.max(12, Math.min(rect.left + rect.width / 2 - cardW / 2, vw - cardW - 12));
    cardStyle = { top, left, width: cardW, maxHeight: Math.max(260, vh - top - 16) };
  } else {
    cardStyle = {
      top: Math.max(12, vh / 2 - Math.min(cardH, 460) / 2),
      left: Math.max(12, (vw - cardW) / 2),
      width: cardW,
      maxHeight: vh - 24,
    };
  }

  const progressText = view === 'steps' ? `шаг ${safeIndex + 1} из ${steps.length}` : '';

  return (
    <div
      ref={rootRef}
      data-ui="tl-guide"
      data-guide-view={view}
      data-guide-step={view === 'steps' ? safeIndex : undefined}
      data-guide-step-id={view === 'steps' ? step?.id : undefined}
      className="fixed inset-0 z-[5200]"
      role="dialog"
      aria-modal="true"
      aria-label="Обучение: Таймлайн рейсов"
    >
      {/* Клик по затемнению закрывает гайд (как превью обновлений приложения) */}
      <div className="absolute inset-0" onClick={() => onClose('skipped')} aria-hidden="true" />

      {/* Спотлайт реального элемента: окно в затемнении + акцентная рамка */}
      {rect && view === 'steps' ? (
        <div
          aria-hidden="true"
          data-guide-spotlight="1"
          data-guide-target={selUsed}
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
        data-guide-card="1"
        className="absolute flex flex-col gap-3 overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white p-4 shadow-[0_25px_60px_rgba(0,0,0,0.28)] sm:p-5"
        style={cardStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Шапка: иконка, заголовок, вкладки, закрыть */}
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-10)] text-[var(--accent-ink)]">
            {view === 'reference' ? <BookOpen className="h-4 w-4" aria-hidden="true" /> : step?.icon ?? <HelpCircle className="h-4 w-4" aria-hidden="true" />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">
              Обучение · Таймлайн рейсов{progressText ? ` · ${progressText}` : ''}
            </div>
            <h2 className="mt-0.5 text-[15px] font-semibold tracking-tight text-[#121316]" aria-live="polite">
              {view === 'start'
                ? 'Интерактивный гайд'
                : view === 'whatsnew'
                  ? 'Что нового в гайде'
                  : view === 'reference'
                    ? 'Справочник обозначений'
                    : step?.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={() => onClose('skipped')}
            title="Закрыть · Esc"
            aria-label="Закрыть обучение"
            className="-mr-1 -mt-1 flex h-9 w-9 min-h-[44px] min-w-[44px] md:min-h-0 md:min-w-0 shrink-0 items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] cursor-pointer"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        {/* Вкладки окна: обучение и справочник (справочник доступен всегда) */}
        <div className="flex items-center gap-1.5 border-b border-[#F1F2F4] pb-2" role="tablist" aria-label="Разделы обучения">
          <button
            type="button"
            role="tab"
            aria-selected={view !== 'reference'}
            data-guide-tab="guide"
            onClick={() => setView('start')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] ${
              view !== 'reference' ? 'bg-[var(--accent-10)] text-[var(--accent-ink)]' : 'text-[#6B7280] hover:bg-[#F3F4F6]'
            }`}
          >
            <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
            Гайд
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'reference'}
            data-guide-tab="reference"
            onClick={() => setView('reference')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] ${
              view === 'reference' ? 'bg-[var(--accent-10)] text-[var(--accent-ink)]' : 'text-[#6B7280] hover:bg-[#F3F4F6]'
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            Справочник
          </button>
          {view === 'steps' ? (
            <button
              type="button"
              data-guide-tab="chapters"
              onClick={() => setView('start')}
              className="ml-auto inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-[#6B7280] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
              title="К оглавлению гайда"
            >
              <List className="h-3.5 w-3.5" aria-hidden="true" />
              К оглавлению
            </button>
          ) : null}
        </div>

        {/* Тело окна */}
        <div className="min-h-0 flex-1 overflow-y-auto pr-0.5" data-guide-body="1">
          {view === 'whatsnew' && whatsNew?.length ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-xs leading-relaxed text-[#4B5563]">
                Раздел «Таймлайн рейсов» обновился — в обучении появились новые материалы. Коротко о том, что изменилось:
              </p>
              <ul className="flex flex-col gap-1.5">
                {whatsNew.map((w, i) => (
                  <li key={i} className="flex gap-2 text-xs leading-relaxed text-[#4B5563]">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                    {w}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] leading-relaxed text-[#6B7280]">
                Гайд можно проходить заново в любой момент: кнопка «Обучение» в верхней панели таймлайна.
              </p>
            </div>
          ) : null}

          {view === 'start' ? (
            <div className="flex flex-col gap-2.5">
              <p className="text-xs leading-relaxed text-[#4B5563]">
                Гайд объясняет, как устроен таймлайн, куда что вносится и как читать цвета. Каждый шаг подсвечивает
                реальный элемент экрана{user.role === 'dispatcher' ? ' — сценарий диспетчера' : ''}.
              </p>
              {typeof resumeAt === 'number' && resumeAt > 0 && resumeAt < steps.length ? (
                <button
                  type="button"
                  data-guide-action="resume"
                  onClick={() => jumpTo(resumeAt)}
                  className="inline-flex w-fit items-center gap-1.5 rounded-xl border border-[var(--accent-40)] bg-[var(--accent-10)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--accent-15)] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                  Продолжить с шага {resumeAt + 1}: {steps[resumeAt]?.short}
                </button>
              ) : null}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Разделы гайда</span>
                {steps.map((s, i) => (
                  <button
                    key={s.id}
                    type="button"
                    data-guide-chapter={s.id}
                    onClick={() => jumpTo(i)}
                    className="group flex items-center gap-2 rounded-xl border border-[#E5E7EB] bg-white px-2.5 py-2 text-left transition-colors hover:border-[var(--accent-40)] hover:bg-[#FAFAFB] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                  >
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#4B5563] group-hover:bg-[var(--accent-10)] group-hover:text-[var(--accent-ink)]">
                      <span className="text-[10px] font-bold tabular-nums">{i + 1}</span>
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#121316]">{s.short}</span>
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {view === 'steps' && step ? (
            <div className="flex flex-col gap-2.5">
              {step.paragraphs.map((p, i) => (
                <p key={i} className="text-xs leading-relaxed text-[#4B5563]">
                  {p}
                </p>
              ))}
              {step.bullets?.length ? (
                <ul className="flex flex-col gap-1.5">
                  {step.bullets.map((b, i) => (
                    <li key={i} className="flex gap-2 text-xs leading-relaxed text-[#4B5563]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                      {b}
                    </li>
                  ))}
                </ul>
              ) : null}
              {step.spotlight?.hint && rect ? (
                <div className="inline-flex w-fit items-center gap-1.5 rounded-lg border border-[var(--accent-40)] bg-[var(--accent-10)] px-2 py-1 text-[10px] font-medium text-[var(--accent-ink)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                  Подсвечено: {step.spotlight.hint}
                </div>
              ) : null}
              {step.spotlight && !rect ? (
                <div className="rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2 py-1.5 text-[10px] leading-[14px] text-[#6B7280]">
                  Элемент не найден на экране — посмотрите шаг без подсветки; кнопка «Далее» продолжит обучение.
                </div>
              ) : null}
              {step.demos?.length ? <GuideDemos ids={step.demos} /> : null}
              {step.showReference ? (
                <GuideReferenceTable items={legendItems} />
              ) : null}
            </div>
          ) : null}

          {view === 'reference' ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs leading-relaxed text-[#4B5563]">
                Полная таблица обозначений таймлайна. Тот же список открывается кнопкой «Обозначения» на полотне —
                источник один (lib/legend), поэтому подписи и цвета не расходятся.
              </p>
              <GuideReferenceTable items={legendItems} />
              <div className="flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Кнопки и клавиши</span>
                {GUIDE_REFERENCE_BUTTONS.map((r, i) => (
                  <div key={i} className="flex items-start gap-2" data-guide-ref-button={i}>
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#4B5563]">
                      {r.icon}
                    </span>
                    <span className="min-w-0 text-[11px] leading-[15px] text-[#4B5563]">
                      <b className="text-[#121316]">{r.title}</b> — {r.meaning}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {/* Прогресс + кнопки */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1">
          <div className="hidden flex-1 items-center gap-1 sm:flex" aria-hidden="true">
            {steps.map((s, i) => (
              <span
                key={s.id}
                className={`h-1.5 rounded-full transition-all ${view === 'steps' && i === safeIndex ? 'w-5 bg-[var(--accent)]' : 'w-1.5 bg-[#D1D5DB]'}`}
              />
            ))}
          </div>
          <div className="flex flex-1 items-center justify-end gap-2 sm:flex-none">
            {view === 'whatsnew' ? (
              <button
                type="button"
                data-guide-action="begin"
                ref={primaryRef}
                onClick={() => setView('start')}
                className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-solid)] px-3.5 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
              >
                К оглавлению
                <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            ) : null}
            {view === 'start' ? (
              <>
                <button
                  type="button"
                  data-guide-action="close"
                  onClick={() => onClose('skipped')}
                  className="inline-flex cursor-pointer rounded-lg px-1.5 py-1 text-xs font-medium text-[#6B7280] transition-colors hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                >
                  Пропустить
                </button>
                <button
                  type="button"
                  data-guide-action="begin"
                  ref={primaryRef}
                  onClick={() => jumpTo(0)}
                  className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-solid)] px-3.5 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                >
                  Начать с начала
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            ) : null}
            {view === 'steps' ? (
              <>
                <button
                  type="button"
                  data-guide-action="skip"
                  onClick={() => onClose('skipped')}
                  className="inline-flex cursor-pointer rounded-lg px-1.5 py-1 text-xs font-medium text-[#6B7280] transition-colors hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                >
                  Пропустить
                </button>
                {!isFirst ? (
                  <button
                    type="button"
                    data-guide-action="back"
                    onClick={back}
                    className="inline-flex min-h-[40px] cursor-pointer items-center gap-1 rounded-xl border border-[#E5E7EB] bg-white px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                    Назад
                  </button>
                ) : null}
                <button
                  type="button"
                  data-guide-action="next"
                  ref={primaryRef}
                  onClick={next}
                  className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-solid)] px-3.5 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                >
                  {isLast ? 'Начать работу' : 'Далее'}
                  {!isLast ? <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                </button>
              </>
            ) : null}
            {view === 'reference' ? (
              <>
                <button
                  type="button"
                  data-guide-action="close"
                  onClick={() => onClose('skipped')}
                  className="inline-flex cursor-pointer rounded-lg px-1.5 py-1 text-xs font-medium text-[#6B7280] transition-colors hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                >
                  Пропустить
                </button>
                <button
                  type="button"
                  data-guide-action="back-to-guide"
                  ref={primaryRef}
                  onClick={() => setView('start')}
                  className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-xl bg-[var(--accent-solid)] px-3.5 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                >
                  <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  К обучению
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Таблица справочника: образец + подпись (данные — из lib/legend). */
export function GuideReferenceTable({ items }: { items: Array<{ swatch: React.ReactNode; label: string }> }) {
  return (
    <div className="flex flex-col gap-1.5" data-guide-reference="1">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-2" data-guide-ref-row={i}>
          <span className="inline-flex w-[26px] shrink-0 items-center justify-center">{it.swatch}</span>
          <span className="min-w-0 text-[10px] leading-[13px] text-[#4B5563]">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

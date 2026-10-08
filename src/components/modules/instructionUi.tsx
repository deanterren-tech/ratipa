import { useLayoutEffect, useMemo, useRef } from 'react';
import { ClipboardList, ExternalLink, Info, Lightbulb, ListChecks } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { InstructionData, InstructionStepItem } from './instructionsData';
import { paragraphList, toStepItems } from './instructionsData';

/**
 * Общие элементы инструкции: используются и просмотром, и редактором (в том числе
 * режимом «Просмотр» черновика), чтобы итоговый вид нигде не расходился.
 *
 * Дизайн-токены портала: холст #F9FAFB, акцент var(--accent*), rounded-2xl,
 * мобильные цели min-h-[44px].
 */

/** Заголовок раздела инструкции — одинаковый в просмотре и в редакторе. */
export function SectionHeading({
  icon: Icon,
  children,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
}) {
  return (
    <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </h2>
  );
}

/** Номер шага — тот же кружок с акцентом, что и в готовой инструкции. */
export function StepBadge({ n, className = '' }: { n: number; className?: string }) {
  return (
    <span
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-15)] text-[11px] font-semibold text-[var(--accent-ink)] ${className}`}
    >
      {n}
    </span>
  );
}

/** Текст с абзацами: переносы строк внутри шага показываются абзацами, теги не видны. */
export function ParagraphText({ text, className = '' }: { text: string; className?: string }) {
  const paragraphs = useMemo(() => {
    const list = paragraphList(text);
    return list.length > 0 ? list : [''];
  }, [text]);
  return (
    <span className={className}>
      {paragraphs.map((p, i) => (
        <span key={i} className={i === 0 ? 'block' : 'mt-2 block'}>
          {p}
        </span>
      ))}
    </span>
  );
}

/**
 * Редактируемый блок с автоматической высотой: выглядит как обычный текст
 * (крупный заголовок, абзац шага), но редактируется прямо на месте.
 */
export function AutoGrowTextarea({
  value,
  onChange,
  placeholder,
  className = '',
  ariaLabel,
  taRef,
  onKeyDown,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
  taRef?: (el: HTMLTextAreaElement | null) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const h = el.scrollHeight;
    if (h > 0) el.style.height = `${h}px`;
  }, [value]);

  return (
    <textarea
      ref={(el) => {
        innerRef.current = el;
        taRef?.(el);
      }}
      rows={1}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      aria-label={ariaLabel}
      spellCheck={false}
      className={`w-full resize-none overflow-hidden bg-transparent focus:outline-none ${className}`}
    />
  );
}

const EMPTY_STEP: InstructionStepItem = { id: 'empty', text: 'Шаги пока не описаны.' };

/**
 * Итоговое содержимое инструкции: тема, название, описание, разделы, шаги, ссылки.
 * Один рендер на просмотр и на предпросмотр черновика — вид не расходится.
 */
export function InstructionBody({
  data,
  interactiveLinks = true,
}: {
  data: InstructionData;
  interactiveLinks?: boolean;
}) {
  const steps = useMemo(() => {
    const items = toStepItems(data);
    return items.length > 0 ? items : [EMPTY_STEP];
  }, [data]);

  const prerequisites = data.prerequisites || [];
  const tips = data.tips || [];
  const links = data.links || [];

  return (
    <div className="mx-auto w-full max-w-3xl">
      <span className="inline-block rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#4B5563]">
        {data.theme || 'Прочее'}
      </span>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#121316] sm:text-3xl">{data.title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">{data.summary}</p>

      {data.needsWork && (
        <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
          <p className="text-xs leading-relaxed text-amber-900">
            Содержание требует уточнения: порядок шагов ещё не согласован. Инструкцию заполняют, когда процесс подтвердят.
          </p>
        </div>
      )}

      {prerequisites.length > 0 && (
        <section className="mt-6">
          <SectionHeading icon={ClipboardList}>Что понадобится</SectionHeading>
          <ul className="mt-2 space-y-1.5 rounded-2xl border border-[#E5E7EB] bg-white p-4">
            {prerequisites.map((p, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm leading-relaxed text-[#121316]">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9CA3AF]" aria-hidden="true" />
                <ParagraphText text={p} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="mt-6">
        <SectionHeading icon={ListChecks}>Порядок действий</SectionHeading>
        <ol className="mt-2 space-y-2.5 rounded-2xl border border-[#E5E7EB] bg-white p-4">
          {steps.map((s, idx) => (
            <li key={s.id || idx} className="flex items-start gap-3 text-sm leading-relaxed text-[#121316]">
              <StepBadge n={idx + 1} className="mt-px" />
              <ParagraphText text={s.text} className="min-w-0 flex-1" />
            </li>
          ))}
        </ol>
      </section>

      {tips.length > 0 && (
        <section className="mt-6">
          <SectionHeading icon={Lightbulb}>Подсказки и частые ошибки</SectionHeading>
          <ul className="mt-2 space-y-2 rounded-2xl border border-[#E5E7EB] bg-white p-4">
            {tips.map((t, idx) => (
              <li key={idx} className="flex items-start gap-2.5 text-sm leading-relaxed text-[#4B5563]">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
                <ParagraphText text={t} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {links.length > 0 && (
        <section className="mt-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Где это в приложении</h2>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {links.map((l) => (
              interactiveLinks ? (
                <button
                  key={l.module}
                  type="button"
                  onClick={() => { window.location.hash = l.module; }}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--accent-solid)] px-4 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                >
                  {l.label}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              ) : (
                <span
                  key={l.module}
                  className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--accent-solid)] px-4 text-xs font-semibold text-[var(--accent-on)] opacity-90"
                >
                  {l.label}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              )
            ))}
          </div>
        </section>
      )}

      <p className="mt-6 text-[11px] leading-relaxed text-[#9CA3AF]">
        Инструкция только подсказывает порядок работы и ничего не меняет в данных и статусах.
      </p>
    </div>
  );
}

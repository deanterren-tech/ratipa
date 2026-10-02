import { useEffect, useMemo, useState } from 'react';
import { Search, X, ChevronDown, BookMarked, ExternalLink, ListChecks, Lightbulb, Info } from 'lucide-react';
import { AppSettings, Instruction } from '../types';
import { PORTAL_INSTRUCTIONS, normalizeInstruction, searchBlob } from './modules/instructionsData';

/**
 * «Инструкции по порталу» — открывается из меню пользователя.
 *
 * Это подсказки про сам портал: как пользоваться разделами, таблицами, настройками
 * учётной записи. Рабочие ситуации живут в модуле «Инструкции» раздела «Текущее».
 * Содержимое — appSettings.portalInstructions, запасной набор — в коде.
 */

interface Props {
  isOpen: boolean;
  settings?: AppSettings | null;
  onClose: () => void;
}

export default function PortalInstructionsModal({ isOpen, settings, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const instructions: Instruction[] = useMemo(() => {
    const fromDb = settings?.portalInstructions;
    const raw = Array.isArray(fromDb) && fromDb.length > 0 ? fromDb : PORTAL_INSTRUCTIONS;
    return raw.filter((i) => i && i.id && i.title).map(normalizeInstruction);
  }, [settings?.portalInstructions]);

  useEffect(() => {
    if (!isOpen) {
      setQuery('');
      setOpenId(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  const found = useMemo(() => {
    const q = query.toLowerCase().replace(/\s+/g, ' ').trim();
    return instructions.filter((i) => (q ? searchBlob(i).includes(q) : true));
  }, [instructions, query]);

  const grouped = useMemo(() => {
    const order: string[] = [];
    found.forEach((i) => {
      const t = i.theme || 'Прочее';
      if (!order.includes(t)) order.push(t);
    });
    return order.map((t) => ({ theme: t, items: found.filter((i) => (i.theme || 'Прочее') === t) }));
  }, [found]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-[2px] sm:items-center sm:p-6"
      data-scroll-lock="modal"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Инструкции по порталу"
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 my-4 flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-[0_25px_60px_rgba(0,0,0,0.12)]"
      >
        <div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] text-[var(--accent-ink)]">
              <BookMarked className="h-4 w-4" aria-hidden="true" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-[#121316]">Инструкции по порталу</h2>
              <p className="mt-0.5 text-[11px] text-[#6B7280]">Как пользоваться разделами, таблицами и настройками</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            title="Закрыть"
            className="rounded-xl border border-[#E5E7EB] bg-slate-100 p-1.5 text-[#9CA3AF] shadow-sm transition-colors hover:bg-slate-200 hover:text-[#121316]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="border-b border-[#E5E7EB] px-5 py-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: таблица, фото, ссылки, вид списка…"
              aria-label="Поиск по инструкциям портала"
              className="w-full rounded-xl border border-[#E5E7EB] bg-white py-2.5 pl-9 pr-9 text-xs text-[#121316] transition focus:border-[var(--accent-ui)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)]"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Очистить поиск"
                title="Очистить поиск"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {grouped.length === 0 && (
            <div className="flex flex-col items-center gap-1.5 py-8 text-center">
              <Search className="h-5 w-5 text-[#9CA3AF]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#121316]">Ничего не найдено</p>
              <p className="text-xs text-[#6B7280]">Попробуйте другое слово.</p>
            </div>
          )}

          {grouped.map((group) => (
            <section key={group.theme} className="mb-4 last:mb-0">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[#6B7280]">{group.theme}</h3>
              <div className="mt-2 flex flex-col gap-1.5">
                {group.items.map((i) => {
                  const isOpen = openId === i.id;
                  return (
                    <div key={i.id} className="overflow-hidden rounded-xl border border-[#E5E7EB] bg-white">
                      <button
                        type="button"
                        onClick={() => setOpenId(isOpen ? null : i.id)}
                        aria-expanded={isOpen}
                        className="flex w-full items-start gap-2.5 px-3.5 py-3 text-left transition-colors hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-semibold text-[#121316]">{i.title}</span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-[#6B7280]">{i.summary}</span>
                        </span>
                        <ChevronDown
                          className={`mt-0.5 h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform ${isOpen ? 'rotate-180' : ''}`}
                          aria-hidden="true"
                        />
                      </button>

                      {isOpen && (
                        <div className="border-t border-[#E5E7EB] px-3.5 py-3">
                          {!!i.prerequisites?.length && (
                            <div className="mb-3">
                              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">Что понадобится</span>
                              <ul className="mt-1.5 space-y-1">
                                {i.prerequisites.map((p, idx) => (
                                  <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-[#121316]">
                                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#9CA3AF]" aria-hidden="true" />
                                    {p}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                            <ListChecks className="h-3 w-3" aria-hidden="true" />
                            Порядок действий
                          </span>
                          <ol className="mt-1.5 space-y-2">
                            {i.steps.map((s, idx) => (
                              <li key={idx} className="flex items-start gap-2.5 text-xs leading-relaxed text-[#121316]">
                                <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-15)] text-[10px] font-semibold text-[var(--accent-ink)]">
                                  {idx + 1}
                                </span>
                                <span>{s}</span>
                              </li>
                            ))}
                          </ol>

                          {!!i.tips?.length && (
                            <div className="mt-3">
                              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280]">
                                <Lightbulb className="h-3 w-3" aria-hidden="true" />
                                Подсказки
                              </span>
                              <ul className="mt-1.5 space-y-1.5">
                                {i.tips.map((t, idx) => (
                                  <li key={idx} className="flex items-start gap-2 text-xs leading-relaxed text-[#4B5563]">
                                    <Info className="mt-0.5 h-3 w-3 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
                                    {t}
                                  </li>
                                ))}
                              </ul>
                            </div>
                          )}

                          {!!i.links?.length && (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {i.links.map((l) => (
                                <button
                                  key={l.module}
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    window.location.hash = l.module;
                                  }}
                                  className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-[var(--accent-solid)] px-3 text-[11px] font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)]"
                                >
                                  {l.label}
                                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>

        <div className="border-t border-[#E5E7EB] px-5 py-3">
          <p className="text-[11px] leading-relaxed text-[#9CA3AF]">
            Инструкции по рабочим ситуациям — в разделе «Текущее» → «Инструкции».
          </p>
        </div>
      </div>
    </div>
  );
}

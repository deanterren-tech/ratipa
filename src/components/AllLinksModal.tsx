import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, ExternalLink, Link2, Map, Wallet, Activity } from 'lucide-react';
import { QuickLink } from '../types';
import { useModalKeyboard } from '../hooks/useModalKeyboard';

/**
 * Все полезные ссылки портала.
 *
 * На главной помещается лишь часть ссылок, поэтому полный список открывается
 * в этом окне: поиск по названию, описанию и адресу, прокрутка содержимого,
 * закрытие кнопкой, клавишей Escape и кликом по затемнённой области.
 *
 * Ссылки открываются ровно так же, как на главной — в новой вкладке
 * (target="_blank" + rel="noopener noreferrer"), адреса не подменяются.
 */

interface AllLinksModalProps {
  isOpen: boolean;
  links: QuickLink[];
  onClose: () => void;
}

/** Домен ссылки — вторичная подпись, если описания нет. */
function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return String(url || '').replace(/^https?:\/\//, '').split('/')[0];
  }
}

/** Значок карточки — по назначению ссылки, как на главной. */
function linkIcon(url: string) {
  const u = String(url || '').toLowerCase();
  const cls = 'text-[var(--accent)] shrink-0';
  if (u.includes('waze') || u.includes('map') || u.includes('route')) return <Map size={17} className={cls} />;
  if (u.includes('booking') || u.includes('hotel')) return <Wallet size={17} className={cls} />;
  if (u.includes('fuel') || u.includes('petrol') || u.includes('gas')) return <Activity size={17} className={cls} />;
  if (u.includes('toll') || u.includes('platon') || u.includes('avtodor') || u.includes('beltoll')) return <Link2 size={17} className={cls} />;
  if (u.includes('alta') || u.includes('tamdoc') || u.includes('tnved')) return <Link2 size={17} className={cls} />;
  return <ExternalLink size={17} className="text-[#9CA3AF] shrink-0" />;
}

export default function AllLinksModal({ isOpen, links, onClose }: AllLinksModalProps) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Каждое открытие — чистый поиск, прежний запрос не тянется за пользователем
  useEffect(() => {
    if (isOpen) setQuery('');
  }, [isOpen]);

  useModalKeyboard({
    isOpen,
    onClose,
    initialFocusSelector: '#all-links-search',
    skipInitialFocus: false,
  });

  /** Поиск по названию, описанию и адресу — как в блоке на главной. */
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return links;
    return links.filter((l) => {
      const haystack = [l.title, (l as any).description, linkHost(l.url), String(l.url || '')]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [links, query]);

  if (!isOpen) return null;

  const total = links.length;

  return createPortal(
    <div
      data-scroll-lock="modal"
      className="fixed inset-0 z-[5000] bg-black/40 backdrop-blur-[2px] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Все полезные ссылки"
        className="relative z-10 w-full max-w-2xl my-3 sm:my-0 bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.12)] flex flex-col max-h-[92vh] sm:max-h-[88vh] overflow-hidden"
      >
        {/* Шапка: название, количество и закрытие */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3.5 border-b border-[#E5E7EB] shrink-0">
          <h2 className="text-base font-bold text-[#121316] whitespace-nowrap">Все ссылки</h2>
          <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-[var(--accent-10)] border border-[var(--accent-20)] text-[11px] font-semibold text-[var(--accent-ink)] leading-[20px] text-center tabular-nums shrink-0">
            {total}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="ml-auto shrink-0 p-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 border shadow-sm transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
          >
            <X className="w-4 h-4 text-[#6B7280]" aria-hidden="true" />
          </button>
        </div>

        {/* Поиск по названию и описанию */}
        <div className="px-4 sm:px-5 py-3 border-b border-[#E5E7EB] shrink-0">
          <div className="relative w-full">
            <Search className="w-4 h-4 text-[#9CA3AF] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" aria-hidden="true" />
            <input
              id="all-links-search"
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск: название или описание"
              aria-label="Поиск полезных ссылок"
              className="w-full h-10 pl-9 pr-9 bg-white border border-[#E5E7EB] rounded-lg text-sm text-[#121316] placeholder:text-[#9CA3AF] focus:outline-none focus:border-[var(--accent-ui)] focus:ring-2 focus:ring-[var(--accent-30)] transition-colors"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="Очистить поиск"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-[#9CA3AF] hover:text-[#121316] rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Полный список ссылок — прокручивается, если не помещается */}
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 sm:px-4 py-3">
          {filtered.length === 0 ? (
            <div className="text-center py-10 border border-dashed border-[#E5E7EB] rounded-xl bg-white">
              <p className="text-sm text-[#6B7280]">По запросу «{query}» ссылок не найдено.</p>
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-2 text-xs font-medium text-[var(--accent)] hover:underline cursor-pointer"
              >
                Показать все ссылки
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {filtered.map((link) => {
                const host = linkHost(link.url);
                const subtitle = (link as any).description || host;
                return (
                  <a
                    key={link.id || link.url}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={`${link.title} — ${host}`}
                    className="flex items-center gap-3 min-h-[56px] bg-white hover:bg-[var(--accent-5)] border border-[#E5E7EB] hover:border-[var(--accent-30)] rounded-xl px-3.5 py-3 transition-colors group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:ring-offset-1"
                  >
                    <span className="w-9 h-9 rounded-lg bg-[var(--accent-8)] border border-[var(--accent-20)] flex items-center justify-center shrink-0">
                      {linkIcon(link.url)}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-[#121316] group-hover:text-[var(--accent)] truncate block leading-snug transition-colors">
                        {link.title}
                      </span>
                      <span className="text-[11px] text-[#6B7280] truncate block mt-0.5">{subtitle}</span>
                    </span>
                    <ExternalLink size={14} className="text-[#D1D5DB] group-hover:text-[var(--accent)] shrink-0 transition-colors" aria-hidden="true" />
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {/* Подвал: подсказка и закрытие (удобно на телефоне) */}
        <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-t border-[#E5E7EB] shrink-0">
          <p className="text-[11px] text-[#9CA3AF] flex-1">Ссылки открываются в новой вкладке</p>
          <button
            type="button"
            onClick={onClose}
            className="h-9 sm:h-8 px-4 rounded-lg bg-[var(--accent)] text-[var(--accent-on)] text-xs font-semibold hover:bg-[var(--accent-hover)] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
          >
            Закрыть
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

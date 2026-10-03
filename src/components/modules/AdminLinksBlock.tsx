import React, {useMemo, useRef, useState} from 'react'
import {UserProfile, AppSettings, QuickLink, ExternalTab} from '../../types'
import {Check, ChevronDown, ChevronUp, ExternalLink, Globe, GripVertical, Link, Pencil, Plus, RefreshCw, Trash2, X} from 'lucide-react'
import { UI, plural } from '../../ui/kit';
import { SectionHeader, SearchField, EmptyState } from '../../ui/components';
import { useDialog } from '../DialogProvider';

interface Props {
  user: UserProfile;
  settings: AppSettings | null;
  onSave: (s: AppSettings) => void;
}

/** Общая форма элемента обоих списков: QuickLink и ExternalTab совпадают по структуре. */
interface LinkItem {
  id: string;
  title: string;
  url: string;
}

/* Кнопки-иконки карточки: на тач-экранах крупные (min 44px), на десктопе компактнее. */
const iconBtnBase =
  'inline-flex items-center justify-center shrink-0 rounded-lg transition-colors cursor-pointer min-h-[44px] min-w-[38px] sm:min-h-[34px] sm:min-w-[34px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)] disabled:opacity-30 disabled:cursor-default disabled:hover:bg-transparent';
const iconBtnIdle = `${iconBtnBase} text-[#9CA3AF] hover:text-[#121316] hover:bg-[#F3F4F6] disabled:hover:text-[#9CA3AF]`;
const iconBtnDanger = `${iconBtnBase} text-[#9CA3AF] hover:text-rose-600 hover:bg-rose-50 disabled:hover:text-[#9CA3AF]`;
const iconBtnSuccess = `${iconBtnBase} text-[var(--accent-ink)] hover:text-[var(--accent-ui)] hover:bg-[var(--accent-10)]`;

function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const copy = [...arr];
  const [item] = copy.splice(from, 1);
  copy.splice(to, 0, item);
  return copy;
}

/** Enter в поле = отправить форму: родитель перехватывает Enter и снимает фокус,
 *  поэтому подтверждаем отправку явно, не полагаясь на неявный submit. */
function submitOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  e.currentTarget.form?.requestSubmit();
}

/** Глобальный хук портала (useKeyboardShortcuts) перехватывает Enter на кнопках
 *  вне полей ввода: вместо действия кнопки он нажимает скрытую «Сохранить и
 *  перезагрузить» и перезагружает страницу. Гасим всплытие Enter у своих
 *  элементов — тогда срабатывает штатное действие (клик или переход по ссылке),
 *  а доступность с клавиатуры не зависит от чужого хука. Space работает и так. */
function isolateEnter(e: React.KeyboardEvent) {
  if (e.key === 'Enter') e.stopPropagation();
}

interface LinksSectionProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  items: LinkItem[];
  writable: boolean;
  /** Слово для подписей: «ссылка/ссылки/ссылок», винительный «ссылку» и родительный «ссылки». */
  nounOne: string;
  nounFew: string;
  nounMany: string;
  nounAcc: string;
  nounGen: string;
  addTitlePlaceholder: string;
  emptyTitle: string;
  emptyHint: string;
  emptyActionLabel: string;
  onAdd: (title: string, url: string) => void;
  onUpdate: (id: string, title: string, url: string) => void;
  onDelete: (item: LinkItem) => void;
  onReorder: (items: LinkItem[]) => void;
}

/** Раздел со списком ссылок: добавление, поиск, правка, удаление и порядок. */
function LinksSection({
  icon, title, subtitle, items, writable,
  nounOne, nounFew, nounMany, nounAcc, nounGen,
  addTitlePlaceholder, emptyTitle, emptyHint, emptyActionLabel,
  onAdd, onUpdate, onDelete, onReorder,
}: LinksSectionProps) {
  const [search, setSearch] = useState('');
  const [addTitle, setAddTitle] = useState('');
  const [addUrl, setAddUrl] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const addTitleRef = useRef<HTMLInputElement>(null);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () => (query
      ? items.filter((it) => it.title.toLowerCase().includes(query) || it.url.toLowerCase().includes(query))
      : items),
    [items, query],
  );

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const t = addTitle.trim();
    const u = addUrl.trim();
    if (!t || !u) return;
    onAdd(t, u);
    setAddTitle('');
    setAddUrl('');
    addTitleRef.current?.focus();
  };

  const startEdit = (item: LinkItem) => {
    setEditingId(item.id);
    setEditTitle(item.title);
    setEditUrl(item.url);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditTitle('');
    setEditUrl('');
  };

  const handleSaveEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingId) return;
    const t = editTitle.trim();
    const u = editUrl.trim();
    if (!t || !u) return;
    onUpdate(editingId, t, u);
    cancelEdit();
  };

  /** Стрелки двигают по полному списку — поиск не меняет фактический порядок. */
  const moveBy = (id: string, dir: -1 | 1) => {
    const from = items.findIndex((it) => it.id === id);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= items.length) return;
    onReorder(moveItem(items, from, to));
  };

  const handleDrop = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const fromId = dragId;
    setDragId(null);
    setOverId(null);
    if (!writable || !fromId || fromId === targetId) return;
    const from = items.findIndex((it) => it.id === fromId);
    const to = items.findIndex((it) => it.id === targetId);
    if (from < 0 || to < 0 || from === to) return;
    onReorder(moveItem(items, from, to));
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    if (!writable) return;
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
    try {
      // Firefox не начинает перетаскивание без данных
      e.dataTransfer.setData('text/plain', id);
    } catch {
      /* не критично */
    }
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (!writable || dragId === null || dragId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (overId !== id) setOverId(id);
  };

  const handleDragLeave = (e: React.DragEvent, id: string) => {
    // Курсор перешёл на дочерний элемент карточки — это не уход
    const next = e.relatedTarget as Node | null;
    if (next && e.currentTarget.contains(next)) return;
    if (overId === id) setOverId(null);
  };

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-5 flex flex-col gap-4">
      <SectionHeader icon={icon} tone="graphite" title={title} subtitle={subtitle}>
        <span className={UI.countBadge}>{items.length}</span>
      </SectionHeader>

      {writable && (
        <form onSubmit={handleAdd} className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <input
            ref={addTitleRef}
            type="text"
            value={addTitle}
            onChange={(e) => setAddTitle(e.target.value)}
            onKeyDown={submitOnEnter}
            placeholder={addTitlePlaceholder}
            aria-label={addTitlePlaceholder}
            className={UI.input}
            required
          />
          <input
            type="url"
            value={addUrl}
            onChange={(e) => setAddUrl(e.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="https://…"
            aria-label={`Адрес ${nounGen}`}
            className={UI.input}
            required
          />
          <button type="submit" className={`${UI.buttonPrimary} shrink-0`} onKeyDown={isolateEnter}>
            <Plus size={14} strokeWidth={2.5} aria-hidden="true" />
            Добавить
          </button>
        </form>
      )}

      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Поиск по названию или адресу…"
            ariaLabel={`Поиск: ${title}`}
          />
          {query !== '' && (
            <span className={UI.hint} aria-live="polite">
              Найдено: {filtered.length} {plural(filtered.length, nounOne, nounFew, nounMany)}
            </span>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState
          kind="empty"
          title={emptyTitle}
          hint={emptyHint}
          actionLabel={writable ? emptyActionLabel : undefined}
          onAction={writable ? () => addTitleRef.current?.focus() : undefined}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          kind="no-results"
          title="Ничего не найдено"
          hint={`Проверьте название или адрес: поиск идёт по обоим полям. Сейчас в списке ${items.length} ${plural(items.length, nounOne, nounFew, nounMany)}.`}
          actionLabel="Сбросить поиск"
          onAction={() => setSearch('')}
          query={search.trim()}
        />
      ) : (
        <ul className="flex flex-col gap-2" aria-label={`${title} — список`}>
          {filtered.map((item) => {
            const fullIdx = items.findIndex((it) => it.id === item.id);
            const isDragged = dragId === item.id;
            const isOver = overId === item.id && dragId !== null && dragId !== item.id;

            if (editingId === item.id) {
              return (
                <li key={item.id}>
                  <form
                    onSubmit={handleSaveEdit}
                    className="flex flex-col sm:flex-row gap-2 bg-white border border-[#E5E7EB] rounded-2xl p-3 sm:items-center"
                  >
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={submitOnEnter}
                      placeholder={addTitlePlaceholder}
                      aria-label={`Название ${nounGen} — правка`}
                      className={`${UI.input} flex-1`}
                      required
                    />
                    <input
                      type="url"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      onKeyDown={submitOnEnter}
                      placeholder="https://…"
                      aria-label={`Адрес ${nounGen} — правка`}
                      className={`${UI.input} flex-1`}
                      required
                    />
                    <div className="flex items-center justify-end gap-1 shrink-0">
                      <button
                        type="submit"
                        className={iconBtnSuccess}
                        title="Сохранить"
                        aria-label={`Сохранить ${nounAcc} «${item.title}»`}
                        onKeyDown={isolateEnter}
                      >
                        <Check size={15} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className={iconBtnIdle}
                        title="Отмена"
                        aria-label={`Отменить изменение ${nounOne} «${item.title}»`}
                        onKeyDown={isolateEnter}
                      >
                        <X size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </form>
                </li>
              );
            }

            return (
              <li
                key={item.id}
                draggable={writable}
                onDragStart={(e) => handleDragStart(e, item.id)}
                onDragOver={(e) => handleDragOver(e, item.id)}
                onDragLeave={(e) => handleDragLeave(e, item.id)}
                onDrop={(e) => handleDrop(e, item.id)}
                onDragEnd={() => { setDragId(null); setOverId(null); }}
                className={`flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-2.5 bg-white border rounded-2xl p-3 sm:px-4 sm:py-2.5 transition-colors ${
                  isOver
                    ? 'border-[var(--accent)] ring-2 ring-[var(--accent-20)]'
                    : isDragged
                      ? 'border-[#E5E7EB] opacity-50'
                      : 'border-[#E5E7EB] hover:border-[#D1D5DB] hover:bg-[#F9FAFB]'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {writable && (
                    <span
                      className="hidden sm:inline-flex items-center justify-center shrink-0 text-[#9CA3AF] hover:text-[#4B5563] cursor-grab active:cursor-grabbing transition-colors"
                      title="Перетащите, чтобы изменить порядок"
                      aria-hidden="true"
                    >
                      <GripVertical size={15} />
                    </span>
                  )}
                  <span className="w-5 shrink-0 text-center text-[11px] font-mono text-[#9CA3AF]" aria-hidden="true">
                    {fullIdx + 1}
                  </span>
                  <span className="hidden sm:flex w-8 h-8 rounded-lg bg-[#F3F4F6] text-[#6B7280] items-center justify-center shrink-0" aria-hidden="true">
                    <ExternalLink size={14} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <a
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      draggable={false}
                      title={item.url}
                      onKeyDown={isolateEnter}
                      className="block truncate text-xs font-semibold text-[#121316] hover:text-[var(--accent)] transition-colors rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                    >
                      {item.title}
                    </a>
                    <span className="block truncate text-[11px] font-mono text-[#6B7280] mt-0.5" title={item.url}>
                      {item.url}
                    </span>
                  </span>
                </div>

                {writable && (
                  <div className="flex items-center justify-end gap-0.5 shrink-0">
                    <button
                      type="button"
                      className={iconBtnIdle}
                      disabled={fullIdx <= 0}
                      onClick={() => moveBy(item.id, -1)}
                      onKeyDown={isolateEnter}
                      title="Поднять выше"
                      aria-label={`Переместить ${nounAcc} «${item.title}» выше`}
                    >
                      <ChevronUp size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={iconBtnIdle}
                      disabled={fullIdx >= items.length - 1}
                      onClick={() => moveBy(item.id, 1)}
                      onKeyDown={isolateEnter}
                      title="Опустить ниже"
                      aria-label={`Переместить ${nounAcc} «${item.title}» ниже`}
                    >
                      <ChevronDown size={15} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={iconBtnIdle}
                      onClick={() => startEdit(item)}
                      onKeyDown={isolateEnter}
                      title="Изменить"
                      aria-label={`Изменить ${nounAcc} «${item.title}»`}
                    >
                      <Pencil size={14} aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={iconBtnDanger}
                      onClick={() => onDelete(item)}
                      onKeyDown={isolateEnter}
                      title="Удалить"
                      aria-label={`Удалить ${nounAcc} «${item.title}»`}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {writable && items.length > 0 && (
        <p className={UI.hint}>
          Порядок {nounMany} меняется перетаскиванием за ручку или кнопками со стрелками — сохраняется сразу.
        </p>
      )}
    </section>
  );
}

export default function AdminLinksBlock({ user, settings, onSave }: Props) {
  const { showConfirm } = useDialog();

  const isWritePermitted = user.role === 'admin' || user.role === 'root_admin' || user.permissions?.settings === 'write';

  if (!settings) {
    return (
      <div className="bg-white border border-[#E5E7EB] rounded-2xl shadow-xs p-6 flex items-center gap-3">
        <RefreshCw size={16} className="animate-spin text-[#9CA3AF]" aria-hidden="true" />
        <span className="text-xs text-[#6B7280]">Загружаем настройки ссылок…</span>
      </div>
    );
  }

  const current: AppSettings = settings;

  /* Обе вкладки сохраняются тем же вызовом onSave({...settings, ...}) — сигнатура не меняется. */
  const addLink = (title: string, url: string) => {
    const newLink: QuickLink = { id: 'link_' + Date.now(), title, url };
    onSave({ ...current, quickLinks: [...(current.quickLinks || []), newLink] });
  };

  const updateLink = (id: string, title: string, url: string) => {
    onSave({
      ...current,
      quickLinks: (current.quickLinks || []).map((l) => (l.id === id ? { ...l, title, url } : l)),
    });
  };

  const deleteLink = async (item: LinkItem) => {
    const ok = await showConfirm(
      `Удалить ссылку «${item.title}»? Она пропадёт из блока «Полезные ссылки» на главной странице.`,
      'Удалить ссылку?',
      { variant: 'danger', confirmLabel: 'Удалить' },
    );
    if (!ok) return;
    onSave({ ...current, quickLinks: (current.quickLinks || []).filter((l) => l.id !== item.id) });
  };

  const reorderLinks = (reordered: LinkItem[]) => {
    onSave({ ...current, quickLinks: reordered });
  };

  const addTab = (title: string, url: string) => {
    const newTab: ExternalTab = { id: 'ext_' + Date.now(), title, url };
    onSave({ ...current, externalTabs: [...(current.externalTabs || []), newTab] });
  };

  const updateTab = (id: string, title: string, url: string) => {
    onSave({
      ...current,
      externalTabs: (current.externalTabs || []).map((t) => (t.id === id ? { ...t, title, url } : t)),
    });
  };

  const deleteTab = async (item: LinkItem) => {
    const ok = await showConfirm(
      `Удалить вкладку «${item.title}»? Она пропадёт из верхнего меню портала.`,
      'Удалить вкладку?',
      { variant: 'danger', confirmLabel: 'Удалить' },
    );
    if (!ok) return;
    onSave({ ...current, externalTabs: (current.externalTabs || []).filter((t) => t.id !== item.id) });
  };

  const reorderTabs = (reordered: LinkItem[]) => {
    onSave({ ...current, externalTabs: reordered });
  };

  return (
    <div className="flex flex-col gap-6">
      <LinksSection
        icon={<Link className="w-4 h-4" aria-hidden="true" />}
        title="Полезные ссылки на главной"
        subtitle="Показываются всем пользователям в нижней части главной страницы."
        items={current.quickLinks || []}
        writable={isWritePermitted}
        nounOne="ссылка"
        nounFew="ссылки"
        nounMany="ссылок"
        nounAcc="ссылку"
        nounGen="ссылки"
        addTitlePlaceholder="Название ссылки"
        emptyTitle="Ссылок пока нет"
        emptyHint="Добавьте первую — она появится на главной странице у всех пользователей."
        emptyActionLabel="Добавить первую ссылку"
        onAdd={addLink}
        onUpdate={updateLink}
        onDelete={deleteLink}
        onReorder={reorderLinks}
      />

      <LinksSection
        icon={<Globe className="w-4 h-4" aria-hidden="true" />}
        title="Внешние вкладки"
        subtitle="Появляются в верхнем меню портала и открываются в новой вкладке браузера."
        items={current.externalTabs || []}
        writable={isWritePermitted}
        nounOne="вкладка"
        nounFew="вкладки"
        nounMany="вкладок"
        nounAcc="вкладку"
        nounGen="вкладки"
        addTitlePlaceholder="Название вкладки"
        emptyTitle="Вкладок пока нет"
        emptyHint="Добавьте первую — она появится в верхнем меню портала."
        emptyActionLabel="Добавить первую вкладку"
        onAdd={addTab}
        onUpdate={updateTab}
        onDelete={deleteTab}
        onReorder={reorderTabs}
      />
    </div>
  );
}

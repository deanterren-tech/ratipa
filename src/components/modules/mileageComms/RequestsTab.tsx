/**
 * Вкладка «Обращения и ремонт»: ручные черновики обращений в поддержку по
 * машинам с проблемами телеметрии. Отправка — только вручную (внешних
 * интеграций нет); статусы, ответ поддержки и журнал действий фиксируются
 * сотрудником. Задача мастеру остаётся на этом же обращении (отдельной
 * системы задач в портале нет).
 */

import { useEffect, useMemo, useState } from 'react';
import { ClipboardCopy, FilePlus2, History, PhoneCall } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { FilterPills, SearchField, EmptyState, ModalShell, StatusText, SectionHeader } from '../../../ui/components';
import type { UserProfile, Vehicle } from '../../../types';
import { useToast } from '../../ToastProvider';
import { useDialog } from '../../DialogProvider';
import { mcService } from './mcService';
import {
  MC_REQUEST_STATUS_LABELS, MC_REQUEST_STATUS_ORDER, ageLabel, buildRequestDraft, fmtTs, isOpenRequest,
  type McCurrent, type McIntegration, type McMapping, type McRequest, type McRequestStatus, type McRfEntry,
} from './mcTypes';

interface Props {
  user: UserProfile;
  canRequests: boolean;
  requests: McRequest[];
  mapping: Record<string, McMapping>;
  current: Record<string, McCurrent>;
  rfEntries: Record<string, McRfEntry>;
  cars: Vehicle[];
  integration: McIntegration | null;
  nowMs: number;
  plateOf: (carKey: string) => string;
  focusRequestId: string | null;
  onFocusHandled: () => void;
}

const STATUS_COLOR: Record<McRequestStatus, 'grey' | 'blue' | 'amber' | 'rose' | 'emerald' | 'graphite'> = {
  draft: 'grey',
  sent: 'blue',
  awaiting_reply: 'amber',
  diagnostics: 'blue',
  master_needed: 'rose',
  restored: 'emerald',
  closed: 'graphite',
};

const TRANSITIONS: Record<McRequestStatus, Array<{ to: McRequestStatus; label: string; journal: string }>> = {
  draft: [
    { to: 'sent', label: 'Отметить отправленным', journal: 'Отмечено как отправленное (ручное подтверждение)' },
    { to: 'diagnostics', label: 'На диагностике', journal: 'Переведено на диагностику' },
  ],
  sent: [
    { to: 'awaiting_reply', label: 'Ожидается ответ', journal: 'Отмечено ожидание ответа поддержки' },
    { to: 'diagnostics', label: 'На диагностике', journal: 'Переведено на диагностику' },
    { to: 'master_needed', label: 'Требуется мастер', journal: 'Требуется осмотр мастером' },
    { to: 'restored', label: 'Восстановлено', journal: 'Данные восстановлены' },
    { to: 'closed', label: 'Закрыть', journal: 'Обращение закрыто' },
  ],
  awaiting_reply: [
    { to: 'diagnostics', label: 'На диагностике', journal: 'Переведено на диагностику' },
    { to: 'master_needed', label: 'Требуется мастер', journal: 'Требуется осмотр мастером' },
    { to: 'restored', label: 'Восстановлено', journal: 'Данные восстановлены' },
    { to: 'closed', label: 'Закрыть', journal: 'Обращение закрыто' },
  ],
  diagnostics: [
    { to: 'awaiting_reply', label: 'Ожидается ответ', journal: 'Отмечено ожидание ответа поддержки' },
    { to: 'master_needed', label: 'Требуется мастер', journal: 'Требуется осмотр мастером' },
    { to: 'restored', label: 'Восстановлено', journal: 'Данные восстановлены' },
    { to: 'closed', label: 'Закрыть', journal: 'Обращение закрыто' },
  ],
  master_needed: [
    { to: 'diagnostics', label: 'На диагностике', journal: 'Переведено на диагностику' },
    { to: 'restored', label: 'Восстановлено', journal: 'Данные восстановлены' },
    { to: 'closed', label: 'Закрыть', journal: 'Обращение закрыто' },
  ],
  restored: [
    { to: 'closed', label: 'Закрыть', journal: 'Обращение закрыто' },
    { to: 'awaiting_reply', label: 'Открыть заново', journal: 'Обращение возвращено в работу' },
  ],
  closed: [
    { to: 'awaiting_reply', label: 'Вернуть в работу', journal: 'Обращение возвращено в работу' },
  ],
};

export default function RequestsTab(props: Props) {
  const {
    user, canRequests, requests, mapping, current, rfEntries, cars, integration, nowMs, plateOf,
    focusRequestId, onFocusHandled,
  } = props;
  const { toast } = useToast();

  const [filter, setFilter] = useState<'open' | 'all' | McRequestStatus>('open');
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (focusRequestId) {
      setOpenId(focusRequestId);
      setFilter('all');
      onFocusHandled();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequestId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return requests.filter((r) => {
      if (q && !`${r.plate} ${r.problem} ${r.objectId || ''} ${r.createdBy}`.toLowerCase().includes(q)) return false;
      if (filter === 'open') return isOpenRequest(r.status);
      if (filter === 'all') return true;
      return r.status === filter;
    });
  }, [requests, filter, query]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { open: requests.filter((r) => isOpenRequest(r.status)).length, all: requests.length };
    for (const s of MC_REQUEST_STATUS_ORDER) c[s] = requests.filter((r) => r.status === s).length;
    return c;
  }, [requests]);

  const active = requests.find((r) => r.id === openId) || null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <FilterPills<'open' | 'all' | McRequestStatus>
          ariaLabel="Фильтр по статусу обращений"
          items={[
            { key: 'open', label: `Открытые (${counts.open})` },
            { key: 'all', label: `Все (${counts.all})` },
            ...MC_REQUEST_STATUS_ORDER.map((s) => ({ key: s, label: `${MC_REQUEST_STATUS_LABELS[s]} (${counts[s]})` })),
          ]}
          active={filter}
          onChange={setFilter}
        />
        <div className="flex items-center gap-2 sm:ml-auto">
          <SearchField value={query} onChange={setQuery} placeholder="Поиск: номер, проблема" ariaLabel="Поиск обращений" className="sm:max-w-xs" />
          {canRequests && (
            <button type="button" className={`${UI.buttonPrimary} whitespace-nowrap`} onClick={() => setCreateOpen(true)} data-testid="mc-new-request">
              <FilePlus2 className="w-3.5 h-3.5" aria-hidden="true" /> Новое
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          kind={query ? 'no-results' : 'empty'}
          query={query}
          title={query ? undefined : 'Обращений пока нет'}
          hint={query ? undefined : 'Черновик создаётся из вкладки «Нет обновлений» или кнопкой «Новое». Отправка в поддержку — вручную.'}
        />
      ) : (
        <div className={`${UI.tableWrap}`}>
          <table className={UI.table}>
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Автомобиль</th>
                <th className={UI.th}>Проблема</th>
                <th className={UI.th}>Статус</th>
                <th className={UI.th}>Создано</th>
                <th className={UI.th}>Обновлено</th>
                <th className={UI.th}>Ответ поддержки</th>
                <th className={UI.stickyTh} aria-label="Действия" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className={UI.tr} data-testid={`mc-req-${r.id}`}>
                  <td className={UI.tdStrong}>{r.plate}</td>
                  <td className={UI.td}><span className="block max-w-[320px] truncate" title={r.problem}>{r.problem}</span></td>
                  <td className={UI.td}><StatusText color={STATUS_COLOR[r.status]}>{MC_REQUEST_STATUS_LABELS[r.status]}</StatusText></td>
                  <td className={UI.td}>{fmtTs(r.createdAtMs)}<div className="text-[10px] text-[#9CA3AF]">{r.createdBy}</div></td>
                  <td className={UI.td}>{fmtTs(r.updatedAtMs || r.createdAtMs)}</td>
                  <td className={UI.td}>{r.replyText ? <span className="block max-w-[220px] truncate" title={r.replyText}>{r.replyText}</span> : <span className="text-[#9CA3AF]">—</span>}</td>
                  <td className={UI.td}>
                    <button type="button" className={UI.buttonGhost + ' !min-h-0 !px-2 !py-1'} onClick={() => setOpenId(r.id)}>Открыть</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {active && (
        <RequestEditor
          request={active}
          onClose={() => setOpenId(null)}
          user={user}
          canEdit={canRequests}
        />
      )}

      <CreateRequestModal
        isOpen={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(id) => { setCreateOpen(false); setFilter('all'); setOpenId(id); }}
        mapping={mapping}
        current={current}
        rfEntries={rfEntries}
        cars={cars}
        plateOf={plateOf}
        user={user}
      />
    </div>
  );
}

function RequestEditor({ request, onClose, user, canEdit }: { request: McRequest; onClose: () => void; user: UserProfile; canEdit: boolean }) {
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useDialog();
  const [reply, setReply] = useState(request.replyText || '');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setReply(request.replyText || ''); }, [request.id, request.replyText]);

  const copyDraft = async () => {
    try {
      await navigator.clipboard.writeText(request.draftText);
      toast('Черновик скопирован в буфер обмена', 'success');
    } catch {
      toast('Не удалось скопировать автоматически — выделите текст вручную', 'error');
    }
  };

  const applyStatus = async (to: McRequestStatus, journal: string) => {
    if (!canEdit || busy) return;
    if (to === 'sent') {
      const ok = await showConfirm(
        'Подтвердите, что обращение реально отправлено в поддержку (по почте/телефону). Статус «Отправлено» ставится только вручную.',
        'Отправка обращения',
      );
      if (!ok) return;
    }
    if (to === 'closed') {
      const note = await showPrompt('Комментарий к закрытию обращения (обязательно):', '', 'Закрытие обращения');
      if (note == null) return;
      if (!note.trim()) { toast('Для закрытия нужен комментарий', 'error'); return; }
      setBusy(true);
      try {
        await mcService.setRequestStatus({ id: request.id, carKey: request.carKey, user, status: to, journalAction: journal, journalNote: note.trim() });
        toast('Статус обновлён', 'success');
      } finally { setBusy(false); }
      return;
    }
    setBusy(true);
    try {
      await mcService.setRequestStatus({ id: request.id, carKey: request.carKey, user, status: to, journalAction: journal });
      toast('Статус обновлён', 'success');
    } finally { setBusy(false); }
  };

  const saveReply = async () => {
    if (!canEdit || busy) return;
    setBusy(true);
    try {
      await mcService.patchRequest({
        id: request.id, carKey: request.carKey, user,
        patch: { replyText: reply.trim(), replyAt: new Date().toISOString() },
        journalAction: 'Зафиксирован ответ поддержки',
        journalNote: reply.trim().slice(0, 160) || undefined,
      });
      toast('Ответ поддержки сохранён', 'success');
    } finally { setBusy(false); }
  };

  const journal = Object.values(request.journal || {}).sort((a, b) => (a.at < b.at ? 1 : -1));

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      title={`Обращение: ${request.plate}`}
      subtitle={`${MC_REQUEST_STATUS_LABELS[request.status]} · создано ${fmtTs(request.createdAtMs)} · ${request.createdBy}`}
      icon={<PhoneCall className="w-4 h-4" />}
      maxWidth="max-w-2xl"
      footer={
        canEdit ? (
          <div className="flex items-center gap-2 flex-wrap justify-end w-full">
            {TRANSITIONS[request.status].map((t) => (
              <button
                key={t.to}
                type="button"
                className={t.to === 'closed' ? UI.buttonGhost : t.to === 'master_needed' ? UI.buttonDanger : UI.buttonDark}
                disabled={busy}
                onClick={() => applyStatus(t.to, t.journal)}
              >
                {t.label}
              </button>
            ))}
          </div>
        ) : null
      }
    >
      <div className="flex flex-col gap-5">
        <SectionHeader
          icon={<PhoneCall className="w-4 h-4" />}
          tone="graphite"
          title="Черновик обращения"
          subtitle="Текст отправляется в поддержку вручную (копированием). Автоматическая отправка не подключена."
        >
          <button type="button" className={UI.buttonGhost} onClick={copyDraft} data-testid="mc-copy-draft">
            <ClipboardCopy className="w-3.5 h-3.5" aria-hidden="true" /> Копировать черновик
          </button>
        </SectionHeader>

        <pre className="text-[11px] leading-relaxed text-[#4B5563] bg-[#F8F9FA] border border-[#E5E7EB] rounded-xl p-3.5 whitespace-pre-wrap break-words font-sans" data-testid="mc-draft-text">
          {request.draftText}
        </pre>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[11px] text-[#6B7280]">
          <div>Объект Nav.by: <span className="text-[#4B5563] font-medium">{request.objectId || '—'}</span></div>
          <div>IMEI: <span className="text-[#4B5563] font-medium">{request.imei || '—'}</span></div>
          <div>Отправлено: <span className="text-[#4B5563] font-medium">{request.sentAt ? fmtTs(request.sentAt) : '—'}</span></div>
          <div>Восстановлено: <span className="text-[#4B5563] font-medium">{request.restoredAt ? fmtTs(request.restoredAt) : '—'}</span></div>
        </div>

        <div className="flex flex-col gap-2">
          <label className={UI.fieldLabel} htmlFor={`mc-reply-${request.id}`}>Ответ поддержки</label>
          <textarea
            id={`mc-reply-${request.id}`}
            className={UI.textarea}
            rows={3}
            placeholder="Вставьте ответ поддержки (причина, возможность восстановления истории, необходимость осмотра)"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            disabled={!canEdit}
          ></textarea>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-[#9CA3AF]">{request.replyAt ? `зафиксирован ${fmtTs(request.replyAt)}` : 'ответ ещё не зафиксирован'}</span>
            {canEdit && (
              <button type="button" className={UI.buttonGhost} onClick={saveReply} disabled={busy || !reply.trim()}>Зафиксировать ответ</button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <SectionHeader icon={<History className="w-4 h-4" />} tone="graphite" title="Журнал действий" subtitle={`${journal.length} записей`} />
          <ul className="flex flex-col divide-y divide-[#E5E7EB]">
            {journal.map((j, i) => (
              <li key={i} className="py-2 text-[11px] text-[#4B5563] flex flex-col sm:flex-row sm:items-baseline sm:gap-3">
                <span className="text-[#9CA3AF] whitespace-nowrap">{fmtTs(j.at)} · {j.by}</span>
                <span>{j.action}{j.note ? ` — ${j.note}` : ''}</span>
              </li>
            ))}
          </ul>
        </div>

        {canEdit && request.status === 'draft' && (
          <button
            type="button"
            className={UI.buttonDanger + ' self-start'}
            onClick={async () => {
              const ok = await showConfirm('Удалить черновик обращения? Действие необратимо.', 'Удаление черновика');
              if (!ok) return;
              await mcService.removeRequest({ id: request.id, carKey: request.carKey, user });
              toast('Черновик удалён', 'success');
              onClose();
            }}
          >
            Удалить черновик
          </button>
        )}
      </div>
    </ModalShell>
  );
}

function CreateRequestModal({
  isOpen, onClose, onCreated, mapping, current, rfEntries, cars, plateOf, user,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
  mapping: Record<string, McMapping>;
  current: Record<string, McCurrent>;
  rfEntries: Record<string, McRfEntry>;
  cars: Vehicle[];
  plateOf: (carKey: string) => string;
  user: UserProfile;
}) {
  const { toast } = useToast();
  const [carKey, setCarKey] = useState('');
  const [problem, setProblem] = useState('Данные телеметрии не обновляются.');
  const [busy, setBusy] = useState(false);

  const options = useMemo(
    () => Object.keys(mapping).map((k) => ({ key: k, label: plateOf(k) })).sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    [mapping, plateOf],
  );

  useEffect(() => {
    if (isOpen) {
      setCarKey(options[0]?.key || '');
      setProblem('Данные телеметрии не обновляются.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const create = async () => {
    if (!carKey) { toast('Выберите автомобиль', 'error'); return; }
    setBusy(true);
    try {
      const m = mapping[carKey];
      const cur = current[carKey] || null;
      const rf = rfEntries[carKey] || null;
      const draftText = buildRequestDraft({
        plate: plateOf(carKey),
        objectId: m?.navbyObjectId ?? null,
        imei: m?.imei ?? null,
        current: cur,
        rfEntry: rf,
        problem: problem.trim(),
        nowMs: Date.now(),
      });
      const id = await mcService.createRequest({
        carKey,
        plate: plateOf(carKey),
        objectId: m?.navbyObjectId ?? null,
        imei: m?.imei ?? null,
        problem: problem.trim(),
        draftText,
        user,
      });
      toast('Черновик создан', 'success');
      onCreated(id);
    } catch (e) {
      toast(`Не удалось создать: ${String(e instanceof Error ? e.message : e).slice(0, 120)}`, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      title="Новое обращение"
      subtitle="Черновик по шаблону; отправка — вручную"
      icon={<FilePlus2 className="w-4 h-4" />}
      footer={
        <div className="flex items-center gap-2">
          <button type="button" className={UI.buttonGhost} onClick={onClose}>Отмена</button>
          <button type="button" className={UI.buttonPrimary} onClick={create} disabled={busy || !carKey} data-testid="mc-create-draft">Создать черновик</button>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Автомобиль</span>
          <select className={UI.select} value={carKey} onChange={(e) => setCarKey(e.target.value)}>
            {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
          {options.length === 0 && <span className={UI.hint}>Нет сопоставленных автомобилей — сначала настройте привязку в «Настройках».</span>}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={UI.fieldLabel}>Проблема</span>
          <textarea className={UI.textarea} rows={2} value={problem} onChange={(e) => setProblem(e.target.value)}></textarea>
        </label>
        <p className={UI.hint}>В черновик автоматически попадут объект, IMEI, последняя известная координата, её возраст, отметка въезда в РФ и стандартная просьба к поддержке.</p>
      </div>
    </ModalShell>
  );
}

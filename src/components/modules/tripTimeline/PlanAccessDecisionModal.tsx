/**
 * Окно решения по запросу разового доступа к плану этапов рейса.
 *
 * Открывается из уведомления администратора (клик) и с доски рейса. Решение
 * принимается RTDB-транзакцией (ровно один раз даже при параллельном решении
 * двух администраторов): одобрение выдаёт разрешение СУЩЕСТВУЮЩИМ механизмом
 * tripTimeline/planPerms (одно на пару «рейс + пользователь»), отклонение просто
 * фиксируется. Свой запрос решить нельзя — кнопки скрыты, функция проверяет
 * повторно. Если версия плана изменилась после запроса — показывается
 * предупреждение до принятия решения.
 */
import React, { useMemo } from 'react';
import { ExternalLink, ShieldCheck, ShieldX, TriangleAlert } from 'lucide-react';
import type { TimelinePlanGuard, TimelinePlanRequest, UserProfile } from '../../../types';
import { UI } from '../../../ui/kit';
import { ModalShell } from '../../../ui/components';
import { dbService } from '../../../api';
import { useToast } from '../../ToastProvider';
import { useEffect, useState } from 'react';

const STATUS_LABELS: Record<TimelinePlanRequest['status'], string> = {
  pending: 'Ожидает решения',
  approved: 'Одобрен — разрешено одно сохранение',
  rejected: 'Отклонён',
  used: 'Разрешение использовано',
  revoked: 'Разрешение отозвано',
};

const fmtDateTime = (iso?: string): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return iso;
  }
};

export default function PlanAccessDecisionModal({
  tripKey,
  requestId,
  user,
  onClose,
}: {
  tripKey: string;
  requestId: string;
  user: UserProfile;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<Record<string, Record<string, TimelinePlanRequest>>>({});
  const [guards, setGuards] = useState<Record<string, TimelinePlanGuard>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsub1 = dbService.getTimelinePlanRequests((store) => setRequests(store || {}));
    const unsub2 = dbService.getTimelinePlanGuards((store) => setGuards(store || {}));
    return () => {
      if (typeof unsub1 === 'function') unsub1();
      if (typeof unsub2 === 'function') unsub2();
    };
  }, []);

  const request = requests?.[tripKey]?.[requestId] || null;
  const guard = guards?.[tripKey] || null;
  const guardVersion = Number(guard?.version) || (guard?.initialSavedAt ? 1 : 0);

  const isAdmin = user.role === 'root_admin' || user.role === 'admin';
  const isOwn = !!request && request.userId === user.uid;
  const pending = request?.status === 'pending';
  const canDecide = !!request && isAdmin && pending && !isOwn;
  const versionChanged = pending && !!request && guardVersion !== (Number(request.planVersion) || 0);

  const decisionNote = useMemo(() => {
    if (!request || !request.decidedAt) return '';
    return `${STATUS_LABELS[request.status]} · ${request.decidedBy || '—'} · ${fmtDateTime(request.decidedAt)}${request.decisionComment ? ` · комментарий: ${request.decisionComment}` : ''}`;
  }, [request]);

  const decide = async (approve: boolean) => {
    if (!request || !canDecide || busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await dbService.decideTimelinePlanRequest({
        tripKey,
        requestUserId: request.userId,
        approve,
        ...(comment.trim() ? { comment: comment.trim() } : {}),
        byName: user.name,
        byId: user.uid,
        byRole: user.role,
        planVersion: guardVersion,
        history: Array.isArray(guard?.history) ? guard!.history : [],
      });
      if (res.ok) {
        toast(approve ? 'Разрешено одно сохранение — разрешение выдано этому пользователю' : 'Запрос отклонён', 'success');
      } else if (res.reason === 'not-pending') {
        toast('Решение уже принято (возможно, другим администратором) — повторное не создаётся', 'info');
      } else if (res.reason === 'self') {
        toast('Нельзя решать собственный запрос', 'error');
      } else {
        setError('Не удалось записать решение. Запрос остался в прежнем статусе — повторите.');
      }
    } catch (e) {
      setError(`Не удалось записать решение: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      isOpen
      onClose={onClose}
      title="Запрос разового доступа к плану этапов"
      subtitle="Решение выдаёт разрешение только этому пользователю и только на один успешный раз"
      icon={<ShieldCheck className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Запрос разового доступа к плану этапов"
      maxWidth="max-w-xl">
      <div data-ui="plan-decision-modal" data-status={request?.status || 'missing'} className="flex flex-col gap-3">
        {!request ? (
          <div className={UI.errorBox} role="alert">Запрос не найден — возможно, он удалён или ссылка устарела.</div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 text-[11px]">
              <span className="text-[#6B7280]">Пользователь</span>
              <span className="text-[#121316] font-medium">{request.userName}{request.userId ? ` · ${request.userId}` : ''}</span>
              <span className="text-[#6B7280]">Автомобиль</span>
              <span className="text-[#121316] font-medium">{request.carNumber || 'не указан'}</span>
              <span className="text-[#6B7280]">Рейс / маршрут</span>
              <span className="text-[#121316] font-medium">{request.route || 'маршрут не указан'} · {request.tripKey}</span>
              <span className="text-[#6B7280]">Причина запроса</span>
              <span className="text-[#121316] whitespace-pre-wrap">{request.reason || 'не указана'}</span>
              <span className="text-[#6B7280]">Отправлен</span>
              <span className="text-[#121316]">{fmtDateTime(request.createdAt)}</span>
              <span className="text-[#6B7280]">Версия плана на момент запроса</span>
              <span className="text-[#121316]">v{Number(request.planVersion) || 0}{guardVersion !== (Number(request.planVersion) || 0) ? ` · сейчас v${guardVersion}` : ''}</span>
              <span className="text-[#6B7280]">Статус</span>
              <span data-ui="decision-status" className={`font-semibold ${request.status === 'pending' ? 'text-amber-700' : request.status === 'approved' ? 'text-emerald-600' : request.status === 'rejected' ? 'text-rose-600' : 'text-[#4B5563]'}`}>
                {STATUS_LABELS[request.status]}
              </span>
            </div>

            {versionChanged ? (
              <div className={`${UI.errorBox} !text-amber-700`} role="alert">
                <TriangleAlert className="w-4 h-4 shrink-0" aria-hidden="true" />
                План изменился после отправки запроса (версия {Number(request.planVersion) || 0} → {guardVersion}). Решение не перезапишет чужие правки: разрешение будет привязано к текущей версии, а при сохранении диспетчер увидит проверку конфликта.
              </div>
            ) : null}

            {decisionNote ? <div className="text-[11px] text-[#4B5563] border border-[#E5E7EB] rounded-lg px-3 py-2" data-ui="decision-note">{decisionNote}</div> : null}

            {isOwn && pending ? (
              <div className="text-[11px] text-[#6B7280]">Это ваш собственный запрос — решение принимает другой администратор.</div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <label className={UI.fieldLabel}>Комментарий администратора (необязательно)</label>
              <textarea
                data-ui="decision-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                disabled={!canDecide || busy}
                rows={2}
                placeholder="Например: согласовано с руководителем; изменяйте только даты границы"
                className="w-full bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 text-xs text-[#121316] outline-none resize-y focus:border-[var(--accent)] disabled:opacity-60"
              />
            </div>

            {error ? <div className={UI.errorBox} role="alert">{error}</div> : null}

            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <button
                type="button"
                data-ui="decision-approve"
                disabled={!canDecide || busy}
                onClick={() => decide(true)}
                className={`${UI.buttonPrimary} ${!canDecide ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <ShieldCheck className="w-4 h-4" aria-hidden="true" />
                {busy ? 'Записывается…' : 'Разрешить одно сохранение'}
              </button>
              <button
                type="button"
                data-ui="decision-reject"
                disabled={!canDecide || busy}
                onClick={() => decide(false)}
                className={`${UI.buttonDanger} ${!canDecide ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <ShieldX className="w-4 h-4" aria-hidden="true" />
                Отклонить
              </button>
              <button
                type="button"
                data-ui="decision-open-trip"
                onClick={() => {
                  window.location.hash = `#tripTimeline/trip/${encodeURIComponent(tripKey)}`;
                  onClose();
                }}
                className={`${UI.buttonGhost} ml-auto`}
              >
                <ExternalLink className="w-4 h-4" aria-hidden="true" />
                Открыть рейс
              </button>
            </div>
            <span className="text-[10px] text-[#9CA3AF]">
              Одобрение не разблокирует другие рейсы и не меняет общие права пользователя; повторное решение не создаёт второе разрешение.
            </span>
          </>
        )}
      </div>
    </ModalShell>
  );
}

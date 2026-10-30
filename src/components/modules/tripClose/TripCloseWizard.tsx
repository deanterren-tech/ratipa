/**
 * «Закрыть рейс» — мастер из шести шагов (одно широкое окно в стиле Ratipa).
 *
 * Особенности, заданные владельцем и заложенные здесь:
 *  · состояние живёт на сервере (`tripCloseService`) — закрытие окна не завершает
 *    сценарий, продолжение с любого незавершённого шага;
 *  · внутри мастера НЕ открываются окна модулей друг поверх друга: формы шагов
 *    используют те же сервисы и расчёты, что и сами модули, а не их копии;
 *  · повторные нажатия не повторяют операции (транзакции `operations/*`);
 *  · «Зарплата» не значит «выплачено» — факт выплаты оформляется в модуле;
 *  · шаги 4–6 работают с внешними Google-таблицами через существующие настройки
 *    (в iframe данные не читаются), поэтому там — подготовка данных, копирование,
 *    открытие таблицы и ЯВНОЕ подтверждение пользователя.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ref, set, push } from 'firebase/database';
import { AppSettings, ExpenseRow, SalaryLog, TripPlan, UserProfile } from '../../../types';
import { database, dbService, useFirebase } from '../../../firebase';
import { pdService } from '../../../api';
import { useToast } from '../../ToastProvider';
import { useDialog } from '../../DialogProvider';
import { resolvePermission } from '../../../utils/permissions';
import { useConverter } from '../../../hooks/useConverter';
import { calculateTripFinances } from '../../../utils/financeCalculators';
import { computeSalaryTotals } from '../../../utils/salaryCalc';
import {
  convertToEur,
  expensesMissingRate,
  expensesTotalEur,
  expenseAmountOf,
  newExpenseId,
  normalizeExpenseRows,
  serializeExpenseRows,
  validateExpenseRows,
} from '../../../utils/expenseRates';
import { planSourceLabel, planRouteText } from '../../../utils/salaryPlanLink';
import {
  STEP_DEFS,
  STEP_ORDER,
  STEP_STATUS_LABEL,
  deriveProgress,
  hasOperation,
  lockIsActive,
  missingInSummary,
  nextStep,
  normalizeState,
  planStepIssues,
  salaryRecheckNeeded,
  stepDef,
  stepSettled,
  summaryLines,
  type StepKey,
  type TripCloseDoc,
  type TripCloseMdpBook,
  type TripCloseState,
} from './core';
import { tripCloseService } from '../../../firebase/tripCloseService';
import { findActiveDuplicate } from '../baza/lib/bazaDedupe';
import { ModalShell } from '../../../ui/components';
import { UI } from '../../../ui/kit';
import {
  ArrowLeft, ArrowRight, Check, CheckCircle2, Clock, Copy, ExternalLink, FileText, Link2,
  Loader2, Minus, PauseCircle, Plus, RefreshCw, Save, ShieldAlert, Trash2, Truck, X,
} from 'lucide-react';

interface Props {
  user: UserProfile;
  settings?: AppSettings | null;
  tripId: string;
  onClose: () => void;
}

const toRu = (iso?: string): string => (iso ? String(iso).split('-').reverse().join('/') : '');
/** Каноническая дата базы (YYYY-MM-DD): принимает и «ДД/ММ/ГГГГ» (ввод человека), и ISO.
 *  Раньше поле, заполненное подсказкой из плана, уходило в базу как ISO, а правленное
 *  руками — как «ДД/ММ/ГГГГ»: часть данных терялась при сохранении. */
const toIsoAny = (value?: string): string => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return toIso(raw);
};
/** Отметка для журнала «Учёта выезда» — тот же формат, что пишет сам модуль базы (ДД/ММ/ГГГГ ЧЧ:ММ). */
const ruStamp = (): string => {
  const now = new Date();
  return `${now.toLocaleDateString('ru-RU').replace(/\./g, '/')} ${now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
};
const toIso = (ru?: string): string => {
  const m = String(ru || '').trim().match(/^(\d{2})[./](\d{2})[./](\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const dateInput = (e: React.ChangeEvent<HTMLInputElement>, value: string): string => {
  const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
  const p = [digits.slice(0, 2), digits.slice(2, 4), digits.slice(4, 8)].filter(Boolean);
  const next = p.join('/');
  return next || value;
};
const rawFactKm = (p: TripPlan | null | undefined): unknown => (p as unknown as { factKm?: unknown } | null | undefined)?.factKm;
const factKmNumber = (p: TripPlan | null | undefined): number | null => {
  const raw = rawFactKm(p);
  if (raw === '' || raw === null || raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};
const dayDiff = (start?: string, end?: string): number => {
  if (!start || !end) return 0;
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.abs(Math.round((e - s) / 86400000)) + 1;
};
const daysLabel = (n: number) => `${n} дн.`;

export default function TripCloseWizard({ user, settings, tripId, onClose }: Props) {
  const { toast } = useToast();
  const { showConfirm, showPrompt } = useDialog();
  const conv = useConverter();

  const [state, setState] = useState<TripCloseState | null>(null);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [step, setStep] = useState<StepKey>('planDohod');
  const [busy, setBusy] = useState<string>('');
  const [foreignLock, setForeignLock] = useState<string>('');
  const [salaries, setSalaries] = useState<SalaryLog[]>([]);
  const [planForm, setPlanForm] = useState<{ dateStart: string; dateEnd: string; factKm: string; expenses: ExpenseRow[] }>({ dateStart: '', dateEnd: '', factKm: '', expenses: [] });
  const [salaryForm, setSalaryForm] = useState({ driver: '', rate: 0, km: 0, totalDays: 0, idleDays: 0, idleRate: 0, perDiem: 0, bonus: 0 });
  const [salaryRef, setSalaryRef] = useState<SalaryLog | null>(null);
  const [vyezdForm, setVyezdForm] = useState({ driverName: '', dateArrival: '', dateRepairStart: '', dateRepairEnd: '', comment: '' });
  const [docDraft, setDocDraft] = useState({ type: '', number: '', issuedAt: '', issuedTo: '' });
  const [mdpDraft, setMdpDraft] = useState({ number: '', issuedAt: '' });
  const savedRef = useRef(false);

  const role = user.role || 'user';
  const monthNow = (() => { const d = new Date(Date.now() + 3 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();

  // ── загрузка: сценарий, план, зарплаты ────────────────────────────────────
  useEffect(() => {
    const unsub = tripCloseService.subscribe(tripId, (st) => setState(st));
    return () => unsub();
  }, [tripId]);

  useEffect(() => {
    const unsubTrips = pdService.subscribeTrips((list) => {
      const found = (list || []).find((t) => String(t?.id) === String(tripId)) || null;
      setPlan(found);
    });
    const unsubSal = dbService.getSalaries((logs) => setSalaries(Array.isArray(logs) ? logs : []));
    return () => { unsubTrips(); unsubSal(); };
  }, [tripId]);

  // сценарий создаём один раз (не перетирая заполненные шаги)
  useEffect(() => {
    if (!plan) return;
    if (savedRef.current) return;
    savedRef.current = true;
    void (async () => {
      const st = await tripCloseService.ensure({
        tripId,
        carNumber: String(plan.carNumber || ''),
        driverNames: plan.driverName ? [String(plan.driverName)] : [],
        route: planRouteText(plan),
        dateStart: plan.dateStart ? String(plan.dateStart) : '',
        dateEnd: plan.dateEnd ? String(plan.dateEnd) : '',
        planDohodId: String(plan.id),
        initiator: { uid: user.uid, name: user.name },
      }, user.name, role);
      setState(st);
      const my = await tripCloseService.claimLock(tripId, user.name, user.uid || user.name);
      if (!my) {
        const fresh = await tripCloseService.load(tripId).catch(() => null);
        setForeignLock(fresh?.lock?.by || st.lock?.by || 'другой сотрудник');
      } else {
        setForeignLock('');
      }
      setStep((st.currentStep as StepKey) || nextStep(st) || 'planDohod');
    })();
  }, [plan, tripId, user.name, user.uid, role]);

  // Чужая живая блокировка: пробуем забрать сценарий, когда она истечёт (TTL 20 минут).
  useEffect(() => {
    if (!foreignLock) return;
    const timer = window.setInterval(() => {
      void tripCloseService
        .claimLock(tripId, user.name, user.uid || user.name)
        .then((mine) => { if (mine) setForeignLock(''); })
        .catch(() => {});
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [foreignLock, tripId, user.name, user.uid]);

  // ── формы шагов из данных плана ──────────────────────────────────────────
  useEffect(() => {
    if (!plan) return;
    setPlanForm((prev) => ({
      dateStart: prev.dateStart || (plan.dateStart ? String(plan.dateStart) : ''),
      dateEnd: prev.dateEnd || (plan.dateEnd ? String(plan.dateEnd) : ''),
      factKm: prev.factKm || (factKmNumber(plan) === null ? '' : String(factKmNumber(plan))),
      expenses: prev.expenses.length ? prev.expenses : normalizeExpenseRows(plan),
    }));
    const days = dayDiff(plan.dateStart ? String(plan.dateStart) : '', plan.dateEnd ? String(plan.dateEnd) : '');
    const km = factKmNumber(plan);
    const prevForCar = (salaries || []).filter((s) => String(s.car || '') === String(plan.carNumber || ''));
    const last = prevForCar[0];
    setSalaryForm((prev) => ({
      driver: prev.driver || String(plan.driverName || last?.driver || ''),
      rate: prev.rate || Number(last?.rate || 0),
      km: prev.km || (km === null ? 0 : km),
      totalDays: prev.totalDays || days || Number(last?.totalDays || 0),
      idleDays: prev.idleDays || 0,
      idleRate: prev.idleRate || 0,
      perDiem: prev.perDiem || 0,
      bonus: prev.bonus || 0,
    }));
    // Шаг «Учёт выезда»: подхватываем сохранённый черновик, затем данные плана.
    const draft = state?.vyezd || {};
    setVyezdForm((prev) => ({
      driverName: prev.driverName || String(draft.driverName || plan.driverName || ''),
      dateArrival: prev.dateArrival || toIsoAny(String(draft.dateArrival || '')) || (plan.dateEnd ? String(plan.dateEnd) : ''),
      dateRepairStart: prev.dateRepairStart || toIsoAny(String(draft.dateRepairStart || '')),
      dateRepairEnd: prev.dateRepairEnd || toIsoAny(String(draft.dateRepairEnd || '')),
      comment: prev.comment || String(draft.comment || ''),
    }));
  }, [plan, salaries, state?.vyezd]);

  // уже существующая зарплата по этому рейсу и водителю
  useEffect(() => {
    if (!plan) return;
    const car = String(plan.carNumber || '').trim().toUpperCase();
    const driver = String(plan.driverName || '').trim().toLowerCase();
    const hit = (salaries || []).find((s) => {
      const sameCar = String(s.car || '').trim().toUpperCase() === car;
      const sameDriver = !driver || String(s.driver || '').trim().toLowerCase() === driver;
      const samePlan = s.planId ? String(s.planId) === String(plan.id) : false;
      const sameDates = s.dateStart && plan.dateStart ? String(s.dateStart) === String(plan.dateStart) : false;
      return samePlan || (sameCar && sameDriver && sameDates);
    }) || null;
    setSalaryRef(hit);
  }, [salaries, plan]);

  // ── расчёты ──────────────────────────────────────────────────────────────
  const expensesSum = useMemo(() => expensesTotalEur(planForm.expenses), [planForm.expenses]);
  const expensesMissing = useMemo(() => expensesMissingRate(planForm.expenses), [planForm.expenses]);
  const salaryTotals = useMemo(() => computeSalaryTotals({
    km: salaryForm.km, rate: salaryForm.rate, idleDays: salaryForm.idleDays, idleRate: salaryForm.idleRate,
    totalDays: salaryForm.totalDays, perDiem: salaryForm.perDiem, bonus: salaryForm.bonus,
  }), [salaryForm]);
  const progress = useMemo(() => (state ? deriveProgress(state) : null), [state]);
  const recheck = useMemo(
    () => salaryRecheckNeeded(plan ? { dateStart: String(plan.dateStart || ''), dateEnd: String(plan.dateEnd || ''), factKm: factKmNumber(plan) } : null,
      plan ? { dateStart: toIsoAny(planForm.dateStart), dateEnd: toIsoAny(planForm.dateEnd), factKm: planForm.factKm } : null),
    [plan, planForm],
  );
  const canDo = (key: StepKey): boolean => resolvePermission(user, stepDef(key).permissionKey, settings?.rolePermissions) !== 'none';
  /** Чужая живая блокировка: просмотр доступен, изменения — нет (как обещает плашка в шапке). */
  const foreignLocked = Boolean(foreignLock);
  const writeDenied = (key: StepKey): boolean => foreignLocked || !canDo(key);
  const assertCanWrite = (): boolean => {
    if (!foreignLocked) return true;
    toast(`Сценарий ведёт ${foreignLock || 'другой сотрудник'} — изменения доступны после окончания блокировки`, 'error');
    return false;
  };

  const goStep = useCallback(async (key: StepKey) => {
    setStep(key);
    if (state && !state.completedAt) await tripCloseService.setCurrentStep(tripId, key, user.name).catch(() => {});
  }, [state, tripId, user.name]);

  const close = useCallback(async () => {
    await tripCloseService.releaseLock(tripId, user.uid || user.name).catch(() => {});
    toast('Сценарий сохранён — закрытие окна работу не завершает', 'info');
    onClose();
  }, [tripId, user.uid, user.name, toast, onClose]);

  // ── шаг 1: план дохода — сохранить и архивировать ────────────────────────
  const runPlanStep = async () => {
    if (!plan) return;
    if (!assertCanWrite()) return;
    const planStartIso = toIsoAny(planForm.dateStart);
    const planEndIso = toIsoAny(planForm.dateEnd);
    const issues = planStepIssues({ factKm: planForm.factKm, dateStart: planStartIso, dateEnd: planEndIso });
    if (issues.length) { toast(issues[0], 'error'); return; }
    const expenseProblems = validateExpenseRows(planForm.expenses);
    if (expenseProblems.length) { toast(expenseProblems[0].message, 'error'); return; }
    if (expensesMissing.length) { toast('Нет курса для части статей — обновите курсы: итог неполный.', 'error'); return; }
    const factKm = Number(planForm.factKm);
    const fin = calculateTripFinances(plan.legs || [], planStartIso, planEndIso, expensesSum, Number(plan.ferryCost || 0), factKm);
    const done: string[] = [];
    setBusy('plan');
    try {
      // 1) сохранение (однократное: повторный запуск не переписывает план)
      const firstSave = await tripCloseService.recordOperation(tripId, 'planSaved', { summary: `План ${plan.id}` }, user.name);
      if (firstSave) {
        await pdService.updateTrip(plan.id, {
          dateStart: planStartIso,
          dateEnd: planEndIso,
          days: fin.days,
          factKm,
          expenses: serializeExpenseRows(planForm.expenses),
          extraExpense: expensesSum,
          totalExpenses: fin.totalExpensesPlan,
          totalKm: fin.totalKm,
          profit: fin.profitPlan,
          profitFact: fin.profitFact,
        }, user.name, role);
        done.push('план сохранён');
      } else {
        done.push('план уже был сохранён ранее');
      }
      // 2) архивация существующим механизмом (тоже однократно)
      const firstArchive = await tripCloseService.recordOperation(tripId, 'planArchived', { summary: `Архив ${monthNow}` }, user.name);
      if (firstArchive) {
        pdService.archiveTrip(plan.id, monthNow, user.name, role);
        done.push('план архивирован');
      } else {
        done.push('план уже был в архиве');
      }
      await tripCloseService.setStep(tripId, 'planDohod', 'done', user.name, undefined, { planId: String(plan.id) });
      setState((prev) => prev ? normalizeState({ ...prev, steps: { ...prev.steps, planDohod: { status: 'done', at: new Date().toISOString(), by: user.name } } }, tripId) : prev);
      toast(`Шаг 1 готов: ${done.join(', ')}`, 'success');
      await goStep('salary');
    } catch (e) {
      const message = (e as Error)?.message || 'не удалось';
      await tripCloseService.pushError(tripId, 'planDohod', message, user.name).catch(() => {});
      toast(`План: выполнено (${done.join(', ') || 'ничего'}). Ошибка: ${message} — повторите шаг, уже сделанное не повторится`, 'error');
    } finally { setBusy(''); }
  };

  // ── шаг 2: зарплата ──────────────────────────────────────────────────────
  const runSalaryStep = async () => {
    if (!plan) return;
    if (!assertCanWrite()) return;
    if (!salaryForm.driver.trim()) { toast('Укажите водителя', 'error'); return; }
    if (salaryForm.totalDays <= 0) { toast('Проверьте период рейса: дней должно быть больше нуля', 'error'); return; }
    if (salaryForm.km < 0) { toast('Пробег не может быть отрицательным', 'error'); return; }
    if (salaryRef) {
      const ok = await showConfirm(
        `По этому рейсу уже есть запись зарплаты (${salaryRef.driver}, ${salaryRef.datetime || ''}). Обновить её, а не создавать вторую?`,
        'Существующая зарплата',
      );
      if (!ok) return;
    }
    setBusy('salary');
    try {
      const log: SalaryLog = {
        id: salaryRef?.id,
        car: String(plan.carNumber || ''),
        driver: salaryForm.driver.trim(),
        rate: salaryForm.rate,
        km: salaryForm.km,
        mark: String(plan.direction || ''),
        idleDays: salaryForm.idleDays,
        totalDays: salaryForm.totalDays,
        bonus: salaryForm.bonus,
        kmMoney: salaryTotals.kmMoney,
        idleMoney: salaryTotals.idleMoney,
        daysMoney: salaryTotals.daysMoney,
        totalSalary: salaryTotals.totalSalary,
        salaryPerDay: salaryTotals.salaryPerDay,
        datetime: new Date().toLocaleDateString('ru-RU'),
        logist: user.name,
        comment: 'Начислено мастером закрытия рейса (факт выплаты оформляется отдельно)',
        dateStart: toIsoAny(planForm.dateStart),
        dateEnd: toIsoAny(planForm.dateEnd),
        planId: String(plan.id),
        planSource: 'planDohod',
        planSyncedAt: new Date().toISOString(),
        planSynced: {
          planId: String(plan.id),
          carNumber: String(plan.carNumber || ''),
          source: 'planDohod',
          dateStart: toIsoAny(planForm.dateStart),
          dateEnd: toIsoAny(planForm.dateEnd),
          factKm: salaryForm.km,
          syncedAt: new Date().toISOString(),
          label: planSourceLabel(plan),
        },
      } as SalaryLog;
      if (salaryRef?.storageKey || salaryRef?.id) {
        await dbService.updateSalary(
          String(salaryRef.id || salaryRef.storageKey || ''),
          { ...log, id: salaryRef.id || log.id },
          user.name,
          role,
          { datetime: salaryRef.datetime, logist: salaryRef.logist },
        );
      } else {
        await dbService.saveSalary(log, user.name, role);
      }
      await tripCloseService.recordOperation(tripId, 'salarySaved', { id: String(salaryRef?.id || log.id || ''), summary: `${salaryForm.driver}: ${salaryTotals.totalSalary}` }, user.name);
      await tripCloseService.setStep(tripId, 'salary', 'done', user.name, undefined, { salaryId: String(salaryRef?.id || log.id || '') });
      toast('Зарплата сохранена. Факт выплаты — отдельным действием в модуле.', 'success');
      await goStep('vyezd');
    } catch (e) {
      await tripCloseService.pushError(tripId, 'salary', (e as Error)?.message || 'ошибка', user.name).catch(() => {});
      toast(`Зарплата: ${(e as Error)?.message || 'ошибка'}`, 'error');
    } finally { setBusy(''); }
  };

  // ── шаг 3: учёт выезда ───────────────────────────────────────────────────
  const runVyezdStep = async () => {
    if (!plan) return;
    if (!assertCanWrite()) return;
    if (!vyezdForm.dateArrival.trim()) { toast('Укажите дату приезда (подтвердите или исправьте предложенную)', 'error'); return; }
    const isoArrival = toIsoAny(vyezdForm.dateArrival);
    const isoRepairStart = toIsoAny(vyezdForm.dateRepairStart);
    const isoRepairEnd = toIsoAny(vyezdForm.dateRepairEnd);
    if (isoArrival && isoRepairStart && isoRepairStart < isoArrival) { toast('Срок готовности раньше даты приезда — проверьте хронологию', 'error'); return; }
    if (isoRepairStart && isoRepairEnd && isoRepairEnd < isoRepairStart) { toast('Окончание срока готовности раньше его начала', 'error'); return; }
    setBusy('vyezd');
    try {
      // Черновик шага сохраняем до записи: закрытие окна/перезагрузка не должны
      // терять введённые даты — их показывают шаги 4-6 и продолжение сценария.
      await tripCloseService.patch(tripId, {
        vyezd: {
          driverName: vyezdForm.driverName.trim(),
          dateArrival: isoArrival,
          dateRepairStart: isoRepairStart,
          dateRepairEnd: isoRepairEnd,
          comment: vyezdForm.comment.trim(),
          savedAt: new Date().toISOString(),
        },
      }, user.name).catch(() => {});
      const plate = String(plan.carNumber || '');
      const existing = await new Promise<any[]>((resolve) => {
        let stop: (() => void) | null = null;
        try { stop = dbService.getBazaRecords((rows) => resolve(Array.isArray(rows) ? rows : [])); } catch { resolve([]); }
        window.setTimeout(() => { if (stop) stop(); resolve([]); }, 2500);
      });
      // Дубль ищем тем же правилом, что и модуль базы: номер (в обеих раскладках)
      // + дата приезда; иначе мастер создал бы вторую запись рядом с существующей.
      const dup = findActiveDuplicate(existing, plate, isoArrival);
      if (dup) {
        const useIt = await showConfirm(
          `На ${toRu(isoArrival)} у ${plate} уже есть запись «Учёта выезда» (${String(dup.id || '')}). Использовать её (шаг будет считаться оформленным)?`,
          'Запись уже существует',
        );
        if (useIt) {
          await tripCloseService.recordOperation(tripId, 'vyezdSaved', { id: String(dup.id || ''), summary: 'использована существующая запись' }, user.name);
          await tripCloseService.setStep(tripId, 'vyezd', 'done', user.name, 'Использована существующая запись', { bazaId: String(dup.id || '') });
          toast('Учёт выезда: использована существующая запись', 'success');
          await goStep('zagruzka');
        }
        return;
      }
      // Ключ новой записи готовим заранее и фиксируем в операции: повторный клик
      // и второе окно не создадут вторую запись «Учёта выезда».
      const newKey = push(ref(database, 'baza')).key as string;
      const already = await tripCloseService.recordOperation(tripId, 'vyezdSaved', { id: newKey, summary: `Приезд ${isoArrival}` }, user.name);
      if (!already) {
        toast('Запись «Учёта выезда» уже создана этим сценарием — повтор не выполняем', 'info');
      } else {
        await set(ref(database, `baza/${newKey}`), {
          id: newKey,
          carId: newKey,
          couplingId: null,
          carNumber: plate,
          driverName: vyezdForm.driverName.trim(),
          driverRaw: vyezdForm.driverName.trim(),
          driverId: null,
          migrationStatus: 'unmatched',
          dateArrival: isoArrival,
          dateLoading: '',
          dateRepairStart: isoRepairStart,
          dateRepairEnd: isoRepairEnd,
          dateDeparture: '',
          comment: vyezdForm.comment.trim() || `Закрытие рейса ${toRu(planForm.dateStart)}–${toRu(planForm.dateEnd)}`,
          status: 'base',
          closeTrip: { tripId: String(plan.id), by: user.name, at: new Date().toISOString() },
        });
        // Журнал записи — в формате модуля базы (дата/кто/поле/было/стало),
        // иначе отметки мастера не видны в журнале и не учитываются механизмом дублей.
        await push(ref(database, `baza/${newKey}/history`), {
          date: ruStamp(),
          user: `${user.name} (${role})`,
          field: 'Запись создана',
          old: '[Пусто]',
          new: `Учёт выезда из закрытия рейса ${String(plan.id)}: приезд ${toRu(isoArrival)}`,
        }).catch(() => {});
        dbService.logAction(user.name, role, 'Учёт выезда из закрытия рейса', 'Baza', newKey, `${plate}: приезд ${isoArrival}`);
      }
      const opBazaId = String((state?.operations as Record<string, { id?: string }> | undefined)?.vyezdSaved?.id || '');
      await tripCloseService.setStep(tripId, 'vyezd', 'done', user.name, undefined, { bazaId: already ? newKey : opBazaId });
      toast('Учёт выезда оформлен', 'success');
      await goStep('zagruzka');
    } catch (e) {
      await tripCloseService.pushError(tripId, 'vyezd', (e as Error)?.message || 'ошибка', user.name).catch(() => {});
      toast(`Учёт выезда: ${(e as Error)?.message || 'ошибка'}`, 'error');
    } finally { setBusy(''); }
  };

  // ── шаг 4: план загрузок (подготовка данных + подтверждение) ─────────────
  const zagruzkaText = useMemo(() => {
    if (!plan) return '';
    const readyIso = toIsoAny(vyezdForm.dateRepairStart || String(state?.vyezd?.dateRepairStart || ''));
    const parts = [
      `Автомобиль: ${plan.carNumber || ''}`,
      `Диспетчер: ${plan.dispatcherName || plan.dispatcher || ''}`,
      `Водитель: ${vyezdForm.driverName || state?.vyezd?.driverName || plan.driverName || '—'}`,
      `Срок готовности: ${readyIso ? toRu(readyIso) : '—'}`,
      `Место доступности: ${state?.zagruzka?.location || '—'}`,
    ];
    return parts.join('\n');
  }, [plan, vyezdForm, state]);

  const copyZagruzka = async () => {
    try {
      await navigator.clipboard.writeText(zagruzkaText);
      toast('Данные скопированы — вставьте их в план загрузок', 'success');
    } catch {
      toast('Не удалось скопировать автоматически — выделите текст вручную', 'error');
    }
  };

  const confirmZagruzka = async (mode: 'manual' | 'auto') => {
    if (!assertCanWrite()) return;
    const ok = await showConfirm('Подтверждаете, что данные внесены в план загрузок?', 'План загрузок');
    if (!ok) return;
    await tripCloseService.recordOperation(tripId, 'zagruzkaConfirmed', { summary: mode === 'manual' ? 'внесено вручную' : 'внесено интеграцией' }, user.name);
    await tripCloseService.patch(tripId, { zagruzka: { ...(state?.zagruzka || {}), mode, confirmedBy: user.name, confirmedAt: new Date().toISOString(), driver: vyezdForm.driverName || state?.vyezd?.driverName || '', readyDate: toIsoAny(vyezdForm.dateRepairStart || String(state?.vyezd?.dateRepairStart || '')) } }, user.name);
    await tripCloseService.setStep(tripId, 'zagruzka', 'done', user.name, mode === 'manual' ? 'Внесено вручную и подтверждено' : 'Внесено интеграцией');
    toast('План загрузок: внесение подтверждено', 'success');
    await goStep('docs');
  };

  // ── шаг 5: книга выдачи ──────────────────────────────────────────────────
  const addDoc = () => {
    if (!assertCanWrite()) return;
    if (!docDraft.type.trim()) { toast('Укажите тип или название документа', 'error'); return; }
    const doc: TripCloseDoc = {
      id: `doc_${Date.now().toString(36)}`, type: docDraft.type.trim(), number: docDraft.number.trim(),
      issuedAt: toIso(docDraft.issuedAt), issuedTo: docDraft.issuedTo.trim(), accepted: false,
    };
    void tripCloseService.patch(tripId, { docs: [...(state?.docs || []), doc] }, user.name);
    setDocDraft({ type: '', number: '', issuedAt: '', issuedTo: '' });
  };
  // Снятие отметки — это НЕ undefined-поля: Firebase отвергает значение undefined
  // во всём запросе, и «отметка снимается» на самом деле падала молча.
  const toggleDoc = async (id: string) => {
    if (!assertCanWrite()) return;
    const docs = (state?.docs || []).map((d) => {
      if (d.id !== id) return d;
      if (d.accepted) {
        const { acceptedAt: _at, acceptedBy: _by, ...rest } = d;
        return { ...rest, accepted: false };
      }
      return { ...d, accepted: true, acceptedAt: new Date().toISOString(), acceptedBy: user.name };
    });
    await tripCloseService.patch(tripId, { docs }, user.name);
  };
  const removeDoc = (id: string) => {
    if (!assertCanWrite()) return;
    void tripCloseService.patch(tripId, { docs: (state?.docs || []).filter((d) => d.id !== id) }, user.name);
  };
  const markAllDocs = async () => {
    if (!assertCanWrite()) return;
    const ok = await showConfirm('Отметить все перечисленные документы принятыми? Проверьте список перед подтверждением.', 'Приём документов');
    if (!ok) return;
    const docs = (state?.docs || []).map((d) => ({ ...d, accepted: true, acceptedAt: d.acceptedAt || new Date().toISOString(), acceptedBy: user.name }));
    await tripCloseService.patch(tripId, { docs }, user.name);
    toast('Все документы из списка отмечены принятыми', 'success');
  };
  const runDocsStep = async (skip: boolean) => {
    if (!assertCanWrite()) return;
    if (!skip && !(state?.docs || []).length) { toast('Добавьте документы или подтвердите «Документы не выдавались»', 'error'); return; }
    if (skip) {
      const ok = await showConfirm('Подтверждаете, что по этому рейсу документы не выдавались?', 'Книга выдачи');
      if (!ok) return;
    }
    const docs = (state?.docs || []).map((d) => ({ ...d, acceptedAt: d.acceptedAt || new Date().toISOString(), acceptedBy: d.acceptedBy || user.name }));
    await tripCloseService.patch(tripId, { docs, flags: { ...(state?.flags || {}), docsNone: skip } }, user.name);
    await tripCloseService.recordOperation(tripId, 'docsAccepted', { summary: skip ? 'документы не выдавались' : `принято ${docs.filter((d) => d.accepted).length} из ${docs.length}` }, user.name);
    const partial = !skip && docs.some((d) => !d.accepted);
    await tripCloseService.setStep(tripId, 'docs', partial ? 'postponed' : 'done', user.name,
      partial ? 'Часть документов не принята — шаг можно вернуть и дополнить' : undefined);
    toast(partial ? 'Документы приняты частично — шаг отложен, неполученные видно в сводке' : 'Книга выдачи: приём подтверждён', partial ? 'info' : 'success');
    await goStep('mdp');
  };

  // ── шаг 6: журнал МДП ────────────────────────────────────────────────────
  const addMdp = () => {
    if (!assertCanWrite()) return;
    if (!mdpDraft.number.trim()) { toast('Укажите номер книжки МДП', 'error'); return; }
    const existingDup = (state?.mdp || []).find((b) => b.number.trim() === mdpDraft.number.trim());
    if (existingDup) { toast('Такая книжка уже есть в списке — отметку дублировать не будем', 'info'); return; }
    const book: TripCloseMdpBook = {
      id: `mdp_${Date.now().toString(36)}`, number: mdpDraft.number.trim(), carNumber: String(plan?.carNumber || ''),
      driverName: vyezdForm.driverName || String(plan?.driverName || ''), issuedAt: toIso(mdpDraft.issuedAt), returned: false,
    };
    void tripCloseService.patch(tripId, { mdp: [...(state?.mdp || []), book] }, user.name);
    setMdpDraft({ number: '', issuedAt: '' });
  };
  const toggleMdp = async (id: string) => {
    if (!assertCanWrite()) return;
    const mdp = (state?.mdp || []).map((b) => {
      if (b.id !== id) return b;
      if (b.returned) {
        const { returnedAt: _at, acceptedBy: _by, ...rest } = b;
        return { ...rest, returned: false };
      }
      return { ...b, returned: true, returnedAt: new Date().toISOString(), acceptedBy: user.name };
    });
    await tripCloseService.patch(tripId, { mdp }, user.name);
    const book = mdp.find((b) => b.id === id);
    if (book?.returned && book.docId) {
      const docs = (state?.docs || []).map((d) => (d.id === book.docId ? { ...d, accepted: true, acceptedAt: new Date().toISOString(), acceptedBy: user.name } : d));
      await tripCloseService.patch(tripId, { docs }, user.name);
      toast('Отмечено и в книге выдачи — по заранее установленной связи', 'info');
    }
  };
  const linkMdpToDoc = async (bookId: string, docId: string) => {
    if (!assertCanWrite()) return;
    const mdp = (state?.mdp || []).map((b) => {
      if (b.id !== bookId) return b;
      if (!docId) {
        const { docId: _d, ...rest } = b;
        return rest;
      }
      return { ...b, docId };
    });
    await tripCloseService.patch(tripId, { mdp }, user.name);
    toast(docId ? 'Связь книжки МДП с документом книги выдачи сохранена' : 'Связь снята', 'success');
  };
  const toggleComplete = async (id: string) => {
    if (!assertCanWrite()) return;
    const mdp = (state?.mdp || []).map((b) => (b.id === id ? { ...b, complete: !b.complete } : b));
    await tripCloseService.patch(tripId, { mdp }, user.name);
  };
  const removeMdp = (id: string) => {
    if (!assertCanWrite()) return;
    void tripCloseService.patch(tripId, { mdp: (state?.mdp || []).filter((b) => b.id !== id) }, user.name);
  };
  const runMdpStep = async (notUsed: boolean) => {
    if (!assertCanWrite()) return;
    if (notUsed) {
      const ok = await showConfirm('Подтверждаете, что книжка МДП в этом рейсе не использовалась?', 'Журнал МДП');
      if (!ok) return;
    } else if (!(state?.mdp || []).length) {
      toast('Добавьте книжку МДП или подтвердите, что она не использовалась', 'error');
      return;
    }
    const mdp = state?.mdp || [];
    const pending = mdp.filter((b) => !b.returned);
    await tripCloseService.patch(tripId, { flags: { ...(state?.flags || {}), mdpNotUsed: notUsed } }, user.name);
    await tripCloseService.recordOperation(tripId, 'mdpReturned', { summary: notUsed ? 'книжка не использовалась' : `возврат: ${mdp.filter((b) => b.returned).length} из ${mdp.length}` }, user.name);
    await tripCloseService.setStep(tripId, 'mdp', !notUsed && pending.length ? 'postponed' : 'done', user.name,
      !notUsed && pending.length ? 'Возврат подтверждён не для всех книжек' : undefined);
    toast(notUsed ? 'Подтверждено: книжка МДП не использовалась' : pending.length ? 'Возврат подтверждён частично — шаг отложен' : 'Возврат книжки МДП подтверждён', pending.length ? 'info' : 'success');
  };

  // ── общие действия шагов ─────────────────────────────────────────────────
  const postpone = async (key: StepKey) => {
    if (!assertCanWrite()) return;
    const reason = await showPrompt('Причина откладывания шага (её увидят в сводке):', '', 'Отложить шаг', { confirmLabel: 'Отложить' });
    // «Отмена» в окне ввода — шаг не откладывается (раньше отмена всё равно откладывала шаг).
    if (reason === null) return;
    await tripCloseService.setStep(tripId, key, 'postponed', user.name, reason.trim() || 'Без пояснения');
    await tripCloseService.pushError(tripId, key, 'Шаг отложен', user.name).catch(() => {});
    toast('Шаг отложен — общий статус остаётся «не завершён»', 'info');
  };
  const markNotNeeded = async (key: StepKey) => {
    if (!assertCanWrite()) return;
    const reason = (await showPrompt('Обоснование, почему шаг не требуется (обязательно):', '', 'Шаг не требуется', { confirmLabel: 'Подтвердить' })) || '';
    if (!reason.trim()) { toast('«Не требуется» без обоснования не принимается', 'error'); return; }
    await tripCloseService.setStep(tripId, key, 'not_needed', user.name, reason.trim());
    toast('Шаг отмечен как не требующий действия', 'success');
  };
  const back = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx > 0) void goStep(STEP_ORDER[idx - 1]);
  };
  const forward = () => {
    const idx = STEP_ORDER.indexOf(step);
    if (idx < STEP_ORDER.length - 1) void goStep(STEP_ORDER[idx + 1]);
  };

  const finish = async () => {
    if (!state) return;
    if (!assertCanWrite()) return;
    const ok = await showConfirm('Завершить сценарий закрытия рейса? Данные шагов уже сохранены — отмены не требуется.', 'Завершить сценарий');
    if (!ok) return;
    await tripCloseService.complete(tripId, user.name, role);
    toast('Сценарий закрытия завершён', 'success');
  };

  if (!state && !plan) {
    return (
      <ModalShell isOpen onClose={onClose} title="Закрыть рейс" icon={<Truck className="w-4 h-4" aria-hidden="true" />} maxWidth="max-w-6xl" ariaLabel="Закрыть рейс">
        <div className={UI.loading} role="status"><Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /><span>Загружаем данные рейса…</span></div>
      </ModalShell>
    );
  }

  const st = state || normalizeState(null, tripId);
  const lines = summaryLines(st);
  const missing = missingInSummary(st);
  const toneClass = (tone: 'ok' | 'warn' | 'muted', status?: string) =>
    status === 'postponed' ? 'text-amber-700' : tone === 'ok' ? 'text-emerald-700' : tone === 'warn' ? 'text-amber-700' : 'text-[#6B7280]';

  return (
    <ModalShell
      isOpen
      onClose={() => { void close(); }}
      title={`Закрыть рейс · ${st.carNumber || plan?.carNumber || ''}`}
      subtitle={[
        st.driverNames?.length ? `Водитель: ${st.driverNames.join(', ')}` : (plan?.driverName ? `Водитель: ${plan.driverName}` : 'Водитель не указан'),
        st.route ? `Маршрут: ${st.route}` : plan ? planRouteText(plan) : '',
        (st.dateStart || plan?.dateStart) ? `Период: ${toRu(String(st.dateStart || plan?.dateStart))} – ${toRu(String(st.dateEnd || plan?.dateEnd))}` : '',
        `Запись плана: ${String(plan?.id || st.planDohodId).slice(0, 12)}…`,
      ].filter(Boolean).join(' · ')}
      icon={<Truck className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Закрыть рейс"
      maxWidth="max-w-6xl"
      footer={
        <div className="flex flex-wrap items-center gap-2 w-full">
          <button type="button" data-ui="tc-back" onClick={back} disabled={STEP_ORDER.indexOf(step) === 0} className={`${UI.buttonGhost} disabled:opacity-50`}>
            <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" /> Назад
          </button>
          <button type="button" data-ui="tc-next" onClick={forward} disabled={STEP_ORDER.indexOf(step) === STEP_ORDER.length - 1} className={`${UI.buttonGhost} disabled:opacity-50`}>
            Вперёд <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button type="button" data-ui="tc-postpone" disabled={foreignLocked} onClick={() => void postpone(step)} className={`${UI.buttonGhost} disabled:opacity-50`}>
            <PauseCircle className="w-3.5 h-3.5" aria-hidden="true" /> Отложить шаг
          </button>
          <button type="button" data-ui="tc-close" onClick={() => { void close(); }} className={UI.buttonGhost}>
            <X className="w-3.5 h-3.5" aria-hidden="true" /> Закрыть и продолжить позже
          </button>
          <div className="flex items-center gap-2 ml-auto">
            {st.completedAt ? (
              <button type="button" data-ui="tc-reopen" disabled={foreignLocked} onClick={() => void tripCloseService.reopen(tripId, user.name, role)} className={`${UI.buttonGhost} disabled:opacity-50`}>
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Переоткрыть сценарий
              </button>
            ) : (
              <button
                type="button"
                data-ui="tc-finish"
                onClick={() => void finish()}
                disabled={!progress?.canFinish || foreignLocked}
                title={foreignLocked ? `Сценарий ведёт ${foreignLock}` : progress?.canFinish ? 'Все шаги закрыты' : 'Доступно, когда все шаги выполнены или обоснованно не требуются'}
                className={`${UI.buttonPrimary} disabled:opacity-50`}
              >
                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" /> Завершить сценарий
              </button>
            )}
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        {/* Прогресс и индикатор шагов */}
        <div className="flex flex-col gap-2" data-ui="tc-progress">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-semibold text-[#121316]" data-ui="tc-progress-text">
              Шагов закрыто: {progress?.settled ?? 0} из {progress?.total ?? 6}
              {progress?.postponed.length ? ` · отложено: ${progress.postponed.length}` : ''}
              {progress?.completed ? ' · сценарий завершён' : ''}
            </span>
            {foreignLock && (
              <span className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1" data-ui="tc-foreign-lock">
                <ShieldAlert className="w-3 h-3 inline mr-1" aria-hidden="true" />
                Сценарий ведёт {foreignLock}. Просмотр доступен; изменения может вносить он или после окончания блокировки.
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Шаги закрытия рейса">
            {STEP_DEFS.map((d, i) => {
              const s = st.steps[d.key];
              const active = step === d.key;
              const color = s?.status === 'done' ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                : s?.status === 'postponed' ? 'border-amber-300 bg-amber-50 text-amber-900'
                  : s?.status === 'not_needed' ? 'border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]'
                    : active ? 'border-[var(--accent)] bg-white text-[#121316]' : 'border-[#E5E7EB] bg-white text-[#6B7280]';
              return (
                <button
                  key={d.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-ui="tc-step-pill"
                  data-step={d.key}
                  data-status={s?.status || 'pending'}
                  onClick={() => void goStep(d.key)}
                  className={`text-[11px] rounded-xl border px-2.5 py-1.5 min-h-[44px] md:min-h-[36px] transition-colors cursor-pointer ${color}`}
                  title={`${d.label}: ${STEP_STATUS_LABEL[(s?.status || 'pending') as keyof typeof STEP_STATUS_LABEL]}${s?.note ? ` — ${s.note}` : ''}`}
                >
                  <span className="font-semibold">{i + 1}. {d.short}</span>
                  <span className="block text-[10px] opacity-80">{STEP_STATUS_LABEL[(s?.status || 'pending') as keyof typeof STEP_STATUS_LABEL]}</span>
                </button>
              );
            })}
          </div>
          {!canDo(step) && (
            <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2" data-ui="tc-no-right">
              Недостаточно прав на этот шаг. Прогресс сохранён — шаг сможет выполнить уполномоченный сотрудник.
            </div>
          )}
        </div>

        {/* Тело шага */}
        <div className="border-t border-[#E5E7EB] pt-4">
          {step === 'planDohod' && (
            <div className="flex flex-col gap-3" data-ui="tc-step-plan">
              <div className="text-[11px] text-[#6B7280]">{stepDef('planDohod').hint}</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label className="flex flex-col gap-1"><span className={UI.caption}>Дата старта</span>
                  <input data-ui="tc-plan-start" className={UI.input} value={toRu(planForm.dateStart)} onChange={(e) => setPlanForm({ ...planForm, dateStart: dateInput(e, toRu(planForm.dateStart)) })} />
                </label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Дата финиша</span>
                  <input data-ui="tc-plan-end" className={UI.input} value={toRu(planForm.dateEnd)} onChange={(e) => setPlanForm({ ...planForm, dateEnd: dateInput(e, toRu(planForm.dateEnd)) })} />
                </label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Факт км</span>
                  <input data-ui="tc-plan-km" className={`${UI.input} font-mono tabular-nums`} value={planForm.factKm} placeholder="Фактический пробег, не плановый"
                    onChange={(e) => setPlanForm({ ...planForm, factKm: e.target.value.replace(/[^\d.]/g, '') })} />
                </label>
              </div>
              {planStepIssues({ factKm: planForm.factKm, dateStart: planForm.dateStart, dateEnd: planForm.dateEnd }).map((msg) => (
                <div key={msg} className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-ui="tc-plan-warning">{msg}</div>
              ))}
              <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[#6B7280]">Расходы (статьями)</span>
                  <span className="text-xs font-semibold font-mono tabular-nums text-[#121316]" data-ui="tc-plan-expenses-total">
                    Итого: {expensesSum.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                  </span>
                </div>
                {(planForm.expenses || []).map((row) => (
                  <div key={row.id} className="flex flex-col lg:flex-row lg:items-center gap-2 border border-[#E5E7EB] rounded-xl px-2.5 py-2 bg-white" data-ui="tc-plan-expense-row">
                    <input data-ui="tc-expense-amount" type="number" inputMode="decimal" placeholder="Сумма" value={row.amount === '' ? '' : row.amount}
                      onChange={(e) => setPlanForm((f) => ({ ...f, expenses: f.expenses.map((r) => {
                        if (r.id !== row.id) return r;
                        const amount = e.target.value === '' ? '' : Number(e.target.value);
                        const res = amount === '' ? null : convertToEur(Number(amount), r.currency, conv.rates, r.manualRate ?? null);
                        return { ...r, amount, eur: res && res.ok ? res.eur : null, rate: res && res.ok ? res.rate : null, rateAt: new Date().toISOString() };
                      }) }))}
                      className={`${UI.input} w-24 lg:w-28 font-mono tabular-nums`} />
                    <select data-ui="tc-expense-currency" value={row.currency}
                      onChange={(e) => setPlanForm((f) => ({ ...f, expenses: f.expenses.map((r) => {
                        if (r.id !== row.id) return r;
                        const amount = expenseAmountOf(r);
                        const res = amount === null ? null : convertToEur(amount, e.target.value, conv.rates, null);
                        return { ...r, currency: e.target.value, eur: res && res.ok ? res.eur : null, rate: res && res.ok ? res.rate : null };
                      }) }))}
                      className="px-2 min-h-[44px] bg-[#F3F4F6] border border-[#E5E7EB] rounded-xl text-xs font-bold cursor-pointer" aria-label="Валюта расхода">
                      {['EUR', 'USD', 'BYN', 'RUB', 'TRY', 'KZT', 'CNY'].map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                    <input data-ui="tc-expense-note" placeholder="Пояснение: что это за расход" value={row.note}
                      onChange={(e) => setPlanForm((f) => ({ ...f, expenses: f.expenses.map((r) => (r.id === row.id ? { ...r, note: e.target.value } : r)) }))}
                      className={`${UI.input} flex-1`} />
                    <span className={`text-xs font-mono tabular-nums ${row.eur === null ? 'text-rose-600' : 'text-[#121316]'}`} data-ui="tc-expense-eur">
                      {row.eur === null ? 'нет курса' : `${Number(row.eur).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`}
                    </span>
                    <button type="button" data-ui="tc-expense-remove" className={`${UI.buttonIcon} min-h-[44px] min-w-[44px]`} aria-label="Удалить статью"
                      onClick={() => setPlanForm((f) => ({ ...f, expenses: f.expenses.filter((r) => r.id !== row.id) }))}>
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <button type="button" data-ui="tc-expense-add" className={UI.buttonGhost}
                  onClick={() => setPlanForm((f) => ({ ...f, expenses: [...f.expenses, { id: newExpenseId(), amount: '', currency: 'EUR', note: '', eur: null, rate: null }] }))}>
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Добавить расход
                </button>
                {hasOperation(st, 'planSaved') && (
                  <div className="text-[11px] text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2" data-ui="tc-plan-already">
                    План уже сохранён этим сценарием — при повторе архивация продолжится с незавершённого действия.
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-ui="tc-plan-save" disabled={writeDenied('planDohod') || busy === 'plan'}
                  onClick={() => void runPlanStep()} className={`${UI.buttonPrimary} disabled:opacity-50`}>
                  {busy === 'plan' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Save className="w-3.5 h-3.5" aria-hidden="true" />}
                  Сохранить, архивировать и продолжить
                </button>
              </div>
            </div>
          )}

          {step === 'salary' && (
            <div className="flex flex-col gap-3" data-ui="tc-step-salary">
              <div className="text-[11px] text-[#6B7280]">{stepDef('salary').hint}</div>
              {plan && (
                <div className="text-[11px] text-[#6B7280] leading-relaxed" data-ui="tc-salary-source">
                  Источник — сохранённый план дохода: {planSourceLabel(plan)}
                </div>
              )}
              {recheck.needed && (
                <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-ui="tc-salary-recheck">
                  План изменился после оформления зарплаты: {recheck.reasons.join(', ')}. Проверьте расчёт — автоматически зарплату не переписываем.
                </div>
              )}
              {salaryRef && (
                <div className="text-[11px] text-[#4B5563] bg-[#F9FAFB] border border-[#E5E7EB] rounded-xl px-3 py-2" data-ui="tc-salary-existing">
                  Найдена существующая запись: {salaryRef.driver} · {salaryRef.datetime || ''} · итог {Number(salaryRef.totalSalary || 0).toLocaleString('ru-RU')} — сохранение обновит её, дубль не создаётся.
                </div>
              )}
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                <label className="flex flex-col gap-1 sm:col-span-2"><span className={UI.caption}>Водитель</span>
                  <input data-ui="tc-salary-driver" className={UI.input} value={salaryForm.driver} onChange={(e) => setSalaryForm({ ...salaryForm, driver: e.target.value })} />
                </label>
                {([['rate', 'Ставка за км'], ['km', 'Пробег (Факт км)'], ['totalDays', 'Дней в рейсе'], ['idleDays', 'Дней простоя'], ['idleRate', 'Простой за день'], ['perDiem', 'Суточные за день'], ['bonus', 'Премия']] as const).map(([key, label]) => (
                  <label key={key} className="flex flex-col gap-1"><span className={UI.caption}>{label}</span>
                    <input data-ui={`tc-salary-${key}`} type="number" className={`${UI.input} font-mono tabular-nums`} value={String(salaryForm[key])}
                      onChange={(e) => setSalaryForm({ ...salaryForm, [key]: Number(e.target.value) || 0 })} />
                  </label>
                ))}
              </div>
              <div className="flex flex-wrap gap-4 text-xs font-semibold text-[#121316] font-mono tabular-nums" data-ui="tc-salary-totals">
                <span>За километраж: {salaryTotals.kmMoney.toLocaleString('ru-RU')}</span>
                <span>Простой: {salaryTotals.idleMoney.toLocaleString('ru-RU')}</span>
                <span>Суточные: {salaryTotals.daysMoney.toLocaleString('ru-RU')}</span>
                <span>Премия: {Number(salaryForm.bonus).toLocaleString('ru-RU')}</span>
                <span data-ui="tc-salary-total">Итого водителю: {salaryTotals.totalSalary.toLocaleString('ru-RU')}</span>
              </div>
              <div className="text-[11px] text-[#6B7280]">Сохранение записи не означает выплату: статус «Выплачено», дату выплаты и подтверждение перевода мастер не ставит.</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-ui="tc-salary-save" disabled={writeDenied('salary') || busy === 'salary'}
                  onClick={() => void runSalaryStep()} className={`${UI.buttonPrimary} disabled:opacity-50`}>
                  {busy === 'salary' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Save className="w-3.5 h-3.5" aria-hidden="true" />}
                  Сохранить расчёт и продолжить
                </button>
              </div>
            </div>
          )}

          {step === 'vyezd' && (
            <div className="flex flex-col gap-3" data-ui="tc-step-vyezd">
              <div className="text-[11px] text-[#6B7280]">{stepDef('vyezd').hint}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <label className="flex flex-col gap-1"><span className={UI.caption}>Автомобиль</span>
                  <input className={UI.input} value={String(plan?.carNumber || '')} readOnly /></label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Водитель</span>
                  <input data-ui="tc-vyezd-driver" className={UI.input} value={vyezdForm.driverName} onChange={(e) => setVyezdForm({ ...vyezdForm, driverName: e.target.value })} /></label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Дата приезда (подтвердите)</span>
                  <input data-ui="tc-vyezd-arrival" className={UI.input} value={toRu(vyezdForm.dateArrival)} onChange={(e) => setVyezdForm({ ...vyezdForm, dateArrival: dateInput(e, toRu(vyezdForm.dateArrival)) })} /></label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Готов с (срок готовности)</span>
                  <input data-ui="tc-vyezd-repair-start" className={UI.input} value={toRu(vyezdForm.dateRepairStart)} onChange={(e) => setVyezdForm({ ...vyezdForm, dateRepairStart: dateInput(e, toRu(vyezdForm.dateRepairStart)) })} /></label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Готов по</span>
                  <input data-ui="tc-vyezd-repair-end" className={UI.input} value={toRu(vyezdForm.dateRepairEnd)} onChange={(e) => setVyezdForm({ ...vyezdForm, dateRepairEnd: dateInput(e, toRu(vyezdForm.dateRepairEnd)) })} /></label>
                <label className="flex flex-col gap-1 sm:col-span-2 lg:col-span-3"><span className={UI.caption}>Комментарий</span>
                  <input data-ui="tc-vyezd-comment" className={UI.input} value={vyezdForm.comment} onChange={(e) => setVyezdForm({ ...vyezdForm, comment: e.target.value })} /></label>
              </div>
              <div className="text-[11px] text-[#6B7280]">Дата окончания рейса подставлена как предполагаемая дата приезда — её нужно подтвердить или исправить. Фактический выезд заранее не ставится.</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-ui="tc-vyezd-save" disabled={writeDenied('vyezd') || busy === 'vyezd'}
                  onClick={() => void runVyezdStep()} className={`${UI.buttonPrimary} disabled:opacity-50`}>
                  {busy === 'vyezd' ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Save className="w-3.5 h-3.5" aria-hidden="true" />}
                  Сохранить и продолжить
                </button>
                <button type="button" data-ui="tc-vyezd-not-needed" disabled={foreignLocked} onClick={() => void markNotNeeded('vyezd')} className={`${UI.buttonGhost} disabled:opacity-50`}>Не требуется</button>
              </div>
            </div>
          )}

          {step === 'zagruzka' && (
            <div className="flex flex-col gap-3" data-ui="tc-step-zagruzka">
              <div className="text-[11px] text-[#6B7280]">{stepDef('zagruzka').hint}</div>
              <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-ui="tc-zagruzka-mode">
                Автоматическая запись в таблицу не настроена (в портале таблицы открываются во встроенном просмотре, без серверного доступа к строкам). Доступен ручной режим: скопировать данные, внести их в таблицу и подтвердить.
              </div>
              <pre data-ui="tc-zagruzka-payload" className="text-[11px] leading-relaxed bg-white border border-[#E5E7EB] rounded-xl px-3 py-2 whitespace-pre-wrap font-sans">{zagruzkaText}</pre>
              <label className="flex flex-col gap-1 max-w-sm"><span className={UI.caption}>Место доступности (если известно)</span>
                <input data-ui="tc-zagruzka-location" disabled={foreignLocked} className={`${UI.input} disabled:opacity-60`} value={state?.zagruzka?.location || ''}
                  onChange={(e) => void tripCloseService.patch(tripId, { zagruzka: { ...(state?.zagruzka || {}), location: e.target.value } }, user.name)} /></label>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-ui="tc-zagruzka-copy" onClick={() => void copyZagruzka()} className={UI.buttonGhost}>
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" /> Скопировать данные
                </button>
                {settings?.planZagruzokSheetUrl && (
                  <a data-ui="tc-zagruzka-open" href={settings.planZagruzokSheetUrl} target="_blank" rel="noreferrer" className={UI.buttonGhost}>
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Открыть план загрузок
                  </a>
                )}
                <button type="button" data-ui="tc-zagruzka-confirm" disabled={writeDenied('zagruzka')} onClick={() => void confirmZagruzka('manual')} className={`${UI.buttonPrimary} disabled:opacity-50`}>
                  <Check className="w-3.5 h-3.5" aria-hidden="true" /> Подтверждаю: внесено в план загрузок
                </button>
              </div>
              <div className="text-[11px] text-[#6B7280]">Просто открытая таблица шаг не закрывает — нужно явное подтверждение внесения.</div>
            </div>
          )}

          {step === 'docs' && (
            <div className="flex flex-col gap-3" data-ui="tc-step-docs">
              <div className="text-[11px] text-[#6B7280]">{stepDef('docs').hint}</div>
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end">
                <label className="flex flex-col gap-1 sm:col-span-2"><span className={UI.caption}>Тип документа</span>
                  <input data-ui="tc-doc-type" className={UI.input} placeholder="CMR, книжка МДП, дозвол, T1…" value={docDraft.type} onChange={(e) => setDocDraft({ ...docDraft, type: e.target.value })} /></label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Номер</span>
                  <input data-ui="tc-doc-number" className={UI.input} value={docDraft.number} onChange={(e) => setDocDraft({ ...docDraft, number: e.target.value })} /></label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Дата выдачи</span>
                  <input data-ui="tc-doc-issued" className={UI.input} value={docDraft.issuedAt} onChange={(e) => setDocDraft({ ...docDraft, issuedAt: dateInput(e, docDraft.issuedAt) })} /></label>
                <button type="button" data-ui="tc-doc-add" disabled={foreignLocked} onClick={addDoc} className={`${UI.buttonGhost} disabled:opacity-50`}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Добавить</button>
              </div>
              <div className="flex flex-col gap-2" data-ui="tc-docs-list">
                {(state?.docs || []).length === 0 && (
                  <div className="text-[11px] text-[#9CA3AF]">Документов нет. Перечислите выданные по рейсу — или подтвердите, что документы не выдавались.</div>
                )}
                {(state?.docs || []).map((d) => (
                  <div key={d.id} className="flex flex-wrap items-center gap-2 border border-[#E5E7EB] rounded-xl px-2.5 py-2 bg-white" data-ui="tc-doc-row" data-doc-id={d.id}>
                    <span className="text-xs font-semibold text-[#121316]">{d.type}</span>
                    {d.number ? <span className="text-[11px] text-[#6B7280] font-mono">{d.number}</span> : null}
                    {d.issuedAt ? <span className="text-[11px] text-[#6B7280]">выдан {toRu(d.issuedAt)}</span> : null}
                    <label className="flex items-center gap-1.5 text-[11px] text-[#4B5563] ml-auto cursor-pointer">
                      <input data-ui="tc-doc-accept" type="checkbox" disabled={foreignLocked} checked={d.accepted} onChange={() => void toggleDoc(d.id)} className="w-4 h-4" />
                      Принят{d.acceptedAt ? ` · ${new Date(d.acceptedAt).toLocaleString('ru-RU')}` : ''}{d.acceptedBy ? ` · ${d.acceptedBy}` : ''}
                    </label>
                    <button type="button" data-ui="tc-doc-remove" disabled={foreignLocked} className={`${UI.buttonIcon} min-h-[44px] min-w-[44px] disabled:opacity-50`} aria-label="Удалить строку" onClick={() => removeDoc(d.id)}>
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              {missing.docs.length > 0 && (
                <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2" data-ui="tc-docs-missing">
                  Не принято документов: {missing.docs.length}. Частичный приём сохраняется — шаг останется отложенным, пока не принято всё.
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" data-ui="tc-docs-all" disabled={foreignLocked} onClick={() => void markAllDocs()} className={`${UI.buttonGhost} disabled:opacity-50`}>Отметить все</button>
                <button type="button" data-ui="tc-docs-save" disabled={writeDenied('docs')} onClick={() => void runDocsStep(false)} className={`${UI.buttonPrimary} disabled:opacity-50`}>
                  <Save className="w-3.5 h-3.5" aria-hidden="true" /> Сохранить приём и продолжить
                </button>
                <button type="button" data-ui="tc-docs-none" disabled={writeDenied('docs')} onClick={() => void runDocsStep(true)} className={`${UI.buttonGhost} disabled:opacity-50`}>
                  Документы не выдавались
                </button>
              </div>
            </div>
          )}

          {step === 'mdp' && (
            <div className="flex flex-col gap-3" data-ui="tc-step-mdp">
              <div className="text-[11px] text-[#6B7280]">{stepDef('mdp').hint}</div>
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
                <label className="flex flex-col gap-1 sm:col-span-2"><span className={UI.caption}>Номер книжки МДП</span>
                  <input data-ui="tc-mdp-number" className={UI.input} value={mdpDraft.number} onChange={(e) => setMdpDraft({ ...mdpDraft, number: e.target.value })} /></label>
                <label className="flex flex-col gap-1"><span className={UI.caption}>Дата выдачи</span>
                  <input data-ui="tc-mdp-issued" className={UI.input} value={mdpDraft.issuedAt} onChange={(e) => setMdpDraft({ ...mdpDraft, issuedAt: dateInput(e, mdpDraft.issuedAt) })} /></label>
                <button type="button" data-ui="tc-mdp-add" disabled={foreignLocked} onClick={addMdp} className={`${UI.buttonGhost} disabled:opacity-50`}><Plus className="w-3.5 h-3.5" aria-hidden="true" /> Добавить книжку</button>
              </div>
              <div className="flex flex-col gap-2" data-ui="tc-mdp-list">
                {(state?.mdp || []).length === 0 && <div className="text-[11px] text-[#9CA3AF]">Книжек нет. Добавьте выданные книжки — или подтвердите, что книжка МДП не использовалась.</div>}
                {(state?.mdp || []).map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-2 border border-[#E5E7EB] rounded-xl px-2.5 py-2 bg-white" data-ui="tc-mdp-row" data-mdp-id={b.id}>
                    <span className="text-xs font-semibold text-[#121316] font-mono">{b.number}</span>
                    <span className="text-[11px] text-[#6B7280]">{b.carNumber || ''}{b.driverName ? ` · ${b.driverName}` : ''}{b.issuedAt ? ` · выдан ${toRu(b.issuedAt)}` : ''}</span>
                    <label className="flex items-center gap-1.5 text-[11px] text-[#4B5563] ml-auto cursor-pointer">
                      <input data-ui="tc-mdp-returned" type="checkbox" disabled={foreignLocked} checked={b.returned} onChange={() => void toggleMdp(b.id)} className="w-4 h-4" />
                      Возвращена{b.returnedAt ? ` · ${new Date(b.returnedAt).toLocaleString('ru-RU')}` : ''}{b.acceptedBy ? ` · принял ${b.acceptedBy}` : ''}
                    </label>
                    <label className="flex items-center gap-1.5 text-[11px] text-[#4B5563] cursor-pointer">
                      <input type="checkbox" disabled={foreignLocked} checked={!!b.complete} onChange={() => void toggleComplete(b.id)} className="w-4 h-4" /> Комплектность
                    </label>
                    {(state?.docs || []).length > 0 && (
                      <select data-ui="tc-mdp-link" value={b.docId || ''} disabled={foreignLocked} onChange={(e) => void linkMdpToDoc(b.id, e.target.value)}
                        className="px-2 min-h-[44px] bg-[#F3F4F6] border border-[#E5E7EB] rounded-lg text-[11px] cursor-pointer disabled:opacity-60" aria-label="Связь с документом книги выдачи">
                        <option value="">Связь с книгой выдачи: не указана</option>
                        {(state?.docs || []).map((d) => <option key={d.id} value={d.id}>{d.type}{d.number ? ` №${d.number}` : ''}</option>)}
                      </select>
                    )}
                    <button type="button" data-ui="tc-mdp-remove" disabled={foreignLocked} className={`${UI.buttonIcon} min-h-[44px] min-w-[44px] disabled:opacity-50`} aria-label="Удалить книжку" onClick={() => removeMdp(b.id)}>
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-[#6B7280]">Факт приезда машины не означает возврат книжки: возврат и комплектность отмечаются отдельно, связь с книгой выдачи указывается вручную.</div>
              <div className="flex flex-wrap gap-2">
                <button type="button" data-ui="tc-mdp-save" disabled={writeDenied('mdp')} onClick={() => void runMdpStep(false)} className={`${UI.buttonPrimary} disabled:opacity-50`}>
                  <Save className="w-3.5 h-3.5" aria-hidden="true" /> Сохранить и продолжить
                </button>
                <button type="button" data-ui="tc-mdp-not-used" disabled={writeDenied('mdp')} onClick={() => void runMdpStep(true)} className={`${UI.buttonGhost} disabled:opacity-50`}>
                  Книжка МДП не использовалась
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Итоговая сводка */}
        <div className="border-t border-[#E5E7EB] pt-4" data-ui="tc-summary">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-[#121316] flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#9CA3AF]" aria-hidden="true" /> Сводка по шагам
            </span>
            <span className="text-[11px] text-[#6B7280]" data-ui="tc-overall-status">
              {st.completedAt ? `Сценарий завершён${st.completedBy ? ` · ${st.completedBy}` : ''}` : 'Общий статус: не завершён'}
            </span>
          </div>
          <div className="flex flex-col divide-y divide-[#E5E7EB] border border-[#E5E7EB] rounded-xl overflow-hidden">
            {lines.map((line) => (
              <div key={line.key} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-white" data-ui="tc-summary-row" data-step={line.key}>
                <span className="text-xs text-[#4B5563] font-medium">{line.label}</span>
                <span className={`text-xs font-semibold ${toneClass(line.tone, st.steps[line.key]?.status)}`}>{line.result}</span>
              </div>
            ))}
          </div>
          {(missing.docs.length > 0 || missing.mdp.length > 0) && (
            <div className="text-[11px] text-amber-900 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mt-2 leading-relaxed" data-ui="tc-summary-missing">
              {missing.docs.length ? `Не получены документы: ${missing.docs.map((d) => `${d.type}${d.number ? ` №${d.number}` : ''}`).join(', ')}. ` : ''}
              {missing.mdp.length ? `Не подтверждён возврат книжек МДП: ${missing.mdp.map((b) => b.number).join(', ')}.` : ''}
            </div>
          )}
          <div className="text-[10px] text-[#9CA3AF] mt-1.5 leading-relaxed">
            Действия шагов сохранены на сервере: закрытие окна, перезагрузка или вход другого сотрудника продолжают сценарий с незавершённого шага. Повторный запуск не архивирует план дважды, не создаёт вторую зарплату и не дублирует записи и отметки.
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

/**
 * Модуль «Таймлайн рейсов по машинам» (ключ tripTimeline, группа «Планирование»).
 *
 * Вкладки: Таймлайн (одна группа строк на машину: «План» сверху, «Факт» снизу),
 * События (события машин) и Статистика. Вся работа с рейсом — в модальном окне,
 * которое открывается с таймлайна (отдельной вкладки «Рейсы и этапы» нет; старый
 * маршрут #tripTimeline/trips ведёт на таймлайн с открытием нужного рейса).
 *
 * Источники: «План дохода» (границы целых рейсов, архивный статус, месяцы архива)
 * и «Учёт выезда» (план базы: приезд → срок готовности; факт: приезд → выезд;
 * ремонт). Полосы строятся из источников на чтении — дубликатов не бывает,
 * изменение записи обновляет таймлайн, архивный статус меняется только в «Плане
 * дохода» (на таймлайне таких действий нет).
 *
 * Диспетчеры — вкладками (как в «Плане дохода»), месяцы архива — вкладками как
 * в архиве плана дохода; обе группы действуют совместно. Календарь реально
 * прокручивается по горизонтали: у краёв диапазон догружается днями, положение
 * видимой области при догрузке слева сохраняется.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import type { AppSettings, TimelinePlanGuard, TimelinePlanPermission, TimelinePlanRequest, UserProfile } from '../../types';
import { dbService, pdService } from '../../api';
import { resolvePermission } from '../../utils/permissions';
import { buildDispatcherDirectory } from '../../utils/dispatcher';
import { UI } from '../../ui/kit';
import { ModalShell, ModuleShell } from '../../ui/components';
import { useToast } from '../ToastProvider';
import { useHashRoute } from '../../hooks/useHashRoute';
import TimelineGrid from './tripTimeline/TimelineGrid';
import TripCard from './tripTimeline/TripCard';
import NewTripForm, { type NewTripDraft, type NewTripResult } from './tripTimeline/NewTripForm';
import StatsBlock from './tripTimeline/StatsBlock';
import PeriodModal from './tripTimeline/PeriodModal';
import CarOverviewModal from './tripTimeline/CarOverviewModal';
import { useTimelineData } from './tripTimeline/useTimelineData';
import { sortMonthLabelsDesc, todayNum, zoomColW, zoomIndexOf } from './tripTimeline/lib/timeline';
import { plateKeyOf } from './tripTimeline/lib/sources';
import { buildTimelinePlanPayload } from './tripTimeline/lib/planFromDraft';

type TabId = 'timeline' | 'stats';

const TAB_SLUGS: Record<TabId, string> = {
  timeline: 'timeline',
  stats: 'stats',
};
const SLUG_TO_TAB: Record<string, TabId> = Object.fromEntries(
  Object.entries(TAB_SLUGS).map(([tab, slug]) => [slug, tab as TabId]),
) as Record<string, TabId>;
const DEFAULT_TAB: TabId = 'timeline';

const ALL_TAB = 'all';
const NONE_TAB = 'none';
const VIEW_KEY = 'ratipa_timeline_view';
const EXT_STEP = 30;
const EXT_MAX = 400;

const activeTabCls = 'bg-[var(--accent-solid)] text-[var(--accent-on)]';

interface Props {
  user: UserProfile;
  settings?: AppSettings | null;
}

export default function TripTimelineModule({ user, settings }: Props) {
  const { toast } = useToast();
  const { route, navigate } = useHashRoute({ module: 'tripTimeline' });
  const data = useTimelineData();

  const requestedTab = route.tab ? SLUG_TO_TAB[route.tab] : DEFAULT_TAB;
  const activeTab: TabId = requestedTab || DEFAULT_TAB;

  const canWrite = resolvePermission(user, 'tripTimeline', settings?.rolePermissions) === 'write';
  const canEditPlan = resolvePermission(user, 'planDohod', settings?.rolePermissions) === 'write';
  /**
   * Создание рейса из таймлайна сразу создаёт запись «Плана дохода»
   * (целые рейсы таймлайна строятся из неё), поэтому право нужно ровно то же,
   * что на создание записи плана: обойти его другой формой нельзя.
   */
  const canCreateTrip = canWrite && canEditPlan;
  const [today, setToday] = useState<number>(() => todayNum());
  /**
   * Текущий день — по календарной дате пользователя (та же конвенция, что во
   * всём модуле: todayNum, YYYY-MM-DD без времени). Обновляем без перезагрузки:
   * лёгкая проверка раз в минуту и при возврате на вкладку — подсветка
   * «сегодня» переезжает на новый день сразу после смены суток.
   */
  useEffect(() => {
    const tick = () => setToday((cur) => { const n = todayNum(); return n === cur ? cur : n; });
    const timer = window.setInterval(tick, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Вид таймлайна (диапазон, пресет периода, вкладка диспетчера, месяц архива)
  const savedView = useMemo(() => {
    try {
      return (JSON.parse(sessionStorage.getItem(VIEW_KEY) || 'null') || {}) as {
        vs?: number;
        dtab?: string;
        amonth?: string | null;
        extL?: number;
        extR?: number;
      };
    } catch {
      return {};
    }
  }, []);
  // Масштаб (ширина дня) — между посещениями через тот же механизм пользовательских
  // настроек, что и zoom листов модулей (localStorage ratipa_*).
  const zoomKey = `ratipa_timeline_zoom_${user.uid || user.name || 'default'}`;
  const [zoom, setZoom] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem(zoomKey));
      if (Number.isFinite(saved) && saved > 0) return zoomIndexOf(saved);
    } catch {
      /* не критично */
    }
    return zoomIndexOf(30);
  });
  const changeZoom = useCallback(
    (index: number) => {
      setZoom(index);
      try {
        localStorage.setItem(zoomKey, String(zoomColW(index)));
      } catch {
        /* не критично */
      }
    },
    [zoomKey],
  );
  const [vs, setVs] = useState<number>(() => (typeof savedView.vs === 'number' ? savedView.vs : todayNum() - 45));
  // Догруженные прокруткой дни хранятся вместе с видом: при возврате позиция
  // прокрутки восстанавливается по календарной дате-якорю (без скачка).
  const [extL, setExtL] = useState(() => Math.max(0, Math.min(EXT_MAX, Number(savedView.extL) || 0)));
  const [extR, setExtR] = useState(() => Math.max(0, Math.min(EXT_MAX, Number(savedView.extR) || 0)));
  const [showArchived, setShowArchived] = useState(true);
  const [archiveMonth, setArchiveMonth] = useState<string | null>(() => savedView.amonth ?? null);

  /**
   * Базовый загруженный диапазон строится из масштаба: видимые дни (оценка по
   * широкому экрану) + запас по 120 дней в каждую сторону. Жёсткого «периода»
   * больше нет; при прокрутке диапазон догружается существующим механизмом,
   * поэтому загруженный край не ощущается границей просмотра.
   */
  const vnBase = useMemo(() => {
    const colW = zoomColW(zoom);
    return Math.max(140, Math.min(430, Math.ceil(1600 / colW) + 120));
  }, [zoom]);
  const renderVs = vs - extL;
  const renderVn = vnBase + extL + extR;

  // ── Вкладки диспетчеров ────────────────────────────────────────────────
  const dir = useMemo(() => buildDispatcherDirectory(data.dispatchers), [data.dispatchers]);
  const isDispatcherUser =
    user.role === 'dispatcher' ||
    (user.isDispatcher === true &&
      user.role !== 'root_admin' &&
      user.role !== 'admin' &&
      user.role !== 'manager' &&
      user.role !== 'accountant');

  const dispatcherTabs = useMemo(() => {
    const tabs: Array<{ id: string; name: string }> = [];
    const seen = new Set<string>();
    data.dispatchers.forEach((d) => {
      if (seen.has(d.id)) return;
      seen.add(d.id);
      tabs.push({ id: d.id, name: d.name });
    });
    const addFrom = (id: string, name: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      tabs.push({ id, name: name || id });
    };
    data.trips.forEach((t) => addFrom(t.dispatcherId, t.dispatcherName));
    data.bases.forEach((p) => addFrom(p.dispatcherId, p.dispatcherName));
    return tabs.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [data.dispatchers, data.trips, data.bases]);

  const hasUnassigned = useMemo(
    () =>
      data.trips.some((t) => !t.dispatcherId) ||
      data.bases.some((p) => !p.dispatcherId) ||
      data.fleetCars.some((c) => !c.dispatcherId),
    [data.trips, data.bases, data.fleetCars],
  );

  const defaultTab = useMemo(() => {
    if (isDispatcherUser && dispatcherTabs.some((t) => t.id === user.uid)) return user.uid;
    return ALL_TAB;
  }, [isDispatcherUser, user.uid, dispatcherTabs]);

  const [dispatcherTab, setDispatcherTab] = useState<string>(
    () => (typeof savedView.dtab === 'string' && savedView.dtab ? savedView.dtab : ALL_TAB),
  );
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (defaultApplied.current) return;
    if (!isDispatcherUser || defaultTab === ALL_TAB) return;
    defaultApplied.current = true;
    setDispatcherTab(defaultTab);
  }, [isDispatcherUser, defaultTab]);

  useEffect(() => {
    try {
      sessionStorage.setItem(VIEW_KEY, JSON.stringify({ vs, dtab: dispatcherTab, amonth: archiveMonth, extL, extR }));
    } catch {
      /* не критично */
    }
  }, [vs, dispatcherTab, archiveMonth, extL, extR]);

  const matchesTab = useCallback(
    (dispatcherId: string): boolean => {
      if (dispatcherTab === ALL_TAB) return true;
      if (dispatcherTab === NONE_TAB) return !dispatcherId;
      return dispatcherId === dispatcherTab;
    },
    [dispatcherTab],
  );

  // Диспетчеры машин по номеру — для событий (у них своего поля диспетчера нет)
  const carDispatcherByNumber = useMemo(() => {
    const m = new Map<string, string>();
    data.fleetCars.forEach((c) => m.set(plateKeyOf(c.carNumber), c.dispatcherId));
    data.bases.forEach((p) => m.set(plateKeyOf(p.carNumber), p.dispatcherId));
    data.trips.forEach((t) => {
      const key = plateKeyOf(t.carNumber);
      if (key && !m.has(key)) m.set(key, t.dispatcherId);
    });
    return m;
  }, [data.fleetCars, data.bases, data.trips]);

  // ── Архив по месяцам (правила «Плана дохода»: currentMonth записи) ─────
  // Группировка — как в «Плане дохода» (месяц завершения записи), но порядок
  // вкладок — строго хронологический по числовому году и месяцу: новые первыми
  // (Январь 2027 → Декабрь 2026 → Ноябрь 2026 → Октябрь 2026 …).
  const archiveMonths = useMemo(() => {
    const months = new Set<string>();
    data.trips.forEach((t) => {
      if (!t.archived) return;
      if (t.kind === 'plan') {
        const m = t.plan?.month || '';
        months.add(m || '__none__');
      } else {
        months.add('__none__');
      }
    });
    const dated = sortMonthLabelsDesc(Array.from(months).filter((m) => m !== '__none__'));
    return dated.concat(months.has('__none__') ? ['__none__'] : []);
  }, [data.trips]);

  const monthMatches = useCallback(
    (t: (typeof data.trips)[number]): boolean => {
      if (!t.archived) return true; // активные рейсы месячный фильтр архива не затрагивает
      if (archiveMonth == null) return true;
      const m = t.kind === 'plan' ? t.plan?.month || '__none__' : '__none__';
      return m === archiveMonth;
    },
    [archiveMonth],
  );

  const filteredTrips = useMemo(
    () => data.trips.filter((t) => matchesTab(t.dispatcherId) && monthMatches(t)),
    [data.trips, matchesTab, monthMatches],
  );
  const filteredBases = useMemo(() => data.bases.filter((p) => matchesTab(p.dispatcherId)), [data.bases, matchesTab]);
  const filteredEvents = useMemo(
    () => data.events.filter((e) => matchesTab(carDispatcherByNumber.get(plateKeyOf(e.carNumber)) || '')),
    [data.events, matchesTab, carDispatcherByNumber],
  );
  const filteredFleetCars = useMemo(() => data.fleetCars.filter((c) => matchesTab(c.dispatcherId)), [data.fleetCars, matchesTab]);

  // ── Общие тексты рейса (причина / меры при просрочке) ─────────────────
  const [metaStore, setMetaStore] = useState<Record<string, Record<string, unknown>>>({});
  useEffect(() => {
    const unsub = dbService.getTimelineTripMeta((store) => setMetaStore(store || {}));
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);
  const metaTimers = useRef<Map<string, number>>(new Map());
  const saveMeta = useCallback((key: string, patch: Record<string, unknown>) => {
    const prev = metaTimers.current.get(key);
    if (prev) window.clearTimeout(prev);
    const t = window.setTimeout(() => {
      metaTimers.current.delete(key);
      dbService.saveTimelineTripMeta(key, patch);
    }, 650);
    metaTimers.current.set(key, t);
  }, []);

  // ── Контроль плана этапов: состояние планов и разовые разрешения ────────
  const [planGuardStore, setPlanGuardStore] = useState<Record<string, TimelinePlanGuard>>({});
  const [planPermsStore, setPlanPermsStore] = useState<Record<string, Record<string, TimelinePlanPermission>>>({});
  /** Запросы разового доступа (по рейсам) — статусы кнопки запроса в карточке. */
  const [planRequestsStore, setPlanRequestsStore] = useState<Record<string, Record<string, TimelinePlanRequest>>>({});
  useEffect(() => {
    const unsub = dbService.getTimelinePlanGuards((store) => setPlanGuardStore(store || {}));
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);
  useEffect(() => {
    const unsub = dbService.getTimelinePlanPerms((store) => setPlanPermsStore(store || {}));
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);
  useEffect(() => {
    const unsub = dbService.getTimelinePlanRequests((store) => setPlanRequestsStore(store || {}));
    return () => {
      if (typeof unsub === 'function') unsub();
    };
  }, []);

  // ── Карточки и модалки ─────────────────────────────────────────────────
  const [openTripKey, setOpenTripKey] = useState<string | null>(null);
  /** Событие, к которому нужно перейти в журнале карточки (с маркера таймлайна). */
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  const [periodKey, setPeriodKey] = useState<string | null>(null);
  const [overviewCarKey, setOverviewCarKey] = useState<string | null>(null);
  const [showNewTrip, setShowNewTrip] = useState(false);

  const openTrip = useCallback((tripKey: string) => {
    setOverviewCarKey(null);
    setOpenTripKey(tripKey);
    setFocusEventId(null);
    try {
      // адресуемая ссылка на окно рейса (переживает F5 и открытие в новой вкладке)
      window.history.replaceState(null, '', `#tripTimeline/trip/${encodeURIComponent(tripKey)}`);
    } catch {
      /* не критично */
    }
  }, []);

  /** Клик по маркеру события: открыть связанный рейс и выделить запись в журнале. */
  const openTripAtEvent = useCallback(
    (tripKey: string, eventId: string) => {
      openTrip(tripKey);
      setFocusEventId(eventId);
    },
    [openTrip],
  );

  // Прямые ссылки: #tripTimeline/trip/<key>; старый маршрут #tripTimeline/trips → таймлайн
  useEffect(() => {
    const parse = () => {
      const h = window.location.hash || '';
      const m = h.match(/#tripTimeline\/trip\/(.+)$/);
      if (m) {
        try {
          setOpenTripKey(decodeURIComponent(m[1]));
        } catch {
          /* не критично */
        }
        return;
      }
      if (h.startsWith('#tripTimeline/events')) {
        // Старые ссылки на вкладку «События»: вкладки больше нет, функции
        // перенесены в журнал карточки рейса — безопасный переход на таймлайн,
        // данные и записи не удаляются.
        navigate(DEFAULT_TAB, undefined, { replace: true });
        return;
      }
      if (h.startsWith('#tripTimeline/trips')) {
        // совместимость со старым маршрутом: не пустая страница, а таймлайн с рейсом
        let focus = '';
        try {
          focus = sessionStorage.getItem('ratipa_focus_timeline_trip') || '';
          if (focus) sessionStorage.removeItem('ratipa_focus_timeline_trip');
        } catch {
          /* не критично */
        }
        navigate(DEFAULT_TAB, undefined, { replace: true });
        if (focus) setOpenTripKey(focus);
      }
    };
    parse();
    window.addEventListener('hashchange', parse);
    return () => window.removeEventListener('hashchange', parse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const closeTrip = useCallback(() => {
    setOpenTripKey(null);
    setFocusEventId(null);
    try {
      const h = window.location.hash || '';
      const clean = h.replace(/\/trip\/[^/]*$/, '');
      window.history.replaceState(null, '', clean || '#tripTimeline/timeline');
    } catch {
      /* не критично */
    }
  }, []);

  const openPeriod = useCallback((key: string) => setPeriodKey(key), []);
  const openCar = useCallback((carKey: string) => setOverviewCarKey(carKey), []);
  const extendRange = useCallback((dir: 'left' | 'right') => {
    if (dir === 'left') setExtL((v) => Math.min(v + EXT_STEP, EXT_MAX));
    else setExtR((v) => Math.min(v + EXT_STEP, EXT_MAX));
  }, []);
  const navigateRange = useCallback((nextVs: number) => {
    setExtL(0);
    setExtR(0);
    setVs(nextVs);
  }, []);

  const archiveToggle = useCallback(
    (trip: (typeof data.trips)[number]) => {
      if (!trip || trip.kind === 'plan') return; // у связанных рейсов архив — только в «Плане дохода»
      dbService.updateTimelineTrip(trip.id, { archived: !trip.archived, updatedAt: new Date().toISOString() });
      toast(trip.archived ? 'Рейс возвращён из архива' : 'Рейс перемещён в архив', 'success');
    },
    [toast],
  );

  const deleteTrip = useCallback(
    (trip: (typeof data.trips)[number]) => {
      if (!trip || trip.kind === 'plan') return;
      dbService.deleteTimelineTrip(trip.id, user.name, user.role);
      toast('Рейс удалён', 'success');
      setOpenTripKey(null);
    },
    [toast, user.name, user.role],
  );

  /**
   * Создание рейса формой таймлайна: единственная запись — trips_dashboard
   * («План дохода») + маркер черновика плана этапов одним атомарным обновлением.
   * Отдельный «ручной рейс» (tripTimeline/trips) НЕ создаётся: целые рейсы
   * таймлайна строятся из записи плана на чтении — дубликата и цикла нет.
   *
   * Повторные нажатия и ретраи после ошибки не создают несколько планов:
   * на время записи форма заблокирована, параллельный вызов получает тот же
   * запрос, а ключ записи фиксируется до записи и переиспользуется при повторе
   * (повторная запись перезаписывает ту же запись).
   */
  const creatingRef = useRef<Promise<NewTripResult> | null>(null);
  const pendingPlanIdRef = useRef('');

  const createTrip = useCallback(
    (draft: NewTripDraft): Promise<NewTripResult> => {
      if (!canWrite || !canEditPlan) {
        const message = !canWrite
          ? 'Нет права на изменение — рейс не создан.'
          : 'Нет права на создание записи «Плана дохода» — рейс не создан.';
        return Promise.resolve({ ok: false, error: message });
      }
      if (creatingRef.current) return creatingRef.current;
      const run = (async (): Promise<NewTripResult> => {
        try {
          if (!dbService.isOnline()) {
            return {
              ok: false,
              error:
                'Нет подключения к базе — связанная запись «Плана дохода» не создана. Данные формы сохранены, повторите после восстановления связи.',
            };
          }
          // Ключ записи фиксируем ДО записи: повтор после ошибки перезапишет её же.
          if (!pendingPlanIdRef.current) {
            let id = '';
            do {
              id = `tl${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
            } while (data.trips.some((t) => t.key === `pd:${id}`));
            pendingPlanIdRef.current = id;
          }
          const planId = pendingPlanIdRef.current;
          const carRef = data.fleetCars.find(
            (c) =>
              (draft.vehicleId ? c.carId === draft.vehicleId : false) ||
              plateKeyOf(c.carNumber) === plateKeyOf(draft.carNumber),
          );
          // Диспетчер: выбор формы, иначе — из справочника сцепок (существующий источник),
          // как это делает и сама форма «Плана дохода». Не выдумываем.
          const dispId = draft.dispatcherId || carRef?.dispatcherId || '';
          const dispName =
            draft.dispatcherName ||
            (dispId ? dir.byId.get(dispId)?.name || '' : '') ||
            carRef?.dispatcherName ||
            '';
          const payload = buildTimelinePlanPayload(draft, {
            createdBy: user.name,
            dispatcher: dispId ? { id: dispId, name: dispName || dispId } : null,
          });
          await pdService.createLinkedTimelineTrip(planId, `pd:${planId}`, payload, user.name, user.role);
          pendingPlanIdRef.current = '';
          toast('Рейс создан — связанная запись «Плана дохода» открыта', 'success');
          setShowNewTrip(false);
          setOpenTripKey(`pd:${planId}`);
          window.location.hash = `#tripTimeline/trip/${encodeURIComponent(`pd:${planId}`)}`;
          return { ok: true };
        } catch (err) {
          return {
            ok: false,
            error: `Не удалось создать рейс: ${(err as Error)?.message || 'неизвестная ошибка'}. Данные формы сохранены — повторите отправку.`,
          };
        }
      })();
      creatingRef.current = run;
      void run.then(() => {
        if (creatingRef.current === run) creatingRef.current = null;
      });
      return run;
    },
    [canWrite, canEditPlan, data.trips, data.fleetCars, dir, user.name, user.role, toast],
  );

  // Переход к связанной записи «Плана дохода» — по прямой ссылке (переживает F5,
  // открывается в новой вкладке, не зависит от фильтров и сортировки).
  const planUrl = useCallback((planId: string) => {
    const base = `${window.location.origin}${window.location.pathname}`;
    return `${base}#planDohod/trip/${encodeURIComponent(planId)}`;
  }, []);

  const openPlanRecord = useCallback(
    (planId: string) => {
      try {
        sessionStorage.setItem('ratipa_focus_plan_trip', planId);
      } catch {
        /* не критично */
      }
      window.location.hash = `#planDohod/trip/${encodeURIComponent(planId)}`;
    },
    [],
  );

  const copyPlanLink = useCallback(
    async (planId: string) => {
      const url = planUrl(planId);
      try {
        await navigator.clipboard.writeText(url);
        toast('Ссылка на план дохода скопирована', 'success');
      } catch {
        window.prompt('Ссылка на план дохода (скопируйте вручную):', url);
      }
    },
    [planUrl, toast],
  );

  const openBazaRecord = useCallback((recordId: string) => {
    try {
      sessionStorage.setItem('ratipa_focus_baza_record', recordId);
    } catch {
      /* не критично */
    }
    window.location.hash = '#baza';
  }, []);

  const tabs = [
    { key: 'timeline', label: 'Таймлайн' },
    { key: 'stats', label: 'Статистика' },
  ];

  const renderVe = renderVs + renderVn - 1;
  const selectedPeriod = periodKey ? data.bases.find((p) => p.key === periodKey) || null : null;
  const overviewCarNumber = overviewCarKey
    ? data.fleetCars.find((c) => `car:${c.carId || c.carNumber}` === overviewCarKey)?.carNumber ||
      data.trips.find((t) => t.carKey === overviewCarKey)?.carNumber ||
      data.bases.find((p) => p.carKey === overviewCarKey)?.carNumber ||
      ''
    : '';
  const overviewTrips = overviewCarKey ? data.trips.filter((t) => t.carKey === overviewCarKey) : [];
  const overviewBases = overviewCarKey ? data.bases.filter((p) => p.carKey === overviewCarKey) : [];
  const defaultDispatcherId = isDispatcherUser && dispatcherTabs.some((t) => t.id === user.uid) ? user.uid : '';

  const openTripObj = openTripKey ? data.trips.find((t) => t.key === openTripKey) || null : null;
  const openTripMetaRaw = openTripKey ? metaStore[openTripKey] || {} : {};
  const openTripMeta = {
    reason: String(openTripMetaRaw.reason || ''),
    measures: String(openTripMetaRaw.measures || ''),
    comment: String(openTripMetaRaw.comment || ''),
  };
  const carTripsForModal = openTripObj ? data.trips.filter((t) => t.carKey === openTripObj.carKey) : [];
  const carBasesForModal = openTripObj ? data.bases.filter((p) => p.carKey === openTripObj.carKey) : [];
  const carEventsForModal = openTripObj
    ? data.events.filter((e) => plateKeyOf(e.carNumber) === plateKeyOf(openTripObj.carNumber))
    : [];

  return (
    <ModuleShell
      title="Таймлайн рейсов"
      tabs={tabs}
      activeTab={activeTab}
      onTabChange={(key) => navigate(TAB_SLUGS[key as TabId] || DEFAULT_TAB)}
      actions={
        <div className="flex items-center gap-2">
          {!canWrite ? <span className={UI.chip}>режим чтения</span> : null}
          {canCreateTrip ? (
            <button type="button" data-ui="new-trip" onClick={() => setShowNewTrip(true)} className={UI.buttonPrimary}>
              <Plus className="w-4 h-4" aria-hidden="true" />
              Новый рейс
            </button>
          ) : canWrite ? (
            <span
              className={UI.hint}
              data-ui="new-trip-denied"
              title="Создание рейса из таймлайна создаёт связанную запись «Плана дохода» — нужно право её создания"
            >
              Создание рейса недоступно: нет права записи в «План дохода»
            </span>
          ) : null}
        </div>
      }
    >
      {/* Вкладки диспетчеров — тот же источник и стиль, что у «Плана дохода» */}
      <div className="flex flex-wrap items-center gap-2 pb-3 border-b border-[#E5E7EB] mb-4">
        <span className={UI.caption}>Диспетчеры:</span>
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5" role="tablist" aria-label="Вкладки диспетчеров">
          <button
            type="button"
            data-dtab={ALL_TAB}
            aria-pressed={dispatcherTab === ALL_TAB}
            onClick={() => setDispatcherTab(ALL_TAB)}
            className={`${UI.filterPill} shrink-0 ${dispatcherTab === ALL_TAB ? activeTabCls : UI.filterPillIdle}`}
          >
            Все диспетчеры
          </button>
          {dispatcherTabs.map((d) => (
            <button
              key={d.id}
              type="button"
              data-dtab={d.id}
              aria-pressed={dispatcherTab === d.id}
              onClick={() => setDispatcherTab(d.id)}
              title={d.name}
              className={`${UI.filterPill} shrink-0 truncate max-w-[170px] ${dispatcherTab === d.id ? activeTabCls : UI.filterPillIdle}`}
            >
              {d.name}
            </button>
          ))}
          {hasUnassigned ? (
            <button
              type="button"
              data-dtab={NONE_TAB}
              aria-pressed={dispatcherTab === NONE_TAB}
              onClick={() => setDispatcherTab(NONE_TAB)}
              className={`${UI.filterPill} shrink-0 ${dispatcherTab === NONE_TAB ? activeTabCls : UI.filterPillIdle}`}
            >
              Без диспетчера
            </button>
          ) : null}
        </div>
      </div>

      {/* Месяцы архива — те же записи и правило группировки, что в «Плане дохода»
          (месяц завершения, currentMonth записи плана дохода) */}
      {showArchived && archiveMonths.length ? (
        <div className="flex flex-wrap items-center gap-2 pb-3 mb-4 border-b border-[#E5E7EB]">
          <span className={UI.caption} title="Рейсы сгруппированы по месяцу завершения, как в архиве «Плана дохода»">
            Архив по месяцам:
          </span>
          <div className="flex items-center gap-1.5 overflow-x-auto max-w-full pb-0.5" role="tablist" aria-label="Месяцы архива">
            <button
              type="button"
              data-amonth="all"
              aria-pressed={archiveMonth == null}
              onClick={() => setArchiveMonth(null)}
              className={`${UI.filterPill} shrink-0 ${archiveMonth == null ? activeTabCls : UI.filterPillIdle}`}
            >
              Все месяцы
            </button>
            {archiveMonths.map((m) => (
              <button
                key={m}
                type="button"
                data-amonth={m}
                aria-pressed={archiveMonth === m}
                onClick={() => setArchiveMonth(m)}
                className={`${UI.filterPill} shrink-0 truncate max-w-[200px] ${archiveMonth === m ? activeTabCls : UI.filterPillIdle}`}
              >
                {m === '__none__' ? 'Без даты' : m}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {/* Вкладки модуля держим смонтированными: возврат сохраняет прокрутку и состояние */}
      <div className={activeTab === 'timeline' ? '' : 'hidden'}>
        <TimelineGrid
          trips={filteredTrips}
          bases={filteredBases}
          events={filteredEvents}
          fleetCars={filteredFleetCars}
          stageTypes={data.stageTypes}
          today={today}
          vs={renderVs}
          vn={renderVn}
          extL={extL}
          extR={extR}
          navVs={vs}
          zoom={zoom}
          onZoomChange={changeZoom}
          onNavigate={navigateRange}
          onRangeExtend={extendRange}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
          selectedTripKey={openTripKey}
          onOpenTrip={openTrip}
          onOpenTripEvent={openTripAtEvent}
          onOpenBase={openPeriod}
          onOpenCar={openCar}
        />
      </div>

      <div className={activeTab === 'stats' ? '' : 'hidden'}>
        <StatsBlock
          trips={filteredTrips}
          allTrips={data.trips}
          allEvents={data.events}
          bases={filteredBases}
          stageTypes={data.stageTypes}
          from={renderVs}
          to={Math.min(renderVe, today)}
          today={today}
        />
      </div>

      {/* Окно ручного/связанного рейса */}
      {openTripObj ? (
        <TripCard
          trip={openTripObj}
          stageTypes={data.stageTypes}
          dispatchers={data.dispatchers}
          today={today}
          canWrite={canWrite}
          canEditPlan={canEditPlan}
          user={user}
          meta={openTripMeta}
          onSaveMeta={(key, patch) => saveMeta(key, patch as Record<string, unknown>)}
          focusEventId={focusEventId}
          onFocusEventDone={() => setFocusEventId(null)}
          onOpenEventTrip={openTripAtEvent}
          planGuard={openTripKey ? planGuardStore[openTripKey] || null : null}
          planPerms={openTripKey ? planPermsStore[openTripKey] || {} : {}}
          planRequests={openTripKey ? planRequestsStore[openTripKey] || {} : {}}
          planControlEnabled={dbService.isOnline()}
          carTrips={carTripsForModal}
          carBases={carBasesForModal}
          carEvents={carEventsForModal}
          cities={data.cities}
          onSelectTrip={(key) => setOpenTripKey(key)}
          onOpenPlan={openPlanRecord}
          onCopyPlanLink={copyPlanLink}
          onArchiveToggle={archiveToggle}
          onDelete={deleteTrip}
          onClose={closeTrip}
        />
      ) : null}

      {/* Новый рейс: создаётся сразу связанная запись «Плана дохода» (тот же id —
          ключ полосы `pd:<id>`), отдельный ручной рейс не создаётся */}
      {showNewTrip && canCreateTrip ? (
        <ModalShell
          isOpen
          onClose={() => setShowNewTrip(false)}
          title="Новый рейс"
          subtitle="Рейс создаётся вместе со связанной записью «Плана дохода» — финансовые данные заполняются в плане"
          icon={<Plus className="w-4 h-4" aria-hidden="true" />}
          ariaLabel="Новый рейс"
          maxWidth="max-w-2xl"
        >
          <NewTripForm
            dispatchers={data.dispatchers}
            defaultDispatcherId={defaultDispatcherId}
            canWrite={canCreateTrip}
            onCreate={createTrip}
            onCancel={() => setShowNewTrip(false)}
          />
        </ModalShell>
      ) : null}

      {selectedPeriod ? (
        <PeriodModal period={selectedPeriod} today={today} onClose={() => setPeriodKey(null)} onOpenBaza={openBazaRecord} />
      ) : null}

      {overviewCarKey ? (
        <CarOverviewModal
          carKey={overviewCarKey}
          carNumber={overviewCarNumber}
          trips={overviewTrips}
          bases={overviewBases}
          today={today}
          onSelectTrip={(key) => {
            setOverviewCarKey(null);
            setOpenTripKey(key);
          }}
          onSelectPeriod={(key) => {
            setOverviewCarKey(null);
            openPeriod(key);
          }}
          onClose={() => setOverviewCarKey(null)}
        />
      ) : null}
    </ModuleShell>
  );
}

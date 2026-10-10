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
import { HelpCircle, Plus } from 'lucide-react';
import type { AppSettings, TimelinePlanGuard, TimelinePlanPermission, TimelinePlanRequest, UserProfile } from '../../types';
import { dbService, pdService } from '../../api';
import { resolvePermission } from '../../utils/permissions';
import { buildDispatcherDirectory } from '../../utils/dispatcher';
import { UI } from '../../ui/kit';
import { ModuleShell } from '../../ui/components';
import { useToast } from '../ToastProvider';
import { useHashRoute } from '../../hooks/useHashRoute';
import TimelineGrid from './tripTimeline/TimelineGrid';
import TripCard from './tripTimeline/TripCard';
import NewTripForm, { type NewTripDraft, type NewTripResult } from './tripTimeline/NewTripForm';
import StatsBlock from './tripTimeline/StatsBlock';
import CarOverviewModal from './tripTimeline/CarOverviewModal';
import { useTimelineData } from './tripTimeline/useTimelineData';
import { sortMonthLabelsDesc, todayNum, zoomColW, zoomIndexOf } from './tripTimeline/lib/timeline';
import { plateKeyOf } from './tripTimeline/lib/sources';
import { setColumnHighlight } from './tripTimeline/lib/timelinePrefs';
import {
  openDepartureAccountingPanel,
  parseDeparturePanelHash,
  replaceDeparturePanelHash,
  type ParsedDeparturePanel,
} from './tripTimeline/lib/vyezd';
import VyezdPeriodWindow from './tripTimeline/VyezdPeriodWindow';
import { buildTimelinePlanPayload } from './tripTimeline/lib/planFromDraft';
import TripTimelineGuide, { guideStepAvailable } from './tripTimeline/guide/TripTimelineGuide';
import { GUIDE_VERSION, GUIDE_WHATS_NEW, buildGuideSteps, type GuideContext, type GuideStep } from './tripTimeline/guide/guideContent';

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
   * Правка записи «Учёта выезда» — та же проверка, что в модуле (запись в baza;
   * механик — специальное правило портала: доступ есть, правка через карточку
   * модуля ему недоступна — там тот же запрет).
   */
  const bazaWrite = user.role === 'root_admin' || resolvePermission(user, 'baza', settings?.rolePermissions) === 'write';
  const canEditBaza = bazaWrite && user.role !== 'mechanic';
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
  /**
   * Архив по умолчанию СКРЫТ: при входе в модуль и после перезагрузки галочка
   * выключена, включённое состояние из localStorage/настроек НЕ восстанавливается.
   * В рамках открытого модуля состояние живёт в React и сохраняется при
   * обновлении данных и переключении вкладок (модуль не размонтируется).
   * Фильтр применяется до первого рендера полос — архив не мелькает.
   */
  const [showArchived, setShowArchived] = useState(false);
  const [archiveMonth, setArchiveMonth] = useState<string | null>(() => savedView.amonth ?? null);
  /** Полноэкранный режим рабочей области (тот же таймлайн, без копии DOM). */
  const [fullscreen, setFullscreen] = useState(false);
  const toggleFullscreen = useCallback(() => setFullscreen((v) => !v), []);

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
    // Порядок — как во вкладках «Плана дохода» (порядок справочника, БЕЗ
    // алфавитной пересортировки); диспетчеры, встречающиеся только в записях,
    // добавляются после — в порядке первого появления.
    return tabs;
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

  /**
   * «Подсветка столбца» — настройка ПОЛЬЗОВАТЕЛЯ (users_list/{uid}/tlPrefs):
   * при входе значение берётся из профиля (по умолчанию включено), переключатель
   * лежит в панели управления полотна и пишется обратно в профиль — выбор
   * действует на всех устройствах и во встроенных таймлайнах.
   */
  useEffect(() => {
    setColumnHighlight(user.tlPrefs?.columnHighlight !== false);
  }, [user.uid, user.tlPrefs?.columnHighlight]);
  const changeColumnHighlight = useCallback(
    (v: boolean) => {
      setColumnHighlight(v);
      if (user.uid) dbService.saveTimelinePrefs(user.uid, { columnHighlight: v });
    },
    [user.uid],
  );

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
  /**
   * Окно «Учёт выезда» ПОВЕРХ таймлайна (требование владельца: страница НЕ
   * меняется). Открывается единым хелпером openDepartureAccountingPanel; hash —
   * #tripTimeline/vehicle/<ключ>/departure/<id|nearest> («Назад» закрывает окно,
   * прямая ссылка открывает то же окно поверх таймлайна).
   */
  const [panelTarget, setPanelTarget] = useState<ParsedDeparturePanel | null>(() =>
    typeof window === 'undefined' ? null : parseDeparturePanelHash(window.location.hash),
  );
  /** Hash до открытия окна — «Закрыть» возвращает его без новой записи истории. */
  const panelReturnHash = useRef<string>('');
  /** Событие, к которому нужно перейти в журнале карточки (с маркера таймлайна). */
  const [focusEventId, setFocusEventId] = useState<string | null>(null);
  /** Этап, который нужно выделить в карточке (клик по заливке этапа на полотне). */
  const [focusStageId, setFocusStageId] = useState<string | null>(null);
  const [overviewCarKey, setOverviewCarKey] = useState<string | null>(null);
  const [showNewTrip, setShowNewTrip] = useState(false);

  // Текущее назначение машин (единый справочник сцепок) — основа группировки
  // вкладки «Все»: одна группа строк на автомобиль, без дублей из-за истории.
  const carCurrentDispatcher = useMemo(() => {
    const m = new Map<string, { id: string; name: string }>();
    data.fleetCars.forEach((c) => {
      m.set(`car:${c.carId || c.carNumber}`, { id: c.dispatcherId, name: c.dispatcherName });
    });
    return m;
  }, [data.fleetCars]);

  /** Порядок диспетчеров для блоков «Все» — тот же, что у вкладок модуля. */
  const dispatcherOrderIds = useMemo(() => dispatcherTabs.map((t) => t.id), [dispatcherTabs]);

  const openTrip = useCallback((tripKey: string) => {
    setOverviewCarKey(null);
    setOpenTripKey(tripKey);
    setFocusEventId(null);
    setFocusStageId(null);
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

  /** Клик по заливке этапа: открыть рейс и выделить этап в таблице карточки. */
  const openTripAtStage = useCallback(
    (tripKey: string, stageId: string) => {
      openTrip(tripKey);
      setFocusStageId(stageId);
    },
    [openTrip],
  );

  // Прямые ссылки: #tripTimeline/trip/<key>; окно учёта выезда поверх таймлайна
  // (#tripTimeline/vehicle/…/departure/…); старый маршрут #tripTimeline/trips → таймлайн
  useEffect(() => {
    const parse = () => {
      const h = window.location.hash || '';
      const m = h.match(/#tripTimeline\/trip\/(.+)$/);
      if (m) {
        setPanelTarget(null);
        try {
          setOpenTripKey(decodeURIComponent(m[1]));
        } catch {
          /* не критично */
        }
        return;
      }
      // Окно «Учёт выезда» поверх таймлайна: hash остаётся маршрутом таймлайна.
      const panel = parseDeparturePanelHash(h);
      if (panel) {
        setPanelTarget(panel);
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
        return;
      }
      // Любой другой hash таймлайна (в т.ч. возврат «Назад» из окна) — окно закрыто.
      setPanelTarget(null);
    };
    parse();
    window.addEventListener('hashchange', parse);
    return () => window.removeEventListener('hashchange', parse);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  const closeTrip = useCallback(() => {
    setOpenTripKey(null);
    setFocusEventId(null);
    setFocusStageId(null);
    try {
      const h = window.location.hash || '';
      const clean = h.replace(/\/trip\/[^/]*$/, '');
      window.history.replaceState(null, '', clean || '#tripTimeline/timeline');
    } catch {
      /* не критично */
    }
  }, []);

  /**
   * Выход из полноэкранного режима — Escape. Если открыта карточка рейса или
   * вложенное окно (aria-modal), Escape сначала закрывает ЕЁ (свой обработчик
   * карточки перехватывает клавишу раньше), а режим остаётся — это проверяем и
   * явно, чтобы вложенные окна закрывались первыми.
   */
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('[aria-modal="true"]')) return; // закроется вложенное окно
      setFullscreen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen]);

  /**
   * Клик по полосе/отметке периода «Учёта выезда» — ЕДИНЫЙ хелпер
   * «открыть учёт выезда (машина, период)» (lib/vyezd): открывает ВСТРОЕННОЕ
   * ОКНО поверх таймлайна (страница не меняется, hash —
   * #tripTimeline/vehicle/<ключ>/departure/<id>; «Назад» закрывает окно).
   * Общий список не открывается, чужая машина не показывается.
   */
  const openPeriod = useCallback(
    (key: string) => {
      const p = data.bases.find((b) => b.key === key);
      if (!p) return;
      try {
        panelReturnHash.current = window.location.hash || '';
      } catch {
        panelReturnHash.current = '';
      }
      openDepartureAccountingPanel({ periodId: p.id, carKey: p.carKey, carNumber: p.carNumber });
    },
    [data.bases],
  );
  const openCar = useCallback((carKey: string) => setOverviewCarKey(carKey), []);

  /** Закрыть окно «Учёт выезда» без смены страницы: возврат к прежнему hash. */
  const closeDeparturePanel = useCallback(() => {
    setPanelTarget(null);
    try {
      const { pathname, search } = window.location;
      const back = panelReturnHash.current || `#tripTimeline/${TAB_SLUGS[activeTab] || DEFAULT_TAB}`;
      window.history.replaceState(null, '', `${pathname}${search}${back}`);
    } catch {
      /* не критично */
    }
  }, [activeTab]);

  /** Явное действие окна «Открыть в модуле Учёт выезда»: страница меняется
   *  ТОЛЬКО по желанию пользователя; запись подсветится в списке модуля. */
  const openBazaModuleFor = useCallback((recordId: string | null) => {
    try {
      if (recordId) sessionStorage.setItem('ratipa_focus_baza_record', recordId);
    } catch {
      /* не критично */
    }
    window.location.hash = '#baza';
  }, []);

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

  const tabs = [
    { key: 'timeline', label: 'Таймлайн' },
    { key: 'stats', label: 'Статистика' },
  ];

  // ── Интерактивный гайд «Обучение» ──────────────────────────────────────
  /**
   * Дождаться, пока полотно таймлайна «осело»: есть строки машин и полосы
   * (или истёк лимит ожидания). Нужно, чтобы шаги гайда, чьи элементы
   * появляются вместе с данными (плановая полоса, полоса «Учёта выезда»,
   * фактическая полоса), не пропускались из-за гонки с загрузкой данных.
   */
  const waitForTimelineReady = useCallback(
    (maxMs = 5000): Promise<void> =>
      new Promise((resolve) => {
        const started = Date.now();
        const tick = () => {
          const ready =
            !!document.querySelector('[data-tl-row]') && !!document.querySelector('[data-bar], [data-bz-stripe]');
          if (ready || Date.now() - started > maxMs) resolve();
          else window.setTimeout(tick, 350);
        };
        tick();
      }),
    [],
  );

  /**
   * Гайд по разделу: автозапуск при первом заходе пользователя (факт — в
   * профиле users_list/{uid}/tlGuide, страховка — localStorage), кнопка
   * «Обучение» в верхней панели для повторного запуска и перехода к разделу.
   * Тексты — guide/guideContent (единый файл), демо-иллюстрации —
   * guide/guideDemos (изолированные данные), справочник — общий с легендой
   * (lib/legend). Модуль передаёт данные и сохраняет факт прохождения.
   */
  const guideCtx: GuideContext = useMemo(
    () => ({
      scenario: user.role === 'root_admin' || user.role === 'admin' ? 'admin' : 'dispatcher',
      canWrite,
      canCreateTrip,
      canEditPlan,
      canEditBaza,
      isAdmin: user.role === 'root_admin' || user.role === 'admin',
    }),
    [user.role, canWrite, canCreateTrip, canEditPlan, canEditBaza],
  );

  const guideLocalKey = user.uid ? `ratipa_tlguide_${GUIDE_VERSION}_${user.uid}` : '';
  const guideSeenLocal = (() => {
    if (!guideLocalKey) return false;
    try {
      return window.localStorage.getItem(guideLocalKey) === '1';
    } catch {
      return false;
    }
  })();
  /** Текущая версия гайда отмечена (профиль — основное, localStorage — страховка). */
  const guideSeen = user.tlGuide?.version === GUIDE_VERSION || guideSeenLocal;
  /** Прошлая версия — после повышения версии гайда показывается «Что нового». */
  const guidePrevVersion = user.tlGuide?.version && user.tlGuide.version !== GUIDE_VERSION ? user.tlGuide.version : null;
  const guideStoredStep = typeof user.tlGuide?.step === 'number' ? user.tlGuide.step : null;

  const [guideOpen, setGuideOpen] = useState(false);
  const [guideSteps, setGuideSteps] = useState<GuideStep[]>([]);
  const [guideOpenAt, setGuideOpenAt] = useState<number | null>(null);
  const [guideResumeAt, setGuideResumeAt] = useState<number | null>(null);
  const [guideWhatsNew, setGuideWhatsNew] = useState<string[] | null>(null);
  const [guideShownThisSession, setGuideShownThisSession] = useState(false);
  const guideStepRef = useRef(0);
  const guideSaveTimer = useRef<number | null>(null);

  /** Запись прохождения в профиль (+ localStorage как страховка от разрыва сети). */
  const saveGuideProgress = useCallback(
    (status: 'shown' | 'in-progress' | 'done' | 'skipped', step?: number) => {
      if (!user.uid) return;
      if (guideLocalKey) {
        try {
          window.localStorage.setItem(guideLocalKey, '1');
        } catch {
          /* приватный режим — не критично */
        }
      }
      dbService.saveTimelineGuideProgress(user.uid, {
        version: GUIDE_VERSION,
        status,
        ...(typeof step === 'number' ? { step } : {}),
      });
    },
    [user.uid, guideLocalKey],
  );

  /**
   * Открытие гайда: список шагов собирается ПО РОЛИ и по фактическому наличию
   * элементов на экране (шаг, чей элемент недоступен роли, пропускается).
   * Факт показа записывается сразу — перезагрузка не покажет гайд второй раз.
   */
  const openGuide = useCallback(
    (opts?: { at?: number | null; resume?: boolean }) => {
      const list = buildGuideSteps(guideCtx).filter((s) => !s.spotlight || guideStepAvailable(s));
      setGuideSteps(list);
      setGuideOpenAt(typeof opts?.at === 'number' ? Math.max(0, Math.min(opts.at, list.length - 1)) : null);
      setGuideWhatsNew(guidePrevVersion ? GUIDE_WHATS_NEW : null);
      setGuideResumeAt(
        opts?.resume && guideStoredStep != null && guideStoredStep > 0 ? Math.min(guideStoredStep, list.length - 1) : null,
      );
      setGuideShownThisSession(true);
      setGuideOpen(true);
      saveGuideProgress('shown', guideStepRef.current);
    },
    [guideCtx, guidePrevVersion, guideStoredStep, saveGuideProgress],
  );

  const handleGuideStepChange = useCallback(
    (index: number) => {
      guideStepRef.current = index;
      if (guideSaveTimer.current) window.clearTimeout(guideSaveTimer.current);
      guideSaveTimer.current = window.setTimeout(() => {
        saveGuideProgress('in-progress', guideStepRef.current);
      }, 400);
    },
    [saveGuideProgress],
  );

  const handleGuideClose = useCallback(
    (reason: 'done' | 'skipped') => {
      if (guideSaveTimer.current) {
        window.clearTimeout(guideSaveTimer.current);
        guideSaveTimer.current = null;
      }
      saveGuideProgress(reason, guideStepRef.current);
      setGuideOpen(false);
    },
    [saveGuideProgress],
  );

  /**
   * Автозапуск: один раз на пользователя и версию гайда. Показываем после
   * загрузки рабочей области и НЕ перебиваем уже открытые окна (например,
   * превью обновлений приложения); при занятом экране автозапуск молча
   * отменяется — гайд всегда доступен кнопкой «Обучение».
   */
  useEffect(() => {
    if (!user?.uid || guideShownThisSession || guideSeen) return;
    if (activeTab !== 'timeline') return;
    let cancelled = false;
    let attempts = 0;
    const tryShow = () => {
      if (cancelled) return;
      const occupied = !!document.querySelector('[role="dialog"]:not([data-ui="tl-guide"]), [data-ratipa-dialog="1"]');
      if (occupied) {
        if (attempts < 8) {
          attempts += 1;
          window.setTimeout(tryShow, 1200);
        }
        return;
      }
      const busy = !!document.querySelector('[data-module-loading]');
      if (busy) {
        if (attempts < 12) {
          attempts += 1;
          window.setTimeout(tryShow, 900);
        }
        return;
      }
      // Ждём появления полос: иначе шаги, чьи элементы появляются с данными,
      // были бы ошибочно пропущены (гонка с загрузкой источников).
      void waitForTimelineReady(6000).then(() => {
        if (cancelled) return;
        openGuide({ resume: true });
      });
    };
    const timer = window.setTimeout(tryShow, 1600);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, guideShownThisSession, guideSeen, activeTab, openGuide, waitForTimelineReady]);


  const renderVe = renderVs + renderVn - 1;
  const overviewCarNumber = overviewCarKey
    ? data.fleetCars.find((c) => `car:${c.carId || c.carNumber}` === overviewCarKey)?.carNumber ||
      data.trips.find((t) => t.carKey === overviewCarKey)?.carNumber ||
      data.bases.find((p) => p.carKey === overviewCarKey)?.carNumber ||
      ''
    : '';
  const overviewTrips = overviewCarKey ? data.trips.filter((t) => t.carKey === overviewCarKey) : [];
  const overviewBases = overviewCarKey ? data.bases.filter((p) => p.carKey === overviewCarKey) : [];
  const defaultDispatcherId = isDispatcherUser && dispatcherTabs.some((t) => t.id === user.uid) ? user.uid : '';

  // Прямое открытие карточки (deep link): скрытый дубль ищем и среди hiddenTrips —
  // карточка открывается с понятной плашкой (см. TripCard), из таймлайна он скрыт.
  const openTripObj = openTripKey
    ? data.trips.find((t) => t.key === openTripKey) || data.hiddenTrips.find((t) => t.key === openTripKey) || null
    : null;
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
      fillHeight={activeTab === 'timeline' && !fullscreen}
      contentClassName={activeTab === 'timeline' && !fullscreen ? 'flex-1 min-h-0 flex flex-col pt-2' : undefined}
      onTabChange={(key) => navigate(TAB_SLUGS[key as TabId] || DEFAULT_TAB)}
      actions={
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-ui="guide-open"
            onClick={() => {
              // Небольшая пауза на «оседание» полос — шаги с полосами не
              // пропускаются из-за гонки с загрузкой данных; затем гайд.
              void waitForTimelineReady(3000).then(() => openGuide());
            }}
            className={UI.buttonGhost}
            title="Интерактивный гайд по разделу: шаги с подсветкой, типичные ситуации и справочник обозначений"
          >
            <HelpCircle className="w-4 h-4" aria-hidden="true" />
            Обучение
          </button>
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
      {/* Единая рабочая область: вкладки диспетчеров, месяцы архива и полотно.
          В полноэкранном режиме раскрывается на всё окно (position: fixed) —
          это ТОТ ЖЕ DOM, без копии таймлайна: прокрутка, масштаб, вкладка и
          дата-якорь сохраняются при входе и выходе. */}
      <div
        data-ui={fullscreen ? 'timeline-fullscreen' : 'timeline-workarea'}
        className={fullscreen ? '' : 'flex-1 min-h-0 flex flex-col'}
        style={
          fullscreen
            ? {
                position: 'fixed',
                top: 0,
                right: 0,
                bottom: 0,
                left: 0,
                zIndex: 4000,
                background: '#F6F7FA',
                display: 'flex',
                flexDirection: 'column',
                // Полный экран — таймлайн от края до края (без пустых полей).
                padding: 0,
                overflow: 'hidden',
              }
            : undefined
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
        <div className={activeTab === 'timeline' ? 'flex-1 min-h-0 flex flex-col' : 'hidden'}>
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
            onOpenTripStage={openTripAtStage}
            onOpenBase={openPeriod}
            onOpenCar={openCar}
            dispatcherOrder={dispatcherOrderIds}
            groupByDispatcher={dispatcherTab === ALL_TAB}
            carCurrentDispatcher={carCurrentDispatcher}
            directions={data.directions}
            fullscreen={fullscreen}
            onToggleFullscreen={toggleFullscreen}
            onColumnHighlightChange={changeColumnHighlight}
          />
        </div>
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
          focusStageId={focusStageId}
          onFocusStageDone={() => setFocusStageId(null)}
          onOpenEventTrip={openTripAtEvent}
          onOpenBasePeriod={openPeriod}
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

      {/* Окно «Учёт выезда» ПОВЕРХ таймлайна: те же данные, что показывает
          модуль (общий VyezdPeriodWindow и общие источники useTimelineData —
          ничего не копируется и не пересчитывается на стороне таймлайна).
          Страница не меняется; «Назад» браузера закрывает окно. */}
      {panelTarget ? (
        <VyezdPeriodWindow
          target={{
            kind: panelTarget.periodId ? 'period' : 'car',
            periodId: panelTarget.periodId,
            carKey: panelTarget.carKey,
            carNumber: null,
          }}
          today={today}
          user={user}
          settings={settings}
          canEdit={canEditBaza}
          editMode="module"
          editorOpen={false}
          onEditRecord={() => undefined}
          onOpenTrip={(key) => {
            window.location.hash = `#tripTimeline/trip/${encodeURIComponent(key)}`;
          }}
          onOpenFull={openBazaModuleFor}
          onClose={closeDeparturePanel}
          onSwitchPeriod={(periodId) => setPanelTarget((prev) => ({ carKey: prev?.carKey ?? null, periodId }))}
          onReplaceTarget={(t) => replaceDeparturePanelHash({ periodId: t.periodId, carKey: t.carKey })}
        />
      ) : null}

      {/* Новый рейс: создаётся сразу связанная запись «Плана дохода» (тот же id —
          ключ полосы `pd:<id>`), отдельный ручной рейс не создаётся.
          Окно (ModalShell: шапка, прокручиваемое тело, нижняя панель) форма
          рисует сама — компоновка «Нового рейса» живёт целиком в NewTripForm. */}
      {showNewTrip && canCreateTrip ? (
        <NewTripForm
          dispatchers={data.dispatchers}
          defaultDispatcherId={defaultDispatcherId}
          canWrite={canCreateTrip}
          onCreate={createTrip}
          onCancel={() => setShowNewTrip(false)}
        />
      ) : null}

      {overviewCarKey ? (
        <CarOverviewModal
          carKey={overviewCarKey}
          carNumber={overviewCarNumber}
          trips={overviewTrips}
          bases={overviewBases}
          events={data.events.filter((e) => plateKeyOf(e.carNumber) === plateKeyOf(overviewCarNumber))}
          stageTypes={data.stageTypes}
          today={today}
          onSelectTrip={(key) => {
            setOverviewCarKey(null);
            setOpenTripKey(key);
          }}
          onSelectPeriod={(key) => {
            setOverviewCarKey(null);
            openPeriod(key);
          }}
          onOpenEventTrip={(key, eventId) => {
            setOverviewCarKey(null);
            openTripAtEvent(key, eventId);
          }}
          onClose={() => setOverviewCarKey(null)}
        />
      ) : null}

      {/* Интерактивный гайд «Обучение» — окно-мастер поверх таймлайна:
          шаги с подсветкой реальных элементов, демо-иллюстрации и справочник
          (единый источник с легендой). Прохождение хранится в профиле. */}
      {guideOpen ? (
        <TripTimelineGuide
          isOpen
          user={user}
          steps={guideSteps}
          directions={data.directions}
          whatsNew={guideWhatsNew}
          resumeAt={guideResumeAt}
          openAt={guideOpenAt}
          onClose={handleGuideClose}
          onStepChange={handleGuideStepChange}
        />
      ) : null}
    </ModuleShell>
  );
}

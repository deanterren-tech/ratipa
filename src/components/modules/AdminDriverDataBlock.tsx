/**
 * Административный инструмент «Неполные данные водителей» (Администрирование →
 * «Данные водителей»).
 *
 * Отдельный от персонального окна список: здесь администратор (раздел
 * «Администрирование» открыт только ролям root_admin/admin) видит ВСЕ записи
 * реестра водителей с проблемами —
 *   · без правдоподобной даты рождения;
 *   · без назначенного ответственного диспетчера (drivers/{id}.dispatcherId пуст —
 *     по таким записям персональное окно не поднимается ни у кого);
 *   · с ответственным, чья учётка не найдена в users_list (битая связь).
 *
 * Клик по строке открывает общую карточку водителя (тот же компонент DriverCard,
 * что и в справочниках) — по стабильному driverId, не по ФИО.
 * Данные живые: подписки реестра/учёток, после правок список обновляется сам.
 */
import {useEffect, useMemo, useState} from 'react'
import type {UserProfile} from '../../types'
import {dbService} from '../../api'
import {getDriversFlat, getCouplingsFlat} from '../../services/fleetService'
import {AlertTriangle, CalendarClock, Car, ChevronRight, Phone, User} from 'lucide-react'
import {UI} from '../../ui/kit'
import {SectionHeader, SearchField, EmptyState} from '../../ui/components'
import {driverMatchesQuery, type DriverRecord} from '../../utils/driverRegistry'
import {
  buildDriverDataQualityRows,
  driverDataIssueLabel,
  type DriverDataIssue,
  type DriverDataQualityCoupling,
} from '../../utils/driverDataQuality'
import DriverCard from './DriverCard'
import {useToast} from '../ToastProvider'

/** Фильтр списка: всё / только дата рождения / только ответственный. */
type DriverDataFilter = 'all' | 'birth' | 'dispatcher'

const FILTERS: Array<{ key: DriverDataFilter; label: string }> = [
  { key: 'all', label: 'Все неполные' },
  { key: 'birth', label: 'Без даты рождения' },
  { key: 'dispatcher', label: 'Без ответственного' },
]

const issueChipClass = (issue: DriverDataIssue): string =>
  issue === 'birth-date'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : 'border-rose-200 bg-rose-50 text-rose-700'

export default function AdminDriverDataBlock({
  onIssueCountChange,
}: {
  /** Профиль администратора (раздел открыт только root/admin — гейт в AdminModule). */
  user: UserProfile
  /** Счётчик проблемных записей — для бейджа вкладки в админ-панели. */
  onIssueCountChange?: (count: number) => void
}) {
  const {toast} = useToast()
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [couplings, setCouplings] = useState<DriverDataQualityCoupling[]>([])
  const [users, setUsers] = useState<UserProfile[]>([])
  const [loaded, setLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<DriverDataFilter>('all')
  const [viewCard, setViewCard] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    const u1 = getDriversFlat((list) => {
      setDrivers((list || []) as DriverRecord[])
      setLoaded(true)
    })
    const u2 = getCouplingsFlat((list) => setCouplings((list || []) as DriverDataQualityCoupling[]))
    const u3 = dbService.getUsers((list) => setUsers(list || []))
    return () => { u1(); u2(); u3() }
  }, [])

  const rows = useMemo(
    () => buildDriverDataQualityRows(drivers, {users, couplings}),
    [drivers, users, couplings],
  )

  const birthCount = useMemo(() => rows.filter((r) => r.issues.includes('birth-date')).length, [rows])
  const dispatcherCount = useMemo(
    () => rows.filter((r) => r.issues.includes('dispatcher') || r.issues.includes('dispatcher-unknown')).length,
    [rows],
  )

  useEffect(() => {
    if (onIssueCountChange) onIssueCountChange(rows.length)
  }, [rows.length, onIssueCountChange])

  const visible = useMemo(() => {
    const q = query.trim()
    return rows.filter((r) => {
      if (filter === 'birth' && !r.issues.includes('birth-date')) return false
      if (filter === 'dispatcher' && !r.issues.includes('dispatcher') && !r.issues.includes('dispatcher-unknown')) return false
      if (!q) return true
      const d = drivers.find((x) => String(x.id) === r.id)
      return d ? driverMatchesQuery(d, q) : r.name.toLowerCase().includes(q.toLowerCase())
    })
  }, [rows, filter, query, drivers])

  /** Кто ответственный — по стабильному id; пустой id = «не назначен». */
  const dispatcherLine = (r: (typeof rows)[number]) => {
    if (r.dispatcherId && r.dispatcherName) {
      return <span className="text-[#121316]">Ответственный: <b>{r.dispatcherName}</b></span>
    }
    if (r.dispatcherId) {
      return <span className="text-rose-600">Ответственный: учётка {r.dispatcherId} не найдена в users_list</span>
    }
    if (r.dispatcherText) {
      return <span className="text-rose-600">Ответственный не назначен <span className="text-[#9CA3AF]">(в записи: {r.dispatcherText})</span></span>
    }
    return <span className="text-rose-600">Ответственный не назначен</span>
  }

  return (
    <div className="flex flex-col gap-4" data-ui="dq-block">
      <SectionHeader
        icon={<AlertTriangle className="w-4 h-4" />}
        tone="graphite"
        title="Неполные данные водителей"
        subtitle="Административная проверка реестра: записи без правдоподобной даты рождения и без ответственного диспетчера. Персональное окно диспетчера поднимается только по его водителям — эта проверка его не подменяет."
      />

      {/* Счётчики */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] px-2.5 py-1 text-[11px] text-[#4B5563]" data-ui="dq-count-total">
          Всего записей с проблемами: <b className="font-mono">{rows.length}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] text-amber-800" data-ui="dq-count-birth">
          <CalendarClock className="h-3 w-3" aria-hidden="true" />
          Без даты рождения: <b className="font-mono">{birthCount}</b>
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1 text-[11px] text-rose-700" data-ui="dq-count-dispatcher">
          <User className="h-3 w-3" aria-hidden="true" />
          Без ответственного: <b className="font-mono">{dispatcherCount}</b>
        </span>
      </div>

      {/* Фильтр и поиск */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              data-ui={`dq-filter-${f.key}`}
              onClick={() => setFilter(f.key)}
              className={`min-h-[36px] rounded-lg border px-3 text-[11px] font-medium transition-colors cursor-pointer ${
                filter === f.key
                  ? 'border-[var(--accent-40)] bg-[var(--accent-10)] text-[var(--accent-ink)]'
                  : 'border-[#E5E7EB] bg-white text-[#4B5563] hover:bg-[#F9FAFB]'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <SearchField
          value={query}
          onChange={setQuery}
          placeholder="Поиск по ФИО или телефону"
          ariaLabel="Поиск по неполным записям водителей"
          className="sm:ml-auto sm:w-72"
        />
      </div>

      {/* Список */}
      {!loaded ? (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl px-4 py-10 text-center text-xs text-[#6B7280]">
          Загрузка реестра водителей…
        </div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
          <EmptyState kind="empty" title="Неполных записей нет" hint="У всех водителей заполнена правдоподобная дата рождения и назначен ответственный диспетчер." />
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl overflow-hidden">
          <EmptyState kind="no-results" query={query} />
        </div>
      ) : (
        <div className="bg-white border border-[#E5E7EB] rounded-2xl divide-y divide-[#F3F4F6] overflow-hidden max-h-[560px] overflow-y-auto">
          {visible.map((r) => (
            <button
              key={r.id}
              type="button"
              data-ui="dq-row"
              onClick={() => setViewCard({ id: r.id, name: r.name })}
              className="w-full text-left px-4 py-3 hover:bg-[#F9FAFB] transition-colors cursor-pointer"
              title="Открыть карточку водителя"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-[#121316] truncate">{r.name}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[#6B7280]">
                    {r.phone ? (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Phone className="h-3 w-3" aria-hidden="true" />{r.phone}
                      </span>
                    ) : null}
                    {r.car ? (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Car className="h-3 w-3" aria-hidden="true" />{r.car}
                      </span>
                    ) : null}
                    <span data-ui="dq-row-dispatcher">{dispatcherLine(r)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {r.issues.map((issue) => (
                    <span
                      key={issue}
                      title={issue === 'birth-date' ? r.birthReason : undefined}
                      className={`rounded-lg border px-2 py-0.5 text-[10px] font-medium ${issueChipClass(issue)}`}
                    >
                      {driverDataIssueLabel(issue)}
                    </span>
                  ))}
                  <ChevronRight className="h-3.5 w-3.5 text-[#9CA3AF]" aria-hidden="true" />
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <span className={UI.hint}>
        Ответственный определяется по стабильному id учётки из реестра (drivers → dispatcherId), текстовое имя в записи — только подсказка.
        Изменения карточки водителя обновляют список без перезагрузки.
      </span>

      {/* Общая карточка водителя — тот же компонент, что в справочниках */}
      {viewCard ? (
        <DriverCard
          driverId={viewCard.id}
          driverName={viewCard.name}
          onClose={() => setViewCard(null)}
          onOpenCoupling={(carNumber) => {
            toast(`Автомобиль ${carNumber}: карточка автомобиля открывается из раздела «Автопарк и Водители»`, 'info')
          }}
        />
      ) : null}
    </div>
  )
}

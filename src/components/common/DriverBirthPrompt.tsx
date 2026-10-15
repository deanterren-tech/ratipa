/**
 * Окно «Дата рождения водителя» — диспетчер вносит правильную дату рождения
 * своего водителя при входе в портал.
 *
 * Правила (заказчик): дата рождения нужна для документов; если у водителя,
 * находящегося в ведении диспетчера, дата отсутствует или неправдоподобна —
 * окно возникает при входе и дату нужно внести. Запись идёт ТОЛЬКО в поле
 * `birthDate` ветки `drivers` — существующим путём (dbService.saveDriver,
 * он же чинит остальные поля записи и остальные формы не затираются).
 *
 * Поведение окна:
 *  · один раз за запуск портала на пользователя (localStorage-ключ
 *    ratipa_birth_prompt_<uid> + метка запуска — паттерн анонсов);
 *  · «Позже» закрывает до следующего входа и об этом честно написано;
 *  · не появляется, пока открыто другое окно или раздел ещё грузится;
 *  · несколько водителей — по одному на экран с прогрессом «1 из 3»;
 *  · при ошибке записи окно не закрывается, дата не считается внесённой.
 */
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {createPortal} from 'react-dom'
import {CalendarClock, Calendar, Check, Car, Phone, Info} from 'lucide-react'
import type {AppSettings, UserProfile} from '../../types'
import {dbService} from '../../api'
import {getDriversFlat, getCouplingsFlat} from '../../services/fleetService'
import {UI} from '../../ui/kit'
import {ModalShell} from '../../ui/components'
import {useToast} from '../ToastProvider'
import {displayDate, dateInputValue, toISODate} from '../../utils/dateText'
import {openDatePicker} from '../../utils/openDatePicker'
import {driverFullName, primaryPhone, type DriverRecord} from '../../utils/driverRegistry'
import {
  checkBirthDate,
  markBirthPromptShown,
  selectBirthPromptCandidates,
  wasBirthPromptShown,
  birthPromptTitle,
  birthPromptProgress,
  BIRTH_PROMPT_WHY,
  BIRTH_PROMPT_LATER_HINT,
  type BirthPromptCandidate,
} from '../../utils/driverBirthPrompt'

/** Сцепка в объёме, нужном подписи «машина» (formа — как в справочнике водителей). */
interface CouplingLike {
  driverId?: string
  carNumber?: string
  vehicleNumbers?: string
}

/** Пауза перед показом/повтором: портал успевает отрисовать раздел и снять окна. */
const SHOW_RETRY_MS = 1200
/** Сколько раз пробовать, если экран занят другим окном, — потом молча уступаем. */
const SHOW_MAX_ATTEMPTS = 8

export default function DriverBirthPrompt({
  user,
  settings,
}: {
  user: UserProfile
  settings: AppSettings | null
}) {
  const {toast} = useToast()
  const [drivers, setDrivers] = useState<DriverRecord[]>([])
  const [driversLoaded, setDriversLoaded] = useState(false)
  const [couplings, setCouplings] = useState<CouplingLike[]>([])

  /** Открыто ли окно; очередь водителей (id) на момент открытия и внесённые даты. */
  const [open, setOpen] = useState(false)
  const [queue, setQueue] = useState<string[]>([])
  const [done, setDone] = useState<string[]>([])
  /** Значение поля даты (ISO) и текст ошибки — ошибка НЕ закрывает окно. */
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  /** Окно уже открывалось в этом запуске — второй раз не поднимаем. */
  const openedRef = useRef(false)
  /** Идёт сохранение — не открываем окно заново из подписки. */
  const savingRef = useRef(false)

  useEffect(() => {
    const unsubDrivers = getDriversFlat((list) => {
      setDrivers((list || []) as DriverRecord[])
      setDriversLoaded(true)
    })
    const unsubCouplings = getCouplingsFlat((list) => setCouplings((list || []) as CouplingLike[]))
    return () => { unsubDrivers(); unsubCouplings() }
  }, [])

  const rolePermissions = settings?.rolePermissions
  const viewer = useMemo(
    () => ({
      uid: user?.uid,
      role: user?.role,
      permissions: user?.permissions,
      customPermissions: user?.customPermissions,
      name: user?.name,
    }),
    [user?.uid, user?.role, user?.permissions, user?.customPermissions, user?.name],
  )

  /** Кому нужно окно: свои водители (диспетчер) или все (администратор реестра). */
  const candidates = useMemo(
    () => selectBirthPromptCandidates(drivers, viewer, {rolePermissions, couplings}),
    [drivers, viewer, rolePermissions, couplings],
  )

  /**
   * Автозапуск при входе: один раз за запуск портала, после загрузки данных и
   * только когда экран свободен (другое окно/раздел не перебиваем).
   */
  useEffect(() => {
    if (!user?.uid || !driversLoaded || openedRef.current || open) return;
    if (candidates.length === 0) return;
    if (wasBirthPromptShown(user.uid)) return;
    let cancelled = false;
    let attempts = 0;
    const tryShow = () => {
      if (cancelled || openedRef.current) return;
      const otherDialog = !!document.querySelector('[role="dialog"], [data-ratipa-dialog="1"]')
      const loading = !!document.querySelector('[data-module-loading]')
      // Заставка портала лежит выше окон — ждём, пока она уйдёт.
      const splash = !!document.querySelector('[aria-label="Загрузка Ratipa Portal"]')
      if ((otherDialog || loading || splash) && attempts < SHOW_MAX_ATTEMPTS) {
        attempts += 1
        window.setTimeout(tryShow, SHOW_RETRY_MS)
        return
      }
      if (otherDialog || loading || splash) return; // экран занят — уступаем до следующего входа
      openedRef.current = true
      setQueue(candidates.map((c) => c.id))
      setDone([])
      setValue('')
      setError('')
      markBirthPromptShown(user.uid)
      setOpen(true)
    }
    const timer = window.setTimeout(tryShow, SHOW_RETRY_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
    // candidates пересчитывается подпиской — повтор эффекта гасит openedRef
  }, [user?.uid, driversLoaded, candidates, open])

  /** Текущий водитель очереди: свежие данные берём из подписки реестра. */
  const pendingIds = queue.filter((id) => !done.includes(id))
  const currentId = pendingIds[0] || ''
  const pos = queue.length - pendingIds.length
  const candidate: BirthPromptCandidate | undefined = candidates.find((c) => c.id === currentId)
  const driver = drivers.find((d) => String(d.id) === currentId) || null
  const driverName = candidate?.name || driverFullName(driver) || 'Водитель'
  const driverPhone = candidate?.phone || primaryPhone(driver || undefined) || ''
  const driverCar = candidate?.car || (() => {
    const c = couplings.find((x) => String(x.driverId || '') === currentId)
    return c ? (String(c.carNumber || '') || String(c.vehicleNumbers || '')) : ''
  })()

  /** Закрыть («Позже»): факт показа в этом запуске уже отмечен, окно вернётся при следующем входе. */
  const dismiss = useCallback(() => {
    setOpen(false)
    setError('')
    setValue('')
  }, [])

  /** Сохранить дату — единственным путём записи водителя (dbService.saveDriver). */
  const save = useCallback(async () => {
    if (savingRef.current || !currentId) return
    const verdict = checkBirthDate(value)
    if (verdict.needsInput || !verdict.iso) {
      setError(verdict.reason || 'Внесите дату рождения в виде ДД/ММ/ГГГГ.')
      return
    }
    savingRef.current = true
    setSaving(true)
    setError('')
    try {
      // Пишем ОДНО поле записи + след правки (конвенция портала); остальные
      // поля не передаём — update() их не трогает.
      await dbService.saveDriver(
        {
          id: currentId,
          birthDate: verdict.iso,
          updatedAt: new Date().toISOString(),
          updatedBy: user?.name || user?.uid || 'system',
        },
        user?.name || user?.uid || 'system',
        user?.role || 'dispatcher',
      )
      toast(`Дата рождения сохранена: ${driverName}`, 'success')
      const nextDone = [...done, currentId]
      setDone(nextDone)
      setValue('')
      const left = queue.filter((id) => !nextDone.includes(id))
      if (left.length === 0) setOpen(false)
    } catch (e) {
      // Окно остаётся открытым, дата НЕ считается внесённой.
      const msg = e instanceof Error ? e.message : String(e)
      setError('Не удалось сохранить дату: ' + msg)
      toast('Дата не сохранена — проверьте связь и попробуйте ещё раз', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [currentId, value, done, queue, driverName, toast, user?.name, user?.uid, user?.role])

  if (!open) return null

  const total = Math.max(queue.length, 1)
  const currentVerdict = checkBirthDate(value)

  return createPortal(
    <ModalShell
      isOpen={open}
      onClose={dismiss}
      title={birthPromptTitle(total)}
      subtitle={`Осталось внести: ${birthPromptProgress(pos, total)}`}
      icon={<CalendarClock className="w-4 h-4" aria-hidden="true" />}
      ariaLabel="Дата рождения водителя"
      maxWidth="max-w-md"
      footer={
        <>
          <button type="button" onClick={dismiss} disabled={saving} data-ui="bd-later" className={UI.buttonGhost}>
            Позже
          </button>
          <button type="button" onClick={save} disabled={saving} data-ui="bd-save" className={UI.buttonPrimary}>
            <Check className="w-4 h-4" aria-hidden="true" />
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4" data-ui="bd-modal">
        {/* Прогресс по списку */}
        <div className="flex items-center justify-between gap-2">
          <span className={UI.hint} data-ui="bd-progress">
            {birthPromptProgress(pos, total)}
          </span>
          <div className="flex items-center gap-1" aria-hidden="true">
            {queue.map((id, i) => (
              <span
                key={id}
                className={`h-1.5 rounded-full transition-colors ${i <= pos ? 'w-6 bg-[var(--accent)]' : 'w-3 bg-[#E5E7EB]'}`}
              />
            ))}
          </div>
        </div>

        {/* Водитель */}
        <div className="flex flex-col gap-2 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-4">
          <div className="text-sm font-semibold text-[#121316]" data-ui="bd-driver-name">{driverName}</div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {driverPhone ? (
              <span className={UI.chip} data-ui="bd-driver-phone">
                <Phone className="mr-1 inline h-3 w-3" aria-hidden="true" />
                <span className="font-mono">{driverPhone}</span>
              </span>
            ) : null}
            {driverCar ? (
              <span className={UI.chip} data-ui="bd-driver-car">
                <Car className="mr-1 inline h-3 w-3" aria-hidden="true" />
                <span className="font-mono">{driverCar}</span>
              </span>
            ) : null}
            {candidate?.current ? (
              <span className={UI.chip} data-ui="bd-driver-current">
                В карточке: {candidate.current}
              </span>
            ) : null}
          </div>
        </div>

        {/* Почему спрашиваем */}
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800" data-ui="bd-reason">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {candidate?.reason ? <b>{candidate.reason}. </b> : null}
            {BIRTH_PROMPT_WHY}
          </span>
        </div>

        {/* Поле даты: текст ДД/ММ/ГГГГ + скрытый календарь (как во всём портале) */}
        <div className="flex flex-col gap-2">
          <label className={UI.fieldLabel} htmlFor="bd-date-text">Дата рождения</label>
          <div className="relative">
            <input
              id="bd-date-text"
              type="text"
              readOnly
              value={displayDate(value)}
              placeholder="ДД/ММ/ГГГГ"
              onClick={() => openDatePicker('picker-bd-birth')}
              data-ui="bd-date-text"
              className={`${UI.input} cursor-pointer pr-11`}
            />
            <input
              type="date"
              id="picker-bd-birth"
              value={dateInputValue(value)}
              onChange={(e) => {
                setValue(toISODate(e.target.value) || e.target.value)
                setError('')
              }}
              data-ui="bd-date-picker"
              className="absolute inset-0 opacity-0 md:pointer-events-none"
              aria-hidden="true"
              tabIndex={-1}
            />
            <button
              type="button"
              onClick={() => openDatePicker('picker-bd-birth')}
              title="Открыть календарь: Дата рождения"
              aria-label="Открыть календарь: Дата рождения"
              data-ui="bd-date-open"
              className="absolute right-1 top-1/2 flex min-h-[36px] min-w-[36px] -translate-y-1/2 items-center justify-center rounded-lg text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)] pointer-events-none md:pointer-events-auto"
            >
              <Calendar className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          {value && currentVerdict.needsInput ? (
            <span className="text-[11px] font-medium text-rose-600">{currentVerdict.reason}</span>
          ) : null}
        </div>

        {error ? (
          <div className={UI.errorBox} role="alert" data-ui="bd-error">{error}</div>
        ) : null}

        <div className="border-t border-[#E5E7EB] pt-3">
          <p className="text-[11px] text-[#9CA3AF]">{BIRTH_PROMPT_LATER_HINT}</p>
        </div>
      </div>
    </ModalShell>,
    document.body,
  )
}

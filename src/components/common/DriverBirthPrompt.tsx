/**
 * Окно «Дата рождения водителя» — ответственный диспетчер вносит правильную дату
 * рождения СВОЕГО водителя при входе в портал.
 *
 * Адресность (заказчик): окно показывается только тому диспетчеру, который
 * назначен ответственным за конкретного водителя — строго по стабильному id
 * (drivers/{id}.dispatcherId = id учётки из users_list). Право settings=write
 * даёт возможность СОХРАНИТЬ дату, но не даёт видеть чужих: чужие записи и
 * записи без ответственного не попадают ни в окно, ни в счётчик ни у кого,
 * включая root/администратора. Полноту данных администратор проверяет отдельным
 * инструментом (Администрирование → «Данные водителей»).
 *
 * Запись идёт ТОЛЬКО в поле `birthDate` ветки `drivers` — существующим путём
 * (dbService.saveDriver, он же чинит остальные поля записи и остальные формы не
 * затираются).
 *
 * Поведение окна:
 *  · один раз за запуск портала на пользователя (localStorage-ключ
 *    ratipa_birth_prompt_<uid> + метка запуска — паттерн анонсов);
 *  · очередь ЖИВАЯ: приходит из подписки реестра, поэтому после сохранения
 *    даты (и при переназначении ответственного) список и счётчик обновляются
 *    без перезагрузки — запись уходит у старого диспетчера и появляется у
 *    нового, если тот ещё не видел окно в этой сессии;
 *  · «Позже» закрывает до следующего входа и об этом честно написано;
 *  · не появляется, пока открыто другое окно или раздел ещё грузится;
 *  · несколько водителей — по одному на экран с прогрессом «1 из 3»;
 *  · при ошибке записи окно не закрывается, дата не считается внесённой;
 *  · при сохранении перепроверяются право правки, ответственность по стабильному
 *    id и то, что дата всё ещё требует ввода (её могли внести параллельно).
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
import DateTextInput from './DateTextInput'
import {driverFullName, primaryPhone, type DriverRecord} from '../../utils/driverRegistry'
import {
  birthPromptQueue,
  birthPromptTitle,
  birthPromptProgress,
  birthSaveBlockLabel,
  birthSaveBlockReason,
  checkBirthDate,
  markBirthPromptShown,
  selectBirthPromptCandidates,
  wasBirthPromptShown,
  BIRTH_PROMPT_WHY,
  BIRTH_PROMPT_LATER_HINT,
  type BirthPromptCandidate,
} from '../../utils/driverBirthPrompt'

/** Сцепка в объёме, нужном подписи «машина» (форма — как в справочнике водителей). */
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

  /** Открыто ли окно; что уже внесено и что снято с очереди в этом заходе. */
  const [open, setOpen] = useState(false)
  const [done, setDone] = useState<string[]>([])
  const [dropped, setDropped] = useState<string[]>([])
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

  /**
   * Кому нужно окно: только водители, где смотрящий — ответственный
   * (dispatcherId = его id). Список живой — из подписки реестра.
   */
  const candidates = useMemo(
    () => selectBirthPromptCandidates(drivers, viewer, {rolePermissions, couplings}),
    [drivers, viewer, rolePermissions, couplings],
  )

  /** Живая очередь и счётчик окна — пересчитываются из подписки, без перезагрузки. */
  const queue = useMemo(() => birthPromptQueue(candidates, {done, dropped}), [candidates, done, dropped])

  /**
   * Автозапуск при входе: один раз за запуск портала, после загрузки данных и
   * только когда экран свободен (другое окно/раздел не перебиваем). Сюда же
   * попадает случай «запрос переназначили на меня в этой сессии»: кандидаты
   * приходят из подписки, окно поднимается без перезагрузки.
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
      setDone([])
      setDropped([])
      setValue('')
      setError('')
      markBirthPromptShown(user.uid)
      setOpen(true)
    }
    const timer = window.setTimeout(tryShow, SHOW_RETRY_MS)
    return () => { cancelled = true; window.clearTimeout(timer) }
    // candidates пересчитывается подпиской — повтор эффекта гасит openedRef
  }, [user?.uid, driversLoaded, candidates, open])

  /**
   * Очередь опустела (всё внесено или записи переназначены) — окно закрываем.
   * Счётчик при этом обновляется сам: он собран из живой очереди.
   */
  useEffect(() => {
    if (!open || saving) return;
    if (queue.pendingIds.length > 0) return;
    setOpen(false);
    setError('');
    setValue('');
  }, [open, saving, queue.pendingIds.length])

  /** Текущий водитель очереди: свежие данные берём из подписки реестра. */
  const currentId = queue.pendingIds[0] || ''
  const pos = queue.pos
  const total = Math.max(queue.total, 1)
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

  /** Снять запись с очереди в этом заходе (переназначили / дата уже внесена). */
  const dropCurrent = useCallback((id: string) => {
    setDropped((prev) => (prev.includes(id) ? prev : [...prev, id]))
  }, [])

  /**
   * Сохранить дату — единственным путём записи водителя (dbService.saveDriver).
   * Перед записью перепроверяем: право правки, ответственность по стабильному
   * id и что дата всё ещё требует ввода (её могли внести параллельно).
   */
  const save = useCallback(async () => {
    if (savingRef.current || !currentId) return
    const fresh = drivers.find((d) => String(d.id) === currentId) || null
    const block = birthSaveBlockReason(viewer, fresh, {rolePermissions})
    if (block) {
      // Запись больше не наша забота: снимаем с очереди и честно говорим почему.
      dropCurrent(currentId)
      const msg = birthSaveBlockLabel(block)
      setError(msg)
      if (block === 'not-responsible' || block === 'already-filled') toast(msg, block === 'already-filled' ? 'success' : 'error')
      return
    }
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
      setDone((prev) => (prev.includes(currentId) ? prev : [...prev, currentId]))
      setValue('')
      // Очередь и счётчик обновляются сами: подписка реестра уберёт запись из
      // кандидатов, окно закроется, когда очередь опустеет.
    } catch (e) {
      // Окно остаётся открытым, дата НЕ считается внесённой.
      const msg = e instanceof Error ? e.message : String(e)
      setError('Не удалось сохранить дату: ' + msg)
      toast('Дата не сохранена — проверьте связь и попробуйте ещё раз', 'error')
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }, [currentId, value, drivers, viewer, rolePermissions, driverName, toast, user?.name, user?.uid, user?.role, dropCurrent])

  // Пока очередь пуста, показывать нечего (окно закрывается эффектом выше).
  if (!open || !currentId) return null

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
            {queue.ids.map((id, i) => (
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
          <label className={UI.fieldLabel} htmlFor="bd-birth-text">Дата рождения</label>
          <DateTextInput
            id="bd-birth"
            value={value}
            onChange={(iso) => {
              setValue(iso)
              setError('')
            }}
            label="Дата рождения"
            textDataUi="bd-date-text"
            pickerDataUi="bd-date-picker"
            buttonDataUi="bd-date-open"
          />
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

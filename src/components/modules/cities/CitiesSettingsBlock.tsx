import { useEffect, useMemo, useState } from 'react'
import { UI } from '../../../ui/kit'
import { SectionHeader } from '../../../ui/components'
import { useToast } from '../../ToastProvider'
import {
  subscribeCities,
  subscribeGeonamesSettings,
  saveGeonamesSettings,
  deleteCity,
  mergeCities,
  isCityAdmin,
  type CityRecord,
} from '../../../firebase/citiesService'
import {
  GEONAMES_DEFAULT_COUNTRIES,
  GEONAMES_SMALL_COUNTRIES,
  type GeonamesSettings,
} from '../../../utils/geonames'
import { findSimilarCities, normalizeCityName } from '../../../utils/cityDirectory'
import { MapPin, Globe2, Trash2, GitMerge, ChevronDown, ChevronUp, ShieldAlert, Search } from 'lucide-react'

/**
 * «Справочник городов» — блок настроек (администратор).
 *
 * 1. GeoNames: список стран ISO-2 и пороги населения (по умолчанию 15000;
 *    для BY, KZ, UZ, TJ, AM, GE, MN, KG — 5000). Сохранение — только admin;
 *    импорт из дампов читает эти же настройки (scripts/import-geonames.ts).
 * 2. Справочник: просмотр записей (name/aliases/страна/тип/source/usageCount/
 *    population), УДАЛЕНИЕ и ОБЪЕДИНЕНИЕ ДУБЛЕЙ — только admin (и в UI, и в
 *    сервисе citiesService). Добавление городов исполнителем живёт в полях
 *    CityAutocomplete — здесь его нет.
 *
 * Список стран — расширяемый набор (чипы с флажками), пороги — числа.
 */

/** Полный предлагаемый список стран (ISO-2), поверх умолчаний. */
const ISO_CHOICES = Array.from(new Set([
  ...GEONAMES_DEFAULT_COUNTRIES,
  'PL', 'DE', 'LT', 'LV', 'EE', 'MD', 'UA', 'AZ', 'IR', 'AF', 'PK', 'IN',
  'KG', 'MN', 'TJ', 'TM', 'UZ', 'GE', 'AM', 'CN', 'TR', 'RU', 'BY', 'KZ',
  'CZ', 'SK', 'HU', 'RO', 'BG', 'RS', 'HR', 'SI', 'AT', 'CH', 'FR', 'IT',
  'NL', 'BE', 'ES', 'PT', 'SE', 'NO', 'FI', 'DK', 'GB',
]))

interface Props {
  user: { name: string; role: string }
}

export default function CitiesSettingsBlock({ user }: Props) {
  const { toast } = useToast()
  const isAdmin = isCityAdmin(user.role)

  return (
    <div className="flex flex-col gap-6" data-ui="cities-settings">
      {!isAdmin && (
        <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-[11px] text-amber-800">
          <ShieldAlert className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          <span>Настройка GeoNames, удаление и объединение городов доступны только администратору. Просмотр — без изменений.</span>
        </div>
      )}
      <GeonamesSettingsSection user={user} isAdmin={isAdmin} />
      <CitiesDirectorySection user={user} isAdmin={isAdmin} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// GeoNames: страны и пороги
// ---------------------------------------------------------------------------
function GeonamesSettingsSection({ user, isAdmin }: Props & { isAdmin: boolean }) {
  const { toast } = useToast()
  const [settings, setSettings] = useState<GeonamesSettings | null>(null)
  const [countries, setCountries] = useState<string[]>([])
  const [threshold, setThreshold] = useState('15000')
  const [smallThreshold, setSmallThreshold] = useState('5000')

  useEffect(() => {
    const unsub = subscribeGeonamesSettings((s) => {
      setSettings(s)
      setCountries(s.countries)
      setThreshold(String(s.threshold))
      setSmallThreshold(String(s.smallThreshold))
    })
    return () => { unsub() }
  }, [])

  const toggleCountry = (cc: string) => {
    if (!isAdmin) return
    setCountries((prev) => (prev.includes(cc) ? prev.filter((c) => c !== cc) : [...prev, cc].sort()))
  }

  const save = () => {
    if (!isAdmin) return
    const res = saveGeonamesSettings(
      {
        countries,
        threshold: Math.max(0, Math.floor(Number(threshold) || 0)) || 15000,
        smallThreshold: Math.max(0, Math.floor(Number(smallThreshold) || 0)) || 5000,
      },
      user.name,
      user.role,
    )
    if (!res.ok) {
      toast(res.error || 'Не удалось сохранить настройки', 'error')
      return
    }
    toast('Настройки GeoNames сохранены', 'success')
  }

  return (
    <div className="flex flex-col gap-4" data-ui="geonames-settings">
      <SectionHeader
        icon={<Globe2 className="w-4 h-4" aria-hidden="true" />}
        tone="graphite"
        title="GeoNames: страны и пороги импорта"
        subtitle="Какие страны и с каким порогом населения импортировать из официальных дампов (scripts/import-geonames.ts читает эти же настройки)"
      />
      <div className="flex flex-col gap-3">
        <span className={UI.fieldLabel}>Страны (ISO-2) — клик переключает</span>
        <div className="flex flex-wrap gap-1.5" data-ui="geonames-countries">
          {ISO_CHOICES.map((cc) => {
            const on = countries.includes(cc)
            const isSmall = GEONAMES_SMALL_COUNTRIES.includes(cc)
            return (
              <button
                key={cc}
                type="button"
                data-ui={`geonames-country-${cc}`}
                data-on={on ? '1' : '0'}
                onClick={() => toggleCountry(cc)}
                disabled={!isAdmin}
                className={`px-2 py-1 rounded-lg border text-[11px] font-semibold transition cursor-pointer disabled:cursor-default ${
                  on
                    ? 'bg-[var(--accent-20)] border-[var(--accent)] text-[var(--accent-ink)]'
                    : 'bg-white border-[#E5E7EB] text-[#6B7280] hover:border-[#D1D5DB]'
                }`}
                title={isSmall ? `«Малая» страна: порог ${smallThreshold}` : `Порог ${threshold}`}
              >
                {cc}
                {isSmall ? '·' : ''}
              </button>
            )
          })}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg">
          <label className="flex flex-col gap-1.5">
            <span className={UI.fieldLabel}>Порог населения (по умолчанию)</span>
            <input
              type="number"
              min={0}
              data-ui="geonames-threshold"
              disabled={!isAdmin}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className={UI.input}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={UI.fieldLabel}>Порог для «малых» стран ({GEONAMES_SMALL_COUNTRIES.join(', ')})</span>
            <input
              type="number"
              min={0}
              data-ui="geonames-small-threshold"
              disabled={!isAdmin}
              value={smallThreshold}
              onChange={(e) => setSmallThreshold(e.target.value)}
              className={UI.input}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            data-ui="geonames-save"
            onClick={save}
            disabled={!isAdmin}
            className={UI.buttonPrimary}
          >
            Сохранить настройки
          </button>
          <span className="text-[11px] text-[#6B7280]">
            {settings ? `Сейчас: ${settings.countries.join(', ') || '—'} · порог ${settings.threshold}/${settings.smallThreshold}` : 'Загрузка…'}
          </span>
        </div>
        <p className={UI.hint}>
          Импорт запускается вручную: <code>npx tsx scripts/import-geonames.ts</code> (dry-run) и
          <code> --apply --yes</code> после подтверждения. Дубли не создаются, существующие записи только дополняются.
        </p>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Справочник: список, удаление, объединение (admin)
// ---------------------------------------------------------------------------
function CitiesDirectorySection({ user, isAdmin }: Props & { isAdmin: boolean }) {
  const { toast } = useToast()
  const [cities, setCities] = useState<CityRecord[]>([])
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)
  const [mergeSource, setMergeSource] = useState<string | null>(null)
  const [mergeQuery, setMergeQuery] = useState('')

  useEffect(() => {
    const unsub = subscribeCities((list) => setCities(list))
    return () => { unsub() }
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim()
    const base = [...cities].sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name, 'ru'))
    if (!q) return base.slice(0, 50)
    const norm = normalizeCityName(q)
    return base
      .filter((c) => [c.name, ...c.aliases].some((f) => normalizeCityName(f).includes(norm)))
      .slice(0, 50)
  }, [cities, query])

  const mergeTargets = useMemo(() => {
    if (!mergeSource) return []
    const q = mergeQuery.trim()
    const others = cities.filter((c) => c.id !== mergeSource)
    if (!q) return others.sort((a, b) => b.usageCount - a.usageCount).slice(0, 6)
    return findSimilarCities(q, others.map((c) => ({ name: c.name, aliases: c.aliases, city: c })), 6).map((s) => s.entry.city!)
  }, [mergeSource, mergeQuery, cities])

  const doDelete = (rec: CityRecord) => {
    const res = deleteCity(rec.id, user.name, user.role)
    setConfirmDelete(null)
    if (!res.ok) {
      toast(res.error || 'Не удалось удалить', 'error')
      return
    }
    toast(`Город «${rec.name}» удалён из справочника`, 'success')
  }

  const doMerge = (target: CityRecord) => {
    if (!mergeSource) return
    const src = cities.find((c) => c.id === mergeSource)
    if (!src) return
    const res = mergeCities(target.id, [src.id], user.name, user.role)
    setMergeSource(null)
    setMergeQuery('')
    if (!res.ok) {
      toast(res.error || 'Не удалось объединить', 'error')
      return
    }
    toast(`«${src.name}» объединён с «${target.name}»`, 'success')
  }

  return (
    <div className="flex flex-col gap-4" data-ui="cities-directory">
      <SectionHeader
        icon={<MapPin className="w-4 h-4" aria-hidden="true" />}
        tone="graphite"
        title="Справочник городов"
        subtitle={`Записей: ${cities.length}. Удаление и объединение дублей — только администратор; добавление — исполнителями прямо в полях города.`}
      />
      <div className="relative max-w-md">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
        <input
          type="text"
          data-ui="cities-directory-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Поиск по названию или алиасу…"
          className={`${UI.input} pl-9`}
        />
      </div>
      <div className="flex flex-col gap-2">
        {filtered.length === 0 && <p className={UI.hint}>Ничего не найдено.</p>}
        {filtered.map((c) => (
          <div key={c.id} className="border border-[#E5E7EB] rounded-xl bg-white" data-ui={`city-row-${c.id}`}>
            <div className="flex items-center gap-2 px-3 py-2">
              <button
                type="button"
                className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                data-ui={`city-expand-${c.id}`}
                onClick={() => setExpanded(expanded === c.id ? null : c.id)}
              >
                <span className="text-xs font-semibold text-[#121316] truncate">{c.name}</span>
                <span className="text-[10px] text-[#6B7280] shrink-0">
                  {[c.country, c.type, c.source, c.usageCount ? `×${c.usageCount}` : '', c.population ? `pop ${c.population}` : '']
                    .filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto text-[#9CA3AF] shrink-0">
                  {expanded === c.id ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </span>
              </button>
              {isAdmin && (
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    data-ui={`city-merge-${c.id}`}
                    title="Объединить с другим городом"
                    onClick={() => { setMergeSource(mergeSource === c.id ? null : c.id); setMergeQuery('') }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-[#E5E7EB] text-[10px] font-semibold text-[#4B5563] hover:bg-[#F9FAFB] cursor-pointer"
                  >
                    <GitMerge className="w-3 h-3" /> Объединить
                  </button>
                  {confirmDelete === c.id ? (
                    <>
                      <button
                        type="button"
                        data-ui={`city-delete-confirm-${c.id}`}
                        onClick={() => doDelete(c)}
                        className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-semibold cursor-pointer"
                      >
                        Точно удалить
                      </button>
                      <button
                        type="button"
                        data-ui={`city-delete-cancel-${c.id}`}
                        onClick={() => setConfirmDelete(null)}
                        className="px-2 py-1 rounded-lg border border-[#E5E7EB] text-[10px] font-semibold text-[#4B5563] cursor-pointer"
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      data-ui={`city-delete-${c.id}`}
                      title="Удалить запись"
                      onClick={() => setConfirmDelete(c.id)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-rose-200 text-[10px] font-semibold text-rose-600 hover:bg-rose-50 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Удалить
                    </button>
                  )}
                </div>
              )}
            </div>
            {expanded === c.id && (
              <div className="px-3 pb-3 pt-1 border-t border-[#F3F4F6] flex flex-col gap-1.5 text-[11px] text-[#4B5563]">
                <div><span className="font-semibold">Алиасы ({c.aliases.length}):</span> {c.aliases.join(', ') || '—'}</div>
                <div>
                  <span className="font-semibold">GeoNames:</span>{' '}
                  {[c.geonameId ? `id ${c.geonameId}` : '', c.lat != null && c.lng != null ? `${c.lat}, ${c.lng}` : '', c.population ? `население ${c.population}` : '']
                    .filter(Boolean).join(' · ') || '—'}
                </div>
                <div>
                  <span className="font-semibold">Создан:</span> {c.createdAt || '—'}
                  {c.author ? ` · автор: ${c.author}` : ''}
                  {c.mergedFrom?.length ? ` · объединены: ${c.mergedFrom.join(', ')}` : ''}
                </div>
              </div>
            )}
            {mergeSource === c.id && isAdmin && (
              <div className="px-3 pb-3 pt-1 border-t border-[#F3F4F6] flex flex-col gap-2" data-ui={`city-merge-panel-${c.id}`}>
                <span className={UI.fieldLabel}>Объединить «{c.name}» в… (запись исчезнет, алиасы перейдут цели)</span>
                <input
                  type="text"
                  data-ui={`city-merge-search-${c.id}`}
                  value={mergeQuery}
                  onChange={(e) => setMergeQuery(e.target.value)}
                  placeholder="Поиск цели по названию/алиасу…"
                  className={UI.input}
                />
                <div className="flex flex-wrap gap-1.5">
                  {mergeTargets.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      data-ui={`city-merge-target-${t.id}`}
                      onClick={() => doMerge(t)}
                      className="px-2.5 py-1 rounded-lg bg-[var(--accent-20)] border border-[var(--accent)] text-[11px] font-semibold text-[var(--accent-ink)] cursor-pointer"
                    >
                      {t.name} {t.country ? `(${t.country})` : ''}
                    </button>
                  ))}
                  {mergeTargets.length === 0 && <span className={UI.hint}>Совпадений нет.</span>}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

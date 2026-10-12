/**
 * Переключатель направления рейса — компактные сегменты «Турция / Китай»
 * (варианты владельца; список — из справочника Настроек, см. lib/directionCatalog).
 * НЕ выпадающий список со ставками: один сегмент = один код значения («TR»/«CN»).
 *
 * Общий для окна «Новый рейс» (крупный вид) и окна «Просмотр рейса» (компактный).
 * Значения не выдумываются: активный сегмент — ровно текущий код; повторный
 * клик по активному сегменту снимает выбор (пусто), клик по другому — меняет.
 */
import type { DirectionOption } from './lib/directionCatalog';

interface Props {
  /** Активные варианты (справочник Настроек; порядок соблюдается). */
  options: DirectionOption[];
  /** Текущее значение-код («TR», «CN», '' — не указано). */
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  /** Компактный вид (окно рейса). */
  compact?: boolean;
  /** Подпись для значения, которого нет среди вариантов (старые данные). */
  fallbackLabel?: string;
}

export default function DirectionToggle({ options, value, onChange, disabled, compact, fallbackLabel }: Props) {
  const current = String(value || '').toUpperCase();
  const inList = options.some((o) => o.code === current);

  const sizeCls = compact
    ? 'h-8 px-2.5 text-[11px] rounded-lg'
    : 'h-11 px-4 text-[14px] rounded-xl';
  const gapCls = compact ? 'gap-1' : 'gap-1.5';

  return (
    <div className="flex flex-wrap items-center gap-2 min-w-0" data-ui="direction-toggle">
      <div
        role="radiogroup"
        aria-label="Направление рейса"
        className={`inline-flex items-center ${gapCls} bg-[#F3F4F6] border border-[#E5E7EB] rounded-xl p-0.5 ${disabled ? 'opacity-60' : ''}`}
      >
        {options.map((o) => {
          const active = current === o.code;
          return (
            <button
              key={o.id || o.code}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              data-ui={`direction-option-${o.code}`}
              data-direction-code={o.code}
              title={active ? `Направление: ${o.name} (${o.code}) — повторный клик снимет выбор` : `Выбрать направление «${o.name}»`}
              onClick={() => {
                if (disabled) return;
                onChange(active ? '' : o.code);
              }}
              className={`${sizeCls} inline-flex items-center gap-1.5 font-semibold transition-colors select-none ${
                disabled ? 'cursor-not-allowed' : 'cursor-pointer'
              } ${
                active
                  ? 'bg-[var(--accent)] text-[var(--accent-on)] shadow-sm'
                  : 'bg-white text-[#4B5563] hover:text-[#121316] border border-transparent hover:border-[#E5E7EB]'
              }`}
            >
              {o.name}
              <span className={`font-mono font-normal ${compact ? 'text-[9px]' : 'text-[10px]'} ${active ? 'opacity-80' : 'text-[#9CA3AF]'}`}>{o.code}</span>
            </button>
          );
        })}
      </div>
      {!inList && (current || fallbackLabel) ? (
        <span className="text-[10px] text-[#6B7280]" data-ui="direction-toggle-fallback" title="Значение сохранено в старом формате — выбор нового сегмента заменит его">
          сохранено: {fallbackLabel || current}
        </span>
      ) : null}
    </div>
  );
}

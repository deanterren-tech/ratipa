/**
 * ЕДИНАЯ календарная шапка таймлайна (основного и встроенного в карточку).
 *
 * Два уровня, как в спецификации:
 *   верхний — полоса МЕСЯЦЕВ: месяц и год; каждый сегмент точно по ширине
 *   своих дней (start..end в окне, ширина = days × colW);
 *   нижний — числа и дни недели.
 *
 * Когда начало месяца уходит за левый край видимой области, подпись месяца
 * «прилипает» внутри своего сегмента (position: sticky; left: pinLeft) — она
 * остаётся видимой сразу справа от закреплённой колонки автомобилей и не
 * может выйти за границы своего сегмента. pinLeft задаётся по ширине колонки.
 *
 * Шапка позиционируется внутри того же полосового контейнера прокрутки, что и
 * сетка, поэтому движется синхронно с днями и полосами (один источник прокрутки).
 *
 * Оформление v2: точные высоты уровней (месяцы 22px; дни 26/24/20px по
 * масштабу — сумма задаёт --tl-head-h, под неё встают липкие шапки групп),
 * «пилюля» сегодня, более заметный разделитель месяцев, мягкие выходные.
 */
import { useMemo } from 'react';
import { WEEKDAYS_RU, dayHeaderLabel, monthSegments } from './lib/timeline';

const CLR = {
  weekend: '#F2F3F6',
  today: '#F43F5E',
  todayPill: '#BE123C',
  sep: '#D5D9E0',
  rowSep: '#E8EAF0',
  mondaySep: '#E6E8EE',
  text: '#6B7280',
  strong: '#121316',
  dim: '#646D79',
};

interface Props {
  /** Начало окна (номер дня) — общий origin с сеткой и полосами. */
  vs: number;
  /** Длина окна в днях. */
  vn: number;
  /** Ширина одного дня (масштаб). */
  colW: number;
  /** Сегодняшний день (номер дня) для подсветки. */
  today: number;
  /** Отступ (px), на котором держится подпись месяца, когда её начало ушло влево. */
  pinLeft: number;
  /** Встроенный таймлайн: меньше кегль и высота. */
  dense?: boolean;
}

export default function CalendarHeader({ vs, vn, colW, today, pinLeft, dense = false }: Props) {
  const segs = useMemo(() => monthSegments(vs, vn), [vs, vn]);
  // Плотность подписей по масштабу: подробно — каждый день с днём недели;
  // средне — числа и день недели по понедельникам; обзорно — редкие деления.
  const tier: 'full' | 'medium' | 'compact' = colW >= 20 ? 'full' : colW >= 12 ? 'medium' : 'compact';
  /** Точные высоты уровней: сумма = высота липкой шапки (--tl-head-h). */
  const monthsH = dense ? 16 : 22;
  const daysH = dense ? (tier === 'full' ? 20 : tier === 'medium' ? 18 : 16) : tier === 'full' ? 26 : tier === 'medium' ? 24 : 20;
  const monthTextCls = dense ? 'text-[8px] leading-[14px]' : 'text-[10px] leading-[16px]';
  const dayTextCls = dense ? 'text-[8px] leading-[10px]' : 'text-[9px] leading-tight';
  const dayNumCls = tier === 'full' ? (dense ? 'text-[9px]' : 'text-[10px]') : dense ? 'text-[8px]' : 'text-[9px]';

  return (
    <>
      {/* Верхний уровень: месяцы и годы; сегмент — ровно по ширине своих дней */}
      <div
        data-tl-months=""
        className="flex w-full border-b"
        style={{ borderColor: CLR.rowSep, height: monthsH, background: 'var(--tl-head-bg)' }}
      >
        {segs.map((seg) => (
          <div
            key={seg.key}
            data-month={seg.label}
            data-days={seg.days}
            data-first-day={seg.start}
            className="relative flex-none border-l first:border-l-0"
            style={{ width: seg.days * colW, borderColor: CLR.sep }}
            title={seg.label}
          >
            {seg.days * colW >= (dense ? 56 : 64) ? (
              <span
                className={`sticky inline-block whitespace-nowrap font-semibold text-[#4B5563] ${monthTextCls}`}
                style={{ left: pinLeft, paddingLeft: 6, paddingRight: 6 }}
              >
                {seg.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Нижний уровень: число и день недели — плотность зависит от масштаба */}
      <div className="flex w-full" style={{ height: daysH, background: 'var(--tl-head-bg)' }}>
        {Array.from({ length: vn }, (_, i) => vs + i).map((d) => {
          const wd = new Date(d * 86400000).getUTCDay();
          const isWeekend = wd === 0 || wd === 6;
          const isToday = d === today;
          const date = new Date(d * 86400000).getUTCDate();
          const isMonday = wd === 1;
          const showNum = tier !== 'compact' || date === 1 || isMonday || d === vs;
          return (
            <div
              key={d}
              data-day={d}
              data-tl-day-today={isToday ? '1' : undefined}
              className={`flex-none flex flex-col items-center overflow-hidden ${dayTextCls} pt-0.5`}
              style={{
                width: colW,
                // Ячейка текущего дня — мягкая заливка столбца «сегодня»
                // (поверх выходного фона, при совпадении).
                background: isToday ? 'rgba(244, 63, 94, 0.10)' : isWeekend ? CLR.weekend : undefined,
                color: isToday ? CLR.today : CLR.text,
                borderLeft: isMonday ? `1px solid ${tier === 'compact' ? '#E5E7EB' : CLR.mondaySep}` : undefined,
              }}
            >
              {tier === 'full' ? (
                showNum ? (
                  <>
                    {isToday ? (
                      <b
                        className={`inline-flex items-center justify-center min-w-[15px] h-[14px] px-1 rounded-full text-white font-bold ${dayNumCls}`}
                        style={{ background: CLR.todayPill }}
                      >
                        {dayHeaderLabel(d)}
                      </b>
                    ) : (
                      <b className={`block font-semibold ${dayNumCls}`} style={{ color: CLR.strong }}>
                        {dayHeaderLabel(d)}
                      </b>
                    )}
                    <span className="text-[8px] leading-[10px]" style={{ color: isToday ? CLR.today : CLR.dim }}>
                      {WEEKDAYS_RU[wd]}
                    </span>
                  </>
                ) : null
              ) : tier === 'medium' ? (
                <>
                  <b
                    className={`${isToday ? 'inline-flex items-center justify-center min-w-[14px] h-[13px] px-1 rounded-full text-white font-bold text-[8px]' : 'block font-semibold text-[9px]'}`}
                    style={isToday ? { background: CLR.todayPill } : { color: CLR.strong }}
                  >
                    {dayHeaderLabel(d)}
                  </b>
                  {isMonday ? <span className="text-[7px]" style={{ color: CLR.dim }}>{WEEKDAYS_RU[wd]}</span> : null}
                </>
              ) : showNum ? (
                <b
                  className={`text-[8px] ${isToday ? 'inline-flex items-center justify-center px-1 rounded-full text-white font-bold' : ''}`}
                  style={isToday ? { background: CLR.todayPill } : undefined}
                >
                  {dayHeaderLabel(d)}
                </b>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}

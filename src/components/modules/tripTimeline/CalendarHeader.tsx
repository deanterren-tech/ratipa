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
 */
import { useMemo } from 'react';
import { WEEKDAYS_RU, dayHeaderLabel, monthSegments } from './lib/timeline';

const CLR = {
  weekend: '#F1F2F4',
  today: '#F43F5E',
  sep: '#E5E7EB',
  rowSep: '#EEF0F3',
  text: '#6B7280',
  strong: '#121316',
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
  // Плотность подписей по масштабу: подробно — каждый день; средне — числа
  // каждого дня и день недели по понедельникам; обзорно — недельные деления.
  const tier: 'full' | 'medium' | 'compact' = colW >= 20 ? 'full' : colW >= 12 ? 'medium' : 'compact';
  const monthTextCls = dense ? 'text-[8px] leading-[14px]' : 'text-[10px] leading-[18px]';
  const dayTextCls = dense ? 'text-[8px] leading-[10px]' : 'text-[9px] leading-tight';
  const dayNumCls = tier === 'full' ? (dense ? 'text-[9px]' : 'text-[10px]') : dense ? 'text-[8px]' : 'text-[9px]';

  return (
    <>
      {/* Верхний уровень: месяцы и годы; сегмент — ровно по ширине своих дней */}
      <div
        data-tl-months=""
        className="flex w-full border-b"
        style={{ borderColor: CLR.rowSep, height: dense ? 16 : 20 }}
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
                className={`sticky inline-block whitespace-nowrap font-medium text-[#4B5563] ${monthTextCls}`}
                style={{ left: pinLeft, paddingLeft: 6, paddingRight: 6 }}
              >
                {seg.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Нижний уровень: число и день недели — плотность зависит от масштаба */}
      <div className="flex w-full">
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
              className={`flex-none text-center overflow-hidden ${dayTextCls} ${dense ? 'pt-0.5' : 'pt-1'}`}
              style={{
                width: colW,
                background: isWeekend ? CLR.weekend : undefined,
                color: isToday ? CLR.today : CLR.text,
                boxShadow: isToday ? `inset 0 -2px 0 ${CLR.today}` : undefined,
                borderLeft: isMonday ? `1px solid ${tier === 'compact' ? '#E5E7EB' : '#F1F2F4'}` : undefined,
              }}
            >
              {tier === 'full' ? (
                showNum ? (
                  <>
                    <b className={`block font-semibold ${dayNumCls}`} style={{ color: isToday ? CLR.today : CLR.strong }}>
                      {dayHeaderLabel(d)}
                    </b>
                    <span>{WEEKDAYS_RU[wd]}</span>
                  </>
                ) : null
              ) : tier === 'medium' ? (
                <>
                  <b className="block text-[9px] font-semibold" style={{ color: isToday ? CLR.today : CLR.strong }}>
                    {dayHeaderLabel(d)}
                  </b>
                  {isMonday ? <span className="text-[7px]">{WEEKDAYS_RU[wd]}</span> : null}
                </>
              ) : showNum ? (
                <b className={date === 1 ? 'text-[8px]' : 'text-[8px]'}>{dayHeaderLabel(d)}</b>
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
/**
 * Вкладка «Проверка пробега» — честный каркас первого этапа.
 *
 * Никаких вердиктов: показываем, что данные реально собираются (с какого
 * момента), состояние каждого автомобиля и явно сообщаем, что события,
 * правила и сравнение с GPS появятся после накопления истории.
 * Статусы «подтверждён» здесь не выставляются.
 */

import { useMemo, useState } from 'react';
import { Gauge, Info } from 'lucide-react';
import { UI } from '../../../ui/kit';
import { SearchField, EmptyState, StatusText, SectionHeader } from '../../../ui/components';
import type { Vehicle } from '../../../types';
import {
  ageLabel, fmtTs, summarizeFleet,
  type McConfig, type McCurrent, type McIntegration, type McMapping,
} from './mcTypes';

interface Props {
  mapping: Record<string, McMapping>;
  current: Record<string, McCurrent>;
  config: McConfig;
  integration: McIntegration | null;
  cars: Vehicle[];
  nowMs: number;
}

export default function MileageCheckTab({ mapping, current, config, integration, cars, nowMs }: Props) {
  const [query, setQuery] = useState('');

  const summary = useMemo(
    () => summarizeFleet({
      mapping, current, rfEntries: {}, integrationMode: integration?.mode,
      nowMs, staleHours: config.staleHours, rfWindowHours: config.rfWindowHours,
    }),
    [mapping, current, integration?.mode, nowMs, config.staleHours, config.rfWindowHours],
  );

  const plateOf = (carKey: string) => {
    const m = mapping[carKey];
    const car = cars.find((c) => c.id === carKey);
    return m?.plateRaw || m?.plate || car?.carNumber || carKey;
  };

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.entries(mapping)
      .filter(([carKey, m]) => m?.navbyObjectId && (!q || `${plateOf(carKey)} ${m.navbyObjectId}`.toLowerCase().includes(q)))
      .map(([carKey, m]) => ({ carKey, m, cur: current[carKey] || null }))
      .sort((a, b) => plateOf(a.carKey).localeCompare(plateOf(b.carKey), 'ru'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapping, current, query, cars]);

  if (Object.keys(mapping).length === 0) {
    return (
      <EmptyState
        title="Данные ещё не собираются"
        hint="Как только автопарк будет сопоставлен с объектами Nav.by и поллер начнёт записывать измерения, здесь появится накопленная информация."
      />
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className={`${UI.bar} flex items-start gap-2.5 !rounded-xl`}>
        <Info className="w-4 h-4 text-[#9CA3AF] shrink-0 mt-px" aria-hidden="true" />
        <div className="text-[11px] leading-relaxed text-[#4B5563]">
          <div className="font-semibold text-[#121316]">Этап наблюдения: история накапливается</div>
          Данные измерений сохраняются с момента подключения
          {integration?.lastOkAt ? <> — первый успешный сбор: <span className="font-medium">{fmtTs(integration.lastOkAt)}</span></> : ' (сбор ещё не запускался)'}.
          Ретроспективной истории в API Nav.by нет, поэтому вымышленная история не строится.
          События, правила и сравнение с GPS-пробегом будут доступны после накопления данных — до этого
          расширение не выносит вердиктов и не делит автомобили на «нарушителей».
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        {[
          { label: 'Сопоставлено', value: summary.total, color: 'graphite' as const },
          { label: 'Данные свежие', value: summary.fresh, color: 'emerald' as const },
          { label: 'Координата устарела', value: summary.stale, color: 'amber' as const },
          { label: 'Данных нет', value: summary.noData, color: 'rose' as const },
          { label: 'Одометр не передаётся', value: summary.noOdo, color: 'blue' as const },
        ].map((c) => (
          <div key={c.label} className="bg-white border border-[#E5E7EB] rounded-xl px-3.5 py-3 flex flex-col gap-1">
            <span className="text-lg font-bold text-[#121316] leading-none">{c.value}</span>
            <span className="text-[10px] text-[#6B7280]">{c.label}</span>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeader
          icon={<Gauge className="w-4 h-4" />}
          tone="graphite"
          title="Сопоставленные автомобили"
          subtitle="Состояние сбора данных. Проверка расхождений появится после накопления истории на этапе наблюдения."
        >
          <SearchField value={query} onChange={setQuery} placeholder="Поиск: номер или объект" ariaLabel="Поиск по автомобилям" className="sm:max-w-xs" />
        </SectionHeader>

        <div className={UI.tableWrap}>
          <table className={UI.table}>
            <thead>
              <tr className={UI.theadRow}>
                <th className={UI.th}>Автомобиль</th>
                <th className={UI.th}>Объект / IMEI</th>
                <th className={UI.th}>Последнее измерение</th>
                <th className={UI.th}>Одометр (odom_can)</th>
                <th className={UI.th}>Сбор данных</th>
                <th className={UI.th}>Проверка расхождений</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ carKey, m, cur }) => {
                const ageMs = cur ? nowMs - cur.coordAtMs : null;
                const stale = cur != null && ageMs != null && ageMs > config.staleHours * 3_600_000;
                return (
                  <tr key={carKey} className={UI.tr}>
                    <td className={UI.tdStrong}>{plateOf(carKey)}</td>
                    <td className={UI.td}>
                      {m.navbyObjectId}
                      <div className="text-[10px] text-[#9CA3AF]">{m.imei || 'IMEI —'}</div>
                    </td>
                    <td className={UI.td}>{cur ? <>{fmtTs(cur.coordAtMs)}<div className="text-[10px] text-[#9CA3AF]">возраст: {ageLabel(ageMs)}</div></> : <span className="text-[#9CA3AF]">нет данных</span>}</td>
                    <td className={UI.td}>
                      {cur && cur.odoQuality === 'ok' && cur.odoKm != null
                        ? <>{Math.round(cur.odoKm).toLocaleString('ru-RU')} км<div className="text-[10px] text-[#9CA3AF]">источник navby.odom_can · время измерения не передаётся</div></>
                        : <span className="text-[#9CA3AF]">не передаётся</span>}
                    </td>
                    <td className={UI.td}>
                      {cur == null
                        ? <StatusText color="rose">данных нет</StatusText>
                        : stale
                          ? <StatusText color="amber">координата устарела</StatusText>
                          : <StatusText color="emerald">идут</StatusText>}
                    </td>
                    <td className={UI.td}><span className="text-[#6B7280]">Недостаточно данных — история копится</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

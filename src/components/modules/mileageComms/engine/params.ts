/**
 * Настраиваемые параметры проверки пробега (окна, пороги, критерии
 * достаточности). Значения — предварительные параметры наблюдения, а не
 * универсальные нормы; изменение доступно в интерфейсе проверки.
 */

export interface CheckParams {
  /* ── Определение стоянок ── */
  /** Скорость «стоим», км/ч (ниже — стояние). */
  stopSpeedKmh: number;
  /** Минимальная длительность стоянки, мин. */
  stopMinMin: number;
  /** Смещение между измерениями, м: меньше — считаем, что не движется. */
  stopMoveM: number;
  /** Радиус согласованности позиций стоянки, м (выбросы дальше — исключаются). */
  stopRadiusM: number;
  /** Короткие «движения» отчёта Nav.by короче этого — склейка со стоянкой, мин. */
  moveMergeMaxMin: number;
  /** Скорость «дрожания» отчёта, км/ч (max_speed ниже — не считается движением). */
  jitterMaxKmh: number;
  /** Смещение «дрожания» отчёта, м. */
  jitterMaxM: number;

  /* ── Разрывы и качество ── */
  /** Разрыв данных: нет измерений дольше, мин. */
  dataGapMin: number;
  /** Устаревшая координата на границе: receivedAt − coordAt больше, мин. */
  staleCoordMin: number;
  /** Минимум измерений внутри стоянки для её подтверждения порталом. */
  minDuringSamples: number;
  /** Разрыв внутри стоянки, до которого стоянка ещё считается подтверждённой, мин. */
  confirmMaxGapMin: number;

  /* ── Окна анализа стоянки ── */
  /** Окно до стоянки, мин (поиск последнего пригодного измерения). */
  preWindowMin: number;
  /** Окно после стоянки, мин (поиск первого пригодного измерения). */
  postWindowMin: number;

  /* ── Пороги событий ── */
  /** Порог прироста «во время стоянки» (сценарий А), км. */
  riseEventKm: number;
  /** Порог прироста через разрыв данных (сценарий В), км. */
  gapRiseKm: number;
  /** Малый порог заметного прироста (информационный), км. */
  riseInfoKm: number;
  /** Порог прироста при возобновлении движения, км. */
  resumeMinDeltaKm: number;
  /** Максимальная разумная скорость для темпа прироста, км/ч. */
  resumeMaxKmh: number;
  /** Максимальная разумная скорость между измерениями в движении, км/ч. */
  moveMaxKmh: number;

  /* ── GPS-сравнение ── */
  /** Максимальный интервал между измерениями для GPS-сегмента, мин. */
  gpsMaxGapMin: number;
  /** Скорость выше — пара считается выбросом GPS и исключается, км/ч. */
  gpsMaxSegmentKmh: number;

  /* ── Производительность графиков ── */
  /** Максимум точек на графике после прореживания. */
  maxChartPoints: number;
}

export const MC_CHECK_DEFAULTS: CheckParams = {
  stopSpeedKmh: 3,
  stopMinMin: 10,
  stopMoveM: 300,
  stopRadiusM: 500,
  moveMergeMaxMin: 30,
  jitterMaxKmh: 8,
  jitterMaxM: 500,

  dataGapMin: 60,
  staleCoordMin: 90,
  minDuringSamples: 2,
  confirmMaxGapMin: 90,

  preWindowMin: 240,
  postWindowMin: 120,

  riseEventKm: 1,
  gapRiseKm: 5,
  riseInfoKm: 0.05,
  resumeMinDeltaKm: 1,
  resumeMaxKmh: 100,
  moveMaxKmh: 100,

  gpsMaxGapMin: 15,
  gpsMaxSegmentKmh: 150,

  maxChartPoints: 800,
};

/** Человеческие подписи параметров для панели настроек. */
export const MC_CHECK_PARAM_LABELS: Record<keyof CheckParams, { label: string; hint: string; unit: string }> = {
  stopSpeedKmh: { label: 'Скорость «стоим»', unit: 'км/ч', hint: 'Ниже этой скорости измерение считается стоянием' },
  stopMinMin: { label: 'Мин. длительность стоянки', unit: 'мин', hint: 'Короче — не показываем как стоянку' },
  stopMoveM: { label: 'Смещение «не движется»', unit: 'м', hint: 'Смещение между измерениями меньше — считаем стоянием (расчёт портала)' },
  stopRadiusM: { label: 'Радиус позиций стоянки', unit: 'м', hint: 'Точки дальше — выбросы, исключаются из стоянки' },
  moveMergeMaxMin: { label: 'Склейка коротких «движений»', unit: 'мин', hint: 'Короткие движения отчёта Nav.by (дрожание) присоединяются к стоянке' },
  jitterMaxKmh: { label: 'Скорость дрожания', unit: 'км/ч', hint: 'Максимальная скорость, ниже которой «движение» отчёта считается дрожанием' },
  jitterMaxM: { label: 'Смещение дрожания', unit: 'м', hint: 'Максимальное смещение границ интервала для склейки' },
  dataGapMin: { label: 'Разрыв данных', unit: 'мин', hint: 'Нет измерений дольше — интервал считается разрывом' },
  staleCoordMin: { label: 'Устаревшая координата', unit: 'мин', hint: 'receivedAt − coordAt больше — координата не подтверждает стоянку на границе' },
  minDuringSamples: { label: 'Мин. измерений внутри стоянки', unit: 'шт', hint: 'Столько пригодных измерений нужно для подтверждения данными' },
  confirmMaxGapMin: { label: 'Макс. разрыв для подтверждения', unit: 'мин', hint: 'Разрыв внутри стоянки больше — подтверждение неполное' },
  preWindowMin: { label: 'Окно до стоянки', unit: 'мин', hint: 'До какого времени назад искать последнее измерение' },
  postWindowMin: { label: 'Окно после стоянки', unit: 'мин', hint: 'До какого времени вперёд искать первое измерение' },
  riseEventKm: { label: 'Порог прироста на стоянке', unit: 'км', hint: 'Прирост внутри наблюдаемой стоянки выше — событие (сценарий А)' },
  gapRiseKm: { label: 'Порог прироста через разрыв', unit: 'км', hint: 'Прирост между измерениями через разрыв данных выше — «требуется проверка» (сценарий В)' },
  riseInfoKm: { label: 'Порог заметного прироста', unit: 'км', hint: 'Меньший прирост показываем как информацию, без статуса «требуется проверка»' },
  resumeMinDeltaKm: { label: 'Порог прироста при возобновлении', unit: 'км', hint: 'Минимальный прирост для события Б' },
  resumeMaxKmh: { label: 'Макс. темп прироста', unit: 'км/ч', hint: 'Темп прироста выше — прирост не соответствует наблюдаемому интервалу' },
  moveMaxKmh: { label: 'Макс. темп в движении', unit: 'км/ч', hint: 'Темп прироста между измерениями в движении выше — событие' },
  gpsMaxGapMin: { label: 'Интервал GPS-сравнения', unit: 'мин', hint: 'Для GPS-пробега берутся только пары измерений не реже' },
  gpsMaxSegmentKmh: { label: 'Отсев GPS-выбросов', unit: 'км/ч', hint: 'Пары с нереальной скоростью исключаются из GPS-пробега' },
  maxChartPoints: { label: 'Точек на графике', unit: 'шт', hint: 'Больше — прореживание (без интерполяции неизвестных)' },
};

export function mergeCheckParams(partial: Partial<CheckParams> | null | undefined): CheckParams {
  const out = { ...MC_CHECK_DEFAULTS };
  if (!partial) return out;
  for (const key of Object.keys(MC_CHECK_DEFAULTS) as Array<keyof CheckParams>) {
    const v = partial[key];
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[key] = v;
  }
  return out;
}

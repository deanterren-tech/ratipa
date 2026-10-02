import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, ZoomIn, ZoomOut, RotateCcw, Loader2, AlertTriangle, CircleUserRound } from 'lucide-react';
import { useModalKeyboard } from '../hooks/useModalKeyboard';
import {
  cropToSquareDataUrl,
  cropPreviewDataUrl,
  computeCropGeometry,
  naturalSizeOf,
  AVATAR_MAX_EDGE,
  AVATAR_JPEG_QUALITY,
  CropSource,
  DEFAULT_IMAGE_CROP,
} from '../utils/imageUpload';

/** Желаемая сторона области выбора кадра. На узком экране уменьшается по месту. */
const VIEW = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
/** Показ предпросмотра на экране. */
const PREVIEW_SHOW = 56;
/**
 * Живой предпросмотр собирается тем же полотном, размером и качеством, что и
 * сохраняемый файл: показанное и записанное — один и тот же data URL, а не
 * похожая картинка. Пересчёт идёт с задержкой, поэтому перетаскивание не тормозит.
 */
const PREVIEW_SETTLE_MS = 120;

/**
 * Кадрирование фотографии профиля.
 *
 * Область кадрирования считается в пикселях ИСХОДНОГО изображения
 * (`computeCropGeometry` в utils/imageUpload): предпросмотр и готовый файл
 * берут одну и ту же область, поэтому аватар совпадает с тем, что показано.
 * Размер области измеряется по факту, так что окно работает и на узком экране.
 *
 * Слева — рабочая область с перетаскиванием, масштабом и клавиатурой,
 * справа — живой предпросмотр итогового аватара и размер результата.
 * Наружу уходит уже обработанный квадратный JPEG; текущий аватар меняется
 * только после подтверждения в настройках.
 */
export default function AvatarCropModal({
  isOpen,
  source,
  onCancel,
  onApply,
}: {
  isOpen: boolean;
  source: CropSource | null;
  onCancel: () => void;
  onApply: (dataUrl: string) => void;
}) {
  const [zoom, setZoom] = useState(DEFAULT_IMAGE_CROP.zoom);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  /** Фактическая сторона области кадрирования в CSS-пикселях. */
  const [view, setView] = useState(VIEW);
  const [preview, setPreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const viewRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);

  /** Выбранный кадр в терминах обработки — один объект на все вычисления. */
  const crop = useMemo(
    () => ({ zoom, offsetX: offset.x, offsetY: offset.y }),
    [zoom, offset.x, offset.y],
  );

  /** Геометрия: те же числа идут и в разметку предпросмотра, и в запись файла. */
  const geometry = useMemo(
    () => (natural ? computeCropGeometry({ width: natural.w, height: natural.h }, view, crop) : null),
    [natural, view, crop],
  );

  /** Смещение ограничено размерами изображения — кадр не отрывается от картинки. */
  const clampOffset = useCallback(
    (x: number, y: number, z: number, nat: { w: number; h: number } | null) => {
      if (!nat) return { x, y };
      const g = computeCropGeometry({ width: nat.w, height: nat.h }, view, { zoom: z, offsetX: 0, offsetY: 0 });
      const maxX = Math.max(0, (g.drawW - view) / 2);
      const maxY = Math.max(0, (g.drawH - view) / 2);
      return {
        x: Math.min(Math.max(x, -maxX), maxX),
        y: Math.min(Math.max(y, -maxY), maxY),
      };
    },
    [view],
  );

  // Каждое открытие начинается с центрального кадра
  useEffect(() => {
    if (!isOpen) return;
    setZoom(DEFAULT_IMAGE_CROP.zoom);
    setOffset({ x: 0, y: 0 });
    setNatural(null);
    setError(null);
    setIsDragging(false);
    setPreview(null);
  }, [isOpen, source?.src]);

  // Область кадрирования измеряется по факту: на узком экране она меньше
  useEffect(() => {
    if (!isOpen) return;
    const el = viewRef.current;
    if (!el) return;
    const measure = () => {
      const side = Math.max(96, Math.round(el.clientWidth || VIEW));
      setView(side);
      setOffset((o) => clampOffset(o.x, o.y, zoom, natural));
    };
    measure();
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (observer) observer.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      if (observer) observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [isOpen, natural, zoom, clampOffset]);

  // Живой предпросмотр ровно того кадра, который уйдёт в файл
  useEffect(() => {
    if (!isOpen || !natural) return;
    const img = imgRef.current;
    if (!img || !img.complete) return;
    const timer = window.setTimeout(() => {
      try {
        // Те же параметры, что у сохранения: AVATAR_MAX_EDGE и AVATAR_JPEG_QUALITY
        const url = cropPreviewDataUrl(img, crop, view, AVATAR_MAX_EDGE);
        setPreview(url);
      } catch {
        setPreview(null);
      }
    }, PREVIEW_SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, natural, crop, view]);

  const handleApply = useCallback(() => {
    const img = imgRef.current;
    if (!img || !img.complete || !naturalSizeOf(img).width) {
      setError('Изображение ещё не готово — подождите секунду и попробуйте снова.');
      return;
    }
    setIsRendering(true);
    setError(null);
    try {
      // Та же геометрия, что показывает предпросмотр
      const dataUrl = cropToSquareDataUrl(img, crop, view, {
        maxEdge: AVATAR_MAX_EDGE,
        quality: AVATAR_JPEG_QUALITY,
      });
      onApply(dataUrl);
    } catch (e) {
      // Текущий аватар не меняется: наружу ничего не уходит
      setError(e instanceof Error ? e.message : 'Не удалось обработать изображение. Текущий аватар не изменён.');
    } finally {
      setIsRendering(false);
    }
  }, [crop, view, onApply]);

  useModalKeyboard({ isOpen, onClose: onCancel, onConfirm: handleApply, skipInitialFocus: true });

  // Пока идёт выбор кадра, фокус — на самой области: стрелки и +/− управляют кадром
  useEffect(() => {
    if (!isOpen) return;
    const timer = window.setTimeout(() => viewRef.current?.focus(), 80);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  /**
   * Размеры исходника. Событие load у data URL может сработать до того, как
   * React повесит обработчик, поэтому проверяем готовность и опросом.
   */
  useEffect(() => {
    if (!isOpen || !source) return;
    const read = () => {
      const img = imgRef.current;
      if (img && img.complete && img.naturalWidth && img.naturalHeight) {
        const { width, height } = naturalSizeOf(img);
        setNatural({ w: width, h: height });
        return true;
      }
      return false;
    };
    if (read()) return;
    const timer = window.setInterval(() => {
      if (read()) window.clearInterval(timer);
    }, 100);
    return () => window.clearInterval(timer);
  }, [isOpen, source?.src]);

  // Колесо мыши меняет масштаб и не прокручивает страницу под окном
  useEffect(() => {
    const el = viewRef.current;
    if (!isOpen || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = Math.min(Math.max(z - e.deltaY * 0.0025, MIN_ZOOM), MAX_ZOOM);
        setOffset((o) => clampOffset(o.x, o.y, next, natural));
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [isOpen, natural, clampOffset]);

  if (!isOpen || !source) return null;

  const applyZoom = (next: number) => {
    const z = Math.min(Math.max(next, MIN_ZOOM), MAX_ZOOM);
    setZoom(z);
    setOffset((o) => clampOffset(o.x, o.y, z, natural));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 16 : 4;
    if (e.key === 'ArrowLeft') { e.preventDefault(); setOffset((o) => clampOffset(o.x + step, o.y, zoom, natural)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); setOffset((o) => clampOffset(o.x - step, o.y, zoom, natural)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setOffset((o) => clampOffset(o.x, o.y + step, zoom, natural)); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setOffset((o) => clampOffset(o.x, o.y - step, zoom, natural)); }
    else if (e.key === '+' || e.key === '=') { e.preventDefault(); applyZoom(zoom + 0.1); }
    else if (e.key === '-') { e.preventDefault(); applyZoom(zoom - 0.1); }
  };

  return (
    <div data-scroll-lock="modal" className="fixed inset-0 z-[5100] bg-black/50 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Кадрирование фотографии профиля"
        className="relative z-10 w-full max-w-lg bg-white border border-[#E5E7EB] rounded-2xl shadow-[0_25px_60px_rgba(0,0,0,0.18)] flex flex-col max-h-[92vh] overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E5E7EB] shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-[#F3F4F6] text-[var(--accent-ink)] rounded-lg shrink-0">
              <CircleUserRound className="w-4 h-4" aria-hidden="true" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-[#121316]">Фотография профиля</h3>
              <p className="text-xs text-[#6B7280] mt-0.5">Выберите кадр для круглого аватара</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Закрыть"
            className="p-1.5 text-[#9CA3AF] hover:text-[#121316] rounded-lg hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-5 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            {/* Рабочая область: круг показывает, как кадр ляжет в аватар */}
            <div
              ref={viewRef}
              tabIndex={0}
              role="group"
              aria-label="Область кадрирования: перетаскивайте изображение, стрелки и +/− меняют кадр"
              onKeyDown={handleKeyDown}
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
                setIsDragging(true);
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d) return;
                setOffset(clampOffset(d.ox + (e.clientX - d.x), d.oy + (e.clientY - d.y), zoom, natural));
              }}
              onPointerUp={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
                dragRef.current = null;
                setIsDragging(false);
              }}
              onPointerCancel={() => { dragRef.current = null; setIsDragging(false); }}
              style={{ width: '100%', maxWidth: VIEW, aspectRatio: '1 / 1' }}
              className={`relative mx-auto shrink-0 overflow-hidden rounded-full bg-[#F3F4F6] outline outline-1 outline-[#E5E7EB] touch-none select-none focus-visible:outline-2 focus-visible:outline-[var(--accent-ui)] ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
            >
              <img
                ref={imgRef}
                src={source.src}
                alt="Выбор кадра фотографии профиля"
                draggable={false}
                onLoad={(e) => {
                  const el = e.currentTarget;
                  const { width, height } = naturalSizeOf(el);
                  setNatural({ w: width, h: height });
                  setOffset({ x: 0, y: 0 });
                }}
                onError={() => setError('Не удалось открыть изображение. Текущий аватар не изменён.')}
                style={geometry ? ({
                  width: geometry.drawW,
                  height: geometry.drawH,
                  left: geometry.left,
                  top: geometry.top,
                  // Ориентация из метаданных EXIF: у исходника и у предпросмотра она одна
                  imageOrientation: 'from-image',
                } as React.CSSProperties) : ({ width: '100%', height: '100%' } as React.CSSProperties)}
                className={geometry
                  ? 'absolute max-w-none pointer-events-none select-none'
                  : 'absolute inset-0 w-full h-full object-cover pointer-events-none select-none'}
              />
            </div>

            {/* Точный предпросмотр результата: то же полотно, что уйдёт в профиль */}
            <div className="flex sm:flex-col items-center justify-center gap-3 shrink-0 select-none">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF] sm:hidden">Результат</span>
              <div className="relative rounded-full overflow-hidden border-2 border-[#E5E7EB] bg-[#F3F4F6] shadow-sm" style={{ width: PREVIEW_SHOW, height: PREVIEW_SHOW }}>
                {preview ? (
                  <img src={preview} alt="Предпросмотр аватара" className="w-full h-full object-cover" draggable={false} />
                ) : (
                  <span className="w-full h-full flex items-center justify-center">
                    <Loader2 className="h-4 w-4 animate-spin text-[#9CA3AF]" aria-hidden="true" />
                  </span>
                )}
              </div>
              <span className="hidden sm:block text-[10px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Результат</span>
            </div>
          </div>

          <div className="w-full flex flex-col gap-2">
            <div className="flex items-center gap-2.5">
              <ZoomOut className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
              <input
                type="range"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.01}
                value={zoom}
                onChange={(e) => applyZoom(Number(e.target.value))}
                aria-label="Масштаб кадра"
                className="flex-1 h-1.5 accent-[var(--accent-ui)] cursor-pointer"
              />
              <ZoomIn className="w-3.5 h-3.5 text-[#9CA3AF] shrink-0" aria-hidden="true" />
              <button
                type="button"
                onClick={() => { applyZoom(DEFAULT_IMAGE_CROP.zoom); setOffset({ x: 0, y: 0 }); }}
                className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-medium text-[#4B5563] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                Сбросить
              </button>
            </div>
            <p className="text-[10px] text-[#9CA3AF] leading-relaxed">
              Перетащите фотографию, чтобы выбрать участок. Масштаб — ползунком, колесом мыши или клавишами +/−.
              Круг слева показывает кадр, круг справа — готовый аватар, ровно то, что сохранится.
            </p>
          </div>

          {error && (
            <div className="w-full flex items-start gap-2 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2.5" role="alert">
              <AlertTriangle className="h-3.5 w-3.5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span className="text-[11px] text-rose-700">{error}</span>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#E5E7EB] flex items-center justify-between gap-3 shrink-0">
          <span className="text-[10px] text-[#9CA3AF]">Готовый аватар: {AVATAR_MAX_EDGE}×{AVATAR_MAX_EDGE}, JPEG</span>
          <div className="flex gap-2.5 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 h-9 rounded-lg text-xs font-medium text-[#4B5563] bg-white border border-[#E5E7EB] hover:bg-[#F3F4F6] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
            >
              Отмена
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isRendering || !natural}
              className="inline-flex items-center gap-1.5 px-5 h-9 rounded-lg text-xs font-medium text-[var(--accent-on)] bg-[var(--accent-solid)] hover:bg-[var(--accent-hover)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)]"
            >
              {isRendering && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Применить
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

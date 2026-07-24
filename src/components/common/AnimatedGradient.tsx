import { CSSProperties } from 'react';

interface AnimatedGradientProps {
  className?: string;
  style?: CSSProperties;
  /** интенсивность (прозрачность слоя) 0..1 */
  opacity?: number;
  /** включена ли анимация. false → статичный градиент (для слабых ПК / reduced-motion).
   *  Управляется с экрана (кнопка на дашборде), а не только системной настройкой. */
  enabled?: boolean;
}

/**
 * Лёгкий анимированный градиентный фон в фирменном стиле Ratipa (#3765F6).
 * Реализован pure-CSS (сдвиг background-position) — НЕ использует WebGL/Canvas,
 * поэтому не нагружает слабые ПК.
 */
export default function AnimatedGradient({ className = '', style, opacity = 1, enabled = true }: AnimatedGradientProps) {
  const layerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    opacity,
    pointerEvents: 'none',
    backgroundImage: `
      radial-gradient(at 18% 22%, rgba(55,101,246,0.55) 0px, transparent 55%),
      radial-gradient(at 82% 18%, rgba(99,102,241,0.45) 0px, transparent 50%),
      radial-gradient(at 25% 85%, rgba(14,165,233,0.40) 0px, transparent 55%),
      radial-gradient(at 78% 80%, rgba(139,92,246,0.40) 0px, transparent 50%),
      linear-gradient(135deg, #0b1220 0%, #111c33 38%, #16213e 70%, #0f1a2e 100%)
    `,
    backgroundSize: '200% 200%',
    backgroundPosition: '0% 0%',
    ...(enabled ? { animation: 'ratipaGradientShift 22s ease-in-out infinite alternate' } : {}),
    ...style,
  };

  return (
    <div className={className} style={layerStyle} aria-hidden="true">
      <style>{`
        @keyframes ratipaGradientShift {
          0%   { background-position: 0% 0%; }
          50%  { background-position: 100% 50%; }
          100% { background-position: 30% 100%; }
        }
      `}</style>
    </div>
  );
}

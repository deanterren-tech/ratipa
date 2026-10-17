import React, { useEffect, useRef, useState } from 'react';
import { motion, useInView } from 'motion/react';
import { ArrowUpRight } from 'lucide-react';
import { overtakeEase } from '../utils/motion';

/**
 * Примитивы движения портала (система Overtake).
 *
 * Все числа и кривые — из системы токенов (utils/motion):
 * прокатка текста 0.38 c × 0.015 c на букву, пословный выезд 0.55 c × 0.045 c,
 * счётчик 1.2 c с easeOutCubic, лента 28 c линейно.
 */

/* ─────────────────────────  RollingText  ───────────────────────── */

interface RollingTextProps {
  text: string;
  className?: string;
  /** Внешнее управление hover (когда наводим на всю кнопку). */
  isHovered?: boolean;
  /** Шаг задержки между буквами, c. */
  staggerDelay?: number;
}

/**
 * «Прокатка» текста по буквам при hover: буква уезжает вверх, снизу
 * поднимается её копия, нарисованная тенью (`text-shadow`), — второй копии
 * текста в DOM нет. Обязательна sr-only копия полного текста (доступность).
 */
export function RollingText({ text, className = '', isHovered: externalHovered, staggerDelay = 0.015 }: RollingTextProps) {
  const [internalHovered, setInternalHovered] = useState(false);
  const isHovered = externalHovered !== undefined ? externalHovered : internalHovered;
  return (
    <span
      className={`inline-flex items-center overflow-hidden select-none relative ${className}`}
      onMouseEnter={() => setInternalHovered(true)}
      onMouseLeave={() => setInternalHovered(false)}
      style={{ lineHeight: 1 }}
    >
      <span className="sr-only">{text}</span>
      <span aria-hidden="true" className="inline-flex items-center">
        {Array.from(text).map((char, index) => (
          <motion.span
            key={index}
            className="inline-block relative whitespace-pre leading-none"
            animate={{ y: isHovered ? '-100%' : '0%' }}
            transition={{ duration: 0.38, ease: overtakeEase, delay: index * staggerDelay }}
            style={{ textShadow: '0 1.25em 0 currentColor' }}
          >
            {char}
          </motion.span>
        ))}
      </span>
    </span>
  );
}

/* ─────────────────────────  KineticTitle  ───────────────────────── */

interface KineticTitleProps {
  text: string;
  className?: string;
  as?: React.ElementType;
  /** Шаг задержки между словами, c. */
  stagger?: number;
  delay?: number;
  once?: boolean;
  /** Индекс слова, которое окрашивается акцентом портала (для приветствия). */
  accentIndex?: number;
  accentClassName?: string;
}

/**
 * Пословный «выезд» заголовка: слова в контейнерах overflow-hidden,
 * внутренний span едет y: 105% → 0% с opacity 0 → 1.
 * Пробелы — через gap-x-[0.28em].
 */
export function KineticTitle({
  text,
  className = '',
  as: Tag = 'h1',
  stagger = 0.045,
  delay = 0,
  once = false,
  accentIndex,
  accentClassName = 'text-[var(--accent)]',
}: KineticTitleProps) {
  const ref = useRef<HTMLElement | null>(null);
  const isInView = useInView(ref, { once, amount: 0.2 });
  return (
    <Tag ref={ref} className={`flex flex-wrap gap-x-[0.28em] gap-y-1 ${className}`}>
      {text.split(' ').map((word, i) => (
        <span key={i} className="inline-block overflow-hidden py-0.5">
          <motion.span
            className={`inline-block ${accentIndex === i ? accentClassName : ''}`}
            initial={{ y: '105%', opacity: 0 }}
            animate={isInView ? { y: '0%', opacity: 1 } : { y: '105%', opacity: 0 }}
            transition={{ duration: 0.55, ease: overtakeEase, delay: delay + i * stagger }}
          >
            {word}
          </motion.span>
        </span>
      ))}
    </Tag>
  );
}

/* ─────────────────────────  AnimatedCounter  ───────────────────────── */

interface AnimatedCounterProps {
  value: number;
  formatter?: (v: number) => string;
  className?: string;
  duration?: number;
}

/**
 * Счётчик чисел: по первому попаданию в вьюпорт — счёт от 0 до значения
 * через requestAnimationFrame (1.2 c, easeOutCubic). `tabular-nums` —
 * цифры не «прыгают» при пересчёте.
 */
export function AnimatedCounter({
  value,
  formatter = (v) => v.toLocaleString('ru-RU'),
  className = '',
  duration = 1.2,
}: AnimatedCounterProps) {
  const [displayValue, setDisplayValue] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  useEffect(() => {
    if (!isInView) return undefined;
    let startTime: number | null = null;
    let raf = 0;
    const tick = (ts: number) => {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / (duration * 1000), 1);
      const easeOut = 1 - Math.pow(1 - p, 3);
      setDisplayValue(Math.round(value * easeOut));
      if (p < 1) raf = requestAnimationFrame(tick);
      else setDisplayValue(value);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, isInView, duration]);
  return <span ref={ref} className={`tabular-nums ${className}`}>{formatter(displayValue)}</span>;
}

/* ─────────────────────────  MarqueeTicker  ───────────────────────── */

interface MarqueeItem {
  name: string;
  tag?: string;
}

interface MarqueeTickerProps {
  items: MarqueeItem[];
  /** Длительность оборота, c. */
  speed?: number;
  className?: string;
}

/**
 * Бесконечная лента: x: 0% → −50%, линейно, элементы продублированы ×3.
 * Края растворяются маской; will-change-transform — только здесь.
 */
export function MarqueeTicker({ items, speed = 28, className = '' }: MarqueeTickerProps) {
  const mask = 'linear-gradient(to right, transparent, black 10%, black 90%, transparent)';
  return (
    <div
      className={`relative w-full overflow-hidden py-3 select-none ${className}`}
      style={{ maskImage: mask, WebkitMaskImage: mask }}
    >
      <motion.div
        className="flex items-center gap-8 whitespace-nowrap will-change-transform"
        animate={{ x: ['0%', '-50%'] }}
        transition={{ repeat: Infinity, ease: 'linear', duration: speed }}
      >
        {[...items, ...items, ...items].map((item, idx) => (
          <div
            key={idx}
            className="flex items-center gap-2.5 px-4 py-1.5 rounded-full bg-[#F3F4F6] border border-black/5 text-xs font-semibold text-[#4B5563]"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
            <span>{item.name}</span>
            {item.tag && <span className="text-[10px] opacity-60 font-normal">{item.tag}</span>}
          </div>
        ))}
      </motion.div>
    </div>
  );
}

/* ─────────────────────────  OvertakeButton  ───────────────────────── */

interface OvertakeButtonProps {
  text: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** dark — чернила портала, light — белая, accent — акцент пользователя. */
  variant?: 'dark' | 'light' | 'accent';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  title?: string;
}

/**
 * Кнопка-пилюля с прокаткой текста и круглым бейджем-стрелкой,
 * который при hover всей кнопки поворачивается на 45°.
 */
export function OvertakeButton({
  text,
  onClick,
  variant = 'dark',
  size = 'md',
  icon,
  disabled,
  className = '',
  title,
}: OvertakeButtonProps) {
  const [isHovered, setIsHovered] = useState(false);
  const variantStyles: Record<string, string> = {
    dark: 'bg-[#121316] hover:bg-[#1f2023] text-white',
    light: 'bg-white hover:bg-[#F3F4F6] text-[#121316] border border-[#E5E7EB]',
    accent: 'bg-[var(--accent)] hover:bg-[var(--accent-80)] text-white',
  };
  const circleStyles: Record<string, string> = {
    dark: 'bg-white text-[#121316]',
    light: 'bg-[#121316] text-white',
    accent: 'bg-white text-[var(--accent)]',
  };
  const sizes = {
    sm: { btn: 'h-8 pl-3.5 pr-1.5 text-xs gap-2', circle: 'w-5.5 h-5.5 min-w-[22px]', icon: 'w-3 h-3' },
    md: { btn: 'h-10 pl-4.5 pr-1.5 text-xs sm:text-sm gap-2.5', circle: 'w-7 h-7 min-w-[28px]', icon: 'w-3.5 h-3.5' },
    lg: { btn: 'h-12 pl-6 pr-2 text-sm sm:text-base gap-3', circle: 'w-8 h-8 min-w-[32px]', icon: 'w-4 h-4' },
  }[size];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`group relative inline-flex items-center justify-between rounded-full font-bold transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-50)] focus-visible:ring-offset-1 ${variantStyles[variant]} ${sizes.btn} ${className}`}
    >
      <span className="flex items-center h-full leading-none">
        <RollingText text={text} isHovered={isHovered} className="font-bold tracking-tight shrink-0 inline-flex items-center" />
      </span>
      <span
        className={`rounded-full inline-flex items-center justify-center shrink-0 aspect-square transition-transform duration-300 ease-[cubic-bezier(0.44,0,0.56,1)] group-hover:rotate-45 ${circleStyles[variant]} ${sizes.circle}`}
      >
        {icon ?? <ArrowUpRight className={`${sizes.icon} shrink-0 block stroke-[2.5]`} />}
      </span>
    </button>
  );
}

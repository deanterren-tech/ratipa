import type { Variants, Transition } from 'motion/react';

/**
 * Токены движения портала — единая система анимаций (Overtake).
 *
 * Числа, кривые и варианты заданы системой и НЕ заменяются «похожими»:
 * одна фирменная кривая, появление снизу-вверх, каскад с шагом 0.06 c,
 * пружины — только для «скользящих пилюль».
 */

/** Фирменная кривая движения. */
export const overtakeEase: [number, number, number, number] = [0.44, 0, 0.56, 1];

/** Пружина для «скользящих пилюль» (активный пункт меню, активный фильтр). */
export const overtakeSpring: Transition = { type: 'spring', stiffness: 400, damping: 35 };

/**
 * Универсальное появление блока: снизу-вверх с лёгким уменьшением масштаба.
 * Каскад задаётся пропом `custom={n}`: задержка = n × 0.06 c.
 * Появление начинается с opacity 0.001 (а не 0) — элемент кликабелен с первого кадра.
 */
export const overtakeAppearVariants: Variants = {
  hidden: { opacity: 0.001, y: 32, scale: 0.985 },
  visible: (custom: number = 0) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, delay: custom * 0.06, ease: overtakeEase },
  }),
};

/** Контейнер каскада (резерв для списочных экранов). */
export const overtakeStaggerContainer: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.05 } },
};

/** Карточка (резерв): y: 28→0 за 0.45 c. */
export const overtakeCardVariants: Variants = {
  hidden: { opacity: 0, y: 28 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.45, ease: overtakeEase } },
};

/** Строка списка (резерв): x: −12→0 за 0.35 c. */
export const overtakeRowVariants: Variants = {
  hidden: { opacity: 0, x: -12 },
  visible: { opacity: 1, x: 0, transition: { duration: 0.35, ease: overtakeEase } },
};

/** Панель модального окна. */
export const overtakeModalVariants: Variants = {
  hidden: { opacity: 0, scale: 0.94, y: 16 },
  visible: { opacity: 1, scale: 1, y: 0, transition: { duration: 0.3, ease: overtakeEase } },
  exit: { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.2, ease: overtakeEase } },
};

/** Затемнение под модалкой. */
export const overtakeBackdropVariants: Variants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.25 } },
  exit: { opacity: 0, transition: { duration: 0.2 } },
};

/** Класс микро-взаимодействия: круглый бейдж со стрелкой поворачивается на 45° при hover. */
export const overtakeArrowRotate =
  'transition-transform duration-300 ease-[cubic-bezier(0.44,0,0.56,1)] group-hover:rotate-45';

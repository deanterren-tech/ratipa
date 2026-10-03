/**
 * Открыть системный календарь для поля даты по id (или сам элемент).
 *
 * В портале поле даты выглядит как текст «ДД/ММ/ГГГГ», а значение хранит
 * скрытый input[type=date] — он же открывает системный выбор. showPicker()
 * есть не во всех мобильных браузерах (iOS Safari < 16.4, Samsung Internet,
 * Firefox Android) — там нажатие раньше не делало ничего. Фолбэк: фокус +
 * click() — iOS и большинство мобильных браузеров открывают нативный выбор
 * при фокусе поля даты. Дополнительно на мобильном скрытый input сам ловит
 * нажатие (снят pointer-events-none, остаётся md:pointer-events-none),
 * поэтому тап по полю открывает календарь даже без JavaScript.
 */
export function openDatePicker(target: string | HTMLInputElement | null): void {
  const el = typeof target === 'string'
    ? (document.getElementById(target) as HTMLInputElement | null)
    : target;
  if (!el || el.disabled) return;
  try {
    if (typeof el.showPicker === 'function') {
      el.showPicker();
      return;
    }
  } catch {
    /* не поддерживается/запрещено — идём в фолбэк */
  }
  try {
    el.focus({ preventScroll: true });
    el.click();
  } catch {
    /* no-op */
  }
}

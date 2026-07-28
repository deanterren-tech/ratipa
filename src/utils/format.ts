// Чистые форматтеры, вынесенные из гигантских модулей (PlanDohodModule / DohodModule)
// для уменьшения их размера и переиспользования. Без зависимостей от state/hooks.

/** Приводит строку к "Title Case" с исключениями для служебных фраз. */
export function formatToTitleCase(str: string): string {
  if (!str) return "";
  const trimmed = str.trim();
  if (trimmed.toUpperCase() === "ВСЕ ДИСПЕТЧЕРЫ") return "Все диспетчеры";
  if (trimmed.toUpperCase() === "ВСЕ НАПРАВЛЕНИЯ") return "Все направления";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

/** Нормализует латинскую раскладку в кириллическую (для ввода городов/дорог).
 *  Применяется ТОЛЬКО к словам, целиком набранным в латинице.
 *  Если строка уже содержит кириллицу — возвращается как есть (без искажения). */
const LAT_TO_CYR: Record<string, string> = {
  a: "а", b: "б", c: "с", d: "д", e: "е", f: "ф", g: "г", h: "х", i: "и",
  j: "й", k: "к", l: "л", m: "м", n: "н", o: "о", p: "р", q: "я", r: "р",
  s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", y: "у", z: "з",
};
export function normalizeRoadString(s: string): string {
  if (!s) return "";
  const trimmed = s.trim();
  // Уже содержит кириллицу — не трогаем (иначе ломаем корректный ввод)
  if (/[а-яА-ЯёЁ]/.test(trimmed)) return trimmed;
  return trimmed
    .toLowerCase()
    .split("")
    .map((ch) => LAT_TO_CYR[ch] ?? ch)
    .join("");
}

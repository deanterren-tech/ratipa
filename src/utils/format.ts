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

/** Нормализует латинскую раскладку в кириллическую (для ввода городов/дорог). */
export function normalizeRoadString(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/m/g, "м")
    .replace(/e/g, "е")
    .replace(/a/g, "а")
    .replace(/o/g, "о")
    .replace(/p/g, "р")
    .replace(/c/g, "с")
    .replace(/x/g, "х")
    .replace(/t/g, "т");
}

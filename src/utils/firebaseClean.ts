/**
 * Копия значения без undefined — Realtime Database отклоняет запись целиком,
 * если в объекте есть поле undefined («value argument contains undefined»).
 * Поля undefined удаляются, элементы массива undefined становятся null.
 */
export const sanitizeFirebaseObject = (obj: any): any => {
  if (obj === undefined) {
    return null;
  }
  if (obj === null || typeof obj !== "object") {
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(sanitizeFirebaseObject);
  }
  const clean: any = {};
  for (const key of Object.keys(obj)) {
    if (obj[key] !== undefined) {
      clean[key] = sanitizeFirebaseObject(obj[key]);
    }
  }
  return clean;
};

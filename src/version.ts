/**
 * Версия Ratipa Portal.
 *
 * Источник один — `package.json` (поле version). Сборка подставляет его сюда как
 * `__APP_VERSION__` (см. vite.config.ts), поэтому номер не дублируется по компонентам.
 * При выпуске релиза меняется только `package.json`:
 *
 *   npm version patch | minor | major      (обновит package.json)
 *
 * Схема версии — semver: MAJOR.MINOR.PATCH.
 */
export const APP_VERSION: string = __APP_VERSION__;

/** Готовый текст для интерфейса: «Версия 2.0.0». */
export const APP_VERSION_LABEL = `Версия ${APP_VERSION}`;

export default APP_VERSION;

# Полный UI/UX Аудит портала RATIPA — 12 основных модулей

> Дата: 2026-08-29
> Анализ: все 12 модулей в `/src/components/modules/`
> Эталон: **PlanDohodModule** (дизайн-система slate/белый, `bg-white rounded-[2rem]`, `text-[10px] font-semibold uppercase tracking-wider`, `#3765F6`, `bg-slate-50` sub-cards, `rounded-2xl`, убраны glass/backdrop-blur)

---

## Сводка

| Метрика | Значение |
|---|---|
| Всего строк в модулях | ~16,200 |
| `font-black` (должно быть 0) | **100+ вхождений** в 12 модулях |
| `backdrop-blur` (должно быть 0) | **50+ вхождений** |
| `bg-white/*` (glass-проценты) | **30+ вхождений** (должны быть `bg-white` solid) |
| `alert()` / нативные попапы | **2+ вхождения** (должны быть toast) |
| `min-h-[44px]` | ~154 вхождения (хорошо, но не везде) |

---

## 1. DashboardModule.tsx (987 строк)

### 🔴 CRITICAL

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 321 | `overflow-hidden` на корневом `<div>` | На мобильных устройствах `overflow-hidden` обрезает контент, который выходит за пределы экрана. Убрать или заменить на `overflow-x-hidden`. |
| 2 | 327-331 | `bg-[#3765F6]/14 blur-[130px]` — ambient glow divs | Декоративные градиентные круги с `blur-[130px]` тяжелы для GPU на мобильных. Вынести под `@media (prefers-reduced-motion: reduce)` или удалить. |
| 3 | 359 | `bg-white/45 backdrop-blur-3xs` — floating pills | **Glass-паттерн.** По дизайн-системе должно быть `bg-white border border-slate-200/50 shadow-sm` без `backdrop-blur`. |
| 4 | 555 | `bg-slate-950/90 backdrop-blur-xl` — launcher overlay | Слишком тёмный (slate-950) для стиля приложения. Заменить на `bg-white/[0.98] border border-slate-200` как PlanDohod. |

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 5 | 382 | `font-black` на greeting (`text-5xl font-black`) | Должно быть `font-bold` (не `font-black`). `font-black` запрещён дизайн-системой. |
| 6 | 373 | `font-black text-slate-800` на часах | `font-black` → `font-bold` |
| 7 | 756 | `font-black uppercase tracking-wider font-sans` в заголовке редактора | `font-black` → `font-bold` |
| 8 | 773 | `font-black uppercase tracking-wider` на табах слайдов | `font-black` → `font-semibold` |
| 9 | 656 | `backdrop-blur-md` на модалке preview | Убрать backdrop-blur, заменить на `bg-white border border-slate-200` |
| 10 | 742 | `backdrop-blur-md` на модалке редактора | Убрать backdrop-blur |
| 11 | 525 | `bg-white/60` на quick links | `bg-white/60` → `bg-white` solid |
| 12 | 421 | `bg-rose-600 text-white` — badge «Новость» | Используется `bg-rose-600` (красный). Согласовать с тоном приложения (slate/#3765F6). |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 13 | — | Нет заголовка модуля в стиле PlanDohod | Dashboard — лендинг, может не следовать шаблону «Модуль X / h1», но greeting `font-black` нарушает консистентность |
| 14 | 358 | hover-взаимодействие на floating pills | `hidden md:flex` — pills видны ТОЛЬКО на десктопе. На мобильных быстрые ссылки не видны. |
| 15 | 669-673 | Close button модалки preview — `absolute top-3 right-3 w-11 h-11` | Хороший touch-target ✅, но нет `min-h-[44px]` (хотя h-11 = 44px) |

---

## 2. PlanDohodModule.tsx (3419 строк) — ЭТАЛОН

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 3419 | **Огромный файл**: 3419 строк | Выделить под-компоненты: `renderCurrentFormModal` (600+ строк), `renderTripsGrid` (400+), `renderHistory` (400+). `React.memo` на тяжёлые блоки. |
| 2 | 3196 | `overflow-x-auto` на контейнере вкладок | На мобильных `overflow-x-auto` с `max-w-full` может скрывать часть кнопок. Заменить на `flex-wrap` + `lg:flex-nowrap lg:overflow-x-auto`. |
| 3 | 1831, 2343 | `overflow-x-auto` на таблицах (hidden lg:block) | ✅ Правильно скрыт на мобильных, но на десктопе может создавать горизонтальный скролл при zoom < 100%. |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 4 | Ряд мест | `bg-slate-50/50` на border blocks | Стиль PlanDohod — `bg-slate-50/40`, мелкое несоответствие прозрачности |
| 5 | 1831 | `pb-4` на overflow-x-auto контейнере таблицы | На мобильных неактуально (таблица скрыта до lg), но `pb-4` занимает место |

---

## 3. DohodModule.tsx (3040 строк)

### 🔴 CRITICAL

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | — | **3040 строк** — самый большой модуль после исключений | Экстремально большой. `RouteDisplay` (400+ строк) должен быть отдельным файлом. |

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 2 | 44-48 | `API_KEY` хардкод + мок `useMap = () => null` | Google Maps API ключ не должен быть в исходниках. `useMap = () => null` — заглушка, которая никогда не работает. |
| 3 | 1734 | `overflow-x-auto` на таблице | Скрыто до lg ✅, но требует проверки на промежуточных разрешениях |
| 4 | — | `backdrop-blur` в под-компонентах | DozvolaWidgets, DozvolaDocuments и др. используют `bg-white/80 backdrop-blur-xl` — это legacy-стиль |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 5 | — | Header не в стиле PlanDohod | Нет `text-[10px] font-semibold uppercase tracking-widest` над h1 |

---

## 4. BazaModule.tsx (1558 строк)

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 1171 | `overflow-x-auto custom-scrollbar` на таблице | Скрыто до lg ✅. На мобильных карточки. |
| 2 | 119 (useMemo) | `overflow-x-auto` в hidden lg блоке | ✅ правильно скрыт |
| 3 | — | Нет PlanDohod header (`text-[10px] font-semibold ...`) | Заголовок использует `h1` с `Truck` icon но нет subtitle-строки «Модуль Учет выезда» |
| 4 | — | `backdrop-blur` отсутствует в основном модуле | ✅ Хорошо — уже мигрирован |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 5 | — | `font-black` в некоторых под-компонентах | Проверить все под-компоненты на font-black |
| 6 | 1537 | **Размер файла**: 1558 строк | Можно декомпозировать модалку (edit modal — 300+ строк) |

---

## 5. VehicleDriverDataModule.tsx (1640 строк)

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 1192 | `font-black` на «Подключение к Google Диск...» | `font-black` → `font-bold` |
| 2 | 1224 | `font-black` на «Загрузка...» | `font-black` → `font-bold` |
| 3 | 1640 | **Размер файла**: 1640 строк | VehicleDriverCard (250+ строк) отдельно, modal edit (300+) отдельно |
| 4 | 85 | `bg-[#3765F6]/5` на coupling badge | ✅ В рамках дизайн-системы, но `bg-[#3765F6]/5` заменено в других модулях на slate-50 |
| 5 | 73 | `hover:shadow-md hover:border-slate-300` | Хорошо, но `shadow-md` может быть тяжеловат — PlanDohod использует `shadow-[0_8px_30px_rgba(0,0,0,0.01)]` |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 6 | 185 | `bg-slate-50/30` на status bar | ✅ Приемлемо |
| 7 | — | Header отсутствует в стиле PlanDohod | Нет subtitle иконки + «Модуль Авто и Водители» |

---

## 6. SalaryModule.tsx (1218 строк) — ХОРОШО

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 465 | **`alert("ОШИБКА: Имя пользователя не определено.")`** | Нативный `alert()` блокирует поток. Заменить на `toast('Ошибка: ...', 'error')` |
| 2 | — | **Много консоль-логов** в проде | `console.warn`, `console.error` в рантайме — заменить на логирование через dbService.logAction |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 3 | 559-574 | **Header в стиле PlanDohod** ✅ | Отличное соответствие: `text-[10px] font-semibold text-slate-400 uppercase tracking-widest` + `h1` |
| 4 | 581 | `bg-white rounded-[2rem] p-6 lg:p-8 border border-slate-200/60 shadow-[0_8px_30px_rgba(0,0,0,0.01)]` | ✅ Полное соответствие PlanDohod |
| 5 | 594, 669, 688 | `bg-slate-50 rounded-2xl border border-slate-200/50 p-4` | ✅ Полное соответствие PlanDohod sub-cards |
| 6 | 817-848 | Tab button pattern | ✅ Правильный: `bg-slate-100/80 p-1 rounded-xl border border-slate-200/50` |
| 7 | 1010-1042 | Кнопки «Отмена» и «Сохранить» в модалке | ✅ `min-h-[44px]` ✅ `bg-slate-900 text-white` |
| 8 | 914-918 | Карты истории с `rounded-[2rem]` | ✅ `bg-white border rounded-[2rem]` |
| 9 | — | `saveToHistory` использует `carId || undefined` | Потенциальная проблема: `undefined` в Firebase update (см. §1 footgun) |

---

## 7. DocumentsModule.tsx (2379 строк)

### 🔴 CRITICAL

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 36-38 | `pdfjsLib.GlobalWorkerOptions.workerSrc = ...cdn.jsdelivr.net...` | Внешний CDN не работает в офлайн-режиме. Библиотека pdfjs добавляет ~1MB к бандлу. |
| 2 | 2379 | **2379 строк** — гигантский файл | Декомпозировать: FerryModule, BAMAPModule, VehicleSelector отдельными файлами |

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 3 | 1305 | `overflow-x-auto` на табах | `flex-wrap` приоритетнее, `overflow-x-auto` только на lg+ |
| 4 | 910, 998, 1084, 1183 | `bg-white/85 backdrop-blur-xl` на основных контейнерах | **Glass-паттерн.** Все 4 вкладки используют `backdrop-blur-xl`. Должны быть `bg-white border border-slate-200 shadow-[0_8px_30px_rgba(0,0,0,0.01)]`. |
| 5 | 2068 | `font-black` на тексте | `font-black` → `font-bold` |
| 6 | 2074 | `font-black` на кнопке удаления | `font-black` → `font-semibold` |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 7 | 2306 | `bg-slate-100 text-slate-700 text-[9px] font-semibold` | `font-semibold` вместо `font-bold` ✅ |
| 8 | 2310 | `italic` в пустом состоянии | PlanDohod не использует `italic` для empty states |
| 9 | 54-99 | **Хардкод DEFAULT_COUPLES** в теле модуля | Вынести в отдельный конфиг/seed или читать из RTDB |

---

## 8. DirectoriesModule.tsx (346 строк)

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 300-303 | **Модалка**: `bg-white/90 backdrop-blur-xl` | `backdrop-blur-xl` — glass. Должно быть `bg-white border border-slate-200 shadow-2xl`. |
| 2 | 302 | `bg-white/90 backdrop-blur-xl rounded-3xl w-full max-w-md` | `backdrop-blur-xl` → убрать. `rounded-3xl` → `rounded-[2rem]` для консистентности. |
| 3 | 301 | `bg-slate-900/60 backdrop-blur-sm` на overlay | `backdrop-blur-sm` — убрать (как в PlanDohod) |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 4 | 186-191 | Header PlanDohod ✅ | Правильный шаблон `text-[10px] font-semibold uppercase tracking-widest` + `h1` |
| 5 | 195 | `overflow-x-auto max-w-full` на табах | ✅ Приемлемо, но заменить на `flex-wrap` для мобильных |
| 6 | 309 | Close button `min-h-[44px] min-w-[44px]` | ✅ Правильно |
| 7 | 237 | Кнопка «Добавить» — `bg-slate-900 text-white` | ✅ Правильный style (slate-900 вместо #3765F6) |

---

## 9. ArchiveModule.tsx (315 строк)

### 🔴 CRITICAL

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 81 | `bg-[#c3fb12] text-slate-950 font-black` — **жёлто-чёрный акцент** | Кастомный `#c3fb12` (lime) и `text-slate-950` — полностью выбивается из дизайн-системы `#3765F6`/slate. Должен быть `bg-[#3765F6]/10 text-[#3765F6]` или `bg-slate-900 text-white`. |
| 2 | 84 | `h1 font-black text-slate-900 uppercase tracking-tight` | **UPPERCASE + font-black** — не консистентно с PlanDohod (lowercase, font-bold). |
| 3 | 85 | `fill: '#c3fb12'` на иконке Archive | Иконка должна быть `text-slate-800`, без кастомного fill. |
| 4 | 102, 113, 124 | Tab buttons: `bg-slate-950 text-[#c3fb12] shadow-sm` | **Тёмные кнопки** с lime-текстом. По дизайн-системе: `bg-white text-slate-900 shadow-xs border border-slate-200/40`. |
| 5 | 161, 195 | `bg-slate-950 text-[#c3fb12]` на action buttons | **Не консистентно.** Кнопки должны быть `bg-slate-900 text-white hover:bg-slate-800` как в PlanDohod. |

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 6 | 178 | `font-mono font-black` на thead | `font-black` → `font-semibold` + убрать `font-mono` (заголовки не должно быть моноширинными) |
| 7 | 236 | `font-black` на profit value | `font-black` → `font-bold` |
| 8 | 258 | `font-black` на total salary | `font-black` → `font-bold` |
| 9 | 278 | `font-mono font-black` на thead (salaries) | `font-black` → `font-semibold` |
| 10 | 294 | `font-black` на сумме | `font-black` → `font-bold` |
| 11 | 242, 300 | `font-black uppercase tracking-widest` на empty states | `font-black` → `font-semibold` |
| 12 | 180, 188, 195 | `font-mono` на thead ячейках | Убрать `font-mono` | 
| 13 | 84 | `uppercase tracking-tight` на h1 | PlanDohod h1 не использует uppercase (кроме subtitle). `text-3xl font-bold text-slate-900 tracking-tight`. |
| 14 | 80-91 | Banner section — отдельный стиль | Содержит кастомные стили, отличные от PlanDohod wrapper. |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 15 | 88-90 | `<p className="text-xs text-slate-500 mt-1 font-semibold">` | PlanDohod не использует subtitle под h1 в banner |
| 16 | 193-198 | Кнопка «Восстановить» — `border border-black/5` | `border-black/5` — хрупкий паттерн, лучше `border-slate-800` |
| 17 | 77 | `font-sans` на wrapper | Должен быть на body/html, не на каждом wrapper |

---

## 10. SettingsModule.tsx (1355 строк)

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 44-48 | `API_KEY` хардкод в SettingsModule | Дублирование из DohodModule. Должен быть единый источник. |
| 2 | 870 | `font-black text-slate-900 uppercase font-mono tracking-wider` на locked message | `font-black` + `font-mono` + `uppercase` — тройное нарушение. `font-semibold text-slate-800`. |
| 3 | 956 | `font-mono font-black` на индикаторе | `font-black` → `font-bold` |
| 4 | 991 | `font-black uppercase text-slate-900 font-mono tracking-wider` | `font-black` → `font-semibold`, убрать `font-mono` |
| 5 | 1001 | `font-black` на лейблах системных ставок | `font-black` → `font-semibold` |
| 6 | 1007, 1017 | `font-black` на input values | `font-black` → `font-medium` (поля ввода) |
| 7 | 1039 | `font-black` на заголовке | `font-black` → `font-bold` |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 8 | — | `overflow-x-auto` на табах | ✅ Частично ок, но на мобильных `flex-wrap` лучше |
| 9 | 1303 | `p-1.5 bg-white text-xs rounded border border-slate-200 font-mono text-[10px]` | `font-mono` на input — не консистентно |
| 10 | 1349 | Вкладка DirectoriesModule | ✅ Использует DirectoriesModule (п.8) с корректным стилем |

---

## 11. AdminModule.tsx (283 строк)

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 149 | `font-black text-slate-900 uppercase font-mono tracking-wider` | `font-black` → `font-bold`. `font-mono` + `uppercase` избыточно. |
| 2 | 169 | `shadow-[0_15px_45px_rgba(0,0,0,0.1)]` | PlanDohod использует `shadow-[0_8px_30px_rgba(0,0,0,0.01)]`. Тень 0.1 vs 0.01 — в 10 раз темнее. |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 3 | 172 | Header PlanDohod | ✅ `text-[10px] font-semibold text-slate-400 uppercase tracking-widest` + `h1` |
| 4 | 191 | Tab bar `p-1 bg-slate-50 border border-slate-200 rounded-2xl` | ✅ Правильный паттерн PlanDohod |
| 5 | 221 | `flex-1 overflow-y-auto` | ✅ Правильно для скролла контента |
| 6 | 169 | `bg-white rounded-[2rem]` | ✅ Правильно |
| 7 | 235 | `bg-rose-500` на force logout | `bg-rose-500` — красный, может быть агрессивным. Стиль PlanDohod: оттенки slate, не rose. |

---

## 12. UserManagementBlock.tsx (716 строк)

### 🟡 MAJOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 1 | 298 | `font-black text-xs` на аватаре с инициалами | `font-black` на инициалах — `font-bold` |
| 2 | 304 | `font-black text-slate-800` на имени пользователя | `font-black` → `font-bold` |
| 3 | 344 | `font-black text-xs` на аватаре роли | `font-black` → `font-bold` |
| 4 | 350 | `font-black text-slate-800` на названии роли | `font-black` → `font-bold` |
| 5 | 406, 497 | `font-black text-slate-900` на h3 | `font-black` → `font-bold` |
| 6 | 581 | `text-white font-black drop-shadow-md` | `font-black` → `font-bold` + убрать `drop-shadow-md` (не PlanDohod) |

### 🟢 MINOR

| № | Строка | Проблема | Предложение |
|---|--------|----------|------------|
| 7 | 219 | `bg-white rounded-[2rem] border border-slate-200/50 shadow-[0_8px_30px_rgba(0,0,0,0.01)]` | ✅ Правильный PlanDohod wrapper |
| 8 | 221 | `bg-white/20` на left pane | `bg-white/20` — glass (20% opacity). Должен быть `bg-white` или `bg-slate-50`. |
| 9 | 222 | `bg-white/10` на header панели | Glass. Должен быть `bg-white`. |
| 10 | 246 | `shadow-inner border border-white/60` | `shadow-inner` + `border-white/60` — не PlanDohod |
| 11 | 269 | `bg-white/50 border border-white/60` | Glass. `bg-white border border-slate-200`. |
| 12 | 364 | `bg-slate-50` на right pane | ✅ Правильно |
| 13 | 380-396 | Поля формы Add User — `bg-white/50 border border-slate-200/50` | Glass. `bg-slate-50` или `bg-white`. |
| 14 | 218 | `bg-white rounded-[2rem] border border-slate-200/50` | ✅ Правильно |

---

## Глобальные проблемы (кросс-модульные)

### 🔴 CRITICAL

| № | Проблема | Модули | Предложение |
|---|----------|--------|-------------|
| 1 | **`font-black` используется 100+ раз** | Все 12 модулей | `grep -rn 'font-black' src/components/modules/ --include=*.tsx --include=*.ts` и заменить: заголовки → `font-bold`, кнопки → `font-semibold`, лейблы → `font-semibold`, значения → `font-bold`, моноширинные → `font-bold` |
| 2 | **Glass/backdrop-blur 50+ вхождений** | Dashboard, Documents, Dozvola, Directories, Settings, Admin | Заменить на solid `bg-white`, `bg-slate-50`, `border border-slate-200/50` |
| 3 | **`bg-white/*` (проценты opacity)** | 30+ вхождений | `bg-white/60` → `bg-white`, `bg-white/85` → `bg-white`, `bg-white/45` → `bg-white` |
| 4 | **Нативные `alert()`** | SalaryModule:465 | Заменить на `toast()` |

### 🟡 MAJOR

| № | Проблема | Модули | Предложение |
|---|----------|--------|-------------|
| 5 | **3 модуля > 2000 строк** | PlanDohod (3419), Dohod (3040), Documents (2379) | Декомпозиция через `React.memo` и вынос под-компонентов в отдельные файлы |
| 6 | **ArchiveModule — кастомный стиль** | Archive | `#c3fb12` (lime) и `bg-slate-950` полностью вне дизайн-системы. Переписать на slate/#3765F6. |
| 7 | **Нет PlanDohod header в DohodModule, BazaModule, VDDModule** | Dohod, Baza, VDD | Добавить `<span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest block mb-1">Модуль X</span>` |
| 8 | **`flex-1` на контенте модалок без `md:`** | Разные модалки | `flex-1` → `w-full md:flex-1` (см. §37 pitfalls) |
| 9 | **`shadow-inner` на inputs** | UserManagement, AdminAnnouncements | `shadow-inner` → убрать (PlanDohod использует только `outline-none focus:border-slate-400`) |
| 10 | **Тени `shadow-xl`** | AdminAgent, Dozvola | `shadow-xl` → `shadow-[0_8px_30px_rgba(0,0,0,0.01)]` |
| 11 | **Хардкод API ключей** | DohodModule:44, SettingsModule:51 | Вынести в `.env`, не в исходники |
| 12 | **`console.log` в проде** | Все модули | Покрыть `import.meta.env.DEV` |

### 🟢 MINOR

| № | Проблема | Предложение |
|---|----------|-------------|
| 13 | Tab bars с `overflow-x-auto` | Заменить на `flex-wrap lg:flex-nowrap lg:overflow-x-auto` |
| 14 | `italic` на empty states | Убрать `italic` |
| 15 | `font-sans` на каждом компоненте | Должен быть один раз на `body` |
| 16 | `hidden md:flex` hover-only элементы | Проверить, что key-actions доступны на touch (не скрыты hover) |
| 17 | `key={index}` в map | 5+ потенциальных проблем с React key (заменить на стабильный id) |

---

## Рекомендации по приоритету

### Sprint 1 (критические — срочно)
1. **ArchiveModule** — переписать на slate/#3765F6 (убрать lime-акцент)
2. **DocumentsModule** — убрать `backdrop-blur-xl` (4 контейнера)
3. **SalaryModule** — заменить `alert()` на toast
4. **DashboardModule** — убрать `overflow-hidden`, убрать `backdrop-blur`

### Sprint 2 (типографика)
5. `font-black` → `font-bold`/`font-semibold` во всех 12 модулях
6. `backdrop-blur` → solid bg во всех модулях

### Sprint 3 (адаптивность)
7. `flex-1` → `w-full md:flex-1` в модалках
8. `overflow-x-auto` → `flex-wrap` на табах
9. Проверить все touch-targets (не только `min-h-[44px]` но и min-w)

### Sprint 4 (декомпозиция)
10. PlanDohodModule (3419→<1500)
11. DohodModule (3040→<1500)
12. DocumentsModule (2379→<1000)

---

## Итого по модулям

| Модуль | Строк | font-black | backdrop-blur | PlanDohod header | Статус |
|--------|-------|-----------|---------------|------------------|--------|
| Dashboard | 987 | 5+ | 3 | Нет | ⚠️ Требует доработки |
| PlanDohod | 3419 | 0 | 0 | ✅ | ✅ Эталон |
| Dohod | 3040 | 2+ | 2+ | Нет | ⚠️ Большой файл |
| Baza | 1558 | 3+ | 0 | Нет | ⚠️ Требует header |
| VDD | 1640 | 4 | 0 | Нет | ⚠️ Требует header |
| Salary | 1218 | 0 | 0 | ✅ ✅ | ✅ Почти эталон |
| Documents | 2379 | 5+ | 8 | Нет | 🔴 glass + размер |
| Directories | 346 | 0 | 2 | ✅ ✅ | ✅ Почти эталон |
| Archive | 315 | 20+ | 0 | Нет | 🔴 **срочно** |
| Settings | 1355 | 10+ | 5+ | ✅ | ⚠️ font-black + glass |
| Admin | 283 | 1 | 0 | ✅ ✅ | ✅ Хорошо |
| UserMgmt | 716 | 6+ | 2+ | N/A | ⚠️ font-black |
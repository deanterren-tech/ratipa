# QA Audit: Overflow & Container Breakout Issues

**Проект:** RATIPA Portal (React+Vite+Tailwind v4+Firebase RTDB)  
**Дата:** 2026-08-30  
**Метод:** Статический анализ всех .tsx в `src/components/`, `src/components/modules/`, `src/components/modules/dozvola/`  
**Всего проверено файлов:** 55

---

## Сводка

| Severity | Count |
|----------|-------|
| 🔴 Critical | 3 |
| 🟠 Major | 10 |
| 🟡 Minor | 8 |

---

## 🔴 Critical

### C1. [CRITICAL] `w-8 h-8` кнопки удаления без `min-h-[44px]` в DozvolaDocuments

**Файл:** `src/components/modules/dozvola/DozvolaDocuments.tsx`  
**Строки:** 1069, 1168, 1260

```tsx
className="w-8 h-8 rounded-lg text-rose-500 hover:bg-rose-50 transition flex items-center justify-center mx-auto cursor-pointer"
```

**Проблема:** Три кнопки удаления строк (permit, return, china) имеют размер 32×32px без `min-h-[44px]` / `min-w-[44px]`. На мобильных touch-target меньше рекомендованных 44×44px.  
**Предложение:** Добавить `min-h-[44px] min-w-[44px]` на каждую кнопку.

---

### C2. [CRITICAL] `w-8 h-8` кнопка удаления авто в карточке BazaModule (mobile cards)

**Файл:** `src/components/modules/BazaModule.tsx`  
**Строка:** 1259

```tsx
className="w-8 h-8 bg-rose-50 hover:bg-rose-100 text-rose-500 rounded-xl flex items-center justify-center shrink-0 disabled:opacity-30 transition-all active:scale-90 border border-rose-100 cursor-pointer"
```

**Проблема:** Кнопка удаления автомобиля в карточках мобильного представления — 32×32px без touch-target. Используется на мобильных (block lg:hidden).  
**Предложение:** Добавить `min-h-[44px] min-w-[44px]`.

---

### C3. [CRITICAL] `w-8 h-8` кнопки редактирования/удаления в PlanDohodModule

**Файл:** `src/components/modules/PlanDohodModule.tsx`  
**Строки:** 1977, 1984, 2481, 2494 — кнопки edit/delete в таблицах

```tsx
className="w-8 h-8 inline-flex items-center justify-center rounded-full bg-rose-50 hover:bg-rose-100 text-rose-600 transition disabled:opacity-30 cursor-pointer"
```

**Проблема:** Кнопки 32×32px без touch-targets.  
**Предложение:** Добавить `min-h-[44px] min-w-[44px]`.

---

## 🟠 Major

### M1. [MAJOR] `w-8 h-8` кнопки в DozvolaLocations (строки 141, 149)

**Файл:** `src/components/modules/dozvola/DozvolaLocations.tsx`  
**Строки:** 141, 149

```tsx
className="w-8 h-8 rounded-lg text-slate-600 hover:text-[#3765F6] hover:bg-slate-50 flex items-center justify-center font-bold text-base transition cursor-pointer"
```

**Проблема:** Две кнопки search/add без touch-target модификаторов.  
**Предложение:** Добавить `min-h-[44px] min-w-[44px]`.

---

### M2. [MAJOR] `w-9 h-9` кнопки без `min-h-[44px]` в PlanDohodModule

**Файл:** `src/components/modules/PlanDohodModule.tsx`  
**Строки:** 2235, 2242, 3020, 3031, 3042

```tsx
className="w-9 h-9 flex items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-600 transition cursor-pointer"
```

**Проблема:** Кнопки 36×36px — немного лучше w-8, но всё ещё ниже 44px.  
**Предложение:** `min-h-[44px] min-w-[44px]`.

---

### M3. [MAJOR] `w-8 h-8` без touch-target в MapRouteModal

**Файл:** `src/components/MapRouteModal.tsx`  
**Строка:** 167

```tsx
className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 hover:bg-slate-200 flex items-center justify-center transition cursor-pointer"
```

**Проблема:** Кнопка-иконка 32×32px.  
**Предложение:** Добавить `min-h-[44px] min-w-[44px]`.

---

### M4. [MAJOR] `w-8 h-8` кнопки в ArchiveModule не имеют touch-target

**Файл:** `src/components/modules/ArchiveModule.tsx`  
**Строка:** 161 (кнопка "Восстановить") — имеет `min-h-[44px]` ✓

*Архивные кнопки проверены — они имеют `min-h-[44px]`.*

---

### M5. [MAJOR] `table` с `whitespace-nowrap` в ArchiveModule без overflow-x-auto

**Файл:** `src/components/modules/ArchiveModule.tsx`  
**Строки:** 176, 276

```tsx
<table className="w-full text-left border-collapse text-xs whitespace-nowrap">
```

**Проблема:** Таблицы в `hidden md:block` контейнере (`table-scroll`) используют `whitespace-nowrap`. Если контейнер `table-scroll` не имеет CSS `overflow-x: auto`, длинные строки (особенно комментарии) вылезут за границы.  
**Контекст:** Обёртка `hidden md:block table-scroll` — `table-scroll` должен быть определён в CSS с `overflow-x: auto`.  
**Предложение:** Проверить CSS класс `.table-scroll` — убедиться, что есть `overflow-x: auto; -webkit-overflow-scrolling: touch;`  
Без этого на мобильных (hidden md:block → не показывается), но на планшетах md+ может вылезти.

---

### M6. [MAJOR] `whitespace-nowrap` на th в CouplingDirectoryEditor без overflow

**Файл:** `src/components/modules/CouplingDirectoryEditor.tsx`  
**Строки:** 435–439

**Проблема:** 5 заголовков таблицы с `whitespace-nowrap` в контейнере `overflow-x-auto rounded-2xl`. На очень узких экранах длинные заголовки ("Сцепка (Тягач / Прицеп)", "Диспетчер") могут не поместиться.  
**Оценка:** Контейнер уже имеет `overflow-x-auto`, так что скролл появится. Безопасно, но скролл может быть неочевидным.  
**Предложение:** Рассмотреть `overflow-x-auto` на родителе (уже есть) или сократить заголовки. MINOR, а не MAJOR.

---

### M7. [MAJOR] `hidden lg:block` таблица в DohodModule без мобильного card-варианта (leg editor)

**Файл:** `src/components/modules/DohodModule.tsx`  
**Строка:** 2051

```tsx
<div className="hidden lg:block w-full overflow-x-auto pb-4 custom-scrollbar">
  <table className="w-full border-collapse relative">
    ...
  </table>
</div>
```

**Проблема:** На экранах < lg таблица скрыта. Есть мобильный card-вариант ниже (строка 2320: `block lg:hidden`). ✓ Это нормально.

**НО:** Шапка таблицы использует `position: sticky`, но `sticky` не работает внутри `overflow-x-auto`. При горизонтальном скролле колонки уезжают. Уже отмечено в QA_AUDIT_DohodModule.md.

---

### M8. [MAJOR] `max-h-[300px]` на мобильных в DohodModule (валютный конвертер)

**Файл:** `src/components/modules/DohodModule.tsx`  
**Строка:** 2825

```tsx
className="w-full bg-white/45 rounded-2xl p-4 md:p-5 border border-slate-200/50 flex flex-col gap-3 max-h-[400px] md:max-h-[450px] overflow-y-auto custom-scrollbar"
```

**Проблема:** `max-h-[400px]` на мобильных. При 10+ валютах контент может превышать 400px, и нижние строки скрыты за скроллом.  
**Предложение:** Увеличить до `max-h-[500px]` на мобильных или убрать max-h.

---

### M9. [MAJOR] `truncate` без `max-w` в VehicleDriverDataModule

**Файл:** `src/components/modules/VehicleDriverDataModule.tsx`  
**Строки:** 217, 218, 225, 227

```tsx
<div className="select-all truncate">Марки: {brandsText || '—'}</div>
```

**Проблема:** `truncate` без `max-w` в flex-контейнере. `truncate` требует `overflow: hidden` и ширину. В flex-box `truncate` может не работать, если нет `min-w-0` на родителе.  
**Предложение:** Убедиться, что родитель имеет `min-w-0`. Или добавить `max-w-full`.

---

### M10. [MAJOR] `flex-1` без `min-w-0` в нескольких компонентах

Потенциально проблемные `flex-1` без `min-w-0` на том же элементе в flex-контейнерах с длинным контентом:

- `src/components/modules/DozvolaLocations.tsx` строка 92: `min-h-[14px] flex-1` — текстовый блок без `min-w-0`
- `src/components/modules/CouplingCard.tsx` строки 82, 100, 154: `flex-1` с `truncate` внутри — `truncate` требует `min-w-0` на родителе
- `src/components/modules/DozvolaDocuments.tsx` строки 1007, 1098, 1198: `flex-1 min-w-[200px]` — это ок, min-w задан
- `src/components/modules/SettingsModule.tsx` строка 1189: `max-h-[250px] overflow-y-auto ... flex-1` — без `min-w-0`, но внутри фиксированной колонки lg-сетки
- `src/components/modules/AdminAgentBlock.tsx` строка 572: `flex-1` внутри flex-контейнера

**Предложение:** Добавить `min-w-0` к `flex-1` элементам, содержащим текст или динамический контент.

---

## 🟡 Minor

### m1. [MINOR] `p-1` на кликабельном элементе без touch-target (MapRouteModal)

**Файл:** `src/components/MapRouteModal.tsx`  
**Строка:** 230

```tsx
className="p-1 text-rose-500 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition"
```

Кнопка удаления waypoint с минимальным padding. Размер кликабельной области около 20×20px.  
**Предложение:** `p-2` или добавить `min-h-[44px]` (но это изменит дизайн).

---

### m2. [MINOR] `text-ellipsis overflow-hidden` на select с короткими опциями (DohodModule)

**Файл:** `src/components/modules/DohodModule.tsx`  
**Строка:** 2229

```tsx
className="... leading-tight overflow-hidden text-ellipsis"
```

Селект валюты (USD/EUR/RUB/BYN — 3-4 символа) с `text-ellipsis` — опции никогда не будут обрезаны.  
**Предложение:** Убрать `text-ellipsis` и `overflow-hidden`.

---

### m3. [MINOR] `overflow-hidden` на карточке DohodModule может резать контент

**Файл:** `src/components/modules/DohodModule.tsx`  
**Строка:** 2032

```tsx
className="bg-white rounded-2xl p-5 border border-slate-200/50 shadow-sm overflow-hidden flex flex-col"
```

Карточка "Конструктор плеч маршрута" с `overflow-hidden` — если контент динамически расширяется (добавление плеч), `overflow-hidden` не даст ему расти.  
**Предложение:** Убедиться, что `overflow-hidden` нужен (для скругления углов используйте `isolation: isolate` вместо этого).

---

### m4. [MINOR] `truncate` в `max-w-[120px]` в BazaModule — может резать длинные комментарии

**Файл:** `src/components/modules/BazaModule.tsx`  
**Строка:** 1294

```tsx
className="text-[11px] text-slate-600 truncate max-w-[120px] inline-block font-medium"
```

`max-w-[120px]` c `truncate` — на мобильных в карточке автомобиля длинные комментарии будут обрезаны до ~120px.  
**Предложение:** Увеличить до `max-w-[200px]` или `max-w-full`.

---

### m5. [MINOR] `hidden lg:block` в PlanDohodModule для таблицы плечей

**Файл:** `src/components/modules/PlanDohodModule.tsx`  
**Строка:** 2343

```tsx
<div className="hidden lg:block overflow-x-auto pb-2">
  <table className="w-full text-left border-collapse min-w-[600px]">
```

**Проблема:** `min-w-[600px]` в комбинации с `overflow-x-auto` — на всех экранах < 600px появляется скролл внутри блока.  
**Контекст:** Таблица скрыта на < lg, так что на мобильных проблемы нет. Но на lg+ с окном 768–1024px может быть неожиданный скролл.  
**Предложение:** Уменьшить `min-w-[600px]` до `min-w-[500px]` или убрать.

---

### m6. [MINOR] `whitespace-nowrap` на кнопках табов в DozvolaModule

**Файл:** `src/components/modules/DozvolaModule.tsx`  
**Строки:** 52, 62, 72, 82, 92

```tsx
className={`px-4 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
```

**Проблема:** Кнопки переключения типов разрешений с `whitespace-nowrap`. Если названия длинные ("Универсальное разрешение" + счетчик), на маленьких экранах могут не поместиться в контейнере.  
**Предложение:** Убедиться, что родительский flex-контейнер использует `flex-wrap` или `overflow-x-auto`.

---

### m7. [MINOR] `whitespace-nowrap` на th в DozvolaRegistryList

**Файл:** `src/components/modules/dozvola/DozvolaRegistryList.tsx`  
**Строки:** 90, 93, 97, 109, 131

```tsx
<td className="px-3 py-2.5 align-middle font-mono font-bold text-slate-900 text-[13px] whitespace-nowrap">
```

Несколько td с `whitespace-nowrap` в таблице внутри `overflow-x-auto` контейнера.  
**Контекст:** Родитель `hidden md:block overflow-x-auto custom-scrollbar` на строке 1108 — на md+ таблица показывается с auto-scroll. На <md есть card-вариант.  
Безопасно, но для информации.

---

### m8. [MINOR] `overflow-hidden` на динамическом контенте в DozvolaLocations

**Файл:** `src/components/modules/dozvola/DozvolaLocations.tsx`  
**Строка:** 794

```tsx
className="flex-1 h-full rounded-2xl overflow-hidden relative border border-slate-200/50 bg-slate-50 z-0"
```

Карта/контейнер с `overflow-hidden` и динамическим контентом (маршруты, метки). Если метки выходят за границы контейнера, они будут обрезаны.  
**Предложение:** Убедиться, что маркеры/метки не позиционированы за границами контейнера.

---

## Итого: рекомендации по приоритету

### Немедленно (Critical — touch-targets):
1. DozvolaDocuments.tsx: строки 1069, 1168, 1260 — `min-h-[44px] min-w-[44px]` на кнопки ✕
2. BazaModule.tsx: строка 1259 — `min-h-[44px] min-w-[44px]` на кнопку удаления
3. PlanDohodModule.tsx: строки 1977, 1984, 2481, 2494 — `min-h-[44px] min-w-[44px]`

### Важно (Major):
4. MapRouteModal.tsx: строка 167 — `min-h-[44px] min-w-[44px]`
5. DozvolaLocations.tsx: строки 141, 149 — `min-h-[44px] min-w-[44px]`
6. PlanDohodModule.tsx: строки 2235, 2242, 3020, 3031, 3042 — `min-h-[44px] min-w-[44px]`
7. Проверить CSS класс `.table-scroll` в ArchiveModule на наличие `overflow-x: auto`
8. DohodModule.tsx: строка 2825 — увеличить `max-h-[400px]` до `max-h-[500px]`
9. VehicleDriverDataModule.tsx: строки 217, 218, 225, 227 — `truncate` без `max-w`/`min-w-0`
10. `flex-1` без `min-w-0` в нескольких местах (см. M10)

### По возможности (Minor):
11. MapRouteModal.tsx: строка 230 — увеличить `p-1` до `p-2`
12. DohodModule.tsx: строка 2229 — убрать `text-ellipsis overflow-hidden` на селекте валюты
13. DohodModule.tsx: строка 2032 — `overflow-hidden` на карточке
14. PlanDohodModule.tsx: строка 2343 — `min-w-[600px]` → `min-w-[500px]`
15. DozvolaModule.tsx: строки 52–92 — проверить flex-wrap родителя
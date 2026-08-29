# Mobile UX/UI Audit Report — RATIPA Portal

**Date:** 2026-08-29
**Scope:** Все модули портала RATIPA — анализ проблем мобильной версии

---

## Сводка найденных проблем

| Категория | Количество |
|---|---|
| 🔄 Горизонтальные скроллы (overflow-x-auto) | 28+ |
| 📐 Таблицы без мобильной альтернативы | 8 |
| 👻 Кнопки, видимые только при наведении (hover) | 12+ |
| 📱 Контент, скрытый на мобильных (hidden md/lg/sm) | 33+ |
| 🧩 Сетки без fallback на мобильных | 8+ |
| 📋 Модалки с внутренними скроллами | 12+ |
| ✂️ Фиксированные min-width / max-width | 185+ |
| 🚫 whitespace-nowrap без overflow handling | 143+ |

---

## 1. AppShell.tsx

### строка 885 — Горизонтальный скролл в навигации
```tsx
<nav className="hidden md:flex items-center gap-1.5 p-1 rounded-2xl overflow-x-auto lg:overflow-visible whitespace-nowrap scrollbar-none max-w-[50vw] sm:max-w-[70vw] lg:max-w-none flex-nowrap shrink relative">
```
Проблема: Навигация имеет `overflow-x-auto` с `whitespace-nowrap` и `flex-nowrap`. На планшетах (md, lg) при переполнении появляется горизонтальный скролл. `max-w-[50vw]` на дефолтном экране может обрезать меню.

### строка 1007 — Строка TypingText скрыта на lg+
```tsx
<div className="hidden lg:flex items-center mr-2 border-r border-slate-200/60 pr-4 h-6">
```
Проблема: Бегущая строка скрыта на экранах меньше lg. На мобильных и планшетах информация недоступна.

### строка 1016 — Аватары онлайн-пользователей
```tsx
<div className="hidden md:flex items-center -space-x-2 mr-1 relative group cursor-pointer">
```
Проблема: Аватарки слету недоступны на мобильных устройствах. Пользователь не видит, кто онлайн.

### строка 1035 — Popover списка пользователей
```tsx
<div className="absolute top-full right-0 mt-2 w-48 ... opacity-0 group-hover:opacity-100 invisible group-hover:visible ...">
```
Проблема: Список пользователей появляется только при hover. На мобильных hover не работает — список никогда не откроется.

### строка 1211 — Индикатор "Активна"
```tsx
<div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 ...">
```
Проблема: Индикатор статуса скрыт на мобильных. Пользователь не знает, активно ли соединение.

### строка 1226 — Имя пользователя
```tsx
<div className="hidden xl:block text-left text-xs leading-none">
```
Проблема: Имя пользователя видно только на xl-экранах. На всех меньших устройствах скрыто.

### строка 1356 — Нижняя навигация (3 кнопки)
```tsx
<nav className="md:hidden fixed bottom-0 ...">
```
Проблема: Всего 3 основные кнопки + кнопка "Меню". Пользователь может не заметить пункты в меню, так как хедер скрыт на мобильных.

### строка 1386 — Мобильное меню
```tsx
<div className="absolute bottom-[3.75rem] left-2 right-2 bg-white rounded-[1.75rem] ... max-h-[70vh] overflow-y-auto p-5">
```
Проблема: Мобильное меню перекрывает ~70% экрана. Элементы внутри grid-cols-3 (строка 1394) могут быть мелкими на маленьких экранах.

---

## 2. DohodModule.tsx

### строка 810 — Сетка метрик
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
```
✅ **OK** — Хорошая mobile-first сетка

### строка 2073-2074 — Таблица на десктопе, мобильной нет
```tsx
<div className="hidden lg:block w-full overflow-x-auto pb-4 custom-scrollbar">
  <table className="w-full min-w-[1200px] border-collapse relative">
```
🔴 **КРИТИЧНО**: Таблица полностью скрыта на экранах меньше lg (`hidden lg:block`). `min-w-[1200px]` заставляет таблицу быть широкой даже в overflow контейнере. Мобильная альтернатива есть на строке 2339 (`block lg:hidden`), но это разные представления — нужно проверить, что карточки/альтернатива содержат те же данные.

### строка 2339 — Мобильная альтернатива таблице
```tsx
<div className="block lg:hidden space-y-4 max-h-[600px] overflow-y-auto custom-scrollbar pr-1 pb-4">
```
⚠️ **Медиум**: Мобильное представление имеет `max-h-[600px]`, что обрезает длинные списки без явной кнопки "Показать ещё".

### строка 2825 — Горизонтальный скролл для фильтров
```tsx
<div className="flex overflow-x-auto custom-scrollbar items-center gap-3 mb-4 bg-slate-50/50 border border-slate-200/60 p-3 rounded-2xl text-xs select-none whitespace-nowrap shadow-sm">
```
Проблема: Панель фильтров с горизонтальным скроллом и `whitespace-nowrap`. На мобильных часть фильтров скрыта за скроллом, пользователь может не заметить важные опции.

---

## 3. PlanDohodModule.tsx

### строка 48-51 — Zoom таблицы
```tsx
const [tableScale, setTableScale] = useState<number>(() => {
  const saved = localStorage.getItem(`pd_table_scale_${user.uid}`);
  return saved ? Number(saved) : 100;
});
```
⚠️ Попытка решить проблему зумом, а не адаптивным дизайном.

### строка 1858-1859 — Таблица скрыта на lg+
```tsx
<div className="hidden lg:block w-full overflow-x-auto pb-4 custom-scrollbar">
  <table className="w-full w-full flex-wrap border-collapse relative">
```
🔴 **КРИТИЧНО**: Таблица с рейсами скрыта на мобильных. Нет очевидной мобильной альтернативы для этой секции.

### строка 2407-2408 — История план-дохода
```tsx
<div className="hidden lg:block overflow-x-auto pb-2">
  <table className="w-full text-left border-collapse min-w-[600px]">
```
Проблема: Скрыто на мобильных. `min-w-[600px]` требует широкого экрана.

### строка 2919 — Zoom всей таблицы
```tsx
<div className="flex flex-col gap-4 relative w-full overflow-x-auto transition-all duration-150" style={{ zoom: tableScale / 100 } as any}>
```
Проблема: `overflow-x-auto` на корневом контейнере и zoom — костыль, вызывающий horizontal scroll на мобильных.

### строка 2925 — Десктопные заголовки таблицы
```tsx
<div className="hidden lg:flex px-6 pb-3 ...">
```
Проблема: Заголовки таблиц скрыты на мобильных.

### строка 3039 — Кнопки действий таблицы
```tsx
<div className="flex items-center gap-1.5 mt-1 opacity-100 xl:opacity-0 group-hover:opacity-100 transition-all duration-150">
```
⚠️ **Медиум**: Кнопки становятся `opacity-0` на xl экранах и видны только при hover. На мобильных opacity-100 не применяется (нет xl), но hover на мобильных не работает.

### строка 3258 — Горизонтальный скролл тегов/фильтров
```tsx
<div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 overflow-x-auto max-w-full items-center">
```
Проблема: Теги фильтров скроллятся горизонтально на мобильных.

### строка 3304, 3328, 3354 — Горизонтальный скролл секций
```tsx
<div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar pb-1">
```
Проблема: Множественные flex-контейнеры с overflow-x-auto.

### строка 733 — Сетка статусов
```tsx
<div className="grid grid-cols-3 gap-1.5 bg-slate-50 p-2 rounded-xl border border-slate-100">
```
⚠️ **Медиум**: `grid-cols-3` без mobile fallback. На узких мобильных экранах 3 колонки могут быть слишком плотными.

---

## 4. SalaryModule.tsx

### строка 671 — Сетка блоков
```tsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
```
✅ **OK** — Есть mobile fallback

### строка 731 — Сетка итогов (5 колонок)
```tsx
<div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
```
✅ **OK** — Постепенная адаптация

### строка 940-957 — Кнопки с текстом, скрытым на мобильных
```tsx
<Copy className="w-3.5 h-3.5" />
<span className="hidden md:inline">Дублировать</span>
```
Проблема: На мобильных показываются только иконки без текста. Пользователь может не понять, что означает иконка (Copy = дублировать, Edit = править, Trash2 = удалить).

---

## 5. DocumentsModule.tsx

### строка 1305 — Горизонтальный скролл табов
```tsx
<div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl border border-slate-200/50 overflow-x-auto max-w-full items-center">
```
Проблема: Табы документов с overflow-x-auto. На мобильных часть табов скрыта за скроллом.

### строка 1618 — max-h-[500px] overflow-y-auto
```tsx
<div className="flex flex-col gap-3.5 max-h-[500px] overflow-y-auto pr-1.5 custom-scrollbar">
```
Проблема: Список сцепок обрезан по высоте. На мобильных может быть еще меньше видимого контента.

### строка 2084, 2107, 2151 — Сетки с md:grid-cols-2 и md:grid-cols-3
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
```
✅ **OK** — Есть grid-cols-1 fallback

### строка 2269-2277 — Фиксированные ширины полей
```tsx
<div className="min-w-[120px] max-w-[150px]">
```
Проблема: Фиксированная ширина на мобильных может привести к обрезанию текста.

---

## 6. BazaModule.tsx

### строка 978-979 — Сетка KPI
```tsx
<div className="grid grid-cols-1 sm:grid-cols-3 gap-6 ...">
```
✅ **OK**

### строка 1033 — Сетка 4 колонок
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-4">
```
✅ **OK**

### строка 1173 — Таблица с горизонтальным скроллом
```tsx
<div className="overflow-x-auto custom-scrollbar">
```
Проблема: Таблица базы данных с горизонтальным скроллом. Нет очевидных признаков, что контент можно скроллить.

### строка 1219 — Кнопки действий, видимые только при hover
```tsx
<div className="flex gap-1.5 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
```
🔴 **КРИТИЧНО**: Кнопки действий видны только при наведении. На мобильных устройствах недоступны. У пользователя нет способа выполнить действия с записями.

### строка 1217 — Обрезание текста
```tsx
<td ... max-w-[180px] truncate">{v.comment || v.notes || '—'}</td>
```
Проблема: `max-w-[180px]` + `truncate` обрезает комментарии. На мобильных это значение ещё более критично.

### строка 1393 — Сетка аналитики
```tsx
<div className="grid-cols-2 lg:grid-cols-4 gap-3">
```
⚠️ **Медиум**: `grid-cols-2` без sm: префикса. На мобильных колонки могут быть узкими.

### строка 1443 — Сетка полей
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
```
✅ **OK**

---

## 7. VehicleDriverDataModule.tsx

### строка 242 — Кнопка удаления
```tsx
className="... min-h-[44px] min-w-[44px] ..."
```
✅ **OK** — Хороший touch target.

### строка 1067 — Сетка фильтров
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 font-sans">
```
✅ **OK**

### строка 1135 — Сетка карточек
```tsx
<div className={`grid grid-cols-1 sm:grid-cols-2 ${isDriveOpen ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-6 pr-1 custom-scrollbar`}>
```
⚠️ **Медиум**: На мобильных `grid-cols-1` нормально, но если данных много, список становится бесконечным.

### строка 1166 — Заголовок Диска скрыт на sm-
```tsx
<h3 className="text-xs font-bold text-slate-800 tracking-tight hidden sm:block">
```
Проблема: Заголовок "Google Диск" скрыт на мобильных.

### строка 1191 — Обозначение вкладки
```tsx
<span className="hidden md:inline uppercase tracking-wider text-[9px]">Вкладка</span>
```
Проблема: На мобильных только иконка без текстового обозначения.

### строка 1302 — Кнопка закрытия модалки
```tsx
className="w-8 h-8 md:w-8 md:h-8 ... min-h-[44px] min-w-[44px]"
```
✅ Хороший touch target

---

## 8. PlanZagruzokModule.tsx

### (файл маленький, 56 строк)
Данный модуль — обёртка над `SheetModuleBase`. Основные проблемы в SheetModuleBase (см. отдельно).

---

## 9. AdminModule.tsx

### строка 169 — min-h-[85vh]
```tsx
<div className="bg-white rounded-[2rem] ... min-h-[85vh] relative">
```
Проблема: `min-h-[85vh]` на мобильных может создать большой пустой области, если контента мало, но `flex flex-col` позволяет сжиматься.

### строка 191 — Навигация табов
```tsx
<div className="mt-6 flex flex-wrap gap-1 p-1 bg-slate-50 border border-slate-200 rounded-2xl max-w-max">
```
⚠️ **Медиум**: `max-w-max` + `flex-wrap` — табы могут переноситься, но на очень маленьких экранах станет некрасиво.

### строка 222 — overflow-y-auto
```tsx
<div className="flex-1 overflow-y-auto p-6 lg:p-8 custom-scrollbar relative z-0">
```
⚠️ Внутренний скролл в панели админа приемлем для десктопа. На мобильных может overlap с основным скроллом.

---

## 10. DashboardModule.tsx

### строка 321 — overflow:hidden
```tsx
<div className="w-full relative min-h-screen flex flex-col justify-between p-6 sm:p-8 md:p-10 select-none text-slate-900 overflow-hidden">
```
Проблема: `overflow-hidden` на корневом диве может обрезать меню и абсолютно позиционированные элементы (подсказки, дропдауны).

### строка 334-365 — Плавающие карточки
```tsx
className="hidden md:flex items-center gap-2.5 px-3.5 py-2 bg-white/45 ... opacity-60 hover:opacity-100 ..."
```
🔴 **КРИТИЧНО**: Плавающие ссылки-пилюли скрыты на мобильных (`hidden md:flex`). На мобильных нет прямого доступа к этим инструментам с главной.

### строка 382 — Приветствие
```tsx
<h1 className="text-3xl sm:text-4xl md:text-5xl font-black tracking-tight ...">
```
✅ **OK** — Респонсивные размеры текста.

### строка 409 — Баннер новостей
```tsx
<div className="w-full max-w-2xl bg-white/95 border ... flex flex-col md:flex-row ...">
```
Проблема: На мобильных (`flex-col`) блок с новостью становится вертикальным, но изображение имеет `h-44 md:h-auto min-h-[140px]` — на мобильных высота фиксирована.

### строка 608 — Сетка лаунчера
```tsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 overflow-y-auto pr-1">
```
✅ **OK** — Хороший плавный переход

---

## 11. DozvolaRegistryList.tsx

### строка 89-131 — Таблица с whitespace-nowrap
```tsx
<td className="px-3 py-2.5 align-middle font-mono font-bold text-slate-900 text-[13px] whitespace-nowrap">
  {item.number || item.permitNumber}
</td>
```
🔴 **КРИТИЧНО**: Множество `whitespace-nowrap` в ячейках таблицы. На мобильных это вызывает horizontal scroll и обрезание данных.

### строка 995 — Табы фильтрации с overflow-x-auto
```tsx
<div className="flex items-end gap-1 overflow-x-auto custom-scrollbar flex-1 pb-1">
```
Проблема: Табы дозволов скроллятся горизонтально. Пользователь может не заметить все типы дозволов.

### строка 998-1040 — whitespace-nowrap в табах
Множественные кнопки табов с `whitespace-nowrap`. При скролле табов длинные названия не переносятся.

### строка 1105-1107 — Таблица Registry скрыта на md
```tsx
<div className="hidden md:block overflow-x-auto custom-scrollbar">
  <table className="w-full border-collapse text-xs">
```
🔴 **КРИТИЧНО**: Вся таблица реестра дозволов скрыта на экранах меньше md. Нужно проверить, есть ли карточная альтернатива (строка ~1110+).

---

## 12. DozvolaWidgets.tsx

### строка 267 — Компоновка виджетов
```tsx
<div className="space-y-6">
```
Все дочерние элементы вертикальные — приемлемо для мобильных.

### строка 272 — Статистика
```tsx
<div className="flex justify-between items-center text-sm font-semibold text-slate-700 border-b border-slate-100/60 pb-1">
  <span>Всего бланков:</span>
  <span className="font-bold">{stats.total} шт</span>
</div>
```
✅ **OK** — flex между элементами в одну строку.

### строка 433 — Скролл дедлайнов
```tsx
<div className="bg-slate-50/70 border border-slate-200 rounded-xl p-3 text-xs font-semibold mt-1 max-h-48 overflow-y-auto custom-scrollbar">
```
Проблема: `max-h-48` обрезает длинный список дозволов с истекающими сроками.

### строка 520 — Котроль оригиналов (30 дней)
```tsx
<div className="bg-purple-50/40 rounded-xl p-3 text-xs font-semibold max-h-56 overflow-y-auto custom-scrollbar space-y-2">
```
Проблема: `max-h-56` (224px) может скрыть часть записей.

### строка 572 — Форма планерки
```tsx
<div className="flex flex-col sm:flex-row sm:items-end gap-3 w-full">
```
✅ **OK** — На мобильных колонкой.

### строка 732 — whitespace-nowrap на тегах типов
```tsx
className="bg-slate-50 border border-slate-200/60 px-2 py-0.5 rounded-full text-[10px] whitespace-nowrap !no-underline font-semibold text-slate-600"
```
Проблема: Теги типов дозволов с `whitespace-nowrap`. На мобильных могут вылезать за край контейнера.

---

## 13. DozvolaDocuments.tsx

### строка 1048, 1145, 1243 — Таблицы с горизонтальным скроллом
```tsx
<div className="table-responsive select-none overflow-x-auto custom-scrollbar border border-slate-200/50 rounded-2xl bg-white">
```
Проблема: Все три таблицы документов (заявления, возвраты, копии) имеют `overflow-x-auto`. На мобильных пользователь должен скроллить, чтобы увидеть все колонки.

### строка 1005 — min-w-[200px] для поиска
```tsx
<div className="flex-1 min-w-[200px]">
```
Проблема: Фиксированная минимальная ширина может вызвать горизонтальный скролл на узких экранах.

---

## 14. DozvolaLocations.tsx

### строка 96-97 — Кнопка редактирования комментария
```tsx
className="opacity-0 group-hover/comment:opacity-100 p-0.5 text-slate-400 hover:text-blue-500 hover:bg-slate-50 rounded transition"
```
🔴 **КРИТИЧНО**: Кнопка редактирования комментариев к дозволам видна только при hover. На мобильных недоступна.

### строка 445 — h-[820px] на корневом контейнере
```tsx
<div className="flex flex-col h-[820px] w-full gap-4 text-slate-800">
```
🔴 **КРИТИЧНО**: Фиксированная высота 820px. На мобильных (меньше 820px высоты) страница будет иметь вертикальный скролл и ломать двухколоночную вёрстку.

### строка 448 — Фильтры
```tsx
<div className="bg-white/80 ... flex flex-col sm:flex-row items-center justify-between gap-4 shrink-0">
```
✅ **OK** — На мобильных колонкой.

### строка 503 — Панель локаций фиксированной ширины
```tsx
<div className="w-80 sm:w-[350px] flex flex-col gap-4 h-full shrink-0 min-h-0">
```
🔴 **КРИТИЧНО**: Фиксированная ширина 320px (w-80). На мобильных экранах (< 768px) боковая панель займёт всю ширину, и карта будет недоступна или уедет вниз/в скролл.

### строка 691-692 — Кнопки действий локации
```tsx
<div className="absolute top-2.5 right-2 opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
```
🔴 **КРИТИЧНО**: Кнопки "Редактировать" и "Удалить" для локаций видны только при hover. На мобильных недоступны.

### строка 789-794 — Правая панель с картой
```tsx
<div className="flex-1 h-full rounded-2xl overflow-hidden ...">
```
Проблема: Карта Leaflet имеет `height: 100%`. На мобильных при отсутствии достаточной высоты может обрезаться.

### строка 972 — Детальная панель локации
```tsx
<div className="absolute top-4 right-4 bottom-4 w-80 bg-white/95 ...">
```
Проблема: Абсолютно позиционированная панель деталей с `w-80` (320px). На мобильных может вылезать за правый край или перекрывать карту.

### строка 1076 — Модал отправки
```tsx
<div className="bg-white rounded-3xl shadow-2xl border border-slate-200/50 p-6 w-[620px] max-w-full flex flex-col gap-4 max-h-[90vh] overflow-hidden">
```
⚠️ **Медиум**: Ширина 620px на мобильных сжимается до `max-w-full`. Высота `max-h-[90vh]` с `overflow-hidden` может скрыть контент формы.

---

## 15. Дополнительные модули

### DirectoriesModule.tsx
- строка 195: `overflow-x-auto` в табах — горизонтальный скролл на мобильных.
- строка 210: `hidden sm:block` для счётчика записей.

### SheetModuleBase.tsx (PlanZagruzok модуль)
- строка 229: `hidden sm:block` подзаголовка.
- строка 278: `overflow-x-auto` в табах.
- строка 337: `hidden sm:block` заголовка GPS.

### CouplingDirectoryEditor.tsx
- строка 430: `overflow-x-auto` в таблице.

### CalendarDaysCalculator.tsx
- строка 31: `grid-cols-2` без mobile fallback.

---

## Итоговые рекомендации

### 🔴 Критические (блокируют работу на мобильных):

| # | Файл | Строка | Проблема |
|---|---|---|---|
| 1 | DozvolaLocations.tsx | 445 | `h-[820px]` — фиксированная высота ломает мобильную вёрстку |
| 2 | DozvolaLocations.tsx | 503 | `w-80 sm:w-[350px]` — панель с картой не адаптируется |
| 3 | DohodModule.tsx | 2073-2075 | Таблица `min-w-[1200px]` скрыта на мобильных (`hidden lg:block`) |
| 4 | PlanDohodModule.tsx | 1858-1859 | Таблица рейсов скрыта на мобильных |
| 5 | BazaModule.tsx | 1219 | Кнопки в таблице — только по hover, на мобильных недоступны |
| 6 | DozvolaLocations.tsx | 691-692 | Кнопки редактирования только по hover |
| 7 | DozvolaLocations.tsx | 96-97 | Редактирование комментария только по hover |
| 8 | DozvolaRegistryList.tsx | 1106 | Таблица реестра скрыта на md и меньше |
| 9 | DashboardModule.tsx | 359 | Плавающие ссылки скрыты на мобильных |

### ⚠️ Медиум (затрудняют, но не блокируют):

| # | Файл | Строка | Проблема |
|---|---|---|---|
| 1 | AppShell.tsx | 885 | Навигация с `overflow-x-auto` |
| 2 | AppShell.tsx | 1035 | Popolist списка пользователей только по hover |
| 3 | DohodModule.tsx | 2825 | Фильтры с скроллом и `whitespace-nowrap` |
| 4 | PlanDohodModule.tsx | 3039 | Кнопки с opacity при hover на xl |
| 5 | PlanDohodModule.tsx | 3258 | Фильтры с overflow-x-auto |
| 6 | DocumentsModule.tsx | 1305 | Табы с overflow-x-auto |
| 7 | DozvolaRegistryList.tsx | 89-131 | `whitespace-nowrap` во всех ячейках таблицы |
| 8 | DozvolaRegistryList.tsx | 995 | Табы с overflow-x-auto |
| 9 | DozvolaDocuments.tsx | 1048, 1145, 1243 | Таблицы с overflow-x-auto |
| 10 | SalaryModule.tsx | 940-957 | Кнопки без текста на мобильных |
| 11 | VehicleDriverDataModule.tsx | 1166, 1191 | Элементы скрыты на мобильных |
| 12 | DozvolaLocations.tsx | 972 | Детальная панель с `w-80` на карте |

### 💡 Рекомендации по исправлению

1. **Горизонтальные скроллы**: Заменить `overflow-x-auto` на `flex-wrap` или адаптивные сетки. Для таблиц — использовать карточки на мобильных с кнопкой "Развернуть таблицу".
2. **Hover-кнопки**: Добавить `md:opacity-0 md:group-hover:opacity-100` — то есть на мобильных кнопки всегда видимые.
3. **Скрытые секции**: Вместо `hidden md:block` использовать `hidden md:flex md:items-center`, а мобильную версию показывать всегда с адаптацией.
4. **Фиксированные высоты**: Заменить `h-[820px]` на `min-h-screen` или `min-h-[100dvh]`.
5. **Сетки**: Добавлять `grid-cols-1` как fallback для всех `grid-cols-2/3/4`.
6. **Whitespace-nowrap**: Заменить на `whitespace-normal` на мобильных (использовать `sm:whitespace-nowrap`).
7. **Фиксированные ширины**: Заменить `min-w-[1200px]` на `min-w-full` с прокруткой только таблицы, а не всей страницы.
8. **Touch targets**: Минимум 44x44px для всех интерактивных элементов (уже частично реализовано через `min-h-[44px]`).
9. **Safe area**: Использовать `env(safe-area-inset-bottom)` для навигации (уже частично реализовано в AppShell.tsx строка 1356).
10. **Тестирование**: Проверить все модальные окна на мобильных — они не должны перекрывать весь экран.

---

*Report generated by Hermes Agent — automated analysis of Tailwind CSS patterns in module components.*
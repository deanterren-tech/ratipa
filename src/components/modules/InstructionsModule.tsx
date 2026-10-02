import { useEffect, useMemo, useState } from 'react';
import {
  Search,
  X,
  ArrowLeft,
  ChevronRight,
  ListChecks,
  Lightbulb,
  Info,
  ExternalLink,
  Wrench,
  ClipboardList,
} from 'lucide-react';
import { AppSettings, Instruction, UserProfile } from '../../types';
import { useHashRoute } from '../../hooks/useHashRoute';

/**
 * Модуль «Инструкции» — подсказки по типовым рабочим задачам.
 *
 * Содержимое берётся из appSettings.instructions (редактируется в базе без правки
 * интерфейса, тот же механизм, что у объявлений и полезных ссылок). Если в базе
 * пусто — показывается набор по умолчанию из этого файла.
 *
 * Модуль только читает и показывает: никаких изменений данных и статусов он не делает.
 */

/** Порядок тем в списке (незнакомые темы добавляются в конец). */
const THEME_ORDER = [
  'Учёт выезда',
  'Учёт дозволов',
  'Авто и водители',
  'Таблицы и планирование',
  'Документы',
  'Общее',
  'Требует уточнения',
];

/**
 * Набор по умолчанию: только подтверждённые в приложении шаги.
 * Совпадает с тем, что записано в appSettings.instructions после первого заполнения.
 */
export const DEFAULT_INSTRUCTIONS: Instruction[] = [
  // ——— Учёт выезда ———
  {
    id: 'baza-add-car',
    theme: 'Учёт выезда',
    title: 'Добавить автомобиль в контроль',
    summary:
      'Когда машина выходит в работу и её нужно поставить на учёт: фиксируются номер, водитель и даты движения по базе.',
    prerequisites: ['Номер автомобиля (обязательно)', 'Фамилия водителя, если уже известна', 'Даты: прибытие на базу, погрузка, ремонт, выезд'],
    steps: [
      'Откройте «Текущее» → «Учёт выезда».',
      'Нажмите «Добавить в контроль».',
      'В группе «Автомобиль и водитель» выберите сцепку или введите номер вручную — номер обязателен, без него форма не отправится и покажет ошибку у поля.',
      'Заполните даты в формате ДД/ММ/ГГГГ. Дату можно выбрать календарём — он открывается по значку справа от поля.',
      'При необходимости добавьте примечание.',
      'Нажмите «Добавить в контроль» — запись появится в таблице и в базе водителей.',
    ],
    tips: [
      'Если нажать отправку с пустым автомобилем, форма останется открытой и подсветит поле — ничего не потеряется.',
      'Даты необязательны: можно сначала завести машину, а даты проставить позже.',
      'Данные водителя подтягиваются из сцепки — если поправить их здесь, запись появится и в базе водителей.',
    ],
    links: [{ label: 'Учёт выезда', module: 'baza' }],
  },
  {
    id: 'baza-edit-card',
    theme: 'Учёт выезда',
    title: 'Изменить запись: даты, комментарий, статус',
    summary:
      'Когда по машине изменились данные — приехала, ушла на ремонт, выехала, нужен комментарий по состоянию.',
    prerequisites: ['Право на изменение раздела «Учёт выезда»', 'Право на конкретное поле — часть полей может быть доступна только для чтения'],
    steps: [
      'Откройте «Текущее» → «Учёт выезда».',
      'Найдите машину: на настольном экране это таблица, на телефоне — карточки. Клик по записи открывает карточку редактирования.',
      'Измените нужные поля. Недоступные для вашей роли поля остаются заблокированными.',
      'Нажмите «Сохранить» — изменения уйдут в базу, а по каждому изменённому полю появится запись в истории.',
    ],
    tips: [
      'Сохраняются только те поля, которые вы действительно правили.',
      'Если поле заблокировано, изменить его через сохранение нельзя — обратитесь к тому, у кого есть право на этот раздел.',
    ],
    links: [{ label: 'Учёт выезда', module: 'baza' }],
  },
  {
    id: 'baza-archive',
    theme: 'Учёт выезда',
    title: 'Убрать машину из работы: «Выехал в рейс» и архив',
    summary: 'Когда машина больше не стоит на базе и её нужно убрать из текущего списка.',
    prerequisites: ['Право на изменение раздела', 'Роль не «Механик» — у неё эта операция недоступна'],
    steps: [
      'Откройте карточку машины в «Учёте выезда».',
      'В карточке нажмите «Выехал в рейс» — запись уйдёт из текущего списка в архив.',
      'Архив открывается на вкладке «Архив» в разделе «Учёт выезда».',
    ],
    tips: [
      'Удалять записи из архива может только администратор — это защита от потери истории.',
      'Механик не может ни переносить записи в архив, ни удалять их.',
    ],
    links: [{ label: 'Учёт выезда', module: 'baza' }],
  },
  // ——— Учёт дозволов ———
  {
    id: 'dozvola-return',
    theme: 'Учёт дозволов',
    title: 'Вернуть бланк из рейса и указать очередь сдачи',
    summary:
      'Когда бланк отработал рейс и вернулся: его нужно перевести в «Использован» и указать, какая это сдача — от этого зависит реестр возврата.',
    prerequisites: ['Право на изменение в «Учёте дозволов»', 'Номер бланка или машина, за которой он закреплён'],
    steps: [
      'Откройте «Текущее» → «Учёт дозволов» → вкладку «Реестр».',
      'Найдите строку бланка (поможет поиск по бланку, машине или комментарию).',
      'В строке выберите в списке действий «Использован».',
      'Подтвердите переход статуса.',
      'В окне «Какая это сдача?» выберите «Сдача 1» или «Сдача 2».',
    ],
    tips: [
      'Отмена и Escape закрывают выбор, бланк остаётся в прежнем статусе — случайно ничего не изменится.',
      'В строке реестра видно, какая очередь у бланка: «Использован (Сдача 1)» или «(Сдача 2)».',
      'Действие попадёт в журнал операций: «Статус: [В офисе] → [Использован (Сдача 1)]».',
    ],
    links: [{ label: 'Учёт дозволов', module: 'dozvola' }],
  },
  {
    id: 'dozvola-writeoff',
    theme: 'Учёт дозволов',
    title: 'Списать использованные бланки в архив ТИ',
    summary: 'Когда бланки сданы в транспортную инспекцию, их переводят в архивный статус.',
    prerequisites: ['Бланки в статусе «Сдан в офис» (после возврата из рейса)', 'Право на изменение в «Учёте дозволов»'],
    steps: [
      'Откройте «Учёт дозволов» → «Документы».',
      'Выберите «Реестр возврата разрешений» — в него попадают бланки со статусом «Сдан в офис».',
      'Отметьте бланки, которые сдаются в инспекцию.',
      'Нажмите «Списать (Сданы в инспекцию ТИ)».',
    ],
    tips: [
      'Бланки переходят в статус «Сдан в ТИ» и уходят в архив.',
      'Очередь сдачи при списании сдвигается: «Сдача 2» становится «Сдачей 1».',
      'Китайские копии (CHN 2, CHN 3) отмечаются отдельной галочкой — «копия сдана».',
    ],
    links: [
      { label: 'Учёт дозволов', module: 'dozvola' },
      { label: 'Документы', module: 'documents' },
    ],
  },
  {
    id: 'dozvola-status-change',
    theme: 'Учёт дозволов',
    title: 'Сменить статус бланка: в офис, в рейс, аннулировать',
    summary: 'Когда бланк меняет состояние: выдаётся в рейс, возвращается в офис или списывается как испорченный.',
    prerequisites: ['Право на изменение в «Учёте дозволов»', 'Найденная строка бланка в реестре'],
    steps: [
      'Откройте «Учёт дозволов» → «Реестр» и найдите бланк.',
      'В списке действий строки выберите нужное: «В офис», «Выдать в рейс», «Использован», «Сдан в ТИ» или «Аннулировать».',
      'Подтвердите переход в окне подтверждения.',
    ],
    tips: [
      '«Аннулировать», «Сдан в ТИ» и «Утерян» — необратимые: окно прямо предупреждает, что вернуть бланк обычным действием не получится.',
      '«В офис» проставляет локацию «Минск офис» и убирает машину из записи.',
      'Для «Использован» после подтверждения появится выбор очереди сдачи — см. отдельную инструкцию.',
    ],
    links: [{ label: 'Учёт дозволов', module: 'dozvola' }],
  },
  {
    id: 'dozvola-bulk-status',
    theme: 'Учёт дозволов',
    title: 'Сменить статус сразу у нескольких бланков',
    summary: 'Когда одну операцию нужно сделать по списку бланков, а не по одному.',
    prerequisites: ['Право на изменение в «Учёте дозволов»', 'Отмеченные бланки в реестре'],
    steps: [
      'Откройте реестр и отметьте нужные бланки галочками.',
      'Выберите массовое действие и целевой статус.',
      'Проверьте количество в окне подтверждения и подтвердите.',
    ],
    tips: [
      'Бланки, уже находящиеся в этом статусе, пропускаются — повторной записи не будет.',
      'В результате видно, сколько записей изменено и сколько пропущено.',
    ],
    links: [{ label: 'Учёт дозволов', module: 'dozvola' }],
  },
  // ——— Авто и водители ———
  {
    id: 'vehicles-view-mode',
    theme: 'Авто и водители',
    title: 'Переключить вид списка авто и водителей',
    summary: 'Когда записей много и удобнее другой способ показа: сетка, широкие карточки или компактные строки.',
    prerequisites: ['Доступ к разделу «Авто и водители»'],
    steps: [
      'Откройте «Текущее» → «Авто и водители».',
      'В панели над списком, справа от заголовка, найдите переключатель вида.',
      'Выберите: сетка из четырёх колонок, широкие карточки или компактный список.',
    ],
    tips: [
      'Выбранный вид запоминается в вашей учётной записи и восстанавливается при следующем входе.',
      'Компактный список показывает записи строками — на большом списке он в разы плотнее карточек.',
      'Редактирование записи остаётся отдельным действием в карточке или строке.',
    ],
    links: [{ label: 'Авто и водители', module: 'vehicleDriverData' }],
  },
  {
    id: 'vehicles-dispatcher',
    theme: 'Авто и водители',
    title: 'Назначить или сменить диспетчера',
    summary: 'Когда машину или водителя нужно закрепить за другим диспетчером.',
    prerequisites: ['Право на изменение в разделе', 'Выбранный диспетчер'],
    steps: [
      'Откройте «Авто и водители» и найдите запись.',
      'В карточке записи выберите диспетчера в соответствующем поле.',
      'Сохраните запись.',
    ],
    tips: [
      'Список диспетчеров собирается из справочника и учётных записей с признаком диспетчера.',
      'Если одному имени соответствует несколько учётных записей, запись не меняется автоматически — такие случаи проверяются вручную.',
    ],
    links: [{ label: 'Авто и водители', module: 'vehicleDriverData' }],
  },
  // ——— Таблицы и планирование ———
  {
    id: 'sheets-collapse',
    theme: 'Таблицы и планирование',
    title: 'Свернуть панель модуля, чтобы таблица стала больше',
    summary: 'Когда нужно больше места для самой таблицы: панель с названием и кнопками можно убрать.',
    prerequisites: [],
    steps: [
      'Откройте любой модуль с таблицей: «Диспозиция», «Текущее планирование», «План загрузок», «Табель», «Книга выдачи» или «Журнал МДП».',
      'В панели над таблицей нажмите кнопку сворачивания (стрелка вверх в правом краю панели).',
      'Панель уберётся, а вместо неё в правом верхнем углу останется кнопка с названием модуля.',
      'Нажмите эту кнопку, чтобы вернуть панель на место.',
    ],
    tips: [
      'Таблица при сворачивании не перезагружается: прокрутка, масштаб и открытая вкладка сохраняются.',
      'Панель лежит поверх верхней части таблицы — так сама таблица занимает почти всю высоту экрана.',
    ],
  },
  {
    id: 'sheets-zoom',
    theme: 'Таблицы и планирование',
    title: 'Изменить масштаб таблицы',
    summary: 'Когда содержимое таблицы мелкое или, наоборот, не помещается на экран.',
    prerequisites: [],
    steps: [
      'В панели модуля нажмите «+» для увеличения или «−» для уменьшения масштаба.',
      'Чтобы вернуть обычный вид, нажимайте «−», пока масштаб не станет 100%.',
    ],
    tips: ['Выбранный масштаб запоминается отдельно для каждого пользователя и каждого модуля.'],
  },
  {
    id: 'sheets-gps',
    theme: 'Таблицы и планирование',
    title: 'Открыть GPS-блокнот',
    summary: 'Когда нужно посмотреть машины в системах мониторинга, не уходя из модуля.',
    prerequisites: ['Раздел с включённым GPS-блокнотом (Диспозиция и др.)'],
    steps: [
      'В панели модуля нажмите кнопку со спутником.',
      'В блокноте переключайтесь между системами: «Белтранс», «Wialon», «ГЛОНАСС».',
      'Перетаскивайте окно за заголовок, меняйте размер за края и угол.',
      'Свернуть окно — кнопка «вниз», закрыть — крестик.',
    ],
    tips: ['Положение и размер окна запоминаются для вашей учётной записи.'],
  },
  // ——— Документы ———
  {
    id: 'documents-pdf',
    theme: 'Документы',
    title: 'Сформировать PDF или печатную форму документа',
    summary: 'Когда нужен готовый файл по разрешениям или реестру.',
    prerequisites: ['Данные для документа: бланки, водители, реестр — в зависимости от типа документа'],
    steps: [
      'Откройте «Учёт дозволов» → «Документы».',
      'Выберите тип документа.',
      'Отметьте данные, которые должны попасть в документ.',
      'Нажмите формирование — файл скачается, текст в PDF остаётся текстовым (его можно выделить и найти поиском).',
    ],
    tips: ['Сформированные документы отмечаются в списке — видно, что уже готово, а что нет.'],
    links: [{ label: 'Документы', module: 'documents' }],
  },
  // ——— Общее ———
  {
    id: 'account-photo',
    theme: 'Общее',
    title: 'Добавить фотографию профиля',
    summary: 'Чтобы в списках и шапке было видно лицо, а не буквы имени.',
    prerequisites: ['Файл фотографии на устройстве'],
    steps: [
      'Откройте меню пользователя в правом верхнем углу.',
      'Выберите «Настройки учётной записи».',
      'В блоке фотографии загрузите снимок.',
      'Кадрируйте его: выберите нужный участок и масштаб.',
      'Сохраните — фотография появится в шапке и списках.',
    ],
    tips: ['Кадрирование открывается сразу после выбора файла; сохраняется квадратный снимок до 512×512.', 'В том же окне есть кнопка удаления фотографии.'],
  },
  {
    id: 'account-accent',
    theme: 'Общее',
    title: 'Сменить акцентный цвет интерфейса',
    summary: 'Если привычнее другой цвет кнопок и активных элементов.',
    prerequisites: [],
    steps: [
      'Откройте меню пользователя → «Настройки учётной записи».',
      'В блоке акцентных цветов выберите образец.',
      'Закройте окно — цвет применится сразу ко всему интерфейсу.',
    ],
    tips: ['Выбор сохраняется в вашей учётной записи: на другом устройстве будет тот же цвет.'],
  },
  {
    id: 'whats-new',
    theme: 'Общее',
    title: 'Посмотреть, что нового в приложении',
    summary: 'Когда нужно вспомнить, какие возможности появились и где они находятся.',
    prerequisites: [],
    steps: [
      'Откройте меню пользователя.',
      'Выберите «Что нового».',
      'Переключайте шаги кнопками «Назад» и «Далее» или стрелками клавиатуры, нужный элемент интерфейса подсвечивается.',
      'Закройте окно кнопкой «Готово» или «Пропустить».',
    ],
    tips: [
      'Превью показывается один раз — при первом входе после обновления, и больше само не всплывает.',
      'Открыть его повторно можно в любой момент из меню пользователя.',
    ],
  },
  {
    id: 'links-all',
    theme: 'Общее',
    title: 'Найти полезную ссылку',
    summary: 'Когда нужен внешний сервис или таблица, но не помнишь, где он лежит.',
    prerequisites: [],
    steps: [
      'Откройте «Главную».',
      'Найдите блок «Полезные ссылки» — там видны первые ссылки.',
      'Нажмите «Все ссылки», чтобы открыть полный список.',
      'Введите слово в поиск — список отфильтруется по названию и описанию.',
    ],
    tips: ['Ссылки открываются в новой вкладке — текущая работа не сбивается.'],
    links: [{ label: 'Главная', module: 'dashboard' }],
  },
  {
    id: 'admin-access',
    theme: 'Общее',
    title: 'Выдать или отозвать доступ пользователю',
    summary: 'Администратору: когда нужно открыть или закрыть человеку доступ к разделу.',
    prerequisites: ['Роль администратора', 'Учётная запись пользователя в списке сотрудников'],
    steps: [
      'Откройте «Администрирование» → блок «Доступ и учётные записи».',
      'Найдите сотрудника поиском по списку.',
      'Откройте карточку сотрудника.',
      'В блоке прав найдите нужный раздел и выберите «Нет», «Чтение» или «Полный».',
      'Сохраните изменения.',
    ],
    tips: [
      'Права применяются сразу: пользователю не нужно выходить и заходить снова — раздел появится или исчезнет у него в открытом сеансе.',
      'Роль администратора даёт полный доступ ко всем разделам — отдельные права ей не нужны.',
      'Если закрыть раздел, у пользователя пропадёт и доступ к нему, и операции внутри него — скрытие кнопки ничего не обходит.',
    ],
    links: [{ label: 'Администрирование', module: 'admin' }],
  },
  // ——— Требует уточнения ———
  {
    id: 'salary-accrual',
    theme: 'Требует уточнения',
    title: 'Зарплата водителей: порядок начисления',
    summary: 'Когда нужно рассчитать и зафиксировать выплату водителю за период.',
    prerequisites: ['Проверенные данные по рейсам за период'],
    steps: ['Содержание требует уточнения: порядок начисления и условия пока не описаны.'],
    tips: ['Инструкция заполняется после уточнения процесса — до этого шаги не описываем, чтобы не придумывать правила.'],
    needsWork: true,
    links: [{ label: 'Зарплата Водителей', module: 'salary' }],
  },
  {
    id: 'plan-dohod',
    theme: 'Требует уточнения',
    title: 'План дохода: заполнение на период',
    summary: 'Когда формируется план доходов на период по машинам или направлениям.',
    prerequisites: ['Данные о машинах и направлениях'],
    steps: ['Содержание требует уточнения: поля и порядок заполнения нужно подтвердить.'],
    tips: ['Уточните у ответственного, какие поля обязательны и откуда берутся ставки.'],
    needsWork: true,
    links: [{ label: 'План Дохода', module: 'planDohod' }],
  },
  {
    id: 'dozvola-quotas',
    theme: 'Требует уточнения',
    title: 'Учёт дозволов: квоты и лимиты',
    summary: 'Когда нужно проверить или настроить квартальные квоты по видам разрешений.',
    prerequisites: ['Право на изменение в «Учёте дозволов»'],
    steps: ['Содержание требует уточнения: правила расчёта квот и порядок их корректировки нужно подтвердить.'],
    tips: ['Блок «Квоты и лимиты» открывается из раздела «Учёт дозволов».'],
    needsWork: true,
    links: [{ label: 'Учёт дозволов', module: 'dozvola' }],
  },
];

/** Нормализует текст для поиска: регистр и лишние пробелы не важны. */
const norm = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Складывает всё содержимое инструкции в одну строку — по ней ищем. */
function searchBlob(i: Instruction): string {
  return norm([
    i.title,
    i.summary,
    i.theme,
    ...(i.prerequisites || []),
    ...(i.steps || []),
    ...(i.tips || []),
  ].join(' \n '));
}

interface Props {
  user: UserProfile;
  settings?: AppSettings | null;
}

export default function InstructionsModule({ user, settings }: Props) {
  const [query, setQuery] = useState('');
  const [theme, setTheme] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const { route, navigate } = useHashRoute({ module: 'instructions' });

  // Открытая инструкция берётся из адреса (#instructions/<id>): работают «Назад»
  // браузера и прямая ссылка на инструкцию.
  useEffect(() => {
    const fromRoute = route.tab ? decodeURIComponent(route.tab) : null;
    setOpenId(fromRoute);
  }, [route.tab]);

  const instructions: Instruction[] = useMemo(() => {
    const fromDb = settings?.instructions;
    const list = Array.isArray(fromDb) && fromDb.length > 0 ? fromDb : DEFAULT_INSTRUCTIONS;
    return list.filter((i) => i && i.id && i.title);
  }, [settings?.instructions]);

  const themes = useMemo(() => {
    const seen = new Set<string>();
    instructions.forEach((i) => seen.add(i.theme || 'Прочее'));
    const known = THEME_ORDER.filter((t) => seen.has(t));
    const extra = [...seen].filter((t) => !THEME_ORDER.includes(t)).sort((a, b) => a.localeCompare(b, 'ru'));
    return [...known, ...extra];
  }, [instructions]);

  const found = useMemo(() => {
    const q = norm(query);
    return instructions.filter((i) => {
      if (theme !== 'all' && (i.theme || 'Прочее') !== theme) return false;
      if (!q) return true;
      return searchBlob(i).includes(q);
    });
  }, [instructions, query, theme]);

  const grouped = useMemo(() => {
    return themes
      .map((t) => ({ theme: t, items: found.filter((i) => (i.theme || 'Прочее') === t) }))
      .filter((g) => g.items.length > 0);
  }, [found, themes]);

  const open = openId ? instructions.find((i) => i.id === openId) || null : null;

  const goTo = (moduleKey: string) => {
    window.location.hash = moduleKey;
  };

  // ——— Подробная инструкция ———
  if (open) {
    return (
      <div className="flex h-full min-h-0 w-full flex-col">
        <div className="px-4 pt-5 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(null)}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            К списку инструкций
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-2 sm:px-6">
          <div className="mx-auto w-full max-w-3xl">
            <span className="inline-block rounded-full bg-[#F3F4F6] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-[#4B5563]">
              {open.theme || 'Прочее'}
            </span>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#121316] sm:text-3xl">{open.title}</h1>
            <p className="mt-2 text-sm leading-relaxed text-[#4B5563]">{open.summary}</p>

            {open.needsWork && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
                <p className="text-xs leading-relaxed text-amber-900">
                  Содержание требует уточнения: шаги не описаны, чтобы не придумывать правила. Дополним, когда процесс
                  подтвердят.
                </p>
              </div>
            )}

            {!!open.prerequisites?.length && (
              <section className="mt-6">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                  <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
                  Что понадобится
                </h2>
                <ul className="mt-2 space-y-1.5 rounded-2xl border border-[#E5E7EB] bg-white p-4">
                  {open.prerequisites.map((p, idx) => (
                    <li key={idx} className="flex items-start gap-2 text-sm leading-relaxed text-[#121316]">
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#9CA3AF]" aria-hidden="true" />
                      {p}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <section className="mt-6">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                Порядок действий
              </h2>
              <ol className="mt-2 space-y-2.5 rounded-2xl border border-[#E5E7EB] bg-white p-4">
                {open.steps.map((s, idx) => (
                  <li key={idx} className="flex items-start gap-3 text-sm leading-relaxed text-[#121316]">
                    <span className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--accent-15)] text-[11px] font-semibold text-[var(--accent-ink)]">
                      {idx + 1}
                    </span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            </section>

            {!!open.tips?.length && (
              <section className="mt-6">
                <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                  <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
                  Подсказки и частые ошибки
                </h2>
                <ul className="mt-2 space-y-2 rounded-2xl border border-[#E5E7EB] bg-white p-4">
                  {open.tips.map((t, idx) => (
                    <li key={idx} className="flex items-start gap-2.5 text-sm leading-relaxed text-[#4B5563]">
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#9CA3AF]" aria-hidden="true" />
                      {t}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {!!open.links?.length && (
              <section className="mt-6">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#6B7280]">Где это в приложении</h2>
                <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
                  {open.links.map((l) => (
                    <button
                      key={l.module}
                      type="button"
                      onClick={() => goTo(l.module)}
                      className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--accent-solid)] px-4 text-xs font-semibold text-[var(--accent-on)] transition-colors hover:bg-[var(--accent-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-30)]"
                    >
                      {l.label}
                      <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <p className="mt-6 text-[11px] leading-relaxed text-[#9CA3AF]">
              Инструкция только подсказывает порядок работы и ничего не меняет в данных и статусах.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ——— Список инструкций ———
  return (
    <div className="flex h-full min-h-0 w-full flex-col">
      <div className="px-4 pt-5 sm:px-6">
        <h1 className="text-2xl font-semibold tracking-tight text-[#121316] sm:text-3xl">Инструкции</h1>
        <p className="mt-1.5 text-xs leading-relaxed text-[#6B7280] sm:text-sm">
          Подсказки по типовым задачам: что нужно сделать, в каком порядке и где это в приложении.
        </p>

        {/* Поиск */}
        <div className="relative mt-4 max-w-2xl">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9CA3AF]" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Поиск по названию и содержанию: дозвол, сдача, таблица, фото…"
            aria-label="Поиск по инструкциям"
            className="w-full rounded-xl border border-[#E5E7EB] bg-white py-2.5 pl-9 pr-9 text-xs text-[#121316] transition focus:border-[var(--accent-ui)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-30)]"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
              title="Очистить поиск"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg p-1 text-[#9CA3AF] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Темы */}
        <div className="mt-3 flex w-fit max-w-full items-center gap-1.5 overflow-x-auto rounded-xl bg-[#F3F4F6]/75 p-1 scrollbar-none">
          <button
            type="button"
            onClick={() => setTheme('all')}
            className={`min-h-[44px] cursor-pointer rounded-lg px-4 py-2 text-xs font-semibold transition ${
              theme === 'all' ? 'bg-[#121316] text-white' : 'text-[#4B5563] hover:text-[#121316]'
            }`}
          >
            Все ({instructions.length})
          </button>
          {themes.map((t) => {
            const n = instructions.filter((i) => (i.theme || 'Прочее') === t).length;
            if (n === 0) return null;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTheme(t)}
                className={`min-h-[44px] cursor-pointer whitespace-nowrap rounded-lg px-4 py-2 text-xs font-semibold transition ${
                  theme === t ? 'bg-[#121316] text-white' : 'text-[#4B5563] hover:text-[#121316]'
                }`}
              >
                {t} ({n})
              </button>
            );
          })}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          {grouped.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-[#E5E7EB] bg-white px-6 py-10 text-center">
              <Search className="h-5 w-5 text-[#9CA3AF]" aria-hidden="true" />
              <p className="text-sm font-semibold text-[#121316]">Ничего не найдено</p>
              <p className="text-xs text-[#6B7280]">
                Попробуйте другое слово или сбросьте фильтр по теме.
              </p>
              <button
                type="button"
                onClick={() => { setQuery(''); setTheme('all'); }}
                className="mt-1 inline-flex min-h-[44px] items-center rounded-xl px-4 text-xs font-medium text-[#4B5563] transition-colors hover:bg-[#F3F4F6] hover:text-[#121316]"
              >
                Показать все инструкции
              </button>
            </div>
          )}

          {grouped.map((group) => (
            <section key={group.theme} className="mb-6">
              <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#6B7280]">
                {group.theme}
                <span className="rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10px] font-medium text-[#4B5563]">
                  {group.items.length}
                </span>
              </h2>
              <div className="mt-2 flex flex-col gap-2">
                {group.items.map((i) => (
                  <button
                    key={i.id}
                    type="button"
                    onClick={() => navigate(encodeURIComponent(i.id))}
                    className="group flex w-full items-start gap-3 rounded-2xl border border-[#E5E7EB] bg-white p-4 text-left transition-colors hover:border-[#D1D5DB] hover:bg-[#F9FAFB] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-20)]"
                  >
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#F3F4F6] text-[#4B5563]">
                      <ClipboardList className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold text-[#121316]">{i.title}</span>
                        {i.needsWork && (
                          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                            требует уточнения
                          </span>
                        )}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-[#6B7280]">{i.summary}</span>
                      <span className="mt-1.5 block text-[11px] text-[#9CA3AF]">
                        {i.steps.length > 1 ? `Шагов: ${i.steps.length}` : 'Шаги не описаны'}
                        {i.links?.length ? ` · раздел: ${i.links.map((l) => l.label).join(', ')}` : ''}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-[#9CA3AF] transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                  </button>
                ))}
              </div>
            </section>
          ))}

          <p className="mt-2 pb-6 text-[11px] leading-relaxed text-[#9CA3AF]">
            Инструкции описывают только подтверждённые шаги. Задачи, где порядок ещё не согласован, отмечены как
            «требует уточнения» — их содержание дополняется после проверки процесса.
          </p>
        </div>
      </div>
    </div>
  );
}

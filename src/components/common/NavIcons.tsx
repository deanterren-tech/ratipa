/**
 * Иконки мобильной нижней навигации — тот же заливной набор, что и в хабе
 * «Ещё» (см. HubIcons.tsx): жирные глифы со скруглениями и ПРОЗРАЧНЫМИ
 * вырезами (fillRule="evenodd") — одинаково корректно смотрятся и на тёмной
 * активной капсуле, и на светлой панели навигации. Цвет — currentColor
 * от класса кнопки (белый на активной капсуле, серый в покое).
 *
 * Соответствие: Главная → домик, Загрузки → сумка, Карта → пин локации,
 * Выезд → бейдж со стрелкой, Ещё → сетка 2×2. Один источник глифов —
 * HubIcons.tsx, чтобы навигация и хаб не расходились по стилю.
 */
export {
  HubHomeIcon as NavHomeIcon,
  HubBagIcon as NavLoadsIcon,
  HubPinIcon as NavCompassIcon,
  HubExitIcon as NavExitIcon,
  HubGridIcon as NavGridIcon,
} from './HubIcons';

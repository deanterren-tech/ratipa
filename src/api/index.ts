// Единый слой доступа к данным (Data Access Layer).
// Все блоки/модули обращаются к БД ТОЛЬКО через этот модуль,
// а не напрямую к firebase.ts. Это убирает размазанное взаимодействие
// с RTDB по компонентам и даёт единую точку для новой логики и API.
//
// Пока слой проксирует существующие сервисы (dbService/directoryService/pdService).
// Дальше здесь выстраиваем доменные функции (api/routes.ts, api/users.ts, ...)
// и поднимаем их как REST-endpoint'ы в server.ts (см. этап 2 плана).

export {
  dbService,
  directoryService,
  database,
  useFirebase,
  ensureAuth,
  onValue,
  onceValue,
} from '../firebase';
export { pdService } from '../firebase/planDohodService';

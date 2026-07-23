# RATIPA Agent API — полная карта действий портала

Цель: сделать ВСЕ функции/действия портала доступными ботам через
`api/agent.ts` (serverless на ratipa-mduc), чтобы любого нового бота
можно было собрать как набор "агентов", каждый из которых дёргает
нужный `action`. Координатор (LLM) роутит free-text → tool-calling.

## Архитектурное правило (выяснено опытным путём)

Vercel при сборке serverless-функции ВЫБРАСЫВАЕТ роут, если в его
handler'е >1 чтение из Firebase (несколько `readData`/`get()`).
Поэтому:

- GET-роуты = справочники/чтения. Каждый делает РОВНО 1 `readData(path)`
  (собирается нормально). Бот берёт из них данные, нужные для действия.
- POST-роуты = действия. Делают ТОЛЬКО запись (writeData/pushData/
  updateData). Несколько writes в одном handler'е — ок. Чтение БД в
  handler'е действия ЗАПРЕЩЕНО (лимит Vercel). Все нужные данные
  (rate, driver, dispatcher, id'шники) бот передаёт в теле запроса,
  предварительно получив их через GET-роуты.

Шаблон `closeTrip` (бот читает справочник → шлёт action с готовыми
полями) масштабируется на ВСЕ действия портала.

## Статус реализации

- [x] `closeTrip` (POST) — закрытие рейса + архив planDohod
- [x] `getCoupling` (GET) — vehicle_driver_data (rate, carId, driver, dispatcher)
- [x] `getPlanDohod` (GET) — planDohod
- [x] `getVehicleFleet` (GET) — уже было
- [ ] остальное — см. ниже

## Полная карта (источник: src/firebase.ts → dbService + прямые записи в модулях)

### Справочники / чтения (GET, по 1 read каждый)
| action | path в БД | что возвращает |
|--------|-----------|----------------|
| getVehicleFleet | vehicleFleet | парк (coupling) |
| getCoupling | vehicle_driver_data | база сцепок (rate, driver, dispatcher) |
| getDrivers | driversPool | водители |
| getPlanDohod | planDohod | план дохода |
| getTrips | trips_dashboard | рейсы |
| getSalaryHistory | salaryHistory | история зарплаты |
| getDozvolaRegistry | dozvolsRegistryV4 | реестр дозволов |
| getDozvolaTypes | dozvolsTypesV4 + dozvolsTypesOrderV4 | типы дозволов |
| getDozvolaTodo | dozvolsTodoTasksV4 | задачи по дозволам |
| getLocations | locationsDB + locationsDeliveries | локации/доставки |
| getDirectories | directories/* (shared) | справочники (бренды, диспетчеры, группы ставок, статусы, направления) |
| getSettings | appSettings | настройки (idleRate, perDiemRate, ...) |
| getBaza | baza + baza_cars + archive + archivecars + known_fleet | база/архив |
| getDocs | ferryCouples + ferryContacts + ferryOrdersData + bamapTirLastData | документы/паромы |
| getAnalysis | analysisRegions + analysisGroups + analysisRecords | аналитика |
| getUsers | users_list | пользователи (admin) |
| getAuditLogs | agent_access_center/* + audit | логи/аудит |
| getRouteCalcs | routeCalculations | расчёты маршрутов |
| getTemplates | ferryTemplates/routeTemplates/distances/currencies/carRateGroups/directions | шаблоны/пресеты |

### Действия (POST, write-only)
| action | что делает | источник в портале |
|--------|-----------|-------------------|
| saveVehicle | создать/обновить машину (coupling) | dbService.saveVehicle |
| archiveVehicle | в архив | dbService.archiveVehicle |
| restoreVehicle | из архива | dbService.restoreVehicle |
| deleteVehicle | удалить | (BazaModule прямая запись) |
| saveDriver | создать/обновить водителя | dbService.saveDriver |
| deleteDriver | удалить водителя | dbService.deleteDriver |
| saveCoupling | создать/обновить сцепку (vehicle_driver_data) | dbService.saveVehicleDriverRecord |
| deleteCoupling | удалить сцепку | dbService.deleteVehicleDriverRecord |
| closeTrip | закрыть рейс + архив planDohod | dbService.saveSalary + update planDohod |
| saveSalary | запись зарплаты | dbService.saveSalary |
| updateSalary | правка зарплаты | dbService.updateSalary |
| deleteSalary | удалить зарплату | dbService.deleteSalary |
| saveTrip | создать/обновить рейс | dbService.saveTrip |
| deleteTrip | удалить рейс | dbService.deleteTrip |
| savePermit | создать/обновить дозвол | dbService.savePermit |
| deletePermit | удалить дозвол | dbService.deletePermit |
| issueDozvola | выпустить дозвол (registry V4) | DozvolaRegistryList/Scanner |
| updateDozvola | правка дозвола | DozvolaRegistryList |
| deleteDozvola | удалить дозвол | DozvolaRegistryList |
| saveDozvolaType | тип дозвола | DozvolaTypesDirectory |
| deleteDozvolaType | удалить тип | DozvolaTypesDirectory |
| saveLocation | локация/доставка | DozvolaLocations |
| deleteLocation | удалить локацию | DozvolaLocations |
| saveDirItem | элемент справочника | directoryService.saveDirItem |
| deleteDirItem | удалить из справочника | directoryService.deleteDirItem |
| sendBroadcast | широковещательное уведомление | dbService.sendBroadcastNotification |
| markBroadcastRead | отметить прочитанным | dbService.markBroadcastNotificationAsRead |
| saveSettings | настройки | dbService.saveSettings |
| saveRouteCalc | расчёт маршрута | dbService.saveRouteCalculation |
| deleteRouteCalc | удалить расчёт | dbService.deleteRouteCalculation |
| saveTemplate | шаблон (ferry/route/distance/currency/rateGroup/direction) | dbService.save* |
| deleteTemplate | удалить шаблон | dbService.delete* |
| logInsurance | лог страховки | (insurance module) |
| createDeclaration | создать декларацию | (LossDeclarationEditor / declaration) |
| setVehicleStatus | статус машины (base/trip) | dbService.setVehicleStatus |
| bulkUpdateCouplings | массовая правка сцепок | dbService.bulkUpdateCouplings |
| saveUser | пользователь (admin) | dbService.saveUser |
| deleteUser | удалить пользователя | dbService.deleteUser |
| saveChatMessage | сообщение чата | dbService.sendChatMessage |
| setKnownFleet | добавить в known_fleet | (SettingsModule / BazaModule) |

## Порядок реализации (группы)

1. Диспетчер (уже есть closeTrip): saveVehicle, saveDriver, saveCoupling,
   saveTrip, saveSalary, getDrivers, getTrips — расширить closeTrip-бота.
2. Дозволы: issueDozvola, updateDozvola, deleteDozvola, saveDozvolaType,
   getDozvolaRegistry, getDozvolaTypes, saveLocation, deleteLocation.
3. Справочники/настройки: saveDirItem, deleteDirItem, saveSettings,
   getDirectories, getSettings.
4. Документы/паромы/аналитика/база/админ: saveTemplate, logInsurance,
   createDeclaration, saveBaza, sendBroadcast, saveUser, и т.д.

## Формат запроса (единый)
POST /api/agent?action=<ACTION>
Headers: x-agent-key: <RATIPA_AGENT_KEY>
Body (JSON): { ...полЯ действия..., "dryRun": false }

Ответ: { "success": true, "data": {...} } или
        { "success": false, "error": "...", "code": "..." }

## Авторизация
Сейчас: один общий x-agent-key для всех ботов (RATIPA_AGENT_KEY).
Для связки ботов достаточно, но при необходимости — per-bot ключи
с разными правами (расширить checkAgentKey).

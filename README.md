# Ratipa Portal

Портал управления перевозками Ratipa: планирование рейсов, таймлайн машин,
контроль выезда, разрешения (дозволы), доходность, зарплаты водителей,
пробег и связь, справочники и документы — в одном рабочем пространстве.

## Стек

- **Клиент:** React 19, Vite 6, Tailwind CSS 4, motion, Leaflet.
- **Сервер:** Express (`server.ts`) — API, геокодинг и маршруты, курсы НБРБ,
  поллер телеметрии Navby, Agent API. В режиме разработки он же отдаёт клиент
  через Vite middleware.
- **Данные и вход:** Firebase Realtime Database и Firebase Auth.
- **ИИ-помощник:** OpenRouter (`server/ai/`).
- **Деплой:** Vercel (`vercel.json`, функции в `api/`).

## Запуск локально

Нужен Node.js 22.

```bash
npm install
npm run dev
```

Приложение откроется на http://localhost:3000 (порт меняется переменной `PORT`).

## Переменные окружения

Задаются в `.env.local` (файл не коммитится).

| Переменная | Для чего |
|---|---|
| `VITE_FIREBASE_*` | Конфигурация Firebase для клиента (API key, auth domain, database URL, project id и т.д.) |
| `FIREBASE_SERVICE_ACCOUNT` или `FIREBASE_SERVICE_ACCOUNT_PATH` | Service account для firebase-admin (Agent API, серверные записи) |
| `OPENROUTER_API_KEY` | Ключ OpenRouter для ИИ-помощника |
| `AGENT_API_KEY` | Ключ доступа к Agent API (см. `AGENT_API_SPEC.md`) |
| `NAVBY_BASE`, `NAVBY_LOGIN`, `NAVBY_PASSWORD` / `NAVBY_TOKEN` | Доступ к телеметрии Navby |
| `NAVBY_POLLER_ENABLED` | Включает фоновый поллер Navby на сервере |
| `MAPBOX_ACCESS_TOKEN` | Построение маршрутов через Mapbox |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | Уведомления об ошибках в Telegram |

## Команды

| Команда | Что делает |
|---|---|
| `npm run dev` | Сервер разработки |
| `npm run build` | Production-сборка клиента и сервера в `dist/` |
| `npm start` | Запуск собранного сервера |
| `npm run typecheck` | Проверка типов и контроль новых `as any` |
| `npm run test:*` | Проверки отдельных модулей (таймлайн, пробег, зарплаты, справочники и др.) |
| `npm run audit:*`, `npm run migrate:*` | Аудиты и миграции данных — работают с живой базой, запускать осознанно |

## Структура

```
src/            клиент: модули портала (src/components/modules), UI-кит, сервисы Firebase
server/         серверные модули: ИИ, Navby, Google Drive
api/            функции Vercel
scripts/        тесты, аудиты и миграции
deploy/         шаблоны launchd/systemd для сборщика Navby
docs/           аудиты и описания модулей
public/         статика: иконки, шрифты, manifest
```

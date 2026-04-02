# Private Messenger Starter (macOS)

Готовый стартовый backend для закрытого мессенджера:
- NestJS
- PostgreSQL
- Prisma
- Socket.IO
- локальные uploads для фото / видео / gif
- закрытая выдача аккаунтов через админский секрет

Сейчас это **рабочее ядро сервера для мака**, которое можно положить в репозиторий и развивать дальше.

## Что уже есть
- логин по выданному аккаунту
- `/auth/login`
- `/auth/me`
- админское создание пользователей
- 1 на 1 чаты
- групповые чаты
- список чатов
- список пользователей
- отправка текстовых сообщений
- загрузка файлов в локальную папку `uploads/`
- WebSocket realtime через Socket.IO
- события typing
- страницы/клиенты можно подключать позже

## Быстрый старт на Mac

### 1) Что должно быть установлено
- **Node.js 20+**
- **Docker Desktop**
- npm

Проверка:
```bash
node -v
npm -v
docker -v
```

### 2) Распакуй проект и открой папку
```bash
cd messenger-starter
```

### 3) Установи зависимости
```bash
npm install
```

### 4) Подними PostgreSQL
```bash
docker compose up -d
```

### 5) Создай `.env`
```bash
cp .env.example .env
```

### 6) Сгенерируй Prisma client и создай таблицы
```bash
npm run prisma:generate
npm run prisma:migrate -- --name init
```

### 7) Создай тестовых пользователей
```bash
npm run create:user -- --email admin@example.com --username admin --password admin123
npm run create:user -- --email max@example.com --username max --password max123
npm run create:user -- --email alice@example.com --username alice --password alice123
```

### 8) Запусти сервер
```bash
npm run start:dev
```

Сервер будет на:
```txt
http://localhost:3000
```

Uploads будут доступны по:
```txt
http://localhost:3000/uploads/...
```

## Как временно открыть сервер наружу с Mac
Для тестов с друзьями можешь временно:
- пробросить порт `3000` на роутере
- или использовать туннель типа ngrok / cloudflared
- или Tailscale/ZeroTier для приватного доступа

Для локальной разработки это не нужно.

## Структура проекта
```txt
src/
  admin/
  attachments/
  auth/
  chats/
  common/
  messages/
  prisma/
  users/
  main.ts

prisma/
  schema.prisma

scripts/
  create-user.ts
```

## Основные REST endpoints

### Auth
- `POST /auth/login`
- `GET /auth/me`

### Admin
- `POST /admin/users` (нужен header `x-admin-secret`)

### Users
- `GET /users`

### Chats
- `POST /chats/direct`
- `POST /chats/group`
- `GET /chats`
- `GET /chats/:chatId/messages`

### Messages
- `POST /messages`

### Attachments
- `POST /attachments/upload`

## Пример логина
```bash
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"max@example.com","password":"max123"}'
```

Ответ:
```json
{
  "accessToken": "JWT_TOKEN",
  "user": {
    "id": "...",
    "email": "max@example.com",
    "username": "max"
  }
}
```

## Пример создать direct chat
```bash
curl -X POST http://localhost:3000/chats/direct \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"otherUserId":"USER_ID"}'
```

## Пример создать группу
```bash
curl -X POST http://localhost:3000/chats/group \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Group","memberIds":["USER_ID_1","USER_ID_2"]}'
```

## Пример отправить текстовое сообщение по HTTP
```bash
curl -X POST http://localhost:3000/messages \
  -H "Authorization: Bearer JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"chatId":"CHAT_ID","text":"Привет","type":"text"}'
```

## Пример загрузки файла
```bash
curl -X POST http://localhost:3000/attachments/upload \
  -H "Authorization: Bearer JWT_TOKEN" \
  -F "file=@/Users/you/Desktop/test.jpg"
```

Ответ вернёт attachment с `id` и `url`.

Потом сообщение можно отправить так:
```json
{
  "chatId": "CHAT_ID",
  "type": "image",
  "attachmentId": "ATTACHMENT_ID"
}
```

## Socket.IO realtime

Подключайся на:
```txt
ws://localhost:3000
```

Передавай токен:
```js
const socket = io("http://localhost:3000", {
  auth: {
    token: "JWT_TOKEN"
  }
});
```

### События от клиента
- `join_chat` -> `{ chatId }`
- `leave_chat` -> `{ chatId }`
- `send_message` -> `{ chatId, text?, type?, attachmentId? }`
- `typing` -> `{ chatId, isTyping }`

### События от сервера
- `ready`
- `message:new`
- `chat:typing`
- `error`

## Admin endpoint
Можно создавать пользователей без скрипта:
```bash
curl -X POST http://localhost:3000/admin/users \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: super_admin_secret" \
  -d '{"email":"bob@example.com","username":"bob","password":"bob123"}'
```

## Что добавить следующим
- mobile app на Expo
- desktop client на Tauri
- delivered/read receipts
- roles в группах
- редактирование/удаление сообщений
- превью фото/видео
- перенос uploads в S3 / Supabase Storage
- push-уведомления

## Если Postgres не стартует
Проверь:
```bash
docker ps
```

Если порт 5432 занят, поменяй `docker-compose.yml` и `.env`.

## Как остановить всё
```bash
docker compose down
```

## Как остановить с удалением БД
```bash
docker compose down -v
```

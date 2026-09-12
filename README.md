# mafia-server

Ігровий сервер «Мафії» на [Colyseus](https://docs.colyseus.io/) — реалізує кімнату `mafia_room` (лобі, запрошення за токеном, розсадка гравців).

## Запуск

```
npm install
npm start        # dev-сервер з hot-reload на ws://localhost:2567
```

## Тести

```
npm test         # mocha + @colyseus/testing (тест boot'ить сервер у процесі)
```

## Структура

- `src/rooms/MafiaRoom.ts` — логіка кімнати: токен запрошення (TTL 6 годин), вхід гравців, хост, `setMaxPlayers`, `shuffle_players`, `startGame`
- `src/rooms/schema/MafiaState.ts` — схема стану (гравці, фаза, налаштування кімнати)
- `src/app.config.ts` — реєстрація кімнати; у dev монтується playground (`/`)
- `test/mafia-room.test.ts` — інтеграційні тести кімнати

## Поведінка входу

- Творець кімнати (перший клієнт) підключається без токена — його `guestId` стає `hostId`.
- Усі наступні клієнти входять за `token` з інвайт-посилання (`/room/{roomId}#token=...`).
- Повторне підключення з тим самим `guestId` відновлює слот гравця.

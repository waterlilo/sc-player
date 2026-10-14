# sc player

Десктопный клиент SoundCloud для Windows: свои лайки, плейлисты и любые публичные профили — без рекламы, в стиле
ночного портфолио [@skythemontage](https://soundcloud.com/skythemontage).

## Установка

1. Открой [Releases](../../releases/latest) и скачай один из файлов:
   - `sc-player-setup-<версия>.exe` — установщик (ярлык на рабочем столе и в меню «Пуск»);
   - `sc-player-portable-<версия>.exe` — запускается без установки.
2. Приложение не подписано сертификатом, поэтому Windows покажет «Windows защитила ваш компьютер».
   Нажми **Подробнее → Выполнить в любом случае**.
3. Нажми **Sign in to SoundCloud** и войди своим аккаунтом (email и пароль) — появятся твои лайки и плейлисты.
   Без входа можно вставить ссылку на любой публичный профиль `https://soundcloud.com/…`.

## Что умеет

- Лайки, плейлисты (свои и лайкнутые), история прослушивания, поиск треков.
- Профили: треки, лайки и плейлисты любого пользователя; профили можно закрепить в сайдбаре.
- Перемотка по вейвформе, очередь с перетаскиванием, shuffle, repeat.
- Каждая страница помнит вкладку, фильтр и прокрутку; разделы сайдбара — как вкладки со своей историей.
- Пока окно скрыто или свёрнуто, анимации не работают совсем: играет только звук.

**Ограничение:** часть треков SoundCloud отдаёт только в зашифрованном виде (DRM, в основном монетизированные
и мейджор-релизы). Такие треки помечены `PROTECTED` и пропускаются в очереди.

## Разработка

Нужен Node.js 22+.

```bash
npm install
npm run dev
```

Если `npm run dev` пишет `Electron uninstall`, npm заблокировал загрузку самого Electron — докачай его:
`node node_modules/electron/install.js`.

| Команда | Что делает |
|---|---|
| `npm run dev` | приложение с горячей перезагрузкой |
| `npm run dev:debug` | то же + DevTools-порт 9223 (только localhost) |
| `SKY_DEMO=1 npm run dev` | выдуманные данные вместо SoundCloud — для работы над интерфейсом |
| `npm run lint` / `npm run build` | проверка и сборка |
| `npm run dist` | установщик и portable `.exe` в `dist/` |
| `npm run icon` | перерисовать иконку из `assets/icon.svg` |

## Где что лежит

```
src/
  shared/          типы, интерфейс MusicProvider, контракт IPC main ↔ renderer
  main/            процесс Electron: окно, IPC, хранилище, вход
    soundcloud/    ВСЯ работа с SoundCloud (api-v2): client_id, HTTP с кэшем и паузой на 429,
                   разбор ответов, выбор стрима, вход через страницу SoundCloud
    store/         settings.json и зашифрованные секреты (safeStorage)
    demo.ts        выдуманные данные для SKY_DEMO=1
  preload/         типизированный мост window.sky
  renderer/src/    интерфейс (React): screens/, components/, state/ (zustand), audio/ (hls.js), styles/
assets/            шрифты, текстуры, луна, иконка — из портфолио
```

Данные приложения (настройки, вход) лежат в `%APPDATA%\sc player`.

## Если SoundCloud что-то поменял

Приложение пользуется тем же внутренним API, что и сайт soundcloud.com (`api-v2.soundcloud.com`), — он
неофициальный и иногда меняется. Тогда в приложении появится сообщение «SoundCloud changed something…» с кнопкой
Retry, а не падение.

1. **Ничего не грузится, ошибка 401/403.** Скорее всего, сменился `client_id` сайта. Приложение находит новый само
   (раз в несколько дней и при отказе); если не выходит — удали `clientId` из `%APPDATA%\sc player\settings.json`
   и перезапусти. Поиск id — `src/main/soundcloud/client-id.ts`.
2. **Треки перестали играть.** Запусти `SKY_DEBUG_STREAMS=1 npm run dev` — в консоли будет видно, какие форматы
   стримов SoundCloud отдаёт для каждого трека. Выбор формата — `src/main/soundcloud/stream.ts`, какие считаются
   играбельными — `isPlayable` в `mappers.ts`.
3. **Пропали поля (названия, обложки, вейвформы).** Разбор ответов — `src/main/soundcloud/mappers.ts`, адреса
   запросов — `web-session-provider.ts`. Всё, что касается SoundCloud, лежит только в `src/main/soundcloud/`.
4. **Не входит в аккаунт.** Окно входа — `session-auth.ts`: токен берётся из cookie `oauth_token` или из заголовка
   запросов сайта к api-v2.

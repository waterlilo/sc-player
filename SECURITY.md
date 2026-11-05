# Security

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.
Report it privately: open the repository's **Security** tab → **Report a vulnerability**.

Please include:

- what you found and where (a file, an endpoint, a version);
- how to reproduce it, step by step;
- what it lets someone do;
- a fix, if you have one in mind.

You will get an answer within a few days. Please keep the details private until a fix is released.

## Scope

- **In scope:** the desktop app in this repository and its server code (`server/`).
- **Out of scope:** SoundCloud itself and other third-party services; the iOS app, which has its own repository: [waterlilo/sc-player-ios](https://github.com/waterlilo/sc-player-ios).

You are welcome to test your own copy of the server; `server/README.md` shows how to run it locally.
Please **do not test the live server** (`*.sslip.io`): real people use it. The following are forbidden there:

- load or denial-of-service tests;
- guessing passwords or keys;
- reading other people's data.

If you come across someone else's data by accident, please stop, do not keep it, and report it.

## Supported versions

Only the latest release gets fixes. The app updates itself: Settings → App → Updates.

---

## Безопасность (по-русски)

Нашли уязвимость — не пишите в публичные issues. Сообщите лично: вкладка **Security** → **Report a vulnerability**.

- Свою копию сервера проверять можно, `server/README.md` объясняет, как её поднять.
- Боевой сервер не трогайте: без нагрузочных тестов, без подбора паролей и ключей, без чужих данных.
- Исправления выходят только в последней версии.

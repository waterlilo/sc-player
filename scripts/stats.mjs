// How many people got sc player, from GitHub's own download counters (nothing is collected from the app).
//   npm run stats
// GitHub counts downloads, not people: the installer counts include in-app updates and test downloads, and
// latest.yml is fetched by every update check (on start and every few hours), so it only hints at how often
// the app is running.
const REPO = "waterlilo/sc-player";

const headers = { Accept: "application/vnd.github+json", "User-Agent": "sc-player-stats" };
if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

const releases = [];
for (let page = 1; ; page++) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100&page=${page}`, { headers });
  if (!res.ok) {
    console.error(`GitHub ответил ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const batch = await res.json();
  releases.push(...batch);
  if (batch.length < 100) break;
}

const count = (r, test) => r.assets.filter((a) => test(a.name)).reduce((n, a) => n + a.download_count, 0);
const rows = releases.map((r) => ({
  release: r.tag_name,
  date: r.published_at.slice(0, 10),
  setup: count(r, (n) => /setup.*\.exe$/i.test(n)),
  portable: count(r, (n) => /portable.*\.exe$/i.test(n)),
  updates: count(r, (n) => n.endsWith(".blockmap")),
  checks: count(r, (n) => n === "latest.yml"),
}));

const total = (key) => rows.reduce((n, r) => n + r[key], 0);
console.table(
  Object.fromEntries(
    rows.map((r) => [r.release, { "дата": r.date, "установщик": r.setup, "portable": r.portable, "обновления в приложении": r.updates, "проверки обновлений": r.checks }]),
  ),
);
console.log(`Всего скачиваний: установщик ${total("setup")}, portable ${total("portable")}.`);
console.log(`Обновились из приложения: ${total("updates")}. Проверок обновлений: ${total("checks")}.`);
console.log("GitHub считает скачивания, а не людей: сюда входят и обновления, и тестовые скачивания.");

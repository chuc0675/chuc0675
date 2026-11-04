# Joylash (hosting) yo'riqnomasi

Telegram Mini App **HTTPS** manzil talab qiladi. Server bitta Node.js jarayon: API, WebSocket,
Mini App fayllari va (ixtiyoriy) bot — hammasi bitta manzilda. Ma'lumotlar bazasi — bitta
SQLite fayl (`DB_PATH`), uni **doimiy diskda** saqlang.

Talablar: Node.js **22.5+** (o'rnatilgan `node:sqlite` uchun), doimiy disk, HTTPS.

## 1. Bot tayyorlash
1. [@BotFather](https://t.me/BotFather) → `/newbot` (yoki mavjud bot) → tokenni oling.
2. Token sizib chiqqan bo'lsa: `/mybots` → bot → **API Token → Revoke**.
3. O'z Telegram ID ingizni bilib oling (masalan [@userinfobot](https://t.me/userinfobot)) — `ADMIN_IDS` uchun.

## 2. Variant A — Render.com (eng oson)
1. render.com → **New → Web Service** → shu GitHub repo.
2. Root Directory: `svara`. Runtime: **Docker** (Dockerfile mavjud) yoki Node:
   Build: `npm ci --omit=dev`, Start: `node server/index.js`.
3. **Disks** → mount path `/app/data` (Docker) yoki `/opt/render/project/src/svara/data` (Node), 1 GB.
4. Environment: `.env.example` dagi qiymatlar (`NODE_ENV=production`, `BOT_TOKEN`, `BOT_USERNAME`,
   `WEBAPP_URL=https://<servis>.onrender.com/`, `ADMIN_IDS`, `BOT_POLLING=1`, `TRUST_PROXY=1`, `DB_PATH`).
5. Deploy tugagach `https://<servis>.onrender.com/api/health` → `{"ok":true}`.

> Bepul tarifdagi servis uxlab qoladi — WebSocket uziladi. Doimiy o'yin uchun pullik tarif yoki VPS tavsiya etiladi.

## 3. Variant B — VPS + Docker + Caddy (HTTPS avtomatik)
```bash
git clone https://github.com/<user>/<repo>.git && cd <repo>/svara
cp .env.example .env && nano .env            # qiymatlarni to'ldiring
docker build -t svara .
docker run -d --name svara --restart unless-stopped --env-file .env \
  -e DB_PATH=/app/data/svara.db -v svara-data:/app/data -p 127.0.0.1:8080:8080 svara
```
`/etc/caddy/Caddyfile`:
```
svara.example.com {
  reverse_proxy 127.0.0.1:8080
}
```
`sudo systemctl reload caddy` — Caddy sertifikatni o'zi oladi va WebSocket'ni o'tkazadi.

Dockersiz: `npm ci --omit=dev && node server/index.js` (systemd yoki pm2 bilan).

## 4. Telegram'ga ulash
- BotFather → `/mybots` → bot → **Bot Settings → Menu Button → Configure** → `WEBAPP_URL`.
- Ixtiyoriy: `/newapp` bilan Mini App ro'yxatdan o'tkazilsa, `t.me/<bot>/<app>?startapp=KOD`
  havolalari ham ishlaydi (mijoz `start_param` ni o'qiydi).
- `BOT_POLLING=1` bo'lsa server botni o'zi ishga tushiradi: `/start`, `/play`, `/rules`,
  `t.me/<bot>?start=room_KOD` (do'stni stolga taklif).

## 5. GitHub Pages (faqat oflayn rejim)
`.github/workflows/svara-pages.yml` `svara/webapp` ni Pages'ga joylaydi. U yerda server yo'q,
shuning uchun ilova **mashq rejimida** ochiladi. Onlayn o'yin uchun Mini App manzili sifatida
serverning o'z manzilini ishlating. Agar frontendni baribir Pages'da qoldirmoqchi bo'lsangiz:
`webapp/config.js` da `serverUrl: 'https://svara.example.com'`, serverda
`CORS_ORIGINS=https://<user>.github.io`.

## 6. Zaxira nusxa
SQLite faylini muntazam nusxalang (server ishlab turganda ham xavfsiz):
```bash
sqlite3 /app/data/svara.db ".backup '/backup/svara-$(date +%F).db'"
```

## 7. Cheklovlar
- Stollar holati bitta jarayon xotirasida — gorizontal masshtablash (bir nechta instansiya) uchun
  Redis/umumiy holat kerak bo'ladi. Bitta instansiya yuzlab bir vaqtdagi o'yinchiga yetadi.
- Server qayta ishga tushganda davom etayotgan qo'llar bekor bo'ladi, stoldagi chiplar balansga qaytariladi.

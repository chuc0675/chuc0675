# 🃏 Svara — Telegram Mini App (multiplayer)

Klassik 3 kartali **Svara (Svarka)** o'yini Telegram ichida: real vaqtda do'stlar bilan
yoki tez o'yin (jonli o'yinchi bo'lmasa — NPC'lar bilan). O'yin serverda boradi,
balans serverda saqlanadi, Telegram foydalanuvchisi rasmiy imzo orqali tasdiqlanadi.

> Chiplar **virtual** — haqiqiy pul, depozit yoki pul yechish yo'q.

## Imkoniyatlar

- **O'yin:** 32 karta, 7♣ joker, ikki tuz = 22, uchta 7 = 34, svara (bankning yarmini to'lab qo'shilish), qoidalar konfiguratsiyada (`DEFAULT_RULES`)
- **Multiplayer:** WebSocket, ochiq/yopiq stollar, 6 belgili taklif kodi, Telegram taklif havolasi, tez o'yin, bo'sh joylarga NPC
- **Server nazorati:** karta tarqatish (kriptografik RNG), navbat, ruxsat etilgan harakatlar, vaqt chegarasi, g'olib va yutuq — hammasi serverda; har bir o'yinchiga faqat o'z kartalari yuboriladi
- **Ishonchlilik:** qayta ulanish, uzilganda kutish vaqti, takroriy harakatni rad etish, server qayta ishga tushsa stoldagi chiplar qaytariladi
- **Profil:** statistika, g'alaba foizi, daraja/XP, o'yinlar tarixi, tranzaksiyalar, reyting
- **Admin panel:** foydalanuvchilar, stollar, o'yinlar, shikoyatlar, audit log, cheklash
- **Oflayn mashq:** server bo'lmasa ham NPC'lar bilan o'ynash (balansga ta'sir qilmaydi)

## Tuzilma

```
svara/
├── server/              # Node.js 22 backend
│   ├── index.js         # ishga tushirish (server + bot)
│   ├── app.js           # HTTP API, WebSocket, statik fayllar, xavfsizlik sarlavhalari
│   ├── rooms.js         # stollar: state machine, taymerlar, NPC, ko'rinishlar
│   ├── auth.js          # Telegram initData tekshiruvi, sessiyalar
│   ├── repo.js          # DB: foydalanuvchilar, balans ledgeri, tarix
│   ├── admin.js         # admin API (ADMIN_IDS)
│   ├── db.js            # SQLite (node:sqlite) + migratsiyalar
│   ├── migrations/      # SQL migratsiyalar
│   ├── ratelimit.js
│   └── config.js        # .env sozlamalari
├── webapp/              # Mini App (kutubxonasiz HTML/CSS/JS)
│   ├── engine.js        # o'yin mexanikasi — server va mijozda bir xil
│   ├── npc.js           # NPC nomlari va uslublari
│   ├── net.js           # REST + WebSocket mijoz
│   ├── local.js         # oflayn mashq stoli
│   ├── app.js           # interfeys
│   ├── admin.html/.js   # admin panel
│   └── config.js        # mijoz sozlamasi (serverUrl)
├── bot/index.js         # Telegram bot (/start, deep link)
├── tests/               # testlar
├── docs/                # AUDIT.md, DEPLOY.md, STATUS.md
├── .env.example
└── Dockerfile
```

## Lokal ishga tushirish

```bash
cd svara
npm ci
cp .env.example .env     # DEV_AUTH=1, NODE_ENV ni bo'sh qoldiring
npm run dev              # http://localhost:8080 — Telegram'siz "Mehmon" sifatida kirasiz
```

Ikki xil brauzer oynasida (masalan, oddiy va inkognito) ochib, stol yaratib, kod bilan qo'shilib sinab ko'ring.

## Testlar

```bash
npm test          # 46 ta: qoidalar, auth, ledger, multiplayer, qayta ulanish, ruxsatlar…
npm run test:ui   # mobil brauzer testlari (Playwright kerak: npm i -D playwright)
```

## Joylash

Batafsil: [docs/DEPLOY.md](docs/DEPLOY.md). Qisqacha:
1. Serverni HTTPS bilan joylang (Render / Railway / Fly.io / VPS + Docker).
2. `.env`: `NODE_ENV=production`, `BOT_TOKEN`, `BOT_USERNAME`, `WEBAPP_URL`, `ADMIN_IDS`, `BOT_POLLING=1`.
3. BotFather → Bot Settings → Menu Button → `WEBAPP_URL`.

## Hujjatlar
- [docs/AUDIT.md](docs/AUDIT.md) — boshlang'ich audit va reja
- [docs/STATUS.md](docs/STATUS.md) — har bir funksiyaning holati
- [docs/DEPLOY.md](docs/DEPLOY.md) — hostingga joylash

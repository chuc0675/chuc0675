# 🃏 Svara — Telegram Mini App

Klassik 3 kartali **Svara** o'yini, Telegram ichida ochiladigan Mini App sifatida.
Kompyuter raqiblari (botlar) bilan o'ynaladi, chiplar Telegram CloudStorage'da saqlanadi.

## Imkoniyatlar

- 1–5 ta bot raqib, 4 xil stavka (10 / 50 / 100 / 500)
- To'liq Svara qoidalari: joker 7♣, ikki tuz = 22, uchta 7 = 34, durangda **svara** (bankning yarmini to'lab qo'shilish bilan)
- Telegram integratsiyasi: foydalanuvchi ismi va rasmi, `BackButton`, haptik javob, `CloudStorage`, yopishdan oldin tasdiqlash
- Har 4 soatda +500 chip bonus
- Oddiy brauzerda ham ishlaydi (localStorage bilan)

## Tuzilma

```
svara/
├── webapp/          # Mini App (statik: HTML/CSS/JS, kutubxonasiz)
│   ├── index.html
│   ├── style.css
│   ├── engine.js    # o'yin mexanikasi (UI'siz, Node'da ham ishlaydi)
│   └── app.js       # interfeys + Telegram WebApp API
├── bot/index.js     # Telegram bot (kutubxonasiz, long polling)
└── tests/           # mexanika testlari (node:test)
```

## Ishga tushirish

### 1. Mini App'ni joylash (HTTPS kerak)

`main` ga push qilinganda `.github/workflows/svara-pages.yml` testlarni ishlatadi va
`svara/webapp` ni GitHub Pages'ga joylaydi. Repozitoriy sozlamalarida
**Settings → Pages → Source: GitHub Actions** ni yoqing.
Manzil: `https://<username>.github.io/<repo>/`

Mahalliy tekshirish: `npm run serve` (yoki `webapp/index.html` ni brauzerda oching).

### 2. Bot yaratish

1. [@BotFather](https://t.me/BotFather) → `/newbot` → tokenni oling.
2. Botni ishga tushiring:

   ```bash
   cd svara
   BOT_TOKEN=123456:ABC... WEBAPP_URL=https://<username>.github.io/<repo>/ npm run bot
   ```

   Bot `/start`, `/play`, `/rules` buyruqlariga javob beradi va chatdagi menyu tugmasini o'yinga bog'laydi.

Botsiz ham bo'ladi: BotFather'da `/newapp` (yoki `/setmenubutton`) orqali Mini App URL'ini to'g'ridan-to'g'ri ulash mumkin.

## Qoidalar

| Kombinatsiya | Ochko |
|---|---|
| Uchta yettilik (7-7-7) | 34 |
| Uchta tuz (A-A-A) | 33 |
| Uchta bir xil (masalan K-K-K) | 3 × qiymat |
| Bir mastdagi kartalar | yig'indi (maks. 33) |
| Ikki tuz | 22 |

- Qiymatlar: A=11, K/Q/J/10=10, 9=9, 8=8, 7=7.
- **7♣ — joker**: 11 ochko, istalgan mast yoki karta o'rnida turadi.
- Har kim ante tikadi, so'ng navbat bilan *Pas*, *O'tish/Tenglash* yoki *Oshirish* (bir raundda ko'pi bilan 4 marta oshirish).
- Stavka eng kam chipli faol o'yinchining imkoniyatidan oshmaydi (stol limiti).
- Ochkolar teng bo'lsa — **SVARA**: bank qoladi, teng kelganlar qayta o'ynaydi; boshqalar bankning yarmini to'lab qo'shilishi mumkin.

## Testlar

```bash
cd svara && npm test
```

> Eslatma: bu mustaqil, o'quv/ko'ngilochar loyiha. Chiplar virtual — haqiqiy pul ishlatilmaydi.
> Nomi, dizayni va grafikasi original; boshqa ilovalarning brendi yoki rasmlari ishlatilmagan.

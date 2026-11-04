# Svara — loyiha auditi

Sana: 2026-11-04. Audit qilingan holat: `main` dagi `e594b1c` commit (PR #1).

## 1. Hozirgi holat

| Qism | Holat |
|---|---|
| Frontend | Statik HTML/CSS/JS, kutubxonasiz (`webapp/index.html`, `style.css`, `app.js` — 510 qator). GitHub Pages'da joylashgan. |
| O'yin mexanikasi | `webapp/engine.js` — UMD modul, brauzerda ham Node'da ham ishlaydi. `Table` klassi: ante, 1 raund stavka (pas / o'tish / tenglash / oshirish), stol limiti, svara. |
| NPC | `webapp/npc.js` — 25 davlat ismlari, mehmon nomlari, 5 xil o'yin uslubi. |
| Backend | **Yo'q.** API endpointlari yo'q. |
| Ma'lumotlar bazasi | **Yo'q.** Balans `Telegram.WebApp.CloudStorage` yoki `localStorage` da. |
| Telegram | WebApp SDK: `ready`, `expand`, ism/rasm (`initDataUnsafe` — tekshirilmagan), `BackButton`, haptik, `CloudStorage`. Bot: `bot/index.js` (long polling, `/start` `/play` `/rules`, menyu tugmasi). |
| Multiplayer / real-time | **Yo'q.** Barcha raqiblar brauzerdagi botlar. "Jonli o'yinchi qidirish" — `findLivePlayers()` stub, har doim bo'sh ro'yxat. |
| Testlar | `tests/engine.test.js` — 12 ta (ochko, joker, svara, chiplar saqlanishi, NPC). |
| CI/CD | `.github/workflows/svara-pages.yml` — test + GitHub Pages deploy. |

### Qoidalar tekshiruvi
Loyihadagi qoidalar bolgar "Svara/Svarka" variantiga mos (manbalar: FortéGames Svara tavsifi, favorite-games.com qoidalari):
32 karta (7–A), 3 tadan karta, A=11, 10–K=10, 9/8/7 nominal, bir mastdagi kartalar yig'iladi,
7♣ — joker (+11, istalgan mast), uchta 7 = 34 (eng kuchli), ikki tuz = 22, durangda svara.
Hududlar bo'yicha farqlanadigan joylar: 36 kartali (6 bilan) variant, ko'r ("blind") o'yin, svaraga
qo'shilish narxi, uchtalik ochkosi. Bular endi `DEFAULT_RULES` konfiguratsiyasiga chiqarildi.

## 2. Aniqlangan kamchiliklar

**Xavfsizlik (kritik):**
1. Balans mijozda saqlanadi — foydalanuvchi uni DevTools/CloudStorage orqali istalgancha o'zgartira oladi.
2. Karta tarqatish va g'olibni aniqlash mijozda — natijani soxtalashtirish mumkin.
3. `initDataUnsafe` imzosiz ishlatiladi — foydalanuvchi identifikatsiyasi yo'q.
4. Bonus cooldown mijozda tekshiriladi — chetlab o'tish oson.
5. Aralashtirish `Math.random()` bilan (kriptografik emas).

**Funksional:**
6. Multiplayer, stollar, taklif, qayta ulanish yo'q.
7. Profil, statistika, o'yin tarixi, reyting yo'q.
8. Yurish uchun vaqt chegarasi yo'q (bot o'yinida muammo emas, multiplayerda kerak).
9. O'yinchini qo'l o'rtasida qo'shish/chiqarish, chiqib ketganda majburiy pas yo'q.
10. Svara cheksiz takrorlanishi mumkin edi (cheklov yo'q).
11. Qoidalar kodga qattiq yozilgan.
12. Admin panel, shikoyatlar, cheklash yo'q.
13. Bot deep link (do'stni stolga taklif) yo'q.

**Dizayn:** yashil stol; talab — bordo/qizil/qora uslub, profil/reyting/sozlamalar/xatolik/qayta ulanish ekranlari.

## 3. Tuzatiladigan / yangi fayllar

| Fayl | O'zgarish |
|---|---|
| `webapp/engine.js` | Qoidalar konfiguratsiyasi, `addPlayer/removePlayer/forceFold`, harakatlar tarixi, svara cheklovi va bankni bo'lish, `secureRandom` |
| `server/*` (yangi) | HTTP + WebSocket server, SQLite (`node:sqlite`), migratsiyalar, initData tekshiruvi, sessiyalar, balans ledgeri, stollar, NPC, taymerlar, admin API, rate limit |
| `bot/index.js` | Server ichida ishlaydigan modul, `/start room_KOD` deep link |
| `webapp/app.js`, `index.html`, `style.css` | Onlayn mijoz + oflayn mashq rejimi, yangi dizayn, barcha ekranlar |
| `webapp/admin.html` (yangi) | Admin panel |
| `tests/*` | Server, auth, ledger, multiplayer, qayta ulanish, ruxsatlar testlari |
| `.env.example`, `Dockerfile`, `README.md` | Sozlash va joylash |

## 4. Yangi kerakli funksiyalar
Server tomonidagi o'yin, stollar (ochiq/yopiq, taklif kodi), real-time WebSocket, qayta ulanish,
vaqt chegarasi, idempotent harakatlar, profil va statistika, tarix, reyting, server balans va
tranzaksiyalar, server bonus, admin panel, shikoyatlar, rate limiting, audit log.

## 5. Amalga oshirish rejasi
1. Engine'ni server uchun tayyorlash + testlar.
2. Server yadrosi: konfiguratsiya, DB migratsiyalari, Telegram auth, balans ledgeri + testlar.
3. Stollar, WebSocket, REST, NPC, taymerlar + integratsion testlar.
4. Bot deep link, admin API/panel, rate limit + testlar.
5. Frontend: onlayn mijoz, oflayn mashq, yangi dizayn + mobil testlar.
6. Hujjatlar, `.env.example`, Dockerfile, joylash yo'riqnomasi.

### Texnologiya tanlovi
- **Node.js 22 + `node:sqlite`** — tashqi native modulsiz SQLite (bitta fayl, tranzaksiyalar, migratsiyalar).
- **`ws`** — yagona tashqi paket; yengil va barqaror WebSocket.
- Frameworksiz HTTP (`node:http`) — kam bog'liqlik, kichik hujum yuzasi.
- Mavjud `engine.js` server va mijozda bir xil ishlatiladi (kod takrorlanmaydi).

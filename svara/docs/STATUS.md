# Funksiyalar holati

Belgilar: ✅ ishlaydi va testdan o'tgan · 🟡 ishlab chiqilgan, test qilinmagan · 🟠 qisman · ⬜ hali yo'q

Testlar: `npm test` — 48/48 o'tdi (engine, server-core, server-int), `npm run test:ui` — o'tdi
(Chromium mobil emulyatsiya, 320/360/375/390/412 px). Sana: 2026-11-04.

## O'yin mexanikasi
| Funksiya | Holat | Izoh |
|---|---|---|
| 32 kartali koloda, 3 tadan tarqatish | ✅ | |
| Ochko hisoblash, joker 7♣, ikki tuz 22, uchtalik, uchta 7 = 34 | ✅ | `tests/engine.test.js` |
| Qoidalar konfiguratsiyasi (`DEFAULT_RULES`) | ✅ | joker, ochkolar, oshirish qadamlari, svara narxi |
| Navbat, pas / o'tish / tenglash / oshirish, oshirish limiti | ✅ | |
| Stol limiti (yon banklar kerak bo'lmasligi uchun) | ✅ | |
| Svara: teng kelganlar qayta o'ynaydi, boshqalar ½ bank to'lab qo'shiladi | ✅ | |
| Svara cheklovi (`maxSvaraRounds`) va bankni bo'lish | ✅ | |
| Kriptografik RNG (Web Crypto) | ✅ | |
| Ko'r ("blind") o'yin | ⬜ | hududiy variant; qoidalar konfiguratsiyasiga qo'shish mumkin |
| 36 kartali (6 bilan) variant | ⬜ | |

## Server va multiplayer
| Funksiya | Holat | Izoh |
|---|---|---|
| Holatlar: WAITING_FOR_PLAYERS → READY → DEALING → PLAYING → ROUND_END → FINISHED | ✅ | |
| WebSocket real-time, har bir o'zgarishda holat yuborish | ✅ | |
| Boshqalarning yopiq kartalari yuborilmaydi | ✅ | integratsion + UI test |
| Navbatdan tashqari / noto'g'ri / eskirgan harakatni rad etish | ✅ | |
| Takroriy harakat (actionId) qayta bajarilmaydi | ✅ | |
| Yurish vaqti, avtomatik o'tish/pas | ✅ | |
| Faol bo'lmagan o'yinchi: `IDLE_KICK_TURNS` (2) marta javobsiz — majburiy pas, stoldan chiqarish, boshqalarga xabar | ✅ | faol bo'lmagan o'yinchi bankni yutib ketmaydi |
| Aloqasi uzilgan o'yinchiga qisqa yurish vaqti (`DISCONNECTED_TURN_SECONDS`) | ✅ | navbat o'rtasida uzilsa ham |
| Qayta ulanish (kartalar bilan davom etish) | ✅ | |
| Uzilib qaytmaganda: pas, chiplar balansga qaytadi | ✅ | |
| Ochiq / yopiq stollar, taklif kodi, kod bilan kirish | ✅ | |
| Tez o'yin, bir vaqtda ko'p ulanish (joylar oshib ketmaydi) | ✅ | |
| Bo'sh joylarga NPC (turli davlatlar, uslublar) | ✅ | |
| Bir foydalanuvchi — bir stol | ✅ | |
| Server qayta ishga tushganda chiplarni qaytarish | ✅ | |
| Bir nechta server instansiyasi (gorizontal masshtab) | ⬜ | holat xotirada; Redis kerak bo'ladi |

## Foydalanuvchi, balans, xavfsizlik
| Funksiya | Holat | Izoh |
|---|---|---|
| initData HMAC tekshiruvi, eskirgan auth_date | ✅ | soxta imzo va o'zgartirilgan user rad etiladi |
| Birinchi kirishda profil + boshlang'ich balans (bir marta) | ✅ | |
| Sessiya tokenlari (DBda faqat hash) | ✅ | |
| Balans faqat serverda; atomik va idempotent tranzaksiyalar | ✅ | |
| Yetarli balans bo'lmasa rad etish | ✅ | |
| Server bonus cooldown | ✅ | |
| Tranzaksiyalar tarixi, o'yinlar tarixi, harakatlar logi | ✅ | |
| Statistika, g'alaba %, XP/daraja, reyting | ✅ | |
| Rate limiting (HTTP, auth, WebSocket) | ✅ | |
| Kirish validatsiyasi, JSON hajmi cheklovi | ✅ | |
| Xatolarda ichki tafsilot chiqmasligi, path traversal himoyasi | ✅ | |
| CSP va xavfsizlik sarlavhalari | ✅ | |
| Audit log | ✅ | login, join/leave, bonus, admin amallari |
| Production'da DEV_AUTH o'chiqligi | ✅ | qo'lda tekshirildi |

## Admin
| Funksiya | Holat | Izoh |
|---|---|---|
| Ruxsat serverda (ADMIN_IDS) | ✅ | 401/403 testlari |
| Umumiy ko'rsatkichlar, stollar, o'yinlar, foydalanuvchilar, shikoyatlar, audit | ✅ | API testlari + `admin.html` brauzerda tekshirildi (oddiy foydalanuvchiga ruxsat yo'q) |
| Cheklash (ban) — sessiya va ulanish uziladi | ✅ | |
| Shikoyat yuborish (o'yinchiga bosib) | ✅ | API test; UI tugmasi qo'lda tekshirilmagan |

## Telegram
| Funksiya | Holat | Izoh |
|---|---|---|
| Bot: `/start`, `/play`, `/rules`, menyu tugmasi | 🟡 | javob mantig'i unit-testda; haqiqiy Telegram API bilan ishga tushirilmagan |
| Deep link `t.me/<bot>?start=room_KOD` → stolga | 🟠 | bot javobi va mijozdagi `?room=` testlangan; to'liq yo'l haqiqiy Telegram'da tekshirilmagan |
| Mini App: haptik, BackButton, yopishni tasdiqlash, safe area, ulashish | 🟡 | haqiqiy Telegram ilovasida sinalmagan |
| O'yin natijasi haqida bot bildirishnomasi | ⬜ | |

## Interfeys
| Funksiya | Holat | Izoh |
|---|---|---|
| Bordo/qora dizayn, CSS kartalar, animatsiyalar (tarqatish, ochish, g'alaba, chiplar) | ✅ | skrinshotlar bilan tekshirildi |
| Yuklanish, xato, qayta ulanish, bo'sh holat ekranlari | 🟠 | yuklanish/oflayn/bo'sh holat tekshirildi; qayta ulanish oynasi faqat kod darajasida |
| Lobbi, profil, reyting, sozlamalar, ovoz/haptik sozlamasi | ✅ | |
| Mobil o'lchamlar 320–412 px, gorizontal skroll yo'q | ✅ | `tests/ui.e2e.js` |
| Oflayn mashq rejimi | ✅ | qo'lda (Playwright) tekshirildi |
| Rus / ingliz tillari | ⬜ | hozir faqat o'zbekcha |

## Joylash
| Funksiya | Holat | Izoh |
|---|---|---|
| `.env.example`, yo'riqnoma | ✅ | |
| Dockerfile | 🟡 | bu muhitda Docker daemon yo'q edi — yig'ilmagan |
| Production rejimida ishga tushish, health check | ✅ | qo'lda tekshirildi |
| GitHub Pages (oflayn rejim) | ✅ | mavjud workflow |

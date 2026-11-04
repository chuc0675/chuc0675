/*
 * Svara Telegram boti — tashqi kutubxonasiz (Node.js 18+).
 *
 * Ishga tushirish:
 *   BOT_TOKEN=123:ABC WEBAPP_URL=https://<user>.github.io/<repo>/ node bot/index.js
 *
 * Bot /start va /play buyruqlariga Mini App'ni ochuvchi tugma bilan javob beradi
 * hamda chatdagi menyu tugmasini o'yinga bog'laydi.
 */
'use strict';

const TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
if (!TOKEN || !WEBAPP_URL) {
  console.error('BOT_TOKEN va WEBAPP_URL muhit o\'zgaruvchilarini kiriting.');
  process.exit(1);
}
if (!WEBAPP_URL.startsWith('https://')) {
  console.error('WEBAPP_URL https:// bilan boshlanishi kerak (Telegram talabi).');
  process.exit(1);
}

const API = `https://api.telegram.org/bot${TOKEN}`;

async function call(method, body = {}) {
  const res = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description}`);
  return data.result;
}

const playKeyboard = {
  inline_keyboard: [[{ text: '🃏 O\'ynash', web_app: { url: WEBAPP_URL } }]],
};

const WELCOME =
  '<b>Svara</b>ga xush kelibsiz! 🃏\n\n' +
  '3 kartali klassik o\'yin: bir xil mastdagi kartalar ochkosini yig\'ing, ' +
  '7♣ — joker, uchta yettilik — eng kuchli qo\'l (34).\n\n' +
  'Boshlang\'ich balans — 1 000 chip. Har 4 soatda bonus oling!';

async function handle(update) {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const cmd = msg.text.split(/[\s@]/)[0];
  if (cmd === '/start' || cmd === '/play') {
    await call('sendMessage', {
      chat_id: msg.chat.id,
      text: WELCOME,
      parse_mode: 'HTML',
      reply_markup: playKeyboard,
    });
  } else if (cmd === '/rules') {
    await call('sendMessage', {
      chat_id: msg.chat.id,
      parse_mode: 'HTML',
      text:
        '<b>Qoidalar</b>\n' +
        '• 32 karta (7–A), har kimga 3 tadan\n' +
        '• A=11, K/Q/J/10=10, 9=9, 8=8, 7=7\n' +
        '• 7♣ — joker (11, istalgan mast)\n' +
        '• Ikki tuz = 22, uchta bir xil = 3×qiymat, uchta 7 = 34\n' +
        '• Durang — SVARA: bank qoladi, qayta o\'ynaladi',
      reply_markup: playKeyboard,
    });
  }
}

async function main() {
  const me = await call('getMe');
  console.log(`@${me.username} ishga tushdi`);
  await call('setMyCommands', {
    commands: [
      { command: 'play', description: 'O\'yinni ochish' },
      { command: 'rules', description: 'Qoidalar' },
    ],
  });
  await call('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'O\'ynash', web_app: { url: WEBAPP_URL } },
  });

  let offset = 0;
  for (;;) {
    try {
      const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
      for (const u of updates) {
        offset = u.update_id + 1;
        handle(u).catch((e) => console.error(e.message));
      }
    } catch (e) {
      console.error(e.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

main();

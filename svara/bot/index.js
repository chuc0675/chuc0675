/*
 * Svara Telegram boti — tashqi kutubxonasiz (Node.js 18+).
 *
 * Server bilan birga: .env da BOT_POLLING=1 (server/index.js o'zi ishga tushiradi).
 * Alohida:           node bot/index.js   (BOT_TOKEN va WEBAPP_URL .env da)
 *
 * Buyruqlar: /start, /play, /rules. Deep link: t.me/<bot>?start=room_KOD — do'st
 * stoliga to'g'ridan-to'g'ri olib kiruvchi tugma yuboriladi.
 */
'use strict';

const WELCOME =
  '<b>Svara</b>ga xush kelibsiz! 🃏\n\n' +
  '3 kartali klassik o\'yin: bir xil mastdagi kartalar ochkosini yig\'ing, ' +
  '7♣ — joker, uchta yettilik — eng kuchli qo\'l (34).\n\n' +
  'Do\'stlaringiz bilan real vaqtda o\'ynang yoki tez o\'yinga qo\'shiling. Chiplar virtual.';

const RULES =
  '<b>Qoidalar</b>\n' +
  '• 32 karta (7–A), har kimga 3 tadan\n' +
  '• A=11, K/Q/J/10=10, 9=9, 8=8, 7=7\n' +
  '• 7♣ — joker (11, istalgan mast)\n' +
  '• Ikki tuz = 22, uchta bir xil = 3×qiymat, uchta 7 = 34\n' +
  '• Durang — SVARA: bank qoladi, qayta o\'ynaladi, boshqalar bankning yarmini to\'lab qo\'shiladi';

function appUrl(base, room) {
  if (!room) return base;
  const u = new URL(base);
  u.searchParams.set('room', room);
  return u.toString();
}

/** Bot yangilanishiga javob (sof funksiya — testlanadi). Qaytaradi: sendMessage parametrlari yoki null */
function replyFor(msg, webappUrl) {
  if (!msg || typeof msg.text !== 'string') return null;
  const [cmdRaw, arg] = msg.text.trim().split(/\s+/, 2);
  const cmd = cmdRaw.split('@')[0];
  const room = arg && /^room_[A-Z2-9]{6}$/.test(arg) ? arg.slice(5) : null;
  const button = (text, r) => ({ inline_keyboard: [[{ text, web_app: { url: appUrl(webappUrl, r) } }]] });
  if (cmd === '/start' && room) {
    return { chat_id: msg.chat.id, parse_mode: 'HTML', text: `Sizni Svara stoliga taklif qilishdi! 🃏\nStol kodi: <b>${room}</b>`, reply_markup: button('🃏 Stolga qo\'shilish', room) };
  }
  if (cmd === '/start' || cmd === '/play') {
    return { chat_id: msg.chat.id, parse_mode: 'HTML', text: WELCOME, reply_markup: button('🃏 O\'ynash') };
  }
  if (cmd === '/rules') return { chat_id: msg.chat.id, parse_mode: 'HTML', text: RULES, reply_markup: button('🃏 O\'ynash') };
  return null;
}

function startBot(cfg, { logger = console } = {}) {
  const TOKEN = cfg.botToken;
  const WEBAPP_URL = cfg.webappUrl;
  if (!TOKEN || !WEBAPP_URL) throw new Error('BOT_TOKEN va WEBAPP_URL kerak');
  if (!WEBAPP_URL.startsWith('https://')) throw new Error('WEBAPP_URL https:// bilan boshlanishi kerak (Telegram talabi)');
  const API = `https://api.telegram.org/bot${TOKEN}`;
  let stopped = false;
  let controller = null;

  async function call(method, body = {}) {
    controller = new AbortController();
    const res = await fetch(`${API}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.description}`);
    return data.result;
  }

  (async () => {
    try {
      const me = await call('getMe');
      logger.log(`[bot] @${me.username} ishga tushdi`);
      await call('setMyCommands', { commands: [{ command: 'play', description: 'O\'yinni ochish' }, { command: 'rules', description: 'Qoidalar' }] });
      await call('setChatMenuButton', { menu_button: { type: 'web_app', text: 'O\'ynash', web_app: { url: WEBAPP_URL } } });
    } catch (e) {
      logger.error('[bot] sozlashda xato:', e.message); // token log qilinmaydi
    }
    let offset = 0;
    while (!stopped) {
      try {
        const updates = await call('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] });
        for (const u of updates) {
          offset = u.update_id + 1;
          const r = replyFor(u.message, WEBAPP_URL);
          if (r) call('sendMessage', r).catch((e) => logger.error('[bot]', e.message));
        }
      } catch (e) {
        if (stopped) break;
        logger.error('[bot]', e.message);
        await new Promise((r) => setTimeout(r, 3000));
      }
    }
  })();

  return {
    stop() {
      stopped = true;
      if (controller) controller.abort();
    },
  };
}

module.exports = { startBot, replyFor };

if (require.main === module) {
  const { loadEnvFile, buildConfig } = require('../server/config');
  loadEnvFile();
  try {
    startBot(buildConfig());
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}

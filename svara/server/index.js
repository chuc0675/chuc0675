#!/usr/bin/env node
'use strict';
/** Ishga tushirish: `npm start` (svara/ papkasida). Sozlamalar — .env (qarang .env.example) */
const { loadEnvFile, buildConfig } = require('./config');
loadEnvFile();
let cfg;
try {
  cfg = buildConfig();
} catch (e) {
  console.error(`[svara] sozlamalar xatosi: ${e.message} (qarang: .env.example)`);
  process.exit(1);
}
const { createApp } = require('./app');
const { startBot } = require('../bot/index.js');

(async () => {
  const app = createApp(cfg);
  const addr = await app.listen();
  console.log(`[svara] server: http://${addr.address}:${addr.port}  (devAuth=${cfg.devAuth}, production=${cfg.production})`);
  let bot = null;
  if (cfg.botPolling && cfg.botToken) {
    bot = startBot(cfg);
    console.log('[svara] Telegram bot long polling yoqildi');
  }
  const stop = async (sig) => {
    console.log(`[svara] ${sig} — to'xtatilmoqda (stollardagi chiplar qaytariladi)…`);
    if (bot) bot.stop();
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
})().catch((e) => {
  console.error('[svara] ishga tushmadi:', e.message);
  process.exit(1);
});

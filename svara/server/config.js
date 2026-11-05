'use strict';
/**
 * Konfiguratsiya faqat muhit o'zgaruvchilaridan (.env) olinadi.
 * Maxfiy qiymatlar (BOT_TOKEN) kodga yozilmaydi.
 */
const fs = require('node:fs');
const path = require('node:path');

function loadEnvFile() {
  const file = process.env.ENV_FILE || path.join(__dirname, '..', '.env');
  if (fs.existsSync(file) && typeof process.loadEnvFile === 'function') process.loadEnvFile(file);
}

const int = (v, d) => (v === undefined || v === '' || isNaN(Number(v)) ? d : Math.floor(Number(v)));
const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

function buildConfig(env = process.env) {
  const production = env.NODE_ENV === 'production';
  const cfg = {
    production,
    port: int(env.PORT, 8080),
    host: env.HOST || '0.0.0.0',
    dbPath: env.DB_PATH || path.join(__dirname, '..', 'data', 'svara.db'),
    botToken: (env.BOT_TOKEN || '').trim(),
    botUsername: (env.BOT_USERNAME || '').trim().replace(/^@/, ''),
    botPolling: bool(env.BOT_POLLING, false),
    webappUrl: (env.WEBAPP_URL || '').trim(),
    adminIds: (env.ADMIN_IDS || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number),
    // DEV_AUTH — Telegram'siz brauzerda sinash uchun. Production'da hech qachon yoqilmaydi.
    devAuth: !production && bool(env.DEV_AUTH, false),
    corsOrigins: (env.CORS_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: bool(env.TRUST_PROXY, false),
    initDataMaxAgeSec: int(env.INITDATA_MAX_AGE_SEC, 24 * 3600),
    sessionTtlSec: int(env.SESSION_TTL_SEC, 7 * 24 * 3600),
    startBalance: int(env.START_BALANCE, 1000),
    bonusAmount: int(env.BONUS_AMOUNT, 500),
    bonusCooldownSec: int(env.BONUS_COOLDOWN_SEC, 4 * 3600),
    turnSeconds: int(env.TURN_SECONDS, 25),
    svaraDecisionSeconds: int(env.SVARA_DECISION_SECONDS, 10),
    nextHandSeconds: int(env.NEXT_HAND_SECONDS, 5),
    dealSeconds: 1.2,
    resultSeconds: int(env.RESULT_SECONDS, 4),
    botThinkSeconds: 1.2,
    npcChurn: 0.15,
    npcFillSeconds: int(env.NPC_FILL_SECONDS, 8),
    disconnectGraceSec: int(env.DISCONNECT_GRACE_SEC, 60),
    idleKickTurns: Math.max(1, int(env.IDLE_KICK_TURNS, 2)), // ketma-ket shuncha marta javob bermasa — chiqariladi
    disconnectedTurnSeconds: int(env.DISCONNECTED_TURN_SECONDS, 8), // aloqasi uzilgan o'yinchining yurish vaqti
    antes: (env.ANTES || '10,50,100,500').split(',').map(Number).filter((n) => n > 0),
    buyInAntes: int(env.BUY_IN_ANTES, 100), // stolga o'tirganda olinadigan chip = ante × N (balansdan ko'p emas)
    staticDir: env.STATIC_DIR || path.join(__dirname, '..', 'webapp'),
  };
  if (production && !cfg.botToken) throw new Error('BOT_TOKEN production rejimida majburiy');
  return cfg;
}

module.exports = { loadEnvFile, buildConfig };

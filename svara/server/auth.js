'use strict';
/**
 * Telegram Mini App initData tekshiruvi (rasmiy algoritm):
 *   secret_key = HMAC_SHA256(key = "WebAppData", data = bot_token)
 *   hash       = hex(HMAC_SHA256(key = secret_key, data = data_check_string))
 * data_check_string — `hash` dan boshqa barcha maydonlar, kalit bo'yicha
 * alifbo tartibida, "key=value" ko'rinishida "\n" bilan birlashtirilgan.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
const crypto = require('node:crypto');

class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function dataCheckString(params, exclude) {
  return [...params.entries()]
    .filter(([k]) => !exclude.includes(k))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
}

function sign(dcs, botToken) {
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  return crypto.createHmac('sha256', secret).update(dcs).digest('hex');
}

function safeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !/^[0-9a-f]+$/i.test(a)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

/**
 * @returns {{ user, authDate, startParam, queryId }}
 * @throws AuthError
 */
function validateInitData(initData, botToken, { maxAgeSec = 86400, now = Date.now() } = {}) {
  if (!botToken) throw new AuthError('config', 'Bot token sozlanmagan');
  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 8192) {
    throw new AuthError('invalid', 'initData yo\'q yoki noto\'g\'ri');
  }
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) throw new AuthError('invalid', 'hash yo\'q');
  // Bot API 8.0 dan `signature` maydoni ham keladi; HMAC tekshiruvida u odatda
  // data_check_string ichida qoladi. Ikkala variantni ham qabul qilamiz.
  const ok =
    safeEqualHex(sign(dataCheckString(params, ['hash']), botToken), hash) ||
    (params.has('signature') && safeEqualHex(sign(dataCheckString(params, ['hash', 'signature']), botToken), hash));
  if (!ok) throw new AuthError('signature', 'Imzo noto\'g\'ri');

  const authDate = Number(params.get('auth_date'));
  if (!authDate) throw new AuthError('invalid', 'auth_date yo\'q');
  if (maxAgeSec > 0 && now / 1000 - authDate > maxAgeSec) throw new AuthError('expired', 'initData eskirgan');

  let user;
  try {
    user = JSON.parse(params.get('user') || 'null');
  } catch (_) {
    user = null;
  }
  if (!user || !Number.isSafeInteger(user.id)) throw new AuthError('invalid', 'user yo\'q');
  return { user, authDate, startParam: params.get('start_param') || null, queryId: params.get('query_id') || null };
}

/** Testlar va lokal ishlab chiqish uchun imzolangan initData yasash */
function buildInitData(user, botToken, { authDate = Math.floor(Date.now() / 1000), extra = {} } = {}) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user), ...extra });
  params.set('hash', sign(dataCheckString(params, ['hash']), botToken));
  return params.toString();
}

/* ---------------- Sessiyalar ---------------- */
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');

function createSession(db, userId, ttlSec) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    hashToken(token),
    userId,
    now,
    now + ttlSec * 1000
  );
  return token;
}

function resolveSession(db, token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  const row = db
    .prepare(
      `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ? AND s.expires_at > ?`
    )
    .get(hashToken(token), Date.now());
  return row || null;
}

function purgeSessions(db) {
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

module.exports = { AuthError, validateInitData, buildInitData, createSession, resolveSession, purgeSessions, hashToken };

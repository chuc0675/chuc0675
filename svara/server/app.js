'use strict';
/**
 * HTTP API + WebSocket real-time server + statik fayllar.
 * `createApp(cfg)` — testlarda ham ishlatiladi (DB_PATH=':memory:').
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { WebSocketServer } = require('ws');
const { openDb } = require('./db');
const { createRepo, LedgerError } = require('./repo');
const auth = require('./auth');
const { RoomManager, GameError } = require('./rooms');
const { createLimiter } = require('./ratelimit');
const { createAdmin } = require('./admin');
const E = require('../webapp/engine.js');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ERROR_STATUS = { insufficient: 409, seated: 409, full: 409, cooldown: 429, not_found: 404, closed: 410, banned: 403 };

function createApp(cfg, { logger = console } = {}) {
  const db = openDb(cfg.dbPath);
  const repo = createRepo(db, cfg);
  const recovered = repo.recoverSeats();
  if (recovered) logger.info && logger.info(`[svara] ${recovered} ta stol joyi qaytarildi (qayta ishga tushish)`);
  const rules = E.resolveRules(cfg.rules);
  const startedAt = Date.now();
  const errors = []; // oxirgi xatolar (admin uchun, maxfiy ma'lumotsiz)

  function recordError(e, where) {
    errors.push({ at: Date.now(), where, message: String(e && e.message).slice(0, 300) });
    if (errors.length > 100) errors.shift();
    logger.error && logger.error(`[svara] ${where}:`, e);
  }

  /* ---------------- ulanishlar ---------------- */
  const conns = new Map(); // userId → Set<ws>
  function notify(userId, msg) {
    const set = conns.get(userId);
    if (!set) return;
    const data = JSON.stringify(msg);
    for (const ws of set) if (ws.readyState === 1) ws.send(data);
  }

  const rooms = new RoomManager({
    repo,
    cfg,
    rules,
    notify,
    onError: (e) => recordError(e, 'room'),
    onHandResult: (userId) => {
      const u = repo.getUser(userId);
      if (u) notify(userId, { type: 'profile', profile: publicProfile(u) });
    },
  });

  function publicProfile(u) {
    const room = rooms.roomOf(u.id);
    const seat = room ? room.player(u.id) : null;
    return {
      id: u.id,
      tgId: u.tg_id,
      name: u.first_name,
      lastName: u.last_name,
      username: u.username,
      photo: u.photo_url,
      balance: u.balance,
      atTable: seat ? seat.chips : 0,
      xp: u.xp,
      level: 1 + Math.floor(Math.sqrt(u.xp / 20)),
      gamesPlayed: u.games_played,
      wins: u.wins,
      losses: u.losses,
      winRate: u.games_played ? Math.round((u.wins / u.games_played) * 100) : 0,
      netWon: u.net_won,
      biggestWin: u.biggest_win,
      nextBonusAt: (u.last_bonus_at || 0) + cfg.bonusCooldownSec * 1000,
      isAdmin: cfg.adminIds.includes(u.tg_id),
      roomId: room ? room.id : null,
      createdAt: u.created_at,
    };
  }

  function kickUser(userId, reason) {
    rooms.leave(userId);
    for (const ws of conns.get(userId) || []) ws.close(4003, reason || 'banned');
  }

  /* ---------------- HTTP ---------------- */
  const httpLimit = createLimiter({ rate: 5, burst: 40 });
  const authLimit = createLimiter({ rate: 0.2, burst: 10 });
  const ipOf = (req) => (cfg.trustProxy && (req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '?';

  function securityHeaders(res) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' https://telegram.org",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https://t.me https://*.telegram.org https://*.t.me",
        "connect-src 'self' ws: wss:",
        "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
      ].join('; ')
    );
  }

  function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && cfg.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
  }

  function send(res, status, body) {
    res.writeHead(status, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(body));
  }

  function readJson(req, limit = 16 * 1024) {
    return new Promise((resolve, reject) => {
      let size = 0;
      const chunks = [];
      req.on('data', (c) => {
        size += c.length;
        if (size > limit) {
          reject(new HttpError(413, 'too_large', 'So\'rov juda katta'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(v && typeof v === 'object' ? v : {});
        } catch (_) {
          reject(new HttpError(400, 'bad_json', 'Noto\'g\'ri JSON'));
        }
      });
      req.on('error', reject);
    });
  }

  function requireUser(req) {
    const h = req.headers.authorization || '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : null;
    const u = auth.resolveSession(db, token);
    if (!u) throw new HttpError(401, 'unauthorized', 'Avtorizatsiya kerak');
    if (u.is_banned) throw new HttpError(403, 'banned', 'Hisobingiz cheklangan');
    return u;
  }

  function login(body, ip) {
    let tgUser;
    let startParam = null;
    if (body.initData) {
      try {
        const r = auth.validateInitData(body.initData, cfg.botToken, { maxAgeSec: cfg.initDataMaxAgeSec });
        tgUser = r.user;
        startParam = r.startParam;
      } catch (e) {
        if (e instanceof auth.AuthError) throw new HttpError(401, 'auth_' + e.code, 'Telegram ma\'lumotlari tasdiqlanmadi');
        throw e;
      }
    } else if (cfg.devAuth && body.dev && typeof body.dev === 'object') {
      // faqat lokal ishlab chiqish (NODE_ENV != production va DEV_AUTH=1)
      const id = Number(body.dev.id);
      if (!Number.isSafeInteger(id) || id <= 0 || id > 1e15) throw new HttpError(400, 'invalid', 'dev.id noto\'g\'ri');
      tgUser = { id, first_name: String(body.dev.name || 'Dev ' + id).slice(0, 32) };
    } else {
      throw new HttpError(401, 'unauthorized', 'initData kerak');
    }
    const u = repo.upsertTelegramUser(tgUser);
    if (u.is_banned) throw new HttpError(403, 'banned', 'Hisobingiz cheklangan');
    const token = auth.createSession(db, u.id, cfg.sessionTtlSec);
    repo.audit(u.id, 'login', { dev: !body.initData }, ip);
    return { token, profile: publicProfile(u), startParam, isNew: !!u._created };
  }

  const admin = createAdmin({ repo, db, cfg, rooms, conns, errors, startedAt, kickUser, HttpError });

  const routes = {
    'GET /api/health': () => ({ ok: true, uptime: Math.round((Date.now() - startedAt) / 1000) }),
    'GET /api/config': () => ({
      botUsername: cfg.botUsername || null,
      antes: cfg.antes,
      turnSeconds: cfg.turnSeconds,
      buyInAntes: cfg.buyInAntes,
      bonusAmount: cfg.bonusAmount,
      bonusCooldownSec: cfg.bonusCooldownSec,
      devAuth: cfg.devAuth,
      rules,
    }),
    'POST /api/auth': async (req, ip) => {
      if (!authLimit(ip)) throw new HttpError(429, 'rate_limited', 'Juda ko\'p urinish');
      return login(await readJson(req), ip);
    },
    'GET /api/me': (req) => ({ profile: publicProfile(requireUser(req)) }),
    'GET /api/history': (req) => ({ items: repo.history(requireUser(req).id, 30) }),
    'GET /api/transactions': (req) => ({ items: repo.transactions(requireUser(req).id, 50) }),
    'GET /api/leaderboard': (req, ip, url) => ({ items: repo.leaderboard(url.searchParams.get('by') || 'net_won', 50) }),
    'GET /api/rooms': () => ({ items: rooms.listPublic() }),
    'POST /api/bonus': (req, ip) => {
      const u = requireUser(req);
      const t = repo.claimBonus(u.id);
      repo.audit(u.id, 'bonus', { amount: t.amount }, ip);
      const profile = publicProfile(repo.getUser(u.id));
      notify(u.id, { type: 'profile', profile });
      return { amount: t.amount, profile };
    },
    'POST /api/report': async (req, ip) => {
      const u = requireUser(req);
      const b = await readJson(req);
      const reason = String(b.reason || '').trim().slice(0, 500);
      if (reason.length < 3) throw new HttpError(400, 'invalid', 'Sababni yozing');
      const target = Number.isSafeInteger(b.targetUserId) ? b.targetUserId : null;
      if (target && !repo.getUser(target)) throw new HttpError(404, 'not_found', 'O\'yinchi topilmadi');
      db.prepare('INSERT INTO reports (reporter_id, target_user_id, room_id, reason, created_at) VALUES (?, ?, ?, ?, ?)').run(
        u.id,
        target,
        typeof b.roomId === 'string' ? b.roomId.slice(0, 64) : null,
        reason,
        Date.now()
      );
      repo.audit(u.id, 'report', { target }, ip);
      return { ok: true };
    },
    ...admin.routes(requireUser, readJson),
  };

  function serveStatic(req, res, url) {
    let rel;
    try {
      rel = decodeURIComponent(url.pathname).trim();
    } catch (_) {
      return send(res, 400, { error: 'bad_url' });
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const root = path.normalize(cfg.staticDir + path.sep);
    const sendFile = (file) => {
      const ext = path.extname(file);
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      });
      fs.createReadStream(file).pipe(res);
    };
    const file = path.normalize(path.join(cfg.staticDir, rel));
    if (!file.startsWith(root)) return send(res, 403, { error: 'forbidden' });
    fs.stat(file, (err, st) => {
      if (!err && st.isFile()) return sendFile(file);
      // kengaytmasiz yo'l (masalan Mini App URL'i noto'g'ri yozilgan) — bosh sahifa
      if (!path.extname(rel)) return sendFile(path.join(root, 'index.html'));
      send(res, 404, { error: 'not_found' });
    });
  }

  const server = http.createServer(async (req, res) => {
    const ip = ipOf(req);
    securityHeaders(res);
    cors(req, res);
    let url;
    try {
      url = new URL(req.url, 'http://local');
    } catch (_) {
      return send(res, 400, { error: 'bad_url' });
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }
    if (!url.pathname.startsWith('/api/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'method' });
      return serveStatic(req, res, url);
    }
    if (!httpLimit(ip)) return send(res, 429, { error: 'rate_limited', message: 'Juda ko\'p so\'rov' });
    const handler = routes[`${req.method} ${url.pathname}`];
    if (!handler) return send(res, 404, { error: 'not_found' });
    try {
      const out = await handler(req, ip, url);
      send(res, 200, out);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message });
      if (e instanceof LedgerError || e instanceof GameError) {
        return send(res, ERROR_STATUS[e.code] || 400, { error: e.code, message: e.message, ...(e.extra || {}) });
      }
      recordError(e, `${req.method} ${url.pathname}`);
      send(res, 500, { error: 'internal', message: 'Serverda xatolik' }); // ichki tafsilotlar chiqarilmaydi
    }
  });

  /* ---------------- WebSocket ---------------- */
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

  wss.on('connection', (ws, req) => {
    const ip = ipOf(req);
    const limit = createLimiter({ rate: 8, burst: 20 });
    let violations = 0;
    ws.isAlive = true;
    ws.on('pong', () => (ws.isAlive = true));
    const authTimer = setTimeout(() => !ws.user && ws.close(4001, 'auth timeout'), 5000);
    const reply = (msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));

    ws.on('message', (raw) => {
      if (!limit(1)) {
        if (++violations > 20) return ws.close(4029, 'rate limit');
        return reply({ type: 'error', code: 'rate_limited', message: 'Juda tez' });
      }
      let msg;
      try {
        msg = JSON.parse(raw.toString('utf8'));
      } catch (_) {
        return reply({ type: 'error', code: 'bad_json' });
      }
      if (!msg || typeof msg.type !== 'string') return reply({ type: 'error', code: 'bad_message' });
      const reqId = typeof msg.reqId === 'string' ? msg.reqId.slice(0, 40) : undefined;
      try {
        handleWs(ws, msg, reply, reqId, ip);
      } catch (e) {
        if (e instanceof GameError || e instanceof LedgerError || e instanceof HttpError) {
          return reply({ type: 'error', code: e.code, message: e.message, reqId });
        }
        recordError(e, 'ws ' + msg.type);
        reply({ type: 'error', code: 'internal', message: 'Serverda xatolik', reqId });
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (!ws.user) return;
      const set = conns.get(ws.user.id);
      if (set) {
        set.delete(ws);
        if (set.size === 0) {
          conns.delete(ws.user.id);
          const room = rooms.roomOf(ws.user.id);
          if (room) room.disconnect(ws.user.id);
        }
      }
    });
  });

  const str = (v, max = 40) => (typeof v === 'string' ? v.slice(0, max) : undefined);

  function handleWs(ws, msg, reply, reqId) {
    if (msg.type === 'auth') {
      const u = auth.resolveSession(db, str(msg.token, 100));
      if (!u) return ws.close(4001, 'unauthorized');
      if (u.is_banned) return ws.close(4003, 'banned');
      ws.user = u;
      if (!conns.has(u.id)) conns.set(u.id, new Set());
      conns.get(u.id).add(ws);
      reply({ type: 'hello', profile: publicProfile(u), reqId });
      const room = rooms.roomOf(u.id);
      if (room) room.join(u); // qayta ulanish — holat qayta yuboriladi
      return;
    }
    if (!ws.user) return reply({ type: 'error', code: 'unauthorized', reqId });
    const user = repo.getUser(ws.user.id);
    if (!user || user.is_banned) return ws.close(4003, 'banned');

    switch (msg.type) {
      case 'ping':
        return reply({ type: 'pong', t: Date.now(), reqId });
      case 'quick': {
        const ante = Number(msg.ante);
        if (!cfg.antes.includes(ante)) throw new GameError('invalid', 'Noto\'g\'ri stavka');
        const maxPlayers = [2, 3, 4, 5, 6].includes(msg.maxPlayers) ? msg.maxPlayers : 4;
        const { room } = rooms.quickPlay(user, ante, maxPlayers);
        return reply({ type: 'joined', roomId: room.id, code: room.code, reqId });
      }
      case 'create': {
        const ante = Number(msg.ante);
        const room = rooms.create(
          { ante, maxPlayers: Number(msg.maxPlayers) || 4, isPrivate: !!msg.isPrivate, fillBots: !!msg.fillBots, name: str(msg.name, 32) },
          user
        );
        try {
          rooms.join(room, user);
        } catch (e) {
          room.close();
          throw e;
        }
        return reply({ type: 'joined', roomId: room.id, code: room.code, reqId });
      }
      case 'join': {
        if (msg.code) {
          const { room } = rooms.joinByCode(str(msg.code, 12), user);
          return reply({ type: 'joined', roomId: room.id, code: room.code, reqId });
        }
        const room = rooms.rooms.get(str(msg.roomId, 64));
        if (!room || room.isPrivate) throw new GameError('not_found', 'Stol topilmadi');
        rooms.join(room, user);
        return reply({ type: 'joined', roomId: room.id, code: room.code, reqId });
      }
      case 'leave':
        rooms.leave(user.id);
        return reply({ type: 'ok', reqId });
      case 'sync': {
        const room = rooms.roomOf(user.id);
        return reply(room ? { type: 'state', state: room.viewFor(user.id), reqId } : { type: 'no_room', reqId });
      }
      case 'act': {
        const room = rooms.roomOf(user.id);
        if (!room) throw new GameError('not_member', 'Siz stolda emassiz');
        const a = msg.action || {};
        const action = { type: str(a.type, 10), to: Number.isSafeInteger(a.to) ? a.to : undefined };
        const r = room.act(user.id, action, { turnSeq: Number.isSafeInteger(msg.turnSeq) ? msg.turnSeq : undefined, actionId: str(msg.actionId, 40) });
        return reply({ type: 'ack', reqId, duplicate: !!r.duplicate });
      }
      case 'svara': {
        const room = rooms.roomOf(user.id);
        if (!room) throw new GameError('not_member', 'Siz stolda emassiz');
        const r = room.svaraDecision(user.id, !!msg.join);
        return reply({ type: 'ack', reqId, duplicate: !!r.duplicate });
      }
      default:
        return reply({ type: 'error', code: 'unknown_type', reqId });
    }
  }

  // o'lik ulanishlarni tozalash
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
    auth.purgeSessions(db);
  }, 30000);
  heartbeat.unref();

  function listen(port = cfg.port, host = cfg.host) {
    return new Promise((resolve) => server.listen(port, host, () => resolve(server.address())));
  }

  async function close() {
    clearInterval(heartbeat);
    rooms.shutdown();
    for (const ws of wss.clients) ws.terminate();
    await new Promise((r) => wss.close(() => r()));
    await new Promise((r) => server.close(() => r()));
    db.close();
  }

  return { server, wss, db, repo, rooms, listen, close, notify, publicProfile, errors };
}

module.exports = { createApp };

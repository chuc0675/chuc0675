/* Integratsion testlar: haqiqiy HTTP + WebSocket server, xotiradagi SQLite. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const { createApp } = require('../server/app');
const { buildConfig } = require('../server/config');
const { buildInitData } = require('../server/auth');
const { replyFor } = require('../bot/index.js');

const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
const ADMIN_TG = 9000;

function testConfig(over = {}) {
  const cfg = buildConfig({ BOT_TOKEN: TOKEN, ADMIN_IDS: String(ADMIN_TG), DB_PATH: ':memory:' });
  return Object.assign(cfg, {
    turnSeconds: 0.6,
    nextHandSeconds: 0.05,
    dealSeconds: 0.02,
    resultSeconds: 0.05,
    svaraDecisionSeconds: 0.2,
    npcFillSeconds: 0.15,
    disconnectGraceSec: 0.3,
    botThinkSeconds: 0.02,
    npcChurn: 0,
    ...over,
  });
}

async function start(over) {
  const app = createApp(testConfig(over), { logger: { info() {}, error() {} } });
  const addr = await app.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${addr.port}`;
  return { app, base, wsUrl: `ws://127.0.0.1:${addr.port}/ws` };
}

async function api(base, method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

async function login(base, tgId, name = 'U' + tgId) {
  const initData = buildInitData({ id: tgId, first_name: name }, TOKEN);
  const r = await api(base, 'POST', '/api/auth', { body: { initData } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

/** WebSocket mijoz: barcha xabarlarni yig'adi, waitFor bilan kutadi */
function client(wsUrl, token) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const c = { ws, msgs: [], waiters: [], state: null, n: 0 };
    c.send = (m) => ws.send(JSON.stringify(m));
    c.request = (m) => {
      const reqId = 'r' + ++c.n;
      c.send({ ...m, reqId });
      return c.waitFor((x) => x.reqId === reqId);
    };
    c.waitFor = (pred, ms = 4000) =>
      new Promise((res, rej) => {
        const found = c.msgs.find(pred);
        if (found) return res(found);
        const w = { pred, res };
        c.waiters.push(w);
        setTimeout(() => {
          c.waiters = c.waiters.filter((x) => x !== w);
          rej(new Error('waitFor timeout'));
        }, ms);
      });
    c.waitState = (pred, ms) => c.waitFor((m) => m.type === 'state' && pred(m.state), ms).then((m) => m.state);
    c.clear = () => (c.msgs = []);
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'state') c.state = m.state;
      c.msgs.push(m);
      for (const w of [...c.waiters]) if (w.pred(m)) {
        c.waiters = c.waiters.filter((x) => x !== w);
        w.res(m);
      }
    });
    ws.on('open', () => {
      c.send({ type: 'auth', token });
      c.waitFor((m) => m.type === 'hello').then(() => resolve(c), reject);
    });
    ws.on('error', reject);
  });
}

const myTurn = (s) => s && s.status === 'PLAYING' && s.you && s.you.legal.length > 0;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Ikki odamli yopiq stol */
async function twoPlayerTable(ctx) {
  const A = await login(ctx.base, 101, 'Ali');
  const B = await login(ctx.base, 102, 'Vali');
  const a = await client(ctx.wsUrl, A.token);
  const b = await client(ctx.wsUrl, B.token);
  const created = await a.request({ type: 'create', ante: 10, maxPlayers: 2, isPrivate: true, fillBots: false });
  assert.equal(created.type, 'joined');
  const joined = await b.request({ type: 'join', code: created.code });
  assert.equal(joined.type, 'joined');
  return { A, B, a, b, code: created.code };
}

/** Navbat kimda bo'lsa o'sha "check/call" qiladi — qo'l tugaguncha */
async function playOut(clients) {
  for (let i = 0; i < 40; i++) {
    const turn = clients.find((c) => myTurn(c.state));
    if (!turn) {
      if (clients.some((c) => c.state && ['ROUND_END', 'FINISHED'].includes(c.state.status))) return;
      await new Promise((r) => setTimeout(r, 30));
      continue;
    }
    const s = turn.state;
    const a = s.you.legal.find((x) => x.type === 'check') || s.you.legal.find((x) => x.type === 'call');
    await turn.request({ type: 'act', action: a, turnSeq: s.turnSeq, actionId: 'x' + Math.random() });
    await new Promise((r) => setTimeout(r, 20));
  }
}

/* ======================================================================== */

test('auth: haqiqiy initData qabul qilinadi, soxtasi va tokensiz so\'rov rad etiladi', async () => {
  const ctx = await start();
  try {
    const ok = await login(ctx.base, 1, 'Ali');
    assert.equal(ok.profile.balance, 1000);
    const bad = await api(ctx.base, 'POST', '/api/auth', { body: { initData: buildInitData({ id: 2, first_name: 'X' }, '1:WRONG') } });
    assert.equal(bad.status, 401);
    const dev = await api(ctx.base, 'POST', '/api/auth', { body: { dev: { id: 3 } } });
    assert.equal(dev.status, 401, 'DEV_AUTH o\'chiq bo\'lsa dev login ishlamaydi');
    assert.equal((await api(ctx.base, 'GET', '/api/me')).status, 401);
    assert.equal((await api(ctx.base, 'GET', '/api/me', { token: 'x'.repeat(43) })).status, 401);
    const me = await api(ctx.base, 'GET', '/api/me', { token: ok.token });
    assert.equal(me.body.profile.name, 'Ali');
  } finally {
    await ctx.app.close();
  }
});

test('multiplayer: ikki o\'yinchi, yashirin kartalar sizmaydi, chiplar saqlanadi, tarix yoziladi', async () => {
  const ctx = await start();
  try {
    const { A, B, a, b } = await twoPlayerTable(ctx);
    await a.waitState((s) => s.status === 'PLAYING');
    await b.waitState((s) => s.status === 'PLAYING');
    const sa = a.state;
    const meA = sa.players.find((p) => p.id === sa.you.id);
    assert.equal(meA.cards.length, 3, 'o\'z kartalari ko\'rinadi');
    assert.ok(Number.isInteger(meA.score));
    // qo'l bazaga yozilguncha o'ynaymiz (durang bo'lsa svara davom etadi)
    const gamesSaved = () => ctx.app.db.prepare('SELECT COUNT(*) c FROM games').get().c;
    for (let i = 0; i < 100 && gamesSaved() === 0; i++) {
      await playOut([a, b]);
      await new Promise((r) => setTimeout(r, 50));
    }

    // B ga yuborilgan BARCHA xabarlarda A ning kartalari faqat showdownda bo'lishi mumkin
    const aId = 'u' + A.profile.id;
    for (const m of b.msgs.filter((x) => x.type === 'state')) {
      const pa = m.state.players.find((p) => p.id === aId);
      if (pa && pa.cards) assert.equal(m.state.status, 'ROUND_END', 'raqib kartasi faqat ochilishda');
      assert.ok(!JSON.stringify(m.state).includes('"rng"'));
    }
    // chiplar: balans + stoldagi = 2000
    const db = ctx.app.db;
    await new Promise((r) => setTimeout(r, 100));
    const total = db.prepare('SELECT SUM(balance) s FROM users').get().s + (db.prepare('SELECT SUM(stack) s FROM room_seats').get().s || 0);
    assert.equal(total, 2000);
    assert.ok(db.prepare('SELECT COUNT(*) c FROM games').get().c >= 1);
    assert.ok(db.prepare('SELECT COUNT(*) c FROM game_actions').get().c >= 3);
    const h = await api(ctx.base, 'GET', '/api/history', { token: B.token });
    assert.ok(h.body.items.length >= 1);
  } finally {
    await ctx.app.close();
  }
});

test('validatsiya: navbatdan tashqari, noto\'g\'ri, eskirgan va takroriy harakatlar', async () => {
  const ctx = await start({ turnSeconds: 5 });
  try {
    const { a, b } = await twoPlayerTable(ctx);
    await a.waitState((s) => s.status === 'PLAYING');
    await b.waitState((s) => s.status === 'PLAYING');
    const [turn, other] = myTurn(a.state) ? [a, b] : [b, a];
    let r = await other.request({ type: 'act', action: { type: 'check' }, turnSeq: other.state.turnSeq });
    assert.equal(r.code, 'not_your_turn');
    r = await turn.request({ type: 'act', action: { type: 'raise', to: 99999 }, turnSeq: turn.state.turnSeq });
    assert.equal(r.code, 'illegal');
    r = await turn.request({ type: 'act', action: { type: 'check' }, turnSeq: turn.state.turnSeq - 1 });
    assert.equal(r.code, 'stale');
    r = await turn.request({ type: 'act', action: { type: 'hack' } });
    assert.equal(r.code, 'illegal');

    const raise = turn.state.you.legal.find((x) => x.type === 'raise');
    const seq = turn.state.turnSeq;
    const r1 = await turn.request({ type: 'act', action: raise, turnSeq: seq, actionId: 'same-1' });
    assert.equal(r1.type, 'ack');
    const r2 = await turn.request({ type: 'act', action: raise, turnSeq: seq, actionId: 'same-1' });
    assert.equal(r2.duplicate, true, 'takroriy so\'rov qayta bajarilmaydi');
    const s = await other.waitState((x) => x.currentBet === raise.to);
    assert.equal(s.pot, 20 + raise.to, 'stavka faqat bir marta yechildi');
  } finally {
    await ctx.app.close();
  }
});

test('qayta ulanish: uzilib qayta kirgan o\'yinchi o\'z kartalari bilan davom etadi', async () => {
  const ctx = await start({ turnSeconds: 5, disconnectGraceSec: 5 });
  try {
    const { B, a, b } = await twoPlayerTable(ctx);
    await b.waitState((s) => s.status === 'PLAYING');
    const before = b.state.players.find((p) => p.id === b.state.you.id).cards;
    b.ws.close();
    const sa = await a.waitState((s) => s.players.some((p) => p.id === 'u' + B.profile.id && p.connected === false));
    assert.ok(sa);
    const b2 = await client(ctx.wsUrl, B.token);
    const s = await b2.waitState((x) => x.status === 'PLAYING');
    assert.deepEqual(s.players.find((p) => p.id === s.you.id).cards, before);
    await a.waitState((x) => x.players.every((p) => p.connected));
  } finally {
    await ctx.app.close();
  }
});

test('uzilib qaytmagan o\'yinchi: vaqt tugashi bilan pas, stoldan chiqariladi, chiplar balansga qaytadi', async () => {
  const ctx = await start({ turnSeconds: 0.3, disconnectGraceSec: 0.2 });
  try {
    const { B, a, b } = await twoPlayerTable(ctx);
    await b.waitState((s) => s.status === 'PLAYING');
    a.clear(); // faqat uzilishdan keyingi xabarlarni kutamiz
    b.ws.close();
    await a.waitState((s) => s.players.length === 1, 6000);
    const u = ctx.app.repo.getUser(B.profile.id);
    assert.ok(!ctx.app.db.prepare('SELECT 1 FROM room_seats WHERE user_id = ?').get(B.profile.id));
    const total = ctx.app.db.prepare('SELECT SUM(balance) s FROM users').get().s + (ctx.app.db.prepare('SELECT SUM(stack) s FROM room_seats').get().s || 0);
    assert.equal(total, 2000);
    assert.ok(u.balance > 0);
  } finally {
    await ctx.app.close();
  }
});

test('vaqt chegarasi: javob bermagan o\'yinchi uchun avtomatik harakat', async () => {
  const ctx = await start({ turnSeconds: 0.25 });
  try {
    const { a, b } = await twoPlayerTable(ctx);
    await a.waitState((s) => s.status === 'PLAYING');
    // hech kim harakat qilmaydi — server o'zi "o'tish" qiladi va qo'l tugaydi
    const s = await a.waitState((x) => x.status === 'ROUND_END', 4000);
    assert.ok(s.result);
    assert.ok(b.state);
  } finally {
    await ctx.app.close();
  }
});

test('tez o\'yin: yolg\'iz o\'yinchiga NPC lar qo\'shiladi, ularning kartalari ko\'rinmaydi', async () => {
  const ctx = await start({ turnSeconds: 0.3 });
  try {
    const A = await login(ctx.base, 201, 'Solo');
    const a = await client(ctx.wsUrl, A.token);
    const r = await a.request({ type: 'quick', ante: 10, maxPlayers: 4 });
    assert.equal(r.type, 'joined');
    const s = await a.waitState((x) => x.players.length === 4 && x.status === 'PLAYING', 5000);
    for (const p of s.players) {
      if (p.id !== s.you.id) assert.equal(p.cards, null);
      if (p.id !== s.you.id) assert.ok(p.name && p.flag);
    }
    const list = await api(ctx.base, 'GET', '/api/rooms');
    assert.equal(list.body.items.length, 1);
    assert.equal(list.body.items[0].humans, 1);
  } finally {
    await ctx.app.close();
  }
});

test('balans yetarli bo\'lmasa stolga o\'tirib bo\'lmaydi; bir vaqtda ikki stol taqiqlangan', async () => {
  const ctx = await start();
  try {
    const A = await login(ctx.base, 301);
    ctx.app.repo.changeBalance(A.profile.id, -995, 'admin');
    const a = await client(ctx.wsUrl, A.token);
    let r = await a.request({ type: 'quick', ante: 10 });
    assert.equal(r.code, 'insufficient');
    assert.equal(ctx.app.rooms.rooms.size, 0, 'muvaffaqiyatsiz stol yaratilmay qoldi yoki yopildi');

    const B = await login(ctx.base, 302);
    const b = await client(ctx.wsUrl, B.token);
    const r1 = await b.request({ type: 'create', ante: 10, isPrivate: true });
    const C = await login(ctx.base, 303);
    const c = await client(ctx.wsUrl, C.token);
    const r2 = await c.request({ type: 'create', ante: 10, isPrivate: true });
    r = await b.request({ type: 'join', code: r2.code });
    assert.equal(r.code, 'seated');
    assert.ok(r1.code);
    r = await b.request({ type: 'join', code: 'ZZZZZZ' });
    assert.equal(r.code, 'not_found');
  } finally {
    await ctx.app.close();
  }
});

test('bir vaqtda ko\'p ulanish: joylar soni oshib ketmaydi, ortiqchasi yangi stolga tushadi', async () => {
  const ctx = await start({ npcFillSeconds: 5 });
  try {
    const users = await Promise.all([1, 2, 3, 4, 5, 6, 7].map((i) => login(ctx.base, 400 + i)));
    const cs = await Promise.all(users.map((u) => client(ctx.wsUrl, u.token)));
    const res = await Promise.all(cs.map((c) => c.request({ type: 'quick', ante: 10, maxPlayers: 3 })));
    assert.ok(res.every((r) => r.type === 'joined'));
    for (const r of ctx.app.rooms.rooms.values()) assert.ok(r.humans().length <= 3);
    assert.equal(sum([...ctx.app.rooms.rooms.values()].map((r) => r.humans().length)), 7);
  } finally {
    await ctx.app.close();
  }
});

test('stoldan chiqish: chiplar balansga qaytadi', async () => {
  const ctx = await start({ npcFillSeconds: 10 });
  try {
    const A = await login(ctx.base, 501);
    const a = await client(ctx.wsUrl, A.token);
    await a.request({ type: 'quick', ante: 10 });
    assert.equal(ctx.app.repo.getUser(A.profile.id).balance, 0, 'buy-in band qilindi (1000)');
    await a.request({ type: 'leave' });
    await a.waitFor((m) => m.type === 'left');
    assert.equal(ctx.app.repo.getUser(A.profile.id).balance, 1000);
    assert.equal(ctx.app.rooms.rooms.size, 0, 'bo\'sh stol yopildi');
  } finally {
    await ctx.app.close();
  }
});

test('bonus: ikkinchi marta darhol olinmaydi', async () => {
  const ctx = await start();
  try {
    const A = await login(ctx.base, 601);
    assert.equal((await api(ctx.base, 'POST', '/api/bonus', { token: A.token })).status, 200);
    const r = await api(ctx.base, 'POST', '/api/bonus', { token: A.token });
    assert.equal(r.status, 429);
    assert.ok(r.body.nextAt > Date.now());
    assert.equal(ctx.app.repo.getUser(A.profile.id).balance, 1500);
  } finally {
    await ctx.app.close();
  }
});

test('admin: ruxsat serverda tekshiriladi; ban ulanishni uzadi va kirishni bloklaydi', async () => {
  const ctx = await start();
  try {
    const U = await login(ctx.base, 701, 'Oddiy');
    const ADM = await login(ctx.base, ADMIN_TG, 'Admin');
    assert.equal(ADM.profile.isAdmin, true);
    assert.equal(U.profile.isAdmin, false);
    assert.equal((await api(ctx.base, 'GET', '/api/admin/overview', { token: U.token })).status, 403);
    assert.equal((await api(ctx.base, 'GET', '/api/admin/overview')).status, 401);
    const ov = await api(ctx.base, 'GET', '/api/admin/overview', { token: ADM.token });
    assert.equal(ov.status, 200);
    assert.equal(ov.body.users, 2);

    const u = await client(ctx.wsUrl, U.token);
    const closed = new Promise((r) => u.ws.on('close', (code) => r(code)));
    const ban = await api(ctx.base, 'POST', '/api/admin/ban', { token: ADM.token, body: { userId: U.profile.id, reason: 'test' } });
    assert.equal(ban.status, 200);
    assert.equal(await closed, 4003);
    assert.equal((await api(ctx.base, 'GET', '/api/me', { token: U.token })).status, 401);
    const again = await api(ctx.base, 'POST', '/api/auth', { body: { initData: buildInitData({ id: 701, first_name: 'O' }, TOKEN) } });
    assert.equal(again.status, 403);
    // shikoyat
    const rep = await api(ctx.base, 'POST', '/api/report', { token: ADM.token, body: { targetUserId: U.profile.id, reason: 'haqorat' } });
    assert.equal(rep.status, 200);
    const reports = await api(ctx.base, 'GET', '/api/admin/reports', { token: ADM.token });
    assert.equal(reports.body.items.length, 1);
  } finally {
    await ctx.app.close();
  }
});

test('rate limit: WebSocket xabarlar oqimi cheklanadi', async () => {
  const ctx = await start();
  try {
    const A = await login(ctx.base, 801);
    const a = await client(ctx.wsUrl, A.token);
    for (let i = 0; i < 40; i++) a.send({ type: 'ping' });
    await a.waitFor((m) => m.code === 'rate_limited');
  } finally {
    await ctx.app.close();
  }
});

test('xatoliklarda ichki tafsilotlar chiqmaydi; statik fayllarda path traversal yo\'q', async () => {
  const ctx = await start();
  try {
    const r = await fetch(ctx.base + '/..%2f..%2fpackage.json');
    assert.ok([403, 404].includes(r.status));
    const bad = await fetch(ctx.base + '/api/auth', { method: 'POST', body: '{bad' });
    const j = await bad.json();
    assert.equal(bad.status, 400);
    assert.ok(!JSON.stringify(j).includes('at '));
    assert.equal((await fetch(ctx.base + '/%E0')).status, 400, 'noto\'g\'ri kodlangan URL serverni yiqitmaydi');
    const spa = await fetch(ctx.base + '/biror%20sahifa');
    assert.equal(spa.status, 200, 'kengaytmasiz yo\'l bosh sahifani qaytaradi');
    assert.ok((await spa.text()).includes('<title>Svara</title>'));
    assert.equal((await fetch(ctx.base + '/yoq.js')).status, 404);
    const idx = await fetch(ctx.base + '/');
    assert.equal(idx.status, 200);
    assert.ok(idx.headers.get('content-security-policy').includes("frame-ancestors"));
  } finally {
    await ctx.app.close();
  }
});

test('server qulab tushsa: stoldagi chiplar qayta ishga tushganda qaytariladi', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'svara-'));
  const dbPath = path.join(dir, 'db.sqlite');
  const ctx = await start({ dbPath, npcFillSeconds: 10 });
  const A = await login(ctx.base, 901);
  const a = await client(ctx.wsUrl, A.token);
  await a.request({ type: 'quick', ante: 10 });
  assert.equal(ctx.app.repo.getUser(A.profile.id).balance, 0);
  // "qulash": stollarni yopmasdan to'xtatamiz
  for (const r of ctx.app.rooms.rooms.values()) {
    clearTimeout(r.timer);
    clearTimeout(r.fillTimer);
    for (const m of r.members.values()) clearTimeout(m.graceTimer);
    r.members.clear();
  }
  a.ws.terminate();
  ctx.app.wss.close();
  await new Promise((r) => ctx.app.server.close(r));
  ctx.app.db.close();

  const ctx2 = await start({ dbPath });
  try {
    assert.equal(ctx2.app.repo.getUser(A.profile.id).balance, 1000);
  } finally {
    await ctx2.app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('bot: /start room_KOD deep link stolga olib kiradi', () => {
  const r = replyFor({ text: '/start room_ABC234', chat: { id: 1 } }, 'https://x.example/app/');
  assert.equal(r.reply_markup.inline_keyboard[0][0].web_app.url, 'https://x.example/app/?room=ABC234');
  const p = replyFor({ text: '/start', chat: { id: 1 } }, 'https://x.example/app/');
  assert.equal(p.reply_markup.inline_keyboard[0][0].web_app.url, 'https://x.example/app/');
  assert.equal(replyFor({ text: '/start room_<script>', chat: { id: 1 } }, 'https://x/').reply_markup.inline_keyboard[0][0].web_app.url, 'https://x/');
  assert.equal(replyFor({ text: 'salom', chat: { id: 1 } }, 'https://x/'), null);
});

/** A avtomatik javob beradi (navbati kelsa o'tish/tenglash), B umuman o'ynamaydi */
function autoPlay(c) {
  let stop = false;
  (async () => {
    while (!stop) {
      const s = c.state;
      if (myTurn(s)) {
        const a = s.you.legal.find((x) => x.type === 'check') || s.you.legal.find((x) => x.type === 'call');
        await c.request({ type: 'act', action: a, turnSeq: s.turnSeq }).catch(() => {});
      }
      if (s && s.you && s.you.canJoinSvara) await c.request({ type: 'svara', join: false }).catch(() => {});
      await new Promise((r) => setTimeout(r, 20));
    }
  })();
  return () => (stop = true);
}

test('faol bo\'lmagan o\'yinchi: 2 marta javobsiz — majburiy pas, stoldan chiqariladi, boshqalarga xabar', async () => {
  const ctx = await start({ turnSeconds: 0.25, idleKickTurns: 2, disconnectGraceSec: 30 });
  let stopA = () => {};
  try {
    const { B, a, b } = await twoPlayerTable(ctx);
    stopA = autoPlay(a);
    const kicked = await a.waitFor((m) => m.type === 'notice' && m.code === 'player_kicked', 8000);
    assert.match(kicked.message, /Vali/);
    await b.waitFor((m) => m.type === 'notice' && m.code === 'idle');
    await b.waitFor((m) => m.type === 'left', 8000);
    stopA();
    const db = ctx.app.db;
    assert.ok(!db.prepare('SELECT 1 FROM room_seats WHERE user_id = ?').get(B.profile.id), 'B stoldan chiqarildi');
    // ikkinchi javobsizlikda "o'tish" emas, majburiy pas bo'lgan
    const forced = db.prepare("SELECT type FROM game_actions WHERE user_id = ? AND forced = 1 ORDER BY id").all(B.profile.id).map((r) => r.type);
    assert.equal(forced[forced.length - 1], 'fold');
    const total = db.prepare('SELECT SUM(balance) s FROM users').get().s + (db.prepare('SELECT SUM(stack) s FROM room_seats').get().s || 0);
    assert.equal(total, 2000, 'chiplar yo\'qolmaydi');
    assert.ok(ctx.app.repo.getUser(B.profile.id).balance > 0, 'qolgan chiplar balansga qaytdi');
    assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'idle_kick'").get());
  } finally {
    stopA();
    await ctx.app.close();
  }
});

test('aloqasi uzilgan o\'yinchi uchun qisqa yurish vaqti — stol to\'xtab qolmaydi', async () => {
  const ctx = await start({ turnSeconds: 30, disconnectedTurnSeconds: 0.2, disconnectGraceSec: 30 });
  let stopA = () => {};
  try {
    const { a, b } = await twoPlayerTable(ctx);
    await b.waitState((s) => s.status === 'PLAYING');
    b.ws.close();
    stopA = autoPlay(a);
    const t0 = Date.now();
    await a.waitState((s) => s.status === 'ROUND_END', 6000);
    stopA();
    assert.ok(Date.now() - t0 < 6000, '30 soniya emas, qisqa vaqtda tugadi');
  } finally {
    stopA();
    await ctx.app.close();
  }
});

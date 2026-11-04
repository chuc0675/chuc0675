const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createRepo, LedgerError } = require('../server/repo');
const { buildConfig } = require('../server/config');
const auth = require('../server/auth');

const TOKEN = '123456:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz';
const cfg = buildConfig({ START_BALANCE: '1000', BONUS_AMOUNT: '500' });
const fresh = () => createRepo(openDb(':memory:'), cfg);

/* ---------------- Telegram auth ---------------- */
test('initData: to\'g\'ri imzo qabul qilinadi', () => {
  const data = auth.buildInitData({ id: 42, first_name: 'Ali' }, TOKEN, { extra: { start_param: 'ROOM12' } });
  const r = auth.validateInitData(data, TOKEN);
  assert.equal(r.user.id, 42);
  assert.equal(r.startParam, 'ROOM12');
});

test('initData: soxta imzo, boshqa token va o\'zgartirilgan user rad etiladi', () => {
  const data = auth.buildInitData({ id: 42, first_name: 'Ali' }, TOKEN);
  assert.throws(() => auth.validateInitData(data, '999:OTHER'), { code: 'signature' });
  const p = new URLSearchParams(data);
  p.set('user', JSON.stringify({ id: 1, first_name: 'Hacker' }));
  assert.throws(() => auth.validateInitData(p.toString(), TOKEN), { code: 'signature' });
  p.set('hash', 'zz');
  assert.throws(() => auth.validateInitData(p.toString(), TOKEN), { code: 'signature' });
  assert.throws(() => auth.validateInitData('', TOKEN), { code: 'invalid' });
});

test('initData: eskirgan auth_date rad etiladi', () => {
  const data = auth.buildInitData({ id: 42, first_name: 'Ali' }, TOKEN, { authDate: Math.floor(Date.now() / 1000) - 90000 });
  assert.throws(() => auth.validateInitData(data, TOKEN, { maxAgeSec: 86400 }), { code: 'expired' });
});

test('initData: Telegram\'ning rasmiy namunaviy ma\'lumoti bilan mos (signature maydoni bilan)', () => {
  // signature maydoni bo'lgan initData ham to'g'ri tekshiriladi
  const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 7, first_name: 'S' }), signature: 'abc' });
  const crypto = require('node:crypto');
  const dcs = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  params.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  assert.equal(auth.validateInitData(params.toString(), TOKEN).user.id, 7);
});

test('sessiya: yaratish, topish, noto\'g\'ri token', () => {
  const repo = fresh();
  const u = repo.upsertTelegramUser({ id: 5, first_name: 'Vali' });
  const t = auth.createSession(repo.db, u.id, 60);
  assert.equal(auth.resolveSession(repo.db, t).id, u.id);
  assert.equal(auth.resolveSession(repo.db, t + 'x'), null);
  assert.equal(auth.resolveSession(repo.db, null), null);
});

/* ---------------- Profil va ledger ---------------- */
test('birinchi kirishda profil yaratiladi va boshlang\'ich balans beriladi (bir marta)', () => {
  const repo = fresh();
  const u = repo.upsertTelegramUser({ id: 77, first_name: 'Ali', username: 'ali' });
  assert.equal(u.balance, 1000);
  assert.ok(u._created);
  const again = repo.upsertTelegramUser({ id: 77, first_name: 'Ali2' });
  assert.equal(again.balance, 1000);
  assert.equal(again.first_name, 'Ali2');
  assert.equal(repo.transactions(u.id).length, 1);
});

test('balans manfiy bo\'lmaydi, yetarli bo\'lmasa rad etiladi', () => {
  const repo = fresh();
  const u = repo.upsertTelegramUser({ id: 1, first_name: 'A' });
  assert.throws(() => repo.changeBalance(u.id, -1001, 'buyin'), (e) => e instanceof LedgerError && e.code === 'insufficient');
  assert.equal(repo.getUser(u.id).balance, 1000);
  repo.changeBalance(u.id, -1000, 'buyin');
  assert.equal(repo.getUser(u.id).balance, 0);
});

test('idempotentlik: bir xil kalit bilan takroriy yozuv balansni o\'zgartirmaydi', () => {
  const repo = fresh();
  const u = repo.upsertTelegramUser({ id: 1, first_name: 'A' });
  repo.changeBalance(u.id, 100, 'admin', { key: 'k1' });
  const r = repo.changeBalance(u.id, 100, 'admin', { key: 'k1' });
  assert.ok(r.duplicate);
  assert.equal(repo.getUser(u.id).balance, 1100);
});

test('bonus: cooldown serverda tekshiriladi', () => {
  const repo = fresh();
  const u = repo.upsertTelegramUser({ id: 1, first_name: 'A' });
  const t0 = Date.now();
  repo.claimBonus(u.id, t0);
  assert.throws(() => repo.claimBonus(u.id, t0 + 1000), { code: 'cooldown' });
  repo.claimBonus(u.id, t0 + cfg.bonusCooldownSec * 1000 + 1);
  assert.equal(repo.getUser(u.id).balance, 2000);
});

test('stol: buy-in, bir vaqtda ikki stolga o\'tirib bo\'lmaydi, cash-out va tiklash', () => {
  const repo = fresh();
  const u = repo.upsertTelegramUser({ id: 1, first_name: 'A' });
  repo.saveRoom({ id: 'r1', code: 'AAA111', name: 'x', ante: 10, maxPlayers: 6 });
  repo.saveRoom({ id: 'r2', code: 'BBB222', name: 'y', ante: 10, maxPlayers: 6 });
  repo.seatBuyIn(u.id, 'r1', 400);
  assert.equal(repo.getUser(u.id).balance, 600);
  assert.throws(() => repo.seatBuyIn(u.id, 'r2', 100), { code: 'seated' });
  assert.equal(repo.getUser(u.id).balance, 600, 'xato bo\'lganda tranzaksiya bekor qilinadi');
  repo.seatUpdateStacks('r1', [{ userId: u.id, stack: 450 }]);
  // server "qulab tushdi" — qayta ishga tushganda chiplar qaytadi
  assert.equal(repo.recoverSeats(), 1);
  assert.equal(repo.getUser(u.id).balance, 1050);
  assert.equal(repo.seatCashOut(u.id, 'r1'), null, 'ikki marta qaytarilmaydi');
});

test('migratsiyalar qayta ishga tushirilganda takrorlanmaydi', () => {
  const { migrate } = require('../server/db');
  const db = openDb(':memory:');
  migrate(db);
  migrate(db);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schema_migrations').get().c, 1);
});

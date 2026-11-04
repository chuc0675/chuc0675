'use strict';
/**
 * Ma'lumotlar bazasi bilan ishlash: foydalanuvchilar, balans ledgeri, tarix.
 * Har bir balans o'zgarishi `transactions` ga yoziladi va tranzaksiya ichida bajariladi.
 * node:sqlite sinxron — bitta jarayonda so'rovlar aralashib ketmaydi; BEGIN IMMEDIATE
 * esa bir nechta jarayon uchun ham yozishni ketma-ket qiladi.
 */
const { tx } = require('./db');

class LedgerError extends Error {
  constructor(code, message, extra = null) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

function createRepo(db, cfg) {
  const q = {
    userByTg: db.prepare('SELECT * FROM users WHERE tg_id = ?'),
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    insertUser: db.prepare(
      `INSERT INTO users (tg_id, username, first_name, last_name, photo_url, language, balance, created_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ),
    updateProfile: db.prepare(
      'UPDATE users SET username = ?, first_name = ?, last_name = ?, photo_url = ?, language = ?, last_seen_at = ? WHERE id = ?'
    ),
    addBalance: db.prepare('UPDATE users SET balance = balance + ? WHERE id = ? AND balance + ? >= 0'),
    txByKey: db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?'),
    insertTx: db.prepare(
      `INSERT INTO transactions (user_id, type, amount, balance_after, ref_type, ref_id, idempotency_key, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ),
    audit: db.prepare('INSERT INTO audit_log (user_id, action, details, ip, created_at) VALUES (?, ?, ?, ?, ?)'),
  };

  const str = (v, max) => (v == null ? null : String(v).slice(0, max));

  function audit(userId, action, details = null, ip = null) {
    q.audit.run(userId ?? null, action, details == null ? null : JSON.stringify(details).slice(0, 2000), ip, Date.now());
  }

  /** Telegram foydalanuvchisini topish yoki birinchi kirishda yaratish */
  function upsertTelegramUser(tg) {
    return tx(db, () => {
      const now = Date.now();
      let u = q.userByTg.get(tg.id);
      const fields = [str(tg.username, 64), str(tg.first_name || 'O\'yinchi', 64), str(tg.last_name, 64), str(tg.photo_url, 512), str(tg.language_code, 8)];
      if (!u) {
        const r = q.insertUser.run(tg.id, ...fields, now, now);
        const id = Number(r.lastInsertRowid);
        changeBalance(id, cfg.startBalance, 'signup', { key: `signup:${id}` });
        audit(id, 'signup', { tg_id: tg.id });
        u = q.userById.get(id);
        u._created = true;
      } else {
        q.updateProfile.run(...fields, now, u.id);
        u = q.userById.get(u.id);
      }
      return u;
    });
  }

  /**
   * Balansni o'zgartirish (atomik). `key` berilsa — idempotent: bir xil kalit bilan
   * takroriy chaqiruv balansni qayta o'zgartirmaydi, avvalgi yozuvni qaytaradi.
   */
  function changeBalance(userId, amount, type, { refType = null, refId = null, key = null } = {}) {
    if (!Number.isSafeInteger(amount)) throw new LedgerError('invalid', 'Noto\'g\'ri summa');
    return tx(db, () => {
      if (key) {
        const prev = q.txByKey.get(key);
        if (prev) return { ...prev, duplicate: true };
      }
      const r = q.addBalance.run(amount, userId, amount);
      if (r.changes === 0) {
        if (!q.userById.get(userId)) throw new LedgerError('no_user', 'Foydalanuvchi topilmadi');
        throw new LedgerError('insufficient', 'Balans yetarli emas');
      }
      const { balance } = q.userById.get(userId);
      const now = Date.now();
      const ins = q.insertTx.run(userId, type, amount, balance, refType, refId == null ? null : String(refId), key, now);
      return { id: Number(ins.lastInsertRowid), user_id: userId, type, amount, balance_after: balance, created_at: now };
    });
  }

  function claimBonus(userId, now = Date.now()) {
    return tx(db, () => {
      const u = q.userById.get(userId);
      const next = (u.last_bonus_at || 0) + cfg.bonusCooldownSec * 1000;
      if (now < next) throw new LedgerError('cooldown', 'Bonus hali tayyor emas', { nextAt: next });
      db.prepare('UPDATE users SET last_bonus_at = ? WHERE id = ?').run(now, userId);
      // kalit vaqt oynasiga bog'langan — parallel ikki so'rov ikki marta bermaydi
      const slot = Math.floor(now / (cfg.bonusCooldownSec * 1000));
      return changeBalance(userId, cfg.bonusAmount, 'bonus', { key: `bonus:${userId}:${slot}` });
    });
  }

  /* ---------- stol chiplari (room_seats) ---------- */
  function seatBuyIn(userId, roomId, amount) {
    return tx(db, () => {
      if (db.prepare('SELECT 1 FROM room_seats WHERE user_id = ?').get(userId)) {
        throw new LedgerError('seated', 'Siz boshqa stolda o\'tiribsiz');
      }
      const t = changeBalance(userId, -amount, 'buyin', { refType: 'room', refId: roomId });
      db.prepare('INSERT INTO room_seats (room_id, user_id, stack, joined_at) VALUES (?, ?, ?, ?)').run(roomId, userId, amount, Date.now());
      return t;
    });
  }

  function seatUpdateStacks(roomId, stacks /* [{userId, stack}] */) {
    tx(db, () => {
      const st = db.prepare('UPDATE room_seats SET stack = ? WHERE room_id = ? AND user_id = ?');
      for (const s of stacks) st.run(s.stack, roomId, s.userId);
    });
  }

  /** Stoldan turish: chiplar balansga qaytadi */
  function seatCashOut(userId, roomId, stack, type = 'cashout') {
    return tx(db, () => {
      const seat = db.prepare('SELECT * FROM room_seats WHERE room_id = ? AND user_id = ?').get(roomId, userId);
      if (!seat) return null;
      db.prepare('DELETE FROM room_seats WHERE room_id = ? AND user_id = ?').run(roomId, userId);
      const amount = stack ?? seat.stack;
      if (amount > 0) return changeBalance(userId, amount, type, { refType: 'room', refId: roomId });
      return { amount: 0 };
    });
  }

  /** Server ishga tushganda: yopilmay qolgan stollardagi chiplarni qaytarish */
  function recoverSeats() {
    const seats = db.prepare('SELECT * FROM room_seats').all();
    for (const s of seats) seatCashOut(s.user_id, s.room_id, s.stack, 'refund');
    db.prepare("UPDATE rooms SET status = 'closed', closed_at = ? WHERE status != 'closed'").run(Date.now());
    return seats.length;
  }

  /* ---------- o'yin tarixi ---------- */
  function saveRoom(r) {
    db.prepare(
      `INSERT INTO rooms (id, code, name, is_private, ante, max_players, fill_bots, created_by, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    ).run(r.id, r.code, r.name, r.isPrivate ? 1 : 0, r.ante, r.maxPlayers, r.fillBots ? 1 : 0, r.createdBy ?? null, Date.now());
  }
  function closeRoom(id) {
    db.prepare("UPDATE rooms SET status = 'closed', closed_at = ? WHERE id = ?").run(Date.now(), id);
  }

  /**
   * Qo'l natijasini saqlash: games + game_players + game_actions + stack'lar + statistika.
   * Hammasi bitta tranzaksiyada.
   */
  function saveHand({ roomId, handNo, ante, rules, pot, resultType, svaraRounds, startedAt, players, actions }) {
    return tx(db, () => {
      const g = db
        .prepare(
          `INSERT INTO games (room_id, hand_no, ante, pot, result_type, svara_rounds, rules_json, started_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(roomId, handNo, ante, pot, resultType, svaraRounds, JSON.stringify(rules), startedAt, Date.now());
      const gameId = Number(g.lastInsertRowid);
      const gp = db.prepare(
        `INSERT INTO game_players (game_id, seat, user_id, npc_name, stack_before, stack_after, delta, score, cards, is_winner)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const stat = db.prepare(
        `UPDATE users SET games_played = games_played + 1, wins = wins + ?, losses = losses + ?,
           net_won = net_won + ?, biggest_win = MAX(biggest_win, ?), xp = xp + ? WHERE id = ?`
      );
      const seat = db.prepare('UPDATE room_seats SET stack = ? WHERE room_id = ? AND user_id = ?');
      players.forEach((p, i) => {
        gp.run(gameId, i, p.userId ?? null, p.userId ? null : p.name, p.before, p.after, p.after - p.before, p.score ?? null, p.cards ?? null, p.winner ? 1 : 0);
        if (p.userId) {
          const d = p.after - p.before;
          stat.run(p.winner ? 1 : 0, p.winner ? 0 : 1, d, Math.max(0, d), p.winner ? 15 : 5, p.userId);
          seat.run(p.after, roomId, p.userId);
        }
      });
      const ga = db.prepare(
        `INSERT INTO game_actions (game_id, seq, player_ref, user_id, svara_round, type, amount, to_amount, forced)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      actions.forEach((a, i) =>
        ga.run(gameId, i, String(a.playerId), a.userId ?? null, a.svaraRound || 0, a.type, a.amount || 0, a.to ?? null, a.forced ? 1 : 0)
      );
      return gameId;
    });
  }

  function history(userId, limit = 20) {
    return db
      .prepare(
        `SELECT g.id, g.room_id, g.ante, g.pot, g.result_type, g.finished_at, gp.delta, gp.score, gp.is_winner,
                (SELECT COUNT(*) FROM game_players x WHERE x.game_id = g.id) AS players
         FROM game_players gp JOIN games g ON g.id = gp.game_id
         WHERE gp.user_id = ? ORDER BY g.id DESC LIMIT ?`
      )
      .all(userId, limit);
  }

  function leaderboard(by = 'net_won', limit = 50) {
    const col = { net_won: 'net_won', wins: 'wins', xp: 'xp' }[by] || 'net_won';
    return db
      .prepare(
        `SELECT id, first_name, username, photo_url, wins, games_played, net_won, xp
         FROM users WHERE is_banned = 0 AND games_played > 0 ORDER BY ${col} DESC, id ASC LIMIT ?`
      )
      .all(limit);
  }

  function transactions(userId, limit = 30) {
    return db.prepare('SELECT id, type, amount, balance_after, ref_type, ref_id, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, limit);
  }

  return {
    db,
    audit,
    getUser: (id) => q.userById.get(id),
    getUserByTg: (tgId) => q.userByTg.get(tgId),
    upsertTelegramUser,
    changeBalance,
    claimBonus,
    seatBuyIn,
    seatUpdateStacks,
    seatCashOut,
    recoverSeats,
    saveRoom,
    closeRoom,
    saveHand,
    history,
    leaderboard,
    transactions,
  };
}

module.exports = { createRepo, LedgerError };

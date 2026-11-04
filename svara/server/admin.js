'use strict';
/**
 * Admin API. Ruxsat serverda tekshiriladi: foydalanuvchining Telegram IDsi
 * ADMIN_IDS ro'yxatida bo'lishi shart. Har bir o'zgartiruvchi amal audit_log ga yoziladi.
 */
function createAdmin({ repo, db, cfg, rooms, conns, errors, startedAt, kickUser, HttpError }) {
  function routes(requireUser, readJson) {
    const requireAdmin = (req) => {
      const u = requireUser(req);
      if (!cfg.adminIds.includes(u.tg_id)) throw new HttpError(403, 'forbidden', 'Ruxsat yo\'q');
      return u;
    };
    const int = (v) => (Number.isSafeInteger(Number(v)) ? Number(v) : null);

    return {
      'GET /api/admin/overview': (req) => {
        requireAdmin(req);
        const now = Date.now();
        const one = (sql, ...a) => db.prepare(sql).get(...a).c;
        return {
          users: one('SELECT COUNT(*) c FROM users'),
          activeUsers15m: one('SELECT COUNT(*) c FROM users WHERE last_seen_at > ?', now - 15 * 60e3),
          bannedUsers: one('SELECT COUNT(*) c FROM users WHERE is_banned = 1'),
          online: conns.size,
          ...rooms.stats(),
          games24h: one('SELECT COUNT(*) c FROM games WHERE finished_at > ?', now - 86400e3),
          gamesTotal: one('SELECT COUNT(*) c FROM games'),
          openReports: one("SELECT COUNT(*) c FROM reports WHERE status = 'open'"),
          totalBalance: db.prepare('SELECT COALESCE(SUM(balance),0) c FROM users').get().c,
          server: {
            uptimeSec: Math.round((now - startedAt) / 1000),
            memoryMb: Math.round(process.memoryUsage().rss / 1048576),
            node: process.version,
          },
          errors: errors.slice(-20).reverse(),
        };
      },
      'GET /api/admin/rooms': (req) => {
        requireAdmin(req);
        return {
          items: [...rooms.rooms.values()].map((r) => ({
            ...r.summary(),
            code: r.code,
            handNo: r.table.handNo,
            pot: r.table.pot,
            createdAt: r.createdAt,
            members: [...r.members.values()].map((m) => {
              const p = r.player(m.userId);
              return { userId: m.userId, name: p && p.name, chips: p && p.chips, connected: m.connected, leaving: m.leaving };
            }),
          })),
        };
      },
      'GET /api/admin/games': (req, ip, url) => {
        requireAdmin(req);
        const limit = Math.min(100, int(url.searchParams.get('limit')) || 30);
        const games = db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT ?').all(limit);
        const pl = db.prepare(
          `SELECT gp.*, u.first_name FROM game_players gp LEFT JOIN users u ON u.id = gp.user_id WHERE gp.game_id = ? ORDER BY gp.seat`
        );
        return { items: games.map((g) => ({ ...g, rules_json: undefined, players: pl.all(g.id) })) };
      },
      'GET /api/admin/users': (req, ip, url) => {
        requireAdmin(req);
        const q = String(url.searchParams.get('q') || '').slice(0, 64);
        const like = `%${q}%`;
        const items = db
          .prepare(
            `SELECT id, tg_id, username, first_name, balance, games_played, wins, net_won, is_banned, ban_reason, last_seen_at, created_at
             FROM users WHERE (? = '' OR first_name LIKE ? OR username LIKE ? OR CAST(tg_id AS TEXT) = ?)
             ORDER BY last_seen_at DESC LIMIT 100`
          )
          .all(q, like, like, q)
          .map((u) => ({ ...u, is_admin: cfg.adminIds.includes(u.tg_id) }));
        return { items };
      },
      'POST /api/admin/ban': async (req, ip) => {
        const admin = requireAdmin(req);
        const b = await readJson(req);
        const userId = int(b.userId);
        const ban = b.ban !== false;
        const u = userId && repo.getUser(userId);
        if (!u) throw new HttpError(404, 'not_found', 'Foydalanuvchi topilmadi');
        if (cfg.adminIds.includes(u.tg_id)) throw new HttpError(400, 'invalid', 'Adminni cheklab bo\'lmaydi');
        db.prepare('UPDATE users SET is_banned = ?, ban_reason = ? WHERE id = ?').run(ban ? 1 : 0, ban ? String(b.reason || '').slice(0, 200) : null, userId);
        if (ban) {
          db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
          kickUser(userId, 'banned');
        }
        repo.audit(admin.id, ban ? 'admin_ban' : 'admin_unban', { userId, reason: b.reason }, ip);
        return { ok: true };
      },
      'POST /api/admin/balance': async (req, ip) => {
        const admin = requireAdmin(req);
        const b = await readJson(req);
        const userId = int(b.userId);
        const amount = int(b.amount);
        if (!userId || !amount || Math.abs(amount) > 1e9) throw new HttpError(400, 'invalid', 'Noto\'g\'ri qiymat');
        const t = repo.changeBalance(userId, amount, 'admin', { refType: 'admin', refId: admin.id });
        repo.audit(admin.id, 'admin_balance', { userId, amount, note: String(b.note || '').slice(0, 200) }, ip);
        return { ok: true, balance: t.balance_after };
      },
      'GET /api/admin/reports': (req) => {
        requireAdmin(req);
        return {
          items: db
            .prepare(
              `SELECT r.*, a.first_name AS reporter_name, t.first_name AS target_name
               FROM reports r LEFT JOIN users a ON a.id = r.reporter_id LEFT JOIN users t ON t.id = r.target_user_id
               ORDER BY r.status = 'open' DESC, r.id DESC LIMIT 100`
            )
            .all(),
        };
      },
      'POST /api/admin/reports/resolve': async (req, ip) => {
        const admin = requireAdmin(req);
        const b = await readJson(req);
        const id = int(b.id);
        const r = db.prepare("UPDATE reports SET status = 'resolved' WHERE id = ?").run(id);
        if (!r.changes) throw new HttpError(404, 'not_found', 'Shikoyat topilmadi');
        repo.audit(admin.id, 'admin_report_resolve', { id }, ip);
        return { ok: true };
      },
      'GET /api/admin/audit': (req) => {
        requireAdmin(req);
        return { items: db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 200').all() };
      },
    };
  }
  return { routes };
}

module.exports = { createAdmin };

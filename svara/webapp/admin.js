(() => {
  'use strict';
  // Token Mini App'dan (Profil → Admin panel) sessionStorage orqali keladi.
  let token = null;
  try { token = sessionStorage.getItem('svara_token') || localStorage.getItem('svara_token'); } catch (_) {}
  const main = document.getElementById('main');
  let tab = 'overview';
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dt = (t) => (t ? new Date(t).toLocaleString('ru-RU') : '—');
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');

  async function api(path, body) {
    const res = await fetch(path, {
      method: body ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(j.message || res.status), { status: res.status });
    return j;
  }

  const table = (cols, rows) =>
    `<div class="wrap"><table><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${
      rows.length ? rows.join('') : `<tr><td colspan="${cols.length}" class="muted">Bo'sh</td></tr>`
    }</tbody></table></div>`;

  const views = {
    async overview() {
      const o = await api('/api/admin/overview');
      const s = (v, l) => `<div class="stat"><b>${fmt(v)}</b><span>${l}</span></div>`;
      return `<div class="cards">
        ${s(o.users, 'Foydalanuvchilar')}${s(o.activeUsers15m, 'Faol (15 daq)')}${s(o.online, 'Onlayn ulanish')}
        ${s(o.rooms, 'Ochiq stollar')}${s(o.seatedPlayers, 'Stoldagi o\'yinchilar')}${s(o.activeHands, 'Ketayotgan qo\'llar')}
        ${s(o.games24h, 'O\'yinlar (24 soat)')}${s(o.gamesTotal, 'Jami o\'yinlar')}${s(o.openReports, 'Ochiq shikoyatlar')}
        ${s(o.bannedUsers, 'Cheklanganlar')}${s(o.totalBalance, 'Jami balans (virtual)')}${s(o.server.memoryMb, 'Xotira, MB')}
      </div>
      <p class="muted">Ishlash vaqti: ${Math.round(o.server.uptimeSec / 60)} daq · Node ${esc(o.server.node)}</p>
      <h3>Oxirgi xatolar</h3>
      ${table(['Vaqt', 'Joy', 'Xabar'], o.errors.map((e) => `<tr><td>${dt(e.at)}</td><td>${esc(e.where)}</td><td>${esc(e.message)}</td></tr>`))}`;
    },
    async rooms() {
      const { items } = await api('/api/admin/rooms');
      return table(['Stol', 'Kod', 'Ante', 'Holat', 'O\'yinchilar', 'Qo\'l', 'Bank'], items.map((r) => `<tr>
        <td>${esc(r.name)} ${r.isPrivate ? '<span class="pill">yopiq</span>' : ''}</td><td>${esc(r.code)}</td><td>${r.ante}</td>
        <td>${esc(r.status)}</td><td>${r.players} (odam: ${r.humans})<br><span class="muted">${r.members.map((m) => `${esc(m.name)} ${fmt(m.chips)}${m.connected ? '' : ' ⚠'}`).join(', ')}</span></td>
        <td>${r.handNo}</td><td>${fmt(r.pot)}</td></tr>`));
    },
    async games() {
      const { items } = await api('/api/admin/games?limit=50');
      return table(['#', 'Vaqt', 'Ante', 'Bank', 'Natija', 'O\'yinchilar'], items.map((g) => `<tr>
        <td>${g.id}</td><td>${dt(g.finished_at)}</td><td>${g.ante}</td><td>${fmt(g.pot)}</td><td>${esc(g.result_type)}${g.svara_rounds ? ` · svara ×${g.svara_rounds}` : ''}</td>
        <td>${g.players.map((p) => `${p.is_winner ? '🏆 ' : ''}${esc(p.first_name || p.npc_name)}${p.user_id ? '' : ' <span class="pill">NPC</span>'} <span class="muted">${esc(p.cards || '')} (${p.score ?? '–'})</span> ${p.delta > 0 ? '+' : ''}${p.delta}`).join('<br>')}</td></tr>`));
    },
    async users() {
      const q = (document.getElementById('q') || {}).value || '';
      const { items } = await api('/api/admin/users?q=' + encodeURIComponent(q));
      return `<p><input id="q" placeholder="Ism, username yoki Telegram ID" value="${esc(q)}"> <button class="btn" id="search">Qidirish</button></p>` +
        table(['ID', 'Ism', 'Balans', 'O\'yin', 'G\'alaba', 'Sof', 'Oxirgi', ''], items.map((u) => `<tr>
          <td>${u.id}<br><span class="muted">${u.tg_id}</span></td><td>${esc(u.first_name)} ${u.username ? '@' + esc(u.username) : ''}
          ${u.is_banned ? `<br><span class="pill red">cheklangan</span> <span class="muted">${esc(u.ban_reason)}</span>` : ''}</td>
          <td>${fmt(u.balance)}</td><td>${u.games_played}</td><td>${u.wins}</td><td>${fmt(u.net_won)}</td><td>${dt(u.last_seen_at)}</td>
          <td>${u.is_banned ? `<button class="btn ok" data-unban="${u.id}">Ochish</button>` : `<button class="btn danger" data-ban="${u.id}">Cheklash</button>`}</td></tr>`));
    },
    async reports() {
      const { items } = await api('/api/admin/reports');
      return table(['#', 'Vaqt', 'Kimdan', 'Kim haqida', 'Sabab', 'Holat'], items.map((r) => `<tr>
        <td>${r.id}</td><td>${dt(r.created_at)}</td><td>${esc(r.reporter_name)}</td><td>${esc(r.target_name || '—')} ${r.target_user_id ? `<span class="muted">#${r.target_user_id}</span>` : ''}</td>
        <td>${esc(r.reason)}</td><td>${r.status === 'open' ? `<button class="btn ok" data-resolve="${r.id}">Hal qilindi</button>` : '<span class="pill ok">hal qilingan</span>'}</td></tr>`));
    },
    async audit() {
      const { items } = await api('/api/admin/audit');
      return table(['Vaqt', 'Foydalanuvchi', 'Amal', 'Tafsilot', 'IP'], items.map((a) => `<tr>
        <td>${dt(a.created_at)}</td><td>${a.user_id ?? '—'}</td><td>${esc(a.action)}</td><td class="muted">${esc(a.details)}</td><td class="muted">${esc(a.ip)}</td></tr>`));
    },
  };

  async function show() {
    if (!token) {
      main.innerHTML = '<div id="msg">Admin panelni Mini App ichidan oching: <b>Profil → Admin panel</b>.</div>';
      return;
    }
    try {
      main.innerHTML = await views[tab]();
    } catch (e) {
      main.innerHTML = `<div id="msg">${e.status === 403 ? 'Sizda admin huquqi yo\'q.' : e.status === 401 ? 'Sessiya tugagan — Mini App\'ni qayta oching.' : 'Xatolik: ' + esc(e.message)}</div>`;
    }
  }

  document.getElementById('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    tab = b.dataset.t;
    document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
    show();
  });
  document.getElementById('refresh').addEventListener('click', show);
  main.addEventListener('click', async (e) => {
    const t = e.target;
    try {
      if (t.id === 'search') return show();
      if (t.dataset.ban) {
        const reason = prompt('Cheklash sababi:');
        if (reason === null) return;
        await api('/api/admin/ban', { userId: Number(t.dataset.ban), reason, ban: true });
      } else if (t.dataset.unban) {
        await api('/api/admin/ban', { userId: Number(t.dataset.unban), ban: false });
      } else if (t.dataset.resolve) {
        await api('/api/admin/reports/resolve', { id: Number(t.dataset.resolve) });
      } else return;
      show();
    } catch (err) {
      alert(err.message);
    }
  });
  main.addEventListener('keydown', (e) => e.target.id === 'q' && e.key === 'Enter' && show());
  show();
})();

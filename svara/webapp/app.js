(() => {
  'use strict';
  const E = window.SvaraEngine;
  const CFG = window.SVARA_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const WA = window.Telegram && window.Telegram.WebApp;
  const tg = WA && WA.initData ? WA : null; // oddiy brauzerda initData bo'sh
  const fmt = (n) => Number(n || 0).toLocaleString('ru-RU');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ======================= saqlash (faqat qulayliklar) ======================= */
  const ls = {
    get(k, d = null) { try { const v = localStorage.getItem('svara_' + k); return v === null ? d : JSON.parse(v); } catch (_) { return d; } },
    set(k, v) { try { localStorage.setItem('svara_' + k, JSON.stringify(v)); } catch (_) {} },
  };
  const settings = Object.assign({ sound: true, haptic: true }, ls.get('settings', {}));
  const saveSettings = () => ls.set('settings', settings);

  /* ======================= Telegram ======================= */
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#17080b'); tg.setBackgroundColor('#0b0405'); } catch (_) {}
    try { tg.setBottomBarColor && tg.setBottomBarColor('#0b0405'); } catch (_) {}
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (_) {}
  }
  const haptic = (kind) => {
    if (!settings.haptic || !tg || !tg.HapticFeedback) return;
    try {
      if (kind === 'win' || kind === 'error' || kind === 'warning') tg.HapticFeedback.notificationOccurred(kind === 'win' ? 'success' : kind);
      else tg.HapticFeedback.impactOccurred(kind || 'light');
    } catch (_) {}
  };

  /* ======================= tovush ======================= */
  let actx = null;
  function beep(freq, dur = 0.07, type = 'sine', vol = 0.05, delay = 0) {
    if (!settings.sound) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const t0 = actx.currentTime + delay;
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(actx.destination);
      o.start(t0); o.stop(t0 + dur);
    } catch (_) {}
  }
  const sfx = {
    card: () => beep(1100, 0.03, 'triangle', 0.035),
    deal: (n = 3) => { for (let i = 0; i < n; i++) beep(950 + i * 40, 0.03, 'triangle', 0.03, i * 0.07); },
    chip: () => { beep(1500, 0.03, 'square', 0.02); beep(1800, 0.03, 'square', 0.018, 0.04); },
    turn: () => { beep(660, 0.08, 'sine', 0.05); beep(880, 0.1, 'sine', 0.05, 0.09); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => beep(f, 0.13, 'triangle', 0.06, i * 0.09)),
    lose: () => [392, 294].forEach((f, i) => beep(f, 0.16, 'sawtooth', 0.025, i * 0.12)),
    svara: () => [440, 554, 440, 554].forEach((f, i) => beep(f, 0.09, 'square', 0.03, i * 0.1)),
  };

  /* ======================= holat ======================= */
  const app = {
    mode: 'offline', // online | offline
    net: null,
    serverCfg: null,
    profile: null,
    view: null,
    driver: null, // 'remote' | 'local'
    local: null,
    clockOffset: 0,
    leavingRoomId: null,
    screen: 'loading',
    pendingRoomCode: null,
  };
  const practice = {
    get chips() { return ls.get('practice_chips', 1000); },
    set chips(v) { ls.set('practice_chips', v); },
    stats: () => ls.get('practice_stats', { games: 0, wins: 0, net: 0, big: 0, history: [] }),
  };
  const meName = () => (tg && tg.initDataUnsafe.user ? tg.initDataUnsafe.user.first_name : 'Siz');
  const mePhoto = () => (tg && tg.initDataUnsafe.user && tg.initDataUnsafe.user.photo_url) || null;

  /* ======================= UI yordamchilar ======================= */
  const NAV_SCREENS = ['lobby', 'leaders', 'profile', 'settings'];
  function show(screen) {
    app.screen = screen;
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === screen));
    $('nav').classList.toggle('hidden', !NAV_SCREENS.includes(screen));
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.s === screen));
    if (tg) {
      if (screen === 'table' || (NAV_SCREENS.includes(screen) && screen !== 'lobby')) tg.BackButton.show();
      else tg.BackButton.hide();
      try {
        if (screen === 'table') tg.enableClosingConfirmation();
        else tg.disableClosingConfirmation();
      } catch (_) {}
    }
    if (screen === 'lobby') { renderLobby(); refreshRooms(); }
    if (screen === 'profile') loadProfile();
    if (screen === 'leaders') loadLeaders();
    if (screen === 'settings') renderSettings();
  }

  let toastT = null;
  function toast(text, err = false) {
    const t = $('toast');
    t.textContent = text;
    t.classList.toggle('err', err);
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function modal({ title, text = '', body = '', buttons = [{ text: 'OK' }], center = false, key = null }) {
    $('modal').dataset.key = key || '';
    $('modalTitle').textContent = title;
    $('modalText').textContent = text;
    $('modalBody').innerHTML = body;
    $('modalBody').onclick = null;
    $('modal').classList.toggle('center', center);
    const box = $('modalBtns');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = 'btn ' + (b.cls || (b.primary ? 'gold' : ''));
      el.textContent = b.text;
      el.addEventListener('click', () => {
        haptic('light');
        closeModal();
        b.fn && b.fn();
      });
      box.appendChild(el);
    }
    $('modal').classList.add('show');
  }
  function closeModal() {
    $('modal').classList.remove('show');
    $('modal').dataset.key = '';
  }
  const modalKey = () => ($('modal').classList.contains('show') ? $('modal').dataset.key : null);

  function fatal(title, text, { retry = true, offline = true } = {}) {
    $('fatalTitle').textContent = title;
    $('fatalText').textContent = text;
    $('fatalRetry').classList.toggle('hidden', !retry);
    $('fatalOffline').classList.toggle('hidden', !offline);
    show('fatal');
  }

  function initials(name) {
    return String(name || '?').trim().split(/\s+/).map((w) => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
  }
  const COLORS = ['#8e44ad', '#b03a2e', '#2471a3', '#ca6f1e', '#148f77', '#6c3483', '#1f618d', '#a04000', '#7b241c'];
  function avatarHtml(p, extra = '', attrs = '') {
    const color = COLORS[Math.abs([...String(p.name || '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % COLORS.length];
    const safePhoto = p.photo && /^https:\/\//.test(p.photo) ? p.photo.replace(/['"()\\]/g, '') : null;
    const style = safePhoto ? `background-image:url('${esc(safePhoto)}')` : `background-color:${color}`;
    return `<div class="avatar" ${attrs} style="${style}">${safePhoto ? '' : esc(initials(p.name))}${extra}</div>`;
  }

  function cardHtml(c, { hidden = false, cls = '', style = '' } = {}) {
    if (hidden || !c) return `<div class="card back ${cls}" style="${style}"></div>`;
    const red = c.suit === '♥' || c.suit === '♦';
    const joker = E.isJoker(c);
    return `<div class="card ${red ? 'red' : ''} ${joker ? 'joker' : ''} ${cls}" style="${style}">` +
      `<span class="c1">${esc(c.rank)}<s>${esc(c.suit)}</s></span><span class="mid">${esc(c.suit)}</span><span class="c2">${esc(c.rank)}<s>${esc(c.suit)}</s></span></div>`;
  }

  /* ======================= tarmoq ======================= */
  function setupNet() {
    app.net = window.SvaraNet.createClient({ base: CFG.serverUrl || '', onMessage, onStatus });
  }

  let reconnectShowT = null;
  async function onStatus(s, info) {
    if (s === 'open') {
      clearTimeout(reconnectShowT);
      $('reconnect').classList.remove('show');
      setModeBadge();
      if (app.pendingRoomCode) {
        const code = app.pendingRoomCode;
        app.pendingRoomCode = null;
        joinByCode(code);
      }
    } else if (s === 'reconnecting') {
      setModeBadge();
      $('reconnectText').textContent = `Qayta ulanmoqda… (${info.attempt})`;
      clearTimeout(reconnectShowT);
      reconnectShowT = setTimeout(() => app.net.status !== 'open' && $('reconnect').classList.add('show'), 900);
    } else if (s === 'unauthorized') {
      // sessiya tugagan — Telegram ma'lumotlari bilan qayta kirish
      app.net.clearToken();
      try {
        await authenticate();
        app.net.connect();
      } catch (e) {
        $('reconnect').classList.remove('show');
        fatal('Kirish xatosi', e.message);
      }
    } else if (s === 'banned') {
      $('reconnect').classList.remove('show');
      fatal('Hisob cheklangan', 'Sizning hisobingiz administrator tomonidan cheklangan.', { retry: false });
    }
  }

  function onMessage(m) {
    switch (m.type) {
      case 'hello':
        setProfile(m.profile);
        break;
      case 'state':
        if (app.leavingRoomId && m.state.room.id === app.leavingRoomId) return;
        if (app.driver === 'local') return;
        app.driver = 'remote';
        receiveView(m.state);
        break;
      case 'profile':
        setProfile(m.profile);
        break;
      case 'left':
        if (app.driver === 'remote' && (!app.view || app.view.room.id === m.roomId)) {
          app.view = null;
          app.driver = null;
          if (app.screen === 'table') show('lobby');
        }
        app.leavingRoomId = null;
        refreshProfile();
        break;
      case 'notice':
        toast(m.message, m.code !== 'npc');
        if (m.code === 'broke' || m.code === 'idle') haptic('warning');
        break;
      case 'error':
        if (!m.reqId && m.code !== 'rate_limited') toast(m.message || 'Xatolik', true);
        break;
    }
  }

  async function authenticate() {
    if (tg) return finishLogin(await app.net.login({ initData: tg.initData }));
    if (app.serverCfg && app.serverCfg.devAuth) {
      let id = ls.get('dev_id');
      if (!id) { id = 100000 + Math.floor(Math.random() * 899999); ls.set('dev_id', id); }
      return finishLogin(await app.net.login({ dev: { id, name: 'Mehmon ' + String(id).slice(-4) } }));
    }
    const err = new Error('O\'yinni Telegram ichida oching (bot menyusidagi "O\'ynash" tugmasi).');
    err.code = 'no_telegram';
    throw err;
  }
  function finishLogin(r) {
    setProfile(r.profile);
    if (r.isNew) setTimeout(() => toast(`Xush kelibsiz! +${fmt(r.profile.balance)} chip`), 600);
    return r;
  }

  function setProfile(p) {
    app.profile = p;
    if (app.screen === 'lobby') renderLobby();
    if (app.screen === 'profile') renderProfile();
  }
  async function refreshProfile() {
    if (app.mode !== 'online') return;
    try { setProfile((await app.net.api('GET', '/api/me')).profile); } catch (_) {}
  }

  /* ======================= ishga tushirish ======================= */
  async function boot() {
    $('loadingFan').innerHTML = [{ rank: '7', suit: '♥' }, { rank: '7', suit: '♣' }, { rank: '7', suit: '♦' }].map((c) => cardHtml(c)).join('');
    $('heroDeco').innerHTML = cardHtml({ rank: 'A', suit: '♠' }) + cardHtml({ rank: '7', suit: '♣' });
    $('aboutVersion').textContent = 'Versiya ' + (CFG.version || '');
    show('loading');
    setupNet();
    const startParam = (tg && tg.initDataUnsafe.start_param) || new URLSearchParams(location.search).get('room');
    if (startParam && /^(room_)?[A-Z2-9]{6}$/i.test(startParam)) app.pendingRoomCode = startParam.replace(/^room_/i, '').toUpperCase();

    $('loadingText').textContent = 'Serverga ulanmoqda…';
    try {
      app.serverCfg = await app.net.api('GET', '/api/config', null, { timeout: 5000 });
    } catch (_) {
      app.serverCfg = null;
    }
    if (!app.serverCfg) return enterOffline(true);

    try {
      $('loadingText').textContent = 'Kirilmoqda…';
      await authenticate();
    } catch (e) {
      if (e.code === 'banned') return fatal('Hisob cheklangan', 'Hisobingiz administrator tomonidan cheklangan.', { retry: false });
      if (e.code === 'no_telegram') return fatal('Telegram kerak', e.message, { retry: true, offline: true });
      if (e.code === 'network') return enterOffline(true);
      return fatal('Kirish xatosi', e.message || 'Telegram ma\'lumotlari tasdiqlanmadi.');
    }
    app.mode = 'online';
    app.net.connect();
    show('lobby');
  }

  function enterOffline(showBanner) {
    app.mode = 'offline';
    app.profile = null;
    if (app.net) app.net.close();
    show('lobby');
    if (showBanner) toast('Server bilan aloqa yo\'q — mashq rejimi');
  }

  /* ======================= lobbi ======================= */
  const lobbyState = { ante: ls.get('ante', 10), size: ls.get('size', 4) };
  const antes = () => (app.serverCfg && app.serverCfg.antes) || [10, 50, 100, 500];

  function setModeBadge() {
    const b = $('modeBadge');
    if (app.mode === 'online') {
      const ok = app.net.status === 'open';
      b.className = 'badge ' + (ok ? 'on' : 'off');
      b.textContent = ok ? 'Onlayn' : 'Ulanmoqda…';
    } else {
      b.className = 'badge off';
      b.textContent = 'Oflayn';
    }
  }

  function renderLobby() {
    const online = app.mode === 'online';
    document.querySelectorAll('#lobby .online-only').forEach((el) => el.classList.toggle('hidden', !online));
    $('offlineBanner').classList.toggle('hidden', online);
    const p = app.profile;
    const me = p ? { name: p.name, photo: p.photo } : { name: meName(), photo: mePhoto() };
    $('meName').textContent = me.name;
    $('meAvatar').outerHTML = avatarHtml(me, '', 'id="meAvatar"');
    $('meBalance').textContent = fmt(online ? (p ? p.balance + (p.atTable || 0) : 0) : practice.chips);
    setModeBadge();
    if (!antes().includes(lobbyState.ante)) lobbyState.ante = antes()[0];
    $('anteSeg').innerHTML = antes().map((a) => `<button data-v="${a}" class="${a === lobbyState.ante ? 'on' : ''}">${fmt(a)}</button>`).join('');
    document.querySelectorAll('#sizeSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === lobbyState.size));
    $('heroText').textContent = online
      ? 'Bo\'sh stolga qo\'shiling. Jonli o\'yinchi bo\'lmasa, NPC\'lar o\'tiradi.'
      : 'Oflayn rejim: NPC\'lar bilan mashq.';
    $('quickBtn').textContent = app.view && app.driver ? '↩ Stolga qaytish' : online ? '▶ O\'ynash' : '▶ Mashq o\'yini';
  }

  function segPick(id, key) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      haptic('light');
      lobbyState[key] = Number(b.dataset.v);
      ls.set(key, lobbyState[key]);
      [...$(id).children].forEach((x) => x.classList.toggle('on', x === b));
    });
  }
  segPick('anteSeg', 'ante');
  segPick('sizeSeg', 'size');

  let roomsTimer = null;
  async function refreshRooms() {
    clearTimeout(roomsTimer);
    if (app.mode !== 'online' || app.screen !== 'lobby') return;
    try {
      const { items } = await app.net.api('GET', '/api/rooms');
      const box = $('roomList');
      if (!items.length) box.innerHTML = '<div class="empty">Hozircha ochiq stol yo\'q — birinchi bo\'ling!</div>';
      else {
        box.innerHTML = items
          .map((r) => {
            const dots = Array.from({ length: r.maxPlayers }, (_, i) => `<i class="${i < r.humans ? 'h' : i < r.players ? 'b' : ''}"></i>`).join('');
            return `<div class="room-item"><div class="grow"><b>${esc(r.name)}</b> <span class="muted small">· ante ${fmt(r.ante)} · ${r.humans} odam</span>
              <div class="seats">${dots}</div></div>
              <button class="btn sm gold" data-room="${esc(r.id)}" ${r.freeSeats > 0 ? '' : 'disabled'}>${r.freeSeats > 0 ? 'Kirish' : 'To\'la'}</button></div>`;
          })
          .join('');
      }
    } catch (_) {}
    roomsTimer = setTimeout(refreshRooms, 6000);
  }
  $('roomsRefresh').addEventListener('click', () => { haptic('light'); refreshRooms(); });
  $('roomList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-room]');
    if (!b) return;
    haptic('medium');
    guarded(() => app.net.request({ type: 'join', roomId: b.dataset.room }), 'Stolga ulanmoqda…');
  });

  async function guarded(fn, busyText) {
    if (app.mode === 'online' && app.net.status !== 'open') return toast('Server bilan aloqa yo\'q', true);
    if (app.driver === 'local') return toast('Avval mashq stolidan chiqing', true);
    if (busyText) toast(busyText);
    try {
      return await fn();
    } catch (e) {
      haptic('error');
      if (e.code === 'insufficient') {
        modal({ title: 'Chip yetarli emas', text: e.message + '. Bonus oling yoki kichikroq stavka tanlang.', buttons: [{ text: 'Yopish' }, { text: '🎁 Bonus', primary: true, fn: claimBonus }] });
      } else toast(e.message || 'Xatolik', true);
    }
  }

  $('quickBtn').addEventListener('click', () => {
    haptic('medium');
    if (app.view && app.driver) return show('table');
    if (app.mode === 'online') guarded(() => app.net.request({ type: 'quick', ante: lobbyState.ante, maxPlayers: lobbyState.size }), 'Stol qidirilmoqda…');
    else startPractice();
  });
  $('practiceBtn').addEventListener('click', () => {
    haptic('medium');
    if (app.view && app.driver === 'remote') return toast('Avval onlayn stoldan chiqing', true);
    startPractice();
  });

  $('createBtn').addEventListener('click', () => {
    haptic('light');
    const st = { priv: true, ante: lobbyState.ante, size: lobbyState.size, bots: false };
    const seg = (name, opts, cur) => `<div class="seg" data-f="${name}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
    modal({
      title: 'Yangi stol',
      center: true,
      body: `<div class="form">
        <span class="label">Turi</span>${seg('priv', [['1', '🔒 Yopiq'], ['0', '🌐 Ochiq']], '1')}
        <span class="label">Stavka</span>${seg('ante', antes().map((a) => [a, fmt(a)]), st.ante)}
        <span class="label">O'yinchilar</span>${seg('size', [2, 3, 4, 5, 6].map((n) => [n, n]), st.size)}
        <div class="switch" style="margin-top:8px"><span class="small">Bo'sh joylarga NPC qo'shish</span><button class="toggle" data-f="bots"></button></div>
      </div>`,
      buttons: [
        { text: 'Bekor' },
        { text: 'Yaratish', primary: true, fn: () => guarded(() => app.net.request({ type: 'create', ante: st.ante, maxPlayers: st.size, isPrivate: st.priv, fillBots: st.bots }), 'Stol yaratilmoqda…') },
      ],
    });
    $('modalBody').onclick = (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      const f = t.closest('[data-f]').dataset.f;
      if (f === 'bots') { st.bots = !st.bots; t.classList.toggle('on', st.bots); return; }
      [...t.parentNode.children].forEach((x) => x.classList.toggle('on', x === t));
      if (f === 'priv') st.priv = t.dataset.v === '1';
      if (f === 'ante') st.ante = Number(t.dataset.v);
      if (f === 'size') st.size = Number(t.dataset.v);
    };
  });

  function joinByCode(code) {
    code = String(code || '').trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) return toast('Kod 6 belgidan iborat', true);
    return guarded(() => app.net.request({ type: 'join', code }), 'Stolga ulanmoqda…');
  }
  $('codeBtn').addEventListener('click', () => { haptic('light'); joinByCode($('codeInput').value); $('codeInput').blur(); });
  $('codeInput').addEventListener('keydown', (e) => e.key === 'Enter' && $('codeBtn').click());
  $('codeInput').addEventListener('input', (e) => (e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '')));

  async function claimBonus() {
    haptic('light');
    if (app.mode === 'online') {
      try {
        const r = await app.net.api('POST', '/api/bonus');
        setProfile(r.profile);
        haptic('win'); sfx.win();
        toast(`🎁 +${fmt(r.amount)} chip!`);
      } catch (e) {
        if (e.code === 'cooldown') {
          const left = Math.max(0, ((e.data && e.data.nextAt) || 0) - Date.now());
          toast(`Keyingi bonus: ${Math.floor(left / 3.6e6)} soat ${Math.ceil((left % 3.6e6) / 6e4)} daqiqa`);
        } else toast(e.message, true);
      }
      return;
    }
    const next = ls.get('practice_bonus_at', 0) + 4 * 3.6e6;
    if (Date.now() < next) return toast('Mashq bonusi keyinroq tayyor bo\'ladi');
    practice.chips = practice.chips + 500;
    ls.set('practice_bonus_at', Date.now());
    sfx.win();
    toast('🎁 +500 mashq chipi');
    renderLobby();
  }
  $('bonusBtn').addEventListener('click', claimBonus);
  $('retryOnline').addEventListener('click', () => location.reload());

  /* ======================= mashq (oflayn) ======================= */
  function startPractice() {
    if (app.local) return show('table');
    const chips = practice.chips;
    const ante = [500, 100, 50, 10].find((a) => a <= lobbyState.ante && chips >= a * 2) || 10;
    if (chips < 20) {
      return modal({ title: 'Mashq chiplari tugadi', text: 'Bonus oling (har 4 soatda +500).', buttons: [{ text: 'Yopish' }, { text: '🎁 Bonus', primary: true, fn: claimBonus }] });
    }
    app.local = new window.SvaraLocal.LocalRoom({
      me: { name: meName(), photo: mePhoto(), chips },
      ante,
      size: lobbyState.size,
      onState: (v) => { app.driver = 'local'; receiveView(v); },
      onHandEnd: ({ chips: c, delta, won }) => {
        practice.chips = c;
        const s = practice.stats();
        s.games++; if (won) s.wins++; s.net += delta; s.big = Math.max(s.big, delta);
        s.history.unshift({ at: Date.now(), delta, won, sub: 'Mashq' });
        s.history = s.history.slice(0, 20);
        ls.set('practice_stats', s);
      },
      notify: (m) => toast(m.message, m.code === 'broke'),
    });
    app.local.start();
  }

  /* ======================= stol ======================= */
  let lastKeys = {};

  function receiveView(v) {
    app.clockOffset = v.serverNow - Date.now();
    const prev = app.view;
    app.view = v;
    if (!prev || prev.room.id !== v.room.id) lastKeys = {};
    if (app.screen !== 'table' && (!prev || prev.room.id !== v.room.id)) show('table');
    if (app.screen === 'table') renderTable(prev);
  }

  const myPlayer = (v) => (v && v.you ? v.players[v.you.seat] : null);

  function seatPositions(n) {
    const pos = [];
    for (let i = 0; i < n; i++) {
      const a = Math.PI / 2 + (i * 2 * Math.PI) / n;
      pos.push({ x: 50 + 39 * Math.cos(a), y: 44 + 38 * Math.sin(a) });
    }
    return pos;
  }

  function statusText(v) {
    const me = myPlayer(v);
    switch (v.status) {
      case 'WAITING_FOR_PLAYERS': {
        const left = v.deadline ? Math.max(0, Math.ceil((v.deadline - Date.now() - app.clockOffset) / 1000)) : null;
        if (v.room.fillBots && left !== null) return `O'yinchilar kutilmoqda… NPC'lar ${left} soniyadan keyin`;
        return v.room.code ? `O'yinchilar kutilmoqda · kod: ${v.room.code}` : 'O\'yinchilar kutilmoqda…';
      }
      case 'READY': return 'Qo\'l boshlanmoqda…';
      case 'DEALING': return v.svaraRound ? 'SVARA — kartalar qayta tarqatilmoqda' : 'Kartalar tarqatilmoqda…';
      case 'PLAYING': {
        const p = v.players[v.toAct];
        if (!p) return '';
        return me && p.id === me.id ? '🟡 Sizning navbatingiz' : `${p.name} o'ylamoqda…`;
      }
      case 'ROUND_END': {
        const r = v.result;
        if (!r) return '';
        if (r.type === 'svara') return 'SVARA! Ochkolar teng';
        const ws = r.winners.map((id) => v.players.find((p) => p.id === id)).filter(Boolean);
        const names = ws.map((p) => (me && p.id === me.id ? 'Siz' : p.name)).join(', ');
        if (r.type === 'split') return `Bank bo'lindi: ${names}`;
        const rev = ws[0] && r.revealed[ws[0].id];
        return `${names} yutdi${rev ? ' · ' + rev.label : ''} · +${fmt(r.pot)}`;
      }
      case 'FINISHED': return 'Keyingi qo\'l tayyorlanmoqda…';
      default: return '';
    }
  }

  function renderTable(prev) {
    const v = app.view;
    if (!v) return;
    const me = myPlayer(v);
    const n = v.players.length;
    const mySeat = v.you ? v.you.seat : 0;

    $('roomName').textContent = v.room.local ? 'Mashq stoli' : v.room.name;
    $('roomSub').textContent = (v.room.code && !v.room.local ? `KOD ${v.room.code} · ` : '') + `ANTE ${fmt(v.room.ante)}` + (v.handNo ? ` · #${v.handNo}` : '');
    $('inviteBtn').classList.toggle('hidden', !!v.room.local);
    $('statusLine').textContent = statusText(v);

    // animatsiya kalitlari (har biri bir marta)
    const dealKey = `${v.handNo}:${v.svaraRound}`;
    const isDealing = v.status === 'DEALING' && dealKey !== lastKeys.deal;
    if (isDealing) { lastKeys.deal = dealKey; sfx.deal(3); }
    const revealKey = v.result ? `${dealKey}:${v.result.type}` : '';
    const doFlip = !!v.result && revealKey !== lastKeys.reveal;
    if (doFlip) lastKeys.reveal = revealKey;

    const pos = seatPositions(Math.max(n, 2));
    const winners = v.result ? (v.result.winners.length ? v.result.winners : v.result.svaraPlayers) : [];
    let html = '';
    v.players.forEach((p, i) => {
      const vi = (i - mySeat + n) % n;
      const isMe = me && p.id === me.id;
      const cls = ['seat'];
      if (v.status === 'PLAYING' && i === v.toAct) cls.push('turn');
      if (p.inHand && p.folded) cls.push('folded');
      if (!p.inHand && ['DEALING', 'PLAYING', 'ROUND_END'].includes(v.status)) cls.push('out');
      if (winners.includes(p.id) && v.status === 'ROUND_END') cls.push('winner');
      const badges =
        (i === v.dealer && v.handNo ? '<span class="dealer">D</span>' : '') +
        (p.flag ? `<span class="flag">${esc(p.flag)}</span>` : '') +
        (p.level ? `<span class="lvl">${Number(p.level) || 1}</span>` : '') +
        (!p.connected ? '<span class="off" title="Aloqa uzilgan">📵</span>' : '');
      let cards = '';
      if (!isMe && p.inHand && p.cardCount) {
        const dx = Math.round((50 - pos[vi].x) * 3) + 'px';
        const dy = Math.round((42 - pos[vi].y) * 4) + 'px';
        cards = `<div class="cards">${Array.from({ length: p.cardCount }, (_, k) =>
          cardHtml(p.cards && p.cards[k], {
            hidden: !p.cards,
            cls: (isDealing ? 'deal ' : '') + (doFlip && p.cards ? 'flip' : ''),
            style: `--dx:${dx};--dy:${dy};animation-delay:${isDealing ? (k * n + vi) * 70 : k * 90}ms`,
          })
        ).join('')}</div>`;
      }
      const score = !isMe && p.score !== null && p.cards ? `<div class="score">${Number(p.score)}</div>` : '';
      const bet = p.bet ? `<div class="bet"><span class="chip-ico"></span>${fmt(p.bet)}</div>` : '';
      html += `<div class="${cls.join(' ')}" data-seat="${i}" style="left:${pos[vi].x}%;top:${pos[vi].y}%">
        <div class="act">${esc(p.leaving ? 'Chiqmoqda' : p.lastAction || '')}</div>
        <div class="ring">${avatarHtml(p, badges)}</div>
        <div class="plate"><div class="nm">${esc(isMe ? 'Siz' : p.name)}</div><div class="ch">${fmt(p.chips)}</div></div>
        ${bet}${cards}${score}</div>`;
    });
    $('seats').innerHTML = html;

    // bank
    const pot = $('pot');
    const svara = v.svaraRound > 0 || (v.result && v.result.type === 'svara');
    pot.classList.toggle('svara', !!svara);
    $('potLbl').textContent = svara ? 'SVARA' : 'BANK';
    if (prev && prev.room.id === v.room.id && v.pot > prev.pot && v.status === 'PLAYING') {
      pot.classList.remove('bump'); void pot.offsetWidth; pot.classList.add('bump');
      sfx.chip();
    }
    $('potVal').textContent = fmt(v.status === 'ROUND_END' && v.result ? v.result.pot : v.pot);
    $('potSub').textContent = v.currentBet ? `Stavka: ${fmt(v.currentBet)}` : `Ante: ${fmt(v.room.ante)}`;

    // mening kartalarim
    const hand = $('myHand');
    $('myChips').textContent = fmt(me ? me.chips : 0);
    if (me && me.inHand && me.cards) {
      const handKey = `${dealKey}:${me.cards.map((c) => c.rank + c.suit).join()}`;
      if (handKey !== lastKeys.hand || isDealing) {
        lastKeys.hand = handKey;
        hand.innerHTML = me.cards.map((c, k) => cardHtml(c, { cls: isDealing ? 'deal' : '', style: `--dy:-220px;animation-delay:${isDealing ? k * n * 70 : 0}ms` })).join('');
      }
      hand.classList.toggle('folded', !!me.folded);
      $('myScore').textContent = me.folded ? 'Pas' : me.handLabel || '';
    } else {
      lastKeys.hand = '';
      hand.innerHTML = '';
      hand.classList.remove('folded');
      $('myScore').textContent = me && !me.inHand && v.handNo && ['DEALING', 'PLAYING'].includes(v.status) ? 'Keyingi qo\'lni kuting' : '';
    }

    renderActions(v);
    handleEvents(v, me);
  }

  function renderActions(v) {
    const box = $('actions');
    const legal = (v.you && v.you.legal) || [];
    if (!legal.length) {
      let text = '';
      if (v.you && v.you.leaving) text = 'Stoldan chiqmoqdasiz…';
      else if (v.status === 'PLAYING' && v.players[v.toAct]) text = `${esc(v.players[v.toAct].name)} yurmoqda…`;
      else if (v.status === 'WAITING_FOR_PLAYERS' && v.room.code && !v.room.local) text = 'Do\'stlaringizni 📨 orqali taklif qiling';
      box.innerHTML = `<div class="wait">${text}</div>`;
      return;
    }
    const enc = (a) => esc(JSON.stringify(a));
    const parts = [];
    for (const a of legal) {
      if (a.type === 'fold') parts.push(`<button class="fold" data-a="${enc(a)}">Pas</button>`);
      if (a.type === 'check') parts.push(`<button class="call" data-a="${enc(a)}">O'tish</button>`);
      if (a.type === 'call') parts.push(`<button class="call" data-a="${enc(a)}">Tenglash<small>${fmt(a.amount)}</small></button>`);
    }
    for (const a of legal.filter((x) => x.type === 'raise')) parts.push(`<button class="raise" data-a="${enc(a)}">Oshirish<small>→ ${fmt(a.to)}</small></button>`);
    box.innerHTML = parts.join('');
  }

  let acting = false;
  $('actions').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-a]');
    if (!b || acting) return;
    const a = JSON.parse(b.dataset.a);
    haptic(a.type === 'fold' ? 'light' : 'medium');
    acting = true;
    [...$('actions').querySelectorAll('button')].forEach((x) => (x.disabled = true));
    try {
      if (app.driver === 'local') app.local.act({ type: a.type, to: a.to });
      else {
        const actionId = (crypto.randomUUID && crypto.randomUUID()) || String(Math.random()).slice(2);
        await app.net.request({ type: 'act', action: { type: a.type, to: a.to }, turnSeq: app.view.turnSeq, actionId });
      }
      a.type === 'fold' ? sfx.card() : sfx.chip();
    } catch (err) {
      toast(err.code === 'stale' ? 'Holat yangilandi' : err.message, true);
      if (app.driver === 'remote' && app.net.status === 'open') app.net.request({ type: 'sync' }).catch(() => {});
    } finally {
      acting = false;
      if (app.view) renderActions(app.view);
    }
  });

  function handleEvents(v, me) {
    const turnKey = `${v.handNo}:${v.turnSeq}`;
    if (v.you && v.you.legal.length && turnKey !== lastKeys.turn) {
      lastKeys.turn = turnKey;
      haptic('medium');
      sfx.turn();
    }
    const svKey = `${v.handNo}:${v.svaraRound}`;
    if (v.you && v.you.canJoinSvara && lastKeys.svaraModal !== svKey) {
      lastKeys.svaraModal = svKey;
      sfx.svara();
      haptic('warning');
      modal({
        key: 'svara',
        title: 'SVARA!',
        text: `Ochkolar teng chiqdi. Bank: ${fmt(v.result ? v.result.pot : v.pot)}.\n${fmt(v.you.svaraCost)} chip to'lab qayta o'yinga qo'shilasizmi?`,
        buttons: [
          { text: 'Yo\'q', fn: () => sendSvara(false) },
          { text: `Qo'shilish · ${fmt(v.you.svaraCost)}`, primary: true, fn: () => sendSvara(true) },
        ],
      });
    } else if (modalKey() === 'svara' && !(v.you && v.you.canJoinSvara)) closeModal();

    if (v.status === 'ROUND_END' && v.result) {
      const rk = `${svKey}:${v.result.type}`;
      if (rk !== lastKeys.result) {
        lastKeys.result = rk;
        if (v.result.type === 'svara') {
          if (!(v.you && v.you.canJoinSvara)) { sfx.svara(); toast('SVARA! Kartalar qayta tarqatiladi'); }
        } else {
          const iWon = me && v.result.winners.includes(me.id);
          if (iWon) { haptic('win'); sfx.win(); } else if (me && me.inHand) { haptic('error'); sfx.lose(); }
          flyChips(v.result.winners.map((id) => v.players.findIndex((p) => p.id === id)));
        }
      }
    }
  }

  async function sendSvara(join) {
    try {
      if (app.driver === 'local') app.local.svara(join);
      else await app.net.request({ type: 'svara', join });
    } catch (e) { toast(e.message, true); }
  }

  function flyChips(seatIdx) {
    const from = $('pot').getBoundingClientRect();
    seatIdx.forEach((si) => {
      const el = document.querySelector(`.seat[data-seat="${si}"] .avatar`);
      if (!el) return;
      const to = el.getBoundingClientRect();
      for (let k = 0; k < 6; k++) {
        const c = document.createElement('span');
        c.className = 'chip-ico flychip';
        c.style.left = from.left + from.width / 2 - 8 + (Math.random() * 30 - 15) + 'px';
        c.style.top = from.top + from.height / 2 - 8 + 'px';
        document.body.appendChild(c);
        requestAnimationFrame(() => requestAnimationFrame(() => {
          c.style.transitionDelay = k * 60 + 'ms';
          c.style.transform = `translate(${to.left + to.width / 2 - (from.left + from.width / 2)}px, ${to.top + to.height / 2 - (from.top + from.height / 2)}px)`;
          c.style.opacity = '0';
        }));
        setTimeout(() => c.remove(), 1500);
      }
    });
  }

  // vaqt halqasi va navbat chizig'i
  function tick() {
    const v = app.view;
    if (v && app.screen === 'table') {
      const now = Date.now() + app.clockOffset;
      const total = (v.turnSeconds || 25) * 1000;
      const left = v.deadline ? Math.max(0, v.deadline - now) : 0;
      const frac = v.status === 'PLAYING' && v.deadline ? Math.min(1, left / total) : 0;
      const turnEl = document.querySelector('.seat.turn');
      if (turnEl) turnEl.style.setProperty('--p', frac.toFixed(3));
      const mine = !!(v.you && v.you.legal.length);
      $('turnbar').classList.toggle('hidden', !mine);
      if (mine) $('turnbarFill').style.transform = `scaleX(${frac.toFixed(3)})`;
      if (v.status === 'WAITING_FOR_PLAYERS' && v.deadline) $('statusLine').textContent = statusText(v);
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // o'yinchiga bosish — shikoyat (faqat onlayn, odamlar uchun)
  $('seats').addEventListener('click', (e) => {
    const s = e.target.closest('.seat');
    if (!s || !app.view || app.driver !== 'remote') return;
    const p = app.view.players[Number(s.dataset.seat)];
    const me = myPlayer(app.view);
    if (!p || !p.userId || (me && p.id === me.id)) return;
    modal({
      title: p.name,
      text: `Daraja ${p.level} · ${fmt(p.chips)} chip`,
      center: true,
      buttons: [
        { text: 'Yopish' },
        {
          text: '⚠ Shikoyat',
          cls: 'red',
          fn: async () => {
            try {
              await app.net.api('POST', '/api/report', { targetUserId: p.userId, roomId: app.view && app.view.room.id, reason: 'Stolda noo\'rin xatti-harakat' });
              toast('Shikoyat yuborildi');
            } catch (err) { toast(err.message, true); }
          },
        },
      ],
    });
  });

  /* ---------- chiqish va taklif ---------- */
  function leaveTable() {
    const v = app.view;
    closeModal();
    if (!v) return show('lobby');
    if (app.driver === 'local') {
      practice.chips = app.local.leave();
      app.local = null;
      app.view = null;
      app.driver = null;
      return show('lobby');
    }
    const me = myPlayer(v);
    const inHand = me && me.inHand && !me.folded && ['DEALING', 'PLAYING', 'ROUND_END'].includes(v.status);
    app.net.request({ type: 'leave' }).catch(() => {});
    app.leavingRoomId = v.room.id;
    app.view = null;
    app.driver = null;
    show('lobby');
    if (inHand) toast('Pas qilindi. Qolgan chiplar qo\'l tugagach balansga qaytadi');
    setTimeout(refreshProfile, 800);
  }
  function confirmLeave() {
    const v = app.view;
    const me = myPlayer(v);
    const inHand = me && me.inHand && !me.folded && ['DEALING', 'PLAYING'].includes(v.status);
    if (inHand) {
      modal({ title: 'Stoldan chiqasizmi?', text: 'Qo\'l davom etmoqda — chiqsangiz pas hisoblanadi va tikilgan chiplar yo\'qoladi.', center: true, buttons: [{ text: 'Qolish' }, { text: 'Chiqish', cls: 'red', fn: leaveTable }] });
    } else leaveTable();
  }
  $('leaveBtn').addEventListener('click', () => { haptic('light'); confirmLeave(); });

  $('inviteBtn').addEventListener('click', async () => {
    haptic('light');
    const v = app.view;
    if (!v || !v.room.code) return;
    const bot = app.serverCfg && app.serverCfg.botUsername;
    const link = bot ? `https://t.me/${bot}?start=room_${v.room.code}` : null;
    const text = `Svara o'ynaymiz! 🃏 Stol kodi: ${v.room.code}`;
    if (tg && link) {
      tg.openTelegramLink(`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(link || v.room.code);
      toast(link ? 'Taklif havolasi nusxalandi' : `Kod nusxalandi: ${v.room.code}`);
    } catch (_) {
      modal({ title: 'Taklif kodi', text: `${v.room.code}${link ? '\n' + link : ''}`, center: true });
    }
  });

  /* ======================= navigatsiya ======================= */
  $('nav').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    haptic('light');
    show(b.dataset.s);
  });
  if (tg) {
    tg.BackButton.onClick(() => {
      if ($('modal').classList.contains('show') && modalKey() !== 'svara') return closeModal();
      if (app.screen === 'table') return confirmLeave();
      if (NAV_SCREENS.includes(app.screen)) show('lobby');
    });
  }
  $('fatalRetry').addEventListener('click', () => location.reload());
  $('fatalOffline').addEventListener('click', () => enterOffline(false));

  /* ======================= profil ======================= */
  async function loadProfile() {
    renderProfile();
    if (app.mode !== 'online') return;
    try {
      const [me, h, t] = await Promise.all([app.net.api('GET', '/api/me'), app.net.api('GET', '/api/history'), app.net.api('GET', '/api/transactions')]);
      setProfile(me.profile);
      renderHistory(h.items.map((x) => ({ at: x.finished_at, delta: x.delta, won: !!x.is_winner, sub: `${x.players} o'yinchi · ante ${fmt(x.ante)}${x.score != null ? ' · ' + x.score + ' ochko' : ''}` })));
      const TX = { signup: 'Boshlang\'ich', bonus: 'Bonus', buyin: 'Stolga', cashout: 'Stoldan', refund: 'Qaytarildi', admin: 'Admin' };
      $('txList').innerHTML = t.items.length
        ? t.items.map((x) => `<div class="list-item"><div class="grow">${TX[x.type] || esc(x.type)}<div class="muted small">${new Date(x.created_at).toLocaleString('ru-RU')}</div></div>
            <div style="text-align:right"><span class="${x.amount >= 0 ? 'plus' : 'minus'}">${x.amount >= 0 ? '+' : ''}${fmt(x.amount)}</span><div class="muted small">${fmt(x.balance_after)}</div></div></div>`).join('')
        : '<div class="empty">—</div>';
    } catch (e) {
      toast(e.message, true);
    }
  }

  function renderHistory(items) {
    $('historyList').innerHTML = items.length
      ? items.map((x) => `<div class="list-item"><span>${x.won ? '🏆' : '🃏'}</span><div class="grow">${x.won ? 'G\'alaba' : 'Mag\'lubiyat'}
          <div class="muted small">${new Date(x.at).toLocaleString('ru-RU')}${x.sub ? ' · ' + esc(x.sub) : ''}</div></div>
          <span class="${x.delta >= 0 ? 'plus' : 'minus'}">${x.delta >= 0 ? '+' : ''}${fmt(x.delta)}</span></div>`).join('')
      : '<div class="empty">Hali o\'yin yo\'q</div>';
  }

  function renderProfile() {
    const online = app.mode === 'online' && app.profile;
    document.querySelectorAll('#profile .online-only').forEach((el) => el.classList.toggle('hidden', !online));
    let d;
    if (online) {
      const p = app.profile;
      d = { name: p.name, photo: p.photo, user: p.username ? '@' + p.username : '', level: p.level, xp: p.xp, balance: p.balance + (p.atTable || 0), games: p.gamesPlayed, wins: p.wins, losses: p.losses, rate: p.winRate, big: p.biggestWin };
    } else {
      const s = practice.stats();
      const xp = s.games * 5 + s.wins * 10;
      d = { name: meName(), photo: mePhoto(), user: 'Mashq rejimi', level: 1 + Math.floor(Math.sqrt(xp / 20)), xp, balance: practice.chips, games: s.games, wins: s.wins, losses: s.games - s.wins, rate: s.games ? Math.round((s.wins / s.games) * 100) : 0, big: s.big };
      renderHistory(s.history);
    }
    $('pAvatar').outerHTML = avatarHtml(d, '', 'id="pAvatar"');
    $('pAvatar').style.cssText += ';width:64px;height:64px;font-size:24px';
    $('pName').textContent = d.name;
    $('pUser').textContent = d.user;
    $('pLevel').textContent = d.level;
    const lo = 20 * (d.level - 1) ** 2;
    const hi = 20 * d.level ** 2;
    $('pXp').textContent = `${fmt(d.xp)} / ${fmt(hi)} XP`;
    $('pXpBar').style.width = Math.min(100, ((d.xp - lo) / Math.max(1, hi - lo)) * 100) + '%';
    $('sBalance').textContent = fmt(d.balance);
    $('sGames').textContent = fmt(d.games);
    $('sRate').textContent = d.rate + '%';
    $('sWins').textContent = fmt(d.wins);
    $('sLosses').textContent = fmt(d.losses);
    $('sBig').textContent = fmt(d.big);
    $('adminBtn').classList.toggle('hidden', !(online && app.profile.isAdmin));
  }
  $('adminBtn').addEventListener('click', () => (location.href = 'admin.html'));

  /* ======================= reyting ======================= */
  let lbBy = 'net_won';
  async function loadLeaders() {
    const box = $('lbList');
    if (app.mode !== 'online') { box.innerHTML = '<div class="empty">Reyting faqat onlayn rejimda</div>'; return; }
    box.innerHTML = '<div class="empty">Yuklanmoqda…</div>';
    try {
      const { items } = await app.net.api('GET', '/api/leaderboard?by=' + lbBy);
      const val = (u) => (lbBy === 'wins' ? `${fmt(u.wins)} 🏆` : lbBy === 'xp' ? `${fmt(u.xp)} XP` : `${u.net_won >= 0 ? '+' : ''}${fmt(u.net_won)}`);
      box.innerHTML = items.length
        ? items.map((u, i) => `<div class="list-item"><span class="pos p${i + 1}">${i + 1}</span>${avatarHtml({ name: u.first_name, photo: u.photo_url })}
            <div class="grow ellipsis">${esc(u.first_name)}${app.profile && u.id === app.profile.id ? ' <span class="badge">Siz</span>' : ''}
            <div class="muted small">${u.games_played} o'yin</div></div><b>${val(u)}</b></div>`).join('')
        : '<div class="empty">Hali reyting yo\'q — birinchi bo\'ling!</div>';
    } catch (e) {
      box.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    }
  }
  $('lbSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    lbBy = b.dataset.v;
    [...$('lbSeg').children].forEach((x) => x.classList.toggle('on', x === b));
    loadLeaders();
  });

  /* ======================= sozlamalar ======================= */
  function renderSettings() {
    $('tSound').classList.toggle('on', settings.sound);
    $('tHaptic').classList.toggle('on', settings.haptic);
  }
  $('tSound').addEventListener('click', () => { settings.sound = !settings.sound; saveSettings(); renderSettings(); sfx.chip(); });
  $('tHaptic').addEventListener('click', () => { settings.haptic = !settings.haptic; saveSettings(); renderSettings(); haptic('medium'); });

  boot();
  window.__svara = app; // brauzer testlari uchun
})();

(() => {
  'use strict';
  const E = window.SvaraEngine;
  // Telegram tashqarisida ochilganda ham ishlaydi (oddiy brauzerda initData bo'sh bo'ladi)
  const WA = window.Telegram && window.Telegram.WebApp;
  const tg = WA && WA.initData ? WA : null;
  const $ = (id) => document.getElementById(id);

  const START_CHIPS = 1000;
  const BONUS_CHIPS = 500;
  const BONUS_COOLDOWN = 4 * 60 * 60 * 1000; // 4 soat
  const NPC = window.SvaraNPC;
  const SEARCH_TIME = 2200; // jonli o'yinchilarni kutish (ms)
  const NPC_CHURN = 0.18; // har qo'ldan keyin bitta NPC almashish ehtimoli

  /* ---------------- Telegram integratsiyasi ---------------- */
  const tgUser = (tg && tg.initDataUnsafe && tg.initDataUnsafe.user) || null;
  if (tg) {
    tg.ready();
    tg.expand();
    try { tg.setHeaderColor('#0b2a24'); tg.setBackgroundColor('#0b2a24'); } catch (_) {}
    try { tg.disableVerticalSwipes && tg.disableVerticalSwipes(); } catch (_) {}
  }
  const haptic = {
    tap: () => tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('light'),
    turn: () => tg && tg.HapticFeedback && tg.HapticFeedback.impactOccurred('medium'),
    win: () => tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('success'),
    lose: () => tg && tg.HapticFeedback && tg.HapticFeedback.notificationOccurred('error'),
  };

  // Saqlash: Telegram CloudStorage (bo'lsa), aks holda localStorage
  const store = {
    get(key) {
      return new Promise((resolve) => {
        const fallback = () => { try { resolve(localStorage.getItem('svara_' + key)); } catch (_) { resolve(null); } };
        if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) {
          try { tg.CloudStorage.getItem(key, (err, v) => (err ? fallback() : resolve(v || null))); } catch (_) { fallback(); }
        } else fallback();
      });
    },
    set(key, value) {
      value = String(value);
      try { localStorage.setItem('svara_' + key, value); } catch (_) {}
      if (tg && tg.CloudStorage && tg.isVersionAtLeast && tg.isVersionAtLeast('6.9')) {
        try { tg.CloudStorage.setItem(key, value); } catch (_) {}
      }
    },
  };

  /* ---------------- Tovush ---------------- */
  let soundOn = true;
  let actx = null;
  function beep(freq = 600, dur = 0.07, type = 'sine', vol = 0.06) {
    if (!soundOn) return;
    try {
      actx = actx || new (window.AudioContext || window.webkitAudioContext)();
      const o = actx.createOscillator();
      const g = actx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + dur);
      o.connect(g).connect(actx.destination);
      o.start(); o.stop(actx.currentTime + dur);
    } catch (_) {}
  }
  const sfx = {
    card: () => beep(900, 0.04, 'triangle', 0.04),
    chip: () => { beep(1400, 0.03, 'square', 0.025); setTimeout(() => beep(1700, 0.03, 'square', 0.02), 40); },
    win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.12, 'triangle', 0.06), i * 90)),
    lose: () => [400, 300].forEach((f, i) => setTimeout(() => beep(f, 0.15, 'sawtooth', 0.03), i * 120)),
  };

  /* ---------------- Holat ---------------- */
  const me = {
    name: tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : 'Siz',
    photo: tgUser && tgUser.photo_url,
    chips: START_CHIPS,
  };
  let settings = { opponents: 3, ante: 10 };
  let table = null;
  let botTimer = null;
  let dealtKey = '';

  function initials(name) {
    return name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  }
  function setAvatar(el, p) {
    if (p.photo) { el.style.backgroundImage = `url("${p.photo}")`; el.textContent = ''; }
    else { el.style.backgroundImage = ''; el.style.backgroundColor = p.color || '#2a6b5c'; el.textContent = initials(p.name); }
  }
  const fmt = (n) => n.toLocaleString('ru-RU');

  function saveChips() { store.set('chips', me.chips); }

  /* ---------------- Lobbi ---------------- */
  function renderLobby() {
    $('meName').textContent = me.name;
    setAvatar($('meAvatar'), me);
    $('lobbyChips').textContent = fmt(me.chips);
  }

  function bindSeg(id, key) {
    $(id).addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      haptic.tap();
      [...$(id).children].forEach((x) => x.classList.toggle('on', x === b));
      settings[key] = Number(b.dataset.v);
    });
  }
  bindSeg('oppSeg', 'opponents');
  bindSeg('anteSeg', 'ante');

  $('bonusBtn').addEventListener('click', async () => {
    haptic.tap();
    const last = Number(await store.get('bonusAt')) || 0;
    const left = last + BONUS_COOLDOWN - Date.now();
    if (left > 0) {
      const h = Math.floor(left / 3.6e6), m = Math.ceil((left % 3.6e6) / 6e4);
      return showModal('Bonus', `Keyingi bonus ${h} soat ${m} daqiqadan so'ng.`, [{ text: 'OK' }]);
    }
    me.chips += BONUS_CHIPS;
    saveChips();
    store.set('bonusAt', Date.now());
    renderLobby();
    haptic.win(); sfx.win();
    showModal('Bonus', `+${BONUS_CHIPS} chip qo'shildi!`, [{ text: 'Rahmat' }]);
  });

  $('playBtn').addEventListener('click', () => {
    haptic.tap();
    const minNeed = settings.ante * 2;
    if (me.chips < minNeed) {
      return showModal('Chip yetarli emas', `Bu stol uchun kamida ${minNeed} chip kerak. Bonus oling yoki kichikroq stavka tanlang.`, [{ text: 'OK' }]);
    }
    startSearch();
  });

  /* ---------------- O'yinchi qidirish ---------------- */
  /**
   * Jonli o'yinchilarni topish. Hozircha server yo'q, shuning uchun bo'sh
   * ro'yxat qaytaradi. Multiplayer server qo'shilganda shu yerga ulanadi:
   * topilgan o'yinchilar stolga o'tiradi, qolgan joylar NPC bilan to'ldiriladi.
   */
  function findLivePlayers(/* { seats, ante } */) {
    return new Promise((resolve) => setTimeout(() => resolve([]), SEARCH_TIME));
  }

  let searchToken = 0;
  async function startSearch() {
    const token = ++searchToken;
    const seats = settings.opponents;
    showScreen('search');
    if (tg) tg.BackButton.show();
    $('searchStatus').textContent = "Jonli o'yinchilar qidirilmoqda…";
    $('searchMeta').textContent = `Stol: ${seats + 1} kishi · Ante ${fmt(settings.ante)}`;
    const list = $('searchList');
    list.innerHTML = '';
    const slots = [];
    for (let i = 0; i < seats; i++) {
      const li = document.createElement('li');
      li.className = 'slot empty';
      li.innerHTML = '<div class="avatar">?</div><div class="slot-info"><b>Kutilmoqda…</b><small>&nbsp;</small></div>';
      list.appendChild(li);
      slots.push(li);
    }

    const live = await findLivePlayers({ seats, ante: settings.ante });
    if (token !== searchToken) return;
    const players = live.slice(0, seats);
    if (players.length < seats) {
      $('searchStatus').textContent = players.length
        ? "Bo'sh joylar NPC o'yinchilar bilan to'ldirilmoqda…"
        : "Jonli o'yinchi topilmadi — NPC o'yinchilar qo'shilmoqda…";
    }
    while (players.length < seats) {
      await wait(250 + Math.random() * 650);
      if (token !== searchToken) return;
      const npc = NPC.createNPC({ ante: settings.ante, taken: [me.name, ...players.map((p) => p.name)] });
      players.push(npc);
      fillSlot(slots[players.length - 1], npc);
      sfx.card();
      haptic.tap();
    }
    $('searchStatus').textContent = 'Stol tayyor!';
    await wait(600);
    if (token !== searchToken) return;
    startTable(players);
  }

  function fillSlot(li, p) {
    li.className = 'slot joined';
    const av = li.querySelector('.avatar');
    setAvatar(av, p);
    li.querySelector('b').innerHTML = `${escapeHtml(p.name)} <span class="flag">${p.flag || ''}</span>`;
    li.querySelector('small').innerHTML = `${p.isNew ? '<span class="new">YANGI</span> ' : ''}★ ${p.level} · ${fmt(p.chips)} chip`;
  }

  function cancelSearch() {
    searchToken++;
    if (tg) tg.BackButton.hide();
    showScreen('lobby');
  }
  $('cancelSearch').addEventListener('click', cancelSearch);
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ---------------- Stol ---------------- */
  function startTable(opponents) {
    const mine = { id: 'me', name: me.name, chips: me.chips, color: '#2a6b5c', photo: me.photo };
    table = new E.Table({ players: [mine, ...opponents], ante: settings.ante });
    showScreen('table');
    if (tg) { tg.BackButton.show(); tg.enableClosingConfirmation && tg.enableClosingConfirmation(); }
    newHand();
  }

  function leaveTable() {
    clearTimeout(botTimer);
    if (table) {
      const mine = table.players[0];
      // Qo'l davom etayotgan bo'lsa tikilgan chiplar bankda qoladi (yutqazilgan hisoblanadi)
      me.chips = mine.chips;
      saveChips();
    }
    table = null;
    hideModal();
    if (tg) { tg.BackButton.hide(); tg.disableClosingConfirmation && tg.disableClosingConfirmation(); }
    showScreen('lobby');
    renderLobby();
  }

  function confirmLeave() {
    if (table && (table.phase === 'betting' || table.phase === 'svara') && table.players[0].inHand && !table.players[0].folded) {
      showModal('Chiqasizmi?', "Qo'l davom etmoqda. Chiqsangiz tikilgan chiplar yo'qoladi.", [
        { text: 'Qolish' },
        { text: 'Chiqish', primary: true, fn: leaveTable },
      ]);
    } else leaveTable();
  }
  $('backBtn').addEventListener('click', confirmLeave);
  if (tg) tg.BackButton.onClick(() => (table ? confirmLeave() : document.getElementById('search').classList.contains('active') ? cancelSearch() : null));

  $('soundBtn').addEventListener('click', () => {
    soundOn = !soundOn;
    $('soundBtn').textContent = soundOn ? '🔊' : '🔇';
    store.set('sound', soundOn ? '1' : '0');
  });

  function replaceSeat(p, npc) {
    Object.assign(p, npc, { cards: [], lastAction: '', bet: 0, folded: true, inHand: false });
  }

  /** NPC'lar stolga kelib-ketib turadi: chipi tugaganlar ketadi, ba'zan kimdir almashadi */
  function refillBots() {
    const taken = () => table.players.map((x) => x.name);
    table.players.forEach((p) => {
      if (p.isBot && p.chips < table.ante) {
        const old = p.name;
        replaceSeat(p, NPC.createNPC({ ante: table.ante, taken: taken() }));
        toast(`${old} chiqib ketdi · ${p.name} ${p.flag} o'tirdi`);
      }
    });
    if (Math.random() < NPC_CHURN) {
      const bots = table.players.filter((p) => p.isBot);
      const p = bots[Math.floor(Math.random() * bots.length)];
      const old = p.name;
      replaceSeat(p, NPC.createNPC({ ante: table.ante, taken: taken() }));
      toast(`${old} stolni tark etdi · ${p.name} ${p.flag} qo'shildi`);
    }
  }

  function newHand() {
    hideModal();
    const mine = table.players[0];
    me.chips = mine.chips;
    saveChips();
    if (mine.chips < table.ante) {
      return showModal('Chip tugadi', "Lobbiga qaytib bonus oling.", [{ text: 'Lobbi', primary: true, fn: leaveTable }]);
    }
    refillBots();
    table.startHand();
    dealtKey = '';
    sfx.card();
    render();
    loop();
  }

  function loop() {
    clearTimeout(botTimer);
    if (!table) return;
    if (table.phase === 'betting') {
      const p = table.players[table.toAct];
      if (p.isBot) {
        botTimer = setTimeout(() => {
          if (!table) return;
          const a = E.botDecide(table, table.toAct, Math.random, NPC.STYLES[p.style]);
          table.act(a);
          a.type === 'fold' ? sfx.card() : sfx.chip();
          render();
          loop();
        }, 650 + Math.random() * 700);
      } else {
        haptic.turn();
      }
    } else if (table.phase === 'svara') {
      onSvara();
    } else if (table.phase === 'over') {
      onHandOver();
    }
  }

  function humanAct(a) {
    if (!table || table.phase !== 'betting' || table.toAct !== 0) return;
    haptic.tap();
    table.act(a);
    a.type === 'fold' ? sfx.card() : sfx.chip();
    render();
    loop();
  }

  function onSvara() {
    render(true);
    const mine = table.players[0];
    const inSvara = table.result.svaraPlayers.includes('me');
    const cost = table.svaraJoinCost();
    const botJoins = table.players.filter((p) => p.isBot && E.botJoinSvara(table, p)).map((p) => p.id);
    const go = (join) => { table.startSvara(join ? [...botJoins, 'me'] : botJoins); dealtKey = ''; sfx.card(); render(); loop(); };

    if (inSvara) {
      showModal('SVARA!', `Durang! Bank (${fmt(table.pot)}) qoladi va kartalar qayta tarqatiladi.`, [{ text: 'Davom etish', primary: true, fn: () => go(false) }]);
    } else if (table.canJoinSvara(mine)) {
      showModal('SVARA!', `Durang chiqdi. Bank: ${fmt(table.pot)}. ${fmt(cost)} chip to'lab qo'shilasizmi?`, [
        { text: "Yo'q", fn: () => go(false) },
        { text: `Qo'shilish (${fmt(cost)})`, primary: true, fn: () => go(true) },
      ]);
    } else {
      botTimer = setTimeout(() => go(false), 1600);
      toast('SVARA! Kartalar qayta tarqatilmoqda');
    }
  }

  function onHandOver() {
    render(true);
    const r = table.result;
    const w = table.players.find((p) => p.id === r.winners[0]);
    const iWon = w.id === 'me';
    me.chips = table.players[0].chips;
    saveChips();
    if (iWon) { haptic.win(); sfx.win(); } else if (table.players[0].inHand) { haptic.lose(); sfx.lose(); }
    const how = r.type === 'showdown' ? `${E.describeHand(w.cards)}` : 'Hamma pas aytdi';
    showModal(iWon ? 'Siz yutdingiz!' : `${w.name} yutdi`, `${how}\nBank: +${fmt(r.pot)}`, [
      { text: 'Lobbi', fn: leaveTable },
      { text: "Keyingi qo'l", primary: true, fn: newHand },
    ]);
  }

  /* ---------------- Chizish ---------------- */
  function cardEl(c, { hidden = false, deal = false, delay = 0 } = {}) {
    const el = document.createElement('div');
    el.className = 'card';
    if (hidden) el.classList.add('back');
    else {
      if (c.suit === '♥' || c.suit === '♦') el.classList.add('red');
      if (E.isJoker(c)) el.classList.add('joker');
      el.innerHTML = `<span>${c.rank}</span><span class="s">${c.suit}</span><span class="big">${c.suit}</span>`;
    }
    if (deal) { el.classList.add('deal'); el.style.animationDelay = delay + 'ms'; }
    return el;
  }

  function seatPositions(n) {
    // 0 — pastda (siz), qolganlari ellips bo'ylab soat strelkasi bo'yicha
    const pos = [];
    for (let i = 0; i < n; i++) {
      const ang = Math.PI / 2 + (i * 2 * Math.PI) / n;
      pos.push({ x: 50 + 39 * Math.cos(ang), y: 47 + 37 * Math.sin(ang) });
    }
    return pos;
  }

  function render(reveal = false) {
    if (!table) return;
    const showAll = reveal || table.phase === 'svara' || table.phase === 'over';
    const key = table.svaraRound + ':' + table.players.map((p) => p.cards.map((c) => c.rank + c.suit).join()).join('|');
    const fresh = key !== dealtKey;
    dealtKey = key;

    const pos = seatPositions(table.players.length);
    const seats = $('seats');
    seats.innerHTML = '';
    const winners = (table.result && (table.result.winners.length ? table.result.winners : table.result.svaraPlayers)) || [];
    table.players.forEach((p, i) => {
      const s = document.createElement('div');
      s.className = 'seat';
      if (i === table.toAct) s.classList.add('turn');
      if (!p.inHand || p.folded) s.classList.add('folded');
      if (winners.includes(p.id)) s.classList.add('winner');
      s.style.left = pos[i].x + '%';
      s.style.top = pos[i].y + '%';
      const av = document.createElement('div');
      av.className = 'avatar';
      setAvatar(av, p);
      if (i === table.dealer) av.insertAdjacentHTML('beforeend', '<span class="dealer">D</span>');
      if (p.flag) av.insertAdjacentHTML('beforeend', `<span class="flag-badge">${p.flag}</span>`);
      if (p.isBot) av.insertAdjacentHTML('beforeend', `<span class="lvl">${p.level}</span>`);
      s.innerHTML = `<div class="act">${p.lastAction || ''}</div>`;
      s.appendChild(av);
      s.insertAdjacentHTML('beforeend', `<div class="nm">${escapeHtml(i === 0 ? 'Siz' : p.name)}</div><div class="ch">${fmt(p.chips)}</div><div class="bet">${p.bet ? '▲ ' + fmt(p.bet) : ''}</div>`);
      if (i !== 0 && p.inHand) {
        const cs = document.createElement('div');
        cs.className = 'cards';
        const open = showAll && !p.folded && table.result && table.result.scores;
        p.cards.forEach((c, k) => cs.appendChild(cardEl(c, { hidden: !open, deal: fresh, delay: (k * table.players.length + i) * 60 })));
        s.appendChild(cs);
        if (open) s.insertAdjacentHTML('beforeend', `<div class="score">${E.scoreHand(p.cards)}</div>`);
      } else if (i === 0 && showAll && p.inHand && !p.folded && table.result && table.result.scores) {
        s.insertAdjacentHTML('beforeend', `<div class="score">${E.scoreHand(p.cards)}</div>`);
      }
      seats.appendChild(s);
    });

    // Bank
    const potBox = document.querySelector('.pot');
    potBox.classList.toggle('svara', table.phase === 'svara' || table.svaraRound > 0);
    $('potLabel').textContent = table.phase === 'svara' || table.svaraRound > 0 ? 'SVARA' : 'BANK';
    $('potValue').textContent = fmt(table.phase === 'over' ? table.result.pot : table.pot);
    $('potSub').textContent = table.currentBet ? `Stavka: ${fmt(table.currentBet)}` : `Ante: ${fmt(table.ante)}`;
    $('tableChips').textContent = fmt(table.players[0].chips);

    // Mening kartalarim
    const mine = table.players[0];
    const hand = $('myHand');
    hand.innerHTML = '';
    if (mine.inHand) {
      mine.cards.forEach((c, k) => hand.appendChild(cardEl(c, { deal: fresh, delay: k * table.players.length * 60 })));
      $('myScore').textContent = mine.folded ? 'Pas' : E.describeHand(mine.cards);
    } else {
      $('myScore').textContent = table.phase === 'betting' ? 'Kuzatuvchi' : '';
    }

    renderActions();
  }

  function renderActions() {
    const box = $('actions');
    box.innerHTML = '';
    if (table.phase !== 'betting') return;
    if (table.toAct !== 0) {
      const p = table.players[table.toAct];
      box.innerHTML = `<div class="wait">${escapeHtml(p.name)} o'ylamoqda…</div>`;
      return;
    }
    const legal = table.legalActions();
    const btn = (cls, label, sub, a) => {
      const b = document.createElement('button');
      b.className = cls;
      b.innerHTML = `${label}${sub ? `<small>${sub}</small>` : ''}`;
      b.addEventListener('click', () => humanAct(a));
      box.appendChild(b);
    };
    for (const a of legal) {
      if (a.type === 'fold') btn('fold', 'Pas', '', a);
      if (a.type === 'check') btn('call', "O'tish", '', a);
      if (a.type === 'call') btn('call', 'Tenglash', fmt(a.amount), a);
    }
    legal.filter((a) => a.type === 'raise').forEach((a) => btn('raise', 'Oshirish', '→ ' + fmt(a.to), a));
  }

  /* ---------------- Yordamchi ---------------- */
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  }
  let toastT = null;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 1800);
  }
  function showModal(title, text, buttons) {
    $('modalTitle').textContent = title;
    $('modalText').innerText = text;
    const box = $('modalBtns');
    box.innerHTML = '';
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = b.primary ? 'primary' : 'ghost';
      el.textContent = b.text;
      el.addEventListener('click', () => { haptic.tap(); hideModal(); b.fn && b.fn(); });
      box.appendChild(el);
    }
    // Lobbida ham modal ishlashi uchun uni joriy ekranga ko'chiramiz
    document.querySelector('.screen.active').appendChild($('modal'));
    $('modal').classList.add('show');
  }
  function hideModal() { $('modal').classList.remove('show'); }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  /* ---------------- Ishga tushirish ---------------- */
  (async () => {
    const saved = await store.get('chips');
    if (saved !== null && !isNaN(Number(saved))) me.chips = Number(saved);
    else saveChips();
    soundOn = (await store.get('sound')) !== '0';
    $('soundBtn').textContent = soundOn ? '🔊' : '🔇';
    renderLobby();
  })();
})();

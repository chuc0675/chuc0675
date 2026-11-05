/*
 * Svara o'yin mexanikasi (UI'siz). Brauzerda `window.SvaraEngine`,
 * Node'da `require('./engine.js')` orqali ishlaydi.
 *
 * Qoidalar (qisqacha):
 *  - 32 talik koloda: 7, 8, 9, 10, J, Q, K, A.
 *  - Har bir o'yinchiga 3 tadan karta.
 *  - Qiymatlar: A=11, K/Q/J/10=10, 9=9, 8=8, 7=7.
 *  - 7♣ — joker ("chechak"): 11 ochko va istalgan mast o'rnida turadi.
 *  - Ochko = bir xil mastdagi kartalar yig'indisi (eng yaxshi mast olinadi).
 *  - Ikki tuz (A) = 22. Uchta bir xil karta = 3 × qiymat (uchta tuz = 33),
 *    uchta yettilik = 34 (eng kuchli kombinatsiya).
 *  - Durang bo'lsa — "Svara": bank qoladi, teng kelganlar qayta o'ynaydi,
 *    qolganlar bankning yarmini to'lab qo'shilishi mumkin.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SvaraEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['♠', '♥', '♦', '♣'];
  const RANKS = ['7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const VALUES = { 7: 7, 8: 8, 9: 9, 10: 10, J: 10, Q: 10, K: 10, A: 11 };

  /**
   * Qoidalar konfiguratsiyasi. Hududiy variantlar shu yerda sozlanadi.
   * Standart qiymatlar — bolgar "Svara/Svarka" varianti (32 karta, 7♣ joker).
   */
  const DEFAULT_RULES = Object.freeze({
    jokerEnabled: true, // 7♣ — joker (11 ochko, istalgan mast/karta)
    twoAcesScore: 22, // ikki tuz
    threeSevensScore: 34, // uchta yettilik — eng kuchli
    tripsMultiplier: 3, // uchta bir xil = 3 × qiymat
    maxRaisesPerRound: 4,
    raiseSteps: [1, 2, 'pot'], // ante karrasi yoki 'pot' (bank, kamida 3 ante)
    svaraJoinRatio: 0.5, // svaraga qo'shilish narxi = bank × ratio
    allowSvaraJoin: true,
    maxSvaraRounds: 3, // shuncha svaradan keyin ham durang bo'lsa bank bo'linadi
  });
  const resolveRules = (r) => Object.freeze({ ...DEFAULT_RULES, ...(r || {}) });

  function createDeck() {
    const deck = [];
    for (const suit of SUITS) for (const rank of RANKS) deck.push({ rank, suit });
    return deck;
  }

  function shuffle(deck, rng = Math.random) {
    const a = deck.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  const isJoker = (c, rules = DEFAULT_RULES) => rules.jokerEnabled && c.rank === '7' && c.suit === '♣';
  const cardValue = (c, rules = DEFAULT_RULES) => (isJoker(c, rules) ? 11 : VALUES[c.rank]);

  /** Qo'l bahosi: { score, kind, suit? } */
  function evaluateHand(cards, rules = DEFAULT_RULES) {
    const joker = cards.some((c) => isJoker(c, rules));
    const rest = cards.filter((c) => !isJoker(c, rules));
    const options = [];

    // Uchta bir xil (joker istalgan karta bo'la oladi)
    if (cards.length === 3) {
      const ranks = rest.map((c) => c.rank);
      if (ranks.length > 0 && ranks.every((r) => r === ranks[0])) {
        const r = ranks[0];
        if (ranks.length + (joker ? 1 : 0) === 3) {
          options.push({ score: r === '7' ? rules.threeSevensScore : rules.tripsMultiplier * VALUES[r], kind: 'trips', rank: r });
        }
      }
    }

    // Ikki tuz
    const aces = rest.filter((c) => c.rank === 'A').length;
    if (aces >= 2) options.push({ score: rules.twoAcesScore, kind: 'aces' });

    // Mast bo'yicha yig'indi
    for (const suit of SUITS) {
      const sum = rest.filter((c) => c.suit === suit).reduce((s, c) => s + VALUES[c.rank], 0);
      const total = sum + (joker ? 11 : 0);
      if (total > 0) options.push({ score: total, kind: 'suit', suit });
    }

    options.sort((a, b) => b.score - a.score || (a.kind === 'trips' ? -1 : 1));
    return options[0] || { score: 0, kind: 'suit' };
  }

  const scoreHand = (cards, rules) => evaluateHand(cards, rules).score;

  function describeHand(cards, rules) {
    const e = evaluateHand(cards, rules);
    if (e.kind === 'trips') return e.rank === '7' ? `Uchta yettilik · ${e.score}` : `Uchta ${e.rank} · ${e.score}`;
    if (e.kind === 'aces') return `Ikki tuz · ${e.score}`;
    return `${e.suit} · ${e.score}`;
  }

  /**
   * Stol holati. UI faqat `act()` ni chaqiradi va `state` ni chizadi.
   * Bank bo'linib ketmasligi uchun stavka eng kam stekli faol o'yinchining
   * imkoniyatidan oshmaydi (stol limiti) — shuning uchun "all-in" va yon
   * banklar kerak emas.
   */
  class Table {
    constructor({ players, ante = 10, rng = Math.random, rules }) {
      this.players = players.map((p, i) => Table.makePlayer(p, i));
      this.rules = resolveRules(rules);
      this.ante = ante;
      this.rng = rng;
      this.pot = 0;
      this.dealer = -1;
      this.phase = 'idle'; // idle | betting | svara | over
      this.toAct = -1;
      this.currentBet = 0;
      this.raises = 0;
      this.result = null;
      this.svaraRound = 0;
      this.log = [];
      this.actions = []; // qo'l davomidagi barcha harakatlar (audit va tarix uchun)
      this.handNo = 0;
    }

    static makePlayer(p, i = 0) {
      return {
        ...p, // qo'shimcha maydonlar (bayroq, daraja, uslub...) saqlanadi
        id: p.id ?? i,
        name: p.name,
        isBot: !!p.isBot,
        avatar: p.avatar || '',
        chips: p.chips,
        cards: [],
        folded: true,
        inHand: false,
        bet: 0,
        acted: false,
        lastAction: '',
      };
    }

    /** Qo'l faolmi (stavkalar yoki svara qarori kutilmoqda) */
    get handActive() {
      return this.phase === 'betting' || this.phase === 'svara';
    }

    /** O'yinchini stolga qo'shish — keyingi qo'ldan o'ynaydi */
    addPlayer(p) {
      if (this.players.some((x) => x.id === p.id)) throw new Error("O'yinchi allaqachon stolda");
      const np = Table.makePlayer(p, this.players.length);
      this.players.push(np);
      return np;
    }

    /** O'yinchini stoldan olib tashlash (faqat qo'lda ishtirok etmayotgan bo'lsa) */
    removePlayer(id) {
      const i = this.players.findIndex((x) => x.id === id);
      if (i < 0) return null;
      const p = this.players[i];
      if (this.handActive && p.inHand && !p.folded) throw new Error("Qo'l davom etmoqda");
      if (this.handActive && p.inHand) throw new Error("Qo'l tugashini kuting");
      this.players.splice(i, 1);
      if (this.dealer >= i) this.dealer--;
      if (this.toAct > i) this.toAct--;
      return p;
    }

    /** Navbatdan tashqari pas (chiqib ketish, vaqt tugashi) */
    forceFold(id, reason = 'Pas') {
      const i = this.players.findIndex((x) => x.id === id);
      const p = this.players[i];
      if (!p || this.phase !== 'betting' || !p.inHand || p.folded) return false;
      if (i === this.toAct) {
        this.act({ type: 'fold' });
        const rec = this.actions.filter((a) => a.playerId === p.id).pop();
        if (rec) rec.forced = true;
        p.lastAction = reason;
        return true;
      }
      p.folded = true;
      p.lastAction = reason;
      this._record(p, { type: 'fold', forced: true });
      this._emit(`${p.name}: pas (${reason})`);
      const active = this.activePlayers();
      if (active.length === 1) this._award(active, 'fold');
      return true;
    }

    _record(p, a) {
      this.actions.push({ playerId: p.id, svaraRound: this.svaraRound, ...a });
    }

    _emit(text) {
      this.log.push(text);
      if (this.log.length > 50) this.log.shift();
    }

    activePlayers() {
      return this.players.filter((p) => p.inHand && !p.folded);
    }

    _deal(ps) {
      const deck = shuffle(createDeck(), this.rng);
      for (const p of ps) p.cards = deck.splice(0, 3);
    }

    _resetRound(ps) {
      for (const p of this.players) {
        p.bet = 0;
        p.acted = false;
        p.lastAction = '';
        p.folded = !ps.includes(p);
        p.inHand = ps.includes(p);
        if (!p.inHand) p.cards = [];
      }
      this.currentBet = 0;
      this.raises = 0;
      this.result = null;
    }

    /** @param canPlay — qo'shimcha filtr (masalan, stoldan chiqayotganlarni o'tkazib yuborish) */
    startHand(canPlay = () => true) {
      const ok = (p) => p.chips >= this.ante && canPlay(p);
      const seated = this.players.filter(ok);
      if (seated.length < 2) throw new Error("O'yin uchun kamida 2 ta o'yinchi kerak");
      this.dealer = this._nextIndex(this.dealer, ok);
      this.pot = 0;
      this.svaraRound = 0;
      this._resetRound(seated);
      for (const p of seated) {
        p.chips -= this.ante;
        this.pot += this.ante;
      }
      this.actions = [];
      this.handNo++;
      for (const p of seated) this._record(p, { type: 'ante', amount: this.ante });
      this._deal(seated);
      this.phase = 'betting';
      this.toAct = this._nextIndex(this.dealer, (p) => p.inHand && !p.folded);
      this._emit(`Yangi qo'l. Ante: ${this.ante}. Bank: ${this.pot}`);
      return this;
    }

    /** Svarada qo'shilish narxi */
    svaraJoinCost() {
      return Math.ceil(this.pot * this.rules.svaraJoinRatio);
    }

    canJoinSvara(p) {
      return (
        this.rules.allowSvaraJoin &&
        this.phase === 'svara' &&
        !this.result.svaraPlayers.includes(p.id) &&
        p.chips >= this.svaraJoinCost()
      );
    }

    /** Svara: teng kelganlar + qo'shilganlar qayta o'ynaydi */
    startSvara(joinIds = []) {
      if (this.phase !== 'svara') throw new Error('Svara holati emas');
      const ids = new Set(this.result.svaraPlayers);
      const cost = this.svaraJoinCost();
      for (const id of joinIds) {
        const p = this.players.find((x) => x.id === id);
        if (p && this.canJoinSvara(p) && !ids.has(id)) {
          p.chips -= cost;
          this.pot += cost;
          ids.add(id);
          this._record(p, { type: 'svara_join', amount: cost });
          this._emit(`${p.name} svaraga qo'shildi (${cost})`);
        }
      }
      const ps = this.players.filter((p) => ids.has(p.id));
      this.svaraRound++;
      this._resetRound(ps);
      this._deal(ps);
      this.phase = 'betting';
      this.toAct = this._nextIndex(this.dealer, (p) => p.inHand && !p.folded);
      this._emit(`Svara! Bank: ${this.pot}`);
      return this;
    }

    _nextIndex(from, pred) {
      const n = this.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (((from + k) % n) + n) % n;
        if (pred(this.players[i])) return i;
      }
      return -1;
    }

    /** Stol limiti: hech kim o'z imkoniyatidan ko'p tikishga majbur bo'lmasin */
    maxBet() {
      return Math.min(...this.activePlayers().map((p) => p.chips + p.bet));
    }

    legalActions(index = this.toAct) {
      const p = this.players[index];
      if (this.phase !== 'betting' || index !== this.toAct || !p) return [];
      const diff = this.currentBet - p.bet;
      const acts = [{ type: 'fold' }];
      if (diff === 0) acts.push({ type: 'check' });
      else acts.push({ type: 'call', amount: diff });
      if (this.raises < this.rules.maxRaisesPerRound) {
        const limit = this.maxBet();
        const seen = new Set();
        const steps = this.rules.raiseSteps.map((s) => (s === 'pot' ? Math.max(this.pot, this.ante * 3) : s * this.ante));
        for (const step of steps) {
          const to = Math.min(this.currentBet + step, limit);
          if (to > this.currentBet && !seen.has(to)) {
            seen.add(to);
            acts.push({ type: 'raise', to, amount: to - p.bet });
          }
        }
      }
      return acts;
    }

    act(action) {
      const p = this.players[this.toAct];
      const legal = this.legalActions();
      const match = legal.find((a) => a.type === action.type && (a.type !== 'raise' || a.to === action.to));
      if (!match) throw new Error(`Noto'g'ri harakat: ${JSON.stringify(action)}`);
      this._record(p, { type: match.type, amount: match.amount || 0, to: match.to });

      switch (match.type) {
        case 'fold':
          p.folded = true;
          p.lastAction = 'Pas';
          this._emit(`${p.name}: pas`);
          break;
        case 'check':
          p.lastAction = "O'tdi";
          this._emit(`${p.name}: o'tkazdi`);
          break;
        case 'call':
          p.chips -= match.amount;
          p.bet += match.amount;
          this.pot += match.amount;
          p.lastAction = `Teng ${match.amount}`;
          this._emit(`${p.name}: tenglashtirdi ${match.amount}`);
          break;
        case 'raise':
          p.chips -= match.amount;
          p.bet += match.amount;
          this.pot += match.amount;
          this.currentBet = match.to;
          this.raises++;
          for (const o of this.players) if (o !== p) o.acted = false;
          p.lastAction = `Oshirdi ${match.to}`;
          this._emit(`${p.name}: oshirdi → ${match.to}`);
          break;
      }
      p.acted = true;
      this._advance();
      return this;
    }

    _advance() {
      const active = this.activePlayers();
      if (active.length === 1) return this._award(active, 'fold');
      const done = active.every((p) => p.acted && p.bet === this.currentBet);
      if (done) return this._showdown();
      this.toAct = this._nextIndex(this.toAct, (p) => p.inHand && !p.folded);
    }

    _showdown() {
      const active = this.activePlayers();
      const scored = active.map((p) => ({ p, score: scoreHand(p.cards, this.rules) }));
      const best = Math.max(...scored.map((s) => s.score));
      const winners = scored.filter((s) => s.score === best).map((s) => s.p);
      const scores = Object.fromEntries(scored.map((s) => [s.p.id, s.score]));
      if (winners.length > 1 && this.svaraRound >= this.rules.maxSvaraRounds) {
        return this._award(winners, 'split', scores);
      }
      if (winners.length > 1) {
        this.phase = 'svara';
        this.toAct = -1;
        this.result = { type: 'svara', winners: [], svaraPlayers: winners.map((w) => w.id), scores, pot: this.pot };
        this._emit(`Durang (${best})! ${winners.map((w) => w.name).join(', ')} — svara`);
        return;
      }
      this._award(winners, 'showdown', scores);
    }

    /** Bankni g'olib(lar)ga berish. Bo'linganda qoldiq birinchi g'olibga */
    _award(winners, how, scores = null) {
      const won = this.pot;
      const share = Math.floor(won / winners.length);
      const payouts = {};
      winners.forEach((w, i) => {
        const amt = share + (i === 0 ? won - share * winners.length : 0);
        w.chips += amt;
        payouts[w.id] = amt;
      });
      this.pot = 0;
      this.phase = 'over';
      this.toAct = -1;
      this.result = { type: how, winners: winners.map((w) => w.id), svaraPlayers: [], scores, pot: won, payouts };
      this._emit(`${winners.map((w) => w.name).join(', ')} yutdi: ${won}`);
    }
  }

  const DEFAULT_STYLE = { foldBias: 0, raiseBias: 0, bluff: 0.08 };

  /**
   * Bot qarori: kartaning kuchi + uslub + biroz tasodif.
   * style = { foldBias, raiseBias, bluff } (npc.js dagi STYLES)
   */
  function botDecide(table, index, rng = Math.random, style = DEFAULT_STYLE) {
    const p = table.players[index];
    const st = { ...DEFAULT_STYLE, ...(style || {}) };
    const legal = table.legalActions(index);
    const has = (t) => legal.find((a) => a.type === t);
    const raises = legal.filter((a) => a.type === 'raise');
    const score = scoreHand(p.cards, table.rules);
    const call = has('call');
    const check = has('check');
    const r = rng();
    const pick = (i) => raises[Math.min(i, raises.length - 1)];
    // foldBias > 0 — ehtiyotkor (chegaralar yuqoriroq), < 0 — tavakkalchi
    const T = (x) => x + st.foldBias;

    if (score >= T(31)) {
      if (raises.length && r < 0.75 + st.raiseBias) return pick(r < 0.3 ? 2 : 1);
      return call || check;
    }
    if (score >= T(25)) {
      if (raises.length && r < 0.35 + st.raiseBias) return pick(0);
      return call || check;
    }
    if (raises.length && r < st.bluff) return pick(rng() < 0.7 ? 0 : 1);
    if (score >= T(20)) {
      if (check) return check;
      if (call.amount <= Math.max(table.ante * 2, table.pot * 0.4) || r < 0.4 - st.foldBias * 0.05) return call;
      return has('fold');
    }
    if (check) return check;
    if (call.amount <= table.ante && r < 0.35 - st.foldBias * 0.05) return call;
    return has('fold');
  }

  /** Bot svaraga qo'shiladimi (faqat tasodif — kartalar yangidan tarqatiladi) */
  function botJoinSvara(table, p, rng = Math.random) {
    return table.canJoinSvara(p) && table.svaraJoinCost() <= p.chips * 0.25 && rng() < 0.4;
  }

  /** Kriptografik xavfsiz RNG [0, 1) — Web Crypto (brauzer va Node 19+) */
  function secureRandom() {
    const a = new Uint32Array(2);
    globalThis.crypto.getRandomValues(a);
    return (a[0] * 2 ** 16 + (a[1] >>> 16)) / 2 ** 48;
  }

  return {
    DEFAULT_RULES,
    resolveRules,
    secureRandom,
    SUITS,
    RANKS,
    VALUES,
    createDeck,
    shuffle,
    isJoker,
    cardValue,
    evaluateHand,
    scoreHand,
    describeHand,
    Table,
    botDecide,
    botJoinSvara,
  };
});

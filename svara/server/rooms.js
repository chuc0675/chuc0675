'use strict';
/**
 * O'yin stollari — serverdagi yagona haqiqiy holat.
 *
 * Holatlar (state machine):
 *   WAITING_FOR_PLAYERS → READY → DEALING → PLAYING → ROUND_END → FINISHED → (READY | WAITING_FOR_PLAYERS)
 *                                              ↑__________ svara ________|
 *   CLOSED — stol yopildi.
 *
 * Mijoz faqat niyat yuboradi (`act`, `svara_join`, `leave`); hamma tekshiruv shu yerda.
 * Har bir o'yinchiga `viewFor()` orqali faqat unga ruxsat etilgan ma'lumot yuboriladi:
 * boshqalarning yopiq kartalari hech qachon yuborilmaydi.
 */
const crypto = require('node:crypto');
const E = require('../webapp/engine.js');
const NPC = require('../webapp/npc.js');

const S = Object.freeze({
  WAITING: 'WAITING_FOR_PLAYERS',
  READY: 'READY',
  DEALING: 'DEALING',
  PLAYING: 'PLAYING',
  ROUND_END: 'ROUND_END',
  FINISHED: 'FINISHED',
  CLOSED: 'CLOSED',
});

class GameError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 0/O, 1/I yo'q
function randomCode(len = 6) {
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return s;
}

const levelFromXp = (xp) => 1 + Math.floor(Math.sqrt((xp || 0) / 20));
const cardStr = (cs) => cs.map((c) => c.rank + c.suit).join(' ');

class Room {
  constructor(opts, ctx) {
    this.id = opts.id;
    this.code = opts.code;
    this.name = opts.name;
    this.isPrivate = !!opts.isPrivate;
    this.ante = opts.ante;
    this.maxPlayers = opts.maxPlayers;
    this.fillBots = !!opts.fillBots;
    this.createdBy = opts.createdBy ?? null;
    this.ctx = ctx; // { repo, cfg, notify(userId, msg), onClose(room) }
    this.table = new E.Table({ players: [], ante: this.ante, rng: E.secureRandom, rules: ctx.rules });
    this.members = new Map(); // userId → { userId, connected, leaving, missed, graceTimer }
    this.status = S.WAITING;
    this.seq = 0; // har bir holat o'zgarishida oshadi
    this.turnSeq = 0; // har bir navbat o'zgarishida oshadi (eskirgan harakatlarni rad etish)
    this.deadline = null;
    this.timer = null;
    this.fillTimer = null;
    this.svaraJoins = new Set();
    this.svaraDecided = new Set();
    this.handMeta = null;
    this.createdAt = Date.now();
    this.lastResult = null;
  }

  /* ---------------- yordamchilar ---------------- */
  get cfg() {
    return this.ctx.cfg;
  }
  pid(userId) {
    return 'u' + userId;
  }
  player(userId) {
    return this.table.players.find((p) => p.userId === userId) || null;
  }
  humans() {
    return this.table.players.filter((p) => !p.isBot);
  }
  bots() {
    return this.table.players.filter((p) => p.isBot);
  }
  summary() {
    return {
      id: this.id,
      code: this.isPrivate ? undefined : this.code,
      name: this.name,
      isPrivate: this.isPrivate,
      ante: this.ante,
      maxPlayers: this.maxPlayers,
      players: this.table.players.length,
      humans: this.humans().length,
      status: this.status,
      freeSeats: this.freeHumanSeats(),
    };
  }
  /** Odam uchun bo'sh joylar (botlar o'rnini bo'shatib beradi) */
  freeHumanSeats() {
    return this.maxPlayers - this.humans().length;
  }

  _schedule(sec, fn, setDeadline = true) {
    clearTimeout(this.timer);
    const ms = Math.max(0, sec * 1000);
    this.deadline = setDeadline ? Date.now() + ms : null;
    this.timer = setTimeout(() => {
      this.timer = null;
      try {
        fn();
      } catch (e) {
        this.ctx.onError && this.ctx.onError(e, this);
      }
    }, ms);
  }

  _setStatus(s) {
    this.status = s;
    this.seq++;
  }

  /* ---------------- a'zolik ---------------- */
  /** Stolga qo'shilish (yoki qayta ulanish). Buy-in balansdan band qilinadi. */
  join(user) {
    if (this.status === S.CLOSED) throw new GameError('closed', 'Stol yopilgan');
    const m = this.members.get(user.id);
    if (m) {
      m.connected = true;
      clearTimeout(m.graceTimer);
      m.graceTimer = null;
      if (m.leaving && !this.table.handActive) m.leaving = false;
      this.broadcast();
      return { reconnected: true };
    }
    if (this.freeHumanSeats() <= 0) throw new GameError('full', 'Stolda bo\'sh joy yo\'q');
    const minBuyIn = this.ante * 2;
    const fresh = this.ctx.repo.getUser(user.id);
    if (!fresh || fresh.balance < minBuyIn) throw new GameError('insufficient', `Kamida ${minBuyIn} chip kerak`);
    const buyIn = Math.min(fresh.balance, this.ante * this.cfg.buyInAntes);
    this.ctx.repo.seatBuyIn(user.id, this.id, buyIn); // tranzaksiya; boshqa stolda bo'lsa xato

    // bo'sh joy kerak bo'lsa bitta bot keyingi qo'ldan ketadi
    if (this.table.players.length >= this.maxPlayers) {
      const bot = this.bots().find((b) => !b.leaving);
      if (bot) {
        bot.leaving = true;
        if (!this.table.handActive) this._removeBot(bot);
      }
    }
    this.table.addPlayer({
      id: this.pid(user.id),
      userId: user.id,
      name: user.first_name || 'O\'yinchi',
      photo: user.photo_url || null,
      level: levelFromXp(user.xp),
      chips: buyIn,
      isBot: false,
    });
    this.members.set(user.id, { userId: user.id, connected: true, leaving: false, missed: 0, graceTimer: null });
    this.ctx.repo.audit(user.id, 'room_join', { room: this.id, buyIn });
    this.seq++;
    this._maybeStart();
    this.broadcast();
    return { reconnected: false, buyIn };
  }

  /** Stoldan chiqish. Qo'l davomida bo'lsa — pas, chiplar qo'l tugagach qaytadi. */
  leave(userId, reason = 'Chiqdi') {
    const m = this.members.get(userId);
    if (!m) return false;
    m.leaving = true;
    const p = this.player(userId);
    if (this.table.handActive && p && p.inHand) {
      if (this.table.phase === 'betting' && !p.folded) {
        const wasTurn = this.table.players[this.table.toAct] === p;
        this.table.forceFold(p.id, reason);
        this._afterAction(wasTurn);
      } else {
        this.svaraDecided.add(userId);
        this._maybeEndSvaraDecision();
      }
      this.broadcast();
      return true;
    }
    this._finalizeLeave(userId);
    this.seq++;
    this._afterMembershipChange();
    return true;
  }

  _finalizeLeave(userId, type = 'cashout') {
    const p = this.player(userId);
    const m = this.members.get(userId);
    if (m) clearTimeout(m.graceTimer);
    this.members.delete(userId);
    if (p) this.table.removePlayer(p.id);
    const t = this.ctx.repo.seatCashOut(userId, this.id, p ? p.chips : undefined, type);
    this.ctx.repo.audit(userId, 'room_leave', { room: this.id, stack: p ? p.chips : null });
    this.ctx.onLeft && this.ctx.onLeft(userId, this, t);
  }

  _afterMembershipChange() {
    if (this.members.size === 0) return this.close();
    if (!this.table.handActive) {
      if (this.table.players.filter((p) => p.chips >= this.ante).length < 2 && this.status !== S.WAITING) {
        clearTimeout(this.timer);
        this.deadline = null;
        this._setStatus(S.WAITING);
      }
      this._maybeStart();
    }
    this.broadcast();
  }

  disconnect(userId) {
    const m = this.members.get(userId);
    if (!m) return;
    m.connected = false;
    m.disconnectedAt = Date.now();
    clearTimeout(m.graceTimer);
    m.graceTimer = setTimeout(() => {
      if (!m.connected && this.members.get(userId) === m) this.leave(userId, 'Uzildi');
    }, this.cfg.disconnectGraceSec * 1000);
    this.seq++;
    this.broadcast();
  }

  /* ---------------- o'yin oqimi ---------------- */
  _eligible() {
    return this.table.players.filter((p) => p.chips >= this.ante && !p.leaving && !(this.members.get(p.userId) || {}).leaving);
  }

  _maybeStart() {
    if (this.status === S.CLOSED || this.table.handActive) return;
    if (this.status === S.READY || this.status === S.DEALING) return;
    const eligible = this._eligible();
    const humans = eligible.filter((p) => !p.isBot).length;
    if (humans === 0) return;
    if (eligible.length >= 2) {
      this._setStatus(S.READY);
      this._schedule(this.cfg.nextHandSeconds, () => this._startHand());
      return;
    }
    // yolg'iz odam: jonli o'yinchini kutamiz, so'ng NPC bilan to'ldiramiz
    if (this.fillBots && !this.fillTimer) {
      this.fillTimer = setTimeout(() => {
        this.fillTimer = null;
        if (this.status === S.CLOSED || this.table.handActive) return;
        this._fillBots();
        this.seq++;
        this._maybeStart();
        this.broadcast();
      }, this.cfg.npcFillSeconds * 1000);
    }
    if (this.status !== S.WAITING) this._setStatus(S.WAITING);
    this.deadline = this.fillBots ? Date.now() + this.cfg.npcFillSeconds * 1000 : null;
  }

  _fillBots() {
    if (!this.fillBots || this.humans().length === 0) return;
    while (this.table.players.length < this.maxPlayers) {
      const npc = NPC.createNPC({ ante: this.ante, taken: this.table.players.map((p) => p.name) });
      this.table.addPlayer({ ...npc, userId: null });
    }
  }

  _removeBot(bot) {
    this.table.removePlayer(bot.id);
  }

  _startHand() {
    if (this.status === S.CLOSED) return;
    const eligible = this._eligible();
    if (eligible.length < 2 || !eligible.some((p) => !p.isBot)) {
      this._setStatus(S.WAITING);
      this.deadline = null;
      this._maybeStart();
      return this.broadcast();
    }
    this.table.startHand((p) => eligible.includes(p));
    this.svaraJoins.clear();
    this.handMeta = {
      startedAt: Date.now(),
      before: new Map(this.table.players.filter((p) => p.inHand).map((p) => [p.id, p.chips + this.ante])),
    };
    this.lastResult = null;
    this._setStatus(S.DEALING);
    this.turnSeq++;
    this.broadcast();
    this._schedule(this.cfg.dealSeconds ?? 1.2, () => {
      this._setStatus(S.PLAYING);
      this._startTurn();
      this.broadcast();
    });
  }

  _currentPlayer() {
    return this.table.players[this.table.toAct] || null;
  }

  _startTurn() {
    if (this.table.phase !== 'betting') return;
    const p = this._currentPlayer();
    if (!p) return;
    this.turnSeq++;
    const m = p.userId ? this.members.get(p.userId) : null;
    if (m && m.leaving) {
      // stoldan chiqayotgan o'yinchi (masalan svarada) — avtomatik pas
      return this._schedule(0.3, () => {
        if (this._currentPlayer() !== p) return;
        this.table.forceFold(p.id, 'Chiqdi');
        this._afterAction(true);
      });
    }
    if (p.isBot) {
      const think = (this.cfg.botThinkSeconds ?? 1) * (0.6 + Math.random() * 0.8);
      this._schedule(think, () => this._botAct(p), false);
      this.deadline = Date.now() + this.cfg.turnSeconds * 1000; // mijozga ko'rsatish uchun
    } else {
      this._schedule(this.cfg.turnSeconds, () => this._timeout(p));
    }
  }

  _botAct(p) {
    if (this._currentPlayer() !== p || this.table.phase !== 'betting') return;
    const a = E.botDecide(this.table, this.table.toAct, Math.random, NPC.STYLES[p.style]);
    this.table.act(a);
    this._afterAction(true);
  }

  _timeout(p) {
    if (this._currentPlayer() !== p || this.table.phase !== 'betting') return;
    const legal = this.table.legalActions();
    const m = this.members.get(p.userId);
    if (legal.some((a) => a.type === 'check')) {
      this.table.act({ type: 'check' });
      this.table.actions[this.table.actions.length - 1].forced = true;
    } else {
      this.table.forceFold(p.id, 'Vaqt tugadi');
    }
    if (m) {
      m.missed++;
      if (m.missed >= 2) {
        m.leaving = true; // ketma-ket 2 marta javob bermasa — qo'l oxirida stoldan chiqariladi
        this.ctx.notify(p.userId, { type: 'notice', code: 'idle', message: 'Javob bermaganingiz uchun stoldan chiqarildingiz' });
      }
    }
    this._afterAction(true);
  }

  /** Odam harakati: navbat, eskirganlik va idempotentlik tekshiruvi */
  act(userId, action, { turnSeq, actionId } = {}) {
    const m = this.members.get(userId);
    if (!m) throw new GameError('not_member', 'Siz bu stolda emassiz');
    if (actionId) {
      m.recent = m.recent || [];
      if (m.recent.includes(actionId)) return { duplicate: true };
    }
    if (this.status !== S.PLAYING || this.table.phase !== 'betting') throw new GameError('not_playing', 'Hozir harakat qilib bo\'lmaydi');
    const p = this._currentPlayer();
    if (!p || p.userId !== userId) throw new GameError('not_your_turn', 'Sizning navbatingiz emas');
    if (turnSeq !== undefined && turnSeq !== this.turnSeq) throw new GameError('stale', 'Holat yangilandi, qayta urinib ko\'ring');
    if (!action || typeof action.type !== 'string') throw new GameError('invalid', 'Noto\'g\'ri harakat');
    const legal = this.table.legalActions();
    const ok = legal.find((a) => a.type === action.type && (a.type !== 'raise' || a.to === action.to));
    if (!ok) throw new GameError('illegal', 'Bu harakat hozir mumkin emas');
    this.table.act({ type: ok.type, to: ok.to });
    m.missed = 0;
    if (actionId) {
      m.recent.push(actionId);
      if (m.recent.length > 50) m.recent.shift();
    }
    this._afterAction(true);
    return { ok: true };
  }

  _afterAction(turnChanged) {
    const t = this.table;
    if (t.phase === 'betting') {
      if (turnChanged) this._startTurn();
    } else if (t.phase === 'svara') {
      this._beginSvaraDecision();
    } else if (t.phase === 'over') {
      this._finishHand();
    }
    this.seq++;
    this.broadcast();
  }

  _beginSvaraDecision() {
    clearTimeout(this.timer);
    this._setStatus(S.ROUND_END);
    this.svaraJoins.clear();
    this.svaraDecided.clear();
    this.lastResult = this._resultView();
    for (const b of this.bots()) if (E.botJoinSvara(this.table, b)) this.svaraJoins.add(b.id);
    this._schedule(this.cfg.svaraDecisionSeconds, () => this._startSvara());
    this._maybeEndSvaraDecision();
  }

  _svaraCandidates() {
    return this.humans().filter((p) => this.table.canJoinSvara(p) && !(this.members.get(p.userId) || {}).leaving);
  }

  _maybeEndSvaraDecision() {
    if (this.table.phase !== 'svara') return;
    const pending = this._svaraCandidates().filter((p) => !this.svaraDecided.has(p.userId));
    if (pending.length === 0) this._schedule(Math.min(2, this.cfg.svaraDecisionSeconds), () => this._startSvara());
  }

  svaraDecision(userId, join) {
    if (this.table.phase !== 'svara') throw new GameError('not_svara', 'Svara emas');
    const p = this.player(userId);
    if (!p || !this.table.canJoinSvara(p)) throw new GameError('illegal', 'Svaraga qo\'shila olmaysiz');
    if (this.svaraDecided.has(userId)) return { duplicate: true };
    this.svaraDecided.add(userId);
    if (join) this.svaraJoins.add(p.id);
    this.seq++;
    this._maybeEndSvaraDecision();
    this.broadcast();
    return { ok: true };
  }

  _startSvara() {
    if (this.table.phase !== 'svara') return;
    // qo'l boshida qatnashmagan (keyin o'tirgan) qo'shiluvchilarning boshlang'ich chipi — to'lovdan oldin
    for (const id of this.svaraJoins) {
      const p = this.table.players.find((x) => x.id === id);
      if (p && !this.handMeta.before.has(id)) this.handMeta.before.set(id, p.chips);
    }
    this.table.startSvara([...this.svaraJoins]);
    this.svaraJoins.clear();
    this.svaraDecided.clear();
    this._setStatus(S.DEALING);
    this.turnSeq++;
    this.broadcast();
    this._schedule(this.cfg.dealSeconds ?? 1.2, () => {
      this._setStatus(S.PLAYING);
      this._startTurn();
      this.broadcast();
    });
  }

  _resultView() {
    const t = this.table;
    const r = t.result;
    if (!r) return null;
    const revealed = {};
    if (r.scores) {
      for (const p of t.players) {
        if (p.inHand && !p.folded && r.scores[p.id] !== undefined) {
          revealed[p.id] = { cards: p.cards, score: r.scores[p.id], label: E.describeHand(p.cards, t.rules) };
        }
      }
    }
    return { type: r.type, winners: r.winners, svaraPlayers: r.svaraPlayers, payouts: r.payouts || {}, pot: r.pot, revealed };
  }

  _finishHand() {
    clearTimeout(this.timer);
    const t = this.table;
    this._setStatus(S.ROUND_END);
    this.lastResult = this._resultView();
    // natijani saqlash (bitta tranzaksiya)
    try {
      const players = t.players
        .filter((p) => this.handMeta.before.has(p.id))
        .map((p) => ({
          userId: p.userId || null,
          name: p.name,
          before: this.handMeta.before.get(p.id),
          after: p.chips,
          score: t.result.scores ? t.result.scores[p.id] ?? null : null,
          cards: cardStr(p.cards),
          winner: t.result.winners.includes(p.id),
        }));
      const uidOf = new Map(t.players.map((p) => [p.id, p.userId || null]));
      const gameId = this.ctx.repo.saveHand({
        roomId: this.id,
        handNo: t.handNo,
        ante: this.ante,
        rules: t.rules,
        pot: t.result.pot,
        resultType: t.result.type,
        svaraRounds: t.svaraRound,
        startedAt: this.handMeta.startedAt,
        players,
        actions: t.actions.map((a) => ({ ...a, userId: uidOf.get(a.playerId) })),
      });
      this.lastResult.gameId = gameId;
      for (const p of players) if (p.userId) this.ctx.onHandResult && this.ctx.onHandResult(p.userId, p, this);
    } catch (e) {
      this.ctx.onError && this.ctx.onError(e, this);
    }
    this._schedule(this.cfg.resultSeconds ?? 3, () => this._afterHand());
  }

  _afterHand() {
    this._setStatus(S.FINISHED);
    // chiqib ketganlar va chipi tugaganlar
    for (const [uid, m] of [...this.members]) {
      const p = this.player(uid);
      if (m.leaving) this._finalizeLeave(uid);
      else if (p && p.chips < this.ante) {
        this.ctx.notify(uid, { type: 'notice', code: 'broke', message: 'Chiplaringiz tugadi' });
        this._finalizeLeave(uid);
      }
    }
    if (this.members.size === 0) return this.close();
    // botlar: ketishi kerak bo'lganlar, chipi tugaganlar, ba'zan almashish
    for (const b of this.bots()) if (b.leaving || b.chips < this.ante) this._removeBot(b);
    if (this.fillBots && this.bots().length && Math.random() < (this.cfg.npcChurn ?? 0.15)) {
      const bs = this.bots();
      this._removeBot(bs[Math.floor(Math.random() * bs.length)]);
    }
    if (this.fillBots && this.humans().length > 0) this._fillBots();
    for (const p of this.table.players) {
      p.cards = [];
      p.lastAction = '';
    }
    this.table.phase = 'idle';
    this.seq++;
    this._maybeStart();
    this.broadcast();
  }

  close() {
    if (this.status === S.CLOSED) return;
    clearTimeout(this.timer);
    clearTimeout(this.fillTimer);
    if (this.table.handActive && this.handMeta) {
      // qo'l o'rtasida yopilsa — har kimga qo'l boshidagi chiplari qaytariladi
      for (const p of this.table.players) if (this.handMeta.before.has(p.id)) p.chips = this.handMeta.before.get(p.id);
      this.table.pot = 0;
      this.table.phase = 'idle';
    }
    for (const uid of [...this.members.keys()]) {
      try {
        this._finalizeLeave(uid, 'refund');
      } catch (_) {}
    }
    this._setStatus(S.CLOSED);
    this.ctx.repo.closeRoom(this.id);
    this.ctx.onClose && this.ctx.onClose(this);
  }

  /* ---------------- ko'rinishlar ---------------- */
  viewFor(userId) {
    const t = this.table;
    const me = this.player(userId);
    const showdown = this.status === S.ROUND_END && this.lastResult;
    const players = t.players.map((p, seat) => {
      const m = p.userId ? this.members.get(p.userId) : null;
      const isMe = me && p.id === me.id;
      const rev = showdown && this.lastResult.revealed[p.id];
      return {
        seat,
        id: p.id,
        userId: p.userId || null,
        name: p.name,
        photo: p.photo || null,
        flag: p.flag || null,
        level: p.level || 1,
        isNew: !!p.isNew,
        chips: p.chips,
        bet: p.bet,
        inHand: p.inHand,
        folded: p.folded,
        lastAction: p.lastAction,
        connected: m ? m.connected : true,
        leaving: !!(m ? m.leaving : p.leaving),
        cardCount: p.inHand ? p.cards.length : 0,
        // kartalar: faqat o'ziniki yoki showdownda ochilganlar
        cards: isMe && p.inHand ? p.cards : rev ? rev.cards : null,
        score: isMe && p.inHand && p.cards.length ? E.scoreHand(p.cards, t.rules) : rev ? rev.score : null,
        handLabel: isMe && p.inHand && p.cards.length ? E.describeHand(p.cards, t.rules) : rev ? rev.label : null,
      };
    });
    const myTurn = me && this.status === S.PLAYING && t.phase === 'betting' && t.players[t.toAct] === me;
    return {
      room: { id: this.id, code: this.code, name: this.name, isPrivate: this.isPrivate, ante: this.ante, maxPlayers: this.maxPlayers, fillBots: this.fillBots },
      status: this.status,
      seq: this.seq,
      turnSeq: this.turnSeq,
      deadline: this.deadline,
      serverNow: Date.now(),
      turnSeconds: this.cfg.turnSeconds,
      handNo: t.handNo,
      svaraRound: t.svaraRound,
      pot: t.pot,
      currentBet: t.currentBet,
      dealer: t.dealer,
      toAct: this.status === S.PLAYING ? t.toAct : -1,
      players,
      you: me
        ? {
            seat: t.players.indexOf(me),
            id: me.id,
            legal: myTurn ? t.legalActions() : [],
            canJoinSvara: t.phase === 'svara' && t.canJoinSvara(me) && !this.svaraDecided.has(userId),
            svaraCost: t.phase === 'svara' ? t.svaraJoinCost() : 0,
            leaving: !!(this.members.get(userId) || {}).leaving,
          }
        : null,
      result: showdown ? this.lastResult : null,
      log: t.log.slice(-8),
    };
  }

  broadcast() {
    for (const [uid, m] of this.members) if (m.connected) this.ctx.notify(uid, { type: 'state', state: this.viewFor(uid) });
  }
}

/* ======================================================================== */

class RoomManager {
  constructor(ctx) {
    this.ctx = ctx; // { repo, cfg, rules, notify, onError }
    this.rooms = new Map();
    this.byCode = new Map();
    this.userRoom = new Map();
  }

  _ctxFor() {
    return {
      ...this.ctx,
      onClose: (room) => {
        this.rooms.delete(room.id);
        this.byCode.delete(room.code);
      },
      onLeft: (userId, room, t) => {
        if (this.userRoom.get(userId) === room.id) this.userRoom.delete(userId);
        this.ctx.notify(userId, { type: 'left', roomId: room.id, balance: t && t.balance_after });
      },
    };
  }

  create({ ante, maxPlayers = 4, isPrivate = false, fillBots, name }, user) {
    const cfg = this.ctx.cfg;
    if (!cfg.antes.includes(ante)) throw new GameError('invalid', 'Noto\'g\'ri stavka');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 6) throw new GameError('invalid', 'O\'yinchilar soni 2–6');
    let code;
    do code = randomCode(); while (this.byCode.has(code));
    const room = new Room(
      {
        id: crypto.randomUUID(),
        code,
        name: String(name || (isPrivate ? 'Yopiq stol' : `Stol ${ante}`)).slice(0, 32),
        isPrivate,
        ante,
        maxPlayers,
        fillBots: fillBots ?? !isPrivate,
        createdBy: user ? user.id : null,
      },
      this._ctxFor()
    );
    this.ctx.repo.saveRoom(room);
    this.rooms.set(room.id, room);
    this.byCode.set(code, room);
    return room;
  }

  roomOf(userId) {
    const id = this.userRoom.get(userId);
    return id ? this.rooms.get(id) || null : null;
  }

  join(room, user) {
    const cur = this.roomOf(user.id);
    if (cur && cur !== room) throw new GameError('seated', 'Avval joriy stoldan chiqing');
    const r = room.join(user);
    this.userRoom.set(user.id, room.id);
    return r;
  }

  joinByCode(code, user) {
    const room = this.byCode.get(String(code || '').toUpperCase());
    if (!room || room.status === S.CLOSED) throw new GameError('not_found', 'Stol topilmadi');
    return { room, ...this.join(room, user) };
  }

  /** Tez o'yin: shu stavkali ochiq stol, bo'lmasa yangi stol */
  quickPlay(user, ante, maxPlayers = 4) {
    const cur = this.roomOf(user.id);
    if (cur) return { room: cur, ...this.join(cur, user) };
    const candidates = [...this.rooms.values()]
      .filter((r) => !r.isPrivate && r.ante === ante && r.status !== S.CLOSED && r.freeHumanSeats() > 0)
      .sort((a, b) => b.humans().length - a.humans().length);
    const existing = candidates[0];
    const room = existing || this.create({ ante, maxPlayers, isPrivate: false, fillBots: true }, user);
    try {
      return { room, ...this.join(room, user) };
    } catch (e) {
      if (!existing && room.members.size === 0) room.close(); // muvaffaqiyatsiz bo'lsa bo'sh stol qolmasin
      throw e;
    }
  }

  leave(userId) {
    const room = this.roomOf(userId);
    if (!room) return false;
    return room.leave(userId);
  }

  listPublic() {
    return [...this.rooms.values()].filter((r) => !r.isPrivate && r.status !== S.CLOSED).map((r) => r.summary());
  }

  stats() {
    let humans = 0;
    let playing = 0;
    for (const r of this.rooms.values()) {
      humans += r.members.size;
      if (r.table.handActive) playing++;
    }
    return { rooms: this.rooms.size, seatedPlayers: humans, activeHands: playing };
  }

  shutdown() {
    for (const r of [...this.rooms.values()]) r.close();
  }
}

module.exports = { Room, RoomManager, GameError, STATUS: S, randomCode };

/*
 * Oflayn mashq rejimi: brauzerdagi stol (NPC'lar bilan).
 * Serverdagi `Room.viewFor()` bilan bir xil ko'rinish (view) qaytaradi —
 * shuning uchun interfeys ikkala rejimni bitta kod bilan chizadi.
 * Natijalar faqat shu qurilmadagi mashq chiplariga ta'sir qiladi.
 */
(function () {
  'use strict';
  const E = window.SvaraEngine;
  const NPC = window.SvaraNPC;

  const T = { ready: 1.2, deal: 0.9, turn: 30, result: 3.2, svara: 10, think: 1.1 };

  class LocalRoom {
    constructor({ me, ante, size, onState, onHandEnd, notify }) {
      this.ante = ante;
      this.size = size;
      this.onState = onState;
      this.onHandEnd = onHandEnd;
      this.notify = notify || (() => {});
      this.table = new E.Table({ players: [], ante, rng: E.secureRandom });
      this.table.addPlayer({ id: 'me', name: me.name, photo: me.photo, chips: me.chips, level: me.level || 1 });
      this.status = 'WAITING_FOR_PLAYERS';
      this.turnSeq = 0;
      this.deadline = null;
      this.timer = null;
      this.result = null;
      this.svaraDecided = false;
      this.svaraJoins = new Set();
      this.closed = false;
      this.before = new Map();
    }

    get me() {
      return this.table.players.find((p) => p.id === 'me');
    }

    _schedule(sec, fn, deadline = true) {
      clearTimeout(this.timer);
      this.deadline = deadline ? Date.now() + sec * 1000 : null;
      this.timer = setTimeout(() => !this.closed && fn(), sec * 1000);
    }

    _fill() {
      while (this.table.players.length < this.size) {
        this.table.addPlayer({ ...NPC.createNPC({ ante: this.ante, taken: this.table.players.map((p) => p.name) }) });
      }
    }

    start() {
      this._fill();
      this._ready();
    }

    _ready() {
      if (this.me.chips < this.ante) {
        this.status = 'FINISHED';
        this.emit();
        return this.notify({ code: 'broke', message: 'Mashq chiplari tugadi' });
      }
      this.status = 'READY';
      this.emit();
      this._schedule(T.ready, () => this._startHand());
    }

    _startHand() {
      this.table.startHand();
      this.before = new Map(this.table.players.filter((p) => p.inHand).map((p) => [p.id, p.chips + this.ante]));
      this.result = null;
      this._deal();
    }

    _deal() {
      this.status = 'DEALING';
      this.turnSeq++;
      this.emit();
      this._schedule(T.deal, () => {
        this.status = 'PLAYING';
        this._turn();
        this.emit();
      });
    }

    _turn() {
      const t = this.table;
      if (t.phase !== 'betting') return;
      const p = t.players[t.toAct];
      this.turnSeq++;
      if (p.isBot) {
        this._schedule(T.think * (0.6 + Math.random() * 0.8), () => {
          t.act(E.botDecide(t, t.toAct, Math.random, NPC.STYLES[p.style]));
          this._after();
        }, false);
        this.deadline = Date.now() + T.turn * 1000;
      } else {
        this._schedule(T.turn, () => {
          const legal = t.legalActions();
          if (legal.some((a) => a.type === 'check')) t.act({ type: 'check' });
          else t.forceFold('me', 'Vaqt tugadi');
          this._after();
        });
      }
    }

    _after() {
      const t = this.table;
      if (t.phase === 'betting') this._turn();
      else if (t.phase === 'svara') this._svara();
      else if (t.phase === 'over') this._over();
      this.emit();
    }

    act(action) {
      const t = this.table;
      if (this.status !== 'PLAYING' || t.players[t.toAct] !== this.me) throw new Error('Navbat sizda emas');
      const ok = t.legalActions().find((a) => a.type === action.type && (a.type !== 'raise' || a.to === action.to));
      if (!ok) throw new Error('Bu harakat mumkin emas');
      t.act({ type: ok.type, to: ok.to });
      this._after();
    }

    _revealed() {
      const t = this.table;
      const r = t.result;
      const out = {};
      if (r && r.scores) for (const p of t.players) if (p.inHand && !p.folded && r.scores[p.id] !== undefined) out[p.id] = { cards: p.cards, score: r.scores[p.id], label: E.describeHand(p.cards) };
      return out;
    }

    _svara() {
      const t = this.table;
      this.status = 'ROUND_END';
      this.svaraJoins = new Set(t.players.filter((b) => b.isBot && E.botJoinSvara(t, b)).map((b) => b.id));
      this.svaraDecided = !t.canJoinSvara(this.me);
      this.result = { type: 'svara', winners: [], svaraPlayers: t.result.svaraPlayers, payouts: {}, pot: t.pot, revealed: this._revealed() };
      this._schedule(this.svaraDecided ? 2.5 : T.svara, () => this._startSvara());
    }

    svara(join) {
      if (this.table.phase !== 'svara' || this.svaraDecided) return;
      this.svaraDecided = true;
      if (join && this.table.canJoinSvara(this.me)) this.svaraJoins.add('me');
      this._schedule(1.2, () => this._startSvara());
      this.emit();
    }

    _startSvara() {
      for (const id of this.svaraJoins) {
        const p = this.table.players.find((x) => x.id === id);
        if (p && !this.before.has(id)) this.before.set(id, p.chips);
      }
      this.table.startSvara([...this.svaraJoins]);
      this._deal();
    }

    _over() {
      const t = this.table;
      this.status = 'ROUND_END';
      this.result = { ...t.result, svaraPlayers: [], revealed: this._revealed() };
      const me = this.me;
      if (this.before.has('me')) this.onHandEnd && this.onHandEnd({ chips: me.chips, delta: me.chips - this.before.get('me'), won: t.result.winners.includes('me') });
      this._schedule(T.result, () => {
        this.status = 'FINISHED';
        for (const b of t.players.filter((p) => p.isBot && p.chips < this.ante)) {
          t.removePlayer(b.id);
          this.notify({ code: 'npc', message: `${b.name} stolni tark etdi` });
        }
        if (Math.random() < 0.15) {
          const bots = t.players.filter((p) => p.isBot);
          const b = bots[Math.floor(Math.random() * bots.length)];
          if (b) {
            t.removePlayer(b.id);
            this.notify({ code: 'npc', message: `${b.name} stolni tark etdi` });
          }
        }
        this._fill();
        for (const p of t.players) { p.cards = []; p.lastAction = ''; }
        t.phase = 'idle';
        this._ready();
      });
    }

    leave() {
      this.closed = true;
      clearTimeout(this.timer);
      // qo'l o'rtasida chiqsa — tikilgan chiplar yo'qoladi (serverdagi kabi)
      return this.me.chips;
    }

    view() {
      const t = this.table;
      const me = this.me;
      const showdown = this.status === 'ROUND_END' && this.result;
      const players = t.players.map((p, seat) => {
        const isMe = p === me;
        const rev = showdown && this.result.revealed[p.id];
        return {
          seat, id: p.id, userId: null, name: p.name, photo: p.photo || null, flag: p.flag || null, level: p.level || 1,
          chips: p.chips, bet: p.bet, inHand: p.inHand, folded: p.folded, lastAction: p.lastAction, connected: true, leaving: false,
          cardCount: p.inHand ? p.cards.length : 0,
          cards: isMe && p.inHand ? p.cards : rev ? rev.cards : null,
          score: isMe && p.inHand && p.cards.length ? E.scoreHand(p.cards) : rev ? rev.score : null,
          handLabel: isMe && p.inHand && p.cards.length ? E.describeHand(p.cards) : rev ? rev.label : null,
        };
      });
      const myTurn = this.status === 'PLAYING' && t.phase === 'betting' && t.players[t.toAct] === me;
      return {
        room: { id: 'local', code: null, name: 'Mashq stoli', isPrivate: true, ante: this.ante, maxPlayers: this.size, local: true },
        status: this.status, seq: 0, turnSeq: this.turnSeq, deadline: this.deadline, serverNow: Date.now(), turnSeconds: T.turn,
        handNo: t.handNo, svaraRound: t.svaraRound, pot: t.pot, currentBet: t.currentBet, dealer: t.dealer,
        toAct: this.status === 'PLAYING' ? t.toAct : -1, players,
        you: {
          seat: t.players.indexOf(me), id: 'me', legal: myTurn ? t.legalActions() : [],
          canJoinSvara: t.phase === 'svara' && !this.svaraDecided && t.canJoinSvara(me),
          svaraCost: t.phase === 'svara' ? t.svaraJoinCost() : 0, leaving: false,
        },
        result: showdown ? this.result : null,
        log: t.log.slice(-8),
      };
    }

    emit() {
      if (!this.closed) this.onState(this.view());
    }
  }

  window.SvaraLocal = { LocalRoom };
})();

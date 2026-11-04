const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../webapp/engine.js');

const c = (s) => {
  const suit = s.slice(-1);
  return { rank: s.slice(0, -1), suit };
};
const hand = (...xs) => xs.map(c);

test('koloda 32 ta noyob kartadan iborat', () => {
  const d = E.createDeck();
  assert.equal(d.length, 32);
  assert.equal(new Set(d.map((x) => x.rank + x.suit)).size, 32);
});

test('mast bo\'yicha ochko', () => {
  assert.equal(E.scoreHand(hand('A♥', 'K♥', '10♥')), 31);
  assert.equal(E.scoreHand(hand('A♥', 'K♠', '9♦')), 11);
  assert.equal(E.scoreHand(hand('8♠', '9♠', 'Q♦')), 17);
});

test('joker (7♣) istalgan mastga qo\'shiladi', () => {
  assert.equal(E.scoreHand(hand('7♣', 'A♥', 'K♥')), 32);
  assert.equal(E.scoreHand(hand('7♣', '8♠', '9♦')), 20);
});

test('ikki tuz = 22', () => {
  assert.equal(E.scoreHand(hand('A♠', 'A♦', '8♥')), 22);
});

test('uchta bir xil', () => {
  assert.equal(E.scoreHand(hand('A♠', 'A♦', 'A♥')), 33);
  assert.equal(E.scoreHand(hand('7♠', '7♦', '7♥')), 34);
  assert.equal(E.scoreHand(hand('7♣', '7♦', '7♥')), 34);
  assert.equal(E.scoreHand(hand('7♣', 'K♦', 'K♥')), 30);
  assert.equal(E.scoreHand(hand('9♠', '9♦', '9♥')), 27);
});

test('to\'liq qo\'l: oxirgi qolgan o\'yinchi bankni oladi', () => {
  const t = new E.Table({
    players: [
      { name: 'A', chips: 100 },
      { name: 'B', chips: 100 },
      { name: 'C', chips: 100 },
    ],
    ante: 10,
  }).startHand();
  assert.equal(t.pot, 30);
  const first = t.toAct;
  t.act({ type: 'fold' });
  t.act({ type: 'fold' });
  assert.equal(t.phase, 'over');
  const winner = t.players.find((p) => p.id === t.result.winners[0]);
  assert.notEqual(winner, t.players[first]);
  assert.equal(t.players.reduce((s, p) => s + p.chips, 0), 300);
});

test('stavka stol limitidan oshmaydi', () => {
  const t = new E.Table({
    players: [
      { name: 'A', chips: 1000 },
      { name: 'B', chips: 25 },
    ],
    ante: 10,
  }).startHand();
  const raises = t.legalActions().filter((a) => a.type === 'raise');
  assert.ok(raises.every((a) => a.to <= 15));
});

test('svara: durangda bank saqlanadi va qayta tarqatiladi', () => {
  const t = new E.Table({
    players: [
      { name: 'A', chips: 100 },
      { name: 'B', chips: 100 },
      { name: 'C', chips: 100 },
    ],
    ante: 10,
  }).startHand();
  // Kartalarni majburan teng qilamiz
  t.players[0].cards = hand('A♥', 'K♥', '8♠');
  t.players[1].cards = hand('A♠', 'K♠', '8♦');
  t.players[2].cards = hand('7♠', '8♥', '9♦');
  while (t.phase === 'betting') {
    const a = t.legalActions();
    t.act(a.find((x) => x.type === 'check') || a.find((x) => x.type === 'call'));
  }
  assert.equal(t.phase, 'svara');
  assert.deepEqual(t.result.svaraPlayers.sort(), [0, 1]);
  const cost = t.svaraJoinCost();
  t.startSvara([2]);
  assert.equal(t.pot, 30 + cost);
  assert.equal(t.activePlayers().length, 3);
  assert.equal(t.phase, 'betting');
});

test('botlar bilan ko\'p qo\'l — chiplar yo\'qolmaydi', () => {
  let seed = 42;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const t = new E.Table({
    players: Array.from({ length: 5 }, (_, i) => ({ name: 'P' + i, chips: 500, isBot: true })),
    ante: 10,
    rng,
  });
  for (let h = 0; h < 300; h++) {
    if (t.players.filter((p) => p.chips >= t.ante).length < 2) break;
    t.startHand();
    let guard = 0;
    while (t.phase !== 'over') {
      if (t.phase === 'svara') {
        t.startSvara(t.players.filter((p) => E.botJoinSvara(t, p, rng)).map((p) => p.id));
        continue;
      }
      t.act(E.botDecide(t, t.toAct, rng));
      assert.ok(++guard < 1000, 'cheksiz sikl');
    }
    assert.equal(t.players.reduce((s, p) => s + p.chips, 0), 2500);
    assert.ok(t.players.every((p) => p.chips >= 0));
  }
});

const NPC = require('../webapp/npc.js');

test('NPC nomlari xilma-xil: mehmon, nik va turli davlatlar', () => {
  const npcs = Array.from({ length: 400 }, () => NPC.createNPC({ ante: 10 }));
  const countries = new Set(npcs.map((n) => n.country));
  assert.ok(countries.size >= 10, 'kamida 10 xil davlat');
  assert.ok(npcs.some((n) => /^(Mehmon|Guest|Гость|Misafir|Player|Игрок|O'yinchi|Gast|Invité|Jugador)/.test(n.name)));
  assert.ok(npcs.some((n) => n.isNew));
  for (const n of npcs) {
    assert.ok(n.name.length > 0 && n.flag && n.chips >= 150 && n.level >= 1);
    assert.ok(NPC.STYLES[n.style]);
  }
});

test('NPC stoldagi band nomni takrorlamaydi', () => {
  let i = 0;
  const seq = [0.5, 0.9, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
  const rng = () => seq[i++ % seq.length];
  const a = NPC.createNPC({ rng });
  i = 0;
  const b = NPC.createNPC({ rng: () => (i++ < 4 ? seq[i - 1] : Math.random()), taken: [a.name] });
  assert.notEqual(a.name, b.name);
});

test('har xil uslubdagi NPC lar bilan o\'yin — chiplar saqlanadi', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const players = Array.from({ length: 6 }, () => NPC.createNPC({ ante: 10, rng }));
  const total = players.reduce((s, p) => s + p.chips, 0);
  const t = new E.Table({ players, ante: 10, rng });
  assert.equal(t.players[0].flag, players[0].flag, 'qo\'shimcha maydonlar saqlanadi');
  for (let h = 0; h < 200; h++) {
    if (t.players.filter((p) => p.chips >= t.ante).length < 2) break;
    t.startHand();
    while (t.phase !== 'over') {
      if (t.phase === 'svara') { t.startSvara([]); continue; }
      const p = t.players[t.toAct];
      t.act(E.botDecide(t, t.toAct, rng, NPC.STYLES[p.style]));
    }
    assert.equal(t.players.reduce((s, p) => s + p.chips, 0), total);
  }
});

/* ---------- qoidalar konfiguratsiyasi va server uchun qo'shimchalar ---------- */

test('qoidalar sozlanadi: joker o\'chirilsa 7♣ oddiy karta', () => {
  const rules = E.resolveRules({ jokerEnabled: false });
  assert.equal(E.scoreHand(hand('7♣', 'A♥', 'K♥'), rules), 21);
  assert.equal(E.scoreHand(hand('7♣', 'A♥', 'K♥')), 32);
  assert.equal(E.scoreHand(hand('7♠', '7♦', '7♥'), E.resolveRules({ threeSevensScore: 21 })), 21);
});

test('noto\'g\'ri harakat va navbatdan tashqari harakat rad etiladi', () => {
  const t = new E.Table({ players: [{ name: 'A', chips: 100 }, { name: 'B', chips: 100 }], ante: 10 }).startHand();
  assert.throws(() => t.act({ type: 'call' }), /Noto'g'ri/); // tenglash shart emas — check kerak
  assert.throws(() => t.act({ type: 'raise', to: 9999 }), /Noto'g'ri/);
  assert.deepEqual(t.legalActions(t.toAct === 0 ? 1 : 0), []); // navbati bo'lmagan o'yinchiga harakat yo'q
});

test('forceFold: navbatdan tashqari pas va oxirgi qolgan yutadi', () => {
  const t = new E.Table({ players: [{ id: 'a', name: 'A', chips: 100 }, { id: 'b', name: 'B', chips: 100 }, { id: 'c', name: 'C', chips: 100 }], ante: 10 }).startHand();
  const notTurn = t.players.filter((_, i) => i !== t.toAct);
  assert.ok(t.forceFold(notTurn[0].id, 'Chiqdi'));
  assert.equal(t.phase, 'betting');
  assert.ok(t.forceFold(notTurn[1].id, 'Chiqdi'));
  assert.equal(t.phase, 'over');
  assert.equal(t.players.reduce((s, p) => s + p.chips, 0), 300);
});

test('addPlayer / removePlayer qo\'llar orasida ishlaydi, qo\'l davomida rad etiladi', () => {
  const t = new E.Table({ players: [{ id: 'a', name: 'A', chips: 100 }, { id: 'b', name: 'B', chips: 100 }], ante: 10 });
  t.addPlayer({ id: 'c', name: 'C', chips: 100 });
  assert.throws(() => t.addPlayer({ id: 'c', name: 'C', chips: 1 }));
  t.startHand();
  assert.throws(() => t.removePlayer('a'));
  while (t.phase === 'betting') t.act({ type: 'fold' });
  t.removePlayer('c');
  assert.equal(t.players.length, 2);
});

test('maxSvaraRounds dan keyin bank bo\'linadi', () => {
  const t = new E.Table({ players: [{ id: 'a', name: 'A', chips: 100 }, { id: 'b', name: 'B', chips: 100 }], ante: 10, rules: { maxSvaraRounds: 1 } }).startHand();
  const tie = () => {
    t.players[0].cards = hand('A♥', 'K♥', '8♠');
    t.players[1].cards = hand('A♠', 'K♠', '8♦');
    while (t.phase === 'betting') t.act({ type: 'check' });
  };
  tie();
  assert.equal(t.phase, 'svara');
  t.startSvara();
  tie();
  assert.equal(t.phase, 'over');
  assert.equal(t.result.type, 'split');
  assert.deepEqual(t.players.map((p) => p.chips), [100, 100]);
});

test('harakatlar tarixi yoziladi', () => {
  const t = new E.Table({ players: [{ id: 'a', name: 'A', chips: 100 }, { id: 'b', name: 'B', chips: 100 }], ante: 10 }).startHand();
  t.act({ type: 'fold' });
  assert.deepEqual(t.actions.map((a) => a.type), ['ante', 'ante', 'fold']);
});

test('secureRandom [0,1) oralig\'ida', () => {
  for (let i = 0; i < 1000; i++) {
    const x = E.secureRandom();
    assert.ok(x >= 0 && x < 1);
  }
});

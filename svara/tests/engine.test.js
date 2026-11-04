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

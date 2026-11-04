/*
 * NPC o'yinchilar: turli davlatlardan ismlar, "mehmon" uslubidagi nomlar,
 * nik-neymlar va har xil o'yin uslublari.
 * Brauzerda `window.SvaraNPC`, Node'da `require('./npc.js')`.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SvaraNPC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // Davlat → bayroq va ismlar
  const COUNTRIES = [
    { code: 'UZ', flag: '🇺🇿', weight: 6, names: ['Aziz', 'Dilnoza', 'Sardor', 'Malika', 'Bekzod', 'Nodira', 'Jasur', 'Gulnora', 'Otabek', 'Shahlo', 'Rustam', 'Madina', 'Javohir', 'Sevara', 'Sherzod', 'Zarina', 'Ulugbek', 'Kamola', 'Doniyor', 'Feruza'] },
    { code: 'KZ', flag: '🇰🇿', weight: 2, names: ['Nursultan', 'Aigerim', 'Yerlan', 'Dana', 'Askar', 'Aruzhan', 'Timur', 'Zhanar'] },
    { code: 'KG', flag: '🇰🇬', weight: 1, names: ['Bakyt', 'Aizada', 'Emil', 'Nurzat', 'Azamat'] },
    { code: 'TJ', flag: '🇹🇯', weight: 1, names: ['Firdavs', 'Manizha', 'Faridun', 'Parvina', 'Rahmon'] },
    { code: 'TM', flag: '🇹🇲', weight: 1, names: ['Merdan', 'Aýna', 'Serdar', 'Jeren'] },
    { code: 'RU', flag: '🇷🇺', weight: 3, names: ['Dmitriy', 'Anna', 'Sergey', 'Olga', 'Ivan', 'Natalya', 'Aleksey', 'Ekaterina', 'Maksim', 'Irina'] },
    { code: 'UA', flag: '🇺🇦', weight: 1, names: ['Oleksandr', 'Oksana', 'Taras', 'Yuliya', 'Bohdan'] },
    { code: 'BG', flag: '🇧🇬', weight: 2, names: ['Georgi', 'Petar', 'Lora', 'Ivana', 'Stoyan', 'Desislava', 'Nikolay', 'Maria'] },
    { code: 'TR', flag: '🇹🇷', weight: 2, names: ['Emre', 'Elif', 'Mehmet', 'Zeynep', 'Burak', 'Ayşe', 'Can', 'Selin'] },
    { code: 'AZ', flag: '🇦🇿', weight: 1, names: ['Elvin', 'Leyla', 'Rashad', 'Aysel', 'Orkhan'] },
    { code: 'US', flag: '🇺🇸', weight: 2, names: ['Mike', 'Jessica', 'Chris', 'Ashley', 'Tyler', 'Emily', 'Jake', 'Sarah', 'Steven', 'David'] },
    { code: 'GB', flag: '🇬🇧', weight: 1, names: ['Oliver', 'Amelia', 'Harry', 'Isla', 'George'] },
    { code: 'DE', flag: '🇩🇪', weight: 1, names: ['Lukas', 'Lena', 'Felix', 'Mia', 'Jonas', 'Hannah'] },
    { code: 'FR', flag: '🇫🇷', weight: 1, names: ['Louis', 'Chloé', 'Hugo', 'Camille', 'Théo'] },
    { code: 'ES', flag: '🇪🇸', weight: 1, names: ['Javier', 'Lucía', 'Pablo', 'Carmen', 'Diego'] },
    { code: 'IT', flag: '🇮🇹', weight: 1, names: ['Marco', 'Giulia', 'Luca', 'Chiara', 'Matteo'] },
    { code: 'BR', flag: '🇧🇷', weight: 1, names: ['João', 'Ana', 'Rafael', 'Beatriz', 'Gabriel'] },
    { code: 'IN', flag: '🇮🇳', weight: 1, names: ['Arjun', 'Priya', 'Rahul', 'Ananya', 'Vikram'] },
    { code: 'PK', flag: '🇵🇰', weight: 1, names: ['Ali', 'Ayesha', 'Hamza', 'Fatima', 'Bilal'] },
    { code: 'IR', flag: '🇮🇷', weight: 1, names: ['Reza', 'Shirin', 'Arash', 'Neda', 'Kaveh'] },
    { code: 'EG', flag: '🇪🇬', weight: 1, names: ['Omar', 'Nour', 'Youssef', 'Salma', 'Karim'] },
    { code: 'AE', flag: '🇦🇪', weight: 1, names: ['Khalid', 'Mariam', 'Saeed', 'Hessa'] },
    { code: 'CN', flag: '🇨🇳', weight: 1, names: ['Wei', 'Li Na', 'Hao', 'Xiu', 'Jun'] },
    { code: 'KR', flag: '🇰🇷', weight: 1, names: ['Minjun', 'Jiwoo', 'Seojun', 'Haeun'] },
    { code: 'JP', flag: '🇯🇵', weight: 1, names: ['Haruto', 'Yui', 'Sota', 'Aoi', 'Ren'] },
  ];

  // Mehmon / yangi o'yinchi uslubidagi nomlar (raqam bilan)
  const GUEST_PREFIXES = ['Mehmon', 'Guest', 'Гость', 'Misafir', 'Player', 'Игрок', "O'yinchi", 'Gast', 'Invité', 'Jugador'];
  const NICKS = ['Lucky', 'Shark', 'Ace', 'Joker', 'King', 'Boss', 'Tiger', 'Ninja', 'Wolf', 'Fox', 'Pro', 'Bars', 'Sher', 'Burgut', 'Omad', 'Qirol'];
  const COLORS = ['#8e44ad', '#c0392b', '#2980b9', '#d35400', '#16a085', '#7f8c8d', '#b03a2e', '#1f618d', '#6c3483', '#117a65', '#a04000', '#2e4053'];

  /**
   * O'yin uslublari — botDecide'ga beriladi.
   *  tight:  faqat kuchli kartada o'ynaydi
   *  loose:  ko'p tenglashtiradi
   *  aggro:  tez-tez oshiradi
   *  bluff:  kuchsiz kartada ham blef qiladi
   */
  const STYLES = {
    normal: { foldBias: 0, raiseBias: 0, bluff: 0.08 },
    tight: { foldBias: 3, raiseBias: -0.1, bluff: 0.02 },
    loose: { foldBias: -3, raiseBias: -0.05, bluff: 0.1 },
    aggro: { foldBias: -1, raiseBias: 0.25, bluff: 0.15 },
    bluff: { foldBias: -2, raiseBias: 0.1, bluff: 0.3 },
  };
  const STYLE_KEYS = Object.keys(STYLES);

  const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
  const digits = (n, rng) => String(Math.floor(rng() * 10 ** n)).padStart(n, '0');

  function pickCountry(rng) {
    const total = COUNTRIES.reduce((s, c) => s + c.weight, 0);
    let r = rng() * total;
    for (const c of COUNTRIES) if ((r -= c.weight) < 0) return c;
    return COUNTRIES[0];
  }

  function makeName(rng) {
    const country = pickCountry(rng);
    const r = rng();
    let name;
    let isNew = false;
    if (r < 0.22) {
      // Mehmon12345, Guest_4821, Игрок 5521
      const pre = pick(GUEST_PREFIXES, rng);
      const sep = pick(['', '_', ' ', '#'], rng);
      name = pre + sep + digits(3 + Math.floor(rng() * 3), rng);
      isNew = rng() < 0.6;
    } else if (r < 0.38) {
      // Nik-neym: Sardor_99, LuckyAnna, ace.mike
      const base = pick(country.names, rng);
      const v = rng();
      if (v < 0.4) name = base + pick(['_', '', '.'], rng) + digits(2, rng);
      else if (v < 0.7) name = pick(NICKS, rng) + base;
      else name = base.toLowerCase() + pick(['_', '.'], rng) + pick(NICKS, rng).toLowerCase();
    } else {
      // Oddiy ism, ba'zan familiya bosh harfi bilan
      name = pick(country.names, rng);
      if (rng() < 0.3) name += ' ' + String.fromCharCode(65 + Math.floor(rng() * 26)) + '.';
    }
    return { name, flag: country.flag, country: country.code, isNew };
  }

  /** Yangi NPC. `taken` — stoldagi band nomlar (takrorlanmasligi uchun). */
  function createNPC({ ante = 10, taken = [], rng = Math.random } = {}) {
    let n;
    for (let i = 0; i < 20; i++) {
      n = makeName(rng);
      if (!taken.includes(n.name)) break;
    }
    const level = n.isNew ? 1 + Math.floor(rng() * 3) : 3 + Math.floor(rng() * 40);
    const mult = n.isNew ? 15 + Math.floor(rng() * 30) : 25 + Math.floor(rng() * 120);
    return {
      id: 'npc-' + Math.floor(rng() * 1e9).toString(36),
      name: n.name,
      flag: n.flag,
      country: n.country,
      level,
      isNew: n.isNew,
      isBot: true,
      style: n.isNew ? pick(['loose', 'normal', 'bluff'], rng) : pick(STYLE_KEYS, rng),
      color: pick(COLORS, rng),
      chips: ante * mult,
    };
  }

  return { COUNTRIES, STYLES, makeName, createNPC };
});

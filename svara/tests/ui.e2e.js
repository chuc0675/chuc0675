/*
 * Brauzer (mobil) testlari: haqiqiy server + Chromium (Playwright).
 * Ishga tushirish: npm run test:ui   (playwright o'rnatilgan bo'lishi kerak)
 * Tekshiradi: ikki o'yinchi yopiq stolda o'ynaydi, raqib kartalari ko'rinmaydi,
 * 320–412 px ekranlarda gorizontal skroll yo'q, JS xatolari yo'q.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
let playwright;
try {
  playwright = require('playwright');
} catch (_) {
  console.log('playwright topilmadi — UI testlari o\'tkazib yuborildi (npm i -D playwright)');
  process.exit(0);
}
const { createApp } = require('../server/app');
const { buildConfig } = require('../server/config');

(async () => {
  const shots = fs.mkdtempSync(path.join(os.tmpdir(), 'svara-ui-'));
  const cfg = Object.assign(buildConfig({ DEV_AUTH: '1', DB_PATH: ':memory:' }), { npcFillSeconds: 2, turnSeconds: 15, nextHandSeconds: 1 });
  const app = createApp(cfg, { logger: { info() {}, error: console.error } });
  const { port } = await app.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}/`;
  const browser = await playwright.chromium.launch();
  const errors = [];
  const open = async (viewport) => {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
    const pg = await ctx.newPage();
    pg.on('pageerror', (e) => errors.push(e.message));
    await pg.route('https://telegram.org/**', (r) => r.fulfill({ body: '', contentType: 'text/javascript' }));
    await pg.goto(url);
    await pg.waitForFunction(() => document.getElementById('modeBadge').textContent === 'Onlayn', null, { timeout: 10000 });
    return pg;
  };
  try {
    // 1) ikki o'yinchi
    const A = await open({ width: 390, height: 844 });
    const B = await open({ width: 360, height: 740 });
    await A.click('#createBtn');
    await A.click('#modalBtns .btn.gold');
    await A.waitForSelector('#table.active');
    const code = await A.evaluate(() => window.__svara.view.room.code);
    await B.fill('#codeInput', code);
    await B.click('#codeBtn');
    await B.waitForSelector('#table.active');
    let ended = false;
    for (let i = 0; i < 200 && !ended; i++) {
      for (const pg of [A, B]) {
        const v = await pg.evaluate(() => window.__svara.view);
        if (v && v.status !== 'ROUND_END') {
          const leak = v.players.filter((p) => p.id !== v.you.id && p.cards);
          assert.equal(leak.length, 0, 'raqib kartalari ochilishdan oldin ko\'rinmasligi kerak');
        }
        if (v && v.status === 'ROUND_END') ended = true;
        const btn = await pg.$('.actions button.call');
        if (btn) await btn.click().catch(() => {});
        const m = await pg.$('#modal.show .modal-btns .btn.gold');
        if (m) await m.click().catch(() => {});
      }
      await A.waitForTimeout(150);
    }
    assert.ok(ended, 'qo\'l tugashi kerak');
    await A.screenshot({ path: path.join(shots, 'two-players.png') });

    // 2) ekran o'lchamlari: lobbi va 6 kishilik stol
    for (const vp of [{ width: 320, height: 568 }, { width: 375, height: 667 }, { width: 412, height: 915 }]) {
      const pg = await open(vp);
      for (const s of ['lobby', 'leaders', 'profile', 'settings']) {
        await pg.click(`#nav button[data-s="${s}"]`);
        await pg.waitForTimeout(150);
        assert.ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `${s} ${vp.width}px: gorizontal skroll`);
      }
      await pg.click('#nav button[data-s="lobby"]');
      await pg.click('#sizeSeg button[data-v="6"]');
      await pg.click('#quickBtn');
      await pg.waitForFunction(() => window.__svara.view && window.__svara.view.players.length >= 6, null, { timeout: 20000 });
      await pg.waitForTimeout(500);
      assert.ok(!(await pg.evaluate(() => document.documentElement.scrollWidth > innerWidth)), `stol ${vp.width}px: gorizontal skroll`);
      // barcha o'rinlar stol ichida
      const inside = await pg.evaluate(() => {
        const f = document.getElementById('felt').getBoundingClientRect();
        return [...document.querySelectorAll('.seat .avatar')].every((a) => {
          const r = a.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.top >= f.top - 60 && r.bottom <= f.bottom + 40;
        });
      });
      assert.ok(inside, `stol ${vp.width}px: o'rinlar ekrandan chiqib ketdi`);
      await pg.screenshot({ path: path.join(shots, `table-${vp.width}x${vp.height}.png`) });
      await pg.click('#leaveBtn');
      const confirm = await pg.$('#modal.show #modalBtns .btn.red');
      if (confirm) await confirm.click();
      await pg.waitForSelector('#lobby.active');
      await pg.context().close();
    }
    assert.deepEqual(errors, [], 'brauzerda JS xatolari bo\'lmasligi kerak');
    console.log('UI testlari o\'tdi. Skrinshotlar:', shots);
  } finally {
    await browser.close();
    await app.close();
  }
})().catch((e) => {
  console.error('UI test xatosi:', e.message);
  process.exit(1);
});

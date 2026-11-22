/* Phase 5.5 live check against the DEV deployment: REAL web build, REAL tiles and MapLibre, REAL Search API, Places API and Routing API.
 * Nothing is mocked. The only simulated thing is the GPS (Playwright geolocation). This is "DEV redesign verified with simulated GPS";
 * it is NOT a physical-device test.
 *
 * Usage: node scripts/test-redesign-live.js     (WEB_URL defaults to the DEV site; SHOTS=dir saves screenshots)
 * Pre-merge check of a local build against the real DEV backends: WEB_URL=http://127.0.0.1:18081 SPOOF_ORIGIN=https://kunde-maps-web-dev.onrender.com
 *   (the backends allow only the DEV origin via CORS; the harness re-sends those requests with it. A local server has no CSP header, so the
 *   security-header check only runs against a deployed site.) */
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const WEB = (process.env.WEB_URL || 'https://kunde-maps-web-dev.onrender.com').replace(/\/$/, '');
const SPOOF = process.env.SPOOF_ORIGIN || '';
const SHOTS = process.env.SHOTS || '';
const HOME = {latitude: 43.2389, longitude: 76.9456, accuracy: 9};   // Almaty, Baiseitova area: real places exist around it
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(...a);
const shot = async (page, name) => { if (SHOTS) { fs.mkdirSync(SHOTS, {recursive: true}); await page.screenshot({path: path.join(SHOTS, name + '.png')}); } };

async function config() {
  const res = await fetch(WEB + '/config.json', {signal: AbortSignal.timeout(30000)});
  assert.ok(res.ok, 'config.json is served');
  return res.json();
}
async function warmUp(cfg) {
  for (const [name, base] of [['routing', cfg.routingUrl], ['search', cfg.searchUrl]]) {
    const t0 = Date.now();
    for (;;) {
      try { const r = await fetch(base + '/health', {signal: AbortSignal.timeout(30000)}); if (r.ok) break; } catch (_) { /* cold start */ }
      assert.ok(Date.now() - t0 < 180000, name + ' did not wake up within 3 minutes');
      await sleep(3000);
    }
    log(`  ${name} API ready after ${Math.round((Date.now() - t0) / 1000)} s`);
  }
}

async function open(browser, cfg, {viewport = {width: 390, height: 844}, mobile = true, theme = 'dark', lang, hash = '', geo = true} = {}) {
  const context = await browser.newContext({viewport, isMobile: mobile, hasTouch: mobile, colorScheme: theme, deviceScaleFactor: mobile ? 2 : 1,
    ...(geo ? {permissions: ['geolocation'], geolocation: HOME} : {})});
  const page = await context.newPage();
  const problems = [], hosts = new Set();
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('console', m => { if (['error', 'warning'].includes(m.type()) && !/Failed to load resource|GPU stall|WebGL|Map cannot fit within canvas/.test(m.text())) problems.push(m.type() + ': ' + m.text().slice(0, 200)); });
  page.on('request', r => { try { const u = new URL(r.url()); if (u.protocol === 'http:' || u.protocol === 'https:') hosts.add(u.host); } catch (_) { /* blob/data */ } });
  await page.addInitScript(() => {
    window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));
    window.__geo = {starts: 0, gets: 0}; const g = navigator.geolocation, w = g.watchPosition.bind(g), gc = g.getCurrentPosition.bind(g);
    g.watchPosition = (a, b, o) => { window.__geo.starts++; return w(a, b, o); }; g.getCurrentPosition = (a, b, o) => { window.__geo.gets++; return gc(a, b, o); };
  });
  if (lang) await page.addInitScript(l => { try { localStorage.setItem('kunde-lang', l); } catch (_) { /* ignore */ } }, lang);
  if (SPOOF) {
    await page.route('**/config.json', route => route.fulfill({status: 200, contentType: 'application/json', body: JSON.stringify(cfg)}));
    for (const origin of [cfg.routingUrl, cfg.searchUrl, new URL(cfg.tileUrl).origin]) await page.route(origin + '/**', async route => {
      const req = route.request();
      const response = await route.fetch({headers: {...req.headers(), origin: SPOOF}});
      await route.fulfill({response, headers: {...response.headers(), 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Content-Range,Content-Length,Retry-After,Accept-Ranges',
        'access-control-allow-headers': 'range,content-type,x-api-key'}});
    });
  }
  await page.goto(WEB + '/' + hash, {waitUntil: 'domcontentloaded'});
  await page.locator('#status').filter({hasText: /Карта загружена|Карта жүктелді|Map loaded/}).waitFor({timeout: 60000});
  return {page, context, problems, hosts, cfg};
}
async function finish(ctx, label) {
  const csp = await ctx.page.evaluate(() => window.__csp);
  assert.deepEqual(csp, [], label + ': CSP violations');
  assert.deepEqual(ctx.problems, [], label + ': console problems');
  const allowed = new Set([new URL(WEB).host, new URL(ctx.cfg.routingUrl).host, new URL(ctx.cfg.searchUrl).host, new URL(ctx.cfg.tileUrl).host]);
  assert.deepEqual([...ctx.hosts].filter(h => !allowed.has(h)), [], label + ': requests to hosts outside the app');
  await ctx.context.close();
}
const rect = (page, sel) => page.locator(sel).evaluate(el => el.getBoundingClientRect().toJSON());
const overlap = (a, b) => !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right);

const scenarios = {
  async 'real map opens with the new shell; OSM attribution is visible and never covered by the sheet or tab bar'(browser, cfg) {
    const ctx = await open(browser, cfg);
    const {page} = ctx;
    await page.locator('.maplibregl-canvas').waitFor();
    const canvas = await rect(page, '.maplibregl-canvas');
    assert.ok(canvas.width >= 390 && canvas.height >= 844, 'the real map canvas fills the screen');
    const attrib = await page.evaluate(() => { const a = document.querySelector('.maplibregl-ctrl-attrib'); return {text: a.textContent, rect: a.getBoundingClientRect().toJSON()}; });
    assert.match(attrib.text, /OpenStreetMap/);
    for (const sel of ['#sheet', '#tabbar', '#map-tools']) assert.equal(overlap(attrib.rect, await rect(page, sel)), false, 'attribution overlaps ' + sel);
    assert.equal(await page.locator('#sheet').getAttribute('data-snap'), 'collapsed');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(await page.evaluate(() => window.__geo.starts + window.__geo.gets), 0, 'GPS is not touched until the user acts');
    await shot(page, 'live-home-mobile-dark');
    await finish(ctx, 'home');
  },
  async 'real address search, place card with real actions, favorites survive a reload'(browser, cfg) {
    const ctx = await open(browser, cfg);
    const {page} = ctx;
    await page.locator('#search-query').fill('Абая');
    await page.locator('#search-results [role=option]').first().waitFor({timeout: 90000});
    const names = await page.locator('#search-results .result-name').allInnerTexts();
    assert.ok(names.length >= 1 && names.every(n => n.trim()), 'real results: ' + names.join(' | '));
    await shot(page, 'live-search-results');
    await page.locator('#search-results [role=option]').first().click();
    await page.locator('#selection').waitFor();
    assert.ok((await page.locator('#selection-title').innerText()).trim());
    assert.equal(await page.locator('#sheet').getAttribute('data-snap'), 'half');
    assert.deepEqual((await page.locator('.place-actions .btn:visible').allInnerTexts()).map(t => t.trim()).slice(0, 3), ['Маршрут', 'Сохранить', 'Поделиться']);
    const title = (await page.locator('#selection-title').innerText()).trim();
    await shot(page, 'live-place-card');
    await page.locator('#save-place').click();
    await page.reload();
    await page.locator('#status').filter({hasText: /Карта загружена/}).waitFor({timeout: 60000});
    await page.locator('#tabbar .tab[data-tab=favorites]').click();
    await page.locator('#favorites-list li').first().waitFor();
    assert.match(await page.locator('#favorites-list').innerText(), new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 20)));
    await finish(ctx, 'search');
  },
  async 'real categories: chip and "near you" tiles return real places from the Places API; distances ascend'(browser, cfg) {
    const ctx = await open(browser, cfg);
    const {page} = ctx;
    await page.locator('#chips .chip[data-category=pharmacy]').click();
    await page.locator('#places-list .row').first().waitFor({timeout: 90000});
    const viewportRows = await page.locator('#places-list .row').count();
    assert.ok(viewportRows > 0, 'real pharmacies in the map area');
    await page.locator('#places-clear').click();
    assert.equal(await page.locator('#home-panel').isVisible(), true);
    assert.equal(await page.evaluate(() => window.__geo.gets), 0, 'a chip never asks for GPS');
    await page.locator('#quick-cats .qcat[data-category=pharmacy]').click();
    await page.locator('#places-title').filter({hasText: /Рядом/}).waitFor({timeout: 90000});
    await page.locator('#places-list .row').first().waitFor();
    assert.equal(await page.evaluate(() => window.__geo.gets), 1, 'the tap (user action) asked for the position once');
    const subs = await page.locator('#places-list .result-sub').allInnerTexts();
    const metres = subs.map(t => (t.match(/(\d+(?:\.\d)?)\s*(км|м)\b/) || [])).filter(m => m[1]).map(m => m[2] === 'км' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]));
    assert.ok(metres.length >= 1 && metres.every((v, i) => i === 0 || v >= metres[i - 1] - 60), 'nearby results are ordered by distance: ' + metres.join(','));
    await shot(page, 'live-nearby-pharmacies');
    await page.locator('#places-list .row').first().click();
    await page.locator('#selection').waitFor();
    assert.match(await page.locator('#selection-details').innerText(), /\d+\s*(м|км)/, 'the card shows the real distance');
    await finish(ctx, 'categories');
  },
  async 'real route: Directions tab, route from the device position, steps, Navigator tab focuses Start without starting GPS'(browser, cfg) {
    const ctx = await open(browser, cfg);
    const {page} = ctx;
    await page.locator('#tabbar .tab[data-tab=navigator]').click();
    assert.match(await page.locator('#navigator-head').innerText(), /Маршрут ещё не выбран/);
    await page.locator('#search-query').fill('Арбат');
    await page.locator('#tabbar .tab[data-tab=search]').click();
    await page.locator('#search-results [role=option]').first().waitFor({timeout: 90000});
    await page.locator('#search-results [role=option]').first().click();
    await page.locator('#selection').waitFor();
    await page.locator('#route-place').click();
    await page.locator('#route-start').waitFor({state: 'visible', timeout: 120000});
    assert.ok((await page.locator('#route-total').innerText()).includes('км') || (await page.locator('#route-total').innerText()).includes(' м'));
    assert.ok(await page.locator('#route-steps li').count() >= 2, 'real turn-by-turn steps');
    assert.equal(await page.locator('#tabbar .tab[aria-current=page]').getAttribute('data-tab'), 'route');
    await shot(page, 'live-route-panel');
    await page.locator('#tabbar .tab[data-tab=navigator]').click();
    assert.equal(await page.locator('#tabbar .tab[aria-current=page]').getAttribute('data-tab'), 'navigator');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'route-start');
    assert.equal(await page.evaluate(() => window.__geo.starts), 0, 'opening the Navigator tab does not start GPS');
    await finish(ctx, 'route');
  },
  async 'navigation with simulated GPS: Start -> HUD hides the shell -> position fix -> End cleans up (full trip with reroute is test-navigation-dev.js)'(browser, cfg) {
    const ctx = await open(browser, cfg);
    const {page, context} = ctx;
    await page.locator('#search-query').fill('Арбат');
    await page.locator('#search-results [role=option]').first().waitFor({timeout: 90000});
    await page.locator('#search-results [role=option]').first().click();
    await page.locator('#route-place').click();
    await page.locator('#route-start').waitFor({state: 'visible', timeout: 120000});
    await page.locator('#route-start').click();
    await page.locator('#nav[data-state=ACTIVE], #nav:not([hidden])').first().waitFor({timeout: 20000});
    await page.locator('#nav[data-state=ACTIVE]').waitFor({timeout: 20000});
    for (const sel of ['#tabbar', '#sheet', '#map-tools', '.brand-row']) assert.equal(await page.locator(sel).isHidden(), true, sel + ' is hidden during navigation');
    assert.ok((await page.locator('#nav-dist').innerText()).trim(), 'maneuver distance shown');
    assert.equal(await page.evaluate(() => window.__geo.starts), 1);
    await context.setGeolocation({latitude: 43.2395, longitude: 76.9458, accuracy: 8});
    await sleep(1500);
    await shot(page, 'live-navigation-hud');
    const attrib = await page.evaluate(() => { const a = document.querySelector('.maplibregl-ctrl-attrib').getBoundingClientRect(), b = document.querySelector('#nav-bottom').getBoundingClientRect(); return !(a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right); });
    assert.equal(attrib, false, 'attribution not covered by the navigation panel');
    await page.locator('#nav-end').click();
    if (await page.locator('#nav-end').isVisible().catch(() => false)) await page.locator('#nav-end').click();   // two-step confirm
    await page.locator('#nav').waitFor({state: 'hidden', timeout: 10000});
    assert.equal(await page.locator('#tabbar').isVisible(), true, 'the shell returns after navigation');
    await finish(ctx, 'navigation');
  },
  async 'theme and language switches on the real map: light/dark style swap keeps tiles, RU/KK/EN labels follow'(browser, cfg) {
    const ctx = await open(browser, cfg);
    const {page} = ctx;
    await page.locator('#tabbar .tab[data-tab=profile]').click();
    await page.locator('#set-theme .seg[data-value=light]').click();
    await page.waitForTimeout(2500);
    assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(244, 246, 250)');
    await shot(page, 'live-profile-light');
    await page.locator('#set-theme .seg[data-value=dark]').click();
    await page.locator('#set-language .seg[data-value=kk]').click();
    assert.match(await page.locator('#tabbar').innerText(), /Іздеу/);
    await page.locator('#set-language .seg[data-value=en]').click();
    assert.match(await page.locator('#tabbar').innerText(), /Directions/);
    assert.equal(await page.locator('.maplibregl-canvas').count(), 1, 'the map survived the style swaps');
    await finish(ctx, 'theme-language');
  },
  async 'desktop: sidebar + real map; search, place card and route live in the sidebar'(browser, cfg) {
    const ctx = await open(browser, cfg, {viewport: {width: 1366, height: 800}, mobile: false});
    const {page} = ctx;
    const rail = await rect(page, '.rail'), tools = await rect(page, '#map-tools');
    assert.ok(rail.width >= 380 && rail.width <= 430 && tools.left > rail.right);
    assert.equal(await page.locator('#sheet-handle').isVisible(), false);
    await shot(page, 'live-home-desktop-dark');
    await page.locator('#search-query').fill('Абая');
    await page.locator('#search-results [role=option]').first().waitFor({timeout: 90000});
    await page.locator('#search-results [role=option]').first().click();
    await page.locator('#selection').waitFor();
    assert.equal(overlap(await rect(page, '#selection'), tools), false);
    await shot(page, 'live-place-desktop');
    await page.locator('#route-place').click();
    await page.locator('#route-start').waitFor({state: 'visible', timeout: 120000});
    await shot(page, 'live-route-desktop');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await finish(ctx, 'desktop');
  },
  async 'deployed site keeps its security headers (CSP, nosniff, frame-ancestors) - only when testing a deployed URL'(browser, cfg) {
    if (SPOOF) { log('     (skipped: local build)'); return; }
    const res = await fetch(WEB + '/', {signal: AbortSignal.timeout(30000)});
    const csp = res.headers.get('content-security-policy') || '';
    assert.match(csp, /default-src 'none'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
    assert.ok(!/unsafe-inline|unsafe-eval/.test(csp), 'CSP stays strict');
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    const html = await res.text();
    for (const f of ['shell.js', 'shell-ui.js', 'icons.js', 'shell.css']) assert.ok(html.includes('./' + f), f + ' is part of the deployed build');
  },
};

(async () => {
  const cfg = await config();
  log('web:', WEB, SPOOF ? '(local build, requests re-sent as ' + SPOOF + ')' : '');
  await warmUp(cfg);
  const browser = await chromium.launch({headless: true, args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']});
  const only = process.argv[2];
  let failed = 0;
  try {
    for (const [name, fn] of Object.entries(scenarios)) {
      if (only && !name.includes(only)) continue;
      const t0 = Date.now();
      try { await fn(browser, cfg); console.log(`ok   - ${name} (${Math.round((Date.now() - t0) / 1000)} s)`); }
      catch (error) { failed++; console.error('FAIL -', name, '\n      ', error.message.split('\n').slice(0, 8).join('\n       ')); }
    }
  } finally { await browser.close(); }
  console.log(failed ? failed + ' live redesign scenario(s) failed' : 'All live redesign scenarios passed');
  process.exitCode = failed ? 1 : 0;
})();
